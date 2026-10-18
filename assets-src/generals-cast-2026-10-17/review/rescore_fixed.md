# Re-score of every live figure, FIXED deform metric (scripts/lib/deform.mjs, pose() parent-matrix fix), 2026-10-17

score = max(stretchP99/0.35, collapse/0.03, pierce/0.04) over every frame at 30 fps; **bold = over the 0.3 promotion threshold**. Earlier removals decided on the buggy metric are void.

## Live figures as found (before the t4f swap)

| figure | idle_sword | command_sword | attack_sword | idle_spear | attack_spear | idle_bow | command_bow | attack_bow | over |
|---|---|---|---|---|---|---|---|---|---|
| anwi__joseon_eorin | 0.11 | **0.42** | **2.26** | 0.11 | **0.80** | 0.06 | **0.42** | 0.21 | command_sword, attack_sword, attack_spear, command_bow |
| baeseol__joseon_gyeongbeon | 0.10 | 0.22 | **1.98** | 0.12 | **0.61** | 0.06 | 0.22 | **0.44** | attack_sword, attack_spear, attack_bow |
| chenlin__chenlin_dudok | 0.10 | 0.18 | **3.05** | 0.13 | **0.67** | 0.05 | 0.18 | 0.15 | attack_sword, attack_spear |
| deng__deng_nojang | 0.11 | 0.29 | 0.26 | 0.14 | **1.24** | 0.07 | 0.29 | 0.19 | attack_spear |
| eo__joseon_dujeong | 0.11 | 0.30 | 0.27 | 0.14 | **1.14** | 0.06 | 0.30 | 0.21 | attack_spear |
| eokgi__eokgi_cheonggap | 0.12 | **0.37** | 0.30 | 0.11 | **1.16** | 0.08 | **0.37** | 0.19 | command_sword, attack_spear, command_bow |
| iwan__yi_tongjesa | 0.03 | **0.45** | 0.17 | 0.15 | **1.16** | 0.04 | **0.45** | 0.09 | command_sword, attack_spear, command_bow |
| iyeongnam__joseon_dujeong | 0.10 | 0.24 | **2.57** | 0.11 | **0.72** | 0.07 | 0.24 | 0.22 | attack_sword, attack_spear |
| jeongun__joseon_dujeong | 0.08 | **0.74** | 0.26 | 0.09 | **0.37** | 0.08 | **0.74** | 0.24 | command_sword, attack_spear, command_bow |
| jijin__ming_swaeja | 0.08 | **0.58** | **2.69** | 0.07 | **0.93** | 0.04 | **0.58** | 0.17 | command_sword, attack_sword, attack_spear, command_bow |
| kato__kato_teppo | 0.11 | **0.31** | **0.33** | 0.12 | **1.22** | 0.02 | **0.31** | 0.30 | command_sword, attack_sword, attack_spear, command_bow |
| kimwan__joseon_pigap | 0.10 | 0.22 | 0.26 | 0.16 | **0.56** | 0.10 | 0.22 | 0.23 | attack_spear |
| konishi__konishi_gin | 0.20 | 0.23 | **0.36** | 0.16 | **0.54** | 0.12 | 0.23 | 0.28 | attack_sword, attack_spear |
| kuki__kuki_tetsu | 0.12 | **0.47** | **0.51** | 0.16 | **1.14** | 0.05 | **0.47** | **0.34** | command_sword, attack_sword, attack_spear, command_bow, attack_bow |
| kurushima__japan_oyoroi | 0.10 | **0.46** | **0.51** | 0.09 | **0.65** | 0.05 | **0.46** | 0.30 | command_sword, attack_sword, attack_spear, command_bow |
| kwon__joseon_gyeongbeon | 0.13 | **0.42** | **2.60** | 0.13 | **1.03** | 0.09 | **0.42** | 0.19 | command_sword, attack_sword, attack_spear, command_bow |
| lirusong__ming_sanmun | 0.09 | **0.95** | 0.24 | 0.10 | **0.64** | 0.11 | **0.95** | 0.17 | command_sword, attack_spear, command_bow |
| liuting__ming_dingjia | 0.13 | 0.25 | 0.19 | 0.12 | **0.73** | 0.09 | 0.25 | 0.20 | attack_spear |
| magui__ming_yuyeop | 0.14 | **0.44** | 0.24 | 0.15 | **1.15** | 0.07 | **0.44** | 0.23 | command_sword, attack_spear, command_bow |
| michiyuki__japan_haramaki | 0.08 | 0.22 | **0.48** | 0.12 | **0.81** | 0.06 | 0.22 | 0.19 | attack_sword, attack_spear |
| nadaeyong__joseon_dujeong | 0.07 | 0.25 | **2.34** | 0.13 | **0.48** | 0.05 | 0.25 | 0.21 | attack_sword, attack_spear |
| shimazu__shimazu_oni | 0.16 | 0.29 | 0.30 | 0.13 | **1.13** | 0.10 | 0.29 | 0.23 | attack_spear |
| songhuirip__joseon_swaeja | 0.08 | **0.33** | 0.17 | 0.12 | **1.61** | 0.07 | **0.33** | 0.28 | command_sword, attack_spear, command_bow |
| todo__todo_tokan | 0.05 | 0.19 | 0.22 | 0.07 | **0.48** | 0.02 | 0.19 | 0.14 | attack_spear |
| wakisaka__wakisaka_shichihon | 0.09 | 0.25 | 0.25 | 0.10 | **1.06** | 0.06 | 0.25 | 0.19 | attack_spear |
| won__won_heukcheol | 0.15 | 0.27 | **2.70** | 0.12 | **0.93** | 0.06 | 0.27 | 0.19 | attack_sword, attack_spear |
| wuweizhong__ming_dingjia | 0.12 | 0.26 | **2.67** | 0.11 | **1.46** | 0.11 | 0.26 | 0.26 | attack_sword, attack_spear |
| yanghao__ming_myeongap | 0.12 | **0.42** | 0.28 | 0.11 | **1.16** | 0.10 | **0.42** | **0.34** | command_sword, attack_spear, command_bow, attack_bow |
| yi__yi_tongjesa | 0.12 | **0.38** | 0.19 | 0.09 | **1.28** | 0.06 | **0.38** | 0.21 | command_sword, attack_spear, command_bow |

## The 3 confirmed figures after the swap (t4f: idle 249 Idle_9, command 412 victory, attack 242 Charged_Slash, archery 226 Archery_Shot_2)

| figure | idle_sword | command_sword | attack_sword | idle_spear | attack_spear | idle_bow | command_bow | attack_bow | over |
|---|---|---|---|---|---|---|---|---|---|
| yi__yi_tongjesa (t4f) | 0.07 | 0.14 | 0.19 | 0.09 | **1.28** | 0.06 | **0.38** | 0.23 | attack_spear, command_bow |
| wakisaka__wakisaka_shichihon (t4f) | 0.08 | 0.10 | 0.25 | 0.10 | **1.06** | 0.06 | 0.25 | 0.19 | attack_spear |
| chenlin__chenlin_dudok (t4f) | 0.08 | 0.12 | 0.24 | 0.13 | **0.67** | 0.05 | 0.18 | 0.15 | attack_spear |

## Over-threshold count per clip (live as found, 29 figures)

- idle_sword: 0
- command_sword: 14
- attack_sword: 14
- idle_spear: 0
- attack_spear: 29
- idle_bow: 0
- command_bow: 14
- attack_bow: 3

Note: the chenlin row above is his previous attack (92 Double Combo Attack, 3.05); 242 Charged Slash scores 0.24 on his body with the fixed metric, so 242 is used and the 219/97 fallbacks (0.48 / 0.71) were not needed.
