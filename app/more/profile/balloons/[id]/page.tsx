"use client";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useBalloonRegistry } from "../../../../hooks/useBalloons";
import { balloonDisplayName, calculateBalloonEmptyWeight } from "../../../../lib/balloons";
import { deleteBalloon, setActiveBalloon } from "../../../../lib/balloonStorage";
import styles from "../../../More.module.css";

export default function BalloonDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const registry = useBalloonRegistry();
  const balloon = registry.balloons.find((item) => item.id === decodeURIComponent(id));
  if (!balloon) return <main className={styles.screen}><div className={styles.layout}><Link href="/more/profile/balloons" className={styles.back}><ChevronLeft size={18} /> Mes ballons</Link><p className={styles.subtitle}>Ballon introuvable.</p></div></main>;
  const total = calculateBalloonEmptyWeight(balloon);
  const cylinderWeight = balloon.weights.fullCylinders.reduce((sum, item) => sum + item.fullWeightKg, 0);
  const info = [["Immatriculation", balloon.registration], ["Fabricant", balloon.manufacturer], ["Modèle / type", balloon.model], ["Catégorie", balloon.category], ["Couleur", balloon.color || "Non renseignée"]];
  return <main className={styles.screen}><div className={styles.layout}>
    <Link href="/more/profile/balloons" className={styles.back}><ChevronLeft size={18} /> Mes ballons</Link>
    <header><p className={styles.eyebrow}>{balloon.registration}</p><h1 className={styles.title}>{balloon.manufacturer} {balloon.model}</h1></header>
    <section className={styles.detailSection}><h2>Identité</h2>
      {info.map(([label, value]) => <p key={label}><span>{label}</span><strong>{value}</strong></p>)}
      <p><span>Volume</span><strong>{balloon.volumeM3.toLocaleString("fr-FR")} m³</strong></p>
      <p><span>MTOM applicable</span><strong>{balloon.applicableMtowKg === undefined ? "—" : `${balloon.applicableMtowKg.toLocaleString("fr-FR")} kg`}</strong></p>
      <p><span>Limites vérifiées avec le manuel de vol</span><strong>{balloon.configurationLimitsConfirmed ? "Oui" : "Non"}</strong></p>
      {!balloon.configurationLimitsConfirmed && <small className={styles.incompleteHint}>Modifiez la fiche pour confirmer volontairement la MTOM et la configuration.</small>}
    </section>
    <section className={styles.detailSection}><h2>Masses</h2>
      <p><span>Enveloppe</span><strong>{balloon.weights.envelopeKg === undefined ? "—" : `${balloon.weights.envelopeKg} kg`}</strong></p>
      <p><span>Brûleur</span><strong>{balloon.weights.burnerKg === undefined ? "—" : `${balloon.weights.burnerKg} kg`}</strong></p>
      <p><span>Nacelle</span><strong>{balloon.weights.basketKg === undefined ? "—" : `${balloon.weights.basketKg} kg`}</strong></p>
      <p><span>Cylindres</span><strong>{balloon.weights.fullCylinders.length} unité{balloon.weights.fullCylinders.length > 1 ? "s" : ""} · {cylinderWeight.toLocaleString("fr-FR")} kg</strong></p>
      <div className={styles.detailTotal}><span>Poids total</span><strong>{total === null ? "— kg" : `${total.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} kg`}</strong></div>
      {total === null && <small className={styles.incompleteHint}>Informations de masse incomplètes</small>}
    </section>
    <section className={styles.detailSection}><h2>Documents</h2><p><span>Dossier documentaire</span><strong>Prochainement</strong></p><small className={styles.incompleteHint}>Aucun document n’est enregistré dans cette version.</small></section>
    <section className={styles.detailSection}><h2>Utilisation dans l’application</h2>
      {registry.activeBalloonId === balloon.id ? <p><strong>Ballon actif</strong></p> : <button type="button" onClick={() => setActiveBalloon(balloon.id)}>Définir comme ballon actif</button>}
      <Link className={styles.modify} href={`/more/profile/balloons/${encodeURIComponent(balloon.id)}/edit`}>Modifier le ballon</Link>
      <button className={styles.dangerAction} type="button" onClick={() => { if (!window.confirm(`Supprimer ce ballon ?\n\nLe ballon ${balloonDisplayName(balloon)} sera retiré de votre profil.`)) return; if (balloon.documents.length > 0 && !window.confirm(`Supprimer aussi les références de ${balloon.documents.length} document${balloon.documents.length > 1 ? "s" : ""} lié${balloon.documents.length > 1 ? "s" : ""} à ce ballon ?\n\nCette confirmation est distincte de la suppression du ballon.`)) return; deleteBalloon(balloon.id); router.push("/more/profile/balloons"); }}>Supprimer le ballon</button>
    </section>
  </div></main>;
}
