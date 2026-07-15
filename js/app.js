import { supabase } from './config.js';
import { fetchAllRaw, subscribeRealtime } from './api.js';
import { buildModel } from './model.js';
import {
  getCurrentApplicantProfileId,
  fetchBookmarkedPositionIds,
  toggleBookmark,
  subscribeBookmarkChanges,
} from './bookmarks.js';
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
  groupSkillRanking,
  getCertSuggestion,
  computeCategoryAnnualStats,
  computeRoadmap,
  computeCompanyOptions,
  getPositionsForCompany,
  computeRewardPercentileExact,
  computeRewardBadgeChallenge,
  computeCompanyBadgeBenchmark,
  rankTagEffectStats,
  computeCompetingPositions,
  computePositionDiffAgainst,
} from './aggregate.js';
import {
  renderHBarChart,
  renderDonutRanking,
  renderSparkline,
  renderRankLadder,
  renderYearsGapBar,
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
    expandedSubTagGroups: new Set(),
    regions: new Set(),
    applyTypes: new Set(),
    urgentOnly: false,
    sort: 'deadline',
  },
  searchVisibleCount: 24,
  roadmap: { categoryId: null, years: 0, mySkills: new Set(), expandedSkillGroups: new Set() },
  diagnosis: { companyId: null, positionId: null },
  applicantProfileId: null,
  bookmarkedPositionIds: new Set(),
};

const URGENT_WITHIN_DAYS = 7;
const SEARCH_PAGE_SIZE = 24;
const KNOWN_APPLY_TYPES = ['foreigner', 'alternative_military', 'disabled_person'];
const MY_COMPANY_STORAGE_KEY = 'wanted-dashboard:my-company-id';

/** "우리 회사" 지정은 로그인이 없는 1차 버전이라 브라우저 localStorage에 저장한다(기기별 설정) */
function getMyCompanyId() {
  const raw = localStorage.getItem(MY_COMPANY_STORAGE_KEY);
  return raw ? Number(raw) : null;
}

function setMyCompanyId(id) {
  if (id == null) localStorage.removeItem(MY_COMPANY_STORAGE_KEY);
  else localStorage.setItem(MY_COMPANY_STORAGE_KEY, String(id));
}

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

function isPositionBookmarked(positionId) {
  return state.bookmarkedPositionIds.has(positionId);
}

function positionCardHTML(p, opts = {}) {
  const badge = ddayBadge(p.daysLeft);
  const initial = (p.company.name || '?').charAt(0);
  const avatarColor = colorForKey(p.company.name);
  const logoUrl = p.company.logo_url;
  const bookmarked = !!opts.isBookmarked;
  const bookmarkBtnHTML = `
    <button type="button" class="bookmark-btn ${bookmarked ? 'bookmark-btn--active' : ''}"
      data-position-id="${p.id}" aria-pressed="${bookmarked}"
      aria-label="${bookmarked ? '북마크 해제' : '북마크 추가'}" title="${bookmarked ? '북마크 해제' : '북마크 추가'}">
      <span aria-hidden="true">${bookmarked ? '★' : '☆'}</span>
    </button>
  `;

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

  const ownRibbonHTML = opts.own ? `<div class="own-ribbon">📌 진단 대상 공고 (우리 회사)</div>` : '';
  const diffHTML =
    opts.diffChips && opts.diffChips.length
      ? `<div class="diff-row">${opts.diffChips
          .map((d) => `<span class="tag-chip tag-chip--diff">${escapeHTML(d)}</span>`)
          .join('')}</div>`
      : '';

  return `
    <article class="position-card ${opts.own ? 'position-card--own' : ''}">
      ${ownRibbonHTML}
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
      ${diffHTML}
      <div class="position-card__meta">
        <span title="지역(구/시 단위는 주소 텍스트 기반 근사치)">📍 ${escapeHTML(p.district)} · ${escapeHTML(p.location || '-')}</span>
        <span>💰 ${formatWon(p.reward_total)}</span>
        <span class="meta-dday-row">
          <span>📅 ${p.due_time ? formatDate(p.due_time) : '상시채용'}</span>
          ${bookmarkBtnHTML}
        </span>
      </div>
      <a class="card-cta" href="${p.url}" target="_blank" rel="noopener noreferrer">원티드에서 공고 보기 ↗</a>
    </article>
  `;
}

/** aggregate.js의 computePositionDiffAgainst가 반환한 원자 데이터를 화면 표시용 문구로 변환 */
function formatDiffChip(diff) {
  switch (diff.type) {
    case 'reward':
      return `보상금 ${diff.value > 0 ? '+' : '-'}${formatWon(Math.abs(diff.value))}`;
    case 'applyTypes':
      return `${diff.value.map(applyTypeLabel).join('·')} 추가 우대`;
    case 'deadline':
      return diff.value > 0 ? `마감 ${diff.value}일 여유` : `마감 ${Math.abs(diff.value)}일 촉박`;
    default:
      return '';
  }
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

function renderSkillMoverList(container, items, { stagger = false } = {}) {
  // 탭 재방문 등으로 다시 렌더링될 때 이전 순차 재생 타이머가 계속 누적되지 않도록 먼저 멈추다.
  if (container._moverStop) {
    container._moverStop();
    container._moverStop = null;
  }

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

  // 처음엔 정적으로 보이다가, 위에서부터 한 줄씩 1초 간격으로 딱 한 번씩만 튀는 효과를 재생한다.
  if (stagger) {
    const rows = $$('.mover-item', container);
    let stopped = false;
    let timerId = null;

    function popRow(idx) {
      if (stopped || idx >= rows.length) return;
      const row = rows[idx];
      row.classList.remove('mover-item--pop');
      void row.getBoundingClientRect();
      row.classList.add('mover-item--pop');
      timerId = setTimeout(() => popRow(idx + 1), 1000);
    }

    timerId = setTimeout(() => popRow(0), 400);
    container._moverStop = () => {
      stopped = true;
      if (timerId) clearTimeout(timerId);
    };
  }
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
    ? recommend.map((p) => positionCardHTML(p, { isBookmarked: isPositionBookmarked(p.id) })).join('')
    : '<div class="empty-state">추천할 공고가 없습니다.</div>';

  const urgent = getUrgentPositions(positions).slice(0, 6);
  $('#urgent-list').innerHTML = urgent.length
    ? urgent.map((p) => positionCardHTML(p, { isBookmarked: isPositionBookmarked(p.id) })).join('')
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

  const groups = groupSkillRanking(top);

  const chipHTML = (s) => `
    <button type="button" class="chip-toggle ${state.roadmap.mySkills.has(s.name) ? 'chip-toggle--active' : ''}" data-skill="${escapeHTML(s.name)}">
      ${escapeHTML(s.name)} <span>${s.count}</span>
    </button>
  `;

  container.innerHTML = groups
    .map((g) => {
      const expanded = state.roadmap.expandedSkillGroups.has(g.key);
      const selectedCount = g.items.filter((s) => state.roadmap.mySkills.has(s.name)).length;
      return `
      <div class="skill-group-block">
        <button type="button" class="skill-group-header ${expanded ? 'skill-group-header--open' : ''}" data-group="${g.key}">
          <span class="skill-group-header__arrow">▸</span>
          <span class="skill-group-header__label">${escapeHTML(g.label)}</span>
          <span class="skill-group-header__count">${g.items.length}개${selectedCount ? ` · 선택 ${selectedCount}` : ''}</span>
        </button>
        <div class="chip-group skill-group-body ${expanded ? '' : 'skill-group-body--collapsed'}">${g.items.map(chipHTML).join('')}</div>
      </div>
    `;
    })
    .join('');

  $$('.skill-group-header', container).forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.group;
      if (state.roadmap.expandedSkillGroups.has(key)) state.roadmap.expandedSkillGroups.delete(key);
      else state.roadmap.expandedSkillGroups.add(key);
      renderRoadmapSkillChips();
    });
  });

  $$('.chip-toggle', container).forEach((btn) => {
    btn.addEventListener('click', () => {
      const skill = btn.dataset.skill;
      if (state.roadmap.mySkills.has(skill)) state.roadmap.mySkills.delete(skill);
      else state.roadmap.mySkills.add(skill);
      renderRoadmapSkillChips();
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

  $('#roadmap-kpis').innerHTML = `
    <div class="kpi-card kpi-card--wide">
      <p class="kpi-label">직군 평균 요구 연차 대비</p>
      <div id="roadmap-years-gap"></div>
    </div>
  `;

  renderYearsGapBar($('#roadmap-years-gap'), {
    avgYears: annual.avgFrom,
    myYears: years,
    onChange: (newYears) => {
      state.roadmap.years = newYears;
    },
  });

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

  $('#roadmap-skill-coverage').innerHTML = `
    <p class="kpi-label">스킬 커버리지 (언급량 가중)</p>
    <p class="kpi-value">${roadmap.weightedCoverage.toFixed(1)}<span class="kpi-unit">%</span></p>
    <p class="kpi-sub">보유 ${roadmap.coveredSkillCount} / 요구 ${roadmap.requiredSkillCount}종</p>
  `;

  const certContainer = $('#roadmap-cert-roadmap');
  if (roadmap.missingTop3.length === 0) {
    certContainer.innerHTML = '<div class="empty-state empty-state--inline">추천할 미보유 스킬이 없습니다.</div>';
  } else {
    certContainer.innerHTML = roadmap.missingTop3
      .map((m) => {
        const suggestion = getCertSuggestion(m.name);
        if (!suggestion) {
          return `
            <div class="cert-roadmap-item">
              <p class="cert-roadmap-item__skill">${escapeHTML(m.name)}</p>
              <p class="cert-roadmap-item__empty">관련 자격증 정보가 아직 없습니다.</p>
            </div>
          `;
        }
        return `
          <div class="cert-roadmap-item">
            <p class="cert-roadmap-item__skill">${escapeHTML(m.name)}</p>
            <div class="cert-roadmap-item__chips">
              ${suggestion.certs.map((c) => `<span class="tag-chip">${escapeHTML(c)}</span>`).join('')}
            </div>
            <p class="cert-roadmap-item__note">${escapeHTML(suggestion.note)}</p>
          </div>
        `;
      })
      .join('');
  }

  const topPositionsContainer = $('#roadmap-top-positions');
  if (roadmap.topPositions.length === 0) {
    topPositionsContainer.innerHTML = '<div class="empty-state">보유 스킬을 선택하면 매칭되는 공고가 표시됩니다.</div>';
  } else {
    topPositionsContainer.innerHTML = roadmap.topPositions
      .map((x) => positionCardHTML(x.position, { matchedSkills: x.matched, isBookmarked: isPositionBookmarked(x.position.id) }))
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
}

/* ==================================================================== */
/* 지원자 입장 — 3. 우대조건 특화 필터 (+ 공고 검색)                          */
/* ==================================================================== */

/**
 * 직무 태그(subcategory)를 소속 직군(category, 산업 분야)별로 묶는다.
 * 한 subcategory 태그는 tags.parent_tag_id로 항상 하나의 category에 속하므로,
 * 그 태그가 붙은 공고의 category를 그대로 그룹 키로 쓰면 된다.
 */
function getGroupedSubTagOptions(scopedPositions) {
  const groups = new Map(); // categoryId -> { categoryId, categoryName, items: Map<subTagId, {id,name,count}> }

  scopedPositions.forEach((p) => {
    const categoryId = p.category.id ?? 'uncategorized';
    const categoryName = p.category.name || '미분류';
    if (!groups.has(categoryId)) {
      groups.set(categoryId, { categoryId, categoryName, items: new Map() });
    }
    const group = groups.get(categoryId);
    p.subTags.forEach((t) => {
      const prev = group.items.get(t.id);
      group.items.set(t.id, { id: t.id, name: t.name, count: (prev?.count || 0) + 1 });
    });
  });

  return Array.from(groups.values())
    .map((g) => {
      const items = Array.from(g.items.values()).sort((a, b) => b.count - a.count);
      const totalCount = items.reduce((sum, i) => sum + i.count, 0);
      return { categoryId: g.categoryId, categoryName: g.categoryName, items, totalCount };
    })
    .filter((g) => g.items.length > 0)
    .sort((a, b) => b.totalCount - a.totalCount);
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

  const groups = getGroupedSubTagOptions(scoped);
  const container = $('#filter-subtags');

  if (groups.length === 0) {
    container.innerHTML = '<p class="empty-state empty-state--inline">태그가 없습니다.</p>';
    return;
  }

  // 직군(대분류)을 이미 하나로 좋혀놓은 상태라 그룹이 1개뿠이면, 굳이 또 접어두지 않고 바로 펼쳐서 보여준다.
  const singleGroup = groups.length === 1;

  container.innerHTML = groups
    .map((g) => {
      const groupKey = String(g.categoryId);
      const expanded = singleGroup || state.filters.expandedSubTagGroups.has(groupKey);
      const selectedCount = g.items.filter((i) => state.filters.subTagIds.has(i.id)).length;
      const chipsHTML = g.items
        .map(
          (opt) => `
        <button type="button" class="chip-toggle ${state.filters.subTagIds.has(opt.id) ? 'chip-toggle--active' : ''}" data-tag-id="${opt.id}">
          ${escapeHTML(opt.name)} <span>${opt.count}</span>
        </button>
      `
        )
        .join('');

      if (singleGroup) {
        return `<div class="chip-group">${chipsHTML}</div>`;
      }

      return `
        <div class="skill-group-block">
          <button type="button" class="skill-group-header ${expanded ? 'skill-group-header--open' : ''}" data-subtag-group="${groupKey}">
            <span class="skill-group-header__arrow">▸</span>
            <span class="skill-group-header__label">${escapeHTML(g.categoryName)}</span>
            <span class="skill-group-header__count">${g.items.length}개${selectedCount ? ` · 선택 ${selectedCount}` : ''}</span>
          </button>
          <div class="chip-group skill-group-body ${expanded ? '' : 'skill-group-body--collapsed'}">${chipsHTML}</div>
        </div>
      `;
    })
    .join('');

  $$('.skill-group-header', container).forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.subtagGroup;
      if (state.filters.expandedSubTagGroups.has(key)) state.filters.expandedSubTagGroups.delete(key);
      else state.filters.expandedSubTagGroups.add(key);
      renderSubTagChips();
    });
  });

  $$('.chip-toggle', container).forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.tagId);
      if (state.filters.subTagIds.has(id)) state.filters.subTagIds.delete(id);
      else state.filters.subTagIds.add(id);
      renderSubTagChips();
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

  grid.innerHTML = visible.map((p) => positionCardHTML(p, { isBookmarked: isPositionBookmarked(p.id) })).join('');

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

/** 검색창 옆 "우리 회사로 설정" 토글의 라벨/활성 상태를 현재 선택된 회사 기준으로 갱신 */
function renderMyCompanyToggle() {
  const btn = $('#diag-mycompany-toggle');
  const myCompanyId = getMyCompanyId();
  const isMine = myCompanyId != null && myCompanyId === state.diagnosis.companyId;
  btn.textContent = isMine ? '★ 우리 회사' : '☆ 우리 회사로 설정';
  btn.classList.toggle('mycompany-toggle-btn--active', isMine);
}

function renderDiagCompanyOptionsList(query) {
  const options = computeCompanyOptions(state.model.positions);
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((c) => c.name.toLowerCase().includes(q)) : options;
  const limited = filtered.slice(0, DIAG_OPTION_LIMIT);
  const container = $('#diag-company-options');

  const grouped = new Map();
  limited.forEach((c) => {
    const key = c.primaryCategory;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(c);
  });
  const groupNames = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b, 'ko'));

  container.innerHTML = limited.length
    ? groupNames
        .map(
          (g) => `
      <div class="searchable-select__group-label">${escapeHTML(g)}</div>
      ${grouped
        .get(g)
        .map(
          (c) => `
        <div class="searchable-select__option" data-company-id="${c.id}">
          ${escapeHTML(c.name)} <span class="mover-item__detail">(공고 ${c.count}건)</span>
        </div>
      `
        )
        .join('')}
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
      renderMyCompanyToggle();
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
  const { positions, companyTagsByCompanyId, categoryMarketStats } = state.model;
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
  renderRankLadder($('#diag-gauge'), rewardResult ? rewardResult.percentile : null, {
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

  // 4. 경쟁 공고 한눈에 보기 (실측) — 진단 대상(우리) 공고를 맨 위에 고정, 경쟁 공고마다 핵심 차이 표시
  const competing = computeCompetingPositions(positions, position, { limit: 6 });
  const ownCardHTML = positionCardHTML(position, { own: true, isBookmarked: isPositionBookmarked(position.id) });
  const competingCardsHTML = competing.length
    ? competing
        .map((p) =>
          positionCardHTML(p, {
            diffChips: computePositionDiffAgainst(position, p).map(formatDiffChip),
            isBookmarked: isPositionBookmarked(p.id),
          })
        )
        .join('')
    : '<div class="empty-state">현재 경쟁 중인 타사 공고가 없습니다.</div>';
  $('#diag-competing-list').innerHTML = ownCardHTML + competingCardsHTML;
}

function renderDiagnosisTab() {
  renderDiagCompanySelect();
  renderDiagPositionSelect();
  renderMyCompanyToggle();
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

  $('#diag-mycompany-toggle').addEventListener('click', () => {
    const myCompanyId = getMyCompanyId();
    if (myCompanyId != null && myCompanyId === state.diagnosis.companyId) {
      setMyCompanyId(null);
      showToast('우리 회사 설정을 해제했습니다.');
    } else if (state.diagnosis.companyId != null) {
      setMyCompanyId(state.diagnosis.companyId);
      showToast('이 회사를 우리 회사로 설정했습니다.');
    }
    renderMyCompanyToggle();
  });

  $('#diag-mycompany-jump').addEventListener('click', () => {
    const myCompanyId = getMyCompanyId();
    if (myCompanyId == null) {
      showToast('먼저 회사를 선택하고 "우리 회사로 설정"을 눌러주세요.');
      return;
    }
    state.diagnosis.companyId = myCompanyId;
    renderDiagCompanySelect();
    renderMyCompanyToggle();
    renderDiagPositionSelect();
    renderDiagnosis();
  });
}

/* ==================================================================== */
/* 채용자 입장 — 3. 채용 조건 트렌드 (5.7)                                  */
/* ==================================================================== */

function renderTrendTab() {
  const { skillTagTrend, tagEffectStats } = state.model;
  const movers = computeSkillMovers(skillTagTrend, { topN: 3 });
  renderSkillMoverList($('#trend-up'), movers.up, { stagger: true });
  renderSkillMoverList($('#trend-down'), movers.down, { stagger: true });

  const ranking = computeSkillMentionRanking(skillTagTrend, { topN: 10 });
  renderDonutRanking(
    $('#trend-ranking'),
    ranking.map((r) => ({ label: r.skill_name, value: r.mention_count, colorKey: r.skill_name })),
    { valueSuffix: '회', emptyMessage: '데이터가 없습니다.' }
  );

  // 매력 태그 효과 시뮬레이션 (데모, 합성값) — 회사/공고 선택과 무관한 고정 지표라 진단 탭이 아닌 트렌드 탭에 배치
  const tagRanking = rankTagEffectStats(tagEffectStats, 8);
  renderDonutRanking(
    $('#trend-tag-effect-ranking'),
    tagRanking.map((t) => ({ label: t.tag_name, value: Math.round(t.avg_applicants || 0), colorKey: t.tag_name })),
    { valueSuffix: '명(데모)', emptyMessage: '데이터가 없습니다.' }
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

/* 현재 로그인한 지원자의 북마크 Set을 가져온다. 로그인 안 되어 있거나
   지원자 프로필이 없으면(채용자 계정 등) 빈 Set으로 처리한다
   (카드 렌더링 자체를 막을 이유는 없으므로 에러를 던지지 않는다). */
async function loadBookmarkState() {
  try {
    const applicantProfileId = await getCurrentApplicantProfileId();
    state.applicantProfileId = applicantProfileId;
    state.bookmarkedPositionIds = applicantProfileId
      ? await fetchBookmarkedPositionIds(applicantProfileId)
      : new Set();
  } catch (err) {
    console.error('북마크 상태 로드 실패', err);
    state.bookmarkedPositionIds = new Set();
  }
}

/* --------------------------------------------------------------- */
/* 북마크 실시간 동기화 (bookmarked_positions Realtime 구독)              */
/* mypage.html(맞춤 재정렬 탭)에서 북마크를 해제/추가해도 이 화면에 렌더링된   */
/* .bookmark-btn 별표가 실시간으로 맞춰지도록 한다.                        */
/* --------------------------------------------------------------- */

let unsubscribeBookmarkRealtime = null;

/** 화면에 이미 렌더링된 모든 .bookmark-btn을 state.bookmarkedPositionIds 기준으로 동기화한다.
 *  같은 공고 카드가 여러 탭/영역(추천/마감임박/검색결과/로드맵 등)에 중복 렌더링될 수 있어
 *  querySelectorAll로 전부 갱신한다. */
function syncAllBookmarkButtonsDOM() {
  $$('.bookmark-btn').forEach((btn) => {
    const positionId = Number(btn.dataset.positionId);
    if (!positionId) return;
    const bookmarked = isPositionBookmarked(positionId);
    btn.classList.toggle('bookmark-btn--active', bookmarked);
    btn.setAttribute('aria-pressed', String(bookmarked));
    btn.title = bookmarked ? '북마크 해제' : '북마크 추가';
    btn.setAttribute('aria-label', bookmarked ? '북마크 해제' : '북마크 추가');
    const icon = btn.querySelector('span');
    if (icon) icon.textContent = bookmarked ? '★' : '☆';
  });
}

/** bookmarked_positions에 대한 postgres_changes 이벤트 처리 (INSERT/DELETE) */
function handleBookmarkRealtimeChange(payload) {
  const positionId =
    payload.eventType === 'DELETE' ? payload.old?.position_id : payload.new?.position_id;
  if (positionId == null) return;

  if (payload.eventType === 'INSERT') {
    state.bookmarkedPositionIds.add(positionId);
  } else if (payload.eventType === 'DELETE') {
    state.bookmarkedPositionIds.delete(positionId);
  }
  syncAllBookmarkButtonsDOM();
}

/** state.applicantProfileId 기준으로 북마크 실시간 구독을 다시 건다(기존 구독은 먼저 해제). */
function refreshBookmarkRealtimeSubscription() {
  if (unsubscribeBookmarkRealtime) {
    unsubscribeBookmarkRealtime();
    unsubscribeBookmarkRealtime = null;
  }
  if (state.applicantProfileId) {
    unsubscribeBookmarkRealtime = subscribeBookmarkChanges(
      state.applicantProfileId,
      handleBookmarkRealtimeChange
    );
  }
}

/* --------------------------------------------------------------- */
/* 로그인 상태 실시간 동기화 (supabase.auth.onAuthStateChange)            */
/* 헤더 로그인 모달·mypage.html iframe 등 다른 컨텍스트에서 로그인/로그아웃해도  */
/* supabase-js v2의 멀티탭 세션 동기화(localStorage 감지)로 이 이벤트가 온다.  */
/* --------------------------------------------------------------- */

let lastKnownAuthUserId; // undefined = 아직 파악 전, null = 비로그인

async function handleAuthChangeForBookmarks(session) {
  const userId = session?.user?.id || null;
  if (userId === lastKnownAuthUserId) return; // 실제 로그인 사용자 변화가 없으면(토큰 갱신 등) 무시
  lastKnownAuthUserId = userId;

  await loadBookmarkState();
  syncAllBookmarkButtonsDOM();
  refreshBookmarkRealtimeSubscription();
}

function setupAuthListener() {
  supabase.auth.onAuthStateChange((_event, session) => {
    handleAuthChangeForBookmarks(session).catch((err) => {
      console.error('[app] 로그인 상태 변경 처리 실패', err);
    });
  });
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
    await Promise.all([loadData(), loadBookmarkState()]);
    setLoading(false);
    renderAll();
    $('#last-updated').textContent = `마지막 갱신: ${new Date().toLocaleTimeString('ko-KR')}`;

    // onAuthStateChange 리스너가 "실제 변화"만 처리하도록 초기 로그인 사용자를 기록해둔다
    // (등록 시점에 오는 INITIAL_SESSION 이벤트로 loadBookmarkState()가 중복 실행되는 것을 방지).
    const { data: sessionData } = await supabase.auth.getSession();
    lastKnownAuthUserId = sessionData?.session?.user?.id || null;
    refreshBookmarkRealtimeSubscription();
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
      const tab = btn.dataset.tab;
      setTab(mode, tab);
      // 트렌드 탭은 등장 애니메이션(도넛 자동 한 바퀴, 상승/하락 태그 순차 튀)이 있어서
      // 페이지 로드 때 숨겨진 채로 미리 재생되어 버리지 않도록, 실제로 탭에 들어올 때 다시 그린다.
      if (mode === 'recruiter' && tab === 'trend') {
        renderTrendTab();
      }
    });
  });
  document.body.addEventListener('click', (e) => {
    const jumpEl = e.target.closest('[data-jump-mode-tab]');
    if (jumpEl) {
      jumpModeTab(jumpEl.dataset.jumpModeTab);
      return;
    }
    const bookmarkBtn = e.target.closest('.bookmark-btn');
    if (bookmarkBtn) {
      handleBookmarkButtonClick(bookmarkBtn);
    }
  });
}

/* 공고 카드의 북마크 버튼 클릭 처리 (이벤트 위임으로 등록되어 카드가 몇 개든 리스너는 하나) */
async function handleBookmarkButtonClick(btn) {
  const positionId = Number(btn.dataset.positionId);
  if (!positionId) return;

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    console.error(sessionError);
    showToast('로그인 상태를 확인하지 못했습니다.');
    return;
  }
  if (!sessionData.session) {
    showToast('로그인이 필요합니다.');
    $('#login-toggle-btn')?.click();
    return;
  }

  const applicantProfileId = await getCurrentApplicantProfileId();
  if (!applicantProfileId) {
    showToast('지원자 계정만 북마크할 수 있습니다.');
    return;
  }

  const currentlyBookmarked = btn.classList.contains('bookmark-btn--active');
  btn.disabled = true;
  try {
    const nowBookmarked = await toggleBookmark(applicantProfileId, positionId, currentlyBookmarked);
    state.applicantProfileId = applicantProfileId;
    if (nowBookmarked) state.bookmarkedPositionIds.add(positionId);
    else state.bookmarkedPositionIds.delete(positionId);

    btn.classList.toggle('bookmark-btn--active', nowBookmarked);
    btn.setAttribute('aria-pressed', String(nowBookmarked));
    btn.title = nowBookmarked ? '북마크 해제' : '북마크 추가';
    btn.setAttribute('aria-label', nowBookmarked ? '북마크 해제' : '북마크 추가');
    const icon = btn.querySelector('span');
    if (icon) icon.textContent = nowBookmarked ? '★' : '☆';
  } catch (err) {
    console.error(err);
    showToast(err.message || '북마크 처리 중 오류가 발생했습니다.');
  } finally {
    btn.disabled = false;
  }
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
  setupAuthListener();
  init().then(setupRealtime);
});
