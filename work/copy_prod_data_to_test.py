# -*- coding: utf-8 -*-
"""
本番のデータ（中継役GASが管理するGoogleドライブの非公開JSON）を、
テスト環境（test/config.js が指す中継役GAS）のデータにまるごと上書きコピーする。

パスワードはこのファイルやコマンド履歴に残さないよう、環境変数から読む。
  PowerShellの例:
    $env:PROD_PASSWORD = "（本番の管理者パスワード）"
    $env:TEST_PASSWORD = "（テスト環境のパスワード。デフォルトはeggtest）"
    python work/copy_prod_data_to_test.py

テスト環境のURLは test/config.js から自動で読み取るので、
テスト環境を作り直してURLが変わっても、このファイルを直す必要はない。
"""
import os
import re
import json
import time
import urllib.request

PROD_GAS_URL = "https://script.google.com/macros/s/AKfycbxu5HW9uLU9pCsUs1r_45xpuofWZmQAyZFDwSLK1C_7GvA7SDXZ4ayBEJTS0sR_8oToAw/exec"
SITE_DIR = os.path.join(os.path.dirname(__file__), "..")


def read_test_gas_url():
    path = os.path.join(SITE_DIR, "test", "config.js")
    text = open(path, encoding="utf-8").read()
    m = re.search(r'GAS_URL\s*=\s*"([^"]+)"', text)
    if not m:
        raise RuntimeError(f"{path} から GAS_URL を読み取れませんでした")
    return m.group(1)


def gas_call(url, payload, timeout=30):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "text/plain;charset=utf-8"},
        method="POST",
    )
    # GASのウェブアプリは302でscript.googleusercontent.comにリダイレクトする。urllibは自動で追従する。
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def main():
    prod_password = os.environ.get("PROD_PASSWORD")
    test_password = os.environ.get("TEST_PASSWORD", "eggtest")
    if not prod_password:
        print("❌ 環境変数 PROD_PASSWORD が設定されていません（本番の管理者パスワード）")
        return

    test_url = read_test_gas_url()
    print(f"テスト環境URL: {test_url}")

    print("📥 本番のデータを取得中...")
    prod_res = gas_call(PROD_GAS_URL, {"action": "get", "password": prod_password})
    if not prod_res.get("ok"):
        print(f"❌ 本番からの取得に失敗: {prod_res}")
        return
    content = prod_res["content"]
    data = json.loads(__import__("base64").b64decode(content).decode("utf-8"))
    print(f"   取得OK（users={len(data.get('users', []))}人 / events={len(data.get('events', []))}件 / entries={len(data.get('entries', []))}件）")

    print("📤 テスト環境の現在のバージョンを確認中...")
    test_res = gas_call(test_url, {"action": "get", "password": test_password})
    if not test_res.get("ok"):
        print(f"❌ テスト環境からの取得に失敗: {test_res}")
        return
    test_sha = test_res["sha"]

    if not input(f"テスト環境の今のデータを、本番の内容で上書きします。よろしいですか？ (y/N): ").lower().startswith("y"):
        print("中止しました。")
        return

    print("💾 テスト環境へ書き込み中...")
    put_res = gas_call(test_url, {"action": "put", "password": test_password, "content": content, "sha": test_sha})
    if not put_res.get("ok"):
        print(f"❌ テスト環境への書き込みに失敗: {put_res}")
        return
    print("✅ コピー完了。テスト環境は本番と同じデータになりました。")


if __name__ == "__main__":
    main()
