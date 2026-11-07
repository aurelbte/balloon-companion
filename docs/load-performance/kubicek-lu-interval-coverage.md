# Couverture des encadrements LU — hors production

## Résultat reproductible

**697 paliers encadrés / 443 refusés sur 1140**, dans chacune des deux révisions.
Les 1140 statuts, motifs et intervalles sont **identiques** entre Rev.22 et Rev.23.
Univers explicite : les 15 altitudes imprimées × 76 températures entières de
−40 à +35 °C, y compris les zones hors du domaine dessiné. Un refus hors courbe
n'est donc pas une lacune de données à combler par extrapolation.

Le [rapport JSON](kubicek-lu-interval-coverage.json) contient une ligne logique par
couple/révision, avec borne inférieure et encadrement LU ou motif de refus.
Sources : B.3102 Ed.3 Rev.22 et Rev.23, page imprimée **5-3, Rev.17**, page PDF 69.
Les SHA-256 des deux PDF sont publiés dans ce rapport ; tout autre PDF est refusé.

| Altitude ft | Encadrés | Refusés |
|---:|---:|---:|
| 0 | 37 | 39 |
| 1500 | 41 | 35 |
| 3000 | 46 | 30 |
| 4500 | 51 | 25 |
| 6000 | 56 | 20 |
| 8000 | 63 | 13 |
| 10000 | 69 | 7 |
| 12500 | 66 | 10 |
| 15000 | 60 | 16 |
| 17500 | 54 | 22 |
| 20000 | 47 | 29 |
| 22500 | 40 | 36 |
| 25000 | 32 | 44 |
| 27500 | 23 | 53 |
| 30000 | 12 | 64 |

## Preuve géométrique et refus

Chaque altitude est liée explicitement à sa primitive déjà identifiée dans le
script d'extraction/audit. Aucune association par proximité d'échantillons LU.
Les intersections rationnelles, contrôles de monotonie/continuité, bandes du
trait entier et clipping du prototype sont réutilisés pour **chaque** couple.
La calibration température englobe désormais aussi les ticks majeurs et les
lignes de grille correspondantes, sans ajustement affine. Les axes LU conservent
leurs bandes entières 10–23. Les 48 bissections conservent leur intervalle résiduel :
ce budget n'est ni un seuil d'erreur accepté ni une tolérance empirique.

La primitive 12 500 ft hérite du clipping et du style du bloc 8000 ft : les deux
chemins locaux sont dans le même état englobant sauvegardé. Le script exige
qu'aucun opérateur n'intervienne entre eux ; sinon refus. Il ne suppose jamais
qu'une absence de style explicite signifie le style attendu.

Les refus constatés, par PDF :

- `CLIP_INTERSECTS_PROOF_BAND` : **284** — le clipping touche/coupe la bande complète nécessaire à la preuve.
- `CURVE_ENDPOINT_OR_CLIP_UNCERTAIN` : **156** — la courbe ne couvre pas toute la bande verticale demandée.
- `OUTSIDE_10_23_OR_AXIS_AMBIGUOUS` : **3** — pas de séparation certaine des graduations entières dans 10–23 LU.

Ces refus restent des refus ; aucune intersection ou valeur n'est forcée.
Les motifs structurels (style, transformation, courbe pliée/discontinue, primitive
absente/dupliquée) restent également bloquants, même s'ils ne surviennent pas dans
les deux PDF épinglés.

## Domaine et limites

Borne géométrique entière, relativement au graphique vectoriel **et à ses
étiquettes qualifiées**, pas certification constructeur de la précision physique
ou de la numérisation originelle. Le décodeur CoreGraphics reste une dépendance
de confiance. L'élargissement englobe les traits et désaccords de calibration
visibles dans le PDF ; aucune erreur physique/documentaire inconnue n'est
remplacée par une tolérance inventée.

Pour un point réel : altitude de départ ≥ 0, altitude réelle entre ce départ et
30 000 ft, température réelle calculée dans [−40,+35] °C. Prendre l'altitude
imprimée supérieure et la graduation température entière supérieure, puis
**uniquement** la borne d'un couple accepté. La température reste calculée à
l'altitude réelle, jamais à l'altitude supérieure. La monotonie documentaire
p.5-1 permet cette extension conservatrice relativement au graphique, sous ses
hypothèses ; aucune interpolation entre altitudes. L'hypothèse de décroissance
standard de température n'est pas une mesure météo ni une preuve sur les inversions.

Le cas 6000 ft / 6 °C reste [16,17] LU, borne 16 ; aucun arrondi forcé à 16,5.
Aucun certificat de configuration réelle, aucune marge admissible, aucune
activation. Les 713 points historiques, Loading Tables et moteur opérationnel
restent inchangés. Ce rapport ne lève pas automatiquement les verrous du moteur.

## Reproduction

macOS avec Swift/CoreGraphics et les deux PDF aux empreintes attendues :

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/load-performance/kubicek_lu_interval.py \
  --coverage --manual .load-performance-work/manuals/kubicek-b3102-rev22.pdf \
  --compare-manual /chemin/kubicek-rev23.pdf
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s scripts/load-performance -p 'kubicek_lu_interval_test.py' -v
```

La comparaison vérifie chaque couple, statut, borne et bande géométrique publiée,
sans epsilon. Le test de couverture recalcule les 1140 couples Rev.22 et contrôle
le rapport comparatif ; la génération du rapport extrait et calcule les deux PDF.
Les tests dépendants du PDF/Swift sont ignorés explicitement si absents.
