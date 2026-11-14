# Publication versionnée des données électriques OSM sur R2

Le script `scripts/publish-osm-r2.mjs` lit les sorties versionnées de
`country_build.py` sans les modifier. Il réutilise le SDK S3 déjà installé et les
noms de variables serveur R2 utilisés par BC. Il ne touche ni aux cartes, ni au
cloud sync, ni aux paramètres du bucket. **La Belgique (BE) et la France (FR) sont autorisées à la publication** ;
les autres pays peuvent uniquement être vérifiés localement. Le code du profil
doit correspondre au dataset.

## Configuration nécessaire

La configuration existante de BC (`docs/cloudflare-r2-flight-tracks.md`) concerne
un **bucket privé de traces GPS**. Il n'est jamais choisi comme bucket de repli,
ni rendu public par ce script.

Variables à fournir dans l'environnement du terminal ou dans `.env.local`
(ignoré par Git ; ne jamais communiquer les clés dans un message ou un commit) :

```text
R2_ACCOUNT_ID=<identifiant du compte Cloudflare>
R2_ACCESS_KEY_ID=<identifiant S3 R2>
R2_SECRET_ACCESS_KEY=<secret S3 R2>
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BUCKET_OSM_POWER_LINES=<bucket OSM explicitement choisi>
R2_OSM_PUBLIC_BASE_URL=https://<domaine public du bucket>
R2_OSM_CORS_ORIGINS=https://www.balloon-companion.com,https://balloon-companion.com
R2_OSM_PREFIX=osm-power-lines
```

`R2_ENDPOINT` et `R2_OSM_PREFIX` sont facultatifs, avec les valeurs par défaut
ci-dessus. Les autres variables sont obligatoires pour `--check` et `--publish`.
Adapter les origines à celles réellement utilisées. Les variables du terminal
prévalent sur `.env.local`. Aucune variable ne doit être `NEXT_PUBLIC_*`.

Les deux identifiants doivent être les champs **Access Key ID** et **Secret
Access Key** fournis pour l'API S3 dans R2. L'Account ID identifie le compte dans
l'endpoint. Un jeton Cloudflare REST brut ne constitue pas cette paire S3.
Copier le champ Secret Access Key tel quel ; ne pas le hacher une seconde fois.
Les espaces et retours à la ligne accidentels dans ces deux variables sont
refusés avant toute requête, sans afficher leurs valeurs.
L'endpoint doit correspondre à la juridiction du bucket : par exemple
`https://<account-id>.eu.r2.cloudflarestorage.com` pour un bucket EU. Utiliser
l'endpoint affiché par Cloudflare. La région de signature du SDK reste `auto`.
Voir [authentification R2](https://developers.cloudflare.com/r2/api/tokens/).

Les identifiants existants ne sont réutilisables que si leur jeton possède les
accès nécessaires au bucket OSM : `HeadBucket`, `HeadObject` et `PutObject`.
Le script tente aussi `GetBucketCors` : un refus HTTP 403 `AccessDenied` reporte
uniquement ce contrôle vers les URL publiques, sans élargir les permissions.
Utiliser un jeton limité à ce bucket. Le bucket OSM doit être
séparé du bucket des traces privées. Le script n'accorde aucun droit et ne crée
aucun bucket ni domaine.

Le domaine public doit déjà desservir ce bucket et son CORS doit être configuré.
Exemple de règle à adapter manuellement, **non appliquée par le script** :

```json
[
  {
    "AllowedOrigins": ["https://www.balloon-companion.com", "https://balloon-companion.com"],
    "AllowedMethods": ["GET", "HEAD"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 300
  }
]
```

Les origines doivent être explicites dans la règle, ou couvertes par `*`.
Un domaine personnalisé permet le cache Cloudflare ; `r2.dev` est une URL de
développement, pas une configuration de production. Prévoir une règle de cache
adaptée aux `.geojson`, `.json` et `.gz` : les seuls en-têtes HTTP ne garantissent
pas l'éligibilité au cache CDN. Le script ne modifie pas ces réglages.

Références : [API S3 R2](https://developers.cloudflare.com/r2/api/s3/api/),
[écritures conditionnelles](https://developers.cloudflare.com/r2/api/s3/conditional-operations/),
[CORS](https://developers.cloudflare.com/r2/buckets/cors/),
[cache R2](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/).

## Exécution

Vérification locale par défaut, sans réseau ni identifiants :

```sh
node scripts/publish-osm-r2.mjs \
  --source /tmp/bc-osm-country-output/belgium/20261108-db4ecb06f9ec03a1
```

Vérification du bucket, des accès de lecture, du CORS et des éventuels objets
existants, **sans écriture** :

```sh
node scripts/publish-osm-r2.mjs \
  --source /tmp/bc-osm-country-output/belgium/20261108-db4ecb06f9ec03a1 --check
```

Diagnostic indépendant si `HeadBucket` renvoie un HTTP 400 sans détail
(commande à lancer manuellement, mêmes variables et contrôles locaux requis) :

```sh
node scripts/publish-osm-r2.mjs \
  --source /tmp/bc-osm-country-output/belgium/20261108-db4ecb06f9ec03a1 --diagnose
```

Ce mode envoie uniquement `ListObjectsV2` avec `MaxKeys: 1` et le préfixe
`osm-power-lines/belgium/20261108-db4ecb06f9ec03a1/` (adapté au préfixe configuré).
Il ne télécharge aucun objet et n'affiche pas les noms d'objets retournés.
Les erreurs GET S3 peuvent fournir un corps XML avec `Code` et `Message`,
affichés par le diagnostic expurgé des clés et signatures.
Un succès valide seulement l'accès à cette opération de liste : il ne valide
ni les droits d'écriture, ni le CORS, ni le précontrôle de publication.
La sortie distingue explicitement les contrôles non effectués :
`writeAccessVerified: null` / `writeAccessStatus: "NOT_TESTED"` et
`publicationPreflightPassed: null` / `publicationPreflightStatus: "NOT_RUN"`.
Ces valeurs ne signalent pas un refus d'écriture. Les permissions R2
**Object Read only** et **Object Read & Write** autorisent toutes deux la liste.
Pour publier, vérifier dans Cloudflare que le jeton dispose de **Object Read &
Write**, limité au bucket OSM et au compte/juridiction correspondants. Ce mode
ne lit pas la politique du jeton et ne prouve pas ses droits d'écriture.
`--check` exécute séparément `HeadBucket`, la validation du CORS et les contrôles
d'objets, sans écriture. Son résultat identifie un précontrôle passé ou l'opération
qui échoue ; il ne prouve pas non plus les droits `PutObject`.
`HeadBucket` est [pris en charge par R2](https://developers.cloudflare.com/r2/api/s3/api/)
et reste obligatoire pour `--check` et `--publish`. Il n'existe aucun repli
automatique vers le diagnostic ; `--diagnose` et `--publish` sont incompatibles.

Publication explicite, après configuration :

```sh
node scripts/publish-osm-r2.mjs \
  --source /tmp/bc-osm-country-output/belgium/20261108-db4ecb06f9ec03a1 --publish
```

Pour la France, avec la même configuration R2, seules la source et la version
changent. Exemples à exécuter manuellement ; aucune publication automatique :

```sh
node scripts/publish-osm-r2.mjs \
  --source /tmp/bc-osm-country-output/france/20261112-7d80f1b5392852da --dry-run

node scripts/publish-osm-r2.mjs \
  --source /tmp/bc-osm-country-output/france/20261112-7d80f1b5392852da --publish
```

Les **9 150 objets français** conservent leurs chemins sous
`osm-power-lines/france/20261112-7d80f1b5392852da/`. Aucun objet belge n'est déplacé
ou modifié. Les contrôles locaux, du bucket et du CORS public sont identiques.

Chemins publiés, sans réécriture du manifeste ni des données :

```text
osm-power-lines/belgium/20261108-db4ecb06f9ec03a1/coverage.geojson
osm-power-lines/belgium/20261108-db4ecb06f9ec03a1/power-lines.geojson[.gz]
osm-power-lines/belgium/20261108-db4ecb06f9ec03a1/tiles/11/<x>/<y>.geojson[.gz]
osm-power-lines/belgium/20261108-db4ecb06f9ec03a1/manifest.json
```

`R2_OSM_PUBLIC_BASE_URL` désigne la racine publique du bucket : le préfixe et les
chemins ci-dessus y sont ajoutés. Pas de clé `latest`, de suppression ni de
remplacement de version. Seuls les fichiers attendus du manifeste sont envoyés ;
aucun PBF, fichier d'environnement ou fichier voisin ne peut être publié.

## Contrôles et reprise

1. Avant tout réseau : manifeste schéma 2, pays/version/répertoire cohérents,
   filtre ≥63 kV, SHA-256, gzip, tailles, doublons, index XYZ et tuiles vides
   explicites. Les liens symboliques et chemins sortant du répertoire sont refusés.
2. Avant toute écriture : configuration complète, `HeadBucket`, contrôle des
   collisions sur tous les objets. La politique CORS GET/HEAD doit être compatible
   avec toutes les origines si elle est lisible. Seul un HTTP 403 `AccessDenied`
   sur `GetBucketCors` permet un report : `corsVerified: false` et
   `corsVerification: "DEFERRED_PUBLIC_URL"`, y compris dans le résultat `--check`.
   Les autres erreurs ou une politique lue mais incompatible restent bloquantes.
   La lecture seule ne peut pas prouver les droits d'écriture.
3. Premier objet envoyé : `coverage.geojson`. Sa relecture S3, son URL publique,
   son SHA-256, son Content-Type, son cache et ses réponses GET/OPTIONS CORS
   doivent réussir **avant** l'envoi du reste du pilote, même si la lecture de
   la politique CORS a été refusée. Un échec public arrête le transfert sans
   manifeste final. Le résultat de publication ne rapporte `corsVerified: true`
   et `corsVerification: "PUBLIC_URL"` qu'après les contrôles publics réussis.
4. Chaque écriture utilise `If-None-Match: *` pour ne jamais écraser un objet,
   `Content-MD5`, la métadonnée `sha256`, puis une vérification `HeadObject`.
   Un objet identique peut être réutilisé ; un conflit arrête la publication.
5. Le manifeste est envoyé **en dernier**. Après envoi, contrôle public du
   manifeste, de la couverture, d'une tuile avec données, d'une tuile vide et
   d'une copie gzip, pour chaque origine configurée, avec GET et OPTIONS.

Content-Type : `application/geo+json` pour les GeoJSON, y compris les copies gzip
avec `Content-Encoding: gzip` ; `application/json` pour le manifeste.
Cache de toutes les versions immuables : `public, max-age=31536000, immutable`.
Les octets locaux sont conservés exactement. Une version publiée ne doit plus
être modifiée ; une nouvelle donnée doit avoir un nouveau chemin versionné.

Une erreur d'accès public peut laisser le seul objet de couverture ; une erreur
de transfert peut laisser une version incomplète, sans manifeste final. Le script
ne supprime rien : relancer la même commande reprend les objets identiques. Un
échec après l'envoi du manifeste est signalé et ne déclenche aucune suppression.
Pour reprendre un transfert France interrompu, relancer exactement la même
commande `--publish` avec le même dossier/version. Le script relit les 9 150
objets attendus par `HeadObject` avant toute nouvelle écriture : SHA-256 en
métadonnées, taille, ETag/MD5, Content-Type, Content-Encoding et cache doivent
correspondre. Les objets déjà acceptés par R2 sont réutilisés, même si leur
réponse PUT a été perdue. Seuls les objets absents sont envoyés, toujours avec
`If-None-Match: *`. Tout conflit bloque avant les nouvelles écritures ; aucun
écrasement ni fichier local de suivi modifiable n'est nécessaire.

La progression du précontrôle est affichée toutes les 250 vérifications, puis
celle du transfert toutes les 50 vérifications d'objets, en distinguant les
objets envoyés et réutilisés. Le manifeste reste le dernier objet traité ; les
contrôles publics GET/OPTIONS sont exécutés aussi lors d'une reprise.

Les URL finales sont affichées uniquement après les contrôles publics réussis.
Les valeurs des secrets et les URL S3 signées ne sont jamais journalisées.

Test ciblé hors réseau : `node --test scripts/publish-osm-r2.test.mjs`.
