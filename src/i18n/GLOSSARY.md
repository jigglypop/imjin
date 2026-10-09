# Copy and translation guide

Korean is the source language. Every player-facing string goes through `t()` (React: `const t = useT()`), keyed by
its exact Korean text; English lives in `src/i18n/en/<area>.ts`. Placeholders: `{n}`, and `{name|이/가}` where Korean
needs a particle chosen from the word (pairs: 이/가, 은/는, 을/를, 과/와, 으로/로). English templates use plain `{name}`.
Data strings that live in `src/sim` (scenario titles, ship and gun names, place names) stay Korean in the data and are
passed through `t()` where they are shown.

## Korean style (문체 기준)
- Descriptions, help, toasts, notices, tooltips: 합니다체, one or two plain sentences. Never mix 하십시오체 (~하십시오),
  해요체 (~해요) or literary plain forms (~한다, ~이다, ~간다) in UI text.
- Buttons and labels: short nouns or verbs without endings (전투 시작, 다시 시작, 뒤로, 설정, 나가기, 저장).
- No archaic or poetic phrasing in UI (그날의 바다에서 치른다, 넓혀 가는, 돌아온다, 무주). Historical event narration may
  keep a light historical tone but must read naturally.
- Quotations of historical figures (the loading quotes, Yi Sun-sin's words) are not UI copy: keep their traditional
  wording and register (죽고자 하면 살 것이요, 살고자 하면 죽을 것이다 / 신에게는 아직 열두 척의 배가 남아 있사옵니다 /
  나의 죽음을 알리지 말라). Never convert them to 합니다체.
- Standard spacing (띄어쓰기) and punctuation: units attach to numbers (12척, 3턴, 35%); use `·` as a separator; avoid
  em dashes inside sentences; no trailing period on buttons and labels; periods on full sentences.
- One term per concept:
  함선 (a ship) · 함대 (fleet) · 전대/편대 → 함대 · 거점 (capture point) · 군영 · 선소 · 포대 · 수리소 · 창고 · 봉수대 ·
  조선 수군 / 일본 수군 / 명 수군 (never 왜군 or 倭 in UI; 왜선 → 일본 함선) · 승리 / 패배 · 장수 (commander) ·
  도선 (boarding) · 포격 · 진형 · 기동 · 전술 · 배속 (game speed) · 빠른 접근 (approach fast-forward)

## English style
- Concise, modern UI English. Sentence case for buttons and labels (Start battle, Back, Settings); Title Case only
  for mode names and proper nouns (Historical Battles, Faction Campaign, Conquest, Online Battle).
- Korean names in the usual romanization (Yi Sun-sin, Won Gyun, Yi Eok-gi, Jeong Un); Japanese in Hepburn
  (Wakisaka Yasuharu, Kuki Yoshitaka, Todo Takatora, Kurushima Michifusa); Chinese in pinyin (Chen Lin, Deng Zilong).
- Keep it as short as the Korean where space is tight (HUD, buttons): English runs about 1.3-1.8x longer.

## Terms
| Korean | English |
|---|---|
| 임진 해전 / 壬辰海戰 | Imjin War at Sea |
| 역사 전투 | Historical Battles |
| 진영 전역 | Faction Campaign |
| 쟁탈전 | Conquest |
| 온라인 대전 | Online Battle |
| 1592 전역 (연속 전투) | 1592 Campaign |
| 조선 / 일본 / 명 | Joseon / Japan / Ming |
| 조선 수군 / 일본 수군 / 명 수군 | Joseon Navy / Japanese Navy / Ming Navy |
| 판옥선 | Panokseon |
| 거북선 | Turtle ship |
| 협선 | Hyeopseon (scout boat) |
| 아타케부네 / 대선 | Atakebune |
| 세키부네 / 중선 | Sekibune |
| 고바야 / 소선 | Kobaya |
| 명 대형선 / 소형선 | Ming war junk / Ming small junk |
| 천자총통 / 지자총통 / 현자총통 / 황자총통 / 승자총통 | Cheonja / Jija / Hyeonja / Hwangja / Seungja cannon |
| 대장군전 | Great general arrow |
| 조총 | Arquebus |
| 학익진 / 일자진 / 장사진 / 첨자진 / 자유교전 | Crane Wing / Line Abreast / Long Snake / Wedge / Free Engagement |
| 거점 / 본영 | Capture point / Home port |
| 군영 / 선소 / 포대 / 수리소 / 창고 / 봉수대 | Camp / Shipyard / Battery / Dock / Depot / Beacon |
| 군자금 / 은 | Funds / Silver |
| 기세 | Momentum |
| 도선 / 등선 방어 | Boarding / Repel boarders |
| 빠른 접근 | Fast approach |
| 배속 | Speed |
| 선내 보기 | Cutaway |
| 연출 카메라 / 슬로모션 | Cinematic camera / Slow motion |
| 명량 / 한산도 / 노량 / 옥포 / 사천 / 당포 / 안골포 / 부산포 / 칠천량 | Myeongnyang / Hansando / Noryang / Okpo / Sacheon / Dangpo / Angolpo / Busanpo / Chilcheollyang |
| 울돌목 / 견내량 | Uldolmok Strait / Gyeonnaeryang Strait |
| 쓰시마 / 나고야 / 산둥 / 요동 | Tsushima / Nagoya / Shandong / Liaodong |
