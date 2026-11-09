# Catalogue Cameron — manuel local Issue 10 Amendment 18

Source : `.load-performance-work/manuals/cameron-amendment-18.pdf`. SHA-256 : `a2bb81dd8cff59771381a580812ce6e9878c74b0c0aa450981c219abba1b8572`.

Tables vérifiées : Table 2, pages 2-6/2-7 (PDF 28/29), et Table 5, pages 9-1/9-2/9-3 (PDF 83/84/85). Le catalogue contient les 104 types exacts de Table 5, soit 93 ajouts aux 11 types précédemment documentés ; 2 anciennes références restent conservées.

Données transcrites : désignation constructeur, numéro de dessin, volumes m³ et ft³, MTOM standard/réduite, MLM si indiquée, classe FAI AX et pages source. Aucun poids de composant, aucune compatibilité d’équipement et aucune approbation de calcul ne sont déduits.

## Modèles ajoutés (clés internes)

- A (24) : `A105`, `A120`, `A140`, `A150`, `A160`, `A180`, `A200`, `A210`, `A225`, `A250`, `A275`, `A300`, `A315`, `A340`, `A340HL`, `A370`, `A375`, `A400`, `A415`, `A425LW`, `A450LW`, `A500LW`, `A530LW`, `A530`.
- C (6) : `C50`, `C60`, `C70`, `C80`, `C90`, `C100`.
- N (15) : `N31`, `N42`, `N56`, `N65`, `N70`, `N77`, `N90`, `N100`, `N105`, `N120`, `N133`, `N145`, `N160`, `N180`, `N210`.
- O (12) : `O26`, `O31`, `O42`, `O56`, `O65`, `O77`, `O84`, `O90`, `O105`, `O120`, `O140`, `O160`.
- Sport (6) : `Sport50`, `Sport60`, `Sport70`, `Sport80`, `Sport90`, `Sport105`.
- TR (5) : `TR60`, `TR65`, `TR70`, `TR77`, `TR84`.
- Z (25) : `Z25`, `Z31`, `Z35`, `Z42`, `Z56`, `Z65`, `Z69`, `Z77`, `Z140`, `Z145`, `Z225`, `Z315`, `Z340HL`, `Z370`, `Z375`, `Z400`, `Z420LW`, `Z425LW`, `Z450`, `Z450S`, `Z500`, `Z550`, `Z600`, `Z650`, `Z750`.

## Références non documentées dans cette édition

- `Z300` : pas de Z-300 en Table 5. La variante 300 existe en Table 2, notamment pour A-300 ; elle ne prouve pas une désignation Z-300.
- `Z425` : pas de Z-425 en Table 5. Z-425LW est documenté séparément et ne remplace pas cette ancienne clé.
- Variantes 240 et 260 : présentes en Table 2 mais sans type exact correspondant en Table 5. Aucun A/Z-240 ou A/Z-260 n’est inventé.

Z300 et Z425 conservent leurs volumes historiques et sont signalés comme anciens/non documentés dans le formulaire. Aucun profil existant n’est renommé ou migré.

## Corrections documentaires des volumes (nouveaux choix uniquement)

Z105 : 2973 → 2974 m³ ; Z133 : 3766 → 3767 ; Z150 : 4247 → 4248 ; Z180 : 5097 → 5098 ; Z250 : 7079 → 7080 ; Z350 : 9911 → 9912. Les volumes déjà saisis ou enregistrés restent inchangés. Z275 reste à 7788 m³.

## Affichage et calculs

Le préfixe Z est retiré uniquement par des helpers UI. Les valeurs des options restent Z105/Z275/etc. Les fonctions de persistance, snapshots, exports, synchronisation et les moteurs ne sont pas modifiés. Le formulaire réhydrate toujours le modèle, volume et MTOM du profil. Les options de MTOM préexistantes et leurs règles restent inchangées. L’ajout au catalogue documentaire n’active aucun nouveau modèle de calcul.

Z105 : 105000 ft³, 2974 m³, MTOM 952/952 kg, MLM 476 kg, dessin CB1345. Z275 : 275000 ft³, 7788 m³, MTOM 2494/1999 kg, MLM 1247 kg, dessin CB1467.
