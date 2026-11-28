# Obstacles aéronautiques — prérequis 3B, 28 novembre 2026

## Verdict

Trois jeux **réels français locaux**, normalisés et tuilés, sont prêts pour revue. Aucune publication, aucune écriture R2 et aucune intégration cartographique effectuées. Les anciennes études absentes ont été reconstruites par de nouvelles acquisitions : cela ne restaure pas leurs octets ni leurs éventuelles vérifications terrain.

La publication reste bloquée par la revue de redistribution du produit combiné, la validation opérateur et l'absence de configuration R2 authentifiée dans cet environnement. Le contrôle terrain physique reste **NON EFFECTUÉ**. L'export national Géorisques complet n'a pas pu être obtenu ; seules les réponses bornées des études ont été validées.

## Sources officielles, dates et licences

### SIA — France

Découverte depuis le plan du site officiel, puis l'eAIP en vigueur : [eAIP 26 novembre 2026](https://www.sia.aviation-civile.gouv.fr/documents/htmlshow?f=dvd/eAIP_26_NOV_2026/FRANCE/home.html). Le fichier [ObstaclesDataZone1MFRANCE_20261126.xlsx](https://www.sia.aviation-civile.gouv.fr/media/dvd/eAIP_26_NOV_2026/FRANCE/ObstaclesDataZone1MFRANCE_20261126.xlsx) contient **13 480 fiches** dans la feuille Data, 1 668 977 octets. SHA-256 : `45dda18cf27010289674e6eb9342c7bdbf170e1acac5e0fd90cd69e32ee1061a`.

Édition AIRAC applicable du 26/11 au 23/12/2026 ; acquisition terminée le **27/11/2026 à 11:43:30.748165 UTC**. La feuille de génération indique séparément **28/09/2026 13:19**, sans fuseau attesté : ce n'est ni une observation terrain récente ni un horodatage UTC inventé. Le classeur national est complet comme téléchargement, pas comme inventaire exhaustif des dangers.

La [licence de réutilisation SIA](https://www.sia.aviation-civile.gouv.fr/produits-numeriques-en-libre-disposition.html) autorise adaptation, redistribution et usage commercial avec ses conditions, notamment source/date, intégrité du sens et absence d'approbation implicite. Les preuves HTML et métadonnées sont conservées dans `acquisition/`. Aucune acquisition NOTAM ou inventaire exhaustif des obstacles temporaires.

### Géorisques — France

[Base Éolien terrestre officielle](https://www.georisques.gouv.fr/donnees/bases-de-donnees/eolien-terrestre), livraison réelle découverte par le service national de formats, puis WFS `eolienne_wfs`. Les [CGU Géorisques](https://www.georisques.gouv.fr/cgu) indiquent la Licence Ouverte 2.0, sous réserve des droits tiers : conserver attribution et date.

**Anomalie du fournisseur constatée** : l'export CSV national renvoie 500 lignes seulement, tandis que les hits annoncent 13 646 puis 13 639 fiches le 27/11 et 13 649 le 28/11. COUNT et STARTINDEX ne donnent pas un export complet ; les pages répètent les mêmes identifiants. Une tentative FILTER reçoit 403 : arrêt, aucun contournement. Les réponses sont conservées et rejetées comme export national.

Les requêtes BBOX ordinaires encadrant les trois cercles sont exploitables : Preuseville **176 fiches dans la boîte, 122 dans le cercle** ; Le Havre et Grenoble **zéro confirmé** par réponses GML numberMatched/numberReturned=0, et non par assimilation d'une erreur à zéro. Les CSV d'erreur des zones vides ont été rejetés. Acquisition locale le **28/11/2026** ; chaque réponse conserve son UTC exact et son SHA. Le CSV assemblé de 176 fiches n'est explicitement **pas national**. Dernière date_maj locale : 17/11/2026 10:03:35.495652, fuseau source inconnu.

Coordonnées attributaires EPSG:2154 reprojetées horizontalement vers WGS84 ; aucune conversion verticale. `cote_ngf` n'est pas assimilée à une altitude sommet. Les dates non zonées restent non zonées.

### OSM / Geofabrik — France

[Extraits France Geofabrik](https://download.geofabrik.de/europe/france/index.html), [modalités](https://www.geofabrik.de/data/download.html). Extraits régionaux PBF complets Haute-Normandie, Picardie, Basse-Normandie et Rhône-Alpes : **920 368 846 octets** au total ; MD5 fournisseur et SHA-256 contrôlés. URLs finales datées, polygones et métadonnées de téléchargement conservés. Snapshot des quatre : **26/11/2026 21:21:01 UTC**, acquisitions le 27/11.

[OSM copyright](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) : attribution et obligations de redistribution de base dérivée à respecter. Le téléchargement est permis ; la diffusion du paquet combiné nécessite une décision explicite sur licence, accès à la base dérivée et notices. Ne pas confondre cela avec une obligation automatique d'ouvrir le code de l'application.

Les catégories explicites sont conservées même sans hauteur. Pour les structures génériques seulement, le seuil de sélection source est 50 m déclarés : **ce n'est pas un seuil de sécurité**. Les supports électriques ordinaires et terrains naturels restent dans le registre d'exclusion, les obstacles SIA ambigus sont conservés. Les tracés natifs sont sélectionnés par intersection réelle ; aucun tracé ni profil vertical n'est déduit d'un point. Les surfaces utilisent un point représentatif explicite et conservent leur contour source. Les bâtiments de station ne deviennent pas des câbles.

## Bilan par pays et zone

France seulement : sources nationales SIA/Géorisques étudiées, extraits OSM régionaux et **trois couvertures de tuiles locales**, aucune couverture nationale obstacles produite. Belgique, Maroc et Royaume-Uni : aucun jeu obstacles retenu/acquis dans ces études ; couverture, licence et nombres **non établis**, pas zéro. Les jeux THT de ces pays ne sont pas des jeux d'obstacles aéronautiques.

Les nombres ci-dessous sont des **observations sources**, pas des obstacles physiques uniques. Les candidats et ambiguïtés ne sont jamais fusionnés automatiquement.

| Zone | SIA / Géorisques / OSM | Observations | Tuiles z9+z12 | Objets immuables | Volume octets |
|---|---:|---:|---:|---:|---:|
| preuseville | 100 / 122 / 157 | 379 | 33 (8 vides) | 80 | 7,130,059 |
| le-havre | 8 / 0 / 619 | 627 | 33 (16 vides) | 80 | 10,008,139 |
| grenoble | 6 / 0 / 825 | 831 | 44 (8 vides) | 102 | 55,943,825 |

Volume comprenant manifestes, registres normalisés/sources, GeoJSON et gzip ; les deux encodages sont comptés. Les trois active.json éventuels ne sont pas inclus. Aucun jeu synthétique dans ces sorties ; les fixtures synthétiques restent limitées aux tests unitaires.

- **preuseville** : `/tmp/bc-aeronautical-obstacles/tiles/preuseville/641ea3437d1d6d7d` ; SHA-256 du manifeste `845fcc371d824e0a5c0f3ff29530dc91c6e16f1d1724d5802b6dcbbbb1d29ed7`.
- **le-havre** : `/tmp/bc-aeronautical-obstacles/tiles/le-havre/a9364cd89d457862` ; SHA-256 du manifeste `e39668dfdf4d42c15e63542c796c338bcee7887c6d96fab3dc0baa159e04091c`.
- **grenoble** : `/tmp/bc-aeronautical-obstacles/tiles/grenoble/683bceebc27d57bb` ; SHA-256 du manifeste `b86e10cfe019f9d92b2669c8a3b97de427c52471afbb03b0657a5a9c9cb78567`.

Le Havre : l'union des emprises régionales couvre **77,47 % du cercle**, les 22,53 % restants surtout maritimes ne sont pas acquis et ne sont jamais réputés sûrs. Preuseville/Grenoble : emprises régionales couvrant les cercles, sans garantie d'exhaustivité des objets.

Preuseville : 294 observations éoliennes ; Géorisques distingue 79 existantes, 23 projets, 11 constructions et 9 inconnues. 269 liens à revoir, dont 7 ambigus ; 15 revues comparables AGL et 22 autres revues dimensionnelles. Le Havre : 13 grues sans hauteur conservées, 1 tracé natif. Grenoble : 86 tracés OSM et 2 points SIA de câbles conservés séparément, 319 supports ; profils verticaux incomplets. Une relation bâtiment sans géométrie résolue reste exclue pour revue, sans point inventé ; une relation de randonnée est exclue comme contexte terrain. Les hauteurs AGL, sommets AMSL et datum restent séparés et inconnus si nécessaire.

## Études et reproductibilité hors Git

Racine : `/tmp/bc-obstacles-study/` : originaux, métadonnées HTTP/SHA, scripts d'extraction, inventaires par zone. Les scripts sont empreintés dans l'identité des normalisations. Environnement Python temporaire uniquement, aucune nouvelle dépendance de l'application.

Rapports : `/tmp/bc-obstacles-study/reports/{zone}-rapport.md`, CSV et GeoJSON comparatifs, `real-builds.json`, `runtime-real-verification.json`, dry-runs et logs. `preuseville-controles-terrain.csv` : 269 liens réels à vérifier, toutes les visites **NON_EFFECTUE**, preuves/mesures non renseignées. Priorité terrain : divergences AGL, projets/constructions, rapprochements ambigus et pylônes SIA. Aucun accès physique au terrain ni validation aéronautique ne peut être prétendu ici.

Les originaux permettent de reproduire les nouvelles études. Ne pas remplacer silencieusement les sources par un nouveau téléchargement si une reproduction binaire est souhaitée ; les hashes des scripts d'acquisition participent aussi à la version.

## Adaptations de code strictement nécessaires

- `prototypes/aeronautical-obstacles/build.mjs` : source SIA configurable et validation date/nom/édition, garde le contrat historique par défaut ; horodatages réels de fin de récupération, scripts d'extraction empreintés, limites d'acquisition explicites et relations sans géométrie conservées en exclusions.
- `prototypes/aeronautical-obstacles/study-sources.test.mjs` : deux tests ciblés sur édition, chemins, dates, provenance et relations non résolues.
- Ce rapport.

**Aucune divergence/modification du contrat filaire 2A/2B** : schémas, niveaux z9/z12, identifiants, manifestes et lecteurs inchangés. Publication 3A inchangée, protections de redistribution maintenues. Aucune modification THT, carte, PDF, Supabase, Cloud Sync ou service worker.

## Validation et R2

**64 tests ciblés réussis**, incluant modèle/normalisation, générateur 2A, runtime 2B et publication 3A : intégrité, gzip, frontières, erreurs, cache, réponses obsolètes, publication incomplète et retour arrière simulés localement. TypeScript et `git diff --check` vérifiés en fin de chantier. Les parseurs 2B et le plan 3A vérifient réellement chaque fichier des trois sorties. Un Fetch adossé aux fichiers réels charge les deux niveaux sans perte d'observations ; statut PARTIAL et exhaustive=false conservés. Aucun test réel de publication/rollback distant.

Dry-runs CLI réels réussis, aucune résolution de credentials ni réseau dans ce mode :

```sh
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/publish-aeronautical-obstacles-r2.mjs --source /tmp/bc-aeronautical-obstacles/tiles/preuseville/641ea3437d1d6d7d --dry-run
```

Même commande sur les dossiers Le Havre/Grenoble ci-dessus. Résultat : intégrité locale valide, **LOCAL_PROTOTYPE_ONLY**, **EXTERNAL_REDISTRIBUTION_REVIEW_REQUIRED**, donc aucune autorisation de publication déduite du succès du dry-run.

Contrôle public **lecture seule le 28/11/2026 à 09:57 UTC** sur `https://pub-2e6fdd961e8345a0984d4bdc2af49aa3.r2.dev` : manifeste THT belge existant HTTP200/application-json/cache immuable, CORS correct pour les deux origines BC ; `aeronautical-obstacles/preuseville/active.json` HTTP404 avec CORS correct. Cela ne vérifie ni les droits S3 ni la présence d'autres versions obstacles.

Configuration/credentials R2 absents de l'environnement Codex et des configurations locales consultées : aucun appel S3 authentifié effectué, aucun secret affiché. Pour terminer depuis un terminal configuré, utiliser uniquement `--check` avec le même `--source`, les variables R2 existantes et, si demandé par les garde-fous 3A, la véritable attestation de revue ; ne pas fabriquer une attestation pour faire passer le contrôle. Variables attendues : `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_AERONAUTICAL_OBSTACLES`, `R2_OBSTACLES_PUBLIC_BASE_URL`, `R2_OBSTACLES_CORS_ORIGINS` (fallback de configuration OSM existant accepté par 3A). Ne jamais copier les secrets dans le rapport, le client ou Git.

## Avant toute publication réelle

1. Valider les obligations du produit combiné et produire une vraie revue conforme à 3A ; conserver source/date/licence et absence d'approbation implicite.
2. Examiner les rapprochements/limites, notamment Le Havre incomplet et relation Grenoble non résolue ; conserver tous les avertissements et les données inconnues.
3. Achever les contrôles terrain nécessaires ou conserver explicitement leur absence ; aucune absence de symbole ne garantit la sécurité.
4. Vérifier l'accès S3 en lecture seule dans l'environnement configuré, puis obtenir la validation préalable de publication de l'utilisateur. Aucun upload réalisé dans cette étape.
