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
- `npm run e2e:clicks` (dev 서버 필요, GPU라서 `npm test`에는 없음) 메뉴·챕터 탭·각 챕터 역사 전투·/generals·캠페인의 주요 버튼을 실제 포인터로 눌러, 위를 덮은 요소가 없는지, 2초 안에 반응하는지, 누름과 반응 사이에 1.5초 넘는 메인 스레드 작업이 없는지 확인
- `node scripts/probe-pace.mjs --url=... --seconds=40` 실제 시간 대비 전투 시간 / 빨리 감기 / 가장 가까운 적과의 거리
- 대규모 전투 성능 (데스크톱 Chrome WebGPU): `node scripts/probe-perf.mjs --url=...?scenario=busan [--speed=8] [--pre=10] [--close] [--uncapped] [--cpu [--callers=fn]] [--alloc]` 30초 교전 동안의 fps, 프레임 백분위, 단계별 ms, 드로우 콜, 삼각형 수, 힙 변동과 GC 끊김 (`--uncapped`는 vsync를 꺼서 60 fps가 상한이 되지 않게 함; `--close`는 카메라를 교전 한가운데에 둠); `probe-draws.mjs` 한 프레임의 모든 드로우를 객체와 패스별로; `probe-ablate.mjs` 부분을 하나씩 숨겼을 때의 GPU 비용; `probe-series.mjs` 시간에 따른 fps와 파티클 수; `probe-phone.mjs` 같은 것을 WebKit에서 `?q=low`로 (드로우 콜, 삼각형, 프로그램, 메모리); `perf-shot.mjs` 교전 한가운데의 스크린샷
- `node scripts/sim-digest.mjs --out=<json>` 전후로 돌린 뒤 `--compare=<before>,<after>`: 시뮬레이션이 스텝마다 비트 단위로 같은지 확인 (역사 전투 넷, 랭크·일반 쟁탈전)

## 개발 DB
- Docker Desktop을 켠 뒤 `npm run db:dev`: `infra/dev-db.compose.yml`의 PostgreSQL 16이 `127.0.0.1:5433`에 뜸(이름 있는 볼륨 `imjin-dev-pg`에 보관, 재시작해도 계정·장수 프로필 유지). 끄기 `npm run db:dev:down`, 완전 초기화 `docker volume rm imjin-dev-db_imjin-dev-pg`.
- `npm run server:dev`: `.env.development`의 `DATABASE_URL`(로컬 전용 계정 imjin/imjin-dev, TLS 끔)로 :8787 서버를 띄움. 스키마는 서버가 시작할 때 `server/accountsPg.ts`의 MIGRATIONS로 스스로 올림. DB 없이 돌리려면 기존대로 `ACCOUNTS_STORE=memory npm run server`.
- `node --env-file=.env.development scripts/test-meta-server.mjs`: 메모리 저장소와 개발 PostgreSQL(일회용 DB를 만들고 지움) 둘 다에서 장수 성장 API 확인.
- 전리품은 새 테이블 없이 기존 `profiles.data.meta`(JSON)와 원장 `ledger`(kind `item`, 얻으면 +1·분해하면 −1, 잔액 = 보유 수)에 기록: 운영 RDS 마이그레이션 없음(스키마 1 그대로).

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

## 에셋
`public/`과 `assets-src/` 아래의 바이너리(확장자는 `scripts/assets.mjs`의 `TYPES`: glb, bin, webp, jpg, png, mp3, woff2, dem 등)는 비공개 버킷 `s3://imjin1592-assets`(ap-northeast-2)의 `sha256/<앞 두 자리>/<sha256>`에 있음. 루트의 `assets.json`이 파일마다 sha256과 크기를 한 줄씩 적고, 파일이 바뀌면 이전 버전을 `history`에 남김. 블롭은 지우지 않으므로 모든 버전을 되살릴 수 있음. 텍스트 파일(json, md, txt, svg)과 출처 기록은 git에 그대로 둠. `.gitignore`가 로컬에 두는 것(Meshy 원본, 탈락 후보, 렌더)은 push에 파일을 직접 지정하지 않는 한 저장소에 올라가지 않음.
- `npm run assets -- pull [paths] [--dry-run]` 캐시나 S3에서 받아 트리를 `assets.json`에 맞춤. 모든 파일을 sha256으로 확인하고 복사함(링크하지 않음). 여기서 바꾸고 push하지 않은 파일은 그대로 둠. 할 일이 없으면 크기와 수정 시각만 봄. CI가 테스트 전에 실행함.
- `npm run assets -- push [paths] [--dry-run]` 버킷에 없는 새 파일·바뀐 파일을 올리고 기록함; 변경과 함께 `assets.json`을 커밋. 없어진 파일은 이름을 지정했을 때만(`push public/ui/x.webp`) `assets.json`에서 빠지고 블롭은 남음.
- `status [--remote]` `assets.json`과 다른 것(과 버킷이 다 갖고 있는지); `verify` history를 포함한 모든 버전이 버킷에 제 크기로 있는지; `restore <path> [--previous | --sha=<prefix>]` 이전 버전을 되살리고 그 교체를 기록함.
- `models [--json]` 모델 보관소: 모든 .glb의 크기, 삼각형 수, 버전, 그리고 파일명이나 해시로 그것을 가리키는 기록(`assets-src/*/provenance.json`, `runtime-assets.json`, `README.md`)의 도구·모델·크레딧.
- 캐시는 모든 worktree가 공유함: `IMJIN_ASSET_CACHE`, 없으면 `%LOCALAPPDATA%imjin-assets` 또는 `~/.cache/imjin-assets`. 언제 지워도 됨.
- 자격 증명: `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`(CI의 배포 역할은 읽기 가능), 없으면 aws CLI(`aws login`); push는 본인 자격 증명으로. `setup [--apply]`은 버킷과 역할의 읽기 정책을 만들고, `untrack [--apply]`은 바이너리를 git에서 빼고 그 패턴을 `.gitignore` 맨 앞에 넣는 한 번뿐인 전환.
- 병합 뒤 `assets.json`이 충돌하면 양쪽 줄을 다 남기고, 양쪽이 같은 파일을 바꿨으면 원하는 버전을 남김(다른 블롭도 저장소에 남아 있음).
- 콜드 아카이브(생성 원본: 컨셉 PNG, raw/rig/anim GLB, 후보, .blend): `npm run assets -- archive <paths> [--from=<목록>] [--dry-run]`이 같은 버킷의 `archive/sha256/`에 올리고 커밋하는 `assets-archive.json`(경로 → sha256, 크기, uploadedAt)에 적은 뒤, HEAD로 크기를 확인하고 로컬 파일을 지움. `assets.json`이 관리하는 파일은 건드리지 않음. `archive-pull "<경로|glob>" [--dry-run] [--force]`로 필요할 때만 되살리고, `archive-status [--remote]`로 폴더별 현황 확인. CI와 `pull`은 아카이브를 받지 않음 — 생성 원본은 `push` 말고 여기로.
- 런타임 파일을 로컬에 두지 않기: `npm run assets -- prune-local [paths] [--min-size=5M] [--dry-run]`이 `public/`의 파일(기본 `public/models`) 중 `assets.json`과 해시가 같고 버킷에 제 크기로 있는 것(HEAD로 확인)만 지우고, 지운 목록을 커밋하지 않는 `.assets-remote.json`에 적음. 개발 서버(`vite.config.ts`의 `imjin-remote-assets`)는 `assets.json`에 있는데 로컬에 없는 `public/` 파일을 공유 캐시에서, 없으면 S3에서 받아 sha256을 확인한 뒤 내줌(응답 헤더 `X-Imjin-Asset: remote`). 캐시는 `IMJIN_ASSET_CACHE_MAX`(기본 2G) 아래로 오래 안 쓴 것부터 지움. 파일을 Node에서 읽는 테스트·스크립트는 `scripts/lib/remote-assets.mjs`의 `runtimePath(rel)`로 경로를 얻음(로컬 사본, 없으면 캐시).
  - `pull`은 `.assets-remote.json`의 파일을 건너뜀; `pull --all [paths]`가 되살리고 목록에서 뺌. `push`는 그 파일을 없어졌다고 빼지 않음. `vite build`는 원격 전용 파일이 하나라도 있으면 멈춤(로컬 빌드 전에 `pull --all`). CI는 새 체크아웃이라 전부 받음.
  - AWS 자격 증명이 없으면 지운 파일은 개발 서버에서 502로 실패함. 새로 만든 모델은 `push` 뒤에 prune.
- `node scripts/test-assets.mjs`가 모든 명령을 메모리 속 S3로 검사함.

## 캠페인 지도
각 지역의 점령 지점은 `src/sim/grand/regionPoints.json`이며, `coast.ts`의 앵커로부터 `node scripts/build-region-maps.mjs [--preview=<dir>] [--check]`가 작성하므로 앵커나 지형을 바꾼 뒤에는 다시 실행할 것.
