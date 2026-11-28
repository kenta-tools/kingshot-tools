"""ギフトコードを取得して、新しいものを Discord のチャンネルに投稿する（Wispbyte の post_gifts.py の GitHub Actions 版）。
GitHub Actions（gift-codes.yml）から1時間ごとに実行する。

- kingshot.net の /api/gift-codes から、いま有効なコードを取得
- 投稿済みの id は .github/data/gift-codes/posted.json に記録する。
  無い（＝初回）のときは、いまあるコードを「投稿済み」にするだけで、投稿はしない（切り替えたとき、同じコードを二重に投稿しないため）。
  FIRST_POST=1 のときは、初回でも、いまあるコードを全部投稿する（Wispbyte と並べて動かして、動作を確かめるとき）
- 新しいコードだけを、コード本文のみのメッセージで投稿
- 毎日1回（日本時間の朝9時台）、「[稼働中]」を投稿（HEARTBEAT=1 のとき）
- DRY_RUN=1 のときは、Discord に何も送らず、送る予定の内容を表示するだけ（記録も更新しない）

Secrets（リポジトリの Settings → Secrets and variables → Actions）:
  GIFT_DISCORD_TOKEN : 投稿する bot のトークン（Wispbyte の .env の DISCORD_TOKEN と同じ bot）
  GIFT_CHANNEL_ID    : 投稿先チャンネルID（Wispbyte の .env の GIFT_CHANNEL_ID と同じ）
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

API_URL = "https://kingshot.net/api/gift-codes"
DISCORD = "https://discord.com/api/v10"
POSTED = Path(__file__).resolve().parents[1] / "data" / "gift-codes" / "posted.json"
DRY = os.environ.get("DRY_RUN") == "1"
HEARTBEAT = os.environ.get("HEARTBEAT") == "1"
FIRST_POST = os.environ.get("FIRST_POST") == "1"
UA = "KingshotGiftBot (https://kenta-tools.github.io/kingshot-tools/, 1.0)"


def http(url, method="GET", headers=None, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        text = r.read().decode()
        return json.loads(text) if text else None


def get_codes():
    return (http(API_URL) or {}).get("data", {}).get("giftCodes", [])


def post(message):
    if DRY:
        print("[DRY] 投稿予定:", message)
        return
    token = os.environ["GIFT_DISCORD_TOKEN"].strip()
    channel = os.environ["GIFT_CHANNEL_ID"].strip()
    http(f"{DISCORD}/channels/{channel}/messages", "POST",
         {"Authorization": "Bot " + token, "Content-Type": "application/json"}, {"content": message})


def main():
    codes = get_codes()
    first = not POSTED.exists()
    posted = set() if first else set(json.loads(POSTED.read_text(encoding="utf-8")))
    if first and not FIRST_POST:
        posted = {str(c["id"]) for c in codes}
        print(f"初回：{len(posted)}件を投稿済みとして記録（投稿はしません）")
    else:
        new = [c for c in codes if str(c["id"]) not in posted]
        for c in new:
            post(c["code"])
            posted.add(str(c["id"]))
        print(f"{len(new)}件投稿")
    if HEARTBEAT:
        now = datetime.now(timezone(timedelta(hours=9))).strftime("%Y/%m/%d %H:%M JST")
        post(f"[稼働中] KingshotBot is running ({now})")
    if not DRY:
        POSTED.parent.mkdir(parents=True, exist_ok=True)
        POSTED.write_text(json.dumps(sorted(posted, key=int)) + "\n", encoding="utf-8")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as e:
        print("エラー:", e.code, e.reason)
        sys.exit(1)
