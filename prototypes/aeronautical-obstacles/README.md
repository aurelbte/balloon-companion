# Obstacles aéronautiques — Preuseville, Le Havre, Grenoble

Prototype local hors application. Aucun branchement cartographique, téléchargement réseau,
génération de tuiles ou publication. Le modèle est dans `app/lib/aeronauticalObstacles.ts` ;
il n'importe aucun module de l'ancienne couche obstacles ou de la couche électrique.
Un seul normaliseur (`normalize.ts`) et un seul pipeline (`build.mjs`) traitent les trois zones.
`preuseville.mjs` est un point d'entrée de compatibilité vers ce même pipeline.

## Exécution

Depuis la racine du projet, avec la version Node utilisée pour les tests BC :

```sh
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON prototypes/aeronautical-obstacles/build.mjs --zone preuseville
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON prototypes/aeronautical-obstacles/build.mjs --zone le-havre
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON prototypes/aeronautical-obstacles/build.mjs --zone grenoble
```

Entrée par défaut : `/tmp/bc-obstacles-study/`. Sortie par défaut, hors Git :
`/tmp/bc-aeronautical-obstacles/<zone>/<empreinte-version>/`.
Options : `--study <dossier>` et `--output <nouveau-dossier-hors-projet>`.
Une sortie existante est refusée. Les sources manquantes ou les empreintes incorrectes
provoquent une erreur explicite ; aucune source actuelle n'est substituée.

Les SHA-256 des originaux XLSX/CSV/PBF sont vérifiés contre les inventaires conservés.
L'étude initiale Preuseville attestait aussi les empreintes des JSON locaux. Pour Le Havre/Grenoble,
ces empreintes n'étaient pas dans les inventaires antérieurs : elles sont capturées maintenant,
ce qui est explicitement déclaré dans `identity.inputs`. Les scripts d'extraction sont référencés
par empreinte ; ni extraction ni projection EPSG:2154 ne sont réexécutées.
Le cercle Preuseville est de 15 km, centre WGS84 `[1.5047, 49.8804]`. Les autres paramètres
proviennent des `study-config.json` réels : Le Havre 15 km, Grenoble 20 km.
Les lignes sont sélectionnées par distance 2D à la trace, sans découpe ni remplacement par leur centroïde.

## Sorties et sémantique

- `records.json` : chaque observation normalisée, sa fiche originale complète et les
  références aux éditions source. ID logique qualifié par source ; ID d'observation
  fondé sur son contenu. Aucun numéro séquentiel géographique.
- `links.json` : graphe de candidats, alternatives, variantes et écarts de hauteur.
  Aucune fusion, aucun rapprochement confirmé automatiquement, aucun total d'objets
  physiques déduit. Proximité jusqu'à 150 m entre sources, ou 20 m dans une source,
  uniquement pour proposer une revue ; catégories incompatibles marquées comme telles.
- `excluded.json` : supports électriques OSM ordinaires et catégories non retenues,
  avec fiches originales. Les « Pylône » SIA restent dans l'inventaire.
- `outside.json` : fiches éventuellement hors cercle ; pas d'exclusion silencieuse.
- `divergences.json` : liens dont les dimensions (>5 m) ou statuts physiques diffèrent ;
  pas nécessairement des contradictions AGL démontrées.
- `statistics.json` : comptes par source, catégorie/type, statut, portée et manques.
  `physicalObjectCount` reste `null` : pas de total d'obstacles physiques déduit.
- `obstacles.geojson` : représentation de chaque observation, sans fusion ni altitude Z ;
  détails dans `records.json`. Usage local uniquement.
- `manifest.json` : sources, dates réelles, méthodes, empreintes, bilan et limites.

Mêmes entrées et même code → même version et mêmes octets pour les artefacts.
L'horodatage réel `generatedAtUtc` du manifeste reste distinct de cette identité reproductible.
Les anciennes versions ne sont pas écrasées.

Les mètres sont une conversion d'unité, pas une mesure supplémentaire. AGL et sommet
AMSL restent séparés ; datum inconnu = `null`. Aucune addition `ele/NGF + height`,
soustraction terrain ou référence verticale implicite. Les dimensions OSM restent
`UNKNOWN` tant que leur référence n'est pas attestée. Les écarts >5 m sont un signal
de revue, jamais une tolérance réglementaire ou une preuve d'erreur de source.

Géorisques : exploitation → existant déclaré ; construction → en construction ;
attente de construction → projet ; instruction sans état physique → inconnu.
Ces états proviennent du parc et ne prouvent pas une vérification terrain de chaque turbine.
Publication SIA ou présence OSM seules → état physique inconnu. Désaffecté ne signifie
pas démoli. Mobilité et permanence sont indépendantes ; dates sans fuseau conservées brutes.

Les géométries linéaires natives sont acceptées par le normaliseur OSM ; leur profil
vertical reste inconnu. Un point SIA de câble reste un point. Grenoble apporte 62 tracés réels
et deux points SIA. Leur proximité point–segment peut produire `possible_representation`,
toujours ambiguë, sans identité ni comparaison verticale point/ligne. Les supports restent distincts.
`recordScope` distingue fiche simple, groupement, composite et composant : un point SIA décrivant
deux cheminées ne crée pas une troisième cheminée. Aucun `siteId` n'est inventé.
Les centroïdes de l'ancienne extraction OSM sont signalés comme approximatifs.
Les doublons de recouvrement déjà éliminés par l'étude ne peuvent pas être reconstitués.
Les variantes nouvelles d'un même identifiant sont conservées ; seules les observations
strictement identiques sont dédupliquées, avec union de leurs références d'édition.

## Tests ciblés

```sh
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test app/lib/aeronauticalObstacles.test.mjs prototypes/aeronautical-obstacles/*.test.mjs
npm run typecheck
git diff --check
```

Les fixtures synthétiques initiales restent séparées des sorties réelles.
`fixtures/le-havre.json` et `fixtures/grenoble.json` contiennent des sous-ensembles réels
inchangés des fiches, avec provenance/empreintes (© OpenStreetMap contributors / Geofabrik,
ODbL-1.0 ; SIA/DGAC). Ils permettent de rejouer les tests sans les gros fichiers `/tmp`.
La génération locale sert de vérification d'intégration avec les sources de l'étude.

## Limites / suite

Inventaire non exhaustif, ni base certifiée ni outil de calcul de franchissement.
Les sources ne sont pas indépendantes : citations OSM et données brutes restent accessibles.
Pas de nouvelle vérification de fraîcheur, NOTAM ou terrain. Vérifier les droits de
redistribution du produit fusionné avant toute publication ; conserver attribution OSM/ODbL,
Géorisques et SIA. Les variantes de statut/hauteur exigent une revue humaine.

La validation des trois zones et les adaptations du modèle sont décrites dans `VALIDATION.md`.
Avant tuilage : réextraire les emprises natives manquantes et les routes sélectionnées par intersection,
valider les associations et relations de composants, puis définir frontières de tuiles, niveaux de détail,
fraîcheur et contrôles de publication. Les études initiales sélectionnaient les routes par centroïde :
des routes traversantes dont le centroïde est extérieur peuvent manquer.
