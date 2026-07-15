// 데이터 접근 레이어 — 모든 DB 접근은 반드시 Supabase JS 클라이언트를 통해서만 수행한다.
// (REST 직접 fetch, SQL 직접 실행 금지 — supabase.from(...) / supabase.channel(...)만 사용)
import { supabase } from './config.js';

const PAGE_SIZE = 1000; // PostgREST 기본 max-rows 제한(1000) — 전량 조회를 위해 range()로 페이지네이션한다.

/**
 * 공통 페이지네이션 조회 헬퍼.
 * positions(10,116건)/position_tags(30,897건)/position_skill_tags(14,629건) 등은
 * 단일 요청으로 전체를 받아올 수 없어(기본 1000행 제한) range()를 반복 호출해 전량을 모은다.
 */
async function fetchAllRows(table, selectStr, { orderCols = ['id'] } = {}) {
  let all = [];
  let from = 0;
  for (;;) {
    let q = supabase.from(table).select(selectStr);
    orderCols.forEach((col) => {
      q = q.order(col, { ascending: true });
    });
    q = q.range(from, from + PAGE_SIZE - 1);
    const { data, error } = await q;
    if (error) throw new Error(`[${table}] ${error.message}`);
    all = all.concat(data || []);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

/* ------------------------------------------------------------------ */
/* 원본 동기화 테이블 (companies/positions/tags/position_tags/...)         */
/* ------------------------------------------------------------------ */

export const fetchTags = () => fetchAllRows('tags', 'id, tag_type, name, parent_tag_id');

export const fetchCompanies = () => fetchAllRows('companies', 'id, name, logo_url');

export const fetchPositionsCore = () =>
  fetchAllRows(
    'positions',
    `id, company_id, title, status, employment_type, due_time, country, location, full_location,
     annual_from, annual_to, reward_total, reward_recommender, reward_recommendee, url, synced_at`
  );

export const fetchPositionTags = () =>
  fetchAllRows('position_tags', 'position_id, tag_id', { orderCols: ['position_id', 'tag_id'] });

export const fetchPositionSkillTags = () =>
  fetchAllRows('position_skill_tags', 'position_id, skill_name', { orderCols: ['position_id'] });

export const fetchPositionApplyTypes = () =>
  fetchAllRows('position_additional_apply_types', 'position_id, apply_type', { orderCols: ['position_id'] });

/** 특정 회사의 company_tags(재택근무 등 배지) — 5.5 진단 화면에서 선택한 회사에 한해 소량 조회 */
export async function fetchCompanyTagsByCompanyId(companyId) {
  const { data, error } = await supabase
    .from('company_tags')
    .select('company_id, tag_type_id, title')
    .eq('company_id', companyId);
  if (error) throw new Error(`[company_tags] ${error.message}`);
  return data || [];
}

/* ------------------------------------------------------------------ */
/* 자체 집계 데모 테이블 (category_daily_snapshot / skill_tag_trend / ...) */
/* ------------------------------------------------------------------ */

export const fetchCategoryDailySnapshot = () =>
  fetchAllRows(
    'category_daily_snapshot',
    'id, snapshot_date, category_tag_id, category_name, region, open_count, new_count, closed_count, is_demo',
    { orderCols: ['snapshot_date'] }
  );

export const fetchSkillTagTrend = () =>
  fetchAllRows('skill_tag_trend', 'id, skill_name, period_type, period_start, mention_count, delta_pct_vs_prev, is_demo', {
    orderCols: ['period_start'],
  });

export const fetchCategoryMarketStats = () =>
  fetchAllRows(
    'category_market_stats',
    'id, category_tag_id, category_name, snapshot_date, reward_avg, reward_p50, reward_p90, is_demo'
  );

export const fetchTagEffectStats = () =>
  fetchAllRows('tag_effect_stats', 'tag_id, tag_name, snapshot_date, avg_applicants, avg_pass_rate, is_demo', {
    orderCols: ['tag_id'],
  });

/* ------------------------------------------------------------------ */
/* 실시간 동기화 — Realtime(postgres_changes) 구독                        */
/* ------------------------------------------------------------------ */

const REALTIME_TABLES = [
  'positions',
  'companies',
  'tags',
  'position_tags',
  'position_skill_tags',
  'position_additional_apply_types',
  'category_daily_snapshot',
  'skill_tag_trend',
  'category_market_stats',
  'tag_effect_stats',
];

export function subscribeRealtime(onChange) {
  const channel = supabase.channel('wanted-dashboard-sync');

  REALTIME_TABLES.forEach((table) => {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      onChange(table, payload);
    });
  });

  channel.subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/* ------------------------------------------------------------------ */
/* 공용 유틸                                                            */
/* ------------------------------------------------------------------ */

/**
 * 주소 문자열에서 "구/시/군" 단위를 근사 추출한다.
 * 원티드 API가 행정동 단위 좌표/구역 정보를 별도로 제공하지 않아
 * full_location 텍스트를 파싱하는 근사치임을 UI에도 명시한다.
 */
export function extractDistrict(fullLocation, fallback) {
  if (!fullLocation) return fallback || '기타';
  const tokens = fullLocation.replace(/^주소\s*/, '').split(/\s+/);
  const guTok = tokens.find((t) => /^[가-힣]{1,6}구$/.test(t));
  if (guTok) return guTok;
  const siTok = tokens.find((t) => /^[가-힣]{1,6}시$/.test(t));
  if (siTok) return siTok;
  const gunTok = tokens.find((t) => /^[가-힣]{1,6}군$/.test(t));
  if (gunTok) return gunTok;
  return fallback || '기타';
}

/** 마감일(YYYY-MM-DD)까지 남은 일수. null이면 상시채용으로 간주 */
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dateStr}T00:00:00`);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

/**
 * 대시보드가 실제로 사용하는 원본 7종 + 자체 집계 4종, 총 11개 테이블을 전량 조회한다.
 * (테이블별 페이지네이션은 fetchAllRows가 내부에서 처리)
 */
export async function fetchAllRaw() {
  const [
    tags,
    companies,
    positions,
    positionTags,
    positionSkillTags,
    positionApplyTypes,
    categoryDailySnapshot,
    skillTagTrend,
    categoryMarketStats,
    tagEffectStats,
  ] = await Promise.all([
    fetchTags(),
    fetchCompanies(),
    fetchPositionsCore(),
    fetchPositionTags(),
    fetchPositionSkillTags(),
    fetchPositionApplyTypes(),
    fetchCategoryDailySnapshot(),
    fetchSkillTagTrend(),
    fetchCategoryMarketStats(),
    fetchTagEffectStats(),
  ]);

  return {
    tags,
    companies,
    positions,
    positionTags,
    positionSkillTags,
    positionApplyTypes,
    categoryDailySnapshot,
    skillTagTrend,
    categoryMarketStats,
    tagEffectStats,
  };
}
