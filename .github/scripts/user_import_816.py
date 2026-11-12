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
PERSONAL_BOARDS = ["personal_power", "kills", "town_center", "master_power", "mystic_trial", "pet_power"]
KEEP_ROWS = 600          # GASに送る人数（総力の大きい順）。取り込み画面で上位N人に絞る
MIN_INTERVAL = 1.15      # 1キー60回/分の制限を守る（聖剣リーグの自動更新と同じキーなので9:00〜10:00 JSTは避ける）

TARGET = os.environ.get("TARGET", "test").strip()
TOP_N = int(os.environ.get("TOP_N", "200") or 200)
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
    if not API_KEY:
        fail("MIGHTPULSE_API_KEY が設定されていません")
    stats = {}
    api_get("/usage")  # 残り回数の確認（回数には数えない）
    k = api_get("/kingdoms/%d" % KID)
    if not k or not k.get("ok", True):
        fail("王国情報を取得できませんでした")
    alliance_count = as_int(dig(k, "alliance_count"))
    player_count = as_int(dig(k, "player_count"))
    located = as_int(dig(k, "located"))
    print("王国%d: 同盟 %s・プレイヤー %s・located %s" % (KID, alliance_count, player_count, located))
    if alliance_count is not None and alliance_count > 100:
        fail("同盟が100を超えています（%d）。一覧が1回で取れないため止めます" % alliance_count)

    board = api_get("/kingdoms/%d/ranks" % KID, {"board": "alliance_power", "limit": 100})
    arows = (board or {}).get("board", {}).get("rows", []) if board else []
    alliances = [{"abbr": str(a.get("abbr") or ""), "name": str(a.get("name") or "")} for a in arows if a.get("abbr")]
    if not alliances:
        fail("同盟の一覧を取得できませんでした")
    print("同盟 %d 件（タグ↔名前）:" % len(alliances))
    for a in alliances:
        print("  %s = %s" % (a["abbr"], a["name"]))  # 同盟の情報はログに出してよい（プレイヤー情報ではない）

    people = {}
    dup = 0
    missing_power = 0
    for a in alliances:
        d = api_get("/alliances/%d/%s" % (KID, a["abbr"]), {"include": "info,roster"})
        if not d:
            continue
        roster = d.get("roster")
        members = roster.get("members") if isinstance(roster, dict) else roster
        if not isinstance(members, list):
            print("  名簿の形が想定と違います（%s）。キー: %s" % (a["abbr"], ",".join(sorted(d.keys()))))
            continue
        info = d.get("info") or {}
        aname = str(info.get("name") or a["name"])
        for m in members:
            gid = str(m.get("governor_id") or "")
            if not gid:
                continue
            power = as_int(m.get("power"))
            if power is None:
                missing_power += 1
                power = 0
            row = {"gid": gid, "name": str(m.get("nick_name") or ""), "tag": a["abbr"], "allianceName": aname, "kid": str(KID), "noAlliance": False,
                   "power": power, "kills": as_int(m.get("kills")), "townCenter": as_int(m.get("town_center_level")),
                   "allianceRank": str(m.get("alliance_rank_label") or m.get("alliance_rank") or ""), "source": "roster"}
            if gid in people:
                dup += 1
                if people[gid]["power"] >= power:
                    continue
            people[gid] = row
    stats["rosterPeople"] = len(people)
    stats["dup"] = dup
    stats["missingPower"] = missing_power
    print("名簿から %d 人（重複 %d・総力の欠損 %d）" % (len(people), dup, missing_power))

    # 同盟なしの洗い出し：個人ボード上位100に出てくるが、名簿に無い人 → /players で同盟の有無を確認
    cand = {}
    for b in PERSONAL_BOARDS:
        d = api_get("/kingdoms/%d/ranks" % KID, {"board": b, "limit": 100})
        for r in ((d or {}).get("board", {}).get("rows", []) if d else []):
            gid = str(r.get("governor_id") or "")
            if gid and gid not in people:
                cand[gid] = True
    cand_ids = list(cand.keys())
    print("同盟なしの候補 %d 人を確認します" % len(cand_ids))
    no_alliance = 0
    other = 0
    for i in range(0, len(cand_ids), 50):
        chunk = cand_ids[i:i + 50]
        d = api_get("/players", {"ids": ",".join(chunk), "include": "base"})
        pl = (d or {}).get("players") if d else None
        if isinstance(pl, dict):
            pl = list(pl.values())
        for e in pl or []:
            p = e.get("player") if isinstance(e.get("player"), dict) else e
            gid = str(p.get("governor_id") or e.get("governor_id") or "")
            if not gid:
                continue
            al = p.get("alliance")
            abbr = str(al.get("abbr") or "") if isinstance(al, dict) else ""
            power = as_int(p.get("power"))
            if power is None:
                missing_power += 1
                power = 0
            row = {"gid": gid, "name": str(p.get("nick_name") or ""), "tag": abbr, "allianceName": str(al.get("name") or "") if isinstance(al, dict) else "",
                   "kid": str(KID), "noAlliance": not abbr, "power": power, "kills": as_int(p.get("kills")),
                   "townCenter": as_int(p.get("town_center_level")), "source": "player"}
            people[gid] = row
            if abbr:
                other += 1
            else:
                no_alliance += 1
        if d and d.get("pending"):
            print("  pending あり（取りきれなかった分は今回は飛ばします）")
    stats["noAlliance"] = no_alliance
    stats["rosterMiss"] = other
    print("同盟なし %d 人・名簿に無かったが同盟ありの人 %d 人" % (no_alliance, other))
    rows = sorted(people.values(), key=lambda r: -r["power"])
    meta = {"playerCount": player_count if player_count is not None else located, "alliances": alliances,
            "notes": ["同盟なしの人は、個人ボードの上位100までに入った人しか取れません（総力101位以降の無所属は出てきません）"]}
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
        summary.append("- 名簿の重複 %s／総力の欠損 %s／同盟なし %s" % (stats.get("dup"), stats.get("missingPower"), stats.get("noAlliance")))
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
