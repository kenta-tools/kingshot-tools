# -*- coding: utf-8 -*-
"""遺跡争奪専用の参加登録ページ（ruins/index.html）を、通常の参加登録（entry/index.html）から作る。
中身は同じで、イベント一覧に遺跡争奪だけを出す指定（window.ENTRY_MODE = "ruins"）と見出しだけが違う。
entry/ と ruins/ は同じ深さなので相対パスは変わらない。TOP・サイドバー・各メニューには出さず、URLを直接案内する運用。
entry/index.html を直したら、このスクリプトを実行して ruins/index.html（と test/ruins/）を作り直す。
使い方: python work/make_ruins_page.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def make(src: Path, dst: Path):
    s = src.read_text(encoding="utf-8")
    a = '<script src="../config.js'
    assert s.count(a) == 1, "config.js の読み込みが見つかりません"
    s = s.replace(a, '<script>window.ENTRY_MODE = "ruins";</script>\n' + a, 1)
    s = s.replace("<title>イベント参加登録</title>", "<title>遺跡争奪 参加登録</title>", 1)
    s = s.replace("<h1>📝 イベント参加登録</h1>", "<h1>🏛️ 遺跡争奪 参加登録</h1>", 1)
    dst.parent.mkdir(exist_ok=True)
    dst.write_text(s, encoding="utf-8")
    print("wrote", dst.relative_to(ROOT))


make(ROOT / "entry" / "index.html", ROOT / "ruins" / "index.html")
if (ROOT / "test" / "entry" / "index.html").exists():
    make(ROOT / "test" / "entry" / "index.html", ROOT / "test" / "ruins" / "index.html")
