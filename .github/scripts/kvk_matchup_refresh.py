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
        print(f"  kid={kid} done: " + ", ".join(f"{b}={len(raw[kid][b])}" for b in BOARD_KEYS))
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
        r["total"] = total
        r["best"] = best if best is not None else total
        results.append(r)

    results.sort(key=lambda x: (x["total"], x["best"]))
    for i, r in enumerate(results, start=1):
        r["rank"] = i
    return results


def build_side(kid_list):
    raw = fetch_all(kid_list)
    return merge_and_rank(raw, threshold=-1, threshold_board="mystic_trial")


def esc(s):
    return H.escape(str(s))


def abbreviate(n):
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


def board_cell(our_entry, their_entry, cell_id):
    winner = compare_board(our_entry, their_entry)
    our_txt = abbreviate(our_entry["score"]) if our_entry else "—"
    their_txt = abbreviate(their_entry["score"]) if their_entry else "—"
    cls = {"a": "win-our", "b": "win-their", "tie": "win-tie", None: "win-na"}[winner]
    return f'<td class="cmp {cls}" id="{cell_id}"><span class="our-v">{our_txt}</span><span class="vs">vs</span><span class="their-v">{their_txt}</span></td>', winner


def person_json(p):
    data = {"name": p["name"], "tag": p["tag"]}
    for short, _label in BOARD_LABELS:
        data[short] = {"score": p[short]["score"]} if p.get(short) else None
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
            cells.append(f'<td class="cmp">{abbreviate(v["score"]) if v else "—"}</td>')
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
            cell_html, winner = board_cell(o.get(short), t.get(short) if t else None, f"cmp-{i}-{short}")
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
            f'<td><span class="tag">{esc(o["tag"])}</span> {esc(o["name"])}</td>'
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
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KvK相手突合せ</title>
<script>(function(){try{if(!sessionStorage.getItem('ksAdminPw'))document.documentElement.style.visibility='hidden';}catch(e){document.documentElement.style.visibility='hidden';}})();</script>
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
    うち（鯖{our_kids}）と{opponent_label}（鯖{opponent_kids}）それぞれで、秘境の試練・マスター全体総力・ペットを合わせた<b>総合順位</b>を算出し、
    うちの上位{max_rows}人を、初期状態では同じ順位同士（うちの1位 vs 相手の1位、2位 vs 2位…）で並べて各ボードの実数値をそのまま比較しています。
    「相手」欄のプルダウンで、組み合わせを自由に変更できます（変更するとその場で勝敗を再計算します）。
    ※各鯖の人数はAPIが1ボードあたり最大100人までしか返さない仕様のため、上位100人（秘境の試練ランキング基準）までの集計です。実際の在籍者数とは異なります。
    （このレポートは、紐づけたイベントが「完了」になるまで、名簿を固定したまま毎日9時に数値だけ自動更新されます）
  </p>

  <div class="event-box">
    <label for="eventSelect">イベント:</label>
    <select id="eventSelect"><option value="">（読み込み中…）</option></select>
    <button type="button" id="savePairsBtn" disabled>💾 この組み合わせを保存</button>
    <span class="event-msg" id="eventMsg"></span>
  </div>

  <div class="stats">
    <div class="stat our"><div class="n" id="statOurWins">{our_wins}</div><div class="l">うちが勝った順位</div></div>
    <div class="stat their"><div class="n" id="statTheirWins">{their_wins}</div><div class="l">相手が勝った順位</div></div>
    <div class="stat"><div class="n">{matched}</div><div class="l">突合せ人数（上位{max_rows}人まで）</div></div>
  </div>

  <div class="layout-flex">
    <div class="layout-main">
      <p class="legend">各ボードのセルは「うちの実数値 vs 相手の実数値」。多く勝ったボード数（0〜3）で、その順位の勝敗を決めています。</p>
      <div class="table-wrap">
      <table>
      <thead>
      <tr>
        <th class="num">順位</th>
        <th>うち</th>
        <th>秘境の試練</th>
        <th>マスター全体総力</th>
        <th>ペット</th>
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
        <th>ペット</th>
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

function abbreviate(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toLocaleString();
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
    const ov = o[short] ? abbreviate(o[short].score) : "—";
    const tv = them && them[short] ? abbreviate(them[short].score) : "—";
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
const GAS_URL = "https://script.google.com/macros/s/AKfycbxu5HW9uLU9pCsUs1r_45xpuofWZmQAyZFDwSLK1C_7GvA7SDXZ4ayBEJTS0sR_8oToAw/exec";
const EVENT_ID_KEY = "ksMatchupEventId";

function gasCall(payload) {
  return fetch(GAS_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) })
    .then(r => r.json());
}

function loadEvents() {
  const sel = document.getElementById("eventSelect");
  gasCall({ action: "pubGet" }).then(res => {
    if (!res.ok) { sel.innerHTML = '<option value="">（読み込めませんでした）</option>'; return; }
    const events = (res.history && res.history.events || []).filter(e => e.type === "KVK").sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    if (!events.length) { sel.innerHTML = '<option value="">（KVKイベントがありません）</option>'; return; }
    let saved = "";
    try { saved = localStorage.getItem(EVENT_ID_KEY) || ""; } catch (e) {}
    sel.innerHTML = '<option value="">（未選択）</option>' + events.map(e =>
      `<option value="${e.id}"${e.id === saved ? " selected" : ""}>${e.date}</option>`
    ).join("");
    document.getElementById("savePairsBtn").disabled = !sel.value;
  });
}

document.getElementById("eventSelect").addEventListener("change", function() {
  try { localStorage.setItem(EVENT_ID_KEY, this.value); } catch (e) {}
  document.getElementById("savePairsBtn").disabled = !this.value;
  document.getElementById("eventMsg").textContent = "";
});

document.getElementById("savePairsBtn").addEventListener("click", function() {
  const eventId = document.getElementById("eventSelect").value;
  const msg = document.getElementById("eventMsg");
  if (!eventId) { msg.textContent = "イベントを選んでください"; return; }
  let password = "";
  try { password = sessionStorage.getItem("ksAdminPw") || ""; } catch (e) {}
  const pairs = [];
  document.querySelectorAll(".opp-select").forEach(sel => {
    const idx = sel.value === "" ? null : parseInt(sel.value, 10);
    if (idx == null) return;
    const o = OUR[parseInt(sel.dataset.idx, 10)];
    const t = THEIR[idx];
    pairs.push({ ourName: o.name, ourTag: o.tag, theirName: t.name, theirTag: t.tag });
  });
  this.disabled = true;
  msg.textContent = "保存中…";
  gasCall({ action: "matchupSave", password, eventId, opponentLabel: OPPONENT_LABEL, pairs }).then(res => {
    if (!res.ok) { msg.textContent = "保存できませんでした: " + (res.error || res.status); return; }
    msg.textContent = `保存しました（${pairs.length}人分）。カウントダウン表に反映されます`;
  }).catch(() => {
    msg.textContent = "通信エラーで保存できませんでした";
  }).then(() => { this.disabled = false; });
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
    # 元の並び順（うち側は上位N人の順、相手側は突合せ時点の総合順位の順）を保つための順番マップ
    our_order = {p["gid"]: i for i, p in enumerate(snapshot["ourRoster"])}
    their_order = {p["gid"]: i for i, p in enumerate(snapshot["theirRoster"])}

    print(f"  📡 うち鯖{our_kids} / 相手鯖{opponent_kids} の現在のスコアを取得します...")
    our_all = build_side(our_kids)
    their_all = build_side(opponent_kids)

    our_people = sorted((p for p in our_all if p["gid"] in our_gids), key=lambda p: our_order.get(p["gid"], 1 << 30))
    their_people = sorted((p for p in their_all if p["gid"] in their_gids), key=lambda p: their_order.get(p["gid"], 1 << 30))
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
