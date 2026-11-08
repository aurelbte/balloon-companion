# Préparation Maroc - PDF AVB

Le bouton « Maroc PDF » près du bouton de dossier existant utilise un générateur et un export dédiés :

- `app/lib/moroccoFlightDossierPdf.ts` : copie indépendante du générateur de préparation, titre daté au jour prévu du décollage dans le fuseau du terrain (UTC si absent), logo AVB.
- `app/lib/moroccoFlightDossierExport.ts` : export `preparation-maroc_…pdf`, annulation et carte dégradée conservées.
- `app/lib/moroccoChecklistAsset.ts` : checklist source et logo PNG extraits, embarqués en base64 pour éviter tout chargement réseau de ces ressources.
- `app/lib/moroccoChecklistFields.ts` : positions des 39 champs AcroForm (20 en page 1, 19 en page 2).
- `app/components/FlightDossierAction.tsx` : choix explicite via le bouton Maroc. Le bouton de dossier existant appelle toujours le générateur France.

Les fichiers `flightDossierPdf.ts` et `flightDossierExport.ts` ne sont pas modifiés.

## Source

PDF local utilisé : `/Users/aurelienboitte/Downloads/Check list (1).pdf`, version du 7 novembre 2026 à 18:50, 2 pages.
SHA-256 : `ff657189af9f938a30cb98c5508bb7611242b2f39ceea1fc3877a682b0d6ef52`.
L'autre copie locale, `Check list.pdf`, est antérieure (18:20).

Le PDF source complet est conservé dans les deux premières pages, avec ses rubriques, libellés et logos. Seules les cases imprimées sont recouvertes pour recevoir les widgets interactifs ; neuf cases supplémentaires permettent de vérifier séparément les équipements a-i. Le logo PNG repris sur la première page de préparation provient de l'image X11 de la première page source.

La rubrique de vérification « Passagers » de la checklist est conservée ; aucune liste nominative de passagers n'est ajoutée.

## Champs et hors ligne

39 champs distincts `/Btn`, non verrouillés, avec états `/Off` et `/Yes` et apparences explicites. Aucun aplatissement, script PDF ou appel distant n'est nécessaire pour les cocher, les décocher ou sauvegarder le document exporté. Un lecteur PDF prenant en charge les formulaires reste nécessaire. La récupération météo et cartographique de l'application garde son fonctionnement existant ; ce travail ne rend pas ces services accessibles sans réseau.

## Vérification ciblée

```sh
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test app/lib/moroccoFlightDossierPdf.test.mjs app/lib/flightDossierPdf.test.mjs
```

Les tests Maroc contrôlent les pages AVB, les 39 champs et widgets, leurs apparences, les cycles de sauvegarde cochés/décochés, l'indépendance des cases, la date dans le fuseau du terrain, le maintien du générateur France et le nom de fichier Maroc avec erreurs/annulation.

QA locale complémentaire : rendu des pages avec PDFKit et lecture des champs canoniques et annotations avec pypdf ; sauvegarde des 39 cases cochées puis décochées avec pypdf, sans accès réseau. Le contrôle des états et des apparences passe avec pdf-lib et pypdf. Pas de validation manuelle dans un lecteur graphique. Une tentative de sauvegarde via l’API programmatique PDFKit conserve des apparences incohérentes ; elle ne constitue pas une validation de sauvegarde interlecteurs.

Résultats : 4 tests Maroc réussis ; lint des nouveaux modules réussi. La suite France existante présente un échec sur sa limite de pagination (6 pages au lieu du maximum attendu). Le lint du composant partagé signale un `setState` préexistant dans `useEffect`, hors lignes modifiées.
