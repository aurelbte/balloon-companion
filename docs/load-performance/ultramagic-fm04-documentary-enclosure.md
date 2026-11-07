# FM04 — prototype documentaire H65 hors production

Source : manuel local FM04 Rev.30, SHA-256
`b6f45b47fce6c7ff74802a260fa03459d8b38f967a5ef1f396132e004374deab`.
Pages ciblées : 5.3 Rev.23 (PDF 42, graphique SI), 5.4 Rev.24 (PDF 43,
mode d'emploi), 5.5 Rev.25 (PDF 44, exemples H65). Pas de nouvel audit global.

> Rapport initial H65, complété par les [lectures directes et refus ISA](ultramagic-fm04-coverage.md).
> La certification générale du transport et des altitudes intermédiaires reste non obtenue.

## Trois niveaux distincts

- **Formule théorique actuelle** : gaz parfaits, pression ISA, enveloppe à 100 °C.
  H65, 20 °C au terrain 300 m, maximum 3000 m :
  6.560262109776423 kg/1000 ft³, soit 426.4170371354675 kg pour 65 milliers
  de ft³ nominaux. Le manuel lit 6.55 et annonce 426 kg. À 10 °C :
  487.8303675742522 kg théoriques contre environ 488 kg dans le texte.
  Les écarts changent de signe : la formule n'est donc pas une borne inférieure
  démontrée. Les constantes et la précision ne sont pas validées par ces exemples.
- **Borne documentaire géométrique** : le prototype encadre uniquement le cas
  illustré à 20 °C. Portance lue dans **[6.5,7] kg/1000 ft³**, borne inférieure
  **6.5**, soit **422.5 kg** de portance totale pour le volume nominal 65 000 ft³.
  Il ne certifie ni une valeur physique non arrondie ni tous les cas FM04.
- **Charge admissible** : aucun résultat disponible par ce prototype. Il faudrait
  encore la validation de méthode, le volume réel Build Standard, les masses
  complètes, MTOM/minima, atterrissage, plaque nacelle, compatibilités et suppléments.
  La masse vide 178 kg du seul exemple n'est pas celle d'un ballon réel arbitraire.
  Aucun calcul de charge utile ou marge admissible n'est publié.

## Construction reproductible

`scripts/load-performance/ultramagic_fm04_enclosure.py` extrait le Form XObject
`Meta159` de la page 42 avec CoreGraphics, après vérification de l'empreinte du PDF.
Les coordonnées décimales sont transformées en fractions exactes. Aucun flottant
ni tolérance empirique dans la géométrie.

La courbe 3000 m est un **contour rempli**, pas une simple ligne de Bézier à
épaissir : le script vérifie les sept copies identiques du contour déjà présent
sur les bandes de clipping de cette page. Il utilise les deux bords, sans inventer
une ligne centrale. Les primitives sont liées aux étiquettes de la page examinée ;
ce n'est pas un lecteur universel de graphiques.

Pour le cas illustré, l'abscisse finale publiée par la construction verte est
385.21 unités locales. La bande prend ±2.3622/2, largeur du trait vert, sans
reconstruire numériquement la parallèle ISA. La chaîne fermée et continue traverse
cette colonne : elle possède un point à gauche et un point à droite.

Chaque segment est subdivisé exactement par de Casteljau à mi-paramètre. Son
polygone de contrôle englobe toute sa géométrie ; on écarte seulement les boîtes
strictement hors de la colonne. Toutes les branches restantes sont conservées,
sans choisir une intersection favorable. Après 24 subdivisions, **toute la boîte
résiduelle** est retenue : 24 est un budget, pas une hypothèse de précision.
Les extrêmes des frontières englobent la section du contour fermé rempli.

Le résultat inclut aussi le trait horizontal vert, sans l'assimiler exactement au
centre de la courbe noire. Bande verticale englobante :
`[314.3889, 48077501370248182504006717/147573952589676412928000]`
(environ 325.786 pour l'extrémité haute ; fraction exacte dans la sortie).

Les bandes pleines de calibration sont :

- graduation 6.5 : y ∈ [308.78,309.96] ;
- graduation 7 : y ∈ [369.33,370.51].

La bande entière calculée reste strictement entre ces bandes. Le clipping local
pertinent, rectangle `[66.216,232.84,553.15,144.46]`, contient toute la zone de
preuve. Aucune interpolation de l'axe ni soustraction d'une erreur observée.
Un encadrement plus étroit **[6.5,6.6] n'est pas démontré** : l'enveloppe complète
atteint au-delà du trait 6.6. Le prototype ne force pas cette lecture.

Le calcul est commun aux coordonnées locales du Form ; aucune transformation
interne `cm` n'est acceptée. Un autre PDF, des contours divergents, une construction
verte modifiée, une calibration/clipping absents ou une séparation insuffisante
produisent un refus. CoreGraphics et l'identification documentaire des primitives
restent des dépendances de confiance. Il n'existe aucune borne publiée sur une
erreur intrinsèque du graphique par rapport à la portance physique.

## Derniers verrous

Le prototype accepte **uniquement** H65 / 20 °C / terrain 300 m / maximum 3000 m /
65 000 ft³ nominaux. Même le cas 10 °C est refusé : il ne dispose pas de cette
construction vectorielle annotée. Le chiffre approximatif 488 kg ne suffit pas à
prouver une borne physique ou une règle d'arrondi.

Pour généraliser, il faut encadrer l'ensemble de la construction prescrite :
intersection au terrain (300 m n'est pas une courbe d'altitude graduée), transport
« parallèle à l'ISA », puis intersection à l'altitude maximale. La page 5.5 décrit
ce geste graphique mais ne publie pas une fonction numérique exacte ou une erreur
maximale pour cette opération. Appliquer simplement −0.0065 °C/m ou interpoler
les courbes ne constitue pas la preuve de son équivalence au graphique FM04.
Une alternative documentaire devrait englober toutes les constructions permises,
prouver leur ordre/monotonie et refuser les cas ambigus ; cela n'est pas établi ici.
Une définition constructeur du calcul (ou des tables officielles avec une règle de
lecture conservatrice) lèverait ce verrou de généralisation. Une garantie de
précision physique reste une preuve différente.

Aucun fichier de production, activation, modèle, courbe existante ou résultat du
moteur n'est modifié. Aucun raccordement à Prépa.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/load-performance/ultramagic_fm04_enclosure.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s scripts/load-performance -p 'ultramagic_fm04_enclosure_test.py' -v
```

Sept tests ciblés : calcul rationnel, conservation des enveloppes résiduelles,
prise en compte de toutes les intersections, identité du PDF, résultat H65,
refus des autres cas et refus des mutations géométriques/documentaires.
Les tests documentaires sont explicitement ignorés si le PDF ou Swift manque.
