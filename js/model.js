// 원본 테이블(raw rows) → 화면에서 바로 쓰기 좋은 형태로 조인/비정규화하는 계층.
// 서버에 RPC/뷰가 없으므로 이 단계에서 클라이언트 메모리에 조인 맵을 만든다.
import { extractDistrict, daysUntil } from './api.js';

export function buildModel(raw) {
  const {
    tags,
    companies,
    positions,
    positionTags,
    positionSkillTags,
    positionApplyTypes,
    companyTags,
    categoryDailySnapshot,
    skillTagTrend,
    categoryMarketStats,
    tagEffectStats,
  } = raw;

  const tagsById = new Map(tags.map((t) => [t.id, t]));
  const companiesById = new Map(companies.map((c) => [c.id, c]));

  const tagIdsByPosition = new Map();
  positionTags.forEach((pt) => {
    if (!tagIdsByPosition.has(pt.position_id)) tagIdsByPosition.set(pt.position_id, []);
    tagIdsByPosition.get(pt.position_id).push(pt.tag_id);
  });

  const skillsByPosition = new Map();
  positionSkillTags.forEach((s) => {
    if (!skillsByPosition.has(s.position_id)) skillsByPosition.set(s.position_id, []);
    skillsByPosition.get(s.position_id).push(s.skill_name);
  });

  const applyTypesByPosition = new Map();
  positionApplyTypes.forEach((a) => {
    if (!applyTypesByPosition.has(a.position_id)) applyTypesByPosition.set(a.position_id, []);
    applyTypesByPosition.get(a.position_id).push(a.apply_type);
  });

  const enrichedPositions = positions.map((p) => {
    const tagIds = tagIdsByPosition.get(p.id) || [];
    const tagObjs = tagIds.map((id) => tagsById.get(id)).filter(Boolean);
    const categoryTag = tagObjs.find((t) => t.tag_type === 'category') || null;
    const subTags = tagObjs.filter((t) => t.tag_type === 'subcategory');
    const skills = skillsByPosition.get(p.id) || [];
    const applyTypes = applyTypesByPosition.get(p.id) || [];
    const company = companiesById.get(p.company_id) || { id: p.company_id, name: '회사 미상', logo_url: null };

    return {
      ...p,
      category: categoryTag ? { id: categoryTag.id, name: categoryTag.name } : { id: null, name: '미분류' },
      subTags,
      skills,
      applyTypes,
      company,
      district: extractDistrict(p.full_location, p.location),
      daysLeft: daysUntil(p.due_time),
    };
  });

  const categoryTagsList = tags
    .filter((t) => t.tag_type === 'category')
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  const companyTagsByCompanyId = new Map();
  companyTags.forEach((ct) => {
    if (!companyTagsByCompanyId.has(ct.company_id)) companyTagsByCompanyId.set(ct.company_id, []);
    companyTagsByCompanyId.get(ct.company_id).push(ct.title);
  });

  return {
    tagsById,
    companiesById,
    positions: enrichedPositions,
    categoryTagsList,
    companyTagsByCompanyId,
    categoryDailySnapshot,
    skillTagTrend,
    categoryMarketStats,
    tagEffectStats,
  };
}
