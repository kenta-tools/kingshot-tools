# -*- coding: utf-8 -*-
"""
聖剣リーグ Season2（第14〜16ブロック）の自動更新スクリプト。

2026-11-06より前: 何もしない（まだメンバー確定前のため）。
2026-11-06: 初回実行として、通常どおりAPIから全員を取得・抽出し、総合ランキングHTMLを生成する。
            このとき、抽出された人（governor_id・名前・同盟タグ・鯖番号）を
            .github/data/holy-sword-s2/block{N}.json に「名簿スナップショット」として保存する。
2026-11-07以降: 毎日、同じ名簿スナップショットのメンバーだけを対象に、3ボードの現在のスコアだけを
            再取得・再集計してHTMLを同じファイル名に上書きする（メンバー・同盟の増減や入れ替えはしない）。

このファイルは mystic_ranking.py（kingshot_tools/、ローカル専用）の聖剣リーグ向けHTML生成ロジックを
GitHub Actions（Ubuntuランナー）でも動かせるよう、依存のない形で複製・最小化したもの。
見た目のテンプレート（HEAD/BODY）は同じものを使っている。

環境変数: MIGHTPULSE_API_KEY（GitHubリポジトリのSecretsから渡す）
"""
import os
import re
import sys
import json
import time
import html as H
import urllib.request
import urllib.error
from pathlib import Path
from datetime import date, datetime

API_KEY = os.getenv("MIGHTPULSE_API_KEY")
BASE_URL = "https://api.mightpulse.com/v1"
BOARD_KEYS = {"mystic_trial": "trial", "master_power": "master", "pet_power": "pet"}
MY_KID = 816

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SITE_DIR = REPO_ROOT
ROSTER_DIR = REPO_ROOT / ".github" / "data" / "holy-sword-s2"
SEASON = "Season2"
THRESHOLD = 2900
THRESHOLD_BOARD = "mystic_trial"
FREEZE_DATE = date(2026, 11, 6)
END_DATE = date(2026, 12, 6)  # イベント終了日（仮）。実際の終了日が分かったら合わせて直す。この日以降は自動更新を止める

# 2026-11-01にゲーム内画面から書き起こしたブロック分け（759〜927鯖を3ブロックに分割。非連続）
BLOCKS = {
    "14": [760, 764, 766, 770, 774, 776, 778, 779, 780, 782, 789, 792, 794, 795, 799, 801, 804, 807, 808, 812,
           814, 815, 818, 821, 827, 835, 836, 838, 843, 856, 860, 861, 865, 867, 874, 878, 880, 885, 886, 888,
           892, 895, 898, 899, 901, 904, 905, 908, 913, 914, 919, 920, 921, 922, 923, 925, 927],
    "15": [759, 762, 765, 772, 777, 786, 793, 796, 798, 802, 803, 809, 810, 811, 819, 820, 825, 828, 829, 830,
           831, 832, 837, 839, 842, 846, 849, 851, 855, 857, 858, 862, 863, 864, 868, 869, 871, 873, 876, 877,
           881, 883, 884, 887, 896, 897, 902, 906, 907, 909, 911, 916, 917, 918, 924, 926],
    "16": [761, 763, 767, 768, 769, 771, 773, 775, 781, 783, 784, 785, 787, 788, 790, 791, 797, 800, 805, 806,
           813, 816, 817, 822, 823, 824, 826, 833, 834, 840, 841, 844, 845, 847, 848, 850, 852, 853, 854, 859,
           866, 870, 872, 875, 879, 882, 889, 890, 891, 893, 894, 900, 903, 910, 912, 915],
}


def get(path, params=None):
    url = BASE_URL + path
    if params:
        query = "&".join(f"{k}={v}" for k, v in params.items() if v is not None)
        url += "?" + query
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {API_KEY}",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    })
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=20) as res:
                return json.loads(res.read())
        except urllib.error.HTTPError as e:
            print(f"  HTTPエラー {e.code} on {url}")
            if e.code == 429:
                time.sleep(5)
                continue
            return None
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            print(f"  通信エラー（{attempt + 1}/5回目）on {url}: {e}")
            time.sleep(3)
    return None


def fetch_all(kid_list):
    raw = {}
    truncated = []
    for kid in kid_list:
        raw[kid] = {}
        for board in BOARD_KEYS:
            data = get(f"/kingdoms/{kid}/ranks", {"board": board, "limit": 100})
            rows = data.get("board", {}).get("rows", []) if data and data.get("ok") else []
            if len(rows) == 100:
                truncated.append((kid, board))
            raw[kid][board] = rows
            time.sleep(0.3)
        print(f"kid={kid} done: " + ", ".join(f"{b}={len(raw[kid][b])}" for b in BOARD_KEYS))
    return raw, truncated


def merge_and_rank(raw, threshold, threshold_board="mystic_trial"):
    """全員の中から閾値を超える人だけを抽出し、総合順位をつける（新規メンバー確定時＝初回実行専用）"""
    people = {}
    for kid, boards in raw.items():
        for board_key, short in BOARD_KEYS.items():
            for row in boards.get(board_key, []):
                gid = row["governor_id"]
                if gid not in people:
                    people[gid] = {"name": row["nick_name"], "tag": row.get("alliance_abbr") or "なし", "kid": row["kid"]}
                people[gid][short] = {"score": row["score"]}

    threshold_key = BOARD_KEYS[threshold_board]
    qualifying = {gid: p for gid, p in people.items() if threshold_key in p and p[threshold_key]["score"] > threshold}
    return rank_people(qualifying)


def rank_people(people_by_gid):
    """{gid: {name,tag,kid,trial?,master?,pet?}} から総合順位つきのpeopleリストを作る（抽出済みの固定集合向け）"""

    def ingroup_rank(key):
        scored = [(gid, p[key]["score"]) for gid, p in people_by_gid.items() if key in p]
        scored.sort(key=lambda x: -x[1])
        return {gid: i + 1 for i, (gid, _) in enumerate(scored)}, len(scored)

    ranks = {}
    counts = {}
    for short in BOARD_KEYS.values():
        ranks[short], counts[short] = ingroup_rank(short)

    results = []
    for gid, p in people_by_gid.items():
        r = {"gid": gid, "name": p["name"], "tag": p["tag"], "kid": p["kid"]}
        total = 0
        best = None
        for short in BOARD_KEYS.values():
            rank = ranks[short].get(gid, counts[short] + 1)
            r[short] = p.get(short)
            r[f"{short}_rank"] = ranks[short].get(gid)
            total += rank
            if gid in ranks[short]:
                best = rank if best is None else min(best, rank)
        r["total"] = total
        r["best"] = best if best is not None else total
        results.append(r)

    results.sort(key=lambda x: (x["total"], x["best"]))
    for i, r in enumerate(results, start=1):
        r["rank"] = i
    return results, counts


def group_alliances(people):
    alliances = {}
    for p in people:
        alliances.setdefault(p["tag"], []).append(p)
    alliance_list = []
    for tag, members in alliances.items():
        members_sorted = sorted(members, key=lambda m: m["rank"])
        alliance_list.append((tag, members_sorted, members_sorted[0]["rank"]))
    alliance_list.sort(key=lambda a: a[2])
    for i, (tag, members, _) in enumerate(alliance_list, start=1):
        for m in members:
            m["a_rank"] = i
    return alliance_list


def esc(s):
    return H.escape(str(s))


def abbreviate(n):
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n/1_000:.1f}K"
    return str(n)


def metric_cell(rank, entry, compact=False):
    if entry is None:
        return '<td class="num na">—</td><td class="num na">N/A</td>'
    score = abbreviate(entry["score"]) if compact else f'{entry["score"]:,}'
    return f'<td class="num">{rank}</td><td class="num">{score}</td>'


def metric_stat_block(label, rank, entry, compact=False):
    if entry is None:
        return f'<div class="stat-block na">{label}<br><b>—</b></div>'
    score = abbreviate(entry["score"]) if compact else f'{entry["score"]:,}'
    return f'<div class="stat-block">{label}<br><b>{rank}</b><span class="score">{score}</span></div>'


def metric_m_stats(label, rank, entry, compact=False):
    if entry is None:
        return f'<span class="na">{label}N/A</span>'
    score = abbreviate(entry["score"]) if compact else f'{entry["score"]:,}'
    return f'{label}{rank}<span class="score">・{score}</span>'


def build_fragments(people, alliance_list):
    table_rows = []
    for p in people:
        is_me = p["kid"] == MY_KID
        cls = "trow-top" if p["rank"] <= 3 else ""
        if is_me:
            cls = (cls + " row-me").strip()
        cls_attr = f' class="{cls}"' if cls else ''
        name_html = esc(p["name"]) + (' <span class="me-tag">自分</span>' if is_me else '')
        table_rows.append(
            f'<tr{cls_attr}><td class="num rankcell">{p["rank"]}</td>'
            f'<td class="num">{p["kid"]}</td>'
            f'<td><span class="tag">{esc(p["tag"])}</span></td>'
            f'<td class="num">{p["a_rank"]}</td>'
            f'<td>{name_html}</td>'
            f'{metric_cell(p["trial_rank"], p["trial"])}'
            f'{metric_cell(p["master_rank"], p["master"], compact=True)}'
            f'{metric_cell(p["pet_rank"], p["pet"], compact=True)}'
            f'</tr>'
        )

    mobile_rows = []
    for p in people:
        is_me = p["kid"] == MY_KID
        cls = "top" if p["rank"] <= 3 else ""
        if is_me:
            cls = (cls + " row-me").strip()
        cls_attr = f' {cls}' if cls else ''
        name_html = esc(p["name"]) + (' <span class="me-tag">自分</span>' if is_me else '')
        mobile_rows.append(
            f'<div class="p-row{cls_attr}"><span class="p-rank">{p["rank"]}</span>'
            f'<div class="p-main"><div class="p-topline"><span class="tag">{esc(p["tag"])}</span>'
            f'<span class="p-name">{name_html}</span></div>'
            f'<div class="p-subline"><span>鯖{p["kid"]}</span><span>同盟順位{p["a_rank"]}</span></div></div>'
            f'<div class="p-stats">'
            f'{metric_stat_block("試練", p["trial_rank"], p["trial"])}'
            f'{metric_stat_block("マスター", p["master_rank"], p["master"], compact=True)}'
            f'{metric_stat_block("ペット", p["pet_rank"], p["pet"], compact=True)}'
            f'</div></div>'
        )

    alliance_cards = []
    for i, (tag, members, best) in enumerate(alliance_list, start=1):
        kid = members[0]["kid"]
        is_me_alliance = any(m["kid"] == MY_KID for m in members)
        tag_html = f'<span class="tag">{esc(tag)}</span>' if tag != "なし" else '<span class="tag none">なし</span>'
        card_cls = ' me-alliance' if is_me_alliance else ''
        me_badge = ' <span class="me-tag">自分たちの同盟</span>' if is_me_alliance else ''
        body_rows = []
        for m in members:
            stats = (
                f'{metric_m_stats("試練", m["trial_rank"], m["trial"])}<br>'
                f'{metric_m_stats("マスター", m["master_rank"], m["master"], compact=True)}<br>'
                f'{metric_m_stats("ペット", m["pet_rank"], m["pet"], compact=True)}'
            )
            body_rows.append(
                f'<div class="m-row"><span class="m-rank">{m["rank"]}</span>'
                f'<span class="m-name">{esc(m["name"])}</span>'
                f'<span class="m-stats">{stats}</span></div>'
            )
        alliance_cards.append(
            f'<div class="a-card{card_cls}">'
            f'<div class="a-head"><div class="a-head-left"><span class="a-rank">{i}</span>{tag_html}{me_badge}</div>'
            f'<span class="a-meta">{len(members)}名・鯖{kid}</span></div>'
            f'<div class="a-body">{"".join(body_rows)}</div>'
            f'</div>'
        )

    return "\n".join(table_rows), "\n".join(mobile_rows), "\n".join(alliance_cards)


HEAD = """<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="robots" content="noindex, nofollow">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{scope}鯖 総合ランキング</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Work+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root{{
    --bg:#eef1f2; --surface:#ffffff; --surface-2:#f3f5f7; --surface-3:#e9ecef;
    --ink:#1a2030; --ink-dim:#5b6478; --ink-faint:#8a93a6; --border:#dde1e6;
    --accent:#c1591f; --accent-strong:#a84413; --gold:#93752b; --gold-bg:#f1e6cc; --na:#b7bcc4;
    --shadow: 0 1px 2px rgba(20,24,32,0.06), 0 6px 20px rgba(20,24,32,0.05);
  }}
  @media (prefers-color-scheme: dark){{
    :root:not([data-theme="light"]){{
      --bg:#0f131b; --surface:#171d29; --surface-2:#1e2635; --surface-3:#242d3f;
      --ink:#eef1f7; --ink-dim:#93a0b8; --ink-faint:#5c6884; --border:#2a3348;
      --accent:#ef8a4c; --accent-strong:#ff9d5c; --gold:#d9b464; --gold-bg:#332a17; --na:#4a536b;
      --shadow: 0 1px 2px rgba(0,0,0,0.3), 0 10px 30px rgba(0,0,0,0.35);
    }}
  }}
  :root[data-theme="dark"]{{
    --bg:#0f131b; --surface:#171d29; --surface-2:#1e2635; --surface-3:#242d3f;
    --ink:#eef1f7; --ink-dim:#93a0b8; --ink-faint:#5c6884; --border:#2a3348;
    --accent:#ef8a4c; --accent-strong:#ff9d5c; --gold:#d9b464; --gold-bg:#332a17; --na:#4a536b;
    --shadow: 0 1px 2px rgba(0,0,0,0.3), 0 10px 30px rgba(0,0,0,0.35);
  }}
  *{{box-sizing:border-box;}}
  body{{ margin:0; background:var(--bg); color:var(--ink); font-family:"Work Sans","Yu Gothic UI","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif; -webkit-font-smoothing:antialiased; }}
  .page{{ max-width:900px; margin:0 auto; padding:28px 16px 80px; }}
  .back-top{{ display:inline-block; font-size:13px; color:var(--ink-faint); text-decoration:none; margin-right:14px; margin-bottom:10px; }}
  .back-top:hover{{ text-decoration:underline; }}
  .eyebrow-row{{ display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px; }}
  .pill{{ display:inline-flex; align-items:center; gap:6px; font-family:"Rajdhani","Yu Gothic UI",sans-serif; font-weight:600; font-size:0.75rem; letter-spacing:0.06em; text-transform:uppercase; padding:5px 11px; border-radius:999px; background:var(--surface-2); color:var(--ink-dim); border:1px solid var(--border); }}
  .pill.accent{{ color:var(--accent); border-color:color-mix(in srgb, var(--accent) 40%, var(--border)); }}
  h1{{ font-family:"Rajdhani","Yu Gothic UI","Hiragino Kaku Gothic ProN",sans-serif; font-weight:700; font-size:clamp(1.6rem, 6vw, 2.3rem); letter-spacing:0.01em; line-height:1.15; margin:0 0 10px; text-wrap:balance; }}
  .lede{{ color:var(--ink-dim); font-size:0.92rem; line-height:1.7; margin:0 0 22px; }}
  .lede b{{ color:var(--ink); font-weight:600; }}
  .stats{{ display:grid; grid-template-columns:repeat(2,1fr); gap:1px; background:var(--border); border:1px solid var(--border); border-radius:12px; overflow:hidden; margin-bottom:26px; box-shadow:var(--shadow); }}
  .stat{{ background:var(--surface); padding:12px 14px; }}
  .stat .n{{ font-family:"JetBrains Mono", ui-monospace, monospace; font-size:1.3rem; font-weight:700; font-variant-numeric:tabular-nums; }}
  .stat .l{{ margin-top:2px; font-size:0.7rem; color:var(--ink-faint); }}
  .jump{{ display:flex; gap:8px; margin-bottom:26px; }}
  .jump a{{ font-family:"Rajdhani","Yu Gothic UI",sans-serif; font-weight:600; font-size:0.8rem; color:var(--ink-dim); text-decoration:none; padding:6px 12px; border-radius:8px; background:var(--surface); border:1px solid var(--border); }}
  section{{ margin-bottom:40px; }}
  .sec-head{{ display:flex; align-items:baseline; gap:10px; margin-bottom:4px; }}
  .sec-num{{ font-family:"JetBrains Mono", ui-monospace, monospace; color:var(--accent); font-weight:700; font-size:0.95rem; }}
  h2{{ font-family:"Rajdhani","Yu Gothic UI","Hiragino Kaku Gothic ProN",sans-serif; font-weight:700; font-size:1.2rem; margin:0; }}
  .sec-sub{{ color:var(--ink-faint); font-size:0.78rem; margin:5px 0 16px; line-height:1.6; }}
  .board{{ background:var(--surface); border:1px solid var(--border); border-radius:12px; box-shadow:var(--shadow); overflow:hidden; }}
  .p-row{{ display:flex; align-items:flex-start; gap:10px; padding:10px 12px; border-bottom:1px solid var(--border); flex-wrap:wrap; }}
  .p-row:last-child{{ border-bottom:none; }}
  .p-row:hover{{ background:var(--surface-2); }}
  .p-row.top{{ box-shadow: inset 3px 0 0 var(--accent); background:var(--surface-2); }}
  .p-rank{{ font-family:"JetBrains Mono", ui-monospace, monospace; font-weight:700; font-size:1rem; color:var(--ink-dim); min-width:1.7em; text-align:right; padding-top:2px; flex-shrink:0; }}
  .p-row.top .p-rank{{ color:var(--accent-strong); }}
  .p-main{{ flex:1 1 180px; min-width:0; display:flex; flex-direction:column; gap:3px; }}
  .p-topline{{ display:flex; align-items:center; gap:6px; flex-wrap:wrap; }}
  .p-name{{ font-weight:600; font-size:0.92rem; color:var(--ink); overflow-wrap:anywhere; }}
  .p-subline{{ font-size:0.72rem; color:var(--ink-faint); font-family:"Rajdhani","Yu Gothic UI",sans-serif; display:flex; gap:8px; flex-wrap:wrap; }}
  .tag{{ display:inline-block; font-family:"Rajdhani","Yu Gothic UI",sans-serif; font-weight:600; font-size:0.74rem; background:var(--gold-bg); color:var(--gold); padding:1px 8px; border-radius:6px; }}
  .tag.none{{ background:var(--surface-3); color:var(--ink-faint); }}
  .p-stats{{ flex-basis:100%; display:flex; gap:14px; justify-content:space-between; padding-left:2.1em; margin-top:4px; font-size:0.74rem; color:var(--ink-faint); text-align:center; }}
  .p-stats .stat-block{{ flex:1 1 0; }}
  .p-stats .stat-block b{{ display:block; font-family:"JetBrains Mono", ui-monospace, monospace; font-weight:700; font-size:0.88rem; color:var(--ink-dim); font-variant-numeric:tabular-nums; }}
  .p-stats .na b{{ color:var(--na); }}
  .p-stats .score{{ display:block; font-family:"JetBrains Mono", ui-monospace, monospace; font-size:0.68rem; color:var(--ink-faint); margin-top:1px; }}
  @media (max-width:480px){{ .p-row{{ padding:10px 10px; }} }}
  .mobile-only{{ display:block; }}
  .desktop-only{{ display:none; }}
  @media (min-width:760px){{ .mobile-only{{ display:none; }} .desktop-only{{ display:block; }} }}
  .table-wrap{{ overflow:auto; max-height:75vh; border:1px solid var(--border); border-radius:12px; box-shadow:var(--shadow); background:var(--surface); }}
  table{{ width:100%; border-collapse:collapse; }}
  thead th{{ position:sticky; top:0; z-index:10; background:var(--surface-2); color:var(--ink-dim); font-family:"Rajdhani","Yu Gothic UI",sans-serif; font-weight:600; font-size:0.72rem; letter-spacing:0.03em; text-align:left; text-transform:uppercase; padding:10px 12px; border-bottom:1px solid var(--border); white-space:nowrap; }}
  th.num, td.num{{ text-align:right; font-variant-numeric:tabular-nums; }}
  tbody td{{ padding:8px 12px; font-size:0.84rem; border-bottom:1px solid var(--border); white-space:nowrap; }}
  tbody tr:last-child td{{ border-bottom:none; }}
  tbody tr:hover td{{ background:var(--surface-2); }}
  td.rankcell{{ font-family:"JetBrains Mono", ui-monospace, monospace; font-weight:700; }}
  tr.trow-top td.rankcell{{ color:var(--accent-strong); }}
  tr.trow-top{{ box-shadow: inset 3px 0 0 var(--accent); }}
  tr.row-me td, .p-row.row-me, .m-row.row-me{{ background:color-mix(in srgb, var(--accent) 14%, var(--surface)); }}
  .me-tag{{ display:inline-block; font-family:"Rajdhani","Yu Gothic UI",sans-serif; font-weight:700; font-size:0.68rem; background:var(--accent); color:#fff; padding:1px 6px; border-radius:999px; margin-left:4px; vertical-align:middle; }}
  .note{{ color:var(--ink-faint); font-size:0.76rem; line-height:1.7; margin-top:12px; }}
  .legend{{ font-family:"Rajdhani","Yu Gothic UI",sans-serif; font-size:0.76rem; color:var(--ink-faint); margin:0 0 14px; line-height:1.6; }}
  .alliance-grid{{ display:grid; grid-template-columns:1fr; gap:12px; }}
  @media (min-width:640px){{ .alliance-grid{{ grid-template-columns:1fr 1fr; }} }}
  .a-card{{ background:var(--surface); border:1px solid var(--border); border-radius:12px; box-shadow:var(--shadow); overflow:hidden; }}
  .a-card.me-alliance{{ border:1px solid var(--accent); box-shadow: 0 0 0 1px var(--accent), var(--shadow); }}
  .a-head{{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; background:var(--surface-2); border-bottom:1px solid var(--border); }}
  .a-head-left{{ display:flex; align-items:center; gap:8px; }}
  .a-rank{{ font-family:"JetBrains Mono", ui-monospace, monospace; font-weight:700; font-size:0.76rem; color:var(--accent); background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:2px 6px; min-width:1.6em; text-align:center; }}
  .a-meta{{ font-size:0.7rem; color:var(--ink-faint); font-family:"Rajdhani",sans-serif; }}
  .a-body{{ padding:4px 12px 8px; }}
  .m-row{{ display:flex; align-items:flex-start; justify-content:space-between; gap:8px; padding:7px 0; border-bottom:1px solid var(--border); font-size:0.82rem; flex-wrap:wrap; }}
  .m-row:last-child{{ border-bottom:none; }}
  .m-name{{ color:var(--ink); flex:1 1 60%; min-width:0; overflow-wrap:anywhere; }}
  .m-rank{{ font-family:"JetBrains Mono", ui-monospace, monospace; font-weight:700; color:var(--ink-dim); font-size:0.78rem; flex-shrink:0; margin-right:4px; }}
  .m-stats{{ flex-shrink:0; text-align:right; font-size:0.72rem; color:var(--ink-faint); line-height:1.5; margin-left:auto; }}
  .na{{ color:var(--na); }}
  footer{{ margin-top:48px; padding-top:16px; border-top:1px solid var(--border); color:var(--ink-faint); font-size:0.74rem; line-height:1.8; }}
  a{{ color:var(--accent); }}
</style>
</head>
"""

BODY = """<body>
<div class="page">

  {back_links}
  <div class="eyebrow-row">
    <span class="pill accent">Kingshot</span>
    <span class="pill">鯖 {scope}</span>
    <span class="pill">データ更新: {fetched_at}</span>
  </div>

  <h1>{scope}鯖 総合ランキング（API版）</h1>
  <p class="lede">
    MightPulse API（<a href="https://api.mightpulse.com/">api.mightpulse.com</a>）から{scope}鯖の全{kid_count}王国分「秘境の試練」「マスター全体総力」「ペット」ランキングを直接取得し、<b>秘境の試練が{threshold:,}ステージを超える人</b>だけを抽出。3つの順位を合わせた<b>総合順位</b>で並べています。
    {freeze_note}
  </p>

  <div class="stats">
    <div class="stat"><div class="n">{people_count}</div><div class="l">抽出プレイヤー数（試練{threshold:,}超）</div></div>
    <div class="stat"><div class="n">{alliance_count}</div><div class="l">同盟数</div></div>
  </div>

  <div class="jump">
    <a href="#list">① 一覧</a>
    <a href="#alliances">② 同盟別</a>
  </div>

  <section id="list">
    <div class="sec-head"><span class="sec-num">01</span><h2>一覧（総合ランキング順）</h2></div>
    <p class="sec-sub">試練・マスター・ペットの数字はこの抽出グループ内での順位（APIから取得した実スコアで算出）。総合順位はこの3つを合わせて評価した順位です。</p>

    <div class="desktop-only table-wrap">
    <table>
    <thead>
    <tr>
      <th class="num">総合<br>順位</th>
      <th class="num">鯖(#)</th>
      <th>同盟</th>
      <th class="num">同盟<br>順位</th>
      <th>名前</th>
      <th class="num">試練<br>順位</th>
      <th class="num">試練<br>ステージ数</th>
      <th class="num">マスター<br>順位</th>
      <th class="num">マスター<br>総合力</th>
      <th class="num">ペット<br>順位</th>
      <th class="num">ペット<br>総合力</th>
    </tr>
    </thead>
    <tbody>
{table_rows}
    </tbody>
    </table>
    </div>

    <div class="board mobile-only">
{mobile_rows}
    </div>
    <p class="note">※ 各王国の「上位100位以内」をAPIから取得した上で閾値超の人を抽出しています{truncate_note}。同盟タグが無い人は「なし」として扱っています。</p>
  </section>

  <section id="alliances">
    <div class="sec-head"><span class="sec-num">02</span><h2>同盟でグルーピング</h2></div>
    <p class="legend">同盟のベスト総合順位が高い順に並べ、同盟内はメンバーを総合順位順に表示。</p>

    <div class="alliance-grid">
{alliance_cards}
    </div>
  </section>

  <footer>
    出典：MightPulse API（<a href="https://api.mightpulse.com/">api.mightpulse.com</a>）/v1/kingdoms/{{kid}}/ranks エンドポイント（board=mystic_trial, master_power, pet_power）を{scope}鯖の全王国分取得・集計。データ更新日時: {fetched_at}。
  </footer>

</div>
</body>
</html>
"""


def indent(s, n):
    pad = " " * n
    return "\n".join(pad + line for line in s.splitlines())


def add_card_to_season_index(index_path, season_label, title, desc, href, is_me=False):
    if not os.path.exists(index_path):
        print(f"  ⚠ {index_path} が見つからないため、まとめページへのカード追加はスキップしました。")
        return
    text = Path(index_path).read_text(encoding="utf-8")
    today = date.today().isoformat()
    badge = '\n    <span class="me-badge">自分の鯖</span>' if is_me else ''
    card = (
        f'  <a class="tool-card" href="{href}">{badge}\n'
        f'    <div class="icon">📊</div>\n'
        f'    <div class="title">{title}</div>\n'
        f'    <div class="desc">{desc}</div>\n'
        f'    <div class="date">{today}</div>\n'
        f'  </a>\n'
    )
    season_heading = f'<h2 class="season">{season_label}</h2>'
    if season_heading in text:
        m = re.search(re.escape(season_heading) + r'\s*<div class="grid">\n', text)
        if not m:
            print(f"  ⚠ {season_label} の見出しは見つかりましたが、直後の <div class=\"grid\"> が見つかりませんでした。")
            return
        text = text[:m.end()] + card + text[m.end():]
    else:
        new_section = f'\n{season_heading}\n<div class="grid">\n{card}</div>\n'
        m = re.search(r'<div class="sub">.*?</div>\s*\n', text, flags=re.DOTALL)
        if not m:
            print(f"  ⚠ {os.path.basename(index_path)} に <div class=\"sub\"> が見つかりませんでした。")
            return
        text = text[:m.end()] + new_section + text[m.end():]
    Path(index_path).write_text(text, encoding="utf-8")
    print(f"  🔗 holy-sword-league-index.html に追加: {season_label}")


def remove_card_from_index(index_path, href):
    """同名ファイルへの古いカード（日付違いの旧ファイル名など）が残っていれば消す"""
    if not os.path.exists(index_path):
        return
    text = Path(index_path).read_text(encoding="utf-8")
    pattern = re.compile(r'  <a class="tool-card" href="' + re.escape(href) + r'(\?[^"]*)?">.*?</a>\n', re.S)
    new_text, n = pattern.subn("", text)
    if n:
        Path(index_path).write_text(new_text, encoding="utf-8")
        print(f"  ↻ 旧カードを削除: {href}")


def render_html(scope, kid_count, people, alliance_list, truncated, back_links_html, freeze_note):
    table_rows, mobile_rows, alliance_cards = build_fragments(people, alliance_list)
    truncate_note = ""
    if truncated:
        truncate_note = f"（{len(truncated)}件の王国×ボードで取得上限100件に達しており、取りこぼしの可能性があります）"
    head = HEAD.format(scope=scope)
    body = BODY.format(
        scope=scope, kid_count=kid_count, threshold=THRESHOLD,
        people_count=len(people), alliance_count=len(alliance_list),
        table_rows=indent(table_rows, 4), mobile_rows=indent(mobile_rows, 6),
        alliance_cards=indent(alliance_cards, 6), truncate_note=truncate_note,
        fetched_at=datetime.now().strftime("%Y-%m-%d %H:%M"), back_links=back_links_html,
        freeze_note=freeze_note,
    )
    return head + body


def stable_filename(block_id):
    return f"聖剣リーグ_総合ランキング_第{block_id}ブロック_API版.html"


def do_full(block_id, kid_list):
    """初回実行（名簿確定日）: 通常どおり取得・抽出し、名簿スナップショットを保存する"""
    label = f"第{block_id}ブロック"
    print(f"📡 {label}（{len(kid_list)}王国）× 3ボードを取得します（初回・名簿を確定）...")
    raw, truncated = fetch_all(kid_list)
    people, counts = merge_and_rank(raw, THRESHOLD, THRESHOLD_BOARD)
    print(f"抽出: {len(people)}人")

    roster = [{"gid": p["gid"], "name": p["name"], "tag": p["tag"], "kid": p["kid"]} for p in people]
    roster_path = ROSTER_DIR / f"block{block_id}.json"
    roster_path.parent.mkdir(parents=True, exist_ok=True)
    roster_path.write_text(json.dumps({"frozenAt": date.today().isoformat(), "roster": roster}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  💾 名簿スナップショットを保存: {roster_path}")

    write_report(block_id, label, kid_list, people, truncated, is_first=True)


def do_scores_only(block_id, kid_list, roster):
    """2回目以降: 名簿はそのまま、スコアだけ再取得して順位を出し直す"""
    label = f"第{block_id}ブロック"
    print(f"📡 {label}（{len(kid_list)}王国）× 3ボードを取得します（名簿は固定、スコアのみ更新）...")
    raw, truncated = fetch_all(kid_list)

    current = {}
    for kid, boards in raw.items():
        for board_key, short in BOARD_KEYS.items():
            for row in boards.get(board_key, []):
                gid = row["governor_id"]
                current.setdefault(gid, {})[short] = {"score": row["score"]}

    frozen = {}
    for r in roster:
        gid = r["gid"]
        entry = {"name": r["name"], "tag": r["tag"], "kid": r["kid"]}
        entry.update(current.get(gid, {}))
        frozen[gid] = entry

    people, counts = rank_people(frozen)
    print(f"対象: {len(people)}人（名簿固定）")
    write_report(block_id, label, kid_list, people, truncated, is_first=False)


def write_report(block_id, label, kid_list, people, truncated, is_first):
    alliance_list = group_alliances(people)
    filename = stable_filename(block_id)
    out_dir = SITE_DIR / "holy-sword-league" / SEASON
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / filename

    index_path = SITE_DIR / "holy-sword-league" / "holy-sword-league-index.html"
    href = f"{SEASON}/{filename}"

    back_links_html = (
        '<a class="back-top" href="../../index.html">← TOP</a> '
        '<a class="back-top" href="../holy-sword-league-index.html">← 聖剣リーグ ランキングまとめ</a>'
    )
    freeze_note = (
        f"（{FREEZE_DATE.isoformat()}にメンバー・同盟を確定し、{END_DATE.isoformat()}まで毎日9時に数値だけを自動更新しています）"
    )
    html_text = render_html(label, len(kid_list), people, alliance_list, truncated, back_links_html, freeze_note)
    out_path.write_text(html_text, encoding="utf-8")
    print(f"✅ 出力: {out_path}")

    if is_first:
        # 旧・日付入りファイル名のカードが残っていたら消してから、新しい安定URLのカードを追加する
        import glob
        for old in glob.glob(str(out_dir / f"聖剣リーグ_総合ランキング_第{block_id}ブロック_API版_*.html")):
            old_path = Path(old)
            if old_path.name != filename:
                remove_card_from_index(index_path, f"{SEASON}/{old_path.name}")
                old_path.unlink()
                print(f"  🗑 旧ファイルを削除: {old_path}")
        desc = f"{len(people)}人・{len(alliance_list)}同盟（MightPulse API版・毎日9時に数値を自動更新）"
        add_card_to_season_index(index_path, SEASON, label, desc, href, is_me=(MY_KID in kid_list))


def main():
    today = date.today()
    # HSL_S2_FORCE=1: 動作確認用に名簿確定日より前でも実行する（本番ワークフローでは設定しない）
    if today < FREEZE_DATE and os.getenv("HSL_S2_FORCE") != "1":
        print(f"ℹ️ まだ名簿確定日（{FREEZE_DATE.isoformat()}）前なので、何もしません（今日: {today.isoformat()}）")
        return
    if today >= END_DATE:
        print(f"ℹ️ イベント終了日（{END_DATE.isoformat()}）を過ぎたため、自動更新を停止しました（今日: {today.isoformat()}）")
        return
    if not API_KEY:
        print("❌ MIGHTPULSE_API_KEY が設定されていません。")
        sys.exit(1)

    for block_id, kid_list in BLOCKS.items():
        roster_path = ROSTER_DIR / f"block{block_id}.json"
        if roster_path.exists():
            snapshot = json.loads(roster_path.read_text(encoding="utf-8"))
            do_scores_only(block_id, kid_list, snapshot["roster"])
        else:
            do_full(block_id, kid_list)


if __name__ == "__main__":
    main()
