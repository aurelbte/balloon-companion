# Extension hors ligne par pays

`country_build.py` réutilise le filtre et les primitives GeoJSON/XYZ du générateur
LFQO `build.py`. Il ne télécharge rien, ne copie rien dans `public/` et n'envoie
rien vers R2. Le générateur LFQO, ses sorties publiées et le rendu rouge existant
restent inchangés. Les nouveaux manifestes (schéma 2) ne sont pas encore branchés
aux cartes.

## Extraits configurés

Les URL exactes PBF et `.poly` figurent dans `countries.json` :

| Identifiant | Source Geofabrik | Périmètre |
|---|---|---|
| `france` | https://download.geofabrik.de/europe/france.html | France métropolitaine ; pas les DOM/TOM |
| `belgium` | https://download.geofabrik.de/europe/belgium.html | Polygone d'extraction Belgique |
| `morocco` | https://download.geofabrik.de/africa/morocco.html | Polygone d'extraction Maroc fourni, sans présumer d'autres limites territoriales |
| `united-kingdom` | https://download.geofabrik.de/europe/united-kingdom.html | Grande-Bretagne et Irlande du Nord ; hors île de Man, îles Anglo-Normandes et territoires d'outre-mer |

La couverture représente le **polygone d'extraction**, qui peut déborder d'une
frontière administrative. Elle ne garantit pas l'exhaustivité des données OSM.
Utiliser un PBF national et son `.poly` correspondant, obtenus préalablement et
contrôlés par l'opérateur. Le script ne peut pas attester qu'un fichier renommé
est bien l'extrait indiqué par l'opérateur.

## Exécution future, un pays à la fois

Installer les dépendances dans un environnement Python dédié au prototype :

```sh
python -m pip install -r prototypes/osm-power-lfqo/requirements-countries.txt
```

Exemple **non exécuté** (les fichiers nationaux ne sont pas fournis) :

```sh
python prototypes/osm-power-lfqo/country_build.py \
  --country france \
  --input-dir /chemin/extraits \
  --coverage-poly /chemin/extraits/france.poly \
  --output-root /chemin/sorties \
  --zoom 11
```

Le fichier attendu est `/chemin/extraits/france.osm.pbf`. Les autres identifiants
s'utilisent de la même manière. `--extra-input belgium=/chemin/belgium.osm.pbf`
permet d'ajouter un extrait voisin déjà présent, sans étendre le masque principal.
Privilégier des instantanés de même date ; les dates connues, inconnues ou
non alignées sont explicites dans le manifeste. L'heure du fichier local ne
remplace jamais la date de l'instantané OSM.

## Filtre et frontières

- Filtre LFQO inchangé : `power=line`, aérien implicite ou `location=overhead`,
  sans indication souterraine, sous-marine ou tunnel ; `minor_line` exclu.
- Tension composée de valeurs entières positives en volts séparées par `;`,
  dont au moins une vaut ≥ 63000. Valeurs inconnues ou ambiguës exclues ;
  la valeur brute est conservée.
- Découpe au polygone, trous compris, puis aux tuiles XYZ sans buffer.
- Identifiant mondial `way/<osm_id>`, une seule feature par way dans chaque
  jeu et chaque tuile. Entre extraits fournis à une même génération, priorité
  à la version OSM observée la plus récente, puis à son horodatage, à la date
  de l'extrait et à son identifiant. Le filtre s'applique après cette sélection :
  une version devenue basse tension ne réactive pas l'ancienne ligne.
- Entre pays/tuiles, un même identifiant peut porter des fragments complémentaires.
  Un futur consommateur doit fusionner par identifiant **et géométrie**, éliminer
  les segments identiques et conserver les fragments distincts ; ne pas supprimer
  toute la feature du pays voisin. Aucun consommateur n'est modifié ici.
- Les suppressions et ways ayant perdu toute étiquette `power` ne sont pas
  reconstitués par comparaison d'extraits de dates différentes. Utiliser des
  extraits alignés, puis reconstruire intégralement lors d'une actualisation.

## Sorties et actualisation

`<output-root>/<pays>/<date-source-ou-undated>-<empreinte>/` contient :

- `manifest.json` : schéma 2, version, provenance Geofabrik/ODbL, dates UTC
  réelles disponibles, SHA-256 des entrées et du générateur, statistiques ;
- `coverage.geojson` : masque exact, empreinte du `.poly` source ;
- `power-lines.geojson` et sa copie gzip ;
- `tiles/<z>/<x>/<y>.geojson` et gzip, avec taille et SHA-256 dans le manifeste.

Chaque tuile intersectant le masque sur une surface positive possède un fichier,
**y compris vide** (`features: []`, statut `empty`). Le statut `partial`/`full`
décrit la couverture de la tuile. Une clé absente du manifeste signifie **hors
couverture**, jamais « vide ». Un fichier indexé absent reste une erreur.

La version dépend du profil pays, des empreintes et dates des sources, du masque,
du zoom et du code du générateur. Une version existante n'est jamais écrasée ;
une nouvelle génération est écrite dans un répertoire temporaire puis renommée.
L'actualisation consiste à fournir de nouveaux extraits et reconstruire le pays ;
les anciennes versions restent disponibles. Aucune publication automatique.

## Vérification et limites

Le test unique `test_build.py` utilise une fixture OSM synthétique située à LFQO :
filtre existant, tensions multiples, doublons et versions, frontières et trou du
polygone, XYZ, fichiers vides, empreintes et refus d'écrasement. Aucune donnée
nationale n'a été téléchargée ou générée pour cette extension.

Les performances nationales ne sont pas mesurées. Le cache de nœuds pyosmium
utilise `flex_mem` par défaut ; `--location-index` accepte un index pyosmium adapté
à l'environnement, notamment sur disque. Les ways retenus et les fragments de
tuiles restent en mémoire. Prévoir mémoire, espace et temps de génération avant
un traitement national. Shapely est limité à l'outillage Python du prototype,
sans nouvelle dépendance dans l'application BC.
