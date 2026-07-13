# Wanted 통합 채용 대시보드 API 설계 (API.md)

`PRD.md`의 기능 요구사항과 `DB.md`의 테이블 구조를 기반으로, 우리 서비스(백엔드)가 프론트엔드에 제공해야 할 자체 API를 정의한다. 원티드 원본 API(json.v1/v2)를 그대로 노출하지 않고, 우리 DB에 동기화·가공된 데이터를 반환하는 것을 전제로 한다.

## 0. 공통 사항

- **Base URL**: `/api`
- **인증**: `Authorization: Bearer <JWT>`. 토큰의 `role` 클레임으로 지원자(`applicant`)/채용자(`recruiter`) 권한을 구분한다.
- **원티드 API 키**: 클라이언트에는 절대 전달하지 않는다. 원티드 API 호출은 전부 백엔드 배치/동기화 잡에서만 이루어지고, 프론트엔드는 아래 자체 API만 호출한다.
- **페이지네이션**: 목록형 API는 `offset`/`limit` 쿼리 파라미터를 공통으로 지원 (기본 `offset=0&limit=20`).
- **에러 포맷**: `{ "error_code": string, "message": string }` (원티드 `OpenAPIExceptionResponse`와 통일)
- **채용자 전용 API**는 `recruiter_profiles.company_id` 기준으로 본인 회사 데이터만 조회/수정 가능하도록 서버에서 필터링한다.

## 1. 인증 / 계정

| Method | Path | 설명 | 인증 |
|---|---|---|---|
| POST | `/api/auth/signup` | 회원가입 (email, password, role) | - |
| POST | `/api/auth/login` | 로그인, JWT 발급 | - |
| GET | `/api/users/me` | 내 계정 정보 조회 (role 포함) | 공통 |

## 2. 태그 마스터 (공용)

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/tags?type=category\|subcategory\|skill\|attraction` | 태그 목록 조회. `tags` 테이블 기반, 각종 필터/선택 UI에서 공용으로 사용 |

## 3. 공고 검색 (공용 — 여러 탭에서 재사용)

| Method | Path | 설명 | 관련 PRD |
|---|---|---|---|
| GET | `/api/positions` | 공고 목록. 쿼리: `category_tag_id`, `skill_tag_ids[]`, `attraction_tag_ids[]`, `region`, `years`, `additional_apply_type[]`, `sort`, `offset`, `limit` | 5.3, 5.4, 공통 |
| GET | `/api/positions/{id}` | 공고 상세 (태그, 보상금, 마감일, 회사정보 포함) | 공통 |

우대조건 필터(5.3)는 별도 엔드포인트 없이 `/api/positions?additional_apply_type=foreigner,disabled`처럼 이 API의 파라미터 조합으로 처리한다.

## 4. 지원자 — 마켓 홈 (PRD 5.0)

| Method | Path | 설명 | DB 근거 |
|---|---|---|---|
| GET | `/api/market/category-distribution` | 직군별 공고 수 + 비중(%) | `category_daily_snapshot` 최신 날짜 집계 |
| GET | `/api/market/region-distribution` | 지역별 공고 집중도 순위 | `category_daily_snapshot` (region 축) |
| GET | `/api/market/weekly-summary` | 최근 7일 신규/마감 공고 수, 전주 대비 증감률, 일별 총량 추이 | `category_daily_snapshot` 최근 14일 |
| GET | `/api/market/trending-positions?direction=up\|down&limit=3` | 급등/급감 직무 TOP N | `category_daily_snapshot` 주간 델타 계산 |
| GET | `/api/market/urgent-deadlines?within_days=5` | 마감 임박 공고 (D-day 포함) | `positions.due_time` |
| GET | `/api/market/recommended-positions` | 내 우선순위(5.4) 기반 추천 공고 카드 | `applicant_priority_factors` + `positions` (4번 항목 재사용) |
| POST | `/api/market/positions/{id}/bookmark` | 공고 북마크 저장 | `bookmarked_positions` |
| DELETE | `/api/market/positions/{id}/bookmark` | 북마크 해제 | `bookmarked_positions` |

## 5. 지원자 — 취준 로드맵 (PRD 5.1)

| Method | Path | 설명 | DB 근거 |
|---|---|---|---|
| GET | `/api/categories/{categoryTagId}/requirement-stats` | 직군별 평균 요구 연차·연봉, 스킬 요구빈도 테이블 | `positions`, `position_tags` 집계 |
| GET | `/api/roadmap/gap` | 내 프로필(경력·보유스킬) vs 희망 직군 통계 비교 → 스킬 커버리지%, 경력 갭, 미보유 스킬 TOP3, 추천 공고 TOP3 | `applicant_profiles`, `applicant_skills`, 위 requirement-stats, `skill_tag_trend`(가중치 반영) |
| PATCH | `/api/applicant/profile` | 희망 직군/경력 연차/거주지 수정 | `applicant_profiles` |
| PUT | `/api/applicant/profile/skills` | 보유 스킬 태그 목록 저장(bulk) | `applicant_skills` |

## 6. 지원자 — 기업 재무·인력 건강도 비교 (PRD 5.2)

| Method | Path | 설명 | DB 근거 |
|---|---|---|---|
| GET | `/api/companies/search?q=` | 기업 검색 | `companies` |
| GET | `/api/companies/{id}/insight?date=` | 재무/인력 지표 (미지정 시 최신 스냅샷) | `company_insight_snapshots` |
| GET | `/api/applicant/watchlist-companies` | 저장한 관심기업 목록 + 각 insight 데이터 (레이더차트용 묶음 응답) | `watchlist_companies` + `company_insight_snapshots` |
| POST | `/api/applicant/watchlist-companies` | 관심기업 추가 (body: `company_id`) | `watchlist_companies` |
| DELETE | `/api/applicant/watchlist-companies/{companyId}` | 관심기업 제거 | `watchlist_companies` |

## 7. 지원자 — 개인 맞춤형 공고 재정렬 (PRD 5.4)

| Method | Path | 설명 | DB 근거 |
|---|---|---|---|
| GET | `/api/applicant/priority-factors` | 현재 저장된 우선순위 설정(직종/연봉/워라밸/출퇴근거리) 조회 | `applicant_priority_factors` |
| PUT | `/api/applicant/priority-factors` | 우선순위 설정 저장(bulk upsert: `factor_key`, `is_dealbreaker`, `weight`, `threshold_value`) | `applicant_priority_factors` |
| GET | `/api/applicant/matched-positions` | 저장된 우선순위 기준으로 하드필터+가중치 스코어링을 서버에서 계산한 정렬 결과 (제외 건수 포함) | `applicant_priority_factors` + `positions`/`position_tags` |

## 8. 채용자 — 공고 경쟁력 진단 (PRD 5.5)

| Method | Path | 설명 | DB 근거 |
|---|---|---|---|
| GET | `/api/recruiter/positions` | 우리 회사 공고 목록 (진단 대상 선택용) | `positions` (company_id로 필터) |
| GET | `/api/recruiter/positions/{id}/competitiveness` | 시장 대비 보상금 백분위, 부족한 매력 태그, 매력 태그별 지원자수/합격률 비교 | `category_market_stats`, `tag_effect_stats` |

## 9. 채용자 — 파이프라인 병목·이탈 위험 알림 (PRD 5.6)

| Method | Path | 설명 | DB 근거 |
|---|---|---|---|
| GET | `/api/recruiter/positions/{id}/hiring-goal` | 목표 지원자 수/목표일 조회 | `position_hiring_goals` |
| PUT | `/api/recruiter/positions/{id}/hiring-goal` | 목표 지원자 수 설정 (스캔바 기준값) | `position_hiring_goals` |
| GET | `/api/recruiter/positions/goal-progress` | 전체 진행 중 공고의 목표 달성률 스캔바 데이터 (미달위험/지켜봐야함/정상진행) | `position_hiring_goals` + `applications` count |
| GET | `/api/recruiter/risk-alerts?status=open&severity=` | 위험 알림 목록 (마감임박, 정체, 미열람, 처리지연, 형평성) | `risk_alerts` |
| POST | `/api/recruiter/risk-alerts/{id}/actions` | 알림에 대한 액션 실행 (body: `action_type`). 액션 종류에 따라 아래 항목을 함께 트리거 | `alert_actions` + (해당 시) `positions` 수정 |
| PATCH | `/api/recruiter/positions/{id}` | 공고 자체 조정 — 마감일 연장(`due_time`), 보상금 상향(`reward_total`), 조건 완화(`years`/`region` 필터), 매력 태그 추가(`position_tags`) | `positions`, `position_tags` |

**액션 버튼 ↔ API 매핑** (5.6 위험 카드의 각 버튼이 호출하는 조합)

| 액션 버튼 | 호출 API |
|---|---|
| 마감일 연장 | `PATCH /api/recruiter/positions/{id}` (`due_time`) + `POST .../actions` |
| 보상금 상향 | `PATCH /api/recruiter/positions/{id}` (`reward_total`) + `POST .../actions` |
| 조건 완화 / 매력 태그 추가 | `PATCH /api/recruiter/positions/{id}` + `POST .../actions` |
| 담당자 리마인드 / SLA 기준 설정 | `POST .../actions` (내부 알림 발송, 공고 자체 수정 없음) |
| 지연 안내 메시지 발송 | `POST .../actions` + 지원자 알림 발송 (이메일/문자 연동, MVP 이후) |

## 10. 채용자 — ATS 지원 관리 (PRD 5.6의 기반 데이터)

| Method | Path | 설명 | DB 근거 |
|---|---|---|---|
| GET | `/api/recruiter/positions/{id}/applications?status=&sort=` | 공고별 지원자 목록 | `applications` |
| GET | `/api/recruiter/applications/{id}` | 지원자 상세(이력서 포함) | `applications`, `resumes` |
| PATCH | `/api/recruiter/applications/{id}` | 지원 상태 변경(서류합격/최종합격/불합격 등) | `applications` + `application_status_history` 기록 |

## 11. 채용 조건 트렌드 (PRD 5.7, 공용 모듈)

| Method | Path | 설명 | DB 근거 |
|---|---|---|---|
| GET | `/api/trends/skill-tags?period=week\|quarter&direction=up\|down&limit=3` | 상승/하락 스킬 태그 랭킹 | `skill_tag_trend` |

이 엔드포인트는 채용자 화면(5.7)뿐 아니라 지원자 마켓 홈(5.0-B 참고정보)과 취준 로드맵(5.1 가중치 반영)에서도 동일하게 호출한다 — PRD 6장의 공용 데이터 모듈 원칙을 그대로 반영한 것이다.

## 12. 관리자/배치 트리거 (내부용, 프론트 미노출)

| Method | Path | 설명 |
|---|---|---|
| POST | `/api/internal/sync/positions` | 원티드 API → `positions`/`companies`/`position_tags` 동기화 배치 트리거 |
| POST | `/api/internal/sync/company-insight` | `company_insight_snapshots` 갱신 배치 트리거 |
| POST | `/api/internal/aggregate/category-daily-snapshot` | 마켓 홈용 일별 스냅샷 집계 배치 |
| POST | `/api/internal/aggregate/skill-tag-trend` | 스킬 태그 트렌드 집계 배치 |
| POST | `/api/internal/scan/risk-alerts` | 위험 알림 스캔 및 생성/해제 배치 |

이 그룹은 스케줄러(cron)나 내부 관리자만 호출하며, 별도의 내부 인증(서비스 토큰)으로 보호하고 일반 사용자 JWT로는 접근할 수 없게 한다.
