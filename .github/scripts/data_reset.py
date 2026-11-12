"""ユーザー・イベントにひもづくデータを全部消す（中継役 GAS の action=dataResetAll）。GitHub Actions（data-reset.yml）から手動で実行する。
- 消す前に、中継役が必ずドライブへバックアップ（members_backup_pre-reset_日時.json）を作る。作れなければ何も消さない。
- 確認用の文字列（CONFIRM）が「全部消す」と一致しないと、中継役が断る。
- ログ・Job Summary には、件数とバックアップのファイル名だけを出す（名前・IDは出さない）。
消すもの: users / events / entries / notSame / teams / kvkRosters / flameRosters / matchupPairs / kvkChatHistory / selfUndo / userImports / userImportPending
残すもの: inquiries（問い合わせ）。スクリプトプロパティ（パスワード・招待リンク等）・ブロックリスト・個人登録の記録（ログ）はデータファイルの外にあり、触らない。
環境変数: TARGET (test|prod) / CONFIRM / RELAY_PASSWORD（本番）/ RELAY_PASSWORD_TEST（test）
"""
import json
import os
import sys
import urllib.request

GAS = {
    "prod": "https://script.google.com/macros/s/AKfycbxu5HW9uLU9pCsUs1r_45xpuofWZmQAyZFDwSLK1C_7GvA7SDXZ4ayBEJTS0sR_8oToAw/exec",
    "test": "https://script.google.com/macros/s/AKfycbztnub9vRBiRHdL5Xea7hoThHWRzDSF9Www0eImUs8YlZQglMKNnMR90v6hD87hMlPk/exec",
}
TARGET = os.environ.get("TARGET", "test").strip()
CONFIRM = os.environ.get("CONFIRM", "")


def fail(msg):
    print("エラー: " + msg)
    sys.exit(1)


if TARGET not in GAS:
    fail("TARGET は test か prod です")
if CONFIRM != "全部消す":
    fail("確認用の文字列が「全部消す」と一致しないため、何もしませんでした")
pw = os.environ.get("RELAY_PASSWORD_TEST" if TARGET == "test" else "RELAY_PASSWORD", "")
if not pw:
    fail("%s用のパスワードのSecretが未設定です" % TARGET)

print("対象: %s。データを全部消します（先にバックアップを作ります）" % TARGET)
req = urllib.request.Request(GAS[TARGET], method="POST", headers={"Content-Type": "text/plain;charset=utf-8"},
                             data=json.dumps({"action": "dataResetAll", "password": pw, "confirm": CONFIRM}).encode())
try:
    with urllib.request.urlopen(req, timeout=180) as r:
        res = json.loads(r.read().decode())
except Exception as e:
    fail("中継役（GAS）と通信できませんでした: %s" % type(e).__name__)
if not res.get("ok"):
    fail("消せませんでした（何も消えていません）: %s" % res.get("error"))

removed = res.get("removed", {})
lines = ["## データの全リセット（%s）" % TARGET,
         "- バックアップ（Googleドライブ）: `%s`" % res.get("backup"),
         "- 消した件数: " + "／".join("%s %s" % (k, v) for k, v in removed.items() if k != "inquiries"),
         "- 残したもの: 問い合わせ %s 件（スクリプトプロパティ・ブロックリスト・ログも残っています）" % removed.get("inquiries", 0),
         "- 元に戻すとき: 中継役の action=dataRestore（backup にこのファイル名・confirm=復元する）"]
text = "\n".join(lines)
print(text)
path = os.environ.get("GITHUB_STEP_SUMMARY")
if path:
    with open(path, "a", encoding="utf-8") as f:
        f.write(text + "\n")
