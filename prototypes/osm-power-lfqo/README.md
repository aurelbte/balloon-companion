# Prototype électrique LFQO — aérien ≥ 63 kV

Le snapshot actif est `snapshot-2026-11-11-63kv/`. Le précédent `snapshot-2026-11-11/` reste conservé comme version historique et n’est plus référencé par PreparationMap.

## Filtre appliqué à la génération

- Uniquement les ways OSM **`power=line`** ; `minor_line`, `cable` et autres types sont exclus.
- Aérien selon la convention [OSM `power=line`](https://wiki.openstreetmap.org/wiki/Tag:power%3Dline), qui implique `location=overhead` en l’absence de tag contraire. Tout `location` explicite autre que `overhead`, ainsi que les indications de tunnel, souterrain ou sous-marin, sont exclus.
- Tension **≥ 63 000 V**, borne incluse. Les valeurs multiples séparées par `;` sont interprétées : `20000;63000` est retenu, `20000;60000` est exclu.
- Le format accepté est celui d’OSM : entiers positifs en volts. Les valeurs absentes, vides, inconnues ou non interprétables sont exclues. Une liste contenant une composante inconnue est exclue par prudence ; aucune tension ni unité n’est déduite.
- `voltage` conserve le texte brut ; `voltage_max_v` donne la plus grande composante reconnue. `voltage_v` reste réservé aux tags à valeur unique. `location`, le fondement du classement aérien, les identifiants, versions et horodatages OSM disponibles sont conservés.

Le manifeste contient la politique exacte du filtre, la provenance, les empreintes SHA-256 et les statistiques. Les rejets comptabilisés pendant la lecture concernent les deux extraits sources entiers, pas seulement le disque LFQO.

## Sources, couverture et résultats

Centre LFQO : **50.68722 N, 3.07556 E**, [DGAC/STAC PIAF](https://piaf.stac.aviation-civile.gouv.fr/airports/table). Rayon de 20 000 m, traversant la frontière : extraits PBF [Geofabrik Nord–Pas-de-Calais](https://download.geofabrik.de/europe/france/nord-pas-de-calais.html) et [Belgique](https://download.geofabrik.de/europe/belgium.html), sans Overpass.

| Mesure | Snapshot filtré actif |
| --- | ---: |
| Date OSM des deux PBF | 2026-11-08 21:21:00 UTC |
| Fabrication locale | 2026-11-11 10:58:58 UTC |
| Entrées PBF, total | 940 088 332 octets |
| Objets uniques retenus | **623 `power=line`** |
| `minor_line` / tensions inconnues retenus | **0 / 0** |
| Tags de tension à valeurs multiples retenus | **11** |
| Doublons fusionnés entre extraits | 2 |
| GeoJSON global brut / gzip | 443 817 / 34 565 octets |
| Tuiles XYZ z11 non vides | 14 |
| Ensemble des tuiles brut / gzip | 474 565 / 42 530 octets |
| Lecture, empreintes et extraction, hors téléchargement | 20,74 s |

Le découpage utilise une projection azimutale équidistante sphérique locale et une intersection analytique segment/disque, pas une distance ellipsoïdale. Les segments traversants sont conservés même avec leurs deux extrémités hors du disque. Les doublons sont fusionnés par identifiant OSM, version puis date de snapshot. Les géométries impossibles à reconstruire ne sont pas inventées.

Les données restent non exhaustives et limitées aux tags OSM disponibles. La date de fabrication n’est pas la date des données. Attribution **© OpenStreetMap contributors ; Geofabrik**, licence [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) à conserver lors d’une future distribution.

## Fichiers et lecture locale

- `snapshot-2026-11-11-63kv/lfqo-power.geojson` et `.gz` : GeoJSON global en EPSG:4326, `[longitude, latitude]`.
- `tiles/11/{x}/{y}.geojson` et variantes gzip : **GeoJSON XYZ, pas MVT** ; segments découpés aux limites, sans simplification ni buffer. Les tuiles vides ne sont pas émises.
- `manifest.json` : inventaire fini des tuiles, filtre, dates, tailles et empreintes.
- Copie statique active : `public/osm-power/lfqo/6b46a77294ac1b41/`. Le lecteur existant de PreparationMap référence uniquement ce nouveau manifeste ; son style rouge, ses dimensions et son zoom minimal sont inchangés.

La couverture locale reste un disque, pas le rectangle englobant des tuiles. Le comportement du lecteur est inchangé : vue LFQO locale, vue chevauchante explicitement partielle sans chargement de l’extérieur, repli existant pour une vue entièrement hors du disque. La couche obstacles reste indépendante. Les tuiles manquantes ne sont pas remplacées par Overpass. Aucune modification de FlightMap, d’Overpass ou du cloud sync.

## Régénérer à partir des PBF déjà téléchargés

```sh
python3 -m venv /tmp/bc-osm-prototype-venv
/tmp/bc-osm-prototype-venv/bin/pip install -r prototypes/osm-power-lfqo/requirements.txt
/tmp/bc-osm-prototype-venv/bin/python prototypes/osm-power-lfqo/build.py --input-dir /tmp/bc-osm-lfqo-inputs --output prototypes/osm-power-lfqo/nouveau-snapshot --zoom 11
```

Le dossier de sortie doit être nouveau pour conserver les versions et éviter des tuiles obsolètes. Les PBF bruts sont dans `/tmp/bc-osm-lfqo-inputs/` et l’environnement Python est temporaire et isolé : aucune dépendance npm n’est ajoutée. Les URLs de téléchargement et empreintes sont dans chaque manifeste ; ces fichiers temporaires doivent être conservés séparément pour reproduire exactement un ancien snapshot.

Après génération, sélectionner le snapshot dans `copy_local_assets.py`, exécuter `python3 prototypes/osm-power-lfqo/copy_local_assets.py` puis mettre à jour uniquement la référence de manifeste dans `app/lib/preparationPowerLines.ts`. La copie est locale, vérifie les SHA-256 et ne contacte aucun service.

Actualisation proposée : télécharger de nouveaux PBF, vérifier leurs dates, puis reconstruire dans une nouvelle version. Utiliser les ETag/Last-Modified du serveur pour éviter les téléchargements inchangés ; les fichiers de réplication `.osc.gz` exigeraient une base nœuds/ways gérant aussi les suppressions et ne sont pas implémentés.

Destination R2 future, non créée : `osm-power/lfqo/<dataset-sha256>/tiles/11/{x}/{y}.geojson`, type `application/geo+json`, et `Content-Encoding: gzip` si les octets compressés sont utilisés. Un préfixe immuable et un manifeste publié en dernier éviteraient les mélanges de versions. Aucun upload ni déploiement n’a lieu ici.

## Vérifications minimales

Un test Python de génération hors réseau couvre seuil exact, valeurs multiples, basse tension, tensions absentes/inconnues, `minor_line`, câble, souterrain, sous-marin, tunnel, découpage, doublons et provenance :

```sh
/tmp/bc-osm-prototype-venv/bin/python prototypes/osm-power-lfqo/test_build.py
```

Les tests ciblés du lecteur existant vérifient les nouvelles tuiles réelles, leurs empreintes, leur déduplication et l’absence de `minor_line`/tensions inconnues dans le jeu actif. Aucun audit global ni modification du rendu.
