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
 * 보상금 백분위 — 같은 직군(category) 내 실제 positions.reward_total 분포에서의 정확한 순위.
 * category_market_stats(평균/P50/P90 3개 지점) 보간 대신, 이미 클라이언트에 전량 로드된
 * positions 데이터로 직접 순위를 계산해 근사가 아닌 정확한 값을 낸다.
 */
export function computeRewardPercentileExact(reward, categoryPositions) {
  if (reward == null) return null;
  const sample = categoryPositions.filter((p) => p.reward_total != null);
  if (sample.length < 2) return null;
  const countAtOrBelow = sample.filter((p) => p.reward_total <= reward).length;
  const percentile = Math.max(1, Math.min(99, Math.round((countAtOrBelow / sample.length) * 100)));
  return { percentile, sampleSize: sample.length };
}

/**
 * 보상금 배지 획득 챌린지 — category_market_stats(reward_avg/reward_p90, 실측)만 사용한다.
 * "인상하면 지원율이 오른다" 같은 전환율 예측은 ATS 데이터가 없어 넣지 않고,
 * 목표 금액까지 얼마나 남았는지(달성 여부/금액 갭)만 보여준다.
 */
export function computeRewardBadgeChallenge(position, categoryMarketStats) {
  const stats = categoryMarketStats.find((s) => s.category_tag_id === position.category.id);
  if (!stats || position.reward_total == null) return null;
  const { reward_avg: avg, reward_p90: p90 } = stats;
  if (avg == null || p90 == null) return null;

  const tiers = [
    { key: 'average', label: '업계 평균 이상 배지', threshold: avg },
    { key: 'top10', label: '상위 10% 배지', threshold: p90 },
  ].map((t) => ({
    ...t,
    achieved: position.reward_total >= t.threshold,
    gap: Math.max(0, t.threshold - position.reward_total),
  }));

  return { categoryName: stats.category_name, tiers, reward: position.reward_total };
}

/**
 * 회사 배지(company_tags) 실측 벤치마킹 — 원티드가 실제로 부여한 배지 데이터만 사용한다(창작값 없음).
 * 동일 직군에 공고를 낸 회사들(peer group) 중 각 배지를 보유한 회사 비율을 계산하고,
 * 대상 회사가 이미 보유한 배지는 owned=true로 표시한다.
 */
export function computeCompanyBadgeBenchmark(positions, companyTagsByCompanyId, targetCompanyId, categoryId, topN = 8) {
  const peerCompanyIds = new Set(
    positions.filter((p) => p.category.id === categoryId && p.company.id != null).map((p) => p.company.id)
  );
  if (peerCompanyIds.size === 0) {
    return { peerCompanyCount: 0, ranking: [], ownBadges: [] };
  }

  const badgeCompanyCount = new Map();
  peerCompanyIds.forEach((cid) => {
    const uniqueBadges = new Set(companyTagsByCompanyId.get(cid) || []);
    uniqueBadges.forEach((title) => {
      badgeCompanyCount.set(title, (badgeCompanyCount.get(title) || 0) + 1);
    });
  });

  const ownBadges = new Set(companyTagsByCompanyId.get(targetCompanyId) || []);

  const ranking = Array.from(badgeCompanyCount.entries())
    .map(([title, count]) => ({
      title,
      count,
      pct: (count / peerCompanyIds.size) * 100,
      owned: ownBadges.has(title),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);

  return { peerCompanyCount: peerCompanyIds.size, ranking, ownBadges: Array.from(ownBadges) };
}

/** 매력 태그별 지원자수 랭킹 — tag_effect_stats 전량이 시연용 합성값(is_demo=true)임을 UI에서 반드시 표시한다 */
export function rankTagEffectStats(tagEffectStats, topN = 8) {
  return [...tagEffectStats].sort((a, b) => (b.avg_applicants || 0) - (a.avg_applicants || 0)).slice(0, topN);
}

/** 경쟁 공고 — 같은 직군에서 같은 인재풀을 두고 경쟁하는 타사의 오픈 공고 */
export function computeCompetingPositions(positions, targetPosition, { limit = 6 } = {}) {
  return positions
    .filter(
      (p) =>
        p.id !== targetPosition.id &&
        p.company.id !== targetPosition.company.id &&
        p.category.id === targetPosition.category.id &&
        p.status === 'active' &&
        (p.daysLeft === null || p.daysLeft >= 0)
    )
    .sort((a, b) => (b.reward_total || 0) - (a.reward_total || 0))
    .slice(0, limit);
}
