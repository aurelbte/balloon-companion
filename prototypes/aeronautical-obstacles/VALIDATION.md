# Validation locale des trois zones

Sources des études du 15/11/2026 : SIA cycle 29/10/2026, Géorisques téléchargé le
15/11/2026, OSM snapshot 14/11/2026 21:20:41 UTC. Pas de nouveau téléchargement.
Ces dates ne sont pas des dates de vérification terrain.

| Zone | SIA | Géorisques | OSM retenu | Supports électriques OSM exclus | Tracés natifs |
|---|---:|---:|---:|---:|---:|
| Preuseville | 100 | 122 | 157 | 242 | 0 |
| Le Havre | 8 | 0 | 405 | 1712 | 0 |
| Grenoble | 6 | 0 | 778 | 4723 | 62 |

Comptes de fiches/représentations, pas d'obstacles physiques. Les zéros Géorisques
correspondent à des extraits locaux vides avec CSV national présent et vérifié.

## Le Havre

- 95 torchères et 27 cheminées OSM ; leur type source reste distinct dans la catégorie commune.
- Les 13 grues/portiques n'ont ni hauteur renseignée ni permanence documentée.
  Sept sont mobiles sur rails ; aucune n'est transformée en chantier temporaire.
- SIA 76028 et 76034 : `NOMBRE=2`, portée `group`, géométrie `group_point`.
  76028 décrit deux cheminées ; les deux fiches OSM 69875855/69875893 restent des
  composants candidats, sans troisième cheminée ou correspondance individuelle démontrée.
- SIA 76049 (« château d'eau + pylône ») et 76052 (« silo + mât ») : portée composite.
  Leur hauteur publiée ne remplace pas la dimension d'un composant OSM.
- Bâtiments et parties restent distincts. `building:part=no` n'est pas une partie :
  correction d'une catégorisation trop large de l'étude, sans retrait de la fiche.
- L'« Unité 4 » conserve sa désaffectation mais reste de présence physique inconnue ;
  `end_date` ne devient pas une date de disparition des structures.

## Grenoble

- 62 routes OSM, dont 9 tyroliennes, conservées sommet par sommet ; 319 supports restent
  des points distincts. Sept routes sont déclarées désaffectées et ne sont pas supprimées :
  cinq avec préfixe `disused:aerialway`, plus 128191255 et 181562097 avec `disused=yes`.
  Le rapport initial ne comptait que les cinq premières ; le prototype conserve les sept.
- SIA 38021 et 38022 restent ponctuels et représentatifs. Les gares décrites dans les
  remarques ne sont pas reliées pour fabriquer un tracé ou un profil 3D.
- 38022 : 71,9328 m AGL publiés et 2229,9168 m AMSL IGN69 publiés restent séparés.
  Aucune de ces valeurs n'est appliquée à chaque sommet d'une ligne OSM.
- Les associations SIA–tracé sont des rapprochements 2D ambigus, sans identité physique
  attestée ni comparaison verticale point/ligne. Les supports ne sont pas des doublons de câbles.
- SIA 38015 (bâtiment + antennes) et 38010 (tour + pylône) sont composites.
- L'ouvrage hydraulique OSM 9291321377 conserve sa dimension brute de 180 m ;
  AGL et sommet restent inconnus. Reliefs et obstacles de chemin sont exclus explicitement.

## Adaptations du modèle commun

1. `recordScope` distingue fiche simple, groupe, composite, composant et inconnu.
2. `possible_representation` représente une association ambiguë groupe/composant ou point/tracé.
3. `distanceMethod` distingue distance point–point, approximation locale point–segment et absence
   de calcul. Ce champ n'est pas une précision géométrique ou une distance de sécurité.
4. Le normaliseur accepte désormais bâtiments/parties, grues maritimes, ouvrages hydrauliques,
   variantes de cycle de vie et tyroliennes ; aucun deuxième modèle ou pipeline.

Valeurs originales, inconnus, incertitudes et dépendance non établie des sources restent conservés.
Aucune moyenne, altitude inférée ou fusion automatique. Les écarts de dimensions >5 m sont des
signaux de revue, pas une tolérance réglementaire ni une preuve d'erreur d'une source.

## Limites avant tuilage R2

- Réextraire les emprises surfaciques manquantes et séparer l'ancrage de symbole de la géométrie native.
  Le contrat actuel reste limité aux points et lignes demandés.
- Sélectionner les câbles par intersection dès l'extraction PBF : les études par centroïde peuvent
  omettre des traversées. Aucun profil vertical complet ou dégagement au sol n'est établi.
- Documenter les relations site/composant et support/câble ; valider les rapprochements.
- Définir les identifiants de fragments, frontières, niveaux de détail, budgets mémoire et états
  de couverture/erreur avant tout branchement. Rien n'est intégré aux cartes à cette étape.
- Vérifier redistribution/attributions et politique de fraîcheur AIRAC/OSM/Géorisques ;
  ces inventaires ne couvrent pas seuls les obstacles temporaires et NOTAM.
- Les variantes éliminées en amont ne sont pas récupérables. Les JSON des deux nouvelles études
  n'avaient pas d'empreinte pré-attestée : elle est capturée maintenant, sans prétendre à une réextraction.

L'absence de fiche ne garantit jamais l'absence d'obstacle.
