# Premier encadrement LU conservateur — outil hors production

> Historique du prototype initial. Le domaine a depuis été généralisé : voir
> [couverture complète et refus](kubicek-lu-interval-coverage.md).

## Résultat et portée

Le script `scripts/load-performance/kubicek_lu_interval.py` encadre le cas du
palier **6000 ft / graduation 6 °C** par **[16, 17] LU**, donc fournit une borne
inférieure **16 LU**. C'est un encadrement de la géométrie du PDF, pas une
certification de précision physique du constructeur ni une validation du vol.
Aucune marge, activation, modification des 713 points ou des Loading Tables.
Le moteur existant et son verrou `LU_METHOD_NOT_VALIDATED` restent inchangés.

Sources qualifiées par empreinte, page imprimée 5-3, PDF page 69 :

- Rev.22, page Rev.17 : `c32dd501b7761b1b03974aa8e39b6d4e20efc9e304c1a520ecc37c03bf721c30`.
- Rev.23, même page Rev.17 : `acf9540b314a9060b68c8006c76ad7790a8eaf97bf695f59c9f84bac11ab2410`.

Les associations primitives/étiquettes sont celles du cas déjà examiné dans le
manuel et l'audit : courbe 6000 ft, graduation 6 °C et graduations LU entières.
Ce n'est pas un lecteur PDF général ni une reconnaissance automatique des labels.
Un autre PDF, une primitive absente/dupliquée, un style ou une transformation non
pris en charge sont refusés. Le décodeur CoreGraphics est une dépendance de
confiance ; la preuve porte sur les coordonnées décimales du flux décompressé,
pas sur un rendu raster, une imprimante ou une erreur intrinsèque du graphique.

## Construction de l'encadrement

1. Coordonnées décimales converties directement en fractions rationnelles exactes.
   Aucune soustraction d'écart empirique ; aucun flottant dans le calcul géométrique.
2. Calibration par bandes des graduations LU **entières** : enveloppe des positions
   correspondantes des ticks supérieurs/inférieurs et de la grille, augmentée du
   demi-trait explicite (0.239/2 unité PDF). Les petits désaccords entre primitives
   sont inclus, sans ajustement affine. L'ordre strict des bandes est contrôlé.
3. La graduation 6 °C est lue à sa position vectorielle propre, avec son demi-trait.
   On ne suppose pas que tous les ticks constituent une transformation affine exacte.
4. La chaîne de Bézier identifiée doit être continue et ses contrôles strictement
   croissants en y, non décroissants en x. Ces conditions suffisantes prouvent
   l'unicité des intersections et permettent de refuser plis/ambiguïtés.
5. Les caps et joins ronds, largeur 0.954, sont inclus par élargissement de 0.954/2
   en y puis en x. Ce rectangle englobe le tube circulaire du trait. Les paramètres
   explicites et l'absence d'overrides géométriques ExtGState sont contrôlés.
6. Pour chaque niveau y extrême, bissection rationnelle avec invariant englobant,
   puis évaluation exacte de Casteljau. La fin après 48 subdivisions conserve
   l'intervalle résiduel : ce nombre est un budget de calcul, pas une tolérance
   supposée. Les coupures de clipping doivent rester strictement hors de la bande.
7. Bande x obtenue, affichée avec arrondi **vers l'extérieur** :
   `[308.655722524242, 310.441895627776]`.
   Elle reste entièrement entre les bandes des graduations 16 et 17 LU.
   L'orientation de l'axe LU, croissant vers la gauche, donne `[16,17]` sans
   interpolation entre graduations ni arrondi de `16.539624`.

Les fractions internes restent exactes ; seuls les nombres du rapport sont
convertis en décimales, avec arrondi sortant effectué par division entière.
Un résultat hors de 10–23 LU ou sans séparation certaine des bandes est refusé.

## Paliers défavorables et domaine strict de ce premier cas

Température calculée à l'altitude réelle h, avec les conversions exactes du moteur
(0.3048 m/ft et décroissance standard 0.0065 °C/m), puis plafond à la graduation
entière supérieure. L'altitude est portée au prochain palier imprimé **sans
recalculer/refroidir la température à h+**.

Le seul domaine qualifié lors de ce premier prototype était :

- `4500 < h ≤ 6000 ft` ; départ `0 ≤ h0 ≤ h` ;
- `5 < T(h) ≤ 6 °C` ;
- l'un des deux PDF qualifiés ci-dessus, et toutes les vérifications géométriques réussies.

Exemple : départ 0 ft, 16.7 °C, altitude réelle 5500 ft :
`T(h)=5.8034 °C`, puis `h+=6000 ft`, `T+=6 °C`, borne inférieure 16 LU.
L'exemple constructeur 6000 ft / 6 °C donne le même encadrement et contient la
lecture manuelle 16.5 LU ; cela ne justifie pas de forcer le moteur existant à 16.5.

En prenant la monotonie documentaire p.5-1 comme prémisse :
`16 ≤ U_PDF(6000,6) ≤ U(h,T(h))`.
La borne est conservatrice relativement au référentiel graphique constructeur.
La validité de l'hypothèse météo/ISA, les inversions et tous les contrôles de
configuration réelle restent indépendants et obligatoires. Aucune garantie de
précision physique du fabricant n'est inventée.

Les autres paliers retournaient `CASE_NOT_YET_QUALIFIED`, même si le script d'audit
possède des échantillons pour eux. Leur certification géométrique n'est pas déduite
par extension de ce premier cas. Aucun raccordement au calcul opérationnel.

## Reproduction ciblée

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/load-performance/kubicek_lu_interval.py \
  --manual /chemin/vers/kubicek-rev23.pdf --altitude-ft 5500 --ground-c 16.7
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s scripts/load-performance -p 'kubicek_lu_interval_test.py' -v
```

Les tests utilisant le manuel local requièrent macOS/Swift ; ils sont signalés
comme ignorés si cette dépendance ou le PDF n'est pas disponible.
