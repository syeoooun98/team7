// 각 탭에서 필요한 파생 지표 계산 — 전부 순수 함수(입력 → 출력)로 작성해 테스트/재사용이 쉽게 한다.

const URGENT_WITHIN_DAYS = 7;
const KNOWN_APPLY_TYPES = ['foreigner', 'alternative_military', 'disabled_person'];

/* ==================== 5.0-A 전체 시장 판세 (Zoom-out) ==================== */

export function computeCategoryDistribution(positions) {
  const map = new Map();
  positions.forEach((p) => {
    const key = p.category.name;
    map.set(key, (map.get(key) || 0) + 1);
  });
  return Array.from(map.entries())
    .map(([label, value]) => ({ label, value, colorKey: label }))
    .sort((a, b) => b.value - a.value);
}

export function computeRegionDistribution(positions) {
  const map = new Map();
  positions.forEach((p) => {
    const key = p.location || '기타';
    map.set(key, (map.get(key) || 0) + 1);
  });
  return Array.from(map.entries())
    .map(([label, value]) => ({ label, value, color: '#5b8def' }))
    .sort((a, b) => b.value - a.value);
}

export function computeDistrictDistribution(positions, topN = 10) {
  const map = new Map();
  positions.forEach((p) => {
    const key = p.district || '기타';
    map.set(key, (map.get(key) || 0) + 1);
  });
  return Array.from(map.entries())
    .map(([label, value]) => ({ label, value, color: '#34c77b' }))
    .sort((a, b) => b.value - a.value)
    .slice(0, topN);
}

export function getUrgentPositions(positions, withinDays = URGENT_WITHIN_DAYS) {
  return positions
    .filter((p) => p.daysLeft !== null && p.daysLeft >= 0 && p.daysLeft <= withinDays)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

export function getApplyTypeCounts(positions) {
  const counts = Object.fromEntries(KNOWN_APPLY_TYPES.map((t) => [t, 0]));
  positions.forEach((p) => {
    p.applyTypes.forEach((t) => {
      if (t in counts) counts[t] += 1;
    });
  });
  return counts;
}

export function computeKpis(positions, companyCount, weekly) {
  const urgentCount = getUrgentPositions(positions).length;
  const withApplyType = positions.filter((p) => p.applyTypes.length > 0).length;
  return {
    totalOpen: positions.length,
    companyCount,
    urgentCount,
    withApplyType,
    newThisWeek: weekly ? weekly.newThisWeek : null,
    newChangePct: weekly ? weekly.newChangePct : null,
    closedThisWeek: weekly ? weekly.closedThisWeek : null,
  };
}

/* ==================== 5.0-B 이번 주 핵심 변화 (Zoom-in) ==================== */
/* category_daily_snapshot: 14일치(오늘 실측 + 과거 13일 합성 백필)가 적재되어 있다 */

function distinctSortedDatesDesc(rows) {
  return [...new Set(rows.map((r) => r.snapshot_date))].sort((a, b) => b.localeCompare(a));
}

/** 최근 7일 "오픈 공고 수(스톡)" 일별 추이 — 미니 라인차트용 */
export function computeWeeklyOpenTrend(rows) {
  const datesAsc = distinctSortedDatesDesc(rows).slice(0, 7).reverse();
  return datesAsc.map((date) => ({
    date,
    value: rows.filter((r) => r.snapshot_date === date).reduce((s, r) => s + r.open_count, 0),
  }));
}

/** 이번 주(최근 7일) 신규 등록/마감 종료 "플로우" 합계 + 전주 대비 증감율 */
export function computeNewClosedWeekly(rows) {
  const datesDesc = distinctSortedDatesDesc(rows);
  const last7 = datesDesc.slice(0, 7);
  const prev7 = datesDesc.slice(7, 14);
  const sumFieldForDates = (field, dates) =>
    rows.filter((r) => dates.includes(r.snapshot_date)).reduce((s, r) => s + (r[field] || 0), 0);

  const newThisWeek = sumFieldForDates('new_count', last7);
  const newPrevWeek = sumFieldForDates('new_count', prev7);
  const closedThisWeek = sumFieldForDates('closed_count', last7);
  const newChangePct = newPrevWeek > 0 ? ((newThisWeek - newPrevWeek) / newPrevWeek) * 100 : null;

  return { newThisWeek, newPrevWeek, newChangePct, closedThisWeek, last7, prev7 };
}

/** 급등/급감 "직군" TOP3 — 오늘(최신 스냅샷) vs 정확히 7일 전 스냅샷의 오픈 공고 수 비교 */
export function computeCategoryMomentum(rows, { minBase = 5, topN = 3 } = {}) {
  const datesDesc = distinctSortedDatesDesc(rows);
  const latest = datesDesc[0];
  const weekAgo = datesDesc[6];
  if (!latest || !weekAgo) return { up: [], down: [], latest: null, weekAgo: null };

  const byCategory = new Map();
  rows.forEach((r) => {
    if (r.snapshot_date !== latest && r.snapshot_date !== weekAgo) return;
    if (!byCategory.has(r.category_name)) byCategory.set(r.category_name, { now: 0, prev: 0 });
    const entry = byCategory.get(r.category_name);
    if (r.snapshot_date === latest) entry.now += r.open_count;
    else entry.prev += r.open_count;
  });

  const list = Array.from(byCategory.entries())
    .map(([name, v]) => ({
      name,
      now: v.now,
      prev: v.prev,
      diff: v.now - v.prev,
      pct: v.prev > 0 ? ((v.now - v.prev) / v.prev) * 100 : null,
    }))
    .filter((x) => x.prev >= minBase && x.pct !== null);

  const up = [...list].sort((a, b) => b.pct - a.pct).slice(0, topN);
  const down = [...list].sort((a, b) => a.pct - b.pct).slice(0, topN);

  return { up, down, latest, weekAgo };
}

/* ==================== 5.7 채용 조건 트렌드 (스킬 태그, 공용 모듈) ==================== */
/* 실제 적재 데이터는 period_type='week'만 존재(8주치) — PRD 원문의 "전분기 대비"는
   실측 데이터 범위에 맞춰 "전주 대비(주간 기준)"로 표시한다. */

export function latestSkillWeek(skillTagTrend) {
  const weekRows = skillTagTrend.filter((r) => r.period_type === 'week');
  const dates = [...new Set(weekRows.map((r) => r.period_start))].sort((a, b) => b.localeCompare(a));
  return dates[0] || null;
}

export function computeSkillMovers(skillTagTrend, { topN = 3 } = {}) {
  const weekRows = skillTagTrend.filter((r) => r.period_type === 'week');
  const latest = latestSkillWeek(skillTagTrend);
  const latestRows = weekRows.filter((r) => r.period_start === latest && r.delta_pct_vs_prev !== null);

  const up = [...latestRows].sort((a, b) => b.delta_pct_vs_prev - a.delta_pct_vs_prev).slice(0, topN);
  const down = [...latestRows].sort((a, b) => a.delta_pct_vs_prev - b.delta_pct_vs_prev).slice(0, topN);

  return { up, down, latest };
}

export function computeSkillMentionRanking(skillTagTrend, { topN = 15 } = {}) {
  const weekRows = skillTagTrend.filter((r) => r.period_type === 'week');
  const latest = latestSkillWeek(skillTagTrend);
  return weekRows
    .filter((r) => r.period_start === latest)
    .sort((a, b) => b.mention_count - a.mention_count)
    .slice(0, topN);
}

export function computeSkillSeries(skillTagTrend, skillName) {
  return skillTagTrend
    .filter((r) => r.period_type === 'week' && r.skill_name === skillName)
    .sort((a, b) => a.period_start.localeCompare(b.period_start))
    .map((r) => ({ date: r.period_start, value: r.mention_count }));
}

/* ==================== 5.0-C 지원할 공고 (Action) ==================== */

/**
 * 개인화(로그인) 기능이 없는 1차 버전이므로, 로그인 기반 맞춤 정렬 대신
 * "최근 등록 + 보상금" 기준 휴리스틱으로 추천한다 (5.4 도입 전 임시 로직).
 */
export function recommendPositions(positions, { limit = 6 } = {}) {
  return [...positions]
    .filter((p) => p.status === 'active' && (p.daysLeft === null || p.daysLeft >= 0))
    .sort((a, b) => {
      const rewardDiff = (b.rewardTotal ?? b.reward_total ?? 0) - (a.rewardTotal ?? a.reward_total ?? 0);
      if (rewardDiff !== 0) return rewardDiff;
      return new Date(b.synced_at) - new Date(a.synced_at);
    })
    .slice(0, limit);
}

/* ==================== 5.1 취준 로드맵 ==================== */

export function computeCategorySkillFrequency(positions, categoryId) {
  const scoped = categoryId ? positions.filter((p) => p.category.id === categoryId) : positions;
  const map = new Map();
  scoped.forEach((p) => p.skills.forEach((s) => map.set(s, (map.get(s) || 0) + 1)));
  const total = scoped.length;
  const ranking = Array.from(map.entries())
    .map(([name, count]) => ({ name, count, pct: total ? (count / total) * 100 : 0 }))
    .sort((a, b) => b.count - a.count);
  return { total, ranking };
}

<<<<<<< HEAD
=======
// 원티드 API는 스킬 태그를 "언어/프레임워크/DB" 같은 종류로 구분해서 주지 않는다(DB.md 3.2절 —
// skill_tags에 안정적 분류 필드 자체가 없음). 그래서 실제로 자주 등장하는 스킬 이름을 수동으로
// 묶어서 UI에서만 그룹핑한다. 목록에 없는 이름은 '기타'로 빠진다.
// 개발/디자인/마케팅/영업/HR/엔지니어링/바이오 등 여러 직군의 실제 position_skill_tags를
// Supabase에서 직접 조회해 등장 빈도가 있는 이름들 위주로 묶었다(전수는 아님).
const SKILL_GROUPS = [
  {
    key: 'language',
    label: '언어',
    skills: ['Python', 'JavaScript', 'Java', 'TypeScript', 'C++', 'C', 'C / C++', 'Kotlin', 'Go', 'C#', 'PHP', 'Swift', 'Rust', 'Scala', 'Ruby', 'Dart', 'R'],
  },
  {
    key: 'web-basics',
    label: '웹 기본기',
    skills: ['HTML', 'CSS'],
  },
  {
    key: 'framework',
    label: '프레임워크·라이브러리',
    skills: ['React', 'React.js', 'Spring Framework', 'Spring Boot', 'Node.js', 'NodeJS', 'Next.js', 'Django', 'Nest.js', 'Vue.js', 'jQuery', 'FastAPI', 'JPA', 'Express', 'Flask', 'Angular', '.NET', 'ASP.NET', 'Restful API'],
  },
  {
    key: 'database',
    label: '데이터베이스',
    skills: ['MySQL', 'SQL', 'PostgreSQL', 'MongoDB', 'Redis', 'RDBMS', 'NoSQL', 'ElasticSearch', 'Oracle', 'MariaDB', 'DynamoDB', 'Firebase'],
  },
  {
    key: 'infra',
    label: '인프라·클라우드',
    skills: ['AWS', 'Docker', 'Kubernetes', 'Linux', 'Jenkins', 'Nginx', 'Git', 'GitHub', 'GitLab', 'Azure', 'GCP', 'CI/CD', 'Terraform'],
  },
  {
    key: 'data-ai',
    label: 'AI·데이터',
    skills: ['PyTorch', 'Tensorflow', 'ML', 'OpenCV', '딥 러닝', '머신러닝', '데이터 분석', 'Pandas', 'NumPy', 'Spark', 'Hadoop', 'Airflow', 'Tableau'],
  },
  {
    key: 'mobile',
    label: '모바일',
    skills: ['Android', 'iOS', 'Flutter', 'React Native'],
  },
  {
    key: 'game-dev',
    label: '게임 개발',
    skills: ['Unreal Engine', 'Unity3D', 'Maya', 'OpenGL', 'VR', '3D 모델링', 'HLSL', 'Perforce', 'Adobe Animate'],
  },
  {
    key: 'design',
    label: '디자인',
    skills: [
      'Figma', 'Adobe Illustrator', 'Adobe Photoshop', 'Photoshop Elements', 'Sketch', '스케치', 'Zeplin', 'Adobe XD', 'Adobe',
      'UI 디자인', 'UX 디자인', '그래픽 디자인', '서비스 디자인', '웹 디자인', '제품 디자인', 'After Effect', 'ProtoPie', '타이포그래피', '인터랙션 디자인',
    ],
  },
  {
    key: 'media-production',
    label: '영상·미디어 제작',
    skills: ['Adobe Premiere', 'Final Cut Studio', '파이널 컷 프로', '영상 편집', '영상', 'Youtube', '카메라', '편집', '미디어 준비', '감독'],
  },
  {
    key: 'marketing',
    label: '마케팅·광고',
    skills: [
      'Google Analytics', 'GA', '마케팅 전략', '마케팅 운영', '마케팅 분석', '마케팅 관리', 'Amplitude', '마케팅 이벤트 기획', 'CRM', '홍보',
      '브랜딩', '광고 대행사', '콘텐츠 제작', '광고 운영', '마케팅 커뮤니케이션', '컨텐츠 마케팅', '광고 관리', '인바운드 마케팅', 'SEO', '퍼포먼스 마케팅',
    ],
  },
  {
    key: 'sales-biz',
    label: '영업·비즈니스',
    skills: ['영업', '영업 관리', '영업 담당자', 'B2B', '영업 프로세스', '영업 운영', '솔루션 판매', '영업 지원', 'B2B 마케팅', '컨설팅', '전략 분석', '전략 기획', '사업 계획', '사업 담당', '사업 전략', 'Product Management'],
  },
  {
    key: 'hr',
    label: '인사·HR',
    skills: ['HRM', '인사 관리', '채용', '평가', '보상', 'HR 전략', 'LinkedIn', '노무 관리', '조직 문화', '급여 관리', '리크루터', 'HRD', 'HR 컨설팅'],
  },
  {
    key: 'customer-service',
    label: '고객서비스·리테일',
    skills: ['고객 만족', '고객 경험', '고객 중심', '고객 유지', '매장 운영', '매장 관리', '패션', '직원 교육', 'POS', '고객 지원', '고객 관계'],
  },
  {
    key: 'finance-accounting',
    label: '재무·회계',
    skills: ['세무 회계', '자금 세탁 방지', '은행업', '재무 관리', 'IR', 'ERP 구현', '투자 전략', '회계사', 'CPA', 'AML', '투자 관리', 'SAP', '회계'],
  },
  {
    key: 'security',
    label: '보안',
    skills: ['정보 보안', '보안 운영', '보안 정책'],
  },
  {
    key: 'engineering-design',
    label: '엔지니어링·설계',
    skills: ['Solidworks', 'Creo', 'AutoCAD', 'CAD', '설계', 'ProE', 'Solidworks Simulation', 'PLC', 'PLC 프로그래밍', 'ANSYS', '로봇', '로봇 프로그래밍', '메카트로닉스', 'ORCAD', 'NX', '전기', '네트워크 운영'],
  },
  {
    key: 'construction',
    label: '건설·건축',
    skills: ['인테리어 디자인', '건설', '건설 관리', '건축 도면', '건축 설계', '건축', 'SketchUp', '프로젝트 관리'],
  },
  {
    key: 'logistics-scm',
    label: '물류·SCM',
    skills: ['물류', '물류 관리', '물류 지원', '자동화 구축', '재고 관리', '재고 정확도', '유통', '물류 엔지니어링', 'SCM', '구매', '구매 주문', '구매 프로세스', '공급자 관리'],
  },
  {
    key: 'quality-manufacturing',
    label: '품질·생산관리',
    skills: ['GMP', 'ISO', 'ISO 13485', '품질 관리', '품질 시스템', '품질 향상', '기록 관리', 'Fusion360', '납땜'],
  },
  {
    key: 'bio-pharma',
    label: '바이오·제약',
    skills: [
      '의료 기기', '허가 환경', '의료 장비', '화학 생물학', '의약 화학', '임상 연구', '약사', '고분자 화학',
      '유기 화학', '신약 개발', '바이오', '유기 합성', '실험 설계', 'NMR', 'HPLC', '제형 개발', '화학 정보학', '임상 시험', 'LCMS',
    ],
  },
  {
    key: 'legal',
    label: '법률',
    skills: ['변호사', '법무', '법률 지원', '법률 문서', '법률 보조', '법률', '법학', '계약 분쟁', '사무직'],
  },
  {
    key: 'education-content',
    label: '교육·콘텐츠',
    skills: ['소프트웨어 교육', '교육 기술', '시장 조사', '콘텐츠 개발', '온라인 교육', '영어 교육', '교육', '콘텐츠 전략', '콘텐츠 관리'],
  },
  {
    key: 'collab',
    label: '협업 툴·오피스',
    skills: ['JIRA', 'Notion', 'Confluence', 'Slack', 'Microsoft 365', 'Excel', 'PowerPoint', 'Word', 'Google Workspace', 'ERP 소프트웨어', 'Flex'],
  },
  {
    key: 'qa',
    label: 'QA',
    skills: ['QA 엔지니어링', 'QA', '테스트 자동화'],
  },
];

const SKILL_NAME_TO_GROUP_KEY = new Map();
SKILL_GROUPS.forEach((g) => g.skills.forEach((s) => SKILL_NAME_TO_GROUP_KEY.set(s.toLowerCase(), g.key)));

/**
 * computeCategorySkillFrequency().ranking을 언어/프레임워크/DB 등으로 묶는다.
 * 매핑되지 않은 스킬은 '기타' 그룹으로 모으고, 그룹 내부는 기존 count 내림차순을 유지한다.
 * 항목이 하나도 없는 그룹은 결과에서 제외한다.
 */
export function groupSkillRanking(ranking) {
  const buckets = new Map(SKILL_GROUPS.map((g) => [g.key, { key: g.key, label: g.label, items: [] }]));
  buckets.set('etc', { key: 'etc', label: '기타', items: [] });

  ranking.forEach((s) => {
    const groupKey = SKILL_NAME_TO_GROUP_KEY.get(s.name.toLowerCase()) || 'etc';
    buckets.get(groupKey).items.push(s);
  });

  return [...SKILL_GROUPS.map((g) => g.key), 'etc'].map((key) => buckets.get(key)).filter((b) => b.items.length > 0);
}

// 미보유 스킬 학습 로드맵(관련 자격증 제안)에 쓰는 참고용 큐레이션 데이터 — 실제 지원자/채용 통계가 아니다.
// Supabase 공고 텍스트(requirements/preferred_points)에서 자격증 이름과 스킬 태그의 동시 언급 빈도를
// 실제로 마이닝해봤지만(예: AWS ↔ RHCSA/CCNA), 표본이 공고 2~5건 수준으로 작아 우연한 동반 언급
// (예: AWS ↔ OPIc, 마케팅 전략 ↔ CPA)과 실제 연관성을 구분할 신뢰도가 없었다. 그래서 통계 대신
// 스킬(또는 스킬이 속한 분류)과 실제로 존재하는 자격증 중 통상적으로 관련 있다고 알려진 것을
// 사람이 골라 매핑했다 — 측정값이 아니라 참고 가이드로만 사용한다.
const SKILL_SPECIFIC_CERTS = {
  AWS: { certs: ['AWS Certified Solutions Architect – Associate', 'AWS Certified Developer – Associate'], note: '클라우드 실무 역량을 공식적으로 증명하는 벤더 자격증' },
  Docker: { certs: ['Docker Certified Associate'], note: '컨테이너 운영 역량 증빙' },
  Kubernetes: { certs: ['CKA (Certified Kubernetes Administrator)'], note: '컨테이너 오케스트레이션 실무 역량 증빙' },
  SQL: { certs: ['SQLD', 'SQLP'], note: '데이터베이스 설계·쿼리 역량 증명 국가공인자격' },
  MySQL: { certs: ['SQLD', 'SQLP'], note: '데이터베이스 설계·쿼리 역량 증명 국가공인자격' },
  PostgreSQL: { certs: ['SQLD', 'SQLP'], note: '데이터베이스 설계·쿼리 역량 증명 국가공인자격' },
  Linux: { certs: ['리눅스마스터', 'RHCSA'], note: '리눅스 운영 역량 증빙' },
  '정보 보안': { certs: ['정보보안기사', 'CISSP'], note: '보안 실무 국가공인·국제 자격증' },
  '보안 운영': { certs: ['정보보안기사', 'CISSP'], note: '보안 실무 국가공인·국제 자격증' },
  '보안 정책': { certs: ['정보보안기사', 'CISA'], note: '보안 정책·감사 역량 증빙' },
  'Google Analytics': { certs: ['GAIQ (Google Analytics Individual Qualification)'], note: '구글 공식 애널리틱스 역량 인증' },
  '마케팅 분석': { certs: ['GAIQ', 'ADsP'], note: '데이터 기반 마케팅 분석 역량 증빙' },
  '데이터 분석': { certs: ['ADsP', '빅데이터분석기사'], note: '데이터 분석 국가공인자격' },
  PyTorch: { certs: ['빅데이터분석기사'], note: 'AI/ML 직무 지원 시 데이터 분석 기초 역량 증빙으로 참고' },
  Tensorflow: { certs: ['빅데이터분석기사'], note: 'AI/ML 직무 지원 시 데이터 분석 기초 역량 증빙으로 참고' },
  회계: { certs: ['공인회계사(CPA)', '전산회계', '재경관리사'], note: '회계 실무·전문성 증빙' },
  '세무 회계': { certs: ['세무사', '전산세무'], note: '세무 실무 전문성 증빙' },
  '물류 관리': { certs: ['물류관리사', '유통관리사'], note: '물류·유통 실무 국가공인자격' },
  SCM: { certs: ['물류관리사', '국제무역사'], note: '공급망·무역 실무 자격' },
};

// 스킬 이름 개별 매핑에 없으면 groupSkillRanking()이 쓰는 SKILL_NAME_TO_GROUP_KEY로 분류를 찾아
// 그룹 단위 대표 자격증으로 대체한다.
const CERT_GROUP_FALLBACK = {
  language: { certs: ['정보처리기사'], note: '소프트웨어 개발 기초 소양 증빙으로 흔히 요구되는 국가공인자격' },
  'web-basics': { certs: ['정보처리기사'], note: '소프트웨어 개발 기초 소양 증빙' },
  framework: { certs: ['정보처리기사'], note: '소프트웨어 개발 기초 소양 증빙' },
  database: { certs: ['SQLD', 'SQLP'], note: '데이터베이스 설계·쿼리 역량 국가공인자격' },
  infra: { certs: ['리눅스마스터', '네트워크관리사'], note: '서버·네트워크 운영 역량 증빙' },
  'data-ai': { certs: ['빅데이터분석기사', 'ADsP'], note: '데이터 분석 국가공인자격' },
  mobile: { certs: ['정보처리기사'], note: '소프트웨어 개발 기초 소양 증빙' },
  design: { certs: ['GTQ', '웹디자인기능사'], note: '디자인 툴 활용 역량 국가공인자격' },
  marketing: { certs: ['GAIQ', 'ADsP'], note: '데이터 기반 마케팅 분석 역량 증빙' },
  'sales-biz': { certs: ['국제무역사', '유통관리사'], note: '영업·무역 실무 자격' },
  hr: { certs: ['공인노무사'], note: '인사·노무 실무 전문 자격' },
  'finance-accounting': { certs: ['공인회계사(CPA)', '전산회계'], note: '회계·재무 실무 전문 자격' },
  security: { certs: ['정보보안기사', 'CISSP'], note: '보안 실무 국가공인·국제 자격증' },
  'engineering-design': { certs: ['전기기사', '일반기계기사'], note: '설계·엔지니어링 실무 국가공인자격' },
  construction: { certs: ['건축기사', '토목기사'], note: '건설·건축 실무 국가공인자격' },
  'logistics-scm': { certs: ['물류관리사', '유통관리사'], note: '물류·유통 실무 국가공인자격' },
  'quality-manufacturing': { certs: ['품질경영기사'], note: '품질 관리 실무 국가공인자격' },
  'bio-pharma': { certs: ['위생사'], note: '바이오·제약 관련 국가공인자격' },
  legal: { certs: ['변호사'], note: '법률 실무 전문 자격' },
  qa: { certs: ['ISTQB'], note: 'SW 테스트 국제 자격증' },
};

/** 스킬 이름 → { certs: string[], note: string } | null. 개별 매핑 → 그룹 대체 순으로 조회한다. */
export function getCertSuggestion(skillName) {
  if (SKILL_SPECIFIC_CERTS[skillName]) return SKILL_SPECIFIC_CERTS[skillName];
  const groupKey = SKILL_NAME_TO_GROUP_KEY.get(skillName.toLowerCase());
  if (groupKey && CERT_GROUP_FALLBACK[groupKey]) return CERT_GROUP_FALLBACK[groupKey];
  return null;
}

>>>>>>> 870c06104acbc85d822ac30db06141e62ddb4cd1
// annual_to=100은 "경력 상한 없음(무관)"을 뜻하는 원티드 API의 관례적 센티넬 값이라 평균 계산에서 제외한다.
const ANNUAL_TO_UNLIMITED_SENTINEL = 99;

export function computeCategoryAnnualStats(positions, categoryId) {
  const inCategory = categoryId ? positions.filter((p) => p.category.id === categoryId) : positions;
  const withAnnual = inCategory.filter((p) => p.annual_from != null);
  if (!withAnnual.length) {
    return { avgFrom: null, avgTo: null, sample: 0, totalInCategory: inCategory.length };
  }
  const avgFrom = withAnnual.reduce((s, p) => s + p.annual_from, 0) / withAnnual.length;
  const withTo = withAnnual.filter((p) => p.annual_to != null && p.annual_to < ANNUAL_TO_UNLIMITED_SENTINEL);
  const avgTo = withTo.length ? withTo.reduce((s, p) => s + p.annual_to, 0) / withTo.length : null;
  return { avgFrom, avgTo, sample: withAnnual.length, totalInCategory: inCategory.length };
}

/**
 * 취준 로드맵 종합 계산.
 * mySkills: 사용자가 체크한 보유 스킬 이름 배열
 * risingSkillNames: 5.7 급등 스킬 이름 Set — 미보유 스킬 추천 시 가중치 참고용 배지
 */
export function computeRoadmap(positions, { categoryId, mySkills, risingSkillNames }) {
  const { ranking, total } = computeCategorySkillFrequency(positions, categoryId);
  const mySet = new Set(mySkills);

  const covered = ranking.filter((r) => mySet.has(r.name));
  const missing = ranking.filter((r) => !mySet.has(r.name));

  const totalMentions = ranking.reduce((s, r) => s + r.count, 0);
  const coveredMentions = covered.reduce((s, r) => s + r.count, 0);
  const weightedCoverage = totalMentions ? (coveredMentions / totalMentions) * 100 : 0;
  const uniqueCoverage = ranking.length ? (covered.length / ranking.length) * 100 : 0;

  const risingSet = risingSkillNames || new Set();
  const missingTop3 = missing.slice(0, 3).map((m) => ({ ...m, rising: risingSet.has(m.name) }));

  const scoped = categoryId ? positions.filter((p) => p.category.id === categoryId) : positions;
  const scored = scoped
    .map((p) => ({ position: p, matched: p.skills.filter((s) => mySet.has(s)) }))
    .filter((x) => x.matched.length > 0)
    .sort((a, b) => b.matched.length - a.matched.length || (b.position.reward_total || 0) - (a.position.reward_total || 0));

  return {
    sampleSize: total,
    weightedCoverage,
    uniqueCoverage,
    missingTop3,
    topPositions: scored.slice(0, 3),
    requiredSkillCount: ranking.length,
    coveredSkillCount: covered.length,
  };
}

/* ==================== 5.5 공고 경쟁력 진단 (채용자) ==================== */

export function computeCompanyOptions(positions) {
  const map = new Map();
  positions.forEach((p) => {
    if (!p.company.id) return;
    if (!map.has(p.company.id)) map.set(p.company.id, { id: p.company.id, name: p.company.name, count: 0 });
    map.get(p.company.id).count += 1;
  });
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

export function getPositionsForCompany(positions, companyId) {
  return positions.filter((p) => p.company.id === companyId).sort((a, b) => a.title.localeCompare(b.title, 'ko'));
}

/**
 * 보상금 백분위 근사치.
 * category_market_stats는 (평균/P50/P90) 3개 지점만 제공하므로, 구간 선형보간으로 근사한다.
 * 표본 3개 지점 기반 근사치임을 UI에 반드시 명시한다.
 */
export function computeRewardPercentile(reward, stats) {
  if (reward == null || !stats) return null;
  const { reward_p50: p50, reward_p90: p90 } = stats;
  if (p50 == null || p90 == null) return null;

  let pct;
  if (reward <= 0) {
    pct = 0;
  } else if (reward <= p50) {
    pct = p50 > 0 ? (reward / p50) * 50 : 50;
  } else if (p90 > p50 && reward <= p90) {
    pct = 50 + ((reward - p50) / (p90 - p50)) * 40;
  } else {
    const over = p90 > 0 ? (reward - p90) / p90 : 0;
    pct = 90 + Math.min(9, over * 30);
  }
  return Math.max(1, Math.min(99, Math.round(pct)));
}

/** 회사가 아직 보유하지 않은 매력 태그 중 지원자수/합격률이 높은 것을 제안 */
export function suggestAttractionTags(companyTagTitles, tagEffectStats, topN = 3) {
  const have = new Set(companyTagTitles);
  return [...tagEffectStats]
    .filter((t) => !have.has(t.tag_name))
    .sort((a, b) => (b.avg_applicants || 0) - (a.avg_applicants || 0))
    .slice(0, topN);
}

export function rankTagEffectStats(tagEffectStats, topN = 10) {
  return [...tagEffectStats].sort((a, b) => (b.avg_applicants || 0) - (a.avg_applicants || 0)).slice(0, topN);
}
