# Raccordement technique des moteurs de charge — 7 novembre 2026

## Décision et portée

**Aucune nouvelle activation.** Les 50 paramètres Ultramagic et 80 Kubicek restent candidats.
Les 28 paramètres Cameron conservent leur activation « Validation pilote », leur chemin
`calculatePilotValidationLoad`, leurs calculs et leurs limites actuelles. Ce maintien ne
constitue pas une nouvelle certification de Cameron : la liste officielle reste vide.

`calculateOfficialLoad` conserve ses contrôles d'entrée, puis route uniquement Ultramagic et
Kubicek vers leurs diagnostics constructeurs. `NON_VALIDÉ` devient `UNAVAILABLE` /
`PENDING_VERIFICATION`, reconnu par l'UI existante, avec référence, raisons et sans kilogrammes
admissibles. Les modèles absents restent `UNSUPPORTED_MODEL`. Le routage ne propage pas les
valeurs théoriques à l'UI et ne transforme jamais un candidat en `OFFICIAL_VALIDATED`.

L'activation exige une entrée de dépôt dans `enabledOfficialLoadParameterCombinations`,
correspondant exactement à méthode / identifiant du paramètre modèle / révision, les quatre
preuves existantes (`methodValidated`, `modelParametersVerified`, `sourcesTraceable`,
`targetedTestsPassing`), et un paramètre `VERIFIED_FROM_OFFICIAL_MANUAL`. Le résultat du moteur
doit aussi être lui-même `OFFICIAL_VALIDATED` pour cette identité. Une entrée de registre,
un checkbox de configuration ou une preuve fournie par l'appelant ne remplace jamais les
contrôles des documents du ballon réel. Aujourd'hui aucune entrée ne satisfait ces exigences.

## Ultramagic FM04 Rev.30

Source locale : `.load-performance-work/manuals/ultramagic-fm04-rev30.pdf`, SHA-256
`b6f45b47fce6c7ff74802a260fa03459d8b38f967a5ef1f396132e004374deab`.
Les révisions imprimées des pages diffèrent de celle du manuel assemblé :
5.3 Rev.23, 5.4 Rev.24, 5.5 Rev.25, compatibilités 5.6 Rev.27 / 5.7 Rev.30,
minima 5.8 Rev.30 et charge nacelle 5.9 Rev.27.

- Confirmé : graphique à température interne 100 °C (5.3/5.4), lecture parallèle à l'ISA
  et exemples H65 (5.5), limites par modèle/minima (5.8), plaque de nacelle prioritaire et
  charge hors nacelle vide (5.9), volumes et masses documentaires (5.1/5.2).
- Le calcul candidat utilise `Tmax = Tsol - 0.0065 × (zmax-zsol)`, pression ISA
  `101325 × (1-0.0065×zmax/288.15)^(g/(R×0.0065))`, puis gaz parfaits et Archimède,
  avec `R=287.05`, `g=9.80665`, kelvin = °C + 273.15 et 1000 ft³ = 28.316846592 m³.
  **Ces coefficients et cette reconstruction analytique ne sont pas une formule FM04 publiée.**
- Exemple H65 : terrain 300 m, maximum 3000 m, 20 °C : manuel 6.55 kg/1000 ft³,
  426 kg pour 65000 ft³ ; candidat 6.560262109776423, soit 426.4170371354675 kg
  pour ce volume nominal. Avec le volume métrique du registre, 1840 m³ : 426.2791848227497 kg.
  À 10 °C : manuel environ 488 kg ; candidat 487.8303675742522 kg au volume nominal,
  ou 487.67266152940033 kg pour 1840 m³. Ne pas mélanger volume nominal et conversion métrique.
  La note du manuel accepte qualitativement des écarts graphiques négligeables, sans fournir
  de tolérance chiffrée. Les anciens seuils de tests ±1 kg / ±0.02 LU ne prouvaient donc rien.
- Domaine désormais borné aux axes/courbes imprimés : valeurs finies, départ et maximum entre
  0 et 7000 m AMSL, maximum au-dessus du terrain, température du départ et à l’altitude maximale
  entre -50 et +40 °C, portance calculée aux deux extrémités dans la fenêtre 4.5–10 kg/1000 ft³.
  Tout dépassement est refusé, sans écrêtage ni arrondi. La page 5.3 montre -50 à +40 °C,
  des courbes du niveau de la mer à 7000 m AMSL et une fenêtre de lecture 4.5–10 kg/1000 ft³ ;
  les courbes sont tronquées à cette fenêtre, pas un domaine rectangulaire d’extrapolation.
  Pas de validation par les seuls
  deux exemples ni de comparaison indépendante FlightPack de tous les domaines.
- Sécurité codée : plafond MTOM, approbation de MTOM réduite, Build Standard, inventaire complet,
  minima numériques/n/a/non indiqués, atterrissage lorsque documenté, plaque et charge nacelle,
  compatibilité nacelle ET brûleur, suppléments. Les références saisies ne sont pas authentifiées.
- Lacunes spécifiques : minima non indiqués pour H56, H65, V56, V65, M56, M56C, M65, M65C ;
  compatibilités non documentées dans les lignes transcrites pour M56Z/M60Z/M65Z/M70Z/M74Z et G90.
  Aucune extension implicite de famille. Toutes les configurations réelles restent à prouver.
- Blocage commun maintenu : `METHOD_NOT_VALIDATED`. Ni T150/CN-CHA ni aucun autre modèle activé.

## Kubicek B.3102 Ed.3 Rev.22

Source locale : `.load-performance-work/manuals/kubicek-b3102-rev22.pdf`, SHA-256
`c32dd501b7761b1b03974aa8e39b6d4e20efc9e304c1a520ecc37c03bf721c30`.

- 79 tables kg / 1106 valeurs historiques inchangées, plus BB74Z ; 5-4 Rev.22 (kg),
  5-5 Rev.22 (lb, non utilisée), 2-5 Rev.22 (MTOW/MLW), 8-1 Rev.15 / 8-2 Rev.22 (volumes).
- Graphique 5-3 Rev.17 : 15 courbes, 713 points existants comparés au PDF Rev.22,
  sept intersections indépendantes consignées dans `kubicek-b3102-ed3-rev22-loading-chart-check.json`.
  Écart maximal environ 0.000015 LU, sans modifier le JSON source ni arrondir les LU.
  Reproduction : `python3 scripts/load-performance/verify-kubicek-loading-chart.py` (macOS/Swift,
  lecture seule ; script conservé tel quel, rapport sur stdout). Aucun seuil fabricant inventé.
- Instruction : décroissance 0.65 °C/100 m seulement si température à l'altitude inconnue (5-1 Rev.0) ;
  inversion à traiter explicitement. Interpolation de la table LU justifiée par l'exemple
  5-2 Rev.16 : 16 LU = 517 kg, 17 = 549 kg, 16.5 = 533 kg pour BB20.
  Le point extrait 6000 ft / 6 °C reste 16.539624, soit 534.267968 kg théoriques.
  Pas de règle constructeur chiffrée justifiant d'arrondir systématiquement à une décimale.
- Domaine : pas d'extrapolation hors des points disponibles, 0–30000 ft, températures
  propres à chaque courbe (plus étroites que le rectangle -40–35 °C), LU 10–23.
  Interpolation linéaire entre échantillons de température et courbes d'altitude : choix
  numérique encore à valider, distinct de l'interpolation explicitement illustrée en table.
- Sécurité codée : modèle-volume exact, MTOW, RMTOW individuelle et seuil constructeur,
  MLW du décollage à l'atterrissage, inventaire complet/cylindres pleins, charge nacelle hors tare,
  limites nacelle S/N ≥400 (2-6 Rev.18 / 2-7 Rev.3), plaque réelle, occupation/implantation des
  cylindres, cadre selon volume et vent (2-10 Rev.22), marquage K50 dès 7400 m³,
  Appendice 6 pour les seuls modèles visés, inversion, suppléments et limites thermiques.
- Lacunes : matrices enveloppe/nacelle et enveloppe/brûleur soumises à revue documentaire
  identifiée, pas entièrement validées automatiquement cellule par cellule ; nacelles S/N <400
  bloquées sans transcription validée de l'Appendice 4. Les références ne sont pas authentifiées.
  Chaque appareil exige ses masses/plaques, RMTOW éventuelle, cadre/brûleur/S/N, occupation,
  masse à l'atterrissage et suppléments. La concordance géométrique ne certifie pas la méthode.
- Blocage commun maintenu : `LU_METHOD_NOT_VALIDATED` ; tous les 80 modèles, BB74Z compris.

## Conditions restant nécessaires à une activation

1. Validation indépendante des formules/interpolations, domaines et précision, avec références
   constructeur et cas bornes/nominal suffisamment probants. Les invariants synthétiques ne
   certifient pas la méthode ; les quotas proposés dans `validationStrategy.ts` ne sont pas une
   exigence ni une approbation du fabricant.
2. Vérification de chaque ligne modèle/variante et des exceptions/suppléments applicables.
3. Contrat de preuves du ballon réel complet et contrôlable ; aucune donnée fictive ou checkbox
   global de fiche ne peut combler les lacunes. Validation des matrices et cas anciens manquants.
4. Puis seulement : statut documentaire vérifié, activation exacte dans le dépôt, moteur capable
   de produire son propre résultat validé après tous ses gardes, et tests de non-régression.


## Vérification numérique complémentaire ciblée

- FM04 : aucune correction des coefficients démontrée par les deux exemples disponibles.
  Le domaine est maintenant strictement borné ; l'ancien cas de test à -10 °C au niveau de
  la mer était au-dessus de la fenêtre graphique (portance >10 kg/1000 ft³). Le contrôle MTOM
  correspondant utilise désormais -1 °C, dans la fenêtre, sans changer son assertion de plafond.
- Kubicek : restitution exacte des 713 nœuds inchangés ; pondération arithmétique contrôlée
  à 25/50/75 % entre températures voisines et entre altitudes lorsque les points vérifiés
  fournissent les bornes. Pas d'arrondi, extrapolation ou changement des Loading Tables.
- Sur les sept segments PDF indépendants déjà disponibles : 21 points fractionnaires
  supplémentaires (paramètres de segment 0.25/0.5/0.75), écart maximal observé entre lecture
  géométrique directe et interpolation du moteur **0.003489400791625741 LU**.
  Cette mesure est un résultat de comparaison, pas une tolérance fabricant ni une borne
  démontrée sur tout le graphique. Les courbes d'altitude intermédiaires ne disposent pas
  d'une validation indépendante constructeur par ces seuls points.
- Dernier verrou de méthode FM04 : validation de la reconstruction analytique et précision
  acceptable non démontrées par les deux exemples H65 (`METHOD_NOT_VALIDATED`).
- Dernier verrou de méthode Kubicek : borne d'erreur acceptable et validité entre courbes
  non démontrées (`LU_METHOD_NOT_VALIDATED`). L'interpolation en table reste confirmée par
  l'exemple BB20 ; le résultat interne 534.267968 kg n'est pas forcé à 533 kg.
- Les verrous propres à chaque appareil restent cumulatifs : Build Standard/configuration,
  masses, minima, nacelle/cadre/brûleur, atterrissage et suppléments. Aucun appareil ne
  possède ici un dossier de preuves complet permettant de lever ces verrous. Aucun modèle
  nouvellement activé ; registres d'activation et Cameron inchangés.
