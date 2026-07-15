"""
attractions.csv / categories.csv / companies.csv / jobs.csv / job_details.csv를
Supabase(team7-wanted 프로젝트)의 정규화 스키마에 적재한다.

- jobs.csv: v2 /jobs 목록(공고 기본 정보 + employment_type/additional_apply_type)
- job_details.csv: v1 /jobs/{id} 상세조회(스킬 태그, 좌표, 상세 텍스트, 회사 상세, 회사 태그)
- 두 파일을 공고 id 기준으로 합쳐서 positions 테이블 하나로 적재한다.
- skill_tags는 원티드 응답의 id가 null로 내려와 안정적인 tag_id가 없으므로,
  tags/position_tags(Wanted 실제 tag_id 기반)에 넣지 않고 position_skill_tags(이름 기반)에 따로 적재한다.
- Supabase 접속 정보(.env의 SUPABASE_URL/SUPABASE_ANON_KEY)는 로그에 출력하지 않는다.

사용법:
    python load_full_dataset_to_supabase.py
"""

import csv
import json
import os
import sys

from dotenv import load_dotenv
from supabase import create_client

BATCH_SIZE = 500


def load_client():
    load_dotenv()
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        print("오류: .env에서 SUPABASE_URL/SUPABASE_ANON_KEY를 찾을 수 없습니다.", file=sys.stderr)
        sys.exit(1)
    return create_client(url, key)


def read_rows(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def to_int(v):
    v = (v or "").strip()
    return int(v) if v else None


def to_num(v):
    v = (v or "").strip()
    try:
        return float(v) if v else None
    except ValueError:
        return None


def parse_reward(text):
    if not text:
        return None
    digits = "".join(ch for ch in text if ch.isdigit())
    return int(digits) if digits else None


def parse_json(text, default):
    if not text:
        return default
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return default


def chunked(items, size=BATCH_SIZE):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def upsert(client, table, records, on_conflict=None):
    if not records:
        print(f"  {table}: 0건 (건너뜀)")
        return
    for batch in chunked(records):
        query = client.table(table).upsert(batch, on_conflict=on_conflict) if on_conflict else client.table(table).upsert(batch)
        query.execute()
    print(f"  {table}: {len(records)}건 upsert 완료")


def build_tags():
    tags = {}

    for row in read_rows("attractions.csv"):
        tid = to_int(row.get("id"))
        if tid is None:
            continue
        tags[tid] = {"id": tid, "tag_type": "attraction", "name": row.get("title") or "", "parent_tag_id": None}

    for row in read_rows("categories.csv"):
        pid = to_int(row.get("parent_id"))
        cid = to_int(row.get("child_id"))
        if pid is not None:
            tags[pid] = {"id": pid, "tag_type": "category", "name": row.get("parent_title") or "", "parent_tag_id": None}
        if cid is not None:
            tags[cid] = {"id": cid, "tag_type": "subcategory", "name": row.get("child_title") or "", "parent_tag_id": pid}

    return list(tags.values())


def build_companies_base():
    companies = {}
    for row in read_rows("companies.csv"):
        cid = to_int(row.get("company.id"))
        if cid is None:
            continue
        companies[cid] = {
            "id": cid,
            "name": row.get("company.name") or "",
            "registration_number": row.get("company.registration_number") or None,
            "logo_url": row.get("company.logo_url.origin") or None,
            "description": row.get("company.description") or None,
            "link": row.get("company.link") or None,
        }
    return companies


def build_jobs_index():
    employment_type = {}
    additional_apply_type = {}
    for row in read_rows("jobs.csv"):
        jid = to_int(row.get("id"))
        if jid is None:
            continue
        employment_type[jid] = row.get("employment_type") or None
        additional_apply_type[jid] = parse_json(row.get("additional_apply_type"), [])
    return employment_type, additional_apply_type


def build_from_details(companies, employment_type, additional_apply_type):
    positions = {}
    position_tags = {}
    skill_tags = {}
    apply_types = {}
    company_tags = {}

    for row in read_rows("job_details.csv"):
        jid = to_int(row.get("id"))
        if jid is None:
            continue

        cid = to_int(row.get("company.id"))
        if cid is not None and cid not in companies:
            companies[cid] = {
                "id": cid,
                "name": row.get("company.name") or "",
                "registration_number": row.get("company.registration_number") or None,
                "logo_url": row.get("company.logo_img.origin") or None,
                "description": row.get("company.description") or None,
                "link": row.get("company.link") or None,
            }

        if cid is not None:
            for tag in parse_json(row.get("company.company_tags"), []):
                tt_id = tag.get("id")
                if tt_id is None:
                    continue
                company_tags[(cid, tt_id)] = {"company_id": cid, "tag_type_id": tt_id, "title": tag.get("title") or ""}

        parent_id = to_int(row.get("category_tags.parent_tag.id"))
        if parent_id is not None:
            position_tags[(jid, parent_id)] = {"position_id": jid, "tag_id": parent_id}
        for child in parse_json(row.get("category_tags.child_tags"), []):
            child_id = child.get("id")
            if child_id is not None:
                position_tags[(jid, child_id)] = {"position_id": jid, "tag_id": child_id}

        for skill in parse_json(row.get("skill_tags"), []):
            name = (skill.get("title") or "").strip()
            if name:
                skill_tags[(jid, name)] = {"position_id": jid, "skill_name": name}

        for apply_type in additional_apply_type.get(jid, []):
            apply_types[(jid, apply_type)] = {"position_id": jid, "apply_type": apply_type}

        positions[jid] = {
            "id": jid,
            "company_id": cid,
            "title": row.get("detail.name") or "",
            "status": row.get("status") or None,
            "employment_type": employment_type.get(jid),
            "due_time": row.get("due_time") or None,
            "country": row.get("address.country") or None,
            "location": row.get("address.location") or None,
            "full_location": row.get("address.full_location") or None,
            "geo_lat": to_num(row.get("address.geo_location.location.lat")),
            "geo_lng": to_num(row.get("address.geo_location.location.lng")),
            "annual_from": to_int(row.get("annual_from")),
            "annual_to": to_int(row.get("annual_to")),
            "intro": row.get("detail.intro") or None,
            "main_tasks": row.get("detail.main_tasks") or None,
            "requirements": row.get("detail.requirements") or None,
            "preferred_points": row.get("detail.preferred_points") or None,
            "benefits": row.get("detail.benefits") or None,
            "hire_rounds": row.get("detail.hire_rounds") or None,
            "reward_total": parse_reward(row.get("reward.total")),
            "reward_recommender": parse_reward(row.get("reward.recommender")),
            "reward_recommendee": parse_reward(row.get("reward.recommendee")),
            "url": row.get("url") or None,
        }

    return positions, position_tags, skill_tags, apply_types, company_tags


def main():
    client = load_client()

    print("태그 마스터(attractions/categories) 적재 중...")
    tags = build_tags()
    upsert(client, "tags", tags)

    print("회사 기본 정보(companies.csv) 파싱 중...")
    companies = build_companies_base()

    print("공고 목록(jobs.csv) 파싱 중...")
    employment_type, additional_apply_type = build_jobs_index()

    print("공고 상세(job_details.csv) 파싱 및 회사 정보 보강 중...")
    positions, position_tags, skill_tags, apply_types, company_tags = build_from_details(
        companies, employment_type, additional_apply_type
    )

    print("Supabase 적재를 시작합니다...")
    upsert(client, "companies", list(companies.values()))
    upsert(client, "company_tags", list(company_tags.values()), on_conflict="company_id,tag_type_id")
    upsert(client, "positions", list(positions.values()))
    upsert(client, "position_tags", list(position_tags.values()), on_conflict="position_id,tag_id")
    upsert(client, "position_skill_tags", list(skill_tags.values()), on_conflict="position_id,skill_name")
    upsert(client, "position_additional_apply_types", list(apply_types.values()), on_conflict="position_id,apply_type")

    print("적재 완료.")


if __name__ == "__main__":
    main()
