# MLM du dossier Maroc — audit des copies locales

Registre de présentation uniquement : aucune validation du moteur de charge, aucune MLM déduite d'une MTOM, d'un volume ou d'un pourcentage. Les valeurs sont les cellules kg originales. La preuve documentaire d'une valeur ne prouve pas son applicabilité à chaque aéronef.

## Sources

- `Manuel-de-Vol-Actuel-FR.pdf` : 98 pages, édition 10, amendement 12 (registre du 03 mai 2013). §2.9.3/4 p.2-4 (PDF 22) : exploitation normale, exception des vols spéciaux. Tableau 1 p.2-6/2-7 (PDF 24/25), types exacts du tableau 5 p.9-1..9-3 (PDF 79..81). SHA-256 `38b5155771e4ed464754c06f23501b6f545f57cd0e2bec70f7e86d988b324fa6`. Le pied de p.2-7 imprime « 03 Mai 2012 » alors que la liste des pages en vigueur indique 2013 : divergence conservée. Le renvoi ancien à « tableau 4 » n'est pas assimilé à une approbation implicite : les types retenus figurent aussi explicitement au tableau 5. Un type absent du tableau 5 français n'est pas ajouté à cette édition depuis une édition ultérieure.
- `.load-performance-work/manuals/cameron-amendment-18.pdf` : Issue 10 Amendment 18, 05 July 2022. §2.9.3/4 p.2-4 A17 (PDF 26), Table 2 p.2-6/2-7 A18 (PDF 28/29), Table 5 p.9-1..9-3 (PDF 83..85). SHA-256 `a2bb81dd8cff59771381a580812ce6e9878c74b0c0aa450981c219abba1b8572`. Les cellules déjà vérifiées du catalogue sont réutilisées sans modifier ce catalogue.
- `MV04ar30.pdf` : 108 pages, FM04 Rev.30 du 21 juillet 2025. SHA-256 `b6f45b47fce6c7ff74802a260fa03459d8b38f967a5ef1f396132e004374deab`. §2.6 p.2.3 Rev.27 (PDF 15) applique à l'atterrissage la colonne Minimum TOM de §5.5 pour les volumes strictement supérieurs à 90000 ft³. Valeurs p.5.8 Rev.29 (PDF 47), révisions confirmées par p.0.4 (PDF 5). La page numérotée 5.5 (PDF 44) contient les exemples, pas la section 5.5. §5.6 contient des R.MTOM distinctes, pas des MLM.

Les petits MZ à minima de décollage numériques (297, 299, 303, 306, 312 kg) ne sont pas ajoutés comme minima d'atterrissage. H-65 et les cellules n/a ne deviennent jamais 0 kg.

Le Z-275 est explicitement à **1247 kg** dans les deux éditions Cameron : 7788 m³, type CB1467, exploitation normale. La MTOM réduite de 1999 kg ne crée pas une autre MLM.

Les copies de base ne prouvent pas la situation documentaire d'un ballon : pages d'identification non personnalisées, liste des suppléments applicables non renseignée. Cameron §8.1/8.3 fait prévaloir les suppléments/données approuvées ; Ultramagic p.0.1/0.2 exige le Build Standard et la documentation des équipements alternatifs. L'actualité universelle du manuel et la compatibilité réglementaire des équipements ne sont pas présumées.

## Applicabilité et limite actuelle

Le registre `moroccoMinimumLandingMassData.ts` comporte 49 types Cameron FR A12, 63 Cameron EN A18 et 24 Ultramagic FM04 R30. Chaque ligne conserve constructeur, modèle exact, variante, volume, valeur/unité, empreinte du manuel, édition, sections, pages imprimées/PDF et conditions. Les éditions ne se remplacent pas implicitement.

`moroccoMinimumLandingMass.ts` accepte une preuve optionnelle `MoroccoLandingMassApplicability`, transmise au générateur par `minimumLandingMassApplicability`. Elle identifie l'empreinte du manuel applicable, la variante, une référence de configuration approuvée et la clé de configuration du ballon ; elle confirme l'applicabilité, l'exploitation normale et la revue des suppléments sans modification MLM. Modèle, constructeur et volume doivent correspondre exactement. Un changement d'aéronef, de variante ou de masses/équipements enregistrés invalide la clé de revue.

Le booléen MTOM `configurationLimitsConfirmed`, le statut de validation du moteur de portance et les noms des pièces jointes ne constituent pas cette preuve. Le dialogue PAX Maroc permet de choisir explicitement l'édition, de saisir une référence de configuration/revue et de confirmer toutes les conditions et les suppléments sans modification de MLM. Aucune confirmation n'est cochée par défaut. Cette revue est sauvegardée avec le brouillon de préparation PAX, puis transmise au générateur. Sans preuve transmise, le champ reste vide avec « À vérifier dans le manuel de vol ».

La preuve comporte aussi `documentaryRuleKey`, empreinte structurée de l'entrée entière du registre (modèle/variante, valeur/unité, source, édition, sections/pages et conditions). Une confirmation ancienne sans cette liaison, une modification de l'entrée documentaire, du choix d'édition ou de la référence saisie, ou un changement de configuration révoque le préremplissage ; une nouvelle revue explicite est nécessaire. Le champ PDF existant reste modifiable indépendamment des calculs, sans JavaScript.

## Valeurs documentaires (kg)

Le regroupement ci-dessous sert à la lecture. Les éditions et conditions restent propres à chaque ligne exacte du registre ; tous les types d'un groupe ne sont pas nécessairement documentés dans chaque édition.

| Constructeur | Modèles documentés | MLM (kg) | Copies locales du groupe |
|---|---|---:|---|
| Cameron | A105, N105, O105, Sport105, Z105 | 476 | EN A18, FR A12 |
| Cameron | A120, N120, O120, Z120 | 544 | EN A18, FR A12 |
| Cameron | A140, O140, Z140 | 635 | EN A18, FR A12 |
| Cameron | A150, Z150 | 681 | EN A18, FR A12 |
| Cameron | A160, N160, O160, Z160 | 726 | EN A18, FR A12 |
| Cameron | A180, N180, Z180 | 817 | EN A18, FR A12 |
| Cameron | A200 | 909 | EN A18, FR A12 |
| Cameron | A210, N210, Z210 | 952 | EN A18, FR A12 |
| Cameron | A225, Z225 | 1021 | EN A18, FR A12 |
| Cameron | A250, Z250 | 1134 | EN A18, FR A12 |
| Cameron | A275, Z275 | 1247 | EN A18, FR A12 |
| Cameron | A300 | 1361 | EN A18, FR A12 |
| Cameron | A315, A340, Z315 | 1429 | EN A18, FR A12 |
| Cameron | A340HL, Z340HL | 1542 | EN A18, FR A12 |
| Cameron | A370, Z370 | 1678 | EN A18 |
| Cameron | A375, Z375 | 1700 | EN A18, FR A12 |
| Cameron | A400, Z400 | 1814 | EN A18, FR A12 |
| Cameron | A415 | 1882 | EN A18, FR A12 |
| Cameron | A425LW, Z420LW, Z425LW | 1831 | EN A18, FR A12 |
| Cameron | A450LW | 1907 | EN A18, FR A12 |
| Cameron | A500LW | 2120 | EN A18 |
| Cameron | A530LW, A530 | 2404 | EN A18, FR A12 |
| Cameron | N133, Z133 | 603 | EN A18, FR A12 |
| Cameron | N145, Z145 | 658 | EN A18, FR A12 |
| Cameron | Z350 | 1588 | EN A18, FR A12 |
| Cameron | Z450, Z450S | 2041 | EN A18, FR A12 |
| Cameron | Z500 | 2268 | EN A18 |
| Cameron | Z550 | 2495 | EN A18 |
| Cameron | Z600, Z650 | 2545 | EN A18, FR A12 |
| Cameron | Z750 | 3062 | EN A18, FR A12 |
| Ultramagic | S105, V105, M105 | 480 | FM04 R30 |
| Ultramagic | S130, M130 | 588 | FM04 R30 |
| Ultramagic | S160, M160 | 728 | FM04 R30 |
| Ultramagic | M120 | 544 | FM04 R30 |
| Ultramagic | M145 | 656 | FM04 R30 |
| Ultramagic | N180, T180 | 816 | FM04 R30 |
| Ultramagic | N210, T210 | 960 | FM04 R30 |
| Ultramagic | N250 | 1120 | FM04 R30 |
| Ultramagic | N300 | 1360 | FM04 R30 |
| Ultramagic | N355, N370 | 1600 | FM04 R30 |
| Ultramagic | N390 | 1760 | FM04 R30 |
| Ultramagic | N415 | 1805 | FM04 R30 |
| Ultramagic | N425, N450 | 1920 | FM04 R30 |
| Ultramagic | N500 | 2300 | FM04 R30 |
| Ultramagic | N550 | 2500 | FM04 R30 |
| Ultramagic | T150 | 679 | FM04 R30 |
