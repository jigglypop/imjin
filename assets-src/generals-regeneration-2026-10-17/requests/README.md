# 새 장수 착장 파일럿 요청안

아직 제출하지 않은 JSON 템플릿이다. 새 유료 생성 0건, 업로드 POST 0건이다. 기존 GLB를 새 제작에 재사용하지 않는다. 전체 목표는 장수 24명, 갑옷 26종, 무기 18종, 같은 진영 착장 217개 조합이며, `../generation-plan.json`에 전부 남겨 두었다.

먼저 **새 중립 속옷·장화 신체 1개 + 새 두정갑 코트 1개**의 피팅을 검증한다. 코트는 몸통·소매·갈라진 치마만 포함한다. 사람, 얼굴, 목, 손, 투구, 바지, 장화, 무기, 마네킹, 받침은 없고 목둘레와 소매 끝은 비어 있어야 한다. 투구는 이 피팅이 통과한 다음 별도 자산으로 생성한다.

| 선택안 | 신체 생성 | 코트 생성 | 신체 리그 | 합계 제안 |
| --- | ---: | ---: | ---: | ---: |
| Meshy 7.1, Ultra 2K 형상·4K PBR 텍스처 | 35 | 35 | 5 | **75 credits** |
| Tripo H3.1, detailed 형상·텍스처 | 최대 예상 70 | 최대 예상 70 | 25 | **165 credits** |

두 서비스를 함께 실행하는 안이 아니다. 선택한 서비스의 파일럿 한 번만 승인 범위에 포함한다. 이미지 생성, 투구, 애니메이션, 재생성, 후속 유료 리메시, 전체 목록 생성은 이 비용에 포함하지 않는다. 코트는 인체가 아니므로 서비스 자동 리그에 보내지 않고, 새 신체에 Blender에서 스키닝한다.

Meshy 요금은 [현재 API 요금표](https://docs.meshy.ai/en/api/pricing)의 다중 이미지+4K 텍스처 30, Ultra 2K 형상 +5, 리그 5를 적용했다. 웹앱 무료 리그 가격과 API 가격을 혼동하지 않는다. [다중 이미지 규격](https://docs.meshy.ai/en/api/multi-image-to-3d)은 `meshy-7.1`, `geometry_resolution: "2k"`, 정면 우선이며 나머지 뷰 순서는 무관하다. 4K **형상**은 해당 엔드포인트에서 지원되지 않고 4K **텍스처**는 지원된다. [인체 리그](https://docs.meshy.ai/en/api/rigging)는 실제 결과가 300,000 삼각형 이하여야 다음 요청을 진행한다. `target_polycount`는 보장 상한이 아니므로 결과를 직접 센다.

Tripo는 검증된 production `https://api.tripo3d.ai/v2/openapi/task`와 명시적 `v3.1-20260211`을 사용한다. [production 요금표](https://platform.tripo3d.ai/docs/billing)는 텍스처 포함 다중 이미지 30 + detailed 텍스처 20 + detailed 형상 20으로 보수적으로 70을 예약한다. 일부 공식 개발자 상품 안내는 detailed 텍스처 비용을 10 낮게 표시하므로 **70은 확정 견적이 아니다**. [현재 API 가격·실제 과금 확인](https://docs.tripo3d.ai/get-started/pricing.html)과 [형상 규격](https://docs.tripo3d.ai/model-generation/multiview-to-model-v3-0-v3-1.html)을 함께 확인하고, 각 작업의 `consumed_credit`을 읽은 후 다음 유료 작업을 판단한다. [현재 인체 리그](https://docs.tripo3d.ai/animation/rig-v2-5-20260210.html)는 `v2.5-20260210`, `biped`, `spec: "tripo"`로 고정했다.

2026-10-17 04:16:57 한국시간의 읽기 전용 잔액 조회는 Meshy 633, Tripo 사용 가능 670 / 예약 0 credits였다. 잔액은 승인 예산이 아니다. 인증값은 출력하거나 이 폴더에 보관하지 않았다. 조회 규격: [Meshy](https://docs.meshy.ai/en/api/balance), [Tripo](https://platform.tripo3d.ai/docs/wallet).

## 제출 전에 채울 내용

- `references/body_front.png`, `body_left.png`, `body_back.png`, `body_right.png`.
- `references/armor_joseon_dujeong_front.png`, `_left.png`, `_back.png`, `_right.png`.
- 각 이미지의 SHA256, 크기, 정투영 여부, 동일한 어깨·손목·허리·무릎·발목·밑단 높이 검수 결과.
- 서비스 하나, 정확한 요청 해시, 작업별 예약량, 총 credit 상한에 대한 명시적 사용자 승인.

`${DATA_URI:...}`는 로컬 PNG 바이트의 data URI로 치환하는 자리다. `${UPLOAD_TOKEN:...}`는 Tripo 이미지 업로드 후 토큰 자리다. `${PILOT_NEW_BODY_GENERATION_TASK_ID}`는 이번에 새로 생성한 신체의 작업 ID다. 템플릿 문자열을 그대로 서버에 보내면 안 된다. 기존 작업 ID를 대입하지 않는다. 인증 헤더는 실행 시 기존 환경에서만 구성한다.

Tripo 배열의 정확한 슬롯은 `[front, left, back, right]`다. 이전 `[front, left, back, empty-right]` 순서는 유효했으므로 순서 오류가 기존 실패의 원인이라고 판단하지 않았다. 신체·얼굴·갑옷·투구·손·신발을 한 결과에 합친 경계, 독립적으로 수정된 뷰 사이의 형상 차이, 계측되지 않은 공통 체형과 서로 다른 리그 프레임이 우선 의심된다. 각각의 인과 기여는 통제된 새 생성 비교 전까지 미확정이다.

## 지출 제한과 재개

확인한 공개 generation·rigging·billing·balance·task 규격에는 per-task `max_cost`/`max_credits` 필드나 제출 전 견적 엔드포인트가 문서화되어 있지 않았다. 따라서 75/165를 **서비스가 강제하는 금액 상한**이라고 표현하지 않는다. 서버가 보장하는 엄격한 상한이 필요하면 provider가 확인한 키/계정 예산 또는 견적이 마련되기 전에는 제출하지 않는다.

`submission-policy.json`은 단일 작업당 create 시도 1회, 한 번에 create 1개, 자동 재생성 0회를 규정한다. POST 전에 intent·요청 해시·예약 credit을 원장에 저장하고, 응답의 ID를 즉시 보존한다. POST 응답이 유실되면 `submission-uncertain`으로 멈추고 재전송하지 않는다. ID가 있는 작업의 관찰 실패는 동일 ID GET으로 재확인하며 새 작업을 만들지 않는다. 실제 과금과 잔액을 매 작업 후 대조한다. `receipt.schema.json`에 필요한 증거 필드를 정의했다.

생성 성공 후에도 새 GLB의 정면·좌측·후면·우측 텍스처/클레이 렌더와 내부 개구부를 확인한 뒤 리그한다. 새 신체·코트 피팅과 동작·브라우저 착장 검수가 통과해야 나머지 목록을 진행할 수 있다. 이 문서나 JSON 생성은 3D 제작 완료 증거가 아니다.
