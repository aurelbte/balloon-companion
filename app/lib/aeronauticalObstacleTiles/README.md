# Étape 2B — runtime indépendant, sans carte

Ce dossier lit le format de l’[étape 2A](../../../prototypes/aeronautical-obstacles/TILING.md).
Aucun contrat, générateur ou fichier source 2A n’est modifié. Aucune dépendance au
runtime électrique, à React/MapLibre, au Cloud Sync ou aux PDF. Pas de publication.

## Architecture / API

- `contract.ts` : types du manifeste existant, validation des identités/versions,
  métadonnées, compteurs, SHA-256 des octets et GeoJSON ; types de fiches/rendus repris
  du modèle et du générateur, par imports **type-only**.
- `viewport.ts` : sélection indexée XYZ, emprises, antiméridien, frontières demi-ouvertes,
  z9 pour zoom affiché <11, z12 dès 11 avec surzoom. Les utilitaires géométriques purs
  existants de 2A sont réutilisés. Pas de grille mondiale allouée.
- `runtime.ts` : un dataset immuable par instance, requêtes partagées entre vues,
  file concurrente, annulation par consommateur et générations de vue.
- `index.ts` : entrée publique client. `*.mjs` : outils/tests Node **non importés** par
  le runtime. La canonicalisation JSON reproduit celle de 2A, sans importer son
  `normalize.ts` qui dépend de `node:crypto`.

```ts
import { AeronauticalObstacleTileRuntime } from "./index";
const runtime = new AeronauticalObstacleTileRuntime({
  baseUrl: "https://example.invalid/local-dataset/immutable-version/",
  // Facultatif : empreinte DU FICHIER manifest.json, obtenue d’une source de confiance.
  manifestSha256: trustedManifestSha256,
});
const manifest = await runtime.readManifest(); // sources, dates, droits, limites inchangés
const view = runtime.createView(snapshot => consume(snapshot));
const result = await view.update({ west, south, east, north }, displayZoom);
if (!result.obsolete) consume(result.snapshot);
view.close(); // libère cette vue seulement
runtime.dispose(); // ferme toutes les vues, abandonne les requêtes, efface le cache
```

La base doit désigner une **version immuable**. Pour changer de version/dataset,
créer une nouvelle instance. Les chemins ne sont jamais fournis par la carte : seuls
les chemins XYZ indexés et validés sont utilisés ; pas de repli réseau alternatif.
`readManifest(signal)` peut être annulé sans interrompre les autres lecteurs.
`parseObstacleTile` est un validateur bas niveau : lui transmettre une entrée du
manifeste validé, pas des métadonnées arbitraires.

Le manifeste 2A n’a pas de hash de fichier sur lui-même. Son `version` valide le
hash canonique du bloc `identity`. Les empreintes de tuiles sont contrôlées par rapport
au manifeste, mais n’authentifient pas un manifeste lui-même altéré. L’option
`manifestSha256` ajoute ce contrôle complet si la valeur vient d’une source fiable.
Pas de nouveau champ ajouté à 2A pour résoudre cette limite.

Le runtime demande les `.geojson`, pas leurs `.gz` directement. Fetch décompresse
le HTTP gzip de manière transparente ; empreintes et tailles sont celles des octets
**décodés**. Le Content-Length comprimé n’est pas pris pour la taille décodée.
Les références gzip du manifeste sont vérifiées pour cohérence ; le runtime ne
prétend pas avoir téléchargé/vérifié les octets des artefacts qu’il ne charge pas
(normalisés, coverage.geojson, representations et .gz). Leurs références/provenances
restent disponibles dans le manifeste pour une étape ultérieure.

## Cache, concurrence et obsolescence

Défauts : 4 requêtes simultanées par instance, timeout 8 s par requête démarrée,
LRU de 64 entrées et 24 MiB d’octets décodés, au plus 256 tuiles demandées par vue.
Les budgets sont configurables ; une tuile dépassant le budget de vue reste visible
dans les états `NOT_LOADED / VIEW_TILE_BUDGET_EXCEEDED`. Aucun trou caché.
Les données JSON parsées ont un surcoût mémoire ; ce compteur est un budget d’octets
source, pas une mesure du heap JS. Les snapshots actifs sont détenus par leurs vues/
consommateurs en plus du cache : fermer les vues inutiles.
Manifeste limité à 16 MiB, tuile à 8 MiB, lecture du corps bornée quand Streams est
accessible. Le fallback `arrayBuffer` contrôle après lecture. Un manifeste validé
reste détenu par son instance, indépendamment de son éviction éventuelle du LRU.

Le timeout couvre fetch, corps, décodage et validation ; il n’utilise pas les API
récentes `AbortSignal.timeout/any`. La dernière libération annule la requête ; les
réponses tardives, même d’un fetch qui ignore AbortSignal, ne peuplent ni cache ni
snapshot. Les erreurs ne sont pas cachées : mise à jour ultérieure = nouvelle tentative.
Les chargements communs aux vues/viewport successifs sont mutualisés.

Les identifiants de **features** dédupliquent les rendus identiques. Un fragment de
ligne garde son ID 2A, son `fragmentOf` et sa géométrie ; on ne déduplique jamais les
fragments par identifiant parent. Les observations candidates/ambiguës ne sont pas
fusionnées. Des métadonnées différentes pour une même observation/feature sont
exposées dans `conflicts`, `conflictingFeatures` et `integrityError`, sans choix
arbitraire ; les rendus concernés ne rejoignent pas la collection utilisable.

## États et sécurité d’interprétation

- `coverage`: UNKNOWN (manifeste absent/invalide), OUTSIDE_COVERAGE (aucune cellule
  indexée), PARTIAL (trous, cellules de bord ou extension native), INDEXED_STUDY_AREA.
  Il s’agit de **l’index de charge utile**, pas d’une emprise exhaustive d’obstacles.
  Une cellule study_partial ne devient pas une étude complète de tout son rectangle.
- `NOT_LOADED`, `LOADING`, `EMPTY` (fichier valide vide), `LOADED`.
- `HTTP_404`, `HTTP_410`, `HTTP_ERROR` avec statut exact, `NETWORK_ERROR`, `TIMEOUT`,
  `INVALID_GEOJSON`, `HASH_MISMATCH`, `BODY_TOO_LARGE`, `CANCELLED`.
  Échecs de manifeste : `manifestError`, avec statut HTTP si disponible ; crypto
  absente : `CRYPTO_UNAVAILABLE`, aucune donnée non vérifiée utilisée.
- `exhaustive` est toujours **false**. `completeForIndexedSelection` signifie seulement
  que les fichiers de l’index sélectionné ont été reçus et validés sans conflit.
  `loadedObservationCount` compte des fiches sources chargées, jamais des obstacles
  physiques ; il vaut null si aucune tuile n’est chargée. Un zéro ne concerne que
  des fichiers validés, jamais un territoire sûr. `physicalObjectCount` reste null.
- L’avertissement permanent `safetyWarning` doit rester accessible dans un futur
  consommateur, y compris avec toutes les cellules chargées et vides.

Toutes les mesures originales, hauteurs inconnues, AGL/AMSL/datum, dates, statuts,
provenances et liens sont conservés sans calcul de hauteur ni fusion supplémentaire.
Pas de cache persistant/hors ligne ajouté : mémoire chaude utilisable sans réseau ;
cache froid sans réseau = erreur explicite, jamais vide valide.

## Vérification et données disponibles

```sh
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test \
  app/lib/aeronauticalObstacles.test.mjs prototypes/aeronautical-obstacles/*.test.mjs \
  app/lib/aeronauticalObstacleTiles.test.mjs
npm run typecheck
git diff --check
```

Les anciens dossiers `/tmp/bc-obstacles-study` et `/tmp/bc-aeronautical-obstacles`
ne sont plus disponibles. Les tests reconstruisent **avec le générateur 2A inchangé**
des sorties temporaires depuis les sous-ensembles réels committés du Havre/Grenoble.
Ce ne sont pas les anciens datasets complets. Preuseville utilise exclusivement une
fixture explicitement **synthétique** pour la mécanique du contrat ; aucune validation
sur ses données réelles n’est revendiquée. Il faut restaurer ses fichiers normalisés
2A (manifeste et sept artefacts) pour achever cette validation réelle. Pas de nouvelle
acquisition ni de changement des éditions sources.

La suite vérifie SHA/versions, limites, nulls, les 13 grues sans hauteur, câbles sans
profil vertical, z9/z12, frontières, déduplication, conflits, LRU, coalescence, budgets,
erreurs, annulations et réponses obsolètes. Le graphe JS client compilé est exécuté
dans un contexte sans globals Node. Aucun import de générateur/normaliseur Node ne
subsiste dans les modules émis.

Test Safari local optionnel (ouvre une session d’automatisation, aucune préférence
modifiée, données servies uniquement sur loopback) :

```sh
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  app/lib/aeronauticalObstacleTiles/browser-check.mjs
```

Safari doit déjà autoriser l’automatisation distante. Sur la machine de développement
cet essai est bloqué par ce réglage désactivé ; aucun test Safari réel réussi n’est
revendiqué. Les primitives sont des API web standard (Fetch/Streams, AbortController,
TextDecoder, WebCrypto SHA-256), sans `.at`, Buffer, process, imports Node, ni polyfill.
WebCrypto exige un contexte sécurisé (HTTPS/localhost). Les tests matériels iPhone,
CORS d’un futur hébergement et performances nationales restent hors de cette étape.
Les restrictions de redistribution `LOCAL_PROTOTYPE_ONLY` / false sont préservées.
