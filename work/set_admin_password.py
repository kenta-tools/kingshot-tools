# -*- coding: utf-8 -*-
"""
管理者ページ（admin/members-admin.html）のログインパスワードを設定・変更する。

パスワード本体はどのファイルにも保存せず、SHA-256ハッシュ（SALT + パスワード）だけを
HTML内の ADMIN_HASH に書き込む。実行後に commit・push すると公開版に反映される。

使い方:
    python work/set_admin_password.py
"""
import getpass
import hashlib
import re
from pathlib import Path

FOLDER = Path(__file__).resolve().parent.parent
ADMIN_PAGES = [FOLDER / "admin" / "members-admin.html"]
SALT = "kingshot-admin:"


def main():
    pw = getpass.getpass("新しい管理者パスワード: ")
    if len(pw) < 6:
        print("6文字以上にしてください")
        return
    if pw != getpass.getpass("確認のためもう一度: "):
        print("一致しません")
        return

    digest = hashlib.sha256((SALT + pw).encode("utf-8")).hexdigest()
    for page in ADMIN_PAGES:
        text = page.read_text(encoding="utf-8")
        text, n = re.subn(r'var ADMIN_HASH = "[^"]*";', f'var ADMIN_HASH = "{digest}";', text, count=1)
        if n != 1:
            print("ADMIN_HASH が見つかりません:", page)
            continue
        page.write_text(text, encoding="utf-8")
        print("更新:", page)


if __name__ == "__main__":
    main()
