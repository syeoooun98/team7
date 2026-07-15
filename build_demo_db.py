"""
'자체 배치 집계' 4종 테이블(category_daily_snapshot, skill_tag_trend,
category_market_stats, tag_effect_stats)을 시연용으로 채운 SQLite 파일(demo.db)을 만든다.

- Supabase(운영 DB, team7-wanted)는 전혀 건드리지 않는다. 전부 로컬 demo.db에만 만든다.
- "오늘자" 값은 Supabase에 실제로 적재된 positions/position_tags/position_skill_tags/tags를
  집계한 진짜 숫자를 앵커로 쓴다. 과거 시점(주간/일별 추이)은 원티드 API가 과거 데이터를
  제공하지 않아 합성(랜덤 워크)으로 만든다.
- 모든 테이블에 is_demo 컬럼을 둬서, "오늘자 실측 앵커"(is_demo=0)와
  "합성/완전 창작"(is_demo=1)을 행 단위로 구분한다.
- 재현 가능하도록 고정 시드(random.seed)를 사용한다 — 다시 실행해도 같은 값이 나온다.

사용법:
    python build_demo_db.py
"""

import json
import os
import random
import sqlite3
import sys
from datetime import date, timedelta

from dotenv import load_dotenv
from supabase import create_client

DB_PATH = "demo.db"
SEED = 42

# 스킬 트렌드 시연용 스토리라인 (실제 존재하는 스킬 이름만 사용)
TRENDING_UP = ["Python", "AWS", "Docker", "Kubernetes", "PyTorch", "TypeScript", "Next.js", "Tensorflow"]
TRENDING_DOWN = ["jQuery", "PHP"]
EXTRA_SKILLS = TRENDING_DOWN  # top-40에는 없지만 스토리를 위해 추가 조회할 스킬

# 매력 태그 시연용 "인기 태그" 가중치 (지원자수/합격률을 더 높게 보이도록)
ATTRACTIVE_KEYWORDS = ["재택근무", "유연근무", "스톡옵션", "복지포인트", "무제한연차", "주4일근무"]


def load_client():
    load_dotenv()
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        print("오류: .env에서 SUPABASE_URL/SUPABASE_ANON_KEY를 찾을 수 없습니다.", file=sys.stderr)
        sys.exit(1)
    return create_client(url, key)


PAGE_SIZE = 1000


def fetch_all(query_builder):
    """Supabase REST 기본 페이지 제한(1000건)을 넘는 테이블 전체를 range()로 순회해 가져온다."""
    rows = []
    start = 0
    while True:
        page = query_builder().range(start, start + PAGE_SIZE - 1).execute().data
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    return rows


def fetch_category_open_counts(client):
    """오늘자 카테고리×지역 오픈 공고 수 (실측)"""
    positions = fetch_all(lambda: client.table("positions").select("id,status,location").eq("status", "active"))
    position_tags = fetch_all(lambda: client.table("position_tags").select("position_id,tag_id"))
    category_tags = {t["id"]: t["name"] for t in client.table("tags").select("id,name,tag_type").eq("tag_type", "category").execute().data}

    location_by_pos = {p["id"]: p["location"] for p in positions}
    active_ids = set(location_by_pos.keys())

    counts = {}
    for pt in position_tags:
        pos_id, tag_id = pt["position_id"], pt["tag_id"]
        if pos_id not in active_ids or tag_id not in category_tags:
            continue
        region = location_by_pos.get(pos_id) or "미상"
        key = (tag_id, category_tags[tag_id], region)
        counts[key] = counts.get(key, 0) + 1
    return counts


def fetch_skill_mentions(client, skill_names=None):
    if skill_names:
        rows = fetch_all(lambda: client.table("position_skill_tags").select("skill_name").in_("skill_name", skill_names))
    else:
        rows = fetch_all(lambda: client.table("position_skill_tags").select("skill_name"))
    counts = {}
    for r in rows:
        counts[r["skill_name"]] = counts.get(r["skill_name"], 0) + 1
    if skill_names:
        return {name: counts.get(name, 0) for name in skill_names}
    return counts


def fetch_category_reward_stats(client):
    positions = fetch_all(lambda: client.table("positions").select("id,status,reward_total").eq("status", "active"))
    position_tags = fetch_all(lambda: client.table("position_tags").select("position_id,tag_id"))
    category_tags = {t["id"]: t["name"] for t in client.table("tags").select("id,name,tag_type").eq("tag_type", "category").execute().data}

    reward_by_pos = {p["id"]: p["reward_total"] for p in positions if p["reward_total"] is not None}
    rewards_by_cat = {}
    for pt in position_tags:
        pos_id, tag_id = pt["position_id"], pt["tag_id"]
        if pos_id not in reward_by_pos or tag_id not in category_tags:
            continue
        rewards_by_cat.setdefault((tag_id, category_tags[tag_id]), []).append(reward_by_pos[pos_id])
    return rewards_by_cat


def fetch_attraction_tags(client):
    return client.table("tags").select("id,name").eq("tag_type", "attraction").execute().data


def percentile(sorted_vals, pct):
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * pct
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    if f == c:
        return sorted_vals[f]
    return sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f)


def create_schema(conn):
    conn.executescript(
        """
        drop table if exists category_daily_snapshot;
        drop table if exists skill_tag_trend;
        drop table if exists category_market_stats;
        drop table if exists tag_effect_stats;

        create table category_daily_snapshot (
            id integer primary key autoincrement,
            snapshot_date text not null,
            category_tag_id integer not null,
            category_name text,
            region text,
            open_count integer not null,
            new_count integer not null default 0,
            closed_count integer not null default 0,
            is_demo integer not null default 1,
            unique(snapshot_date, category_tag_id, region)
        );

        create table skill_tag_trend (
            id integer primary key autoincrement,
            skill_name text not null,
            period_type text not null check(period_type in ('week','quarter')),
            period_start text not null,
            mention_count integer not null,
            delta_pct_vs_prev real,
            is_demo integer not null default 1,
            unique(skill_name, period_type, period_start)
        );

        create table category_market_stats (
            id integer primary key autoincrement,
            category_tag_id integer not null,
            category_name text,
            snapshot_date text not null,
            reward_avg integer,
            reward_p50 integer,
            reward_p90 integer,
            common_attraction_tag_ids text,
            is_demo integer not null default 0,
            unique(category_tag_id, snapshot_date)
        );

        create table tag_effect_stats (
            tag_id integer not null,
            tag_name text,
            snapshot_date text not null,
            avg_applicants real,
            avg_pass_rate real,
            is_demo integer not null default 1,
            primary key (tag_id, snapshot_date)
        );
        """
    )


def build_category_daily_snapshot(conn, today, open_counts):
    rows = []
    for (tag_id, name, region), today_count in open_counts.items():
        rows.append(
            {
                "snapshot_date": today.isoformat(),
                "category_tag_id": tag_id,
                "category_name": name,
                "region": region,
                "open_count": today_count,
                "new_count": max(0, round(today_count * random.uniform(0.02, 0.06))),
                "closed_count": max(0, round(today_count * random.uniform(0.01, 0.04))),
                "is_demo": 0,
            }
        )
        # 과거 13일: 오늘 값에서 역산한 합성 랜덤워크 (하루 -4%~+4% 노이즈 누적)
        value = float(today_count)
        for days_ago in range(1, 14):
            value = value / (1 + random.uniform(-0.04, 0.04))
            snap_date = today - timedelta(days=days_ago)
            past_count = max(0, round(value))
            rows.append(
                {
                    "snapshot_date": snap_date.isoformat(),
                    "category_tag_id": tag_id,
                    "category_name": name,
                    "region": region,
                    "open_count": past_count,
                    "new_count": max(0, round(past_count * random.uniform(0.02, 0.06))),
                    "closed_count": max(0, round(past_count * random.uniform(0.01, 0.04))),
                    "is_demo": 1,
                }
            )
    conn.executemany(
        """insert into category_daily_snapshot
           (snapshot_date, category_tag_id, category_name, region, open_count, new_count, closed_count, is_demo)
           values (:snapshot_date, :category_tag_id, :category_name, :region, :open_count, :new_count, :closed_count, :is_demo)""",
        rows,
    )
    return len(rows)


def week_start(d):
    return d - timedelta(days=d.weekday())


def build_skill_tag_trend(conn, today, mentions):
    rows = []
    this_week = week_start(today)
    for name, current_count in mentions.items():
        if name in TRENDING_UP:
            growth = random.uniform(0.10, 0.22)  # 주간 ~10~22% 성장 스토리
        elif name in TRENDING_DOWN:
            growth = random.uniform(-0.16, -0.08)  # 주간 ~8~16% 하락 스토리
        else:
            growth = random.uniform(-0.03, 0.03)

        # weeks_ago=0(이번주, 실측) ~ 7(7주 전, 합성)까지의 값을 먼저 계산
        value = float(current_count)
        counts_by_weeks_ago = {}
        for weeks_ago in range(0, 8):
            counts_by_weeks_ago[weeks_ago] = max(0, round(value))
            value = value / (1 + growth)

        # 과거 -> 최신 순으로 delta_pct_vs_prev(직전 주 대비 증감률) 계산
        prev_count = None
        for weeks_ago in range(7, -1, -1):
            count = counts_by_weeks_ago[weeks_ago]
            delta_pct = round((count / prev_count - 1) * 100, 2) if prev_count else None
            period_start = this_week - timedelta(weeks=weeks_ago)
            rows.append(
                {
                    "skill_name": name,
                    "period_type": "week",
                    "period_start": period_start.isoformat(),
                    "mention_count": count,
                    "delta_pct_vs_prev": delta_pct,
                    "is_demo": 0 if weeks_ago == 0 else 1,
                }
            )
            prev_count = count

    conn.executemany(
        """insert into skill_tag_trend
           (skill_name, period_type, period_start, mention_count, delta_pct_vs_prev, is_demo)
           values (:skill_name, :period_type, :period_start, :mention_count, :delta_pct_vs_prev, :is_demo)""",
        rows,
    )
    return len(rows)


def build_category_market_stats(conn, today, rewards_by_cat):
    rows = []
    for (tag_id, name), rewards in rewards_by_cat.items():
        sorted_rewards = sorted(rewards)
        avg = round(sum(rewards) / len(rewards))
        p50 = round(percentile(sorted_rewards, 0.5))
        p90 = round(percentile(sorted_rewards, 0.9))
        rows.append(
            {
                "category_tag_id": tag_id,
                "category_name": name,
                "snapshot_date": today.isoformat(),
                "reward_avg": avg,
                "reward_p50": p50,
                "reward_p90": p90,
                # 공고 단위 매력 태그 연결이 API에 없어(DB.md 3.2절 참고) 실제 근거로 채울 수 없다.
                # 있는 척 지어내지 않고 명시적으로 비워둔다.
                "common_attraction_tag_ids": None,
                "is_demo": 0,
            }
        )
    conn.executemany(
        """insert into category_market_stats
           (category_tag_id, category_name, snapshot_date, reward_avg, reward_p50, reward_p90, common_attraction_tag_ids, is_demo)
           values (:category_tag_id, :category_name, :snapshot_date, :reward_avg, :reward_p50, :reward_p90, :common_attraction_tag_ids, :is_demo)""",
        rows,
    )
    return len(rows)


def build_tag_effect_stats(conn, today, attraction_tags):
    rows = []
    for tag in attraction_tags:
        is_attractive = any(kw in tag["name"] for kw in ATTRACTIVE_KEYWORDS)
        base_applicants = random.uniform(18, 32) if is_attractive else random.uniform(4, 16)
        base_pass_rate = random.uniform(28, 45) if is_attractive else random.uniform(10, 30)
        rows.append(
            {
                "tag_id": tag["id"],
                "tag_name": tag["name"],
                "snapshot_date": today.isoformat(),
                "avg_applicants": round(base_applicants, 1),
                "avg_pass_rate": round(base_pass_rate, 1),
                "is_demo": 1,
            }
        )
    conn.executemany(
        """insert into tag_effect_stats
           (tag_id, tag_name, snapshot_date, avg_applicants, avg_pass_rate, is_demo)
           values (:tag_id, :tag_name, :snapshot_date, :avg_applicants, :avg_pass_rate, :is_demo)""",
        rows,
    )
    return len(rows)


def main():
    random.seed(SEED)
    today = date.today()
    client = load_client()

    print("Supabase에서 오늘자 실측 데이터 조회 중...")
    open_counts = fetch_category_open_counts(client)
    mentions = fetch_skill_mentions(client)
    for extra in EXTRA_SKILLS:
        if extra not in mentions:
            mentions.update(fetch_skill_mentions(client, [extra]))
    # 트렌드 스토리에 필요한 스킬만 추려서 사용 (전체 롱테일까지는 시연에 불필요)
    top40 = sorted(mentions.items(), key=lambda kv: kv[1], reverse=True)[:40]
    selected = {name: count for name, count in top40}
    for extra in EXTRA_SKILLS:
        selected[extra] = mentions.get(extra, 0)

    rewards_by_cat = fetch_category_reward_stats(client)
    attraction_tags = fetch_attraction_tags(client)

    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    create_schema(conn)

    n1 = build_category_daily_snapshot(conn, today, open_counts)
    n2 = build_skill_tag_trend(conn, today, selected)
    n3 = build_category_market_stats(conn, today, rewards_by_cat)
    n4 = build_tag_effect_stats(conn, today, attraction_tags)

    conn.commit()
    conn.close()

    print(f"category_daily_snapshot: {n1}건 (오늘자 {len(open_counts)}건은 실측, 나머지는 합성)")
    print(f"skill_tag_trend: {n2}건 (이번주 {len(selected)}건은 실측, 나머지는 합성)")
    print(f"category_market_stats: {n3}건 (전부 실측 — 트렌드 아닌 단일 스냅샷)")
    print(f"tag_effect_stats: {n4}건 (전부 창작 — 지원자 데이터 자체가 없음)")
    print(f"완료: {DB_PATH}")


if __name__ == "__main__":
    main()
