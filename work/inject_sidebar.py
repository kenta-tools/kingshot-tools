# -*- coding: utf-8 -*-
"""
キングショットHTMLフォルダ内の各HTMLファイルに、共通の左サイドバーメニューを注入する（レスポンシブ対応版）。
既存ページの内部CSS構造を触らず、<body>直後にサイドバーHTML＋共通スタイルを挿入するだけの安全な方式。
再実行しても二重挿入されないよう、既存のサイドバーマーカーを検知したら
その部分を置き換える。

フォルダ分け対応（2026-11-01）:
- TOOLSの各エントリはリポジトリルートからの相対パス（例: "tools/周期ウェーブタイマー.html"）
- 各ページから他ページへのリンクは、そのページ自身のフォルダ位置を基準に
  相対パスを計算する（posixpath.relpathで "../" 等を自動算出）

レスポンシブ対応内容:
- viewport metaタグが無ければ<head>に追加
- サイドバーはPC幅(>760px)では左固定、モバイル幅(<=760px)では上部の横スクロールバーに変形
- テーブル・.card/.panel/.result-wrapはモバイル幅で横スクロール可能にする安全策を追加
"""
import posixpath
import re
from pathlib import Path

FOLDER = Path(__file__).resolve().parent.parent

# tools / flame-dragon / holy-sword-league は互いに独立したカテゴリとして扱う。
# カテゴリ間の行き来はTOP（index.html）のカード選択のみで行う。
# サイドバー（固定メニュー）があるのはtools配下のページだけ。
# index.html（TOP）・flame-dragon-index.html・holy-sword-league-index.htmlは
# サイドバーなし、ページ内に軽い「← TOP」リンクを直書きする方式（inject対象外）。
HOME = ("index.html", "🏠", "TOP")

# ツール内のメニュー（レフトメニュー・tools-index.htmlのカード一覧）は、イベントごとにブロック分けする。
NAV_EVENT_GROUPS = [
    ("炎龍の覇者", [
        ("tools/炎龍の覇者_攻城タイムライン計算.html", "🐉", "炎龍 集結タイムライン計算"),
        ("tools/周期ウェーブタイマー.html", "🌊", "周期ウェーブタイマー"),
    ]),
    ("KvK", [
        ("tools/KvK同着スタート カウントダウン表.html", "⏲️", "KvK同着スタート カウントダウン表"),
        ("tools/KvK占領判定.html", "🏳️", "KvK占領戦 勝利判定ツール"),
        ("tools/KvKストップウォッチ.html", "⏱️", "ストップウォッチ（メモ付き）"),
    ]),
]
# 非表示中（2026-11-01、ユーザー指示でいったん非表示。ファイルは残したまま一覧・サイドバーから外す）:
#   tools/王城到着同期カウントアップ.html
#   tools/音声アナウンス付きストップウォッチ.html
# KvK相手突合せ（kvk-matchup/）は2026-11-02、ユーザー指示で管理画面（admin/）の中に完全に移動し、
# 認証必須にした。公開のtools一覧・レフトメニューからは外し、admin/配下（管理画面）からのみ辿れるようにする。

NAV_TOOLS = [HOME] + [item for _, items in NAV_EVENT_GROUPS for item in items]

# kvk-matchup/は2026-11-02にadmin配下の認証必須機能へ移したため、公開の共通サイドバーは注入しない
# （admin/配下のログイン画面を経由しないと辿り着けないようにする）。

PAGE_GROUPS = [
    (
        [rel_path for rel_path, _, _ in NAV_TOOLS if rel_path.startswith("tools/")]
        + ["tools/tools-index.html"],
        NAV_EVENT_GROUPS,
    ),
]

MARK_START = "<!-- ks-sidebar:start -->"
MARK_END = "<!-- ks-sidebar:end -->"

VIEWPORT_TAG = '<meta name="viewport" content="width=device-width, initial-scale=1.0">'


def rel_href(from_rel_path: str, to_rel_path: str) -> str:
    """from_rel_path のページから見た to_rel_path への相対リンクを計算する"""
    from_dir = posixpath.dirname(from_rel_path) or "."
    href = posixpath.relpath(to_rel_path, start=from_dir)
    return href


def build_sidebar(current_rel_path, event_groups):
    def link_html(rel_path, icon, label):
        active = rel_path == current_rel_path
        cls = "ks-link ks-active" if active else "ks-link"
        href = rel_href(current_rel_path, rel_path)
        return (
            f'<a href="{href}" class="{cls}" title="{label}">'
            f'<span class="ks-icon">{icon}</span><span class="ks-label">{label}</span></a>'
        )

    links = [link_html(*HOME)]
    for event_name, items in event_groups:
        links.append(f'<div class="ks-group">{event_name}</div>')
        links.extend(link_html(*item) for item in items)

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
  .ks-sidebar .ks-group {{
    color: #6b7993; font-size: 10px; font-weight: bold; letter-spacing: 0.05em;
    text-transform: uppercase; padding: 10px 10px 4px; white-space: nowrap;
  }}
  .ks-sidebar .ks-group:first-of-type {{ padding-top: 0; }}
  body.ks-collapsed .ks-sidebar .ks-group {{ display: none; }}

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

  /* --- モバイル対応：上部に固定バー（右上の☰で下にメニューを開く）。PCの折りたたみ状態は無視 --- */
  .ks-menu-btn {{ display: none; }}
  @media (max-width: 760px) {{
    .ks-sidebar, body.ks-collapsed .ks-sidebar {{ width: 100% !important; height: 48px; padding: 0 12px !important; overflow: visible; }}
    .ks-title-row, body.ks-collapsed .ks-title-row {{ height: 48px; margin-bottom: 0; justify-content: flex-start; }}
    .ks-sidebar .ks-title, body.ks-collapsed .ks-sidebar .ks-title {{ display: block; font-size: 14px; }}
    .ks-toggle-btn, .ks-open-btn, body.ks-collapsed .ks-open-btn {{ display: none !important; }}
    .ks-menu-btn {{
      display: flex; margin-left: auto; flex: 0 0 auto; width: 40px; height: 34px; border-radius: 6px;
      border: 1px solid #3a4a63; background: transparent; color: #fff; font-size: 18px; line-height: 1;
      cursor: pointer; align-items: center; justify-content: center;
    }}
    .ks-sidebar nav {{
      display: none; position: absolute; top: 48px; left: 0; right: 0; max-height: calc(100vh - 48px);
      overflow-y: auto; background: #1a2332; padding: 6px 10px 12px; box-sizing: border-box;
      box-shadow: 0 8px 18px rgba(0,0,0,0.35);
    }}
    body.ks-menu-open .ks-sidebar nav {{ display: flex; }}
    .ks-sidebar .ks-link, body.ks-collapsed .ks-sidebar .ks-link {{ justify-content: flex-start; padding: 10px; font-size: 14px; }}
    .ks-sidebar .ks-label, body.ks-collapsed .ks-sidebar .ks-label {{ display: inline; }}
    .ks-sidebar .ks-group, body.ks-collapsed .ks-sidebar .ks-group {{ display: block; }}
    body, body.ks-collapsed {{ margin-left: 0 !important; padding-top: 56px !important; }}
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
    <button type="button" class="ks-menu-btn" aria-label="メニュー" aria-expanded="false">☰</button>
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
  // スマホ幅のメニュー：☰で開閉。開いているときにメニューの外をタップしたら閉じ、そのタップは下の画面に通さない
  function setMenuOpen(open) {{
    document.body.classList.toggle("ks-menu-open", open);
    document.querySelectorAll(".ks-menu-btn").forEach(function(b) {{
      b.textContent = open ? "✕" : "☰";
      b.setAttribute("aria-expanded", open ? "true" : "false");
    }});
  }}
  function outsideMenu(t) {{
    return document.body.classList.contains("ks-menu-open") && !(t.closest && (t.closest(".ks-sidebar nav") || t.closest(".ks-menu-btn")));
  }}
  window.addEventListener("mousedown", function(e) {{ if (outsideMenu(e.target)) e.preventDefault(); }}, true);
  window.addEventListener("click", function(e) {{
    if (e.target.closest && e.target.closest(".ks-menu-btn")) {{ setMenuOpen(!document.body.classList.contains("ks-menu-open")); return; }}
    if (outsideMenu(e.target)) {{ e.preventDefault(); e.stopPropagation(); setMenuOpen(false); }}
  }}, true);
}})();
</script>
{MARK_END}'''
    return sidebar


def ensure_viewport(text: str) -> str:
    if 'name="viewport"' in text or "name='viewport'" in text:
        return text
    return re.sub(r"(<head[^>]*>)", lambda m: m.group(1) + "\n" + VIEWPORT_TAG, text, count=1)


def inject(path: Path, rel_path: str, nav_items):
    text = path.read_text(encoding="utf-8")

    text = ensure_viewport(text)
    sidebar = build_sidebar(rel_path, nav_items)

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
    # index.html（TOPページ）自体にはサイドバーを出さない（3カード選択がナビの役割を兼ねるため）。
    for rel_paths, nav_items in PAGE_GROUPS:
        for rel_path in rel_paths:
            p = FOLDER / rel_path
            if p.exists():
                if inject(p, rel_path, nav_items):
                    done.append(rel_path)
            else:
                print("NOT FOUND:", rel_path)
    print("injected:", len(done))
    for d in done:
        print(" -", d)


if __name__ == "__main__":
    main()
