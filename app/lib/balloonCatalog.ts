export type BalloonCatalogModel = { model: string; volumeM3: number };
export type BalloonCatalogManufacturer = {
  manufacturer: string;
  models: readonly BalloonCatalogModel[];
  source: { label: string; url: string };
};

const ultramagicModels: readonly BalloonCatalogModel[] = [
  { model: "H31", volumeM3: 900 },
  { model: "H42", volumeM3: 1_200 },
  { model: "H56", volumeM3: 1_590 },
  { model: "H65", volumeM3: 1_840 },
  { model: "H77", volumeM3: 2_190 },
  { model: "S90", volumeM3: 2_550 },
  { model: "S105", volumeM3: 2_950 },
  { model: "S130", volumeM3: 3_680 },
  { model: "S160", volumeM3: 4_550 },
  { model: "V25", volumeM3: 708 },
  { model: "V56", volumeM3: 1_650 },
  { model: "V65", volumeM3: 1_840 },
  { model: "V77", volumeM3: 2_190 },
  { model: "V90", volumeM3: 2_550 },
  { model: "V105", volumeM3: 2_950 },
  { model: "M42", volumeM3: 1_200 },
  { model: "M56", volumeM3: 1_590 },
  { model: "M56C", volumeM3: 1_590 },
  { model: "M65", volumeM3: 1_840 },
  { model: "M65C", volumeM3: 1_840 },
  { model: "M77", volumeM3: 2_200 },
  { model: "M77C", volumeM3: 2_200 },
  { model: "M90", volumeM3: 2_550 },
  { model: "M105", volumeM3: 2_950 },
  { model: "M120", volumeM3: 3_400 },
  { model: "M130", volumeM3: 3_680 },
  { model: "M145", volumeM3: 4_105 },
  { model: "M160", volumeM3: 4_550 },
  { model: "M56Z", volumeM3: 1_590 },
  { model: "M60Z", volumeM3: 1_700 },
  { model: "M65Z", volumeM3: 1_840 },
  { model: "M70Z", volumeM3: 1_980 },
  { model: "M74Z", volumeM3: 2_100 },
  { model: "N180", volumeM3: 5_100 },
  { model: "N210", volumeM3: 6_000 },
  { model: "N250", volumeM3: 7_000 },
  { model: "N300", volumeM3: 8_500 },
  { model: "N355", volumeM3: 10_000 },
  { model: "N370", volumeM3: 10_480 },
  { model: "N390", volumeM3: 11_045 },
  { model: "N415", volumeM3: 11_750 },
  { model: "N425", volumeM3: 12_000 },
  { model: "N450", volumeM3: 12_750 },
  { model: "N500", volumeM3: 14_415 },
  { model: "N550", volumeM3: 15_574 },
  { model: "Z90", volumeM3: 2_550 },
  { model: "G90", volumeM3: 2_550 },
  { model: "T150", volumeM3: 4_245 },
  { model: "T180", volumeM3: 5_100 },
  { model: "T210", volumeM3: 6_000 },
];

const kubicekModels: readonly BalloonCatalogModel[] = [
  { model: "BB9E", volumeM3: 900 },
  { model: "BB12E", volumeM3: 1_200 },
  { model: "BB16E", volumeM3: 1_600 },
  { model: "BB18E", volumeM3: 1_800 },
  { model: "BB20E", volumeM3: 2_000 },
  { model: "BB22E", volumeM3: 2_200 },
  { model: "BB26E", volumeM3: 2_600 },
  { model: "BB30E", volumeM3: 3_000 },
  { model: "BB34E", volumeM3: 3_400 },
  { model: "BB20ED", volumeM3: 2_000 },
  { model: "BB22ED", volumeM3: 2_200 },
  { model: "BB26ED", volumeM3: 2_600 },
  { model: "BB30ED", volumeM3: 3_000 },
  { model: "BB34ED", volumeM3: 3_400 },
  { model: "BB9EF", volumeM3: 900 },
  { model: "BB12EF", volumeM3: 1_200 },
  { model: "BB16EF", volumeM3: 1_600 },
  { model: "BB22M", volumeM3: 2_200 },
  { model: "BB26M", volumeM3: 2_600 },
  { model: "BB30M", volumeM3: 3_000 },
  { model: "BB22Z", volumeM3: 2_200 },
  { model: "BB26Z", volumeM3: 2_600 },
  { model: "BB30Z", volumeM3: 3_000 },
  { model: "BB34Z", volumeM3: 3_400 },
  { model: "BB37Z", volumeM3: 3_700 },
  { model: "BB40Z", volumeM3: 3_990 },
  { model: "BB42Z", volumeM3: 4_200 },
  { model: "BB45Z", volumeM3: 4_500 },
  { model: "BB51Z", volumeM3: 5_100 },
  { model: "BB60Z", volumeM3: 6_000 },
  { model: "BB64Z", volumeM3: 6_400 },
  { model: "BB70Z", volumeM3: 7_000 },
  { model: "BB78Z", volumeM3: 7_800 },
  { model: "BB85Z", volumeM3: 8_500 },
  { model: "BB92Z", volumeM3: 9_200 },
  { model: "BB100Z", volumeM3: 10_000 },
  { model: "BB22D", volumeM3: 2_200 },
  { model: "BB26D", volumeM3: 2_600 },
  { model: "BB30D", volumeM3: 3_000 },
  { model: "BB34D", volumeM3: 3_400 },
  { model: "BB40D", volumeM3: 3_990 },
  { model: "BB105P", volumeM3: 10_500 },
  { model: "BB106P", volumeM3: 10_600 },
  { model: "BB113P", volumeM3: 11_300 },
  { model: "BB120P", volumeM3: 12_000 },
  { model: "BB130P", volumeM3: 13_000 },
  { model: "BB142P", volumeM3: 14_200 },
  { model: "BB150P", volumeM3: 15_000 },
  { model: "BB184P", volumeM3: 18_500 },
  { model: "BB14XR", volumeM3: 1_450 },
  { model: "BB16XR", volumeM3: 1_600 },
  { model: "BB17XR", volumeM3: 1_700 },
  { model: "BB18XR", volumeM3: 1_800 },
  { model: "BB20XR", volumeM3: 2_000 },
  { model: "BB22XR", volumeM3: 2_200 },
  { model: "BB26XR", volumeM3: 2_600 },
  { model: "BB30XR", volumeM3: 3_000 },
];

export const BALLOON_CATALOG: readonly BalloonCatalogManufacturer[] = [
  {
    manufacturer: "Cameron",
    models: [
      { model: "Z90", volumeM3: 2_549 },
      { model: "Z105", volumeM3: 2_973 },
      { model: "Z120", volumeM3: 3_398 },
      { model: "Z133", volumeM3: 3_766 },
      { model: "Z150", volumeM3: 4_247 },
      { model: "Z160", volumeM3: 4_531 },
      { model: "Z180", volumeM3: 5_097 },
      { model: "Z210", volumeM3: 5_947 },
      { model: "Z250", volumeM3: 7_079 },
      { model: "Z300", volumeM3: 8_495 },
      { model: "Z350", volumeM3: 9_911 },
      { model: "Z425", volumeM3: 12_035 },
    ],
    source: {
      label: "Cameron Balloons — gamme Z-Type constructeur",
      url: "https://www.cameronballoons.co.uk/z-type",
    },
  },
  {
    manufacturer: "Kubíček",
    models: kubicekModels,
    source: {
      label: "Kubíček Balloons — fiches graphiques constructeur",
      url: "https://www.kubicekballoons.cz/graficke-karty/",
    },
  },
  {
    manufacturer: "Ultramagic",
    models: ultramagicModels,
    source: {
      label: "Ultramagic Hot Air Balloon Flight Manual FM04",
      url: "https://ultramagic.com/openfiles/Manuals04/MV04ar30.pdf",
    },
  },
] as const;

export function catalogManufacturers(): readonly string[] {
  return BALLOON_CATALOG.map(({ manufacturer }) => manufacturer);
}

export function catalogModels(manufacturer: string): readonly BalloonCatalogModel[] {
  return BALLOON_CATALOG.find((item) => item.manufacturer === manufacturer)?.models ?? [];
}

export function catalogVolume(manufacturer: string, model: string): number | null {
  return catalogModels(manufacturer).find((item) => item.model === model)?.volumeM3 ?? null;
}
