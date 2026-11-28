"""816鯖のプレイヤー一覧を MightPulse API から集めて、中継役（GAS）の「取り込み待ち」に送り、照合（preview）または登録（commit）を行う。
GitHub Actions（user-import-816.yml）から手動で実行する。1回限りの取り込み用（2026-11-12）。

大事な決まり（リポジトリは公開）:
- 取得したプレイヤーの名前・ゲーム内ID は、ログ・artifacts・リポジトリに一切出さない。出すのは人数などの集計だけ。
- 名前・IDの詳細は、中継役（GAS）の非公開データにだけ置く。管理画面の admin/user-import.html で管理者だけが見られる。

環境変数（Secrets は workflow から渡される。値はここでは扱わない・表示しない）:
  TARGET (test|prod) / TOP_N / INCLUDE_NO_ALLIANCE (true|false) / COMMIT (true|false) / DRY_RUN (true|false)
  MIGHTPULSE_API_KEY（DRY_RUN=false のときだけ必要）
  RELAY_PASSWORD（本番GAS用）/ RELAY_PASSWORD_TEST（testのGAS用）
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

API = "https://api.mightpulse.com/v1"
KID = 816
GAS = {
    "prod": "https://script.google.com/macros/s/AKfycbxu5HW9uLU9pCsUs1r_45xpuofWZmQAyZFDwSLK1C_7GvA7SDXZ4ayBEJTS0sR_8oToAw/exec",
    "test": "https://script.google.com/macros/s/AKfycbztnub9vRBiRHdL5Xea7hoThHWRzDSF9Www0eImUs8YlZQglMKNnMR90v6hD87hMlPk/exec",
}
KEEP_ROWS = 600          # GASに送る人数（総力の大きい順）。取り込み画面で上位N人に絞る
MIN_INTERVAL = 1.15      # 1キー60回/分の制限を守る（聖剣リーグの自動更新と同じキーなので9:00〜10:00 JSTは避ける）

TARGET = os.environ.get("TARGET", "test").strip()
TOP_N = int(os.environ.get("TOP_N", "100") or 100)
INCLUDE_NO_ALLIANCE = os.environ.get("INCLUDE_NO_ALLIANCE", "false").lower() == "true"
COMMIT = os.environ.get("COMMIT", "false").lower() == "true"
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"
API_KEY = os.environ.get("MIGHTPULSE_API_KEY", "").strip()

_last_call = 0.0
_calls = 0


def fail(msg):
    print("エラー: " + msg)
    sys.exit(1)


def api_get(path, params=None):
    """GETだけ。呼び出し間隔を空け、429は Retry-After を守って待つ。ログにはパスだけ出す（ids などの値は出さない）"""
    global _last_call, _calls
    url = API + path
    if params:
        url += "?" + "&".join("%s=%s" % (k, v) for k, v in params.items())
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + API_KEY, "User-Agent": "kingshot-tools user-import"})
    for attempt in range(4):
        wait = MIN_INTERVAL - (time.time() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.time()
        _calls += 1
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                ra = e.headers.get("Retry-After")
                sec = float(ra) if ra and ra.replace(".", "", 1).isdigit() else 10
                print("  429（%s）: %.0f秒待ちます" % (path, sec))
                time.sleep(min(sec, 90) + 0.5)
                continue
            if e.code >= 500 and attempt < 2:
                time.sleep(3)
                continue
            print("  HTTPエラー %s（%s）" % (e.code, path))
            return None
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt < 2:
                time.sleep(3)
                continue
            print("  通信エラー（%s）" % path)
            return None
    return None


def dig(obj, key):
    """入れ子の中から、最初に見つかった key の値を返す（レスポンスの形が少し違っても拾えるように）"""
    if isinstance(obj, dict):
        if key in obj and not isinstance(obj[key], (dict, list)):
            return obj[key]
        for v in obj.values():
            r = dig(v, key)
            if r is not None:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = dig(v, key)
            if r is not None:
                return r
    return None


def as_int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def relay(payload):
    pw = os.environ.get("RELAY_PASSWORD_TEST" if TARGET == "test" else "RELAY_PASSWORD", "")
    if not pw:
        fail("%s用のパスワードのSecretが未設定です（%s）" % (TARGET, "RELAY_PASSWORD_TEST" if TARGET == "test" else "RELAY_PASSWORD"))
    body = dict(payload)
    body["password"] = pw
    req = urllib.request.Request(GAS[TARGET], method="POST", headers={"Content-Type": "text/plain;charset=utf-8"},
                                 data=json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        fail("中継役（GAS）と通信できませんでした: %s" % type(e).__name__)


# ---------------- 取得 ----------------
def sample_rows():
    """ドライラン用の固定サンプル（APIは呼ばない。実在の人ではありません）"""
    return ([
        {"gid": "9000001", "name": "サンプルA", "tag": "AAA", "allianceName": "Alpha", "kid": "816", "power": 900000, "noAlliance": False, "source": "sample"},
        {"gid": "9000002", "name": "サンプルB", "tag": "AAA", "allianceName": "Alpha", "kid": "816", "power": 800000, "noAlliance": False, "source": "sample"},
        {"gid": "9000003", "name": "サンプルC", "tag": "BBB", "allianceName": "Beta", "kid": "816", "power": 700000, "noAlliance": False, "source": "sample"},
        {"gid": "9000004", "name": "サンプルD（同盟なし）", "tag": "", "allianceName": "", "kid": "816", "power": 600000, "noAlliance": True, "source": "sample"},
    ], {"playerCount": 6, "alliances": [{"abbr": "AAA", "name": "Alpha"}, {"abbr": "BBB", "name": "Beta"}], "notes": ["ドライラン（固定サンプル）"]}, {})


def fetch_real():
    """816の総力（personal_power）ランキング上位100人だけを取る（2026-11-13 ユーザー決定）。
    ranks を1回 → その100人を /players で引いて同盟（abbr・name）と総力を付ける。同盟が空なら同盟なし。呼び出しは合計5〜6回。"""
    if not API_KEY:
        fail("MIGHTPULSE_API_KEY が設定されていません")
    api_get("/usage")  # 残り回数の確認（回数には数えない）
    d = api_get("/kingdoms/%d/ranks" % KID, {"board": "personal_power", "limit": 100})
    board = ((d or {}).get("board", {}) or {}).get("rows", []) if d else []
    top = []
    for r in board:
        gid = str(r.get("governor_id") or "")
        if gid:
            top.append((gid, str(r.get("nick_name") or ""), as_int(r.get("score"))))
    if not top:
        fail("総力ランキングを取得できませんでした")
    print("総力ランキング上位 %d 人を取得しました" % len(top))

    by_gid = {}
    pending = 0
    for i in range(0, len(top), 50):
        ids = [g for g, _, _ in top[i:i + 50]]
        d = api_get("/players", {"ids": ",".join(ids), "include": "base"})
        pl = (d or {}).get("players") if d else None
        if isinstance(pl, dict):
            pl = list(pl.values())
        for e in pl or []:
            p = e.get("player") if isinstance(e.get("player"), dict) else e
            gid = str(p.get("governor_id") or e.get("governor_id") or "")
            if gid:
                by_gid[gid] = p
        if d and d.get("pending"):
            pending += 1
            time.sleep(min(float(d.get("retry_after") or 5), 30))
            d2 = api_get("/players", {"ids": ",".join(ids), "include": "base"})  # pending は待って1回だけ取り直す
            pl2 = (d2 or {}).get("players") if d2 else None
            if isinstance(pl2, dict):
                pl2 = list(pl2.values())
            for e in pl2 or []:
                p = e.get("player") if isinstance(e.get("player"), dict) else e
                gid = str(p.get("governor_id") or e.get("governor_id") or "")
                if gid:
                    by_gid[gid] = p

    rows = []
    no_alliance = 0
    missing_player = 0
    for gid, name, score in top:
        p = by_gid.get(gid)
        if p is None:
            missing_player += 1  # 同盟を確認できなかった人は、同盟の情報なし（同盟なし扱いにはせず、タグ空のまま送る）
            p = {}
        al = p.get("alliance")
        abbr = str(al.get("abbr") or "") if isinstance(al, dict) else ""
        power = as_int(p.get("power"))
        if power is None:
            power = score if score is not None else 0
        row = {"gid": gid, "name": str(p.get("nick_name") or name), "tag": abbr, "allianceName": str(al.get("name") or "") if isinstance(al, dict) else "",
               "kid": str(KID), "noAlliance": not abbr, "power": power, "kills": as_int(p.get("kills")),
               "townCenter": as_int(p.get("town_center_level")), "source": "player" if p else "board"}
        if not abbr:
            no_alliance += 1
        rows.append(row)
    print("同盟なし %d 人・/players で引けなかった人 %d 人・pending %d 回" % (no_alliance, missing_player, pending))
    stats = {"noAlliance": no_alliance, "missingPlayer": missing_player, "fetched": len(rows)}
    meta = {"playerCount": None, "alliances": [], "notes": ["取り込み対象は、816の総力ランキング上位%d人だけです（それより下の人は含みません）" % len(rows)]}
    return rows, meta, stats


def main():
    if TARGET not in GAS:
        fail("TARGET は test か prod です")
    print("対象: %s／上位 %d 人／同盟なしを登録: %s／commit: %s／ドライラン: %s" % (TARGET, TOP_N, INCLUDE_NO_ALLIANCE, COMMIT, DRY_RUN))
    if DRY_RUN:
        rows, meta, stats = sample_rows()
    else:
        rows, meta, stats = fetch_real()
        if not rows:
            fail("取得できた人が0人でした")
    rows = rows[:KEEP_ROWS]
    meta["fetchedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    meta["source"] = "mightpulse-dryrun" if DRY_RUN else "mightpulse"
    meta["kid"] = str(KID)
    res = relay({"action": "userImportPendingSet", "rows": rows, "meta": meta})
    if not res.get("ok"):
        fail("取り込み待ちに保存できませんでした: %s" % res.get("error"))
    print("取り込み待ちに保存しました（%d 人）。API呼び出し %d 回" % (res.get("count", 0), _calls))

    params = {"fromPending": True, "topN": TOP_N, "includeNoAlliance": INCLUDE_NO_ALLIANCE}
    pv = relay(dict(params, action="userImportPreview", countsOnly=True))
    if not pv.get("ok"):
        fail("照合できませんでした: %s" % pv.get("error"))
    c = pv["counts"]
    summary = ["## 816ユーザー取り込み（%s）" % ("ドライラン" if DRY_RUN else "本番取得" if TARGET == "prod" else "test"),
               "- 対象GAS: %s／総力の上位 %d 人まで（取得 %d 人）" % (TARGET, TOP_N, pv["total"]),
               "- 新規登録 %d／既存と一致（gidを付ける）%d（名前が変わる %d・同盟が変わる %d）／要確認 %d／同盟なし %d／今回は登録しない %d" % (
                   c["create"], c["link"], c["rename"], c["realliance"], c["review"], c["noalliance"], c["skip"])]
    cov = pv.get("coverage") or {}
    if cov.get("playerCount"):
        summary.append("- 816鯖の人数 %s 人に対して取得 %s 人（取れなかった見込み %d 人）" % (cov["playerCount"], cov["fetched"], max(0, cov["playerCount"] - cov["fetched"])))
    if stats:
        summary.append("- 取得 %s 人（816の総力ランキング上位）／同盟なし %s 人／/players で引けなかった人 %s 人" % (stats.get("fetched"), stats.get("noAlliance"), stats.get("missingPlayer")))
    if COMMIT:
        cm = relay(dict(params, action="userImportCommit"))
        if not cm.get("ok"):
            fail("登録できませんでした: %s" % cm.get("error"))
        summary.append("- **登録しました**：新規 %d 人・既存に結びつけ %d 人（登録前のバックアップ: %s）" % (cm["created"], cm["linked"], cm["backup"]))
    else:
        summary.append("- まだ登録していません（preview のみ）。名前・IDの詳細は管理画面 admin/user-import.html で確認し、同盟なしの人を選べます")
    text = "\n".join(summary)
    print(text)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(text + "\n")


main()
