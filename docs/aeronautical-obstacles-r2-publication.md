# Obstacles aéronautiques — étape 3A : publication R2 préparée, non exécutée

## Verdict et périmètre

Procédure Node locale dédiée, indépendante des cartes. Aucun upload R2, changement de
bucket, de CORS, de runtime, de données électriques, de PDF, de Supabase ou de Cloud Sync.
Le script, ses tests et ce rapport sont les seuls nouveaux fichiers.

**Pas de publication réelle prête à lancer aujourd'hui** : les études complètes
`/tmp/bc-obstacles-study/` et sorties `/tmp/bc-aeronautical-obstacles/` ne sont plus disponibles.
Le dépôt conserve deux sous-ensembles réels, pas les inventaires complets des trois zones.
Les droits du produit combiné restent à établir. Aucun accès R2 réel n'a été testé.

## Architecture constatée et réutilisée

- `scripts/publish-osm-r2.mjs` : `readConfig`, `createR2Client`, `formatR2Error`,
  `CACHE_CONTROL`. Ces utilitaires S3 déjà présents sont importés **uniquement par le
  nouveau script Node**. Le publisher THT et ses tests ne sont pas modifiés.
  Signature assurée par le SDK AWS existant, région `auto`, checksums `WHEN_REQUIRED`.
  Aucune réimplémentation de SigV4, aucune nouvelle dépendance.
- `prototypes/aeronautical-obstacles/tile-build.mjs` : `loadNormalized` pour les sept
  artefacts normalisés et leur manifeste ; `buildTiles` reste le seul générateur.
- `app/lib/aeronauticalObstacleTiles/contract.ts` : `parseObstacleManifest`,
  `parseObstacleTile`, `canonical` réutilisés directement. Validation du format 2A,
  de l'identité, des tailles, SHA-256, catégories, mesures et identifiants.
- `scripts/publish-aeronautical-obstacles-r2.mjs` : plan local, protocole S3, contrôles
  HTTP publics et activation/retour arrière. Il n'est importé par aucun code client.
- `scripts/publish-aeronautical-obstacles-r2.test.mjs` : client S3 en mémoire et vrai
  serveur HTTP **loopback**, pour vérifier aussi la décompression gzip de Fetch.

Le runtime 2B n'a pas de lecteur de pointeur actif : il attend une URL de version
immuable et éventuellement un `manifestSha256` de confiance. Le futur branchement
pourra résoudre le pointeur puis instancier ce runtime. Rien n'est intégré ici.

## Contrats conservés et contrôle documentaire

**Aucune modification des contrats 2A/2B.** Le manifeste produit par 2A garde
`LOCAL_PROTOTYPE_ONLY`, `publicRedistributionValidated: false`, z9 synthétique, z12
détaillé, ses SHA-256, ses géométries natives et ses limites. Le lecteur 2B continue
de valider exactement ces marqueurs. Aucun remplacement par un faux statut approuvé.

La revue de diffusion est un document opérateur **extérieur** au format 2A, lié au
SHA-256 du fichier manifeste entier, à sa version et aux éditions sources. Elle doit
explicitement porter sur **tous** les artefacts, y compris les originaux normalisés,
les regroupements et les découpes. Elle ne certifie ni l'exhaustivité ni la sécurité.
Le script vérifie la présence et la correspondance de cette attestation ; il ne peut
pas vérifier juridiquement les preuves ni remplacer une revue humaine.

La conservation du marqueur prototype dans un produit diffusé doit être acceptée
explicitement lors de cette revue. Si un statut de production doit être porté par
le manifeste lui-même, il faudra une évolution concertée 2A/2B dans un autre lot.

Les jeux dont l'identité indique un scope de test/sous-ensemble sont refusés par
`--publish` et `--rollback`, **même avec une attestation**. Les tests du protocole
simulent séparément une entrée restaurée/revue dans un plan en mémoire, exclusivement
avec un faux client S3. Cette simulation n'est pas une preuve de droits et n'est pas
une option CLI de contournement.

## Organisation R2 proposée

Préfixe fixé par le code, non surchargeable par `R2_OSM_PREFIX` :

```text
aeronautical-obstacles/<zone>/<version-SHA256-complet>/
  tiles/9/<x>/<y>.geojson[.gz]
  tiles/12/<x>/<y>.geojson[.gz]
  coverage.geojson[.gz]
  representations.geojson[.gz]
  normalized/<artefacts d'origine>
  redistribution.json
  manifest.json
aeronautical-obstacles/<zone>/active.json
```

La version complète évite les collisions d'URL. Le dossier local reste celui de 2A,
nommé avec les 16 premiers caractères de cette version. Aucun objet THT n'est visé.
Un bucket dédié peut être choisi, ou le bucket public existant explicitement réutilisé
avec ce préfixe distinct. Le bucket privé des traces de vol est refusé.

`active.json` est un petit **pointeur de publication**, pas une copie modifiée du
manifeste 2A. Il contient `schemaVersion: 1`, `kind: aeronautical-obstacles-release`,
`zone`, `version`, `manifestSha256`, `previous` (version/SHA précédent ou null),
`approvalSha256` et l'heure UTC réelle d'activation. L'empreinte de l'attestation est
publique ; son contenu n'est pas uploadé. Conserver ce document de revue en lieu sûr.

Les SHA garantissent l'intégrité relativement à un manifeste/une origine de confiance,
pas une signature contre un attaquant possédant les droits d'écriture du bucket.

## Ordre de publication et garanties

1. Valider localement tous les fichiers, les gzip (octets stockés **et** décodés),
   les deux niveaux 2B et l'absence de perte d'identifiants normalisés. Refuser les
   symlinks, traversées de chemin, fichiers non listés et tailles excessives.
   Seuls les chemins 2A attendus sont publiables ; aucun fichier voisin n'est collecté.
2. En mode distant, vérifier l'accès au bucket via `ListObjectsV2`, le CORS si accessible,
   le pointeur courant et **toutes** les collisions avant le premier PUT.
   Un objet existant est relu en entier via S3, pas accepté sur ses seules métadonnées.
3. Écrire `coverage.geojson` en premier et vérifier son accès public/CORS avant le reste.
   Écrire chaque objet absent avec `If-None-Match: *` et Content-MD5 ; vérifier ses
   octets SHA-256, sa taille et ses métadonnées par S3, puis ses réponses HTTP publiques.
4. Vérifier tous les objets, sur toutes les origines configurées. Écrire le manifeste
   immuable **en dernier**, après toutes les tuiles, vides compris, et tous les autres
   artefacts. Vérifier aussi son URL publique et son empreinte.
5. Créer le pointeur actif avec `If-None-Match: *`, ou le remplacer par `If-Match`
   sur l'ETag lu avant la publication. Un concurrent n'est jamais écrasé.
   Vérifier le pointeur final via S3 et HTTP public.

Une interruption laisse la version active antérieure intacte. Relancer la même commande
réutilise seulement les objets strictement identiques et complète les absents. Un conflit
est bloquant, pas corrigé par écrasement. Un manifeste déjà visible avec des fichiers
manquants provoque `PUBLISHED_VERSION_INCOMPLETE` : réparer sous contrôle opérateur,
sans activation automatique d'une version incohérente.

Un timeout sur le PUT actif peut être ambigu : `ACTIVE_WRITE_FAILED_OR_UNCERTAIN`
exige de lire l'état avant de relancer. Une réponse perdue suivie d'un 412 est réconciliée
uniquement si les octets du pointeur correspondent exactement à notre écriture.
`ACTIVE_WRITTEN_VERIFY_FAILED` signifie que la bascule a pu réussir mais que sa
vérification finale a échoué : ne pas prétendre que l'ancienne version est encore active.
Aucune suppression ni restauration aveugle n'est faite.

## HTTP, compression et CORS

| Objet | Content-Type | Content-Encoding | Cache-Control |
|---|---|---|---|
| `.geojson` | `application/geo+json` | absent | `public, max-age=31536000, immutable` |
| `.geojson.gz` | `application/geo+json` | `gzip` | identique |
| JSON immuable | `application/json` | absent | identique |
| `active.json` | `application/json` | absent | `no-store` |

Les objets raw et gzip sont tous conservés conformément à 2A. Le runtime demande
actuellement les URLs raw ; aucune réécriture CDN ou négociation gzip supplémentaire
n'est nécessaire. Sur S3, SHA et tailles portent sur les octets réellement stockés ;
sur HTTP, Fetch décompresse gzip, donc le contrôle porte sur `decodedSha256`.
Ne pas comparer Content-Length comprimé à la taille du corps décodé.

Le publisher contrôle chaque réponse GET avec `Origin`, statut 200, type, encodage,
cache et SHA, puis deux OPTIONS, l'un pour GET et l'autre pour HEAD. Une réponse CORS
qui ne liste que la méthode demandée est ainsi correctement acceptée. Les redirections sont refusées.
Délais limités à 30 secondes par requête ; 64 MiB par artefact et 512 MiB par package,
limites explicites de ce prototype. Publication séquentielle : faible concurrence,
pas encore un outil d'acquisition ou de publication nationale.

`GetBucketCors: 403 AccessDenied` est traité comme dans THT : **non vérifié**, puis
contrôle obligatoire via les URLs publiques. Toute autre erreur reste bloquante.
Le script ne crée pas de bucket, ne change pas le CORS, les ACL, les domaines ou le cache.
Un jeton Object Read & Write ne prouve pas des droits d'administration du bucket.

Configuration à établir par l'administrateur : autoriser les origines BC choisies et
GET/HEAD ; exposer éventuellement ETag/Content-Encoding si un futur client en a besoin.
Le client actuel vérifie les octets décodés. Ne pas utiliser une règle « Cache Everything »
qui rendrait `active.json` persistant ; ne pas transformer les objets immuables.
Après un changement de CORS/cache, prévoir purge et contrôle effectif des réponses avant
la publication, sans remplacer ces contrôles par une attente supposée suffisante.

Références Cloudflare : [CORS](https://developers.cloudflare.com/r2/buckets/cors/),
[écritures conditionnelles atomiques](https://developers.cloudflare.com/r2/api/s3/conditional-operations/),
[compatibilité S3](https://developers.cloudflare.com/r2/api/s3/api/).

## Données effectivement disponibles et mesure locale

Les packages de contrôle ci-dessous ont été produits **uniquement** avec l'aide de test
2B existante `runtime.fixtures.mjs`, donc avec le même générateur 2A. Ce ne sont pas des
reconstructions des études complètes. Ils restent hors Git et sont refusés en publication.

| Jeu local | Observations | Tuiles z9+z12 | Vides | Objets immuables raw+gzip+annexes+manifeste | Octets |
|---|---:|---:|---:|---:|---:|
| Le Havre, sous-ensemble réel conservé | 30 | 33 | 24 | 80 | 435 682 |
| Grenoble, sous-ensemble réel conservé | 15 | 44 | 33 | 102 | 288 082 |
| Preuseville, **synthétique de test**, pas l'étude réelle | 1 | 3 | 1 | 20 | 41 785 |

Ajouter un objet actif par zone. Les comptes incluent les vides explicites et tous les
artefacts normalisés. **Le nombre et le volume réels de Preuseville sont indéterminés.**
Pour le contrat 2A actuel, N = 2 × nombre de tuiles + 14 objets immuables.
Les totaux du Havre/Grenoble ne sont pas extrapolables aux études complètes.
Pas de données Géorisques réelles dans ces sous-ensembles SIA/OSM.

Sorties conservées pour les dry-runs locaux :

```text
/tmp/bc-obstacles-r2-preparation/test-datasets/le-havre/53aee88be1e3e518/
/tmp/bc-obstacles-r2-preparation/test-datasets/grenoble/43bc1de4b9ed9f0d/
/tmp/bc-obstacles-r2-preparation/test-datasets/preuseville/f7466a9e978669c4/  # SYNTHÉTIQUE
/tmp/bc-obstacles-r2-preparation/local-inventory.json
```

Les noms sont propres au code/runtime actuels ; un autre Node/V8/zlib peut produire
une autre version, conformément à 2A. Sources/dates complètes dans cet inventaire :
SIA cycle retenu 2026-10-29 ; extractions régionales OSM du 14/11/2026 d'après les
provenances conservées. Un snapshot unique n'est pas inventé lorsque plusieurs extraits
sont utilisés. Les dates d'acquisition inconnues restent nulles.

Pour retrouver le vrai Preuseville, restaurer de préférence sa sortie normalisée complète
avec manifeste et sept artefacts, ou son package XYZ 2A avec tous les artefacts listés.
À défaut, `build.mjs --zone preuseville` exige l'étude complète, notamment :

- `sources.json`, `sia-local-raw.json`, `georisques-local-raw.json`, `osm-local-raw.json` ;
- originaux SIA XLSX, CSV Géorisques et PBF régionaux référencés, aux empreintes attendues ;
- métadonnées `sia-20261029.xlsx.metadata.json`, `georisques-turbine.csv.metadata.json` ;
- scripts d'extraction conservés `fetch.py`, `extract_osm.py`, `normalize.py`.

Restaurer ces octets, pas des sources actuelles en conservant artificiellement les anciennes
dates/versions. Aucune nouvelle acquisition n'a été faite dans ce lot.

## Budget

Le dry-run calcule N objets, octets, tuiles/vides, bytes raw/gzip et une estimation
marginale R2 Standard. Référence consultée :
[tarification Cloudflare R2](https://developers.cloudflare.com/r2/pricing/).
Stockage : 0,015 USD/Go-mois ; classe A : 4,50 USD/million ; classe B :
0,36 USD/million ; sortie Internet sans frais R2. Franchise mensuelle partagée :
10 Go-mois, 1 million A, 10 millions B. Arrondis de facturation à prendre en compte.

Pour les deux seuls **sous-ensembles réels** : 182 objets immuables, 723 764 octets,
plus deux pointeurs. En dehors franchise/arrondis : environ 0,0000109 USD/mois de
stockage et 0,00137 USD d'opérations marginales pour un premier upload avec deux origines.
Ce ne sont pas des montants de facture garantis. La consommation globale du compte,
le trafic utilisateur et la mise en cache ne sont pas connus. L'estimation B compte
prudemment toutes les requêtes publiques/OPTIONS comme lectures origine : borne de
dimensionnement, pas affirmation de facturation de chaque OPTIONS.

Le script estime N+2 opérations A (N PUT immuables + pointeur + LIST) et une borne
de lectures `2N + 3 + 3 × origines × (N+1)` : précontrôle, relectures, GET/deux OPTIONS publics,
pointeur/CORS. Les reprises n'écrivent que les objets manquants. Garder deux versions
augmente le stockage ; aucune purge automatique ne compromet le retour arrière.
Les en-têtes, retransmissions et tailles des pointeurs ne sont pas inclus dans ces octets.

## Procédure réelle future — commandes non exécutées

### 1. Restaurer les données complètes et effectuer le dry-run hors ligne

```sh
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  scripts/publish-aeronautical-obstacles-r2.mjs \
  --source /chemin/hors-git/preuseville/VERSION_LOCALE_16_CARACTERES --dry-run
```

Le dry-run est le mode par défaut, sans client S3, lecture `.env.local`, résolution
d'identifiants ni appel HTTP. Il reste utilisable hors ligne. Les jeux de contrôle
ci-dessus peuvent servir à le rejouer, jamais à une publication réelle.

### 2. Configurer l'accès opérateur et établir la revue

Variables **serveur/terminal uniquement**, aucune valeur secrète dans une commande versionnée :

| Variable | Rôle |
|---|---|
| `R2_ACCOUNT_ID` | compte, réutilisé |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | identifiants S3, réutilisés ; pas un jeton REST |
| `R2_ENDPOINT` | facultatif, dérivé du compte, HTTPS R2 validé |
| `R2_BUCKET_AERONAUTICAL_OBSTACLES` | bucket choisi ; sinon bucket THT existant |
| `R2_OBSTACLES_PUBLIC_BASE_URL` | origine publique du bucket ; sinon URL publique THT |
| `R2_OBSTACLES_CORS_ORIGINS` | origines séparées par virgules ; sinon origines THT |

Les paramètres THT de repli sont `R2_BUCKET_OSM_POWER_LINES`, `R2_OSM_PUBLIC_BASE_URL`,
`R2_OSM_CORS_ORIGINS`. Le préfixe reste toujours `aeronautical-obstacles`.
Un bucket dédié réduit le périmètre d'un jeton ; le script protège les chemins, mais
un jeton portant sur un bucket partagé n'est pas pour autant isolé par préfixe.
Les accès et paramètres effectifs n'ont pas été vérifiés à distance dans ce lot.

Ne jamais utiliser `NEXT_PUBLIC_*` pour des secrets, copier `.env.local` dans Git,
afficher la configuration ou coller une requête signée dans un rapport. Les erreurs
réutilisent la rédaction sécurisée THT avec le nom d'opération et les codes utiles.

Document de revue externe à préparer **après** vérification réelle des droits ;
exemple volontairement incomplet et non exécutable comme autorisation :

```json
{
  "schemaVersion": 1,
  "zone": "preuseville",
  "version": "SHA256_COMPLET_VERSION",
  "manifestSha256": "SHA256_DU_FICHIER_MANIFEST_JSON",
  "redistributionApproved": false,
  "scope": "all-listed-artifacts-including-normalized-originals",
  "reviewer": "À renseigner après revue",
  "reviewedAtUtc": "DATE_UTC_REELLE",
  "sources": [
    {"id": "ID_EDITION_SOURCE", "sha256": "SHA256_SOURCE", "decision": "à vérifier", "license": "à vérifier", "evidence": "Références et conditions applicables"}
  ]
}
```

Une ligne par édition source du manifeste, sans manque ni doublon. Consigner les
obligations ODbL/base combinée OSM, les conditions propres aux téléchargements
Géorisques et la réutilisation du produit SIA transformé, ainsi que la couverture,
la fraîcheur et les limites à communiquer. Ne remplir aucune preuve par supposition.

### 3. Vérifier à distance sans écrire

```sh
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  scripts/publish-aeronautical-obstacles-r2.mjs \
  --source /chemin/hors-git/preuseville/VERSION_LOCALE_16_CARACTERES --check
```

Cette commande est réseau mais sans PUT. Elle n'affirme pas qu'un droit d'écriture
a été prouvé. Sur une nouvelle version absente, elle ne peut pas certifier le CORS public
d'un fichier inexistant ; le canari de publication et les vérifications suivantes restent obligatoires.

### 4. Publier seulement après validation des prérequis et autorisation explicite

```sh
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  scripts/publish-aeronautical-obstacles-r2.mjs \
  --source /chemin/hors-git/preuseville/VERSION_LOCALE_16_CARACTERES \
  --approval /chemin/hors-git/revue-preuseville.json --publish
```

Relancer exactement cette commande pour reprendre une interruption. Aucun `--force`,
aucun écrasement des versions et aucune publication du manifeste actif avant contrôle complet.
Le rapport de sortie donne l'activation vérifiée ou une erreur explicite ; les SHA
et URL versionnées permettent ensuite une vérification indépendante.

### 5. Revenir immédiatement à la version précédente

Conserver son dossier local complet et sa revue documentaire. Lire le pointeur actif
et relever son **manifestSha256** (pas le SHA du fichier `active.json`).

```sh
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  scripts/publish-aeronautical-obstacles-r2.mjs \
  --source /chemin/hors-git/preuseville/VERSION_PRECEDENTE_16_CARACTERES \
  --approval /chemin/hors-git/revue-version-precedente.json \
  --expect-active-sha256 SHA256_MANIFESTE_ACTUEL --rollback
```

Le retour arrière refuse une cible différente de `previous`, une version incomplète,
un hash inattendu ou une bascule concurrente. Il relit/vérifie tous les anciens objets,
ne réuploade rien et ne modifie que `active.json`. Les deux versions restent disponibles.
L'ancienne version peut elle-même être périmée : le retour technique ne valide pas
sa fraîcheur ni la sécurité aéronautique. Aucune carte n'exploite encore ce pointeur.

## Vérifications et limites

Résultats de cette session : **62 tests réussis, aucun ignoré**, dont 13 pour le
publisher et 49 pour le modèle, le normaliseur, les tuiles 2A et le runtime 2B.
TypeScript (`npm run typecheck`) et `git diff --check` réussis. Les dry-runs CLI des
deux sous-ensembles réels et de la fixture synthétique ont été exécutés sans R2.
Inventaire et résultats conservés dans `/tmp/bc-obstacles-r2-preparation/`.

Tests ciblés du protocole : dry-run CLI sans identifiants, allowlist et SHA, gzip
stocké/décodé, symlinks/fichiers absents, manifestes invalides, CORS/HTTP/cache/types,
publication interrompue, reprise sans doublon, collisions, manifeste prématuré,
activation concurrente, perte d'accusé de réception, retour arrière et expurgation
des secrets. Le runtime 2B lit effectivement les deux niveaux via le serveur HTTP local.

```sh
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test \
  scripts/publish-aeronautical-obstacles-r2.test.mjs \
  app/lib/aeronauticalObstacles.test.mjs app/lib/aeronauticalObstacleTiles.test.mjs \
  prototypes/aeronautical-obstacles/*.test.mjs
npm run typecheck
git diff --check
```

Le test HTTP nécessite le droit d'écouter uniquement sur `127.0.0.1` ; le sandbox de
cette session le bloquait avec EPERM, puis l'exécution locale autorisée a permis ce contrôle.
Il n'ouvre aucun accès au bucket. Il ne remplace pas une recette contre le bucket,
son domaine, son cache ou son éventuel délai de propagation Cloudflare.

Les données restent non exhaustives. Pas de nouveau statut physique, hauteur,
altitude ou profil de câble ; inconnus et provenance sont conservés. Une tuile vide
n'est pas une preuve d'absence d'obstacles. Pas de nouvelle acquisition, intégration
cartographique, publication réelle, commit, push ou déploiement dans ce lot.
