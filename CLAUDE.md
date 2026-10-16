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
- 많은 재질이 읽는 유니폼은 `renderGroup`에. 픽셀 비율은 엔진이 소유. 첫 프레임들 이후에는 지오메트리 배열을 읽지 말 것(`freeAfterDraw`).
- 전투 오디오: 합성음은 250 Hz 위에서 지속·스윕되는 음정 금지(`scripts/audio/analyze.py`로 측정).
- 주변 코드에 맞출 것: 주석은 이유를 평이한 문장으로, 죽은 코드 금지.

## 배포
- `main`에 푸시하면 타입체크·테스트·빌드 뒤 사이트(S3 + CloudFront)와 멀티플레이 서버(EC2, SSM 경유)가 함께 배포됨. 요청 없이 푸시하지 말 것.
- 서버 수동 배포: `scripts/deploy-mp.sh deploy|status`. 서버 데이터는 호스트의 `/opt/imjin/data`에 있고 배포가 덮어쓰지 않음.
