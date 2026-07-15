"""
원티드(Wanted) OpenAPI v2 '/jobs' 포지션 리스트를 조회해서 CSV로 저장하는 배치 스크립트.

- 인증키(.env의 Wanted_ClientId_API_KEY / Wanted_ClientSecret_API_KEY)는
  프로세스 메모리 안에서만 사용하고, 로그/에러 메시지/CSV 어디에도 출력하지 않는다.
- API 스펙 출처: json.v2 (GET /v2/jobs, JobListResponseSerializer)

사용법:
    python fetch_wanted_jobs.py
    python fetch_wanted_jobs.py --category-tag 518 --locations 서울 --limit 50 --max-pages 5
    python fetch_wanted_jobs.py --output wanted_jobs.csv
"""

import argparse
import csv
import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

BASE_URL = "https://openapi.wanted.jobs/v2/jobs"
REQUEST_TIMEOUT = 10
RETRY_COUNT = 3
RETRY_BACKOFF_SEC = 1.5

CSV_FIELDS = [
    "id",
    "status",
    "name",
    "company_id",
    "company_name",
    "employment_type",
    "additional_apply_type",
    "due_time",
    "country",
    "location",
    "full_location",
    "reward_total",
    "reward_recommender",
    "reward_recommendee",
    "category_parent_id",
    "category_parent",
    "category_children_ids",
    "category_children",
    "url",
]


def load_credentials():
    load_dotenv()
    client_id = os.environ.get("Wanted_ClientId_API_KEY")
    client_secret = os.environ.get("Wanted_ClientSecret_API_KEY")
    if not client_id or not client_secret:
        print("오류: .env에서 Wanted API 키를 찾을 수 없습니다.", file=sys.stderr)
        sys.exit(1)
    return client_id, client_secret


def build_headers(client_id, client_secret):
    return {
        "wanted-client-id": client_id,
        "wanted-client-secret": client_secret,
        "Accept": "application/json",
    }


def fetch_page(headers, params):
    last_error = None
    for attempt in range(1, RETRY_COUNT + 1):
        try:
            resp = requests.get(BASE_URL, headers=headers, params=params, timeout=REQUEST_TIMEOUT)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 401:
                print("오류: 인증 실패(401). API 키 값 자체는 노출하지 않습니다.", file=sys.stderr)
                sys.exit(1)
            last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
        except requests.RequestException as exc:
            last_error = str(exc)
        time.sleep(RETRY_BACKOFF_SEC * attempt)
    raise RuntimeError(f"요청 실패 (offset={params.get('offset')}): {last_error}")


def flatten_job(job):
    company = job.get("company") or {}
    reward = job.get("reward") or {}
    address = job.get("address") or {}
    category_tags = job.get("category_tags") or {}
    parent_tag = category_tags.get("parent_tag") or {}
    child_tags = category_tags.get("child_tags") or []
    child_titles = ";".join(t.get("title", "") for t in child_tags)
    child_ids = ";".join(str(t.get("id", "")) for t in child_tags)
    additional_apply_type = ";".join(job.get("additional_apply_type") or [])

    return {
        "id": job.get("id"),
        "status": job.get("status"),
        "name": job.get("name"),
        "company_id": company.get("id"),
        "company_name": company.get("name"),
        "employment_type": job.get("employment_type"),
        "additional_apply_type": additional_apply_type,
        "due_time": job.get("due_time"),
        "country": address.get("country"),
        "location": address.get("location"),
        "full_location": address.get("full_location"),
        "reward_total": reward.get("total"),
        "reward_recommender": reward.get("recommender"),
        "reward_recommendee": reward.get("recommendee"),
        "category_parent_id": parent_tag.get("id"),
        "category_parent": parent_tag.get("title", ""),
        "category_children_ids": child_ids,
        "category_children": child_titles,
        "url": job.get("url"),
    }


def collect_jobs(headers, base_params, limit, max_pages):
    jobs = []
    offset = base_params.get("offset", 0)
    page = 0
    while True:
        params = dict(base_params)
        params["offset"] = offset
        params["limit"] = limit
        data = fetch_page(headers, params)
        page_jobs = data.get("data") or []
        if not page_jobs:
            break
        jobs.extend(page_jobs)
        page += 1
        print(f"  offset={offset} -> {len(page_jobs)}건 수신 (누적 {len(jobs)}건)")
        if max_pages and page >= max_pages:
            break
        if len(page_jobs) < limit:
            break
        offset += limit
    return jobs


def write_csv(jobs, output_path):
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for job in jobs:
            writer.writerow(flatten_job(job))
    print(f"CSV 저장 완료: {output_path} ({len(jobs)}건)")


def parse_args():
    parser = argparse.ArgumentParser(description="원티드 OpenAPI v2 포지션 리스트 조회 후 CSV 저장")
    parser.add_argument("--category-tag", type=int, default=None, help="직군 태그ID")
    parser.add_argument("--subcategory-tags", type=int, nargs="*", default=None, help="직무 태그ID (최대 5개)")
    parser.add_argument("--skill-tags", type=int, nargs="*", default=None, help="스킬 태그ID (최대 5개)")
    parser.add_argument("--attraction-tags", type=int, nargs="*", default=None, help="매력 태그ID (최대 5개)")
    parser.add_argument("--years", type=int, nargs="*", default=None, help="경력 범위 (최대 2개)")
    parser.add_argument("--locations", type=str, nargs="*", default=None, help="지역/국가")
    parser.add_argument(
        "--sort",
        choices=["job.latest_order", "job.popularity_order", "company.response_rate_order"],
        default="job.latest_order",
    )
    parser.add_argument("--limit", type=int, default=20, help="페이지당 개수 (기본 20)")
    parser.add_argument("--max-pages", type=int, default=10, help="최대 페이지 수 (0=무제한, 기본 10)")
    parser.add_argument("--offset", type=int, default=0, help="시작 offset")
    parser.add_argument("--output", type=str, default="wanted_jobs.csv", help="출력 CSV 경로")
    return parser.parse_args()


def main():
    args = parse_args()
    client_id, client_secret = load_credentials()
    headers = build_headers(client_id, client_secret)

    base_params = {"offset": args.offset, "sort": args.sort}
    if args.category_tag is not None:
        base_params["category_tag"] = args.category_tag
    if args.subcategory_tags:
        base_params["subcategory_tags"] = args.subcategory_tags
    if args.skill_tags:
        base_params["skill_tags"] = args.skill_tags
    if args.attraction_tags:
        base_params["attraction_tags"] = args.attraction_tags
    if args.years:
        base_params["years"] = args.years
    if args.locations:
        base_params["locations"] = args.locations

    print("원티드 포지션 리스트 조회를 시작합니다...")
    jobs = collect_jobs(headers, base_params, args.limit, args.max_pages)
    write_csv(jobs, args.output)


if __name__ == "__main__":
    main()
