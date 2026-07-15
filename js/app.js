import { fetchAllRaw, subscribeRealtime } from './api.js';
import { buildModel } from './model.js';
import {
  computeCategoryDistribution,
  computeRegionDistribution,
  computeDistrictDistribution,
  getUrgentPositions,
  getApplyTypeCounts,
  computeKpis,
  computeWeeklyOpenTrend,
  computeNewClosedWeekly,
  computeCategoryMomentum,
  computeSkillMovers,
  computeSkillMentionRanking,
  recommendPositions,
  computeCategorySkillFrequency,
  computeCategoryAnnualStats,
  computeRoadmap,
  computeCompanyOptions,
  getPositionsForCompany,
  computeRewardPercentileExact,
  computeRewardBadgeChallenge,
  computeCompanyBadgeBenchmark,
  rankTagEffectStats,
  computeCompetingPositions,
} from './aggregate.js';
import {
  renderHBarChart,
  renderSparkline,
  renderGaugeBar,
  colorForKey,
  formatWon,
  formatDate,
  formatPct,
  pctTone,
  ddayBadge,
  applyTypeLabel,
} from './charts.js';

/* ------------------------------------------------------------------ */
/* 상태                                                                 */
/* ------------------------------------------------------------------ */

const state = {
  model: null,
  companyCount: 0,
  mode: 'applicant',
  activeTab: { applicant: 'home', recruiter: 'diagnosis' },
  filters: {
    q: '',
    categoryId: 'all',
    subTagIds: new Set(),
    regions: new Set(),
    applyTypes: new Set(),
    urgentOnly: false,
    sort: 'deadline',
  },
  searchVisibleCount: 24,
  roadmap: { categoryId: null, years: 0, mySkills: new Set() },
  diagnosis: { companyId: null, positionId: null },
};

const URGENT_WITHIN_DAYS = 7;
const SEARCH_PAGE_SIZE = 24;
const KNOWN_APPLY_TYPES = ['foreigner', 'alternative_military', 'disabled_person'];

/* ------------------------------------------------------------------ */
/* 유틸                                                                 */
/* ------------------------------------------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHTML(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  toast.classList.add('toast--show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toast.classList.remove('toast--show');
    setTimeout(() => toast.classList.add('hidden'), 250);
  }, 2600);
}

/* ------------------------------------------------------------------ */
/* 공고 카드 렌더링 (여러 탭에서 공용)                                       */
/* ------------------------------------------------------------------ */

function positionCardHTML(p, opts = {}) {
  const badge = ddayBadge(p.daysLeft);
  const initial = (p.company.name || '?').charAt(0);
  const avatarColor = colorForKey(p.company.name);
  const logoUrl = p.company.logo_url;

  const tagNames = [p.category.name, ...p.subTags.map((t) => t.name)].filter(Boolean).slice(0, 3);
  const tagsHTML = tagNames
    .map((name, i) => `<span class="tag-chip ${i === 0 ? 'tag-chip--category' : ''}">${escapeHTML(name)}</span>`)
    .join('');

  const skillHTML = (p.skills || [])
    .slice(0, 4)
    .map((s) => `<span class="tag-chip tag-chip--skill">${escapeHTML(s)}</span>`)
    .join('');

  const applyHTML = p.applyTypes
    .map((t) => `<span class="apply-badge">${escapeHTML(applyTypeLabel(t))}</span>`)
    .join('');

  const matchedHTML =
    opts.matchedSkills && opts.matchedSkills.length
      ? `<div class="matched-badge">✅ 보유 스킬 매칭 ${opts.matchedSkills.length}개 — ${opts.matchedSkills
          .map((s) => escapeHTML(s))
          .join(', ')}</div>`
      : '';

  return `
    <article class="position-card">
      <div class="position-card__head">
        <div class="company-avatar" style="background:${avatarColor}">
          <span class="company-avatar__fallback">${escapeHTML(initial)}</span>
          ${logoUrl ? `<img class="company-avatar__img" src="${escapeHTML(logoUrl)}" alt="" onerror="this.style.display='none'" />` : ''}
        </div>
        <div class="position-card__titles">
          <p class="company-name">${escapeHTML(p.company.name)}</p>
          <h3 class="position-title">${escapeHTML(p.title)}</h3>
        </div>
        <span class="dday-badge dday-badge--${badge.tone}">${escapeHTML(badge.text)}</span>
      </div>
      <div class="tag-row">${tagsHTML}${skillHTML}</div>
      ${applyHTML ? `<div class="apply-row">${applyHTML}</div>` : ''}
      ${matchedHTML}
      <div class="position-card__meta">
        <span title="지역(구/시 단위는 주소 텍스트 기반 근사치)">📍 ${escapeHTML(p.district)} · ${escapeHTML(p.location || '-')}</span>
        <span>💰 ${formatWon(p.reward_total)}</span>
        <span>🗓 ${p.due_time ? formatDate(p.due_time) : '상시채용'}</span>
      </div>
      <a class="card-cta" href="${p.url}" target="_blank" rel="noopener noreferrer">원티드에서 공고 보기 ↗</a>
    </article>
  `;
}

/* ------------------------------------------------------------------ */
/* 등락 리스트 렌더링 공용 컴포넌트                                          */
/* ------------------------------------------------------------------ */

function renderCategoryMoverList(container, items) {
  if (!items || items.length === 0) {
    container.innerHTML = '<div class="empty-state">표시할 데이터가 없습니다.</div>';
    return;
  }
  container.innerHTML = items
    .map(
      (m) => `
      <div class="mover-item">
        <span class="mover-item__name">${escapeHTML(m.name)}</span>
        <span class="mover-item__pct mover-item__pct--${pctTone(m.pct)}">${formatPct(m.pct)}</span>
        <span class="mover-item__detail">${m.prev.toLocaleString()}건 → ${m.now.toLocaleString()}건</span>
      </div>
    `
    )
    .join('');
}

function renderSkillMoverList(container, items) {
  if (!items || items.length === 0) {
    container.innerHTML = '<div class="empty-state">표시할 데이터가 없습니다.</div>';
    return;
  }
  container.innerHTML = items
    .map(
      (m) => `
      <div class="mover-item">
        <span class="mover-item__name">${escapeHTML(m.skill_name)}</span>
        <span class="mover-item__pct mover-item__pct--${pctTone(m.delta_pct_vs_prev)}">${formatPct(m.delta_pct_vs_prev)}</span>
        <span class="mover-item__detail">이번 주 언급 ${m.mention_count.toLocaleString()}건</span>
      </div>
    `
    )
    .join('');
}

function renderInlineSkillTrend(container, movers) {
  const items = [...(movers.up || []).slice(0, 2), ...(movers.down || []).slice(0, 2)];
  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state">표시할 데이터가 없습니다.</div>';
    return;
  }
  container.innerHTML = items
    .map(
      (m) => `
      <span class="mover-chip mover-chip--${pctTone(m.delta_pct_vs_prev)}">
        ${escapeHTML(m.skill_name)} <strong>${formatPct(m.delta_pct_vs_prev)}</strong>
      </span>
    `
    )
    .join('');
}

/* ==================================================================== */
/* 지원자 입장 — 0. 마켓 홈                                                 */
/* ==================================================================== */

function renderHome() {
  const { positions, categoryDailySnapshot, skillTagTrend } = state.model;
  const weekly = computeNewClosedWeekly(categoryDailySnapshot);
  const kpis = computeKpis(positions, state.companyCount, weekly);

  $('#kpi-cards').innerHTML = `
    <div class="kpi-card">
      <p class="kpi-label">전체 오픈 공고</p>
      <p class="kpi-value">${kpis.totalOpen.toLocaleString()}<span class="kpi-unit">건</span></p>
    </div>
    <div class="kpi-card">
      <p class="kpi-label">참여 기업 수</p>
      <p class="kpi-value">${kpis.companyCount.toLocaleString()}<span class="kpi-unit">개사</span></p>
    </div>
    <div class="kpi-card">
      <p class="kpi-label">이번 주 신규 등록</p>
      <p class="kpi-value">${kpis.newThisWeek != null ? kpis.newThisWeek.toLocaleString() : '-'}<span class="kpi-unit">건</span></p>
      <p class="kpi-sub kpi-sub--${pctTone(kpis.newChangePct)}">전주 대비 ${formatPct(kpis.newChangePct)}</p>
    </div>
    <div class="kpi-card">
      <p class="kpi-label">이번 주 마감 종료</p>
      <p class="kpi-value">${kpis.closedThisWeek != null ? kpis.closedThisWeek.toLocaleString() : '-'}<span class="kpi-unit">건</span></p>
    </div>
    <div class="kpi-card kpi-card--urgent">
      <p class="kpi-label">마감 임박 (D-7 이내)</p>
      <p class="kpi-value">${kpis.urgentCount.toLocaleString()}<span class="kpi-unit">건</span></p>
    </div>
  `;

  renderHBarChart($('#chart-category'), computeCategoryDistribution(positions), {
    emptyMessage: '직군 데이터가 없습니다.',
  });
  renderHBarChart($('#chart-region'), computeRegionDistribution(positions), {
    emptyMessage: '지역 데이터가 없습니다.',
  });
  renderHBarChart($('#chart-district'), computeDistrictDistribution(positions, 10), {
    emptyMessage: '지역 데이터가 없습니다.',
    showPercentOfTotal: false,
  });

  renderSparkline($('#chart-weekly-trend'), computeWeeklyOpenTrend(categoryDailySnapshot), {
    color: '#5b8def',
  });

  const momentum = computeCategoryMomentum(categoryDailySnapshot);
  renderCategoryMoverList($('#mover-up'), momentum.up);
  renderCategoryMoverList($('#mover-down'), momentum.down);

  renderInlineSkillTrend($('#home-skill-trend'), computeSkillMovers(skillTagTrend, { topN: 2 }));

  const recommend = recommendPositions(positions, { limit: 6 });
  $('#recommend-list').innerHTML = recommend.length
    ? recommend.map((p) => positionCardHTML(p)).join('')
    : '<div class="empty-state">추천할 공고가 없습니다.</div>';

  const urgent = getUrgentPositions(positions).slice(0, 6);
  $('#urgent-list').innerHTML = urgent.length
    ? urgent.map((p) => positionCardHTML(p)).join('')
    : '<div class="empty-state">최근 7일 이내 마감되는 공고가 없습니다.</div>';
}

/* ==================================================================== */
/* 지원자 입장 — 1. 취준 로드맵                                             */
/* ==================================================================== */

function initRoadmapDefaults() {
  const { positions } = state.model;
  const dist = computeCategoryDistribution(positions);
  const topCategoryName = dist[0]?.label;
  const topPosition = positions.find((p) => p.category.name === topCategoryName);
  state.roadmap.categoryId = topPosition ? topPosition.category.id : null;
}

function renderRoadmapCategorySelect() {
  const { categoryTagsList, positions } = state.model;
  const dist = new Map(computeCategoryDistribution(positions).map((d) => [d.label, d.value]));
  const sel = $('#roadmap-category');
  sel.innerHTML = `
    <option value="all">전체 직군</option>
    ${categoryTagsList
      .map((c) => `<option value="${c.id}">${escapeHTML(c.name)} (${(dist.get(c.name) || 0).toLocaleString()}건)</option>`)
      .join('')}
  `;
  sel.value = state.roadmap.categoryId != null ? String(state.roadmap.categoryId) : 'all';
}

function renderRoadmapSkillChips() {
  const { positions } = state.model;
  const { ranking } = computeCategorySkillFrequency(positions, state.roadmap.categoryId);
  const top = ranking.slice(0, 30);
  const container = $('#roadmap-skill-chips');

  if (top.length === 0) {
    container.innerHTML = '<p class="empty-state empty-state--inline">이 직군은 집계된 스킬 태그가 없습니다.</p>';
    return;
  }

  container.innerHTML = top
    .map(
      (s) => `
      <button type="button" class="chip-toggle ${state.roadmap.mySkills.has(s.name) ? 'chip-toggle--active' : ''}" data-skill="${escapeHTML(s.name)}">
        ${escapeHTML(s.name)} <span>${s.count}</span>
      </button>
    `
    )
    .join('');

  $$('.chip-toggle', container).forEach((btn) => {
    btn.addEventListener('click', () => {
      const skill = btn.dataset.skill;
      if (state.roadmap.mySkills.has(skill)) state.roadmap.mySkills.delete(skill);
      else state.roadmap.mySkills.add(skill);
      btn.classList.toggle('chip-toggle--active');
      renderRoadmapOutput();
    });
  });
}

function renderRoadmapOutput() {
  const { positions, skillTagTrend } = state.model;
  const categoryId = state.roadmap.categoryId;
  const years = state.roadmap.years;

  const annual = computeCategoryAnnualStats(positions, categoryId);
  const movers = computeSkillMovers(skillTagTrend, { topN: 100 });
  const risingSet = new Set(movers.up.filter((m) => m.delta_pct_vs_prev > 0).map((m) => m.skill_name));

  const roadmap = computeRoadmap(positions, {
    categoryId,
    mySkills: state.roadmap.mySkills,
    risingSkillNames: risingSet,
  });

  const gapText =
    annual.avgFrom != null
      ? `${(years - annual.avgFrom).toFixed(1)}년 ${years - annual.avgFrom >= 0 ? '초과' : '부족'}`
      : '데이터 없음';

  $('#roadmap-kpis').innerHTML = `
    <div class="kpi-card">
      <p class="kpi-label">직군 평균 요구 연차</p>
      <p class="kpi-value">${annual.avgFrom != null ? annual.avgFrom.toFixed(1) : '-'}<span class="kpi-unit">년</span></p>
      <p class="kpi-sub">표본 ${annual.sample.toLocaleString()}건 / 전체 ${annual.totalInCategory.toLocaleString()}건 (연차 정보 있는 공고만)</p>
    </div>
    <div class="kpi-card">
      <p class="kpi-label">내 연차 대비 갭</p>
      <p class="kpi-value">${gapText}</p>
    </div>
    <div class="kpi-card">
      <p class="kpi-label">스킬 커버리지 (언급량 가중)</p>
      <p class="kpi-value">${roadmap.weightedCoverage.toFixed(1)}<span class="kpi-unit">%</span></p>
      <p class="kpi-sub">보유 ${roadmap.coveredSkillCount} / 요구 ${roadmap.requiredSkillCount}종</p>
    </div>
    <div class="kpi-card">
      <p class="kpi-label">평균연봉 대비 비교</p>
      <p class="kpi-value kpi-value--muted">준비 중</p>
      <p class="kpi-sub">포지션 단위 연봉 데이터가 API에 없어 미제공</p>
    </div>
  `;

  const missingContainer = $('#roadmap-missing-skills');
  if (roadmap.missingTop3.length === 0) {
    missingContainer.innerHTML = '<div class="empty-state">요구 스킬을 모두 보유하고 있거나, 집계된 스킬 데이터가 없습니다.</div>';
  } else {
    missingContainer.innerHTML = roadmap.missingTop3
      .map(
        (m) => `
        <div class="mover-item">
          <span class="mover-item__name">${escapeHTML(m.name)} ${m.rising ? '<span class="rising-badge">🔥 상승중</span>' : ''}</span>
          <span class="mover-item__detail">해당 직군 공고의 ${m.pct.toFixed(1)}% 요구 (${m.count.toLocaleString()}건)</span>
        </div>
      `
      )
      .join('');
  }

  const topPositionsContainer = $('#roadmap-top-positions');
  if (roadmap.topPositions.length === 0) {
    topPositionsContainer.innerHTML = '<div class="empty-state">보유 스킬을 선택하면 매칭되는 공고가 표시됩니다.</div>';
  } else {
    topPositionsContainer.innerHTML = roadmap.topPositions
      .map((x) => positionCardHTML(x.position, { matchedSkills: x.matched }))
      .join('');
  }
}

function renderRoadmap() {
  renderRoadmapCategorySelect();
  renderRoadmapSkillChips();
  renderRoadmapOutput();
}

function setupRoadmapListeners() {
  $('#roadmap-category').addEventListener('change', (e) => {
    state.roadmap.categoryId = e.target.value === 'all' ? null : Number(e.target.value);
    state.roadmap.mySkills.clear();
    renderRoadmapSkillChips();
    renderRoadmapOutput();
  });

  $('#roadmap-years').addEventListener('input', (e) => {
    state.roadmap.years = Number(e.target.value) || 0;
    renderRoadmapOutput();
  });
}

/* ==================================================================== */
/* 지원자 입장 — 3. 우대조건 특화 필터 (+ 공고 검색)                          */
/* ==================================================================== */

function getSubTagOptions(scopedPositions) {
  const map = new Map();
  scopedPositions.forEach((p) => {
    p.subTags.forEach((t) => {
      map.set(t.id, { id: t.id, name: t.name, count: (map.get(t.id)?.count || 0) + 1 });
    });
  });
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

function applyFilters(positions, filters) {
  return positions.filter((p) => {
    if (filters.categoryId !== 'all' && p.category.id !== filters.categoryId) return false;

    if (filters.subTagIds.size > 0) {
      const posTagIds = new Set(p.subTags.map((t) => t.id));
      let hasAny = false;
      for (const id of filters.subTagIds) {
        if (posTagIds.has(id)) { hasAny = true; break; }
      }
      if (!hasAny) return false;
    }

    if (filters.regions.size > 0 && !filters.regions.has(p.location)) return false;

    if (filters.applyTypes.size > 0) {
      let hasAny = false;
      for (const t of filters.applyTypes) {
        if (p.applyTypes.includes(t)) { hasAny = true; break; }
      }
      if (!hasAny) return false;
    }

    if (filters.urgentOnly) {
      if (p.daysLeft === null || p.daysLeft < 0 || p.daysLeft > URGENT_WITHIN_DAYS) return false;
    }

    if (filters.q) {
      const q = filters.q.toLowerCase();
      const hay = `${p.company.name} ${p.title}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  });
}

function sortPositions(list, sortKey) {
  const arr = [...list];
  switch (sortKey) {
    case 'reward':
      arr.sort((a, b) => (b.reward_total || 0) - (a.reward_total || 0));
      break;
    case 'recent':
      arr.sort((a, b) => new Date(b.synced_at) - new Date(a.synced_at));
      break;
    case 'company':
      arr.sort((a, b) => a.company.name.localeCompare(b.company.name, 'ko'));
      break;
    case 'deadline':
    default:
      arr.sort((a, b) => {
        const aNull = a.daysLeft === null;
        const bNull = b.daysLeft === null;
        if (aNull && bNull) return 0;
        if (aNull) return 1;
        if (bNull) return -1;
        return a.daysLeft - b.daysLeft;
      });
  }
  return arr;
}

function buildFilterSidebar() {
  const { positions } = state.model;
  const categories = computeCategoryDistribution(positions).map((c) => {
    const match = positions.find((p) => p.category.name === c.label);
    return { id: match ? match.category.id : c.label, name: c.label, count: c.value };
  });
  const regions = computeRegionDistribution(positions);
  const applyCounts = getApplyTypeCounts(positions);

  const sidebar = $('#filter-sidebar');
  sidebar.innerHTML = `
    <div class="filter-block filter-block--highlight">
      <p class="filter-title">우대조건 (5.3)</p>
      <div class="checkbox-group">
        ${KNOWN_APPLY_TYPES.map((t) => `
          <label class="checkbox-row">
            <input type="checkbox" class="filter-apply-type" value="${t}" />
            <span>${escapeHTML(applyTypeLabel(t))} <em>(${applyCounts[t]})</em></span>
          </label>
        `).join('')}
      </div>
    </div>

    <div class="filter-block">
      <label class="filter-title" for="filter-search">검색</label>
      <input type="search" id="filter-search" class="filter-search-input" placeholder="회사명 또는 포지션명 검색" />
    </div>

    <div class="filter-block">
      <label class="filter-title" for="filter-category">직군(대분류)</label>
      <select id="filter-category" class="filter-select">
        <option value="all">전체 (${positions.length}건)</option>
        ${categories.map((c) => `<option value="${c.id}">${escapeHTML(c.name)} (${c.count}건)</option>`).join('')}
      </select>
    </div>

    <div class="filter-block">
      <p class="filter-title">직무 태그</p>
      <div id="filter-subtags" class="chip-group"></div>
    </div>

    <div class="filter-block">
      <p class="filter-title">지역</p>
      <div class="checkbox-group">
        ${regions.map((r) => `
          <label class="checkbox-row">
            <input type="checkbox" class="filter-region" value="${escapeHTML(r.label)}" />
            <span>${escapeHTML(r.label)} <em>(${r.value})</em></span>
          </label>
        `).join('')}
      </div>
    </div>

    <div class="filter-block">
      <label class="checkbox-row">
        <input type="checkbox" id="filter-urgent" />
        <span>마감 임박 공고만 보기 (D-7 이내)</span>
      </label>
    </div>

    <button type="button" id="filter-reset" class="filter-reset-btn">필터 초기화</button>
  `;

  renderSubTagChips();
  attachFilterListeners();
}

function renderSubTagChips() {
  const { positions } = state.model;
  const scoped =
    state.filters.categoryId === 'all' ? positions : positions.filter((p) => p.category.id === state.filters.categoryId);

  const options = getSubTagOptions(scoped);
  const container = $('#filter-subtags');

  if (options.length === 0) {
    container.innerHTML = '<p class="empty-state empty-state--inline">태그가 없습니다.</p>';
    return;
  }

  container.innerHTML = options
    .map(
      (opt) => `
    <button type="button" class="chip-toggle ${state.filters.subTagIds.has(opt.id) ? 'chip-toggle--active' : ''}" data-tag-id="${opt.id}">
      ${escapeHTML(opt.name)} <span>${opt.count}</span>
    </button>
  `
    )
    .join('');

  $$('.chip-toggle', container).forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.tagId);
      if (state.filters.subTagIds.has(id)) state.filters.subTagIds.delete(id);
      else state.filters.subTagIds.add(id);
      btn.classList.toggle('chip-toggle--active');
      renderSearchResults();
    });
  });
}

function attachFilterListeners() {
  $('#filter-search').addEventListener('input', debounce((e) => {
    state.filters.q = e.target.value.trim();
    resetAndRenderSearch();
  }, 250));

  $('#filter-category').addEventListener('change', (e) => {
    const val = e.target.value;
    state.filters.categoryId = val === 'all' ? 'all' : Number(val);
    state.filters.subTagIds.clear();
    renderSubTagChips();
    resetAndRenderSearch();
  });

  $$('.filter-region').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) state.filters.regions.add(cb.value);
      else state.filters.regions.delete(cb.value);
      resetAndRenderSearch();
    });
  });

  $$('.filter-apply-type').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) state.filters.applyTypes.add(cb.value);
      else state.filters.applyTypes.delete(cb.value);
      resetAndRenderSearch();
    });
  });

  $('#filter-urgent').addEventListener('change', (e) => {
    state.filters.urgentOnly = e.target.checked;
    resetAndRenderSearch();
  });

  $('#filter-reset').addEventListener('click', () => {
    state.filters.q = '';
    state.filters.categoryId = 'all';
    state.filters.subTagIds.clear();
    state.filters.regions.clear();
    state.filters.applyTypes.clear();
    state.filters.urgentOnly = false;
    buildFilterSidebar();
    resetAndRenderSearch();
  });
}

function resetAndRenderSearch() {
  state.searchVisibleCount = SEARCH_PAGE_SIZE;
  renderSearchResults();
}

function renderSearchResults() {
  const filtered = sortPositions(applyFilters(state.model.positions, state.filters), state.filters.sort);
  $('#search-result-count').textContent = `${filtered.length.toLocaleString()}건`;

  const grid = $('#search-results');
  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-state empty-state--panel">조건에 맞는 공고가 없습니다. 필터를 조정해보세요.</div>';
    return;
  }

  const visible = filtered.slice(0, state.searchVisibleCount);
  const remaining = filtered.length - visible.length;

  grid.innerHTML = visible.map((p) => positionCardHTML(p)).join('');

  if (remaining > 0) {
    const loadMoreWrap = document.createElement('div');
    loadMoreWrap.className = 'load-more-wrap';
    loadMoreWrap.innerHTML = `<button type="button" id="load-more-btn" class="load-more-btn">${remaining.toLocaleString()}건 더 보기</button>`;
    grid.appendChild(loadMoreWrap);
    $('#load-more-btn').addEventListener('click', () => {
      state.searchVisibleCount += SEARCH_PAGE_SIZE;
      renderSearchResults();
    });
  }
}

function renderFilterTab() {
  buildFilterSidebar();
  $('#filter-sort').value = state.filters.sort;
  resetAndRenderSearch();
}

function setupFilterStaticListeners() {
  $('#filter-sort').addEventListener('change', (e) => {
    state.filters.sort = e.target.value;
    resetAndRenderSearch();
  });
}

function applyPendingApplyTypeJump() {
  if (!state.pendingApplyTypeJump) return;
  const type = state.pendingApplyTypeJump;
  state.pendingApplyTypeJump = null;
  state.filters.applyTypes = new Set([type]);
  const cb = $(`.filter-apply-type[value="${type}"]`);
  if (cb) cb.checked = true;
  resetAndRenderSearch();
}

/* ==================================================================== */
/* 채용자 입장 — 1. 공고 경쟁력 진단 (5.5)                                  */
/* ==================================================================== */

const DIAG_OPTION_LIMIT = 50;

/** 재조회(realtime refresh) 시에도 사용자가 고른 선택을 유지하고, 더 이상 존재하지 않을 때만 첫 항목으로 되돌린다 */
function renderDiagCompanySelect() {
  const options = computeCompanyOptions(state.model.positions);
  const stillValid = options.some((c) => c.id === state.diagnosis.companyId);
  if (!stillValid) state.diagnosis.companyId = options[0]?.id ?? null;
  const current = options.find((c) => c.id === state.diagnosis.companyId);
  $('#diag-company-search').value = current ? current.name : '';
}

function renderDiagPositionSelect() {
  const positions = getPositionsForCompany(state.model.positions, state.diagnosis.companyId);
  const stillValid = positions.some((p) => p.id === state.diagnosis.positionId);
  if (!stillValid) state.diagnosis.positionId = positions[0]?.id ?? null;
  const current = positions.find((p) => p.id === state.diagnosis.positionId);
  $('#diag-position-search').value = current ? current.title : '';
}

function renderDiagCompanyOptionsList(query) {
  const options = computeCompanyOptions(state.model.positions);
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((c) => c.name.toLowerCase().includes(q)) : options;
  const limited = filtered.slice(0, DIAG_OPTION_LIMIT);
  const container = $('#diag-company-options');

  container.innerHTML = limited.length
    ? limited
        .map(
          (c) => `
      <div class="searchable-select__option" data-company-id="${c.id}">
        ${escapeHTML(c.name)} <span class="mover-item__detail">(공고 ${c.count}건)</span>
      </div>
    `
        )
        .join('') +
      (filtered.length > limited.length
        ? `<div class="searchable-select__empty">외 ${(filtered.length - limited.length).toLocaleString()}건 더 있음 — 검색어를 입력해 좋혀보세요.</div>`
        : '')
    : '<div class="searchable-select__empty">일치하는 회사가 없습니다.</div>';

  container.classList.remove('hidden');
  $$('.searchable-select__option', container).forEach((el) => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      state.diagnosis.companyId = Number(el.dataset.companyId);
      renderDiagCompanySelect();
      container.classList.add('hidden');
      renderDiagPositionSelect();
      renderDiagnosis();
    });
  });
}

function renderDiagPositionOptionsList(query) {
  const container = $('#diag-position-options');
  if (!state.diagnosis.companyId) {
    container.innerHTML = '<div class="searchable-select__empty">먼저 회사를 선택하세요.</div>';
    container.classList.remove('hidden');
    return;
  }

  const positions = getPositionsForCompany(state.model.positions, state.diagnosis.companyId);
  const q = query.trim().toLowerCase();
  const filtered = q ? positions.filter((p) => p.title.toLowerCase().includes(q)) : positions;

  const grouped = new Map();
  filtered.forEach((p) => {
    const key = p.category.name;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(p);
  });
  const groupNames = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b, 'ko'));

  container.innerHTML = filtered.length
    ? groupNames
        .map(
          (g) => `
      <div class="searchable-select__group-label">${escapeHTML(g)}</div>
      ${grouped
        .get(g)
        .map((p) => `<div class="searchable-select__option" data-position-id="${p.id}">${escapeHTML(p.title)}</div>`)
        .join('')}
    `
        )
        .join('')
    : '<div class="searchable-select__empty">일치하는 공고가 없습니다.</div>';

  container.classList.remove('hidden');
  $$('.searchable-select__option', container).forEach((el) => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      state.diagnosis.positionId = Number(el.dataset.positionId);
      renderDiagPositionSelect();
      container.classList.add('hidden');
      renderDiagnosis();
    });
  });
}

function renderDiagnosis() {
  const { positions, companyTagsByCompanyId, tagEffectStats, categoryMarketStats } = state.model;
  const position = positions.find((p) => p.id === state.diagnosis.positionId);

  if (!position) {
    $('#diag-empty').classList.remove('hidden');
    $('#diag-result').classList.add('hidden');
    return;
  }
  $('#diag-empty').classList.add('hidden');
  $('#diag-result').classList.remove('hidden');

  const categoryPositions = positions.filter((p) => p.category.id === position.category.id);

  // 1. 보상금 백분위 (실측)
  const rewardResult = computeRewardPercentileExact(position.reward_total, categoryPositions);
  $('#diag-gauge-desc').textContent = rewardResult
    ? `동일 직군(${position.category.name}) 공고 ${rewardResult.sampleSize.toLocaleString()}건과 실제 비교한 순위입니다.`
    : '비교할 동일 직군 공고 데이터가 부족합니다.';
  renderGaugeBar($('#diag-gauge'), rewardResult ? rewardResult.percentile : null, {
    sublabel: `이 공고 보상금 ${formatWon(position.reward_total)}`,
  });

  // 2. 배지 획득 챌린지 (실측)
  const challenge = computeRewardBadgeChallenge(position, categoryMarketStats);
  const challengeContainer = $('#diag-badge-challenge');
  challengeContainer.innerHTML = challenge
    ? challenge.tiers
        .map(
          (t) => `
      <div class="mover-item">
        <span class="mover-item__name">${t.achieved ? '🏅' : '🔒'} ${escapeHTML(t.label)}</span>
        <span class="mover-item__pct mover-item__pct--${t.achieved ? 'up' : 'neutral'}">${
            t.achieved ? '달성' : formatWon(t.gap) + ' 부족'
          }</span>
        <span class="mover-item__detail">기준 ${formatWon(t.threshold)}</span>
      </div>
    `
        )
        .join('')
    : '<div class="empty-state">비교할 직군 시장 벤치마크 데이터가 없습니다.</div>';

  // 3. 회사 배지 벤치마킹 (실측)
  const badge = computeCompanyBadgeBenchmark(positions, companyTagsByCompanyId, position.company.id, position.category.id, 8);
  $('#diag-badge-desc').textContent = badge.peerCompanyCount
    ? `동일 직군(${position.category.name}) 공고를 낸 회사 ${badge.peerCompanyCount.toLocaleString()}개사 기준. 우리 회사 현재 배지: ${
        badge.ownBadges.length ? badge.ownBadges.map((t) => escapeHTML(t)).join(', ') : '(등록된 배지 없음)'
      }`
    : '비교할 동일 직군 회사 데이터가 부족합니다.';
  const badgeContainer = $('#diag-badge-ranking');
  badgeContainer.innerHTML = badge.ranking.length
    ? badge.ranking
        .map(
          (b) => `
      <div class="mover-item">
        <span class="mover-item__name">${b.owned ? '✅' : '➕'} ${escapeHTML(b.title)}</span>
        <span class="mover-item__pct mover-item__pct--neutral">${b.pct.toFixed(0)}%</span>
        <span class="mover-item__detail">${b.count.toLocaleString()}개사 보유</span>
      </div>
    `
        )
        .join('')
    : '<div class="empty-state">비교할 배지 데이터가 없습니다.</div>';

  // 4. 매력 태그 효과 시뮬레이션 (데모, 합성값)
  const tagRanking = rankTagEffectStats(tagEffectStats, 8);
  renderHBarChart(
    $('#diag-tag-effect-ranking'),
    tagRanking.map((t) => ({ label: t.tag_name, value: Math.round(t.avg_applicants || 0), colorKey: t.tag_name })),
    { valueSuffix: '명(데모)', showPercentOfTotal: false, emptyMessage: '데이터가 없습니다.' }
  );

  // 5. 경쟁 공고 한눈에 보기 (실측)
  const competing = computeCompetingPositions(positions, position, { limit: 6 });
  $('#diag-competing-list').innerHTML = competing.length
    ? competing.map((p) => positionCardHTML(p)).join('')
    : '<div class="empty-state">현재 경쟁 중인 타사 공고가 없습니다.</div>';
}

function renderDiagnosisTab() {
  renderDiagCompanySelect();
  renderDiagPositionSelect();
  renderDiagnosis();
}

function setupDiagnosisStaticListeners() {
  const companyInput = $('#diag-company-search');
  const companyOptions = $('#diag-company-options');
  companyInput.addEventListener('input', () => renderDiagCompanyOptionsList(companyInput.value));
  companyInput.addEventListener('focus', () => renderDiagCompanyOptionsList(companyInput.value));
  companyInput.addEventListener('blur', () => {
    setTimeout(() => {
      companyOptions.classList.add('hidden');
      renderDiagCompanySelect(); // 선택 없이 blur되면 입력값을 현재 선택으로 되돌림
    }, 120);
  });

  const positionInput = $('#diag-position-search');
  const positionOptions = $('#diag-position-options');
  positionInput.addEventListener('input', () => renderDiagPositionOptionsList(positionInput.value));
  positionInput.addEventListener('focus', () => renderDiagPositionOptionsList(positionInput.value));
  positionInput.addEventListener('blur', () => {
    setTimeout(() => {
      positionOptions.classList.add('hidden');
      renderDiagPositionSelect();
    }, 120);
  });
}

/* ==================================================================== */
/* 채용자 입장 — 3. 채용 조건 트렌드 (5.7)                                  */
/* ==================================================================== */

function renderTrendTab() {
  const { skillTagTrend } = state.model;
  const movers = computeSkillMovers(skillTagTrend, { topN: 3 });
  renderSkillMoverList($('#trend-up'), movers.up);
  renderSkillMoverList($('#trend-down'), movers.down);

  const ranking = computeSkillMentionRanking(skillTagTrend, { topN: 15 });
  renderHBarChart(
    $('#trend-ranking'),
    ranking.map((r) => ({ label: r.skill_name, value: r.mention_count, colorKey: r.skill_name })),
    { valueSuffix: '회', showPercentOfTotal: false, emptyMessage: '데이터가 없습니다.' }
  );
}

/* ------------------------------------------------------------------ */
/* 모드 / 탭 전환                                                        */
/* ------------------------------------------------------------------ */

function refreshPanelVisibility() {
  const mode = state.mode;
  const tab = state.activeTab[mode];

  $$('.mode-btn').forEach((b) => b.classList.toggle('mode-btn--active', b.dataset.mode === mode));
  $$('.subtab-nav').forEach((nav) => nav.classList.toggle('hidden', nav.dataset.modeTabs !== mode));

  const nav = document.querySelector(`.subtab-nav[data-mode-tabs="${mode}"]`);
  if (nav) $$('.tab-btn', nav).forEach((b) => b.classList.toggle('tab-btn--active', b.dataset.tab === tab));

  $$('.tab-panel').forEach((panel) => {
    panel.classList.toggle('hidden', !(panel.dataset.mode === mode && panel.dataset.tab === tab));
  });
}

function setMode(mode) {
  state.mode = mode;
  refreshPanelVisibility();
}

function setTab(mode, tab) {
  state.mode = mode;
  state.activeTab[mode] = tab;
  refreshPanelVisibility();
  applyPendingApplyTypeJump();
}

function jumpModeTab(value) {
  const [mode, tab] = value.split(':');
  setMode(mode);
  setTab(mode, tab);
}

function jumpToFilterWithApplyType(type) {
  state.pendingApplyTypeJump = type;
  setMode('applicant');
  setTab('applicant', 'filter');
}

/* ------------------------------------------------------------------ */
/* 로딩 / 에러 상태                                                     */
/* ------------------------------------------------------------------ */

function setLoading(isLoading) {
  $('#global-loading').classList.toggle('hidden', !isLoading);
  $('#app-content').classList.toggle('hidden', isLoading);
}

function setError(err) {
  const box = $('#global-error');
  if (!err) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  $('#global-error-message').textContent = err.message || '데이터를 불러오지 못했습니다.';
}

/* ------------------------------------------------------------------ */
/* 초기화                                                               */
/* ------------------------------------------------------------------ */

async function loadData() {
  const raw = await fetchAllRaw();
  state.model = buildModel(raw);
  state.companyCount = state.model.companiesById.size;
}

function renderAll() {
  renderHome();
  initRoadmapDefaults();
  renderRoadmap();
  renderFilterTab();
  renderDiagnosisTab();
  renderTrendTab();
}

async function init() {
  setLoading(true);
  setError(null);
  try {
    await loadData();
    setLoading(false);
    renderAll();
    $('#last-updated').textContent = `마지막 갱신: ${new Date().toLocaleTimeString('ko-KR')}`;
  } catch (err) {
    console.error(err);
    setLoading(false);
    setError(err);
  }
}

function setupNav() {
  $$('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nav = btn.closest('.subtab-nav');
      const mode = nav ? nav.dataset.modeTabs : state.mode;
      setTab(mode, btn.dataset.tab);
    });
  });
  document.body.addEventListener('click', (e) => {
    const jumpEl = e.target.closest('[data-jump-mode-tab]');
    if (jumpEl) {
      jumpModeTab(jumpEl.dataset.jumpModeTab);
    }
  });
}

function setupRealtime() {
  const debouncedRefresh = debounce(async () => {
    try {
      await loadData();
      renderAll();
      $('#last-updated').textContent = `마지막 갱신: ${new Date().toLocaleTimeString('ko-KR')}`;
      $('#realtime-dot').classList.add('realtime-dot--pulse');
      setTimeout(() => $('#realtime-dot').classList.remove('realtime-dot--pulse'), 1200);
      showToast('데이터가 갱신되었습니다.');
    } catch (err) {
      console.error('realtime refresh failed', err);
    }
  }, 1500);

  subscribeRealtime(() => debouncedRefresh());
}

function setupRetry() {
  $('#global-error-retry').addEventListener('click', () => init());
}

function setupStaticListenersOnce() {
  // 아래 셀렉트/인푸 요소들은 index.html에 고정 마크업으로 존재하며(옵션만 동적으로 채워짐)
  // 데이터 재로딩(realtime refresh) 시 renderAll()이 반복 호출되어도 이 리스너들은 다시 붙이지 않는다
  // (그렇지 않으면 재조회 때마다 change 리스너가 중복 등록된다).
  setupRoadmapListeners();
  setupFilterStaticListeners();
  setupDiagnosisStaticListeners();
}

document.addEventListener('DOMContentLoaded', () => {
  setupNav();
  setupRetry();
  setupStaticListenersOnce();
  init().then(setupRealtime);
});
