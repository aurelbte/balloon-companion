# FM04 — rejeu exact de la construction H65 et contrôle des intersections

## Portée

Prototype hors production : `scripts/load-performance/ultramagic_fm04_isa_replay.py`.
Il réutilise l'extracteur, les contours, les enveloppes rationnelles et le contrôle
du clipping du prototype existant, sans le modifier. Aucune méthode par paliers,
formule théorique, activation ou marge admissible.

Source : FM04 Rev.30 local, SHA-256
`b6f45b47fce6c7ff74802a260fa03459d8b38f967a5ef1f396132e004374deab`.
Page **5.3 Rev.23 / PDF 42** : graphique SI et construction verte ; page
**5.5 Rev.25 / PDF 44** : procédure et exemples H65. Extraction ciblée du Form
vectoriel `Meta159` de la page 42, aucune extraction globale du manuel.

Le [rapport exact JSON](ultramagic-fm04-isa-replay.json) publie les primitives,
fractions et motifs. Le rejeu du dessin publié réussit ; une génération autonome
équivalente à la consigne graphique reste **refusée**.

## Axes et référence ISA identifiés

- x : température ambiante, −50 à +40 °C ; y : portance de 4.5 à 10 kg/1000 ft³,
  température interne de l'enveloppe 100 °C. Les calibrations du prototype existant
  utilisent des bandes de traits entiers, pas un ajustement affine de l'image.
- Courbes solides : altitudes étiquetées du niveau de la mer à 7000 m AMSL.
- Référence centrale **ISA 0** : **65 contours de points remplis**, quatre copies
  identiques dans les bandes de clipping. Les enveloppes de points successifs sont
  disjointes en x : le PDF ne contient pas ici une courbe continue unique reliant
  leurs centres. Les autres guides ISA décalés ne sont pas substitués à ISA 0.
- Une interpolation des centres, un ajustement polynomial, une translation verticale,
  horizontale ou une définition de courbe parallèle seraient des hypothèses de
  reconstruction supplémentaires. Le prototype n'en choisit aucune.

## Cas H65 à 20 °C : étapes prescrites et primitives réellement rejouées

Coordonnées dans le repère local du Form, converties directement en fractions
exactes. Les valeurs décimales ci-dessous sont celles du PDF, sans arrondi ajouté.

| Étape prescrite p.5.5 | Rejeu vectoriel exact p.5.3 | Ce que cela démontre |
|---|---|---|
| Partir de 20 °C, monter jusqu'à la courbe 300 m | P1=(495.5,66.823) → P2=(495.79,381.14), Bézier cubique avec les trois contrôles finaux P2 | Le chemin est reproduit. Les abscisses restent dans la bande 20 °C. Il dérive de **0.29 unité en x**, donc n'est pas une verticale mathématique exacte. |
| De là, suivre une courbe parallèle à ISA jusqu'à la courbe 3000 m | Cubique P2 → P3=(385.21,315.57), contrôles (468.31,376.12) et (422.76,346.87) | Cette annotation continue est reproduite exactement, sans être recalculée depuis les points ISA. Sa qualité de « parallèle » n'est pas une propriété numérique démontrée. |
| Projeter horizontalement vers l'axe de portance | Segment P3 → P4=(66.216,315.57) | L'horizontalité et la continuité sont exactes dans le flux PDF. L'alignement exact de P3 sur la courbe noire doit être contrôlé séparément. |

P2 se situe strictement entre les contours imprimés 0 et 1000 m à son abscisse.
La page n'offre cependant pas de primitive indépendante pour la courbe 300 m :
la première intersection ne peut pas être reconstruite puis vérifiée comme une
intersection avec une telle primitive. On ne transforme pas « entre 0 et 1000 »
en une preuve de « 300 m » par une interpolation implicite.

## Intersections réelles avec le contour rempli 3000 m

Les deux longues frontières du contour noir traversent tout l'intervalle en x
de la cubique verte. Leurs contrôles sont strictement monotones : y décroît avec
x sur les frontières noires et croît avec x sur la cubique verte. Pour chaque
frontière, les signes aux extrémités sont opposés. Continuité + monotonie stricte
prouvent donc **une intersection unique par frontière**. Aucun axe central noir
n'est inventé à partir du trait rempli.

Les intersections sont encadrées par bissection rationnelle sur le paramètre vert
et enveloppes de Casteljau. Une comparaison de signe indécidable conserve le
bracket englobant ; aucune tolérance, aucun choix forcé d'un côté. Le clipping
réel doit couvrir toute la boîte obtenue. Extraits, approximatifs pour lecture
uniquement (les fractions exactes du JSON constituent le résultat) :

| Frontière noire | x du croisement | y du croisement |
|---|---:|---:|
| 1 | ≈ 388.277707 | ≈ 318.107914 |
| 2 | ≈ 386.370385 | ≈ 316.534482 |

Ces deux croisements précèdent P3 sur le trajet vert. À **x=385.21**, le contour
noir entier se trouve vers **y=318.626645 à 323.647647**, au-dessus de
**P3.y=315.57**. P3 n'est donc pas exactement une intersection avec le contour
noir. Ce résultat porte sur la ligne centrale de l'annotation et la géométrie du
contour rempli ; les épaisseurs de peinture ne sont pas assimilées à une marge de
précision constructeur.

Le dessin est ainsi rejoué exactement, mais les trois opérations mathématiques
idéalisées du texte ne sont pas exactement matérialisées par ses points. Le
prototype ne redresse pas la première branche, ne recale pas P3 et ne déplace pas
la projection horizontale pour forcer une coïncidence.

## Lecture publiée et second cas

- À 20 °C, p.5.5 annonce **6.55 kg/1000 ft³**, puis **426 kg** pour 65 000 ft³.
  Le produit exact de la valeur affichée est **425.75 kg**. La valeur 426 est
  reproduite comme valeur publiée ; aucune règle générale d'arrondi n'en est déduite.
  La lecture 6.55 n'est pas recalculée par un fit affine des axes. L'encadrement
  documentaire antérieur [6.5,7] reste identifié comme résultat du prototype
  précédent, sans prétendre valider le transport ISA.
- À **10 °C**, le manuel fournit **environ 488 kg**, dans la même configuration.
  Il ne fournit pas de seconde construction verte ni ses points ou intersections.
  Le prototype renvoie `REFUSED` : construction vectorielle absente, règle de
  transport non définie et courbe 300 m non publiée. Aucun déplacement ajusté pour
  retrouver 488 kg et aucun calcul théorique de remplacement.

## Hypothèses refusées / dernier verrou précis

Pour une construction autonome, il manque une définition reproductible de la
courbe 300 m et du déplacement de la référence ISA : quelle courbe continue
relier aux points, quel paramétrage et quel sens géométrique donner à « parallèle ».
L'annotation H65 fournit un exemple dessiné, mais pas cette règle. De plus, ses
points ne coïncident pas exactement avec les opérations idéalisées du texte.
Ni ces écarts, ni la note qualitative du manuel sur les déviations graphiques
ne définissent une tolérance admissible à encoder.

Cette étude distingue ainsi **rejeu du tracé**, **reconstruction de la consigne**
et **validation physique constructeur**. Seul le premier est obtenu ici, avec
contrôle indépendant des croisements réels. Aucune charge admissible.

## Reproduction ciblée

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/load-performance/ultramagic_fm04_isa_replay.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s scripts/load-performance -p 'ultramagic_fm04_isa_replay_test.py' -v
```

Tests : géométrie rationnelle, existence/unicité et encadrement des croisements,
refus des branches ambiguës, rejeu exact, décalage de P3, guide ISA pointillé,
refus du cas froid, mutations et reproduction du rapport. Les tests documentaires
sont ignorés explicitement si le manuel ou Swift est absent.
