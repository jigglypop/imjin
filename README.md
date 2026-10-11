# imjin

임진 해전 — 임진왜란 해전을 다룬 3D 웹 전략 게임 (WebGPU · three.js · React).

- 플레이: https://imjin1592.com
- 개발: `npm install` → `npm run dev` (http://127.0.0.1:5291)
- 배포: `main` 브랜치에 푸시하면 GitHub Actions가 빌드 후 S3 + CloudFront로 자동 배포합니다.
- 코드 검증: `npm run typecheck` → `npm test` → `npm run build`. `npm test`는 전투·전역·렌더 수명 관리·네트워크·잘못된 서버 입력 회귀를 실행합니다.
- 브라우저 검증: 빌드 후 `npm run preview -- --host 127.0.0.1 --port 5291 --strictPort`를 실행하고, `npm run e2e`와 `node scripts/test-campaign.mjs`를 실행합니다. 후자는 함대 전멸 후 건조·재출격과 결과 화면까지 확인합니다.
- 번역 검증: `node scripts/i18n-check.mjs --strict`.
- 서버 배포 검증: `MP_INSTANCE_ID`가 설정되면 웹 배포 전에 서버의 protocol과 Git revision을 확인합니다. 미설정이면 protocol만 검사하며 서버 코드 배포는 별도로 필요합니다.
