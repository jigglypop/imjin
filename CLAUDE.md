# MOONWAKE: 임진왜란 (imjin)

MOONWAKE는 역사 해전 시뮬레이터 시리즈, 첫 장은 임진왜란. WebGPU 3D. https://imjin1592.com 에서 서비스 중.
three.js r186 `three/webgpu` + TSL, @react-three/fiber, React 19, zustand, Vite, 권위 Node 멀티플레이 서버.
플레이어에게 보이는 텍스트는 한국어(영어판은 `/en` 아래), 코드·주석·커밋은 영어.

## 명령어
- `npm run dev` — http://127.0.0.1:5291 (strictPort; 두 번째 서버는 `npx vite --port <n> --strictPort`)
- `npm run typecheck`, `npm test` — 커밋 전에 둘 다 통과해야 함 (CI에서 실행)
- `npm run server` — :8787 멀티플레이 서버 (localhost 클라이언트는 자동으로 여기에 접속)
- `node scripts/shot.mjs --url=http://127.0.0.1:5291/?scenario=hansan --out=<png>` — 스크린샷 (Windows는 Edge + D3D11)
- 프로브, URL 테스트 훅, 밸런스·오디오 도구: [docs/dev.md](docs/dev.md). 코드 지도: [docs/architecture.md](docs/architecture.md)

## 구조
- `src/game/Engine.ts` 전투 하나를 소유: 배치, 고정 스텝 시뮬레이션, 사운드·이펙트로 이벤트 전달, 0.15초마다 UI 스냅샷. `quality.ts` 장비 등급(high PC / medium 태블릿 / low 폰)
- `src/sim/` 결정론적 시뮬레이션(`server/`와 공유), `src/sim/grand/` 세력 캠페인
- `src/ships/`, `src/fx/`, `src/ocean/`, `src/render/`, `src/terrain/`, `src/audio/`, `src/cinema/` 함선, 이펙트, 바다, 하늘, 지형, 사운드, 컷신
- `src/ui/` 화면과 HUD, `src/routes.ts` + `src/router.ts` 주소, `src/net/` + `server/` 멀티플레이(전송 형식은 `src/net/protocol.ts`)

## 규칙
- `src/sim`은 결정론적으로 유지: `Date.now`, `Math.random`, DOM, three.js 금지, 전투의 시드 RNG만 사용. 여기를 바꾸면 서버와 랭크전도 바뀜. 클라이언트에 필요한 Ship·BattleEvent 필드는 `src/net/protocol.ts`에도 추가.
- 폰(iOS Safari, WebGL2 경로, `?q=low`)은 1.2–1.5 GB 근처에서 탭을 죽임: 텍스처 300 MB, GPU 메모리 400 MB 미만 유지(`scripts/probe-memory.mjs`), 전투가 만든 것은 해제(`Engine.disposeBattle`, `probe-leak.mjs`로 확인).

## 하네스 (작업 전에 해당 스킬을 먼저 읽을 것. 확정된 규칙·거절된 방식은 여기에 바로 추가)
- `.claude/skills/generals-cast` 장수 3D·무기 / `chapters` 아르마다·레판토·트라팔가르 장 / `cinematics` 전투 시네마틱·대사·고증 / `typography` 폰트(전부 Pretendard) / `ui-design` 글래스 UI·간격·라벨 디자인 시스템 / `ship` 운영 배포
- 생성 원본은 로컬에 쌓지 않음: `npm run assets -- archive`로 S3 콜드 보관(CI는 받지 않음). worktree를 여러 개 만들어 에셋을 복사하지 않음. C: 여유 3 GB 이상 유지.

## 에셋
- `public/`·`assets-src/`의 런타임 바이너리(모델, 텍스처, 오디오, 폰트, 지형)는 내용 해시로 S3에 있고 목록은 커밋된 `assets.json`: 체크아웃 뒤 `npm run assets -- pull`, 바이너리를 추가·변경하면 `npm run assets -- push` 후 `assets.json` 커밋. 생성 원본은 `assets-archive.json`(콜드 보관).
- 런타임 바이너리도 로컬에 쌓지 않음: `npm run assets -- prune-local`(기본 `public/models`)이 S3에 확인된 사본을 지우고, 개발 서버가 그 파일을 S3에서 받아 캐시(`IMJIN_ASSET_CACHE_MAX`, 기본 2G)에 두고 내줌. Node에서 바이너리를 읽는 테스트는 `runtimePath`(`scripts/lib/remote-assets.mjs`). 로컬 빌드 전엔 `pull --all`.
- `npm run assets -- models`가 모델 보관소: 모든 .glb의 삼각형 수, 버전, 출처 기록. 자세한 것은 [docs/dev.md](docs/dev.md#에셋).

## 배포
- 배포는 `ship` 스킬 절차대로(origin/main 기준 임시 worktree, 해당 파일만). `main`에 푸시하면 타입체크·테스트·빌드 뒤 사이트(S3 + CloudFront)와 멀티플레이 서버(EC2, SSM 경유)가 함께 배포됨. 요청 없이 푸시하지 말 것.
- 서버 수동 배포: `scripts/deploy-mp.sh deploy|status`. 서버 데이터는 호스트의 `/opt/imjin/data`에 있고 배포가 덮어쓰지 않음.
