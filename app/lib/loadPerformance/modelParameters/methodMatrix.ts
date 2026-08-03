export const officialLoadMethodMatrix = Object.freeze([
  {
    manufacturer: "Cameron",
    methodId: "CAMERON_METHOD_A2",
    coveredFamilies: ["Enveloppes couvertes par le manuel HABFM de base et sa table d'applicabilité"],
    modelParameters: ["modèle exact", "taille", "volume officiel"],
    aircraftLimits: ["MTOM ou MTOM réduite", "masse équipée réelle", "compatibilité enveloppe/nacelle/brûleur"],
    exceptions: ["suppléments prioritaires", "formes spéciales", "anciens manuels non couverts"],
    sourcePages: ["2-3", "2-6", "2-7", "5-1 à 5-4", "8-1", "8-2", "9-1 à 9-3", "A2-1"],
  },
  {
    manufacturer: "Kubíček",
    methodId: "KUBICEK_B3102_LIFT_UNITS_TABLE",
    coveredFamilies: ["Enveloppes naturelles BB couvertes par B.3102"],
    modelParameters: ["modèle exact", "ligne de Loading Table", "volume si requis par la ligne"],
    aircraftLimits: ["MTOW/RMTOW", "capacité nacelle", "compatibilité cadre/brûleur", "limite de température de l'enveloppe"],
    exceptions: ["BB-S et autres formes spéciales avec supplément"],
    sourcePages: ["2-4", "2-5", "2-10", "5-1 à 5-5", "6-1"],
  },
  {
    manufacturer: "Ultramagic",
    methodId: "ULTRAMAGIC_FM04_LIFT_PER_1000FT3",
    coveredFamilies: ["Enveloppes normales couvertes par FM04"],
    modelParameters: ["modèle/variante exact", "volume officiel", "identité de la ligne MTOM"],
    aircraftLimits: ["MTOM de variante", "masse équipée réelle", "charge nacelle", "Build Standard et suppléments"],
    exceptions: ["formes spéciales", "équipements d'autres fabricants selon supplément 19", "suppléments prioritaires"],
    sourcePages: ["2.4", "5.3 à 5.5", "5.8", "5.9", "8.1", "9.1"],
  },
] as const);
