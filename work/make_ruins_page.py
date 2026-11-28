# -*- coding: utf-8 -*-
"""遺跡争奪専用の参加登録ページ（ruins/index.html）と、同盟内（EGG）用の参加登録・チーム分け（test/egg/entry/, test/egg/teams/）を、通常の参加登録（entry/index.html）から作る。
中身は同じで、イベント一覧に遺跡争奪だけを出す指定（window.ENTRY_MODE = "ruins"）と見出しだけが違う。
entry/ と ruins/ は同じ深さなので相対パスは変わらない。TOP・サイドバー・各メニューには出さず、URLを直接案内する運用。
チーム分けの案内（teams の絞り込み）も、entry/ の「遺跡争奪以外」を ruins/ では「遺跡争奪だけ」に置き換える（2026-11-15〜。手直しではなく生成で作る）。
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
    # チーム分けの案内の絞り込み：entry/ は「遺跡争奪以外」、ruins/ は「遺跡争奪だけ」に反転する
    old_c = "// この登録ページは遺跡争奪以外のイベント用（遺跡争奪は専用の登録ページ ruins/ に出す）"
    new_c = "// この登録ページは遺跡争奪専用（それ以外のイベントのチーム分けは entry/ の登録ページに出す）"
    old_f = 't.type !== "遺跡争奪"; });'
    new_f = 't.type === "遺跡争奪"; });'
    if "typeVisible(t.type)" in s:
        pass  # test/ の entry/ は window.ENTRY_MODE で出し分ける（ruins なら遺跡争奪だけ）ので、絞り込みの反転は不要
    else:
        assert s.count(old_c) == 1 and s.count(old_f) == 1, "teams の絞り込み行が見つかりません（entry/index.html の該当行を直したら、このスクリプトも直してください）"
        s = s.replace(old_c, new_c, 1).replace(old_f, new_f, 1)
    dst.parent.mkdir(exist_ok=True)
    dst.write_text(s, encoding="utf-8")
    print("wrote", dst.relative_to(ROOT))


def make_egg(base: Path):
    """同盟内（EGG）用の参加登録・チーム分け（base/egg/entry/, base/egg/teams/）を、base/entry/ と base/teams/ から作る。
    window.ENTRY_MODE = "egg" を入れ、見出しを変え、1階層深くなる分の相対パス（config.js・画像）を直す。
    ../index.html（TOP）と ../teams/ はそのまま（egg/index.html＝EGGのTOP、egg/teams/ ＝EGG用チーム分けを指す）。"""
    for name, title_old, title_new, h1_old, h1_new in [
        ("entry", "<title>イベント参加登録</title>", "<title>EGG イベント参加登録</title>", "<h1>📝 イベント参加登録</h1>", "<h1>📝 EGG イベント参加登録</h1>"),
        ("teams", "<title>チーム分け</title>", "<title>EGG チーム分け</title>", "<h1>🧩 チーム分け</h1>", "<h1>🧩 EGG チーム分け</h1>"),
    ]:
        s = (base / name / "index.html").read_text(encoding="utf-8")
        a = '<script src="../config.js'
        assert s.count(a) == 1, name + ": config.js の読み込みが見つかりません"
        s = s.replace(a, '<script>window.ENTRY_MODE = "egg";</script>\n<script src="../../config.js', 1)
        assert s.count(title_old) == 1 and s.count(h1_old) == 1, name + ": 見出しが見つかりません"
        s = s.replace(title_old, title_new, 1).replace(h1_old, h1_new, 1)
        s = s.replace('class="top-link">← TOP</a>', 'class="top-link">← EGG TOP</a>')
        s = s.replace('src="img/', 'src="../../entry/img/')
        dst = base / "egg" / name / "index.html"
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(s, encoding="utf-8")
        print("wrote", dst.relative_to(ROOT))


make(ROOT / "entry" / "index.html", ROOT / "ruins" / "index.html")
if (ROOT / "test" / "entry" / "index.html").exists():
    make_egg(ROOT / "test")
    # test/ruins/ は egg/entry/ に統合した（遺跡争奪はEGG用の登録に含まれる）。旧URLは転送ページにする（本番の ruins/ は従来どおり生成）
    stub = "\n".join([
        '<!DOCTYPE html>',
        '<html lang="ja"><head><meta charset="UTF-8"><meta name="robots" content="noindex, nofollow">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>ページが移動しました</title>',
        '<meta http-equiv="refresh" content="0; url=../egg/entry/">',
        '<script>location.replace("../egg/entry/" + location.search + location.hash);</script></head>',
        '<body><p>ページが移動しました。<a href="../egg/entry/">新しいページ（EGG イベント参加登録）へ</a></p></body></html>', ""])
    (ROOT / "test" / "ruins" / "index.html").write_text(stub, encoding="utf-8")
    print("wrote test/ruins/index.html（転送ページ）")
