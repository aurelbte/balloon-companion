# Étape 2A — tuiles XYZ locales

Générateur indépendant de toute carte et du système électrique. Aucun nouveau modèle
d'obstacle : `tiles.ts` utilise les types existants de `app/lib/aeronauticalObstacles.ts`.
Entrées exclusives : sorties déjà normalisées et versionnées par `build.mjs`.
Aucun téléchargement, chargement Overpass, upload ou fichier de données dans le dépôt.

## Commandes

Depuis la racine du projet :

```sh
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON prototypes/aeronautical-obstacles/tile-build.mjs --source /tmp/bc-aeronautical-obstacles/preuseville/01a5fb6e2a35dfdf
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON prototypes/aeronautical-obstacles/tile-build.mjs --source /tmp/bc-aeronautical-obstacles/le-havre/2996cb27a760244a
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON prototypes/aeronautical-obstacles/tile-build.mjs --source /tmp/bc-aeronautical-obstacles/grenoble/e05c78161b824d9f
```

Sortie : `/tmp/bc-aeronautical-obstacles/tiles/<zone>/<empreinte-version>/`.
`--output-root` permet une reproduction dans un autre dossier hors Git. Une version
existante est refusée. Les chemins passant par un lien symbolique vers le dépôt ou
vers les données normalisées sont contrôlés. Les erreurs ne publient pas une version partielle :
écriture temporaire, manifeste en dernier, puis renommage du dossier.

Le manifeste d'entrée doit correspondre au schéma multizone existant. Son identité,
les SHA-256 et tailles des sept artefacts normalisés, les comptes et les éditions sources
sont vérifiés avant toute écriture. Une erreur n'entraîne aucune substitution de données.

## Format / provenance

- `tiles/{z}/{x}/{y}.geojson`, accompagnés de leurs `.geojson.gz`.
- `manifest.json` : identité, empreintes/tailles, niveaux, statut vide/données, catégories,
  portée, sources/dates, exclusions, divergences, pertes et limites.
- `coverage.geojson[.gz]` : polygone de sélection et empreinte exacte de chaque tuile indexée.
- `representations.geojson[.gz]` : représentations détaillées avant découpe ; géométries natives conservées.
- `normalized/` : copies identiques des fiches, liens, exclusions, divergences, statistiques,
  géométries sources et manifeste d'entrée. Les fiches complètes et leurs originaux restent accessibles.
- `redistribution.json` : statut explicite `LOCAL_PROTOTYPE_ONLY`.

Tous les artefacts, y compris gzip et copies normalisées, ont une empreinte SHA-256.
Le manifeste porte une empreinte d'identité ; il ne contient pas sa propre empreinte de fichier.
Les gzip sont déterministes (date nulle, OS normalisé). Code, politique et versions Node/V8/zlib
font partie de l'identité ; mêmes entrées/runtime → mêmes versions et mêmes octets, manifeste compris.
Durée réelle de génération et taille totale, manifeste compris, sont retournées par la commande,
hors identité déterministe. `payloadBytes` dans le manifeste exclut uniquement ce manifeste.

Les propriétés des tuiles conservent les identifiants logiques et observations, mesures originales,
AGL/AMSL/datum, dates, état, précision, problèmes et éditions source. Les originaux complets restent
dans `normalized/records.json`. Les liens restent inchangés dans leur copie normalisée.

## Identités, ambiguïtés et types de représentation

`featureClass` distingue `points`, `groups`, `composites`, `components`, `lines`.
Un point SIA de câble reste un point ; sa catégorie et son rôle représentatif restent explicites.
La proximité, une association candidate, un groupement SIA ou une partie de bâtiment ne déclenchent
aucune déduplication physique. Les ambiguïtés et références aux liens restent accessibles.

Seules les observations exactement identiques sont dédupliquées automatiquement. Un lien existant
`possible_same_object` explicitement `confirmed` peut autoriser une représentation commune de fiches
individuelles de même catégorie : toutes leurs mesures/provenances sont conservées. La position SIA
est préférée, puis Géorisques, puis OSM, sans moyenne. Des géométries linéaires confirmées différentes
ou des portées incompatibles provoquent une erreur de revue. Aucun lien de ce type n'est confirmé
dans les trois jeux réels : aucune fusion physique n'y est effectuée.

## Frontières / couverture

Schéma XYZ Web Mercator ; coordonnées GeoJSON conservées en longitude/latitude WGS84 2D.
Un point exactement sur une frontière appartient à la cellule est/sud (pas de buffer).
Les lignes sont découpées aux rectangles des tuiles ; seuls des points d'intersection 2D sont ajoutés,
sans simplification ou profil Z. Les sommets intérieurs natifs restent inchangés.
Les segments exactement sur une frontière ont un propriétaire unique ; les tangences ponctuelles
ne deviennent pas des lignes de longueur nulle. Chaque fragment référence sa représentation et porte
un ID déterministe dépendant du parent, XYZ et de sa géométrie découpée.

Le cercle de sélection est représenté par un polygone sphérique de 256 sommets, avec rayon/centre
et erreur nominale de corde déclarés. Les cellules à intersection d'aire positive sont explicitement
écrites, même vides. Les cellules additionnelles nécessaires aux géométries natives disponibles restent
indexées : pas de tronquage silencieux à la zone d'étude. Les frontières des tuiles ne sont pas
des limites d'exhaustivité des sources. Une extension native ne prouve aucune couverture autour d'elle.

Hors index = non couvert, jamais implicitement vide. Tuile vide = aucune fiche de ce jeu pour ce filtre,
jamais absence garantie d'obstacle. `study_full`, `study_partial`, `native_data_extension` décrivent
la sélection/charge utile, pas une couverture de sécurité. Le générateur refuse toute perte
d'identifiant d'observation à l'un des deux niveaux.

## Niveaux de détail

- Vue jusqu'au zoom 10 : source z9 ; regroupements cartographiques sur grille z11, séparés par
  catégorie, portée et statut physique. Ancrage sur un membre réel, explicitement non assimilable
  à une nouvelle position d'obstacle. Les membres et nombres de hauteurs inconnues restent présents.
- Vue dès le zoom 11 : source z12 avec surzoom, toutes les fiches détaillées.
- Les tracés sont conservés aux deux niveaux sans simplification. Les nombres de fragments
  ne sont pas des nombres d'obstacles. Les agrégats comptent des fiches sources, pas des objets physiques.

Aucun seuil de hauteur, AMSL ou statut ne supprime une fiche. Les regroupements sont une stratégie
de lisibilité, sans valeur de seuil de sécurité. L'ensemble reste consultable via les références.

## Droits de redistribution — vérification du 15/11/2026

- [OSM](https://www.openstreetmap.org/copyright) : ODbL, attribution et obligations applicables aux bases
  dérivées. Le traitement juridique de la base combinée reste à valider avant redistribution.
- [Géorisques](https://www.georisques.gouv.fr/cgu) : Licence Ouverte 2.0 pour les données publiques
  téléchargées, paternité/date et vérification des éventuels droits de tiers propres au jeu.
- [SIA](https://www.sia.aviation-civile.gouv.fr/informationslegales) : réutilisation des informations
  publiques sous conditions d'intégrité, de sens, de source/date ; vérifier l'application à ce produit
  transformé et combiné, notamment regroupements et découpe, ainsi que les droits de tiers.

L'accès aux fichiers publics ne valide pas à lui seul la redistribution du produit. Le générateur
inscrit toujours `publicRedistributionValidated: false`. Aucune publication publique n'est proposée.

## Vérifications / limites

```sh
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test app/lib/aeronauticalObstacles.test.mjs prototypes/aeronautical-obstacles/*.test.mjs
npm run typecheck
git diff --check
```

Tests ciblés : déterminisme/ordre des entrées, frontières/longueurs, points/lignes/groupes/composants,
identités confirmées et candidates, inconnus/références verticales, géométries réelles du Havre/Grenoble,
empreintes/gzip, vides/couverture et refus des entrées altérées/écrasements.

Limites héritées : centroïdes de certains ouvrages, sélection initiale de câbles par centroïde,
sources non exhaustives et pas de profil vertical complet, contrôle terrain ou NOTAM.
Les mesures de durée concernent ces petits jeux locaux ; elles ne valident pas un déploiement national.
Avant R2 : validation des droits, emprises et identités, qualité/fraîcheur, budget de charge utile
et niveaux de détail nationaux, puis tests d'un futur chargeur. Aucun cache hors ligne ou rendu MapLibre
n'est implémenté ici. Le système électrique reste inchangé.
