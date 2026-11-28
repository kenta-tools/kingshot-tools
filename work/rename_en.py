# -*- coding: utf-8 -*-
"""手で管理している日本語名のツールページを、英語名に改名する（2026-11-15。公開サイトのファイル名は英語＝半角の英小文字・数字・ハイフン）。
やること: ①git mv（tools/ と test/tools/）②リンクの置き換え（下の REPLACE_IN）③旧い日本語名のパスに「新しいページへ自動で移る」小さなページを残す。
サイドバーは work/inject_sidebar.py（--root test も可）で再生成する。再実行しても二重に壊れないようにしてある。"""
import subprocess
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAP = {
    "KvK同着スタート カウントダウン表": "kvk-countdown",
    "KvKストップウォッチ": "stopwatch",
    "黄金計算機": "gold-calculator",
    "KvK占領判定": "kvk-occupation",
    "周期ウェーブタイマー": "wave-timer",
    "炎龍の覇者_攻城タイムライン計算": "flame-dragon-timeline",
    "王城到着同期カウントアップ": "castle-sync-countup",
    "音声アナウンス付きストップウォッチ": "voice-stopwatch",
}
# リンクを書き換えるファイル（履歴の記録 WORK_STATUS.md・過去の確認ログ work/_*.txt は書き換えない）
REPLACE_IN = ["spec/spec.md", "test/spec/spec.md", "tools/tools-index.html", "test/tools/tools-index.html", "index.html", "test/index.html",
              "work/inject_sidebar.py", "work/smoke_pages.mjs", "work/promote_test_to_prod.py", "work/simulate_siege_calc.py"]

STUB = """<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>ページが移動しました</title>
<meta http-equiv="refresh" content="0; url={new}">
<script>location.replace("{new}" + location.search + location.hash);</script>
<style>body{{font-family:"Segoe UI","Hiragino Kaku Gothic ProN",Meiryo,sans-serif;background:#f4f5f7;color:#222;padding:40px 16px;text-align:center;}}a{{color:#2c5cc5;}}</style>
</head>
<body>
<h1 style="font-size:20px;">ページが移動しました</h1>
<p>新しいページに自動で移動します。移動しないときは、こちらのリンクを押してください：</p>
<p><a href="{new}">{new}</a></p>
<p style="font-size:12px;color:#777;">ブックマークは新しいURLに更新してください。</p>
</body>
</html>
"""


def variants(old):
    return {old + ".html", urllib.parse.quote(old + ".html"), urllib.parse.quote(old) + ".html", old.replace(" ", "%20") + ".html"}


def git(*a):
    subprocess.check_call(["git", "-c", "core.quotepath=false"] + list(a), cwd=ROOT)


def main():
    # ①改名
    for base in ["tools", "test/tools"]:
        for old, new in MAP.items():
            src = ROOT / base / (old + ".html")
            dst = ROOT / base / (new + ".html")
            if src.exists() and not dst.exists():
                git("mv", str(src.relative_to(ROOT)), str(dst.relative_to(ROOT)))
                print("改名", base, old, "→", new)
    # ②リンクの置き換え
    for rel in REPLACE_IN:
        p = ROOT / rel
        if not p.exists():
            continue
        raw = p.read_bytes().decode("utf-8")
        t = raw
        for old, new in MAP.items():
            for v in sorted(variants(old), key=len, reverse=True):
                t = t.replace(v, new + ".html")
        if t != raw:
            p.write_bytes(t.encode("utf-8"))
            print("リンク更新", rel)
    # ③旧い名前の転送ページ
    for base in ["tools", "test/tools"]:
        for old, new in MAP.items():
            if not (ROOT / base / (new + ".html")).exists():
                continue
            stub = ROOT / base / (old + ".html")
            text = STUB.format(new=new + ".html").replace("\n", "\r\n")
            stub.write_bytes(text.encode("utf-8"))
            print("転送ページ", base + "/" + old + ".html", "→", new + ".html")


if __name__ == "__main__":
    main()
