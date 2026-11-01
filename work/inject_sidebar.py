# -*- coding: utf-8 -*-
"""
キングショットHTMLフォルダ内の各HTMLファイルに、共通の左サイドバーメニューを注入する（レスポンシブ対応版）。
既存ページの内部CSS構造を触らず、<body>直後にサイドバーHTML＋共通スタイルを挿入するだけの安全な方式。
再実行しても二重挿入されないよう、既存のサイドバーマーカーを検知したら
その部分を置き換える。

レスポンシブ対応内容:
- viewport metaタグが無ければ<head>に追加
- サイドバーはPC幅(>760px)では左固定、モバイル幅(<=760px)では上部の横スクロールバーに変形
- テーブル・.card/.panel/.result-wrapはモバイル幅で横スクロール可能にする安全策を追加
"""
import re
from pathlib import Path

FOLDER = Path(__file__).resolve().parent.parent

TOOLS = [
    ("index.html", "🏠", "メニュー"),
    ("炎龍の覇者_攻城タイムライン計算.html", "🐉", "炎龍 集結タイムライン計算"),
    ("王城到着同期カウントアップ.html", "⏱️", "KvK同着スタート カウントアップ表"),
    ("KvK同着スタート カウントダウン表.html", "⏲️", "KvK同着スタート カウントダウン表"),
    ("KvK占領判定.html", "🏳️", "KvK占領戦 勝利判定ツール"),
    ("周期ウェーブタイマー.html", "🌊", "周期ウェーブタイマー"),
    ("音声アナウンス付きストップウォッチ.html", "🔊", "音声ストップウォッチ（工事中）"),
]

MARK_START = "<!-- ks-sidebar:start -->"
MARK_END = "<!-- ks-sidebar:end -->"

VIEWPORT_TAG = '<meta name="viewport" content="width=device-width, initial-scale=1.0">'


def build_sidebar(current_file):
    links = []
    for fname, icon, label in TOOLS:
        active = fname == current_file
        cls = "ks-link ks-active" if active else "ks-link"
        links.append(
            f'<a href="{fname}" class="{cls}" title="{label}">'
            f'<span class="ks-icon">{icon}</span><span class="ks-label">{label}</span></a>'
        )

    sidebar = f'''{MARK_START}
<style>
  .ks-sidebar {{
    position: fixed; top: 0; left: 0; width: 220px; height: 100vh;
    background: #1a2332; padding: 20px 14px; box-sizing: border-box;
    overflow-y: auto; overflow-x: hidden;
    font-family: 'Segoe UI','Hiragino Kaku Gothic ProN',Meiryo,sans-serif;
    z-index: 99999;
    transition: width 0.2s ease;
  }}
  .ks-title-row {{ display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }}
  .ks-sidebar .ks-title {{ color: #fff; font-weight: bold; font-size: 14px; white-space: nowrap; flex: 1; overflow: hidden; }}
  .ks-toggle-btn {{
    background: transparent; border: 1px solid #3a4a63; color: #c7d0dd; border-radius: 5px;
    width: 24px; height: 24px; font-size: 13px; line-height: 1; cursor: pointer; flex: 0 0 auto;
  }}
  .ks-toggle-btn:hover {{ background: #2a374d; }}
  .ks-sidebar nav {{ display: flex; flex-direction: column; }}
  .ks-sidebar .ks-link {{
    display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; border-radius: 6px; margin-bottom: 2px;
    text-decoration: none; font-size: 12px; line-height: 1.35; color: #c7d0dd;
  }}
  .ks-sidebar .ks-link .ks-icon {{ flex: 0 0 auto; width: 18px; text-align: center; margin-top: 1px; }}
  .ks-sidebar .ks-link .ks-label {{ white-space: normal; overflow-wrap: break-word; }}
  .ks-sidebar .ks-link.ks-active {{ background: #3a4a63; color: #fff; font-weight: bold; }}

  .ks-open-btn {{
    display: none; position: fixed; top: 14px; left: 14px; z-index: 100001;
    width: 34px; height: 34px; border-radius: 8px; border: none;
    background: #1a2332; color: #fff; font-size: 16px; cursor: pointer;
    align-items: center; justify-content: center;
    box-shadow: 0 1px 4px rgba(0,0,0,0.25);
  }}

  body {{ margin-left: 240px !important; transition: margin-left 0.2s ease; }}

  /* --- 折りたたみ：デスクトップではアイコンだけの細いレールにする --- */
  body.ks-collapsed .ks-sidebar {{ width: 56px; padding-left: 8px; padding-right: 8px; }}
  body.ks-collapsed .ks-sidebar .ks-title {{ display: none; }}
  body.ks-collapsed .ks-title-row {{ justify-content: center; }}
  body.ks-collapsed .ks-sidebar .ks-label {{ display: none; }}
  body.ks-collapsed .ks-sidebar .ks-link {{ justify-content: center; padding: 8px 0; }}
  body.ks-collapsed {{ margin-left: 76px !important; }}

  /* --- モバイル対応：サイドバーを上部の横スクロールバーに変形 --- */
  @media (max-width: 760px) {{
    .ks-sidebar {{
      width: 100% !important; height: auto; max-height: none; top: 0; left: 0;
      padding: 8px 10px !important; overflow-y: hidden;
      display: flex; align-items: center; gap: 8px;
      transition: transform 0.2s ease;
    }}
    .ks-title-row {{ margin-bottom: 0; }}
    .ks-sidebar .ks-title {{ font-size: 12px; flex: 0 0 auto; }}
    .ks-sidebar nav {{
      flex-direction: row; flex-wrap: nowrap; overflow-x: auto;
      -webkit-overflow-scrolling: touch; gap: 4px;
    }}
    .ks-sidebar .ks-link {{
      flex: 0 0 auto; white-space: nowrap; margin-bottom: 0;
      padding: 6px 10px; font-size: 12px;
    }}
    .ks-sidebar .ks-label {{ display: inline !important; }}
    body {{ margin-left: 0 !important; padding-top: 56px !important; }}
    body.ks-collapsed .ks-sidebar {{ transform: translateY(-100%); width: 100% !important; }}
    body.ks-collapsed {{ margin-left: 0 !important; padding-top: 0 !important; }}
    body.ks-collapsed .ks-open-btn {{ display: flex; }}
    .ks-open-btn {{ top: 8px; left: 8px; }}
  }}

  /* --- テーブル等の横はみ出し対策（モバイル幅のみ） --- */
  @media (max-width: 760px) {{
    table {{ display: block; overflow-x: auto; max-width: 100%; -webkit-overflow-scrolling: touch; }}
    .card, .panel, .result-wrap {{ overflow-x: auto; }}
    img, pre, textarea {{ max-width: 100%; }}
  }}
</style>
<div class="ks-sidebar">
  <div class="ks-title-row">
    <span class="ks-title">⚔️ キングショット</span>
    <button type="button" class="ks-toggle-btn" id="ksToggleBtn" onclick="ksToggleSidebar()" aria-label="メニュー開閉">←</button>
  </div>
  <nav>
    {''.join(links)}
  </nav>
</div>
<button type="button" class="ks-open-btn" onclick="ksToggleSidebar()" aria-label="メニューを開く">☰</button>
<script>
(function() {{
  var collapsed = false;
  try {{ collapsed = localStorage.getItem("ksSidebarCollapsed") === "1"; }} catch (e) {{}}
  function applyBtn() {{
    var btn = document.getElementById("ksToggleBtn");
    if (btn) btn.textContent = document.body.classList.contains("ks-collapsed") ? "→" : "←";
  }}
  if (collapsed) document.body.classList.add("ks-collapsed");
  document.addEventListener("DOMContentLoaded", applyBtn);
  applyBtn();
  window.ksToggleSidebar = function() {{
    var next = !document.body.classList.contains("ks-collapsed");
    document.body.classList.toggle("ks-collapsed", next);
    try {{ localStorage.setItem("ksSidebarCollapsed", next ? "1" : "0"); }} catch (e) {{}}
    applyBtn();
  }};
}})();
</script>
{MARK_END}'''
    return sidebar


def ensure_viewport(text: str) -> str:
    if 'name="viewport"' in text or "name='viewport'" in text:
        return text
    return re.sub(r"(<head[^>]*>)", lambda m: m.group(1) + "\n" + VIEWPORT_TAG, text, count=1)


def inject(path: Path):
    text = path.read_text(encoding="utf-8")
    fname = path.name

    if fname not in {t[0] for t in TOOLS}:
        return False

    text = ensure_viewport(text)
    sidebar = build_sidebar(fname)

    if MARK_START in text:
        text = re.sub(
            re.escape(MARK_START) + r".*?" + re.escape(MARK_END),
            sidebar,
            text,
            flags=re.DOTALL,
        )
    else:
        text = re.sub(
            r"(<body[^>]*>)",
            lambda m: m.group(1) + "\n" + sidebar + "\n",
            text,
            count=1,
        )

    path.write_text(text, encoding="utf-8")
    return True


def main():
    done = []
    for fname, _, _ in TOOLS:
        p = FOLDER / fname
        if p.exists():
            if inject(p):
                done.append(fname)
        else:
            print("NOT FOUND:", fname)
    print("injected:", len(done))
    for d in done:
        print(" -", d)


if __name__ == "__main__":
    main()
