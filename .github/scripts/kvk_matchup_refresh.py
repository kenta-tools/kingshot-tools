# -*- coding: utf-8 -*-
"""
KvK相手突合せ（kvk-matchup/）の自動更新スクリプト。

.github/data/kvk-matchup/*.json（kvk_matchup.py --event-id 実行時に保存される名簿スナップショット）
ごとに、紐づけたKVKイベントが「完了」になっているかを確認し、
- 完了していれば何もしない（自動更新を止める）
- 完了していなければ、名簿（うち・相手、governor_id単位で固定）はそのまま、
  3ボード（秘境の試練・マスター全体総力・ペット）の現在のスコアだけ再取得・再集計して
  同じレポートファイル（kvk-matchup/{filename}）に上書きする。

kvk_matchup.py（kingshot_tools/、ローカル専用）の生成ロジックをGitHub Actionsでも動かせるよう、
依存のない形で複製・最小化したもの。見た目・JSは同じテンプレートを使っている。

環境変数: MIGHTPULSE_API_KEY（GitHubリポジトリのSecretsから渡す）
"""
import sys
import io
import os
import json
import time
import html as H
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

API_KEY = os.getenv("MIGHTPULSE_API_KEY")
BASE_URL = "https://api.mightpulse.com/v1"
BOARD_KEYS = {"mystic_trial": "trial", "master_power": "master", "pet_power": "pet"}
BOARD_LABELS = [("trial", "秘境の試練"), ("master", "マスター全体総力"), ("pet", "ペット")]

# ペット列は「ペット用の試練のステージ」を主に、ペット総力を括弧書きで出す（2026-11-07ユーザー指示）。
# ペット用の試練は MightPulse API の forest_of_life（Forest of Life）。score の先頭の桁（2）を除いた残りがステージ（例 20373 → Stage 373）。
# 勝ち負けはステージで判定（score＝ステージ側のスコア、power＝ペット総力）。取れない人は「—（総力）」、総力も無ければ「—」
PET_STAGE_BOARD = "forest_of_life"


def stage_of(score):
    """forest_of_life の score（例 20373）から先頭の桁（2）を除いた数（373）の、下1桁を枝番にした表記（37-3）。ペット試練だけの読み方"""
    t = str(int(score))
    n = int(t[1:]) if len(t) > 1 else int(t)
    return f"{n // 10}-{n % 10}"


def pet_entry(power_entry, stage_score):
    if stage_score is None and not power_entry:
        return None
    return {"score": stage_score, "power": power_entry["score"] if power_entry else None}


def fmt_entry(entry, board=None):
    if not entry:
        return "—"
    if board == "pet":
        st = stage_of(entry["score"]) if entry.get("score") is not None else "—"
        if entry.get("power") is None:
            return st
        return f"{st}（{abbreviate(entry['power'])}）"
    return abbreviate(entry["score"], board)

GAS_URL = "https://script.google.com/macros/s/AKfycbxu5HW9uLU9pCsUs1r_45xpuofWZmQAyZFDwSLK1C_7GvA7SDXZ4ayBEJTS0sR_8oToAw/exec"

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SNAPSHOT_DIR = REPO_ROOT / ".github" / "data" / "kvk-matchup"


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


def gas_call(payload):
    req = urllib.request.Request(
        GAS_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "text/plain;charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            # GASのPOSTは302でecho URLへリダイレクトされる。urllibは自動で追うのでそのまま読める。
            return json.loads(res.read())
    except Exception as e:
        print(f"  GAS通信エラー: {e}")
        return None


def is_event_done(event_id):
    res = gas_call({"action": "pubGet"})
    if not res or not res.get("ok"):
        print("  ⚠ pubGetに失敗したため、安全側で「完了していない」として扱います。")
        return False
    events = (res.get("history") or {}).get("events") or []
    ev = next((e for e in events if e.get("id") == event_id), None)
    if ev is None:
        print(f"  ⚠ イベント{event_id}が見つかりません（削除された可能性）。安全側で「完了していない」として扱います。")
        return False
    return ev.get("done") is True


def fetch_all(kid_list):
    raw = {}
    for kid in kid_list:
        raw[kid] = {}
        for board in BOARD_KEYS:
            data = get(f"/kingdoms/{kid}/ranks", {"board": board, "limit": 100})
            rows = data.get("board", {}).get("rows", []) if data and data.get("ok") else []
            raw[kid][board] = rows
            time.sleep(0.3)
        # ペット用の試練（ステージ）。ランキングの集計（BOARD_KEYS）には入れず、別に取る
        data = get(f"/kingdoms/{kid}/ranks", {"board": PET_STAGE_BOARD, "limit": 100})
        raw[kid][PET_STAGE_BOARD] = data.get("board", {}).get("rows", []) if data and data.get("ok") else []
        time.sleep(0.3)
        print(f"  kid={kid} done: " + ", ".join(f"{b}={len(raw[kid][b])}" for b in list(BOARD_KEYS) + [PET_STAGE_BOARD]))
    return raw


def merge_and_rank(raw, threshold, threshold_board="mystic_trial"):
    people = {}
    for kid, boards in raw.items():
        for board_key, short in BOARD_KEYS.items():
            for row in boards.get(board_key, []):
                gid = row["governor_id"]
                if gid not in people:
                    people[gid] = {"name": row["nick_name"], "tag": row.get("alliance_abbr") or "なし", "kid": row["kid"]}
                people[gid][short] = {"score": row["score"]}

    stage_scores = {}
    for kid, boards in raw.items():
        for row in boards.get(PET_STAGE_BOARD, []):
            stage_scores[row["governor_id"]] = row["score"]

    threshold_key = BOARD_KEYS[threshold_board]
    qualifying = {gid: p for gid, p in people.items() if threshold < 0 or (threshold_key in p and p[threshold_key]["score"] > threshold)}

    def ingroup_rank(key):
        scored = [(gid, p[key]["score"]) for gid, p in qualifying.items() if key in p]
        scored.sort(key=lambda x: -x[1])
        return {gid: i + 1 for i, (gid, _) in enumerate(scored)}, len(scored)

    ranks = {}
    counts = {}
    for short in BOARD_KEYS.values():
        ranks[short], counts[short] = ingroup_rank(short)

    results = []
    for gid, p in qualifying.items():
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
        r["pet"] = pet_entry(r.get("pet"), stage_scores.get(gid))  # ペット列：ステージ（判定）＋総力（括弧書き）。順位の集計には元のペット総力を使った
        r["total"] = total
        r["best"] = best if best is not None else total
        results.append(r)

    results.sort(key=lambda x: (x["total"], x["best"]))
    for i, r in enumerate(results, start=1):
        r["rank"] = i
    return results


def sort_by_trial(people):
    """KvK突合せは秘境の試練のスコアが多い順に並べる（2026-11-07ユーザー指示。それまでは3ボードの総合順位）。
    試練のスコアが無い人は最後、同点は総合順位の順。並べ直した順番を rank に入れ直す。"""
    people.sort(key=lambda p: (-p["trial"]["score"] if p.get("trial") else float("inf"), p["total"], p["best"]))
    for i, p in enumerate(people, start=1):
        p["rank"] = i
    return people


def build_side(kid_list):
    raw = fetch_all(kid_list)
    return sort_by_trial(merge_and_rank(raw, threshold=-1, threshold_board="mystic_trial"))


def esc(s):
    return H.escape(str(s))


def abbreviate(n, board=None):
    # 秘境の試練は数千程度の値なので、K/M に省略せずそのまま出す
    if board == "trial":
        return f"{n:,}"
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n/1_000:.1f}K"
    return f"{n:,}"


def compare_board(a_entry, b_entry):
    a_score = a_entry["score"] if a_entry else None
    b_score = b_entry["score"] if b_entry else None
    if a_score is None and b_score is None:
        return None
    if a_score is None:
        return "b"
    if b_score is None:
        return "a"
    if a_score > b_score:
        return "a"
    if b_score > a_score:
        return "b"
    return "tie"


def board_cell(our_entry, their_entry, cell_id, board=None):
    winner = compare_board(our_entry, their_entry)
    our_txt = fmt_entry(our_entry, board)
    their_txt = fmt_entry(their_entry, board)
    cls = {"a": "win-our", "b": "win-their", "tie": "win-tie", None: "win-na"}[winner]
    return f'<td class="cmp {cls}" id="{cell_id}"><span class="our-v">{our_txt}</span><span class="vs">vs</span><span class="their-v">{their_txt}</span></td>', winner


def person_json(p):
    data = {"name": p["name"], "tag": p["tag"]}
    for short, _label in BOARD_LABELS:
        data[short] = dict(p[short]) if p.get(short) else None
    return data


def opponent_options(their_people, selected_idx):
    opts = ['<option value="">（未設定）</option>']
    for j, t in enumerate(their_people):
        sel = " selected" if j == selected_idx else ""
        opts.append(f'<option value="{j}"{sel}>{t["rank"]}位 {esc(t["tag"])} {esc(t["name"])}</option>')
    return "".join(opts)


def build_their_ranking_rows(their_people):
    rows = []
    for t in their_people:
        cells = []
        for short, _label in BOARD_LABELS:
            v = t.get(short)
            cells.append(f'<td class="cmp">{fmt_entry(v, short)}</td>')
        rows.append(
            f'<tr>'
            f'<td class="num rankcell">{t["rank"]}</td>'
            f'<td><span class="tag their-tag">{esc(t["tag"])}</span> {esc(t["name"])}</td>'
            f'{"".join(cells)}'
            f'</tr>'
        )
    return "\n".join(rows)


def build_rows(our_people, their_people):
    rows = []
    our_wins = their_wins = 0
    for i, o in enumerate(our_people):
        t = their_people[i] if i < len(their_people) else None
        cells = []
        board_wins = {"a": 0, "b": 0}
        for short, _label in BOARD_LABELS:
            cell_html, winner = board_cell(o.get(short), t.get(short) if t else None, f"cmp-{i}-{short}", short)
            cells.append(cell_html)
            if winner in ("a", "b"):
                board_wins[winner] += 1
        if board_wins["a"] > board_wins["b"]:
            result_cls, result_label = "result-our", "うちの勝ち"
            our_wins += 1
        elif board_wins["b"] > board_wins["a"]:
            result_cls, result_label = "result-their", "相手の勝ち"
            their_wins += 1
        else:
            result_cls, result_label = "result-tie", "互角"
        result_html = f'<td class="result {result_cls}" id="result-{i}">{result_label}<br><span class="score-sub">{board_wins["a"]}-{board_wins["b"]}</span></td>'
        opp_select = f'<select class="opp-select" id="opp-{i}" data-idx="{i}">{opponent_options(their_people, i if t else None)}</select>'
        rows.append(
            f'<tr>'
            f'<td class="num rankcell">{i + 1}</td>'
            f'<td><span class="tag">{esc(o["tag"])}</span> {esc(o["name"])}<span class="entry-badge" id="entry-{i}"></span><span class="entry-link" id="elink-{i}"></span></td>'
            f'{"".join(cells)}'
            f'{result_html}'
            f'<td>{opp_select}</td>'
            f'</tr>'
        )
    return "\n".join(rows), our_wins, their_wins, len(our_people)


def build_script_block(our_people, their_people, opponent_label):
    our_json = json.dumps([person_json(p) for p in our_people], ensure_ascii=False).replace("</", "<\\/")
    their_json = json.dumps([person_json(p) for p in their_people], ensure_ascii=False).replace("</", "<\\/")
    label_js = json.dumps(opponent_label, ensure_ascii=False)[1:-1]
    return (SCRIPT_TEMPLATE
            .replace("__OUR_JSON__", our_json)
            .replace("__THEIR_JSON__", their_json)
            .replace("__OPPONENT_LABEL__", label_js))


# HEAD/BODY/SCRIPT_TEMPLATEはkvk_matchup.pyと同じもの（見た目・挙動を完全に揃えるため）。
HEAD = """<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="robots" content="noindex, nofollow">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KvK相手突合せ</title>
<script>(function(){try{if(!sessionStorage.getItem('ksAdminPw')&&!localStorage.getItem('ksAdminPwSaved'))document.documentElement.style.visibility='hidden';}catch(e){document.documentElement.style.visibility='hidden';}})();</script>
<script src="../config.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Work+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#eef1f2; --surface:#ffffff; --surface-2:#f3f5f7; --surface-3:#e9ecef;
    --ink:#1a2030; --ink-dim:#5b6478; --ink-faint:#8a93a6; --border:#dde1e6;
    --accent:#c1591f; --our:#2f6fed; --their:#d9435e; --tie:#8a93a6; --gold:#93752b; --gold-bg:#f1e6cc;
    --shadow: 0 1px 2px rgba(20,24,32,0.06), 0 6px 20px rgba(20,24,32,0.05);
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      --bg:#0f131b; --surface:#171d29; --surface-2:#1e2635; --surface-3:#242d3f;
      --ink:#eef1f7; --ink-dim:#93a0b8; --ink-faint:#5c6884; --border:#2a3348;
      --accent:#ef8a4c; --our:#6ea0ff; --their:#ff7a93; --tie:#93a0b8; --gold:#d9b464; --gold-bg:#332a17;
      --shadow: 0 1px 2px rgba(0,0,0,0.3), 0 10px 30px rgba(0,0,0,0.35);
    }
  }
  :root[data-theme="dark"]{
    --bg:#0f131b; --surface:#171d29; --surface-2:#1e2635; --surface-3:#242d3f;
    --ink:#eef1f7; --ink-dim:#93a0b8; --ink-faint:#5c6884; --border:#2a3348;
    --accent:#ef8a4c; --our:#6ea0ff; --their:#ff7a93; --tie:#93a0b8; --gold:#d9b464; --gold-bg:#332a17;
    --shadow: 0 1px 2px rgba(0,0,0,0.3), 0 10px 30px rgba(0,0,0,0.35);
  }
  *{box-sizing:border-box;}
  body{ margin:0; background:var(--bg); color:var(--ink); font-family:"Work Sans","Yu Gothic UI","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif; -webkit-font-smoothing:antialiased; }
  .page{ max-width:1320px; margin:0 auto; padding:28px 16px 80px; }
  h1{ font-family:"Rajdhani","Yu Gothic UI",sans-serif; font-weight:700; font-size:clamp(1.5rem, 6vw, 2.1rem); margin:0 0 10px; }
  .lede{ color:var(--ink-dim); font-size:0.9rem; line-height:1.7; margin:0 0 20px; }
  .lede b{ color:var(--ink); font-weight:600; }
  .stats{ display:grid; grid-template-columns:repeat(3,1fr); gap:1px; background:var(--border); border:1px solid var(--border); border-radius:12px; overflow:hidden; margin-bottom:24px; box-shadow:var(--shadow); }
  .stat{ background:var(--surface); padding:12px 14px; text-align:center; }
  .stat .n{ font-family:"JetBrains Mono", ui-monospace, monospace; font-size:1.3rem; font-weight:700; }
  .stat .l{ margin-top:2px; font-size:0.7rem; color:var(--ink-faint); }
  .stat.our .n{ color:var(--our); }
  .stat.their .n{ color:var(--their); }
  .table-wrap{ overflow:auto; max-height:75vh; border:1px solid var(--border); border-radius:12px; box-shadow:var(--shadow); background:var(--surface); }
  table{ width:100%; border-collapse:collapse; }
  .layout-main table{ min-width:860px; }
  .layout-flex{ display:flex; gap:20px; align-items:flex-start; }
  .layout-main{ flex:1 1 auto; min-width:0; }
  .layout-side{ flex:0 0 300px; }
  .side-title{ font-family:"Rajdhani","Yu Gothic UI",sans-serif; font-weight:600; font-size:0.85rem; color:var(--ink-dim); margin:0 0 10px; }
  .layout-side .table-wrap{ max-height:75vh; }
  .layout-side table{ min-width:0; }
  .layout-side thead th{ font-size:0.62rem; padding:7px 4px; }
  .layout-side tbody td{ padding:5px 4px; font-size:0.72rem; }
  .layout-side td.rankcell{ font-size:0.72rem; }
  @media (max-width: 1100px){
    .layout-flex{ flex-direction:column; }
    .layout-side{ flex-basis:auto; width:100%; }
    .layout-side .table-wrap{ max-height:50vh; }
  }
  thead th{ position:sticky; top:0; z-index:10; background:var(--surface-2); color:var(--ink-dim); font-family:"Rajdhani","Yu Gothic UI",sans-serif; font-weight:600; font-size:0.72rem; letter-spacing:0.03em; text-align:center; text-transform:uppercase; padding:10px 8px; border-bottom:1px solid var(--border); white-space:nowrap; }
  th.num, td.num{ text-align:center; }
  tbody td{ padding:8px 10px; font-size:0.84rem; border-bottom:1px solid var(--border); text-align:center; white-space:nowrap; }
  tbody tr:last-child td{ border-bottom:none; }
  tbody tr:hover td{ background:var(--surface-2); }
  td.rankcell{ font-family:"JetBrains Mono", ui-monospace, monospace; font-weight:700; }
  .tag{ display:inline-block; font-family:"Rajdhani","Yu Gothic UI",sans-serif; font-weight:600; font-size:0.74rem; background:var(--gold-bg); color:var(--gold); padding:1px 8px; border-radius:6px; }
  .entry-badge{ display:inline-block; margin-left:6px; font-size:0.72rem; padding:0 7px; border-radius:6px; white-space:nowrap; }
  .entry-badge:empty{ display:none; }
  .entry-badge.entry-start{ background:color-mix(in srgb, #4cc38a 20%, var(--surface-2)); color:#4cc38a; }
  .entry-badge.entry-late{ background:color-mix(in srgb, var(--accent) 20%, var(--surface-2)); color:var(--accent); }
  .entry-badge.entry-absent{ background:color-mix(in srgb, var(--their) 18%, var(--surface-2)); color:var(--their); }
  .entry-badge.entry-none{ border:1px dashed var(--ink-faint); color:var(--ink-faint); }
  .entry-badge.entry-guess{ outline:1px dashed currentColor; outline-offset:1px; }
  .entry-link select{ margin-left:6px; font-size:0.72rem; max-width:9em; background:var(--surface-2); color:var(--ink); border:1px solid var(--border); border-radius:6px; padding:1px 4px; }
  .entry-link button{ margin-left:4px; font-size:0.72rem; background:var(--surface-3); color:var(--ink); border:1px solid var(--border); border-radius:6px; padding:1px 8px; cursor:pointer; }
  .tag.their-tag{ background:color-mix(in srgb, var(--their) 18%, var(--surface-2)); color:var(--their); }
  td.cmp{ font-family:"JetBrains Mono", ui-monospace, monospace; font-size:0.78rem; }
  td.cmp .our-v{ color:var(--our); font-weight:700; }
  td.cmp .their-v{ color:var(--their); font-weight:700; }
  td.cmp .vs{ color:var(--ink-faint); font-size:0.68rem; margin:0 4px; }
  td.cmp.win-our .our-v{ text-decoration: underline; }
  td.cmp.win-their .their-v{ text-decoration: underline; }
  td.result{ font-weight:700; font-size:0.78rem; }
  td.result .score-sub{ font-weight:400; font-size:0.7rem; color:var(--ink-faint); }
  td.result-our{ background:color-mix(in srgb, var(--our) 12%, var(--surface)); color:var(--our); }
  td.result-their{ background:color-mix(in srgb, var(--their) 12%, var(--surface)); color:var(--their); }
  td.result-tie{ color:var(--tie); }
  .opp-select{ font: inherit; font-size:0.8rem; padding:4px 6px; border-radius:6px; border:1px solid var(--border); background:var(--surface); color:var(--ink); max-width:220px; }
  .event-box{ display:flex; flex-wrap:wrap; gap:10px 16px; align-items:center; background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:12px 16px; margin-bottom:18px; box-shadow:var(--shadow); font-size:0.85rem; }
  .event-box label{ color:var(--ink-dim); font-size:0.78rem; }
  .event-box select{ font:inherit; font-size:0.84rem; padding:5px 8px; border-radius:6px; border:1px solid var(--border); background:var(--surface-2); color:var(--ink); }
  .event-box button{ font:inherit; font-size:0.82rem; padding:7px 14px; border-radius:8px; border:none; background:var(--accent); color:#fff; cursor:pointer; }
  .event-box button:disabled{ opacity:0.45; cursor:default; }
  .event-box button.sub{ background:var(--surface-2); color:var(--ink); border:1px solid var(--border); }
  .event-box input[type=text]{ font:inherit; font-size:0.84rem; padding:5px 8px; border-radius:6px; border:1px solid var(--border); background:var(--surface-2); color:var(--ink); width:160px; }
  .event-box .event-msg{ font-size:0.76rem; color:var(--ink-faint); }
  .legend{ font-family:"Rajdhani","Yu Gothic UI",sans-serif; font-size:0.76rem; color:var(--ink-faint); margin:0 0 14px; line-height:1.6; }
  details.prompt-box{ margin-top:28px; background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:4px 16px; box-shadow:var(--shadow); }
  details.prompt-box summary{ cursor:pointer; padding:12px 0; font-weight:600; font-size:0.85rem; color:var(--ink-dim); user-select:none; }
  details.prompt-box pre{ background:var(--surface-2); border-radius:8px; padding:12px 14px; font-family:"JetBrains Mono", ui-monospace, monospace; font-size:0.78rem; overflow-x:auto; margin:0 0 14px; }
  footer{ margin-top:32px; padding-top:16px; border-top:1px solid var(--border); color:var(--ink-faint); font-size:0.74rem; line-height:1.8; }
  a{ color:var(--accent); }
  .back-top{ display:inline-block; font-size:13px; color:var(--ink-faint); text-decoration:none; margin-right:14px; margin-bottom:10px; }
  .back-top:hover{ text-decoration:underline; }
</style>
</head>
"""

BODY = """<body>
<div class="page">

  <h1>KvK相手突合せ：うち鯖 vs {opponent_label}</h1>
  <p class="lede">
    うち（鯖{our_kids}）と{opponent_label}（鯖{opponent_kids}）それぞれで、<b>秘境の試練のスコアが多い順</b>に並べ、
    うちの上位{max_rows}人を、初期状態では同じ順位同士（うちの1位 vs 相手の1位、2位 vs 2位…）で並べて各ボードの実数値をそのまま比較しています。
    「相手」欄のプルダウンで、組み合わせを自由に変更できます（変更するとその場で勝敗を再計算します）。
    ※各鯖の人数はAPIが1ボードあたり最大100人までしか返さない仕様のため、上位100人（秘境の試練ランキング基準）までの集計です。実際の在籍者数とは異なります。
    （このレポートは、紐づけたイベントが「完了」になるまで、名簿を固定したまま毎日9時に数値だけ自動更新されます）
  </p>

  <div class="event-box">
    <label for="eventSelect">イベント:</label>
    <select id="eventSelect"><option value="">（読み込み中…）</option></select>
    <label for="patternSelect">組み合わせ:</label>
    <select id="patternSelect" disabled><option value="">＋新しい組み合わせ</option></select>
    <input type="text" id="patternName" maxlength="20" placeholder="名前（例：本隊用）">
    <button type="button" id="savePairsBtn" disabled>💾 新しく保存</button>
    <button type="button" class="sub" id="saveAsNewBtn" disabled>📄 複製して新規保存</button>
    <button type="button" class="sub" id="renamePatternBtn" disabled>✏️ 名前を変える</button>
    <button type="button" class="sub" id="deletePatternBtn" disabled>🗑 削除</button>
    <span class="event-msg" id="eventMsg"></span>
  </div>

  <div class="stats">
    <div class="stat our"><div class="n" id="statOurWins">{our_wins}</div><div class="l">うちが勝った順位</div></div>
    <div class="stat their"><div class="n" id="statTheirWins">{their_wins}</div><div class="l">相手が勝った順位</div></div>
    <div class="stat"><div class="n">{matched}</div><div class="l">突合せ人数（上位{max_rows}人まで）</div></div>
  </div>

  <div class="layout-flex">
    <div class="layout-main">
      <p class="legend">各ボードのセルは「うちの実数値 vs 相手の実数値」。多く勝ったボード数（0〜3）で、その順位の勝敗を決めています。上の「イベント」を選ぶと、うちの名前の横にそのイベントの参加登録（最初から／途中参加／不参加／未登録）が出ます。「≈」は名前が部分一致した推定です。推定・未登録の人は、右のプルダウンで登録者を選んで「紐づけ」を押すと、次回から自動で一致します。</p>
      <div class="table-wrap">
      <table>
      <thead>
      <tr>
        <th class="num">順位</th>
        <th>うち</th>
        <th>秘境の試練</th>
        <th>マスター全体総力</th>
        <th>ペット試練<br>（総力）</th>
        <th>勝敗</th>
        <th>相手</th>
      </tr>
      </thead>
      <tbody>
{rows}
      </tbody>
      </table>
      </div>
    </div>
    <div class="layout-side">
      <div class="side-title">📊 {opponent_label}の全体ランキング（上位{their_count}人）</div>
      <div class="table-wrap">
      <table>
      <thead>
      <tr>
        <th class="num">順位</th>
        <th>{opponent_label}</th>
        <th>試練</th>
        <th>総力</th>
        <th>ペット試練<br>（総力）</th>
      </tr>
      </thead>
      <tbody>
{their_ranking_rows}
      </tbody>
      </table>
      </div>
    </div>
  </div>

  <details class="prompt-box">
    <summary>🔁 プロンプトを表示（次のKvKで作り直すときに使う）</summary>
    <pre>{prompt_text}</pre>
  </details>

  <footer>
    出典：MightPulse API（<a href="https://api.mightpulse.com/">api.mightpulse.com</a>）/v1/kingdoms/{{kid}}/ranks エンドポイント（board=mystic_trial, master_power, pet_power）をうち鯖・相手鯖それぞれで取得・集計。データ更新日時: {fetched_at}。このページは{opponent_label}との突合せ記録として残しています。
  </footer>

</div>
{script_block}
<script src="kvk-auth-gate.js"></script>
</body>
</html>
"""

SCRIPT_TEMPLATE = """<script>
const OUR = __OUR_JSON__;
const THEIR = __THEIR_JSON__;
const BOARD_SHORTS = ["trial", "master", "pet"];

function abbreviate(n, board) {
  if (board === "trial") return n.toLocaleString(); // 秘境の試練はK/Mに省略しない
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toLocaleString();
}

function stageOf(score) { // forest_of_life の score（例 20373）の先頭の桁を除いた数（373）を、下1桁を枝番にして 37-3 と表す
  const t = String(score), n = t.length > 1 ? parseInt(t.slice(1), 10) : parseInt(t, 10);
  return Math.floor(n / 10) + "-" + (n % 10);
}
function fmtEntry(e, board) {
  if (!e) return "—";
  if (board === "pet") { // ペット用の試練のステージを主に、ペット総力は括弧書き
    const st = e.score != null ? stageOf(e.score) : "—";
    return e.power != null ? st + "（" + abbreviate(e.power, board) + "）" : st;
  }
  return abbreviate(e.score, board);
}

function compareBoard(a, b) {
  const as = a ? a.score : null, bs = b ? b.score : null;
  if (as == null && bs == null) return null;
  if (as == null) return "b";
  if (bs == null) return "a";
  if (as > bs) return "a";
  if (bs > as) return "b";
  return "tie";
}

function recalcRow(i) {
  const sel = document.getElementById("opp-" + i);
  const idx = sel.value === "" ? null : parseInt(sel.value, 10);
  const them = idx == null ? null : THEIR[idx];
  const o = OUR[i];
  let aWins = 0, bWins = 0;
  BOARD_SHORTS.forEach(short => {
    const winner = compareBoard(o[short], them ? them[short] : null);
    if (winner === "a") aWins++; else if (winner === "b") bWins++;
    const cell = document.getElementById("cmp-" + i + "-" + short);
    const ov = fmtEntry(o[short], short);
    const tv = fmtEntry(them ? them[short] : null, short);
    const cls = winner === "a" ? "win-our" : winner === "b" ? "win-their" : winner === "tie" ? "win-tie" : "win-na";
    cell.className = "cmp " + cls;
    cell.innerHTML = `<span class="our-v">${ov}</span><span class="vs">vs</span><span class="their-v">${tv}</span>`;
  });
  const resultCell = document.getElementById("result-" + i);
  let cls, label;
  if (aWins > bWins) { cls = "result-our"; label = "うちの勝ち"; }
  else if (bWins > aWins) { cls = "result-their"; label = "相手の勝ち"; }
  else { cls = "result-tie"; label = "互角"; }
  resultCell.className = "result " + cls;
  resultCell.innerHTML = `${label}<br><span class="score-sub">${aWins}-${bWins}</span>`;
  recalcSummary();
}

function recalcSummary() {
  let ourWins = 0, theirWins = 0;
  OUR.forEach((o, i) => {
    const cell = document.getElementById("result-" + i);
    if (cell.classList.contains("result-our")) ourWins++;
    else if (cell.classList.contains("result-their")) theirWins++;
  });
  document.getElementById("statOurWins").textContent = ourWins;
  document.getElementById("statTheirWins").textContent = theirWins;
}

document.querySelectorAll(".opp-select").forEach(sel => {
  sel.addEventListener("change", () => recalcRow(parseInt(sel.dataset.idx, 10)));
});

const OPPONENT_LABEL = "__OPPONENT_LABEL__";
// GAS_URL は config.js（HEADで読み込み済み）で定義
const EVENT_ID_KEY = "ksMatchupEventId";

function gasCall(payload) {
  return fetch(GAS_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) })
    .then(r => r.json());
}

// --- 参加可否：選んだイベントのイベント参加登録（entries.entry）を、うちの名前で照合して表示 ---
// 1) 名前か旧名（別表記）が一致（前後空白・大文字小文字・全角半角・カタカナひらがな・記号の違いは無視）→ そのまま表示
// 2) 一致しなければ、選んだイベントの登録者から部分一致する人が1人だけいれば「≈登録名」として推定表示
// 推定・未登録の人は右のプルダウンで登録者を選んで「紐づけ」→ ゲーム内の名前を旧名（別表記）として保存し、次回から自動で一致
const ENTRY_SHORT = { start: "最初から", late: "途中参加", absent: "不参加" };
let REG = { users: [], entries: [] };

function looseKey(s) {
  return String(s == null ? "" : s).normalize("NFKC").toLowerCase()
    .replace(/[\\u30a1-\\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[^\\p{L}\\p{N}]/gu, "");
}

function userKeys(u) { return [u.name].concat(u.aliases || []).map(looseKey).filter(Boolean); }

// { user, kind: "exact" | "guess" } か null
function findRegMatch(name, eventId) {
  const k = looseKey(name);
  if (!k) return null;
  const exact = REG.users.find(u => userKeys(u).includes(k));
  if (exact) return { user: exact, kind: "exact" };
  const ids = new Set(REG.entries.filter(x => x.eventId === eventId).map(x => x.userId));
  const cands = REG.users.filter(u => ids.has(u.id) && userKeys(u).some(uk => {
    const short = uk.length <= k.length ? uk : k, long = uk.length <= k.length ? k : uk;
    return short.length >= 2 && long.includes(short);
  }));
  return cands.length === 1 ? { user: cands[0], kind: "guess" } : null;
}

function eventUsers(eventId) {
  const ids = new Set(REG.entries.filter(x => x.eventId === eventId).map(x => x.userId));
  return REG.users.filter(u => ids.has(u.id)).sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : s;
  return d.innerHTML.replace(/"/g, "&quot;");
}

function renderEntryBadges() {
  const eventId = document.getElementById("eventSelect").value;
  const evUsers = eventId ? eventUsers(eventId) : [];
  OUR.forEach((o, i) => {
    const el = document.getElementById("entry-" + i);
    const link = document.getElementById("elink-" + i);
    if (!el) return;
    if (!eventId) { el.textContent = ""; el.className = "entry-badge"; if (link) link.innerHTML = ""; return; }
    const m = findRegMatch(o.name, eventId);
    const e = m && REG.entries.find(x => x.eventId === eventId && x.userId === m.user.id);
    const kind = e ? (ENTRY_SHORT[e.entry] ? e.entry : "start") : "none";
    el.textContent = (kind === "none" ? "未登録" : ENTRY_SHORT[kind]) + (m && m.kind === "guess" ? " ≈" + m.user.name : "");
    el.className = "entry-badge entry-" + kind + (m && m.kind === "guess" ? " entry-guess" : "");
    if (!link) return;
    if (m && m.kind === "exact") { link.innerHTML = ""; return; }
    const guessId = m ? m.user.id : "";
    link.innerHTML = '<select title="登録者を選んで紐づけると、この名前を旧名（別表記）として保存し、次回から自動で一致します">' +
      '<option value="">（登録者を選ぶ）</option>' +
      evUsers.map(u => `<option value="${u.id}"${u.id === guessId ? " selected" : ""}>${escHtml(u.name)}</option>`).join("") +
      '</select><button type="button">紐づけ</button>';
    link.querySelector("button").addEventListener("click", () => linkAlias(o.name, link.querySelector("select").value, link));
  });
}

function linkAlias(gameName, userId, link) {
  const u = REG.users.find(x => x.id === userId);
  if (!u) { alert("紐づける登録者を選んでください"); return; }
  if (!confirm(`「${gameName}」を「${u.name}」の旧名（別表記）として登録します。よろしいですか？`)) return;
  let password = "";
  try { password = sessionStorage.getItem("ksAdminPw") || ""; } catch (e) {}
  const btn = link.querySelector("button");
  btn.disabled = true;
  btn.textContent = "保存中…";
  gasCall({ action: "addAlias", password, userId, alias: gameName }).then(res => {
    if (!res.ok) { alert("保存できませんでした: " + (res.error || res.status)); btn.disabled = false; btn.textContent = "紐づけ"; return; }
    u.aliases = res.user.aliases;
    renderEntryBadges();
  }).catch(() => { alert("通信エラーで保存できませんでした"); btn.disabled = false; btn.textContent = "紐づけ"; });
}

// ---- 組み合わせ（パターン）：イベントごとに名前を付けて複数保存できる（管理者のみ保存・名前変更・削除。閲覧はパスワード不要） ----
let PATTERNS = [];
function normPattern(r) { return Object.assign({}, r, { id: r.id || r.eventId, name: r.name || "標準", pairs: r.pairs || [] }); } // 昔の形（id・nameなし）は「標準」
const MAX_PATTERNS = 10;
const elEvent = document.getElementById("eventSelect");
const elPattern = document.getElementById("patternSelect");
const elName = document.getElementById("patternName");
const elMsg = document.getElementById("eventMsg");
const elSave = document.getElementById("savePairsBtn");
const elSaveNew = document.getElementById("saveAsNewBtn");
const elRename = document.getElementById("renamePatternBtn");
const elDelete = document.getElementById("deletePatternBtn");

function eventPatterns() { return PATTERNS.filter(p => p.eventId === elEvent.value); }

function renderPatterns(selectId) {
  const list = eventPatterns();
  elPattern.innerHTML = '<option value="">＋新しい組み合わせ</option>' + list.map(p =>
    `<option value="${escHtml(p.id)}">${escHtml(p.name)}（${p.pairs.length}人${p.opponentLabel && p.opponentLabel !== OPPONENT_LABEL ? "・相手: " + escHtml(p.opponentLabel) : ""}）</option>`
  ).join("");
  elPattern.value = list.some(p => p.id === selectId) ? selectId : "";
  updatePatternButtons();
}

function updatePatternButtons() {
  const hasEvent = !!elEvent.value, hasPattern = !!elPattern.value;
  elPattern.disabled = !hasEvent;
  elSave.disabled = !hasEvent;
  elSave.textContent = hasPattern ? "💾 上書き保存" : "💾 新しく保存";
  elSaveNew.disabled = !hasEvent || !hasPattern || eventPatterns().length >= MAX_PATTERNS;
  elRename.disabled = !hasPattern;
  elDelete.disabled = !hasPattern;
}

// 保存してある組み合わせを、画面の「相手」欄に読み込む（このページの相手鯖に居ない人は「未設定」になる）
function loadPattern(p) {
  const theirIdx = {};
  THEIR.forEach((t, j) => { theirIdx[t.name + "\t" + t.tag] = j; });
  const mine = {};
  p.pairs.forEach(x => { mine[x.ourName + "\t" + x.ourTag] = x; });
  let missed = 0;
  OUR.forEach((o, i) => {
    const sel = document.getElementById("opp-" + i);
    const x = mine[o.name + "\t" + o.tag];
    let v = "";
    if (x) { const j = theirIdx[x.theirName + "\t" + x.theirTag]; if (j != null) v = String(j); else missed++; }
    sel.value = v;
    recalcRow(i);
  });
  return missed;
}

function currentPairs() {
  const pairs = [];
  document.querySelectorAll(".opp-select").forEach(sel => {
    const idx = sel.value === "" ? null : parseInt(sel.value, 10);
    if (idx == null) return;
    const o = OUR[parseInt(sel.dataset.idx, 10)];
    const t = THEIR[idx];
    pairs.push({ ourName: o.name, ourTag: o.tag, theirName: t.name, theirTag: t.tag });
  });
  return pairs;
}

function adminPw() {
  try { return sessionStorage.getItem("ksAdminPw") || ""; } catch (e) { return ""; }
}

function refreshPatterns(selectId) {
  return gasCall({ action: "pubGet" }).then(res => {
    if (res.ok) PATTERNS = (res.matchupPairs || []).map(normPattern);
    renderPatterns(selectId);
  });
}

function loadEvents() {
  gasCall({ action: "pubGet" }).then(res => {
    if (!res.ok) { elEvent.innerHTML = '<option value="">（読み込めませんでした）</option>'; return; }
    REG = { users: res.users || [], entries: (res.history && res.history.entries) || [] };
    PATTERNS = (res.matchupPairs || []).map(normPattern);
    const events = (res.history && res.history.events || []).filter(e => e.type === "KVK").sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    if (!events.length) { elEvent.innerHTML = '<option value="">（KVKイベントがありません）</option>'; return; }
    let saved = "";
    try { saved = localStorage.getItem(EVENT_ID_KEY) || ""; } catch (e) {}
    elEvent.innerHTML = '<option value="">（未選択）</option>' + events.map(e =>
      `<option value="${e.id}"${e.id === saved ? " selected" : ""}>${e.date}</option>`
    ).join("");
    renderPatterns("");
    renderEntryBadges();
  });
}

elEvent.addEventListener("change", function() {
  try { localStorage.setItem(EVENT_ID_KEY, this.value); } catch (e) {}
  elMsg.textContent = "";
  elName.value = "";
  renderPatterns("");
  renderEntryBadges();
});

elPattern.addEventListener("change", function() {
  const p = eventPatterns().find(x => x.id === this.value);
  updatePatternButtons();
  if (!p) { elName.value = ""; elMsg.textContent = ""; return; }
  elName.value = p.name;
  const missed = loadPattern(p);
  elMsg.textContent = `「${p.name}」を読み込みました（${p.pairs.length}人分）` + (missed ? `。この相手鯖に居ない${missed}人分は「未設定」になっています` : "");
});

// 保存・複製・名前変更・削除の共通処理（押している間はボタンを止める）
function patternOp(label, payload, afterId) {
  if (!elEvent.value) { elMsg.textContent = "イベントを選んでください"; return Promise.resolve(null); }
  [elSave, elSaveNew, elRename, elDelete].forEach(b => { b.disabled = true; });
  elMsg.textContent = label + "中…";
  return gasCall(Object.assign({ password: adminPw(), eventId: elEvent.value }, payload)).then(res => {
    if (!res.ok) { elMsg.textContent = label + "できませんでした: " + (res.error || res.status); return null; }
    return res;
  }).catch(() => { elMsg.textContent = "通信エラーで" + label + "できませんでした"; return null; }).then(res => {
    if (!res) { updatePatternButtons(); return null; }
    return refreshPatterns(afterId ? afterId(res) : elPattern.value).then(() => res);
  });
}

function savePattern(asNew) {
  const pairs = currentPairs();
  const id = asNew ? "" : elPattern.value;
  patternOp("保存", { action: "matchupSave", matchupId: id || "new", name: elName.value.trim(), opponentLabel: OPPONENT_LABEL, pairs },
    res => res.id).then(res => {
    if (!res) return;
    const p = eventPatterns().find(x => x.id === res.id);
    elName.value = p ? p.name : elName.value;
    elMsg.textContent = `「${res.name}」を保存しました（${pairs.length}人分）。カウントダウン表で選べます`;
  });
}
elSave.addEventListener("click", () => savePattern(false));
elSaveNew.addEventListener("click", () => savePattern(true));

elRename.addEventListener("click", function() {
  const name = elName.value.trim();
  if (!name) { elMsg.textContent = "新しい名前を入れてください"; return; }
  patternOp("名前変更", { action: "matchupRename", matchupId: elPattern.value, name }).then(res => {
    if (res) elMsg.textContent = `名前を「${res.name}」に変えました`;
  });
});

elDelete.addEventListener("click", function() {
  const p = eventPatterns().find(x => x.id === elPattern.value);
  if (!p) return;
  if (!confirm(`組み合わせ「${p.name}」を削除します。よろしいですか？\n（カウントダウン表でこれを選んでいるタブは、選び直しになります）`)) return;
  patternOp("削除", { action: "matchupDelete", matchupId: p.id }, () => "").then(res => {
    if (res) { elName.value = ""; elMsg.textContent = `「${p.name}」を削除しました`; }
  });
});

loadEvents();
</script>
"""


def refresh_one(snapshot_path):
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    event_id = snapshot["eventId"]
    filename = snapshot["filename"]
    print(f"📄 {filename}（イベント {event_id}）")

    if is_event_done(event_id):
        print("  ✅ イベントは完了済みのため、更新をスキップします。")
        return

    our_kids = snapshot["ourKids"]
    opponent_kids = snapshot["opponentKids"]
    opponent_label = snapshot["opponentLabel"]
    max_rows = snapshot["maxRows"]
    our_gids = {p["gid"] for p in snapshot["ourRoster"]}
    their_gids = {p["gid"] for p in snapshot["theirRoster"]}

    print(f"  📡 うち鯖{our_kids} / 相手鯖{opponent_kids} の現在のスコアを取得します...")
    our_all = build_side(our_kids)
    their_all = build_side(opponent_kids)

    # 名簿（人）は固定のまま、並びはその日の秘境の試練の多い順（build_side が並べた順）
    our_people = [p for p in our_all if p["gid"] in our_gids]
    their_people = [p for p in their_all if p["gid"] in their_gids]
    missing_our = our_gids - {p["gid"] for p in our_people}
    missing_their = their_gids - {p["gid"] for p in their_people}
    if missing_our or missing_their:
        print(f"  ⚠ 名簿のうち{len(missing_our)}人（うち側）/{len(missing_their)}人（相手側）が今回のAPI結果に見つかりませんでした（ランキング圏外になった可能性）。見つかった人だけで更新します。")

    rows, our_wins, their_wins, matched = build_rows(our_people, their_people)
    script_block = build_script_block(our_people, their_people, opponent_label)
    their_ranking_rows = build_their_ranking_rows(their_people)

    prompt_text = (
        f"python kvk_matchup.py --opponent-kids {','.join(str(k) for k in opponent_kids)} --opponent-label \"{opponent_label}\""
        + ("" if our_kids == [816] else f" --our-kids {','.join(str(k) for k in our_kids)}")
        + (f" --max-rows {max_rows}")
        + f" --event-id {event_id}"
    )

    body = BODY.format(
        opponent_label=opponent_label,
        our_kids=",".join(str(k) for k in our_kids),
        opponent_kids=",".join(str(k) for k in opponent_kids),
        our_wins=our_wins, their_wins=their_wins, matched=matched, max_rows=max_rows,
        rows=rows, fetched_at=datetime.now().strftime("%Y-%m-%d %H:%M"), prompt_text=esc(prompt_text),
        script_block=script_block, their_ranking_rows=their_ranking_rows, their_count=len(their_people),
    )

    out_path = REPO_ROOT / "kvk-matchup" / filename
    out_path.write_text(HEAD + body, encoding="utf-8")
    print(f"  ✅ 更新しました: {out_path}（{matched}人、{our_wins}勝{their_wins}敗）")


def main():
    if not API_KEY:
        print("❌ MIGHTPULSE_API_KEY が設定されていません。")
        return
    if not SNAPSHOT_DIR.exists():
        print("ℹ️ 名簿スナップショットがまだありません。何もしません。")
        return
    snapshots = sorted(SNAPSHOT_DIR.glob("*.json"))
    if not snapshots:
        print("ℹ️ 名簿スナップショットがまだありません。何もしません。")
        return
    for snapshot_path in snapshots:
        refresh_one(snapshot_path)


if __name__ == "__main__":
    main()
