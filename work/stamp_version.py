# -*- coding: utf-8 -*-
"""
サイト内の全HTMLファイルの内部リンク（href="xxx.html"）に、実行時刻ベースの
キャッシュバスター（?v=YYYYMMDDHHMMSS）を自動付与・更新する。

GitHub PagesのCache-Control: max-age=600（10分）により、同じURLは最大10分間
古い内容がブラウザ/CDNにキャッシュされ得る。pushするたびに全リンクのバージョン値を
書き換えることで、URL自体が変わり、常に最新ページが即座に取得されるようにする。

使い方（commit・pushする直前に毎回実行する）:
  cd キングショットHTML
  python work/stamp_version.py

対象: FOLDER配下の全*.htmlファイル（admin/ を含む）
"""
import re
from pathlib import Path
from datetime import datetime

FOLDER = Path(__file__).resolve().parent.parent
EXCLUDE_DIRS = set()  # 管理者ページ（admin/）も含め、サイト内の全HTMLが対象

VERSION = datetime.now().strftime("%Y%m%d%H%M%S")

# href="xxx.html" / href="xxx.html?v=12345" のうち、外部URL・アンカー・mailtoを除いたものにマッチ
HREF_RE = re.compile(r'href="((?!https?:|mailto:|#)[^"]+?\.html)(\?v=\d+)?"')
# src="xxx.js" / src="xxx.js?v=12345" のうち、外部URLを除いたものにマッチ（admin-common.js・kvk-auth-gate.jsなど）
SRC_JS_RE = re.compile(r'src="((?!https?:)[^"]+?\.js)(\?v=\d+)?"')
# 検索エンジンに載せない（2026-11-07、URLを直接共有して使う運用のため）。GitHub Pagesのプロジェクトサイトでは
# robots.txt をドメイン直下に置けず効かないので、全HTMLの<head>に meta robots を入れる。既にあるページはそのまま
ROBOTS_TAG = '<meta name="robots" content="noindex, nofollow">'
ROBOTS_RE = re.compile(r"""<meta\s+name=["']robots["']""", re.I)
HEAD_RE = re.compile(r"<head[^>]*>", re.I)


def should_skip(path: Path) -> bool:
    try:
        rel_parts = path.relative_to(FOLDER).parts
    except ValueError:
        return True
    return rel_parts and rel_parts[0] in EXCLUDE_DIRS


def stamp_file(path: Path) -> int:
    text = path.read_text(encoding="utf-8")
    count = 0

    def repl(m):
        nonlocal count
        count += 1
        return f'href="{m.group(1)}?v={VERSION}"'

    def repl_js(m):
        nonlocal count
        count += 1
        return f'src="{m.group(1)}?v={VERSION}"'

    new_text = HREF_RE.sub(repl, text)
    new_text = SRC_JS_RE.sub(repl_js, new_text)
    if not ROBOTS_RE.search(new_text):
        m = HEAD_RE.search(new_text)
        if m:
            new_text = new_text[:m.end()] + "\n" + ROBOTS_TAG + new_text[m.end():]
            count += 1
    if new_text != text:
        path.write_text(new_text, encoding="utf-8")
    return count


def main():
    total_files = 0
    total_links = 0
    for path in FOLDER.rglob("*.html"):
        if should_skip(path):
            continue
        n = stamp_file(path)
        if n:
            total_files += 1
            total_links += n
            print(f"  {path.relative_to(FOLDER)} : {n}件")
    print(f"\nバージョン: {VERSION}")
    print(f"更新ファイル数: {total_files} / リンク書き換え数: {total_links}")


if __name__ == "__main__":
    main()
