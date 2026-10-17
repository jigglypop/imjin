# 아키텍처 지도

## 화면과 전투
- `src/App.tsx` 화면들 (store `screen`; 메뉴 아래의 모든 화면은 지연 로드 청크, `src/router.ts`의 `screenChunks`), URL 훅, 전투 `<Canvas>`; `src/state/store.ts` 엔진이 0.15초마다 게시하는 UI 스냅샷
- `src/game/Engine.ts` 전투 하나를 소유: init/stage (하늘, 지형, 함선, 바다, 구름, 승조원), 속도 + 자동 빨리 감기가 있는 고정 스텝 시뮬레이션 루프, 사운드/fx/승조원으로의 이벤트 전달, 스냅샷 게시. `quality.ts` 장비 등급 (high PC / medium 태블릿 / low 폰)과 실행 중 레벨; `adaptive.ts` fps 컨트롤러; `device.ts` 터치/폰 감지
- `src/cinema/` 실행 중인 전투로 렌더링하는 컷신과 다큐멘터리 모드: `scenes/` (노량, 한산, 명량의 오프닝, 노량 클로징)와 `beats.ts` (시뮬레이션 이벤트에 붙는 자막)는 `SOURCES.md`의 기록을 바탕으로 작성됨; `rig.ts`는 함선, 함대, 달에 샷을 맞추고, `CutscenePlayer.ts`는 장면을 재생하며, `Cinema.ts`는 카메라, 속도, 사운드, 필름 그레이드/렌즈(`grade.ts`)를 구동함; `src/ui/CinemaOverlay.tsx`는 레터박스, 자막, 라벨을 그림. 온라인에서는 자막만 나옴

## 시뮬레이션 (`src/sim`, `server/main.ts`와 공유)
- `battle.ts` (함선, AI 판단, 포, 포탄, 등선), `catalog.ts` (SHIP_SPECS, GUN_SPECS), `scenarios.ts` (역사 전투 9개), `conquest.ts` + `maps.ts` + `strategy.ts` (점령 지점 교전 + 컴퓨터 전략가), `balance.ts`, `types.ts` (Ship, BattleEvent)
- 전투 깊이 규칙은 `depth.ts`에서 버전 관리됨 (최신인 depth-v2는 역사 전투, 컴퓨터 상대 쟁탈전, 캠페인의 3D 전투에 켜져 있음; 랭크전과 온라인 쟁탈전은 클래식 규칙을 한 스텝 한 스텝 그대로 유지): `morale.ts` (담력, 동요, 궤주, 재집결, 북, 지휘관 상실), `tactics.ts` (종사, 십자 포화, 진형 결속), `fire.ts` (바람 방향으로 선체 사이를 옮겨 붙는 불), `scripts/test-depth.mjs`로 검사
- depth-v2는 `maneuvers.ts` (명령으로서의 전대 기동: 매복, 협공, 돌파, 원진과 학익진, 봉쇄, 유인, 추격, 북과 징 신호; 위치 유지, 아군 너머로 사격 금지, 항법 규칙, 기함의 지휘 반경과 돌파 차단, 보이는 트인 바다로 달아나는 궤주)와 `tactician.ts` (컴퓨터 지휘관이 기질에 따라 이를 사용)를 추가하며, `scripts/test-maneuvers.mjs`로 검사

## 함선, 이펙트, 환경
- `src/ships/` ShipRenderer (인스턴스 함선, LOD 3단계, 아틀라스 재질), ShipViews (LOD 선택, 파도 움직임, 침몰 자세), decks.ts (갑판 높이/승조원 위치), `build/` (모듈식 부품과 세력별 gpt-image 아틀라스로 만드는 절차적 함선, `scripts/ship-textures.mjs patch`는 개별 셀을 교체; `bake.ts`는 오클루전과 포 그을음을 정점에 굽기), `weather.ts` (영화 소품식 풍화: 닳은 옻칠, 녹, 타르 흘수선, 얼룩진 돛, 잔불 빛), `anchors.ts` (모델별로 three에 의존하지 않는 포문, 갑판, 깃발; 시뮬레이션의 `Battle.muzzle`과 `variantFor`도 이것을 읽음)
- `src/fx/` Effects (포구 화염, 포탄, 피격, 파편), ParticleLayer (CPU 파티클, TSL 스프라이트), Crew (GPU 스키닝으로 구운 승조원; 그룹을 제거하는 것만이 아니라 `Crew.dispose`가 소품을 해제함), Lanterns. 연기, 불, 물보라는 픽셀별 노이즈 옥타브가 아니라 하나의 노이즈 텍스처(`src/fx/particleNoise.ts`)로 셰이딩함
- `src/ocean/` FFT (WebGPU 컴퓨트 전용) 또는 Gerstner 대체; `src/render/` 하늘 (`atmosphereModel.ts`는 로드 시 CPU에서 전투의 태양에 맞춰 물리적 대기를 적분: 배경, 안개, 모든 연무가 읽는 하나의 하늘 뷰, 반사와 주변광을 위한 구름 포함 환경 맵; `skyDome.ts`가 태양, 또는 달과 별과 함께 이를 그림), 구름 (`Clouds.ts`: 바다와 공유하는 날씨 맵으로 레이마칭하고, 지터된 프레임에 걸쳐 누적; 바다는 돌풍, 파군, 구름 그림자를 같은 맵에서 가져옴, `src/ocean/seaFields.ts`)
- `src/terrain/` 워커 하이트맵, 식생, 구조물. 지형은 컬링된 타일로 그려짐; 각 숲 고리는 GPU 구동 나무 셀 그리드지만, `Vegetation.gather`가 CPU에서 화면 근처의 육지 셀만 나열하므로 버텍스 셰이더가 바다나 화면 밖 셀에서는 절대 실행되지 않음 (프레임당 2200만 삼각형이 400만이 됨)

## 오디오 (`src/audio`)
Sound.ts (컨텍스트, 버스 연결, 음악/클릭 설정), battlefield.ts (시뮬레이션 이벤트를 음성으로: 거리 모델, 일제 사격, 멀리서 굴러오는 포성, 더킹, 종류별 속도 제한), samples.ts (디코딩된 `public/audio/*.mp3` 뱅크와 재생 레벨, `scripts/audio`로 빌드, 출처는 `public/audio/CREDITS.md`), voices.ts (합성 음성: 뱅크가 디코딩되기 전까지의 대체), ambience.ts (바다, 바람, 웅웅거림, 함성), music.ts (베드: 낮은 드론과 먼 북소리, 멜로디 없음), ui.ts (나무 클릭음), mix.ts (화면별 베드와 바다의 레벨). 합성된 어떤 소리도 250 Hz 위에서 지속되거나 스윕되는 음정을 가져서는 안 됨 (사인파 블립이나 Q>3 밴드패스 버스트는 삐 소리임)

## 캠페인
- `src/sim/grand/*` 세력 캠페인, `src/sim`의 나머지처럼 순수 TS: regions, economy, orders, turn, ai, autoresolve, march (새 전쟁의 토탈 워식 규칙, `Grand.march = 'tw-v1'`: 턴마다 레인 하나 대신 이동 거리, 바다에서의 정지, 레인이 교차하는 곳에서 만나는 함대, 항구의 통제 구역, 25 km 이내 항구에서 오는 증원, 봉쇄, 강행군, 겨울; 이것이 없는 저장 파일은 턴마다 레인 하나를 유지, `scripts/test-grand-march.mjs`), bridge (3D 지역 전투로의 타입이 있는 인계), coast (각 지역의 전투 맵: 가장 가까운 역사 전투의 지형에 실제 해안선을 따라 점령 지점을 둠, 방어자의 항구와 공격자의 정박지는 약 1.2 km 떨어져 있고 그 사이의 경합 수역은 양쪽에서 정확히 같은 거리), spawn (그 전투를 그 해안에서 캠페인 자체의 함선과 방어자의 시설로 쟁탈전 전투로 구성), report (전투 요약), events (각본이 있는 날짜별 역사 이벤트: 답이 두 개인 카드, 컴퓨터의 답은 시드에서 분기, `Grand.events`에 보관; 한 턴은 한 계절이므로 1597년은 20-22턴), replay (지난 턴이 지도에 한 일을 전후 상태로부터 도출해 지도에서 재생), roster (함선, 함대, 지휘관 경험치); `src/campaign/grand.ts`가 그 스토어 (`imjin.grand.v1`). 경제와 함선 전투는 `economy.ts`의 `TUNING`을 통해 `competitive.ts`의 경쟁 프로필을 사용
- UI: `src/ui/GrandScreen.tsx` (허브, 세력 선택, 지도, 대화 상자, 명령)가 `src/ui/grand/*`의 prop 구동 키트 위에 올라감 (`adapt.ts`가 스토어를 그 뷰 모델에 매핑); 3D로 치르는 조우는 `grand` 실행 종류(`launch.ts`)이며 `Engine`이 함선별 결과를 `finishGrandBattle`로 넘겨줌
- `src/campaign/campaign.ts` 선형 1592 캠페인 (조선); `src/select/SelectScene.ts` 선택 화면용 남해안 3D 수묵 지도

## 멀티플레이
`src/net/` + `server/`: 권위 Node 서버 (`main.ts` 방/세션/빠른 매칭/틱, `battles.ts` 쟁탈전 + 역사 대결 빌더, `terrain.ts` 워커 스레드의 하이트맵, `ranked.ts` 랭크 기록 저널), 바이너리 스냅샷, 프로토콜은 `protocol.ts`. 쟁탈전 맵과 역사 대결용 로비, 빠른 매칭 (20초 후 컴퓨터가 채움), 탭별 세션 토큰으로 재접속 (자리 60초 유지), 첫 접촉까지 최대 32x로 접근 단계 건너뛰기. UI는 `src/ui/OnlinePanel.tsx`, `OnlineOverlay.tsx`, `online.css`

## UI
`src/ui/` React HUD/메뉴; `styles.css` + `conquest.css`; `useCompactLayout`을 통한 컴팩트 레이아웃 (`.app--compact`, `.app--touch`)

## 계정
- 서버: `server/accounts.ts`가 저장소 인터페이스(사용자, 해시로 저장하는 세션과 90일 연장 만료, 사용자마다 리비전이 붙은 JSON 프로필, 추가만 하는 통화 원장, 1회성 지급 기록; 변경은 원장·지급과 한 트랜잭션). `server/accountsPg.ts`가 PostgreSQL에 둠(운영은 RDS `imjin-postgres`, 호스트의 `/etc/imjin/db.env`에 있는 `DATABASE_URL`, `scripts/deploy-mp.sh db`로 설정; 마이그레이션은 앞으로만, advisory lock 아래), `server/accountsMemory.ts`는 프로세스 메모리에 둠(테스트·로컬). 둘 다 없으면 계정이 꺼지고 `/health`가 `accountsReady: false`. `server/auth.ts` 비밀번호(scrypt), `server/api.ts` `/api` 라우터(CORS, 16 KB JSON, Bearer 세션, 속도 제한).
- 온라인: hello에 세션이 실리면 로그인한 사용자의 랭크 계정으로 플레이(첫 방문에 만들고 연결). 세션이 없으면 예전처럼 복원 코드.
- 클라이언트: `src/account/`(토큰은 localStorage `imjin.session.v1`, `ensureAccount()`는 처음 저장할 것이 생길 때 게스트를 만듦), 메뉴의 계정 패널. `scripts/test-accounts.mjs`는 메모리 저장소로, `scripts/test-accounts-pg.mjs`는 `DATABASE_TEST_URL`의 임시 PostgreSQL로 같은 검사를 돌림.
- 장수·갑옷 프로필(`src/meta/`): 서버가 주인. `server/meta.ts`가 `/api/meta`(조회), `/meta/buy`·`reroll`·`equip`·`weapon`·`learn`, `/meta/import`(브라우저에 남은 옛 프로필을 계정당 한 번, 선택만 서버 규칙으로 다시 적용 — 엽전·경험치·롤은 버림), `/meta/battle/start`·`finish`(컴퓨터 상대 전투 티켓, `reportProblem`과 하루 상한으로 판정). 프로필은 사용자 progress JSON의 `meta`, 엽전은 `coin` 원장 잔액이 진짜이고 갑옷 롤의 salt는 계정 id. 서버가 끝까지 돌린 온라인·랭크 전투는 접속한 사용자 좌석마다 상한 없이 지급. `src/meta/localProfile.ts`는 서버 프로필의 캐시(낙관적 표시, 서버 응답이 이김), 서버가 없을 때만 브라우저 로컬 프로필. 장수 효과(`applyGenerals`)는 컴퓨터 상대 역사 해전·정복전에서만 `Engine.applyAccountGenerals`로 적용; 온라인·랭크(공정성)와 대전역(자체 장수 성장)은 적용하지 않음. 검사: `scripts/test-meta-server.mjs`.

## 폰 메모리, 자세히
- low 등급이 무엇을 로드할지는 `quality.ts` 장비에서 결정됨: 2048 px 함선 모델이나 노멀/러프니스 맵 없음, 더 작은 계산 하늘(`skySize`), 1k 지면 텍스처(`scripts/build-terrain-tex.mjs`), 전투에서 쓰는 함선 종류만. 전투는 렌더러가 새 하늘 텍스처를 만들게 해서는 안 됨(`loadSky`가 재사용함).
- WebGL2 백엔드는 `src/render/webglBackend.ts`에서 보정됨: 인스턴스 행렬은 정점 속성에서 오며(한 모델의 배치들이 각자 컴파일하는 대신 셰이더 프로그램 하나를 공유), 정점 배열 캐시는 파괴된 속성이 쓰던 것을 버림(캐시된 VAO가 끝난 모든 전투의 버퍼를 GPU에 살려 두고 있었음). `freeAfterDraw`(`src/render/dispose.ts`)는 지형과 함선 정점 데이터를 그린 뒤 CPU 사본을 떼어냄. 매 프레임 텍스처가 바뀌는 노드(웨이크 맵)는 재질이 죽을 때 보여주지 않는 쪽 텍스처에 죽은 바인드 그룹을 남김: `WakeMap.release`가 이를 정리함.
- 많은 재질이 읽는 유니폼(안개와 태양광이 모든 재질에 넣는 `atmosphere` 유니폼)은 `renderGroup`에 속해야 함: three의 기본 객체별 그룹에서는 드로우마다 자기 사본을 갱신하며, 이 때문에 노량의 프레임 레이트가 4분의 1 깎였음.
