"""Discord の招待リンクを作り直して、中継役（GAS）に送る。GitHub Actions（discord-invite.yml）から毎朝実行する。

- このチャンネルに7日間有効の招待リンクを新しく作る
- bot が前に作った古い招待リンクは消す（有効なリンクを1つにするため。人が作ったリンクは消さない）
- 新しいリンクを中継役の action=setDiscordInvite で保存する → 個人登録ページの「Discordに参加する」ボタンに出る

GitHub のリポジトリの Secrets（Settings → Secrets and variables → Actions）に入れておくもの:
  DISCORD_BOT_TOKEN  : bot のトークン（「招待を作成」「チャンネルの管理」の権限でサーバーに追加済み）
  DISCORD_CHANNEL_ID : 招待先のチャンネルID
  RELAY_PASSWORD     : 管理画面のログインパスワード（中継役の EDIT_PASSWORD）
"""
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://discord.com/api/v10"
RELAY_URL = "https://script.google.com/macros/s/AKfycbxu5HW9uLU9pCsUs1r_45xpuofWZmQAyZFDwSLK1C_7GvA7SDXZ4ayBEJTS0sR_8oToAw/exec"
INVITE_DAYS = 7  # 古いリンクを消せなかったときの保険

TOKEN = os.environ["DISCORD_BOT_TOKEN"].strip()
CHANNEL = os.environ["DISCORD_CHANNEL_ID"].strip()
PASSWORD = os.environ["RELAY_PASSWORD"]
HEADERS = {
    "Authorization": "Bot " + TOKEN,
    "User-Agent": "DiscordBot (https://kenta-tools.github.io/kingshot-tools/, 1.0)",
    "Content-Type": "application/json",
}


def discord(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, headers=HEADERS,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            text = r.read().decode()
            return r.status, json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]


status, inv = discord("POST", "/channels/%s/invites" % CHANNEL,
                      {"max_age": INVITE_DAYS * 86400, "max_uses": 0, "temporary": False, "unique": True})
if status not in (200, 201):
    print("招待リンクを作れませんでした（%s）: %s" % (status, inv))
    print("401=トークン違い、403=bot に「招待を作成」の権限がない／チャンネルが見えない、404=チャンネルIDが違う")
    sys.exit(1)
code = inv["code"]
url = "https://discord.gg/" + code
print("招待リンクを作りました:", url)

# 中継役に保存（個人登録ページに出す）
req = urllib.request.Request(RELAY_URL, method="POST", headers={"Content-Type": "text/plain;charset=utf-8"},
                             data=json.dumps({"action": "setDiscordInvite", "password": PASSWORD, "invite": url}).encode())
with urllib.request.urlopen(req, timeout=60) as r:
    res = json.loads(r.read().decode())
if not res.get("ok"):
    print("中継役に保存できませんでした:", res.get("error"))
    sys.exit(1)
print("中継役に保存しました")

# bot が前に作った古いリンクを消す（失敗しても新しいリンクはそのまま使える）
_, me = discord("GET", "/users/@me")
status, invites = discord("GET", "/channels/%s/invites" % CHANNEL)
if status != 200:
    print("古いリンクの一覧を取れませんでした（%s。bot に「チャンネルの管理」権限がないかも）" % status)
    sys.exit(0)
for old in invites:
    if old["code"] == code or (old.get("inviter") or {}).get("id") != me["id"]:
        continue
    s, _ = discord("DELETE", "/invites/" + old["code"])
    print(("古いリンクを消しました: " if s in (200, 204, 404) else "古いリンクを消せませんでした（%s）: " % s) + old["code"])
