import { resolveMoroccoDossierReference } from "./moroccoDossierReference.ts";
import { prependMoroccoPassengerListing } from "./moroccoPassengerListingPdf.ts";
import type { MoroccoDossierPdfInput } from "./moroccoPassengers.ts";
import { MOROCCO_SATELLITE_ATTRIBUTION, type MoroccoDossierMapImage } from "./moroccoDossierMap.ts";
// Independent Morocco preparation generator. France remains in flightDossierPdf.ts.
import { moroccoChecklistBase64, moroccoLogoBase64 } from "./moroccoChecklistAsset.ts";
import { addMoroccoChecklistFields } from "./moroccoChecklistFields.ts";
import { PDFDocument, PDFName, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { FlightDossierResult } from "./flightDossierEntry.ts";
import type { FlightDossierWeather } from "./flightDossierWeather.ts";
import { dossierLocalTime, dossierTimeZone, dossierWind, dossierArrivalWindWarning } from "./flightDossierPresentation.ts";
import type { DossierAirspacePassage } from "./flightDossierOperations.ts";

export type FlightDossierData = Extract<FlightDossierResult, { status: "READY" }>["data"];
export type DossierPdfInput = { dossier: FlightDossierData; weather: FlightDossierWeather | null; weatherError?: string | null; generatedAt?: string };
export type DossierPdfMap = { png: Uint8Array; background: "OPENSTREETMAP" | "NEUTRAL"; timeMarkers?: number[] } | { error: string };
const A4: [number, number] = [595.28, 841.89];
const MARGIN = 42;
const WIDTH = A4[0] - 2 * MARGIN;
const BOTTOM = 52;
const INK = rgb(.08, .15, .23), MUTED = rgb(.35, .41, .47), ACCENT = rgb(.06, .36, .48), PALE = rgb(.94, .96, .97);
const absent = "indisponible";
const number = (value: number | null | undefined, digits = 1) => value !== null && value !== undefined && Number.isFinite(value) ? value.toLocaleString("fr-FR", { maximumFractionDigits: digits }).replace(/[\u202f\u00a0]/g, " ") : absent;
const status = (value?: string) => ({ AVAILABLE: "Disponible", PARTIAL: "Partiel", STALE: "Ancien / actualisation échouée", UNAVAILABLE: "Indisponible", OFFICIAL_VALIDATED: "Validé constructeur", CANDIDATE_PILOT_VALIDATION: "Candidat - validation pilote", PENDING_VERIFICATION: "En attente de vérification" }[value ?? ""] ?? value ?? absent);

/** Preserve unsupported characters as visible Unicode escapes, never drop text. */
function safeText(value: string, font: PDFFont): string {
  const characters = new Set(font.getCharacterSet());
  return Array.from(value.normalize("NFC").replace(/[’‘]/g, "'").replace(/[−–—‑]/g, "-").replace(/→/g, " -> ").replace(/[\u202f\u00a0]/g, " ")).map((character) => {
    if (character === "\n" || characters.has(character.codePointAt(0)!)) return character;
    const latin = character.normalize("NFD").replace(/\p{M}/gu, "");
    if (/^[A-Za-z]$/.test(latin)) return latin;
    return `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
  }).join("");
}

export function wrapDossierText(value: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of safeText(value, font).split("\n")) {
    let line = "";
    // Break long tokens too: raw TAF, URLs, IDs and arbitrary names must all fit.
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && font.widthOfTextAtSize(`${line} ${word}`, size) <= width) { line += ` ${word}`; continue; }
      if (line) { lines.push(line); line = ""; }
      for (const character of word) {
        if (line && font.widthOfTextAtSize(line + character, size) > width) { lines.push(line); line = ""; }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

class DossierLayout {
  page!: PDFPage;
  y = 0;
  section = "Informations du vol";
  readonly document: PDFDocument;
  readonly font: PDFFont;
  readonly bold: PDFFont;
  readonly referenceLabel: string;
  constructor(document: PDFDocument, font: PDFFont, bold: PDFFont, referenceLabel: string) { this.document = document; this.font = font; this.bold = bold; this.referenceLabel = referenceLabel; }
  newPage() {
    this.page = this.document.addPage(A4);
    this.page.drawRectangle({ x: 0, y: A4[1] - 61, width: A4[0], height: 61, color: INK });
    this.page.drawText("BALLOON COMPANION", { x: MARGIN, y: A4[1] - 29, size: 11, font: this.bold, color: rgb(1, 1, 1) });
    const referenceSize = Math.min(7.5, 345 / this.font.widthOfTextAtSize(this.referenceLabel, 1));
    this.page.drawText(this.referenceLabel, { x: A4[0] - MARGIN - this.font.widthOfTextAtSize(this.referenceLabel, referenceSize), y: A4[1] - 29, size: referenceSize, font: this.font, color: rgb(1, 1, 1) });
    this.page.drawText(safeText(this.section, this.font), { x: MARGIN, y: A4[1] - 47, size: 9, font: this.font, color: rgb(.75, .86, .90) });
    this.y = A4[1] - 84;
  }
  ensure(height: number) { if (!this.page || this.y - height < BOTTOM) this.newPage(); }
  heading(value: string, newPage = false) {
    this.section = value;
    if (newPage || !this.page) this.newPage();
    this.ensure(65);
    const lines = wrapDossierText(value, this.bold, 15, WIDTH);
    for (const line of lines) { this.ensure(22); this.page.drawText(line, { x: MARGIN, y: this.y - 15, size: 15, font: this.bold, color: ACCENT }); this.y -= 22; }
    this.y -= 6;
  }
  paragraph(value: string, options: { bold?: boolean; size?: number; muted?: boolean } = {}) {
    const font = options.bold ? this.bold : this.font, size = options.size ?? 9, leading = size * 1.25;
    for (const line of wrapDossierText(value, font, size, WIDTH)) {
      this.ensure(leading);
      this.page.drawText(line, { x: MARGIN, y: this.y - size, size, font, color: options.muted ? MUTED : INK });
      this.y -= leading;
    }
    this.y -= 3;
  }
  table(headers: string[], widths: number[], rows: string[][]) {
    const size = 8.2, leading = 10.5, padding = 3;
    const headerLines = headers.map((value, index) => wrapDossierText(value, this.bold, size, widths[index] - padding * 2));
    const headerHeight = Math.max(...headerLines.map((lines) => lines.length)) * leading + padding * 2;
    const drawHeader = () => {
      this.ensure(headerHeight + leading + padding * 2);
      this.page.drawRectangle({ x: MARGIN, y: this.y - headerHeight, width: WIDTH, height: headerHeight, color: ACCENT });
      let x = MARGIN;
      headerLines.forEach((lines, index) => { lines.forEach((line, offset) => this.page.drawText(line, { x: x + padding, y: this.y - padding - size - offset * leading, size, font: this.bold, color: rgb(1, 1, 1) })); x += widths[index]; });
      this.y -= headerHeight;
    };
    drawHeader();
    rows.forEach((row, rowIndex) => {
      const cells = widths.map((width, index) => wrapDossierText(row[index] || absent, this.font, size, width - padding * 2));
      const length = Math.max(...cells.map((lines) => lines.length));
      let offset = 0;
      while (offset < length) {
        if (this.y - (leading + padding * 2) < BOTTOM) { this.newPage(); drawHeader(); }
        const count = Math.min(length - offset, Math.floor((this.y - BOTTOM - padding * 2) / leading));
        const height = count * leading + padding * 2;
        if (rowIndex % 2 === 0) this.page.drawRectangle({ x: MARGIN, y: this.y - height, width: WIDTH, height, color: PALE });
        let x = MARGIN;
        cells.forEach((lines, index) => {
          lines.slice(offset, offset + count).forEach((line, lineIndex) => this.page.drawText(line, { x: x + padding, y: this.y - padding - size - lineIndex * leading, size, font: this.font, color: INK }));
          x += widths[index];
        });
        this.page.drawLine({ start: { x: MARGIN, y: this.y - height }, end: { x: MARGIN + WIDTH, y: this.y - height }, thickness: .35, color: rgb(.82, .87, .89) });
        this.y -= height;
        offset += count;
      }
    });
    this.y -= 7;
  }
  finish() {
    const pages = this.document.getPages();
    pages.slice(2).forEach((page, index) => {
      page.drawLine({ start: { x: MARGIN, y: 38 }, end: { x: A4[0] - MARGIN, y: 38 }, thickness: .5, color: rgb(.8, .85, .88) });
      page.drawText("Atlas Vallée Ballons - Préparation Maroc", { x: MARGIN, y: 24, size: 7.5, font: this.font, color: MUTED });
      const label = `${index + 3} / ${pages.length}`;
      page.drawText(label, { x: A4[0] - MARGIN - this.font.widthOfTextAtSize(label, 8), y: 24, size: 8, font: this.font, color: MUTED });
    });
  }
}

function uncertainty(reason: string): string {
  if (reason.includes("REQUIRES_LOCAL_TERRAIN")) return "Conversion AGL/SFC impossible sans terrain local";
  if (reason.includes("FL_REQUIRES_PRESSURE")) return "FL non comparable à l'AMSL sans référence de pression adaptée";
  return ({ ACTIVITY_AT_PASSAGE_UNKNOWN: "Activation aux horaires de passage inconnue", ANTIMERIDIAN_UNRESOLVED: "Passage de l'antiméridien non résolu", TRACE_ALTITUDE_INVALID: "Altitude de trace invalide", INVALID_VERTICAL_LIMITS: "Limites verticales incohérentes", HORIZONTAL_BOUNDARY_CONTACT: "Contact avec une limite horizontale", VERTICAL_BOUNDARY_CONTACT: "Contact avec une limite verticale", TRACE_TIMES_INVALID: "Horaires de trace invalides", VARIABLE_FLOOR_UNRESOLVED: "Plancher variable non résolu", VARIABLE_CEILING_UNRESOLVED: "Plafond variable non résolu" }[reason] ?? `Incertitude source : ${reason}`);
}

function airspaceSection(layout: DossierLayout, item: DossierAirspacePassage, date: (value: string | null | undefined) => string) {
  layout.ensure(85);
  layout.paragraph(`${item.airspace.name} | Classe ${item.airspace.icaoClassLabel || absent}`, { bold: true, size: 11 });
  layout.paragraph(`${item.airspace.typeLabel || absent} | Plancher : ${item.floor.displayLabel} | Plafond : ${item.ceiling.displayLabel}`);
  layout.paragraph(`Intersection : ${item.spatialStatus === "INTERSECTS_3D" ? "3D sur la trajectoire prévue" : "possible / verticale incertaine"}. Activité : indéterminée.`);
  layout.table(["Entrée locale / UTC", "Sortie locale / UTC", "Altitude entrée / sortie (m AMSL)", "Qualification"], [127, 127, 130, WIDTH - 384], item.passages.map((passage) => [date(passage.entryAt), date(passage.exitAt), `${number(passage.entryAltitudeAmslM)} / ${number(passage.exitAltitudeAmslM)}`, passage.spatialStatus === "INTERSECTS" ? "Intersection 3D" : "Incertaine"]));
  layout.paragraph(`Fréquences OpenAIP - NON VÉRIFIÉES AIP. ${item.frequencies.notice}`, { bold: true });
  if (!item.frequencies.values.length) layout.paragraph(`Fréquence : ${absent}`);
  item.frequencies.values.forEach((frequency) => layout.paragraph(`${frequency.name || "Station non précisée"} : ${frequency.value || absent}${frequency.primary ? " (principale selon la source)" : ""}${frequency.remarks ? ` ; ${frequency.remarks}` : ""}`));
  const activity = item.activity.published;
  layout.paragraph(`Activité publiée : ${activity.activity ?? absent} (code source OpenAIP). Début : ${activity.activeFrom ?? absent} ; fin : ${activity.activeUntil ?? absent}.`);
  const flag = (value: boolean | null) => value === null || value === undefined ? absent : value ? "oui" : "non";
  layout.paragraph(`Par NOTAM : ${flag(activity.byNotam)} ; à la demande : ${flag(activity.onDemand)} ; sur requête : ${flag(activity.onRequest)}. ${item.activity.notice}`);
  [...new Set([...item.reasons, ...item.passages.flatMap((passage) => passage.reasons)])].forEach((reason) => layout.paragraph(`Incertitude : ${uncertainty(reason)}`, { muted: true }));
}

export async function createMoroccoFlightDossierPdf(input: MoroccoDossierPdfInput, map: DossierPdfMap | MoroccoDossierMapImage): Promise<Uint8Array> {
  const { dossier, weather } = input;
  const reference = resolveMoroccoDossierReference(dossier, input.dossierReference);
  const scheduledDate = reference.dateLabel;
  const date = (value: string | null | undefined) => dossierLocalTime(value, dossier.launchTimeZone, true);
  // PDF convention: convert altitude m/s once; ground values already use km/h.
  const unit = "km/h";
  const wind = (value: number | null | undefined, source: "m/s" | "km/h") => value == null || !Number.isFinite(value) ? "-" : number(dossierWind(value, source, unit));
  if (weather && (weather.traceId !== dossier.traceId || weather.weatherModel !== dossier.model.providerModelId) || dossier.operations && dossier.operations.traceId !== dossier.traceId) throw new Error("Les données ne correspondent pas à la stratégie sélectionnée.");
  if (dossier.points.length < 2) throw new Error("Trajectoire sélectionnée invalide.");
  const document = await PDFDocument.load(moroccoChecklistBase64);
  addMoroccoChecklistFields(document);
  document.setTitle(`Préparation Maroc - ${scheduledDate} ${reference.time} - ${dossier.launchSiteName || dossier.traceId}`);
  document.setAuthor("Balloon Companion");
  document.setCreationDate(new Date(reference.iso));
  document.setModificationDate(new Date(reference.iso));
  document.catalog.delete(PDFName.of("Metadata")); // Inherited XMP describes the blank template, not this dossier reference.
  document.setSubject(`Stratégie ${dossier.traceId} - ${dossier.model.providerModelId}`);
  const layout = new DossierLayout(document, await document.embedFont(StandardFonts.Helvetica), await document.embedFont(StandardFonts.HelveticaBold), reference.label);
  const first = dossier.points[0], last = dossier.points.at(-1)!;
  const coordinates = (point: typeof first) => `${number(point.latitude, 6)}, ${number(point.longitude, 6)}`;
  layout.heading(`Préparation Maroc - ${scheduledDate} ${reference.time}`);
  const logo = await document.embedPng(moroccoLogoBase64);
  const logoSize = logo.scaleToFit(110, 55);
  layout.ensure(logoSize.height + 10);
  layout.page.drawImage(logo, { x: MARGIN, y: layout.y - logoSize.height, ...logoSize });
  layout.y -= logoSize.height + 10;
  layout.paragraph(dossier.launchSiteName || "Terrain indisponible", { bold: true, size: 15 });
  layout.table(["Informations", "Valeur"], [155, WIDTH - 155], [
    ["Terrain de départ", dossier.launchSiteName || absent], ["Coordonnées départ", coordinates(first)], ["Coordonnées arrivée prévue", coordinates(last)],
    ["Décollage prévu", dossierLocalTime(dossier.startedAt, dossier.launchTimeZone)], ["Atterrissage prévu", dossierLocalTime(dossier.landingAt, dossier.launchTimeZone)], ["Durée prévue", `${number(dossier.durationSeconds / 60)} min`],
    ["Fuseau du terrain", dossier.launchTimeZone || absent], ["Ballon", `${dossier.balloon.registration || absent} - ${dossier.balloon.manufacturer || absent} ${dossier.balloon.model || absent}`],
    ["Modèle météo sélectionné", `${dossier.model.label} (${dossier.model.providerModelId})`], ["Stratégie", dossier.strategyLabel || absent], ["Identifiant de trace", dossier.traceId],
    ["Points horodatés", String(dossier.points.length)], ["Date/heure du dossier", reference.label],
  ]);
  layout.paragraph("Horaires locaux du terrain en priorité, UTC entre parenthèses. Disponibilité des sources limitée à la référence du dossier ; les indisponibilités et incertitudes restent explicites.");
  if (!dossierTimeZone(dossier.launchTimeZone)) layout.paragraph("Fuseau du terrain indisponible : horaires affichés en UTC uniquement.");
  layout.paragraph("Sources : Open-Meteo, AviationWeather.gov, OpenAIP et OpenStreetMap. Les fréquences OpenAIP ne sont pas vérifiées dans l'AIP. L'activité des espaces et l'exhaustivité de leur couverture doivent être vérifiées.", { muted: true });

  layout.heading("METAR / TAF - Départ et arrivée");
  layout.paragraph(`Limite de disponibilité des sources : ${reference.iso} (UTC). Les heures de validité du vol ne sont pas modifiées.`);
  layout.paragraph("Source : aviationweather.gov. Les stations les plus proches déclarant chaque produit ne garantissent pas sa représentativité locale.");
  if (!weather) layout.paragraph(`Données aviation indisponibles. ${input.weatherError || "Service météo indisponible."}`);
  else for (const location of ["departure", "landing"] as const) for (const product of ["metar", "taf"] as const) {
    const item = weather.aviation[location][product], data = item.result.data;
    layout.ensure(95);
    layout.paragraph(`${location === "departure" ? "Départ" : "Arrivée prévue"} - ${product.toUpperCase()} | ${status(item.status)}`, { bold: true, size: 11 });
    layout.paragraph(item.station ? `${item.station.icao} - ${item.station.name} | Distance : ${number(item.station.distanceKm)} km | ${number(item.station.latitude, 5)}, ${number(item.station.longitude, 5)}` : "Station ICAO, coordonnées et distance : indisponibles");
    layout.paragraph(`Émis : ${date(product === "metar" ? data?.metarIssuedAt : data?.tafIssuedAt)} | Récupéré : ${date(data?.sourceUpdatedAt)}`);
    if (item.freshness) layout.paragraph(item.freshness.label.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/g, (value) => date(value.replace(" UTC", ":00Z").replace(" ", "T"))), { muted: true });
    layout.paragraph((product === "metar" ? data?.metarRaw : data?.tafRaw) || `Message brut indisponible. ${item.result.error?.message || ""}`);
  }

  layout.heading("Vents - Modèle sélectionné");
  layout.paragraph(`${dossier.model.label} (${dossier.model.providerModelId}). Fenêtre demandée : ${date(new Date(Date.parse(dossier.startedAt) - 7_200_000).toISOString())} -> ${date(new Date(Date.parse(dossier.landingAt) + 7_200_000).toISOString())}.`);
  layout.paragraph("Direction de provenance en degrés vrais. Aucune interpolation, extrapolation ou substitution de modèle. Les heures indiquées sont les échéances réelles ; les lignes indisponibles signalent les échéances horaires attendues absentes.");
  if (!weather) layout.paragraph(`Vents en altitude et à 10 m : indisponibles sur toute la fenêtre. ${input.weatherError || ""}`);
  else {
    weather.notices.forEach((notice) => layout.paragraph(notice, { muted: true }));
    const altitude = weather.altitudeWind;
    layout.paragraph(`Profils par altitude au départ | ${status(altitude.status)} | Récupéré : ${date(altitude.fetchedAt)} | Run : ${date(altitude.modelRunAt)}`, { bold: true });
    layout.paragraph(`Maille source départ : ${altitude.sourceLocation ? `${number(altitude.sourceLocation.latitude, 5)}, ${number(altitude.sourceLocation.longitude, 5)}` : absent}.`, { size: 8, muted: true });
    if (altitude.error) layout.paragraph(altitude.error);
    layout.paragraph(`Vent en ${unit}. Altitudes AMSL ; niveaux source AGL / pression conservés. - : donnée indisponible. Rafales en altitude : indisponibles.`, { muted: true });
    const times = [...new Set([...weather.window.expectedHours, ...altitude.points.map((point) => point.validAt)])].sort((a, b) => Date.parse(a) - Date.parse(b));
    for (const time of times) {
      const points = altitude.points.filter((point) => Date.parse(point.validAt) === Date.parse(time));
      layout.ensure(Math.min(600, 65 + Math.max(0, ...points.map((point) => point.levels.length)) * 17));
      layout.paragraph(date(time), { bold: true });
      if (!points.length) layout.paragraph("Échéance indisponible.");
      for (const point of points) {
        if (point.levels.length) layout.table(["Niveau / référence source", "Altitude AMSL (m)", "Direction (°)", `Vent (${unit})`], [205, 110, 90, WIDTH - 405], point.levels.map((level) => [
          `${level.sourceLevel || absent}${level.isApproximation ? " (approximation source)" : ""}`, number(level.geopotentialHeightAmslM), number(level.windDirectionFromDeg), wind(level.windSpeedMps, "m/s"),
        ]));
        else layout.paragraph("Profil exploitable indisponible.");
        const reasons = new Map<string, string[]>();
        for (const rejected of point.rejectedLevels) reasons.set(rejected.reason, [...(reasons.get(rejected.reason) ?? []), rejected.sourceLevel]);
        for (const [reason, levels] of reasons) layout.paragraph(`Niveaux sous terrain / incomplets écartés : ${levels.join(", ")} - ${reason}.`, { size: 8, muted: true });
      }
    }
    const ground = weather.landingGroundWind;
    layout.paragraph(`Vent à 10 m AGL à l'arrivée | ${status(ground.status)} | Récupéré : ${date(ground.fetchedAt)} | Run : ${date(ground.modelRunAt)}`, { bold: true });
    layout.paragraph(`Maille source arrivée : ${ground.sourceLocation ? `${number(ground.sourceLocation.latitude, 5)}, ${number(ground.sourceLocation.longitude, 5)}` : absent}.`, { size: 8, muted: true });
    if (ground.error) layout.paragraph(ground.error);
    const groundTimes = [...new Set([...weather.window.expectedHours, ...ground.points.map((point) => point.validAt)])].sort((a, b) => Date.parse(a) - Date.parse(b));
    layout.table(["Échéance locale / UTC", "Direction (°)", `Vent (${unit})`, `Rafales (${unit})`, "Qualité"], [190, 65, 70, 70, WIDTH - 395], groundTimes.flatMap((time) => {
      const points = ground.points.filter((point) => Date.parse(point.validAt) === Date.parse(time));
      return points.length ? points.map((point) => [date(point.validAt), point.directionFromDeg == null ? "-" : number(point.directionFromDeg), wind(point.speedKmh, "km/h"), wind(point.gustKmh, "km/h"), dossierArrivalWindWarning(point) ? "À vérifier *" : point.unavailableFields.length ? "Incomplet" : "Source"]) : [[date(time), "-", "-", "-", "Absente"]];
    }));
    if (ground.points.some((point) => dossierArrivalWindWarning(point))) layout.paragraph(`* ${dossierArrivalWindWarning(ground.points.find((point) => dossierArrivalWindWarning(point))!)}`, { bold: true });

  }

  layout.ensure(210);
  layout.heading("Charge et référence constructeur");
  const load = dossier.operations?.load;
  if (!load) layout.paragraph("Charge, limite, marge et courbe : indisponibles.");
  else {
    layout.paragraph(`${dossier.balloon.registration || absent} - ${dossier.balloon.manufacturer || absent} ${dossier.balloon.model || absent}`, { bold: true, size: 12 });
    layout.paragraph(`Disponibilité : ${status(load.status)}. Statut du calcul constructeur : ${status(load.calculationStatus)}.`);
    if (load.message) layout.paragraph(load.message);
    if (dossier.balloon.manufacturer?.toLowerCase().includes("ultramagic") && dossier.balloon.model?.replace(/[^a-z0-9]/gi, "").toUpperCase() === "T150" && load.status !== "AVAILABLE") layout.paragraph("Ultramagic T150 : FM04 reste candidat, non activé dans Prépa. Limite et courbe personnalisée indisponibles.");
    layout.paragraph(`Température au sol utilisée pour la charge : ${number(load.temperature?.temperatureC)} °C | Source : ${load.temperature?.provider || load.temperature?.sourceModel || absent}.`);
    layout.table(["Masse prévue (kg)", "Limite applicable (kg)", "Marge signée (kg)"], [170, 170, WIDTH - 340], [[number(load.plannedMassKg), number(load.applicableLimitKg), load.signedMarginKg || absent]]);
    layout.paragraph("Marge affichée arrondie vers le bas par le moteur existant. Les données de démonstration sont exclues.", { muted: true });
    if (load.result?.status === "AVAILABLE") {
      layout.paragraph(`Règle limitante : ${load.limitingRule || absent}. Dataset : ${load.result.datasetId}. Révision : ${load.result.manualRevision}.`);
      layout.paragraph(`Calcul : ${date(load.result.calculatedAt)} | Altitude maximale : ${number(load.result.maximumAltitudeMslM)} m AMSL | Température sol : ${number(load.result.groundTemperatureC)} °C (${load.result.groundTemperatureSource}).`);
    }
    if (load.manufacturerParameters) layout.paragraph(`Référence : ${load.manufacturerParameters.source.manualId} ; ${load.manufacturerParameters.source.manualRevision} ; pages ${load.manufacturerParameters.source.pages.join(", ")}. Vérification des paramètres : ${status(load.manufacturerParameters.verificationStatus)}.`);
    const curve = load.curve;
    if (load.status === "AVAILABLE" && load.calculationStatus === "OFFICIAL_VALIDATED" && curve.status === "SOURCE_DATA_AVAILABLE" && curve.usedByCalculation && curve.points.length >= 2 && curve.points.every((point) => [point.temperatureC, point.liftUnits, point.altitudeMslFt].every(Number.isFinite))) {
      layout.paragraph(`Courbe source : ${curve.source.title} ; ${curve.source.revision} ; ${curve.source.page}. Statut : ${status(curve.verificationStatus)}.`);
      layout.paragraph(curve.notice);
      layout.paragraph(`Source : ${curve.source.url}`);
      layout.paragraph(`Empreinte source : ${curve.source.sha256}`, { size: 8, muted: true });
      const [xmin, xmax] = curve.axes.temperatureC, [ymin, ymax] = curve.axes.liftUnits;
      if (xmax > xmin && ymax > ymin) {
        layout.ensure(365);
        const x = MARGIN + 40, y = layout.y - 242, width = WIDTH - 60, height = 212;
        layout.page.drawText("Lift Units - points constructeur", { x, y: y + height + 12, size: 9, font: layout.bold, color: INK });
        for (let tick = 0; tick <= 4; tick++) {
          const tx = x + tick * width / 4, ty = y + tick * height / 4;
          layout.page.drawLine({ start: { x: tx, y }, end: { x: tx, y: y + height }, thickness: .35, color: rgb(.83, .87, .89) });
          layout.page.drawLine({ start: { x, y: ty }, end: { x: x + width, y: ty }, thickness: .35, color: rgb(.83, .87, .89) });
          layout.page.drawText(number(xmin + tick * (xmax - xmin) / 4), { x: tx - 10, y: y - 16, size: 8, font: layout.font, color: MUTED });
          layout.page.drawText(number(ymin + tick * (ymax - ymin) / 4), { x: x - 30, y: ty - 3, size: 8, font: layout.font, color: MUTED });
        }
        layout.page.drawText("Température (°C) | Courbes : altitude en ft AMSL", { x, y: y - 33, size: 8, font: layout.font, color: INK });
        const altitudes = [...new Set(curve.points.map((point) => point.altitudeMslFt))].sort((a, b) => a - b);
        altitudes.forEach((altitude, index) => {
          const color = rgb(.12 + (index % 3) * .22, .22 + (index % 5) * .10, .30 + (index % 4) * .16);
          const points = curve.points.filter((point) => point.altitudeMslFt === altitude && point.temperatureC >= xmin && point.temperatureC <= xmax && point.liftUnits >= ymin && point.liftUnits <= ymax).sort((a, b) => a.temperatureC - b.temperatureC);
          for (let i = 1; i < points.length; i++) if (points[i].temperatureC - points[i - 1].temperatureC <= 1.01) layout.page.drawLine({ start: { x: x + (points[i - 1].temperatureC - xmin) / (xmax - xmin) * width, y: y + (points[i - 1].liftUnits - ymin) / (ymax - ymin) * height }, end: { x: x + (points[i].temperatureC - xmin) / (xmax - xmin) * width, y: y + (points[i].liftUnits - ymin) / (ymax - ymin) * height }, thickness: .9, color });
          layout.page.drawText(`${number(altitude, 0)} ft`, { x: MARGIN + index % 3 * (WIDTH / 3), y: y - 52 - Math.floor(index / 3) * 13, size: 8, font: layout.font, color });
        });
        layout.y = y - 65 - Math.ceil(altitudes.length / 3) * 13;
      } else layout.paragraph("Graphique indisponible : axes source non exploitables.");
    } else layout.paragraph(`Graphique indisponible. ${curve.notice}`);
  }

  layout.heading("Espaces traversés et possibles");
  const airspaces = dossier.operations?.airspaces;
  layout.paragraph("Source : OpenAIP. Les fréquences ne sont jamais présentées comme vérifiées AIP.", { bold: true });
  if (!airspaces) layout.paragraph("Espaces aériens : données indisponibles.");
  else {
    airspaces.notices.forEach((notice) => layout.paragraph(notice));
    layout.paragraph(`Traversées confirmées : ${airspaces.confirmed.length}`, { bold: true, size: 12 });
    if (!airspaces.confirmed.length) layout.paragraph("Aucune traversée active confirmée par les données disponibles ; cela ne signifie pas absence d'espaces.");
    airspaces.confirmed.forEach((item) => airspaceSection(layout, item, date));
    layout.paragraph(`Intersections possibles ou activité incertaine : ${airspaces.uncertain.length}`, { bold: true, size: 12 });
    if (!airspaces.uncertain.length) layout.paragraph("Aucun espace identifié dans la couverture disponible. Exhaustivité du trajet non démontrée.");
    airspaces.uncertain.forEach((item) => airspaceSection(layout, item, date));
    if (airspaces.invalidSegments) layout.paragraph(`Segments avec horaires invalides : ${airspaces.invalidSegments}.`);
  }

  layout.heading("Carte - Stratégie sélectionnée", true);
  layout.paragraph(`${dossier.strategyLabel || dossier.traceId} | D : départ / A : arrivée prévue. Nord en haut.`, { size: 9 });
  if ("error" in map) layout.paragraph(`Carte indisponible : ${map.error}`);
  else {
    if (map.timeMarkers?.length) layout.paragraph(`Repères après décollage : ${map.timeMarkers.join(" / ")} min (points source, sans interpolation).`, { size: 8 });
    const image = await document.embedPng(map.png);
    const attribution = map.background === "SATELLITE" ? `Fond satellite 2016 (~10 m) : ${MOROCCO_SATELLITE_ATTRIBUTION} Échelle locale au centre.` : map.background === "OPENSTREETMAP" ? "Fond : © OpenStreetMap contributors. Échelle locale au centre de la carte." : "Fond satellite indisponible : trajectoire et zone de vol conservées. Échelle locale au centre.";
    const attributionHeight = wrapDossierText(attribution, layout.font, 8, WIDTH).length * 10 + 11;
    const availableHeight = layout.y - BOTTOM - Math.max(33, attributionHeight);
    const scale = Math.min(WIDTH / image.width, availableHeight / image.height);
    const width = image.width * scale, height = image.height * scale;
    layout.page.drawImage(image, { x: MARGIN + (WIDTH - width) / 2, y: layout.y - height, width, height });
    layout.y -= height + 8;
    layout.paragraph(attribution, { size: 8, muted: true });
  }
  layout.finish();
  await prependMoroccoPassengerListing(document, reference, input.passengers);
  // The two original checklists have no dossier clock fields; use their blank lower margins.
  for (const page of document.getPages().slice(1, 3)) page.drawText(`Dossier : ${reference.label}`, { x: MARGIN, y: 18, size: 8, font: layout.font, color: MUTED });
  return document.save();
}
