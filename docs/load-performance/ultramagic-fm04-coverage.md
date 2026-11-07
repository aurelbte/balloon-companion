# FM04 — extension géométrique et refus de transport non démontré

## Résultat : généralisation partielle uniquement

**Aucun déplacement parallèle ISA général ni construction d'altitude intermédiaire
n'est certifié.** L'outil publie désormais une réponse motivée pour ces demandes,
sans appeler la reconstruction analytique. La borne H65 existante provient toujours
de l'annotation du manuel, pas d'une preuve de transport des courbes.

En revanche, les intersections directes des **huit courbes imprimées** sont
encadrées, lorsque départ et maximum sont à la même altitude imprimée. Le transport
est alors l'identité. Les contours remplis, leur clipping et la calibration sont
réutilisés et étendus ; aucune donnée opérationnelle n'est modifiée.

Source épinglée : `.load-performance-work/manuals/ultramagic-fm04-rev30.pdf`, SHA-256
`b6f45b47fce6c7ff74802a260fa03459d8b38f967a5ef1f396132e004374deab`.
Page 5.3 Rev.23 / PDF 42 : courbes, ISA et annotation. Page 5.5 Rev.25 / PDF 44 :
consigne de construction et exemples H65, repris de l'examen précédent.

## Cas représentatifs examinés avant la grille

Unités : kg/1000 ft³. Une borne concerne la géométrie documentaire, jamais une
charge admissible ou une précision physique constructeur.

| Température terrain | Départ → maximum m AMSL | Résultat |
|---:|---:|---|
| 20 °C | 300 → 3000 | Annotation H65 : [6.5,7], borne 6.5 ; aucune preuve générale ISA |
| 10 °C | 300 → 3000 | Refus : transport ISA et altitude de départ intermédiaire non encadrés |
| 20 °C | 0 → 3000 | Refus : transport ISA non encadré, même avec deux altitudes imprimées |
| 20 °C | 1000 → 3000 | Même refus |
| 20 °C | 500 → 3000 | Refus : transport ISA et altitude intermédiaire |
| 20 °C | 300 → 3500 | Refus : transport ISA et altitudes intermédiaires |
| 20 °C | 500 → 500 | Refus : courbe d'altitude intermédiaire non définie |
| 20 °C | 0 → 0 | Lecture directe [7,7.5], borne 7 |
| 0 °C | 3000 → 3000 | Lecture directe [6.5,7], borne 6.5 |
| −20 °C | 7000 → 7000 | Lecture directe [5,5.5], borne 5 |
| 5 °C | 3000 → 3000 | Lecture directe [5.5,7], large car toute la plage entre ticks 0/10 est englobée |
| 40 °C | 7000 → 7000 | Refus : hors calibration température qualifiée du prototype |

H65 : 6.5 × 65 = **422.5 kg** au volume nominal 65 000 ft³, contre 426 kg publiés.
La formule existante donne 426.4170371354675 kg à 20 °C et 487.8303675742522 kg à
10 °C. Ces comparaisons ne sont ni une tolérance ni une validation de formule.

## Couverture utile et univers exacts

Le [rapport JSON](ultramagic-fm04-coverage.json) contient toutes les entrées, bornes,
fractions exactes et refus. Deux grilles **qui se recouvrent**, à ne pas additionner :

1. **Lectures directes** : huit altitudes imprimées 0,1000,…,7000 m ; départ =
   maximum ; 71 températures entières −40,…,+30 °C. **258 encadrées / 310 refusées
   sur 568**. Refus : 230 clipping, 80 échelle de portance qualifiée/séparation
   des axes insuffisante.
2. **Grille de scénarios** : départ et maximum dans
   {0,300,500,1000,1500,2000,3000,4000,5000,6000,7000}, maximum ≥ départ ;
   températures −40,−30,…,+30 °C. **34 encadrés / 494 refusés sur 528**.
   Les 34 sont **33 lectures directes et l'annotation H65**, aucun nouveau
   transport non trivial. Motifs principaux de refus : 439 transport ISA,
   24 altitude intermédiaire seule, 23 clipping, 8 séparation/échelle de portance.
   Un refus transport peut aussi porter le motif secondaire altitude intermédiaire.

| Altitude directe m | Encadrées / 71 |
|---:|---:|
| 0 | 21 |
| 1000 | 31 |
| 2000 | 31 |
| 3000 | 41 |
| 4000 | 41 |
| 5000 | 41 |
| 6000 | 31 |
| 7000 | 21 |

Ce décompte décrit des grilles explicites, pas un pourcentage de vols réalisables.
La couverture d'un vol avec changement d'altitude n'est **pas** démontrée.

## Encadrements et domaine du prototype

- Huit contours solides associés explicitement aux étiquettes d'altitude. Toutes
  leurs copies doivent être identiques et leur nombre correspondre au PDF épinglé.
  Un contour divergant ou non fermé provoque un refus, sans moyenne des copies.
- Réutilisation des subdivisions rationnelles de Casteljau et enveloppes convexes
  du prototype. Toutes les branches intersectant la colonne sont conservées ; les
  bornes résiduelles après 24 subdivisions restent englobantes. Aucun epsilon de
  comparaison, flottant, ajustement à la formule ou tolérance empirique.
- Existence d'un passage de la chaîne continue dans la colonne vérifiée par des
  points de part et d'autre. Le contour fermé peut avoir plusieurs frontières :
  elles sont toutes englobées, jamais réduites à une intersection favorable.
- Calibration par les **bandes entières** des lignes de grille température
  −40,…,+30 °C espacées de 10 °C. Pour une température entre deux graduations,
  toute la colonne comprise entre ces bandes est conservée, sans fit affine ni
  interpolation. Cela explique certaines bornes volontairement larges.
- Calibration de portance qualifiée limitée ici aux graduations 5,5.5,…,9.5.
  Une borne inférieure n'est produite que si la bande géométrique entière est
  strictement séparée des traits de calibration inférieurs/supérieurs. Les
  valeurs hors de cette sous-échelle sont refusées, jamais rabattues à 5 ou 9.5.
- Suivi exact de la pile `q/Q` et des clipping rectangulaires effectivement actifs
  pour chaque copie. L'union de rectangles **se chevauchant**, chacun couvrant
  toute la colonne, peut couvrir l'enveloppe : seules des copies identiques du
  même contour sont réunies. Une lacune, un simple contact de bords ou une coupure
  de la zone de preuve reste bloquant. Transformations internes ou clipping non
  rectangulaire non pris en charge : refus.
- Les températures non entières sont acceptables par la même règle d'encadrement
  entre ticks ; les grilles publiées ne prétendent pas les échantillonner toutes.
  Le domaine effectivement accepté est le sous-ensemble passant tous ces contrôles.
- Entrées non numériques, départ sous 0 m, maximum au-dessus de 7000 m, maximum
  sous le départ ou température hors des axes −50…+40 °C : refus. Dans ces axes,
  une lecture directe hors de la sous-calibration −40…+30 reste également refusée.

## Pourquoi le transport et les altitudes intermédiaires restent refusés

La page 5.5 demande de tracer une courbe « parallel to the I.S.A. curve ». Les
repères ISA de la page 5.3 sont des tracés pointillés et ne définissent pas une
fonction continue de transport, une règle de translation/offset paramétrée ou
une enveloppe de toutes les constructions admises. Le moteur théorique est une
interprétation, pas une identité démontrée avec cette consigne. Encadrer ses
arrondis numériques ne bornerait que cette interprétation.

Aux altitudes intermédiaires, les courbes supplémentaires ne sont pas publiées
avec une interpolation définie. Deux interpolations différentes peuvent coïncider
sur les courbes imprimées : par exemple les poids s et s² pour s ∈ [0,1]. Elles
donnent des courbes intermédiaires différentes, même si on exige qu'elles restent
entre les extrêmes. Ce constat prouve l'absence d'unicité ; il ne prouve **pas à lui
seul** l'impossibilité d'un encadrement. Un encadrement valide devrait justifier
que toutes les constructions admises restent dans une enveloppe déterminée,
puis propager cette enveloppe pendant tout le transport et prouver les
intersections avec la courbe d'arrivée. Cette inclusion n'est pas démontrée par
les pages examinées. Le prototype ne la transforme pas en hypothèse implicite.

L'annotation H65 à 300 m fournit un chemin dessiné et un point final pour ce
seul exemple ; elle ne définit ni la famille d'altitudes ni la famille ISA.
Le cas froid « approximately 488 kg » ne contient pas de nouveau chemin vectoriel
qui lèverait cette indétermination.

Pour lever ce verrou : une définition constructeur du transport et de la famille
intermédiaire, ou des enveloppes/règles conservatrices documentées permettant
l'inclusion ci-dessus. Cela reste distinct de la précision physique du graphique.

## Vérification et séparation de la production

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/load-performance/ultramagic_fm04_enclosure.py \
  --ground-c 20 --launch-m 0 --maximum-m 3000
PYTHONDONTWRITEBYTECODE=1 python3 scripts/load-performance/ultramagic_fm04_enclosure.py --coverage
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s scripts/load-performance -p 'ultramagic_fm04_enclosure_test.py' -v
```

Le rapport est recalculé et comparé exactement par les tests ciblés ; ceux-ci
vérifient également les refus ISA/intermédiaires, les mutations des données,
les trous de clipping et l'absence de marge/activation. CoreGraphics, le PDF
épinglé et l'association documentaire des primitives restent des dépendances de
confiance. Aucun moteur de production, Cameron, Kubicek, fiche ballon, CHARGE,
UI, PDF de préparation ou activation n'a été modifié.
