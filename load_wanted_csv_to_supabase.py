"""
wanted_jobs.csv (fetch_wanted_jobs.py 결과물)를 DB.md에 설계된 Supabase 정규화 스키마
(companies / positions / tags / position_tags / position_additional_apply_types)에 적재한다.

- Supabase 접속 정보(.env의 SUPABASE_URL / SUPABASE_ANON_KEY)는 로그/에러 메시지에 출력하지 않는다.
- tags 테이블의 id는 원티드 실제 태그ID를 그대로 사용한다 (category_parent_id / category_children_ids 컬럼).
- 같은 데이터를 다시 실행해도 안전하도록 전부 upsert로 처리한다.

사용법:
    python load_wanted_csv_to_supabase.py
    python load_wanted_csv_to_supabase.py --csv wanted_jobs.csv
"""

import argparse
import csv
import os
import sys
from datetime import date

from dotenv import load_dotenv
from supabase import create_client


def load_client():
    load_dotenv()
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        print("오류: .env에서 SUPABASE_URL/SUPABASE_ANON_KEY를 찾을 수 없습니다.", file=sys.stderr)
        sys.exit(1)
    return create_client(url, key)


def parse_reward(text):
    if not text:
        return None
    digits = "".join(ch for ch in text if ch.isdigit())
    return int(digits) if digits else None


def read_rows(csv_path):
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def build_records(rows):
    companies = {}
    tags = {}
    positions = []
    position_tags = []
    position_apply_types = []

    for row in rows:
        company_id = row.get("company_id")
        if company_id:
            company_id = int(company_id)
            companies[company_id] = {"id": company_id, "name": row.get("company_name") or ""}

        parent_id = row.get("category_parent_id")
        parent_name = row.get("category_parent")
        if parent_id:
            parent_id = int(parent_id)
            tags[parent_id] = {
                "id": parent_id,
                "tag_type": "category",
                "name": parent_name or "",
                "parent_tag_id": None,
            }

        child_ids = [c for c in (row.get("category_children_ids") or "").split(";") if c]
        child_names = [c for c in (row.get("category_children") or "").split(";") if c]
        for child_id, child_name in zip(child_ids, child_names):
            child_id = int(child_id)
            tags[child_id] = {
                "id": child_id,
                "tag_type": "subcategory",
                "name": child_name,
                "parent_tag_id": parent_id or None,
            }
            position_tags.append({"position_id": int(row["id"]), "tag_id": child_id})

        if parent_id:
            position_tags.append({"position_id": int(row["id"]), "tag_id": parent_id})

        positions.append(
            {
                "id": int(row["id"]),
                "company_id": company_id,
                "title": row.get("name") or "",
                "status": row.get("status") or None,
                "employment_type": row.get("employment_type") or None,
                "due_time": row.get("due_time") or None,
                "country": row.get("country") or None,
                "location": row.get("location") or None,
                "full_location": row.get("full_location") or None,
                "reward_total": parse_reward(row.get("reward_total")),
                "reward_recommender": parse_reward(row.get("reward_recommender")),
                "reward_recommendee": parse_reward(row.get("reward_recommendee")),
                "url": row.get("url") or None,
                "synced_at": date.today().isoformat(),
            }
        )

        for apply_type in (row.get("additional_apply_type") or "").split(";"):
            if apply_type:
                position_apply_types.append({"position_id": int(row["id"]), "apply_type": apply_type})

    return {
        "companies": list(companies.values()),
        "tags": list(tags.values()),
        "positions": positions,
        "position_tags": position_tags,
        "position_apply_types": position_apply_types,
    }


def chunked(items, size=200):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def upsert(client, table, records, on_conflict=None):
    if not records:
        return
    for batch in chunked(records):
        query = client.table(table).upsert(batch, on_conflict=on_conflict) if on_conflict else client.table(table).upsert(batch)
        query.execute()
    print(f"  {table}: {len(records)}건 upsert 완료")


def main():
    parser = argparse.ArgumentParser(description="wanted_jobs.csv를 Supabase에 적재")
    parser.add_argument("--csv", default="wanted_jobs.csv", help="입력 CSV 경로")
    args = parser.parse_args()

    client = load_client()
    rows = read_rows(args.csv)
    print(f"{len(rows)}개 행을 읽었습니다. Supabase에 적재를 시작합니다...")

    records = build_records(rows)
    upsert(client, "companies", records["companies"])
    upsert(client, "tags", records["tags"])
    upsert(client, "positions", records["positions"])
    upsert(client, "position_tags", records["position_tags"], on_conflict="position_id,tag_id")
    upsert(client, "position_additional_apply_types", records["position_apply_types"], on_conflict="position_id,apply_type")

    print("적재 완료.")


if __name__ == "__main__":
    main()
