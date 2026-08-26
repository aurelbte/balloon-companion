# Flight tracks — Cloudflare R2

Les traces GPS sont stockées dans un bucket R2 privé. PostgreSQL conserve uniquement `storage_provider`, `object_key`, `format_version`, `checksum`, `blob_status`, `blob_size` et `track_generation`. Les anciennes traces `SUPABASE_STORAGE` restent lisibles pendant la transition.

## Configuration manuelle

1. Dans Cloudflare R2, créer un bucket privé, par exemple `balloon-companion-flight-tracks`.
2. Créer un jeton API R2 S3 limité à ce seul bucket, avec lecture et écriture d’objets. Ne jamais utiliser une clé globale Cloudflare.
3. Configurer le CORS du bucket avec uniquement les origines de l’application (production et, si nécessaire, preview locale), les méthodes `GET` et `PUT`, les en-têtes signés `content-type` et `x-amz-meta-sha256`, et un `MaxAgeSeconds` court. Exemple à adapter :

```json
[
  {
    "AllowedOrigins": ["https://balloon-companion.example"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["content-type", "x-amz-meta-sha256"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 300
  }
]
```

4. Dans Vercel, ajouter exclusivement comme variables serveur :

```text
R2_ACCOUNT_ID=<Cloudflare account id>
R2_ACCESS_KEY_ID=<R2 S3 access key id>
R2_SECRET_ACCESS_KEY=<R2 S3 secret access key>
R2_BUCKET_FLIGHT_TRACKS=balloon-companion-flight-tracks
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
```

`R2_ENDPOINT` est facultatif si `R2_ACCOUNT_ID` est fourni. Aucune variable R2 ne doit commencer par `NEXT_PUBLIC_`.

5. Appliquer manuellement `supabase/migrations/20260827120000_cloud_sync_flight_tracks_r2_provider.sql`, puis redéployer l’application.
6. Valider un nouvel upload, un téléchargement paresseux sur un autre appareil, un retry et un tombstone avant toute migration historique.

## Migration des deux objets historiques

Pour chaque vol historique, après connexion avec son propriétaire et en mode DEV ciblé :

```js
await window.__BC_CLOUD_SYNC_CONTROLLED_TEST__.migrateLegacyFlightTrackToR2Targeted("<flightId>", 1)
```

Le serveur relit l’objet Supabase, vérifie taille, checksum, schéma et `flightId`, l’écrit dans R2, puis bascule les métadonnées vers `R2`. L’objet Supabase historique n’est pas supprimé. Le conserver jusqu’à validation complète de la lecture R2 sur plusieurs appareils et d’une sauvegarde indépendante.

## Volumétrie indicative

À partir d’un blob observé de 805 219 octets :

| Vols | Octets | Environ |
|---:|---:|---:|
| 100 | 80 521 900 | 76,79 MiB |
| 500 | 402 609 500 | 383,96 MiB |
| 1 000 | 805 219 000 | 767,92 MiB |
| 5 000 | 4 026 095 000 | 3,75 GiB |

Cette estimation ne comprend pas les versions temporaires, les objets historiques conservés ni le trafic.
