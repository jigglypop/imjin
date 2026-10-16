# 개발 도구

모두 저장소 루트에서 실행함. 개발 서버는 `npm run dev`, http://127.0.0.1:5291.

## 주소와 URL 테스트 훅
- 주소 (`src/routes.ts`; `src/router.ts`가 뒤로/앞으로를 포함해 주소와 화면을 맞춰 둠): `/` 메뉴, `/campaign` 캠페인, `/conquest` 쟁탈전, `/battles` 역사 전투, `/online`, `/settings`; 영어판은 같은 경로를 `/en` 아래에 (`/en/campaign`, ...). `/ko/...`, 끝의 슬래시, `index.html`, 알 수 없는 경로는 그 자리에서 하나의 형태로 다시 쓰이며, 영어 페이지는 항상 `/en` 아래에 있음. 빌드는 주소마다 자체 메타를 가진 페이지를 하나씩 씀 (`vite.config.ts`); 배포는 `node scripts/route-pages.mjs`가 출력하는 키로 업로드함.
- URL 테스트 훅 (`src/ui/launch.ts`, App.tsx): `?scenario=<id>&side=<faction>`, `?conquest=hallyeo&me=joseon&foe=japan&size=2`, `?gallery=1`, `?hud=0`, `?q=low|medium|high`, `?lv=0-4`, `?webgl=1`, `?sky=`, `?sea=`, `?paused=1`, `?lang=ko|en`. 전투를 시작하는 것들(routes.ts의 `LAUNCH_PARAMS`)은 다른 화면으로 처음 이동할 때 주소에서 빠지므로 새로고침해도 전투가 다시 시작되지 않음; 설정 관련 것들은 남아 있음.
- 컷신: 자동화된 브라우저는 `?cutscene=1`이 아니면 장면을 보지 않음; `?doc=1`은 다큐멘터리 모드를 시작; `__engine.cinema.play('noryang-outro')`는 장면 하나를 재생.

## 스크린샷과 프로브
macOS는 Chrome + Metal, Windows는 Edge + D3D11. GPU는 같이 돌아가는 다른 것과 공유되므로 연속으로 돌려서 비교할 것.
- `node scripts/shot.mjs --url=http://127.0.0.1:5291/?scenario=hansan --out=<png>` 데스크톱 WebGPU
- `node scripts/probe-mobile.mjs --url=... [--orient=portrait,landscape]` WebKit iPhone 15 Pro 에뮬레이션 (iOS Safari 엔진, WebGL2 경로)
- `node scripts/probe-memory.mjs [url] [--then=myeongnyang,hansan]` 전투 로드 중, 그리고 같은 페이지에서 전투를 더 치른 뒤의 WebKit 프로세스 RSS + `renderer.info.memory`; 폰 예산 기준 PASS/FAIL (텍스처 < 300 MB, GPU 메모리 < 400 MB, 준비 < 10초). 그 `footprint` 열(macOS `footprint`)이 iOS가 탭에 대해 세는 값임; RSS는 해제된 페이지도 포함하므로 누수 신호가 아님.
- `node scripts/probe-load.mjs [url] [--engine=chromium]` 로드 타임라인 (단계, 진행 바, GPU 카운터); `probe-calls.mjs` 프레임당 드로우 콜 (`renderer.info.render.calls`는 드로우 콜이 아니라 페이지 시작 이후의 `render()` 호출 수); `probe-programs.mjs` 셰이더 프로그램 (폰 등급에서 90 근처 유지); `probe-leak.mjs` 전투가 끝난 뒤에도 남는 텍스처; `probe-heap.mjs` 전투 사이의 Chrome 힙 스냅샷 (늘어난 생성자, 끝난 전투가 남긴 것의 최단 유지 경로: `--min`, `--label`, `--retainers`); `probe-ui-loop.mjs` 실제 버튼으로 전투 -> 뒤로 -> 전투를 WebKit에서 돌리며 프로세스 footprint 측정; `probe-warnings.mjs` 콘솔 경고를 개수와 함께 묶어서 출력 (깨끗한 전투는 하나도 출력하지 않음); `probe-cpu.mjs` 로드 중 메인 스레드 프로파일; `probe-geometry.mjs` 지오메트리별 실제 정점 메모리 (`renderer.info.memory`는 인터리브 속성을 속성마다 한 번씩 세므로 함선 정점 메모리가 실제보다 몇 배로 읽힘)
- `node scripts/probe-pace.mjs --url=... --seconds=40` 실제 시간 대비 전투 시간 / 빨리 감기 / 가장 가까운 적과의 거리
- 대규모 전투 성능 (데스크톱 Chrome WebGPU): `node scripts/probe-perf.mjs --url=...?scenario=busan [--speed=8] [--pre=10] [--close] [--uncapped] [--cpu [--callers=fn]] [--alloc]` 30초 교전 동안의 fps, 프레임 백분위, 단계별 ms, 드로우 콜, 삼각형 수, 힙 변동과 GC 끊김 (`--uncapped`는 vsync를 꺼서 60 fps가 상한이 되지 않게 함; `--close`는 카메라를 교전 한가운데에 둠); `probe-draws.mjs` 한 프레임의 모든 드로우를 객체와 패스별로; `probe-ablate.mjs` 부분을 하나씩 숨겼을 때의 GPU 비용; `probe-series.mjs` 시간에 따른 fps와 파티클 수; `probe-phone.mjs` 같은 것을 WebKit에서 `?q=low`로 (드로우 콜, 삼각형, 프로그램, 메모리); `perf-shot.mjs` 교전 한가운데의 스크린샷
- `node scripts/sim-digest.mjs --out=<json>` 전후로 돌린 뒤 `--compare=<before>,<after>`: 시뮬레이션이 스텝마다 비트 단위로 같은지 확인 (역사 전투 넷, 랭크·일반 쟁탈전)

## 로컬 온라인
`npm run server:build && PORT=8791 node server/dist/server.cjs`, `VITE_MP_URL=ws://127.0.0.1:8791/ws npx vite --port 5306 --strictPort`, 그다음 `node scripts/mp-smoke.mjs` (ws만) 와 `node scripts/mp-browser.mjs --url=http://127.0.0.1:5306/ --mode=all` (페이지 두 개).

## 밸런스
- `node scripts/balance.mjs` (역사 시나리오; `--kpi` 페이싱: 판세 변동, 교전 함선 수, 가장 긴 소강, 궤주, 재집결, 결착; `--passive` 플레이어 함선을 그대로 둠, `--classic` 깊이 규칙 이전의 규칙, `--conquest` 두 점령 맵을 컴퓨터 대 컴퓨터로)
- `node scripts/balance-conquest.mjs --duel --seeds=3` (세력 대결), `node scripts/balance-grand.mjs` (세력 캠페인, 전부 컴퓨터인 전쟁; `--sweep`, `--fit=japan`, `--catalog`, `--no-events`), `node scripts/test-grand.mjs` (그 규칙과 저장/불러오기)
- `node scripts/check-stalemate.mjs [--conquest] [--classic] [--seeds=4]` (플레이어가 가만히 있어도 모든 전투가 끝나야 함: 결판이 안 나면 exit 1; `--trace`는 시뮬레이션 2분마다 명령, 활동, 동요/도주 중인 승조원을 출력)
- 깊이 규칙: `scripts/test-depth.mjs`, `scripts/test-maneuvers.mjs` (`--unit`은 규칙만), `scripts/maneuvers-harness.mjs hansan --rules=v1` (십자 포화와 엉킴 측정)

## 오디오
- `node scripts/render-sounds.mjs --url=http://127.0.0.1:5291 [--out=<dir>] [--prefix=after_]` 합성 음성(`src/audio/voices.ts`)을 오프라인으로 cannon_near/cannon_far/broadside/explosion/sinking .wav 파일로 렌더링, `--only=battle`은 게임 자체의 `battlefield.ts`와 샘플 뱅크로 각본 전투(포성, 바다, 음악 베드를 게임처럼 섞음)를 `audio2_battle.wav`로, `--only=inventory`는 모든 음성, UI 클릭, 베드, 바다를 각각 파일 하나씩
- `node scripts/audio/capture.mjs --url=... --tag=<t>` 메뉴 / 전투 1x, 8x, 32x / 쟁탈전 / 캠페인의 실제 마스터 버스를 각각 60초씩 녹음; `python3 scripts/audio/analyze.py <wav>... [--png <dir>]` 라우드니스, 클리핑, 삐 소리로 들리는 좁은 톤을 측정, `scripts/audio/build_page.py <dir>` 둘을 가지고 청취 페이지를 만듦

## 캠페인 지도
각 지역의 점령 지점은 `src/sim/grand/regionPoints.json`이며, `coast.ts`의 앵커로부터 `node scripts/build-region-maps.mjs [--preview=<dir>] [--check]`가 작성하므로 앵커나 지형을 바꾼 뒤에는 다시 실행할 것.
