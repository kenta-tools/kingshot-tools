# -*- coding: utf-8 -*-
"""
【2026-11-12 方針変更】キャッシュ対策のバージョンスタンプ（?v=YYYYMMDDHHMMSS）は廃止しました。

以前は、pushのたびに全リンクへ ?v=時刻 を付け直して、GitHub Pagesのキャッシュ（max-age=600＝10分）を避けていましたが、
ユーザー判断で「キャッシュクリアの対応は不要」になりました（ブックマークや共有URLに古い ?v= が残るのを避けるため）。
ページの内容は、サーバーが ?v= を見ずに最新のファイルを返すので、最大でも約10分で最新になります。

このスクリプトは、名前を変えずに、次の2つだけを行うようにしました（pushの前に実行しても害はありません）:
 1) 残っている ?v=14桁の数字 を、HTML/JSから取り除く
 2) 全HTMLの<head>に <meta name="robots" content="noindex, nofollow"> があるか確認し、無ければ入れる
   （検索エンジンに載せない運用。GitHub Pagesのプロジェクトサイトでは robots.txt が効かないため）

使い方（必要なときだけ）:
  cd キングショットHTML
  python work/stamp_version.py
"""
import re
from pathlib import Path

FOLDER = Path(__file__).resolve().parent.parent

STAMP_RE = re.compile(r"\?v=\d{14}")
ROBOTS_TAG = '<meta name="robots" content="noindex, nofollow">'
ROBOTS_RE = re.compile(r"""<meta\s+name=["']robots["']""", re.I)
HEAD_RE = re.compile(r"<head[^>]*>", re.I)
SKIP_DIRS = {".git", ".github", "backup", "worktrees"}


def should_skip(path: Path) -> bool:
    try:
        parts = path.relative_to(FOLDER).parts
    except ValueError:
        return True
    return bool(parts) and parts[0] in SKIP_DIRS


def clean_file(path: Path) -> int:
    try:
        raw = path.read_bytes().decode("utf-8")
    except UnicodeDecodeError:
        return 0
    count = 0
    new_text, n = STAMP_RE.subn("", raw)
    count += n
    if path.suffix.lower() == ".html" and not ROBOTS_RE.search(new_text):
        m = HEAD_RE.search(new_text)
        if m:
            new_text = new_text[:m.end()] + "\n" + ROBOTS_TAG + new_text[m.end():]
            count += 1
    if new_text != raw:
        path.write_bytes(new_text.encode("utf-8"))
    return count


def main():
    files = 0
    changes = 0
    for pattern in ("*.html", "*.js"):
        for path in FOLDER.rglob(pattern):
            if should_skip(path):
                continue
            n = clean_file(path)
            if n:
                files += 1
                changes += n
                print(f"  {path.relative_to(FOLDER)} : {n}件")
    print(f"\n更新ファイル数: {files} / 変更数: {changes}")


if __name__ == "__main__":
    main()
