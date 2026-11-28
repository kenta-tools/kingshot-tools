from pathlib import Path
def load(p):
    raw = Path(p).read_bytes().decode("utf-8"); return raw, "\r\n" in raw, raw.replace("\r\n", "\n")
def save(p, s, crlf): Path(p).write_bytes((s.replace("\n", "\r\n") if crlf else s).encode("utf-8"))

# ---- GAS ----
p = "work/gas_members_proxy.gs"; raw, crlf, s = load(p)
def rep(a, b):
    global s
    assert s.count(a) == 1, a[:50]; s = s.replace(a, b)
rep('if (p.action === "setDiscordInvite") return json_(setDiscordInvite_(p.invite));', 'if (p.action === "setDiscordInvite") return json_(setDiscordInvite_(p.invite, p.key));')
rep('    discordInvite: PropertiesService.getScriptProperties().getProperty("DISCORD_INVITE") || ""',
    '    discordInvite: PropertiesService.getScriptProperties().getProperty("DISCORD_INVITE") || "",\n    // 816用Discordサーバーの招待リンク（EGG新規加入者マニュアルが読む。未設定なら ""）\n    discordInvite816: PropertiesService.getScriptProperties().getProperty("DISCORD_INVITE_816") || ""')
i = s.index("function setDiscordInvite_(invite) {"); j = s.index("// 以前 GAS で作り直していたとき")
s = s[:i] + '''// key: 省略／"" ＝ 全体鯖（DISCORD_INVITE）、"816" ＝ 816用サーバー（DISCORD_INVITE_816 / DISCORD_INVITE_816_AT）
function setDiscordInvite_(invite, key) {
  var url = String(invite || "");
  if (!/^https:\/\/discord\.gg\/[A-Za-z0-9-]{2,32}$/.test(url)) return { ok: false, status: 400, error: "招待リンクの形が違います" };
  var k = String(key == null ? "" : key);
  if (k !== "" && k !== "816") return { ok: false, status: 400, error: "どのサーバーのリンクか（key）が正しくありません" };
  var name = k === "816" ? "DISCORD_INVITE_816" : "DISCORD_INVITE";
  var props = PropertiesService.getScriptProperties();
  props.setProperty(name, url);
  props.setProperty(name + "_AT", new Date().toISOString());
  return { ok: true, invite: url, key: k };
}

''' + s[j:]
save(p, s, crlf)

# ---- Actions script ----
p = ".github/scripts/discord_invite.py"; raw, crlf, s = load(p)
i = s.index('TOKEN = os.environ["DISCORD_BOT_TOKEN"]')
head = s[:i].replace("  DISCORD_CHANNEL_ID : 招待先のチャンネルID\n", "  DISCORD_CHANNEL_ID : 招待先のチャンネルID（全体鯖のサーバー）\n  DISCORD_CHANNEL_ID_816 : 816用サーバーの招待先チャンネルID（任意。無ければ816用だけ飛ばす。botは同じものを使う）\n")
head = head.replace("- このチャンネルに7日間有効の招待リンクを新しく作る", "- 全体鯖用（DISCORD_CHANNEL_ID）と816用（DISCORD_CHANNEL_ID_816）の2つのチャンネルそれぞれに、同じ手順を行う（片方が失敗しても、もう片方は続ける）\n- このチャンネルに7日間有効の招待リンクを新しく作る")
body = '''TOKEN = os.environ["DISCORD_BOT_TOKEN"].strip()
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


def refresh(label, channel, key):
    """1つのチャンネルの招待リンクを作り直して中継役に送る。成功なら True。key は中継役に送る「どのサーバーか」（全体鯖は None）"""
    print("== %s ==" % label)
    status, inv = discord("POST", "/channels/%s/invites" % channel,
                          {"max_age": INVITE_DAYS * 86400, "max_uses": 0, "temporary": False, "unique": True})
    if status not in (200, 201):
        print("招待リンクを作れませんでした（%s）: %s" % (status, inv))
        print("401=トークン違い、403=bot に「招待を作成」の権限がない／チャンネルが見えない、404=チャンネルIDが違う")
        return False
    code = inv["code"]
    url = "https://discord.gg/" + code
    print("招待リンクを作りました:", url)

    # 中継役に保存（個人登録ページ／EGG新規加入者マニュアルに出す）
    payload = {"action": "setDiscordInvite", "password": PASSWORD, "invite": url}
    if key:
        payload["key"] = key
    req = urllib.request.Request(RELAY_URL, method="POST", headers={"Content-Type": "text/plain;charset=utf-8"},
                                 data=json.dumps(payload).encode())
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            res = json.loads(r.read().decode())
    except Exception as e:
        print("中継役に保存できませんでした（通信エラー）:", e)
        return False
    if not res.get("ok"):
        print("中継役に保存できませんでした:", res.get("error"))
        return False
    print("中継役に保存しました")

    # bot が前に作った古いリンクを消す（失敗しても新しいリンクはそのまま使える）
    _, me = discord("GET", "/users/@me")
    status, invites = discord("GET", "/channels/%s/invites" % channel)
    if status != 200:
        print("古いリンクの一覧を取れませんでした（%s。bot に「チャンネルの管理」権限がないかも）" % status)
        return True
    for old in invites:
        if old["code"] == code or (old.get("inviter") or {}).get("id") != me["id"]:
            continue
        s, _ = discord("DELETE", "/invites/" + old["code"])
        print(("古いリンクを消しました: " if s in (200, 204, 404) else "古いリンクを消せませんでした（%s）: " % s) + old["code"])
    return True


def main():
    targets = []
    ch = os.environ.get("DISCORD_CHANNEL_ID", "").strip()
    if ch:
        targets.append(("全体鯖", ch, None))
    else:
        print("DISCORD_CHANNEL_ID（全体鯖用）が設定されていません")
    ch816 = os.environ.get("DISCORD_CHANNEL_ID_816", "").strip()
    if ch816:
        targets.append(("816用", ch816, "816"))
    else:
        print("DISCORD_CHANNEL_ID_816 が未設定なので、816用は飛ばします")
    failed = 0 if ch else 1
    for label, channel, key in targets:
        try:
            ok = refresh(label, channel, key)
        except Exception as e:  # 片方が失敗しても、もう片方は続ける
            print("%sで予期しないエラー: %s" % (label, e))
            ok = False
        if not ok:
            failed += 1
    sys.exit(1 if failed else 0)  # どれかが失敗したらActionsを赤くして気づけるようにする


main()
'''
save(p, head + body, crlf)

# ---- workflow ----
p = ".github/workflows/discord-invite.yml"; raw, crlf, s = load(p)
a = "          DISCORD_CHANNEL_ID: ${{ secrets.DISCORD_CHANNEL_ID }}\n"
assert s.count(a) == 1
s = s.replace(a, a + "          DISCORD_CHANNEL_ID_816: ${{ secrets.DISCORD_CHANNEL_ID_816 }}\n")
s = s.replace("# Discord の招待リンクを毎朝作り直して、個人登録ページのボタンに出す", "# Discord の招待リンクを毎朝作り直して、個人登録ページ（全体鯖）・EGG新規加入者マニュアル（816用）のボタンに出す")
save(p, s, crlf)
print("ok")
