/**
 * メンバー管理の保存用 中継役（Google Apps Script ウェブアプリ）。
 *
 * GitHub のトークンをここ（スクリプトプロパティ）にだけ置く。更新できるのは data/members.json だけ。
 *   - 管理画面（admin/members-admin.html）: パスワード付きで「取得（get）」「保存（put）」
 *   - 個人登録ページ（entry/index.html）: パスワードなしで「受付中イベントの取得（pubGet）」
 *     「自分の参加登録・変更・取消（selfSave）」。受付中のイベントの、1人分の参加情報しか変えられない
 *
 * スクリプトプロパティ（プロジェクトの設定 → スクリプト プロパティ）:
 *   GITHUB_TOKEN  : kenta-tools の Fine-grained トークン（kingshot-tools のみ・Contents: Read and write）
 *   EDIT_PASSWORD : 管理画面のログインパスワードと同じ文字列
 *
 * デプロイ: デプロイ → 新しいデプロイ → 種類「ウェブアプリ」→ 実行ユーザー「自分」→ アクセス「全員」
 * 更新時: デプロイ → デプロイを管理 → 鉛筆 → バージョン「新バージョン」→ デプロイ（URLは変わらない）
 */
var GH = { owner: "kenta-tools", repo: "kingshot-tools", path: "data/members.json", branch: "main" };
var MAX_BYTES = 900 * 1024; // GitHub Contents API の上限（1MB）より少し小さく
var GRADES = ["G8", "G7", "G6", "G5", "その他"];
var SELF_LIMIT_PER_MIN = 60; // 個人登録の受付上限（全体で1分あたり。いたずら連打対策）

function doPost(e) {
  var p;
  try {
    p = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, status: 400, error: "リクエストが読めません" });
  }
  return handle_(p);
}

function doGet() {
  return json_({ ok: true, message: "members proxy is running" });
}

function handle_(p) {
  try {
    var props = PropertiesService.getScriptProperties();
    var password = props.getProperty("EDIT_PASSWORD");
    var token = props.getProperty("GITHUB_TOKEN");
    if (!password || !token) return json_({ ok: false, status: 500, error: "中継役の設定（スクリプトプロパティ）が未完了です" });

    // 個人登録ページ用（パスワード不要）
    if (p.action === "pubGet") return json_(pubGet_(token));
    if (p.action === "selfSave") return json_(selfSave_(token, p));

    if (p.password !== password) {
      Utilities.sleep(1000); // 総当たり対策
      return json_({ ok: false, status: 401, error: "パスワードが違います" });
    }

    var url = fileUrl_();
    var headers = ghHeaders_(token);

    if (p.action === "get") {
      var r = UrlFetchApp.fetch(url + "?ref=" + GH.branch, { headers: headers, muteHttpExceptions: true });
      var code = r.getResponseCode();
      if (code === 404) return json_({ ok: true, content: null, sha: null });
      if (code !== 200) return json_({ ok: false, status: code, error: "GitHubから取得できませんでした" });
      var j = JSON.parse(r.getContentText());
      return json_({ ok: true, content: j.content, sha: j.sha });
    }

    if (p.action === "put") {
      // members.json の形になっているかだけ確認してから保存する
      var bytes = Utilities.base64Decode(p.content || "");
      if (bytes.length > MAX_BYTES) return json_({ ok: false, status: 413, error: "データが大きすぎます" });
      var data = JSON.parse(Utilities.newBlob(bytes).getDataAsString("UTF-8"));
      if (!Array.isArray(data.users) || !Array.isArray(data.events) || !Array.isArray(data.entries)) {
        return json_({ ok: false, status: 400, error: "members.json の形式ではありません" });
      }
      var body = { message: "Update members.json from admin page", content: p.content, branch: GH.branch };
      if (p.sha) body.sha = p.sha;
      var r2 = UrlFetchApp.fetch(url, {
        method: "put", headers: headers, contentType: "application/json",
        payload: JSON.stringify(body), muteHttpExceptions: true
      });
      var c2 = r2.getResponseCode();
      if (c2 === 200 || c2 === 201) return json_({ ok: true });
      return json_({ ok: false, status: c2, error: "GitHubへの保存に失敗しました" });
    }

    return json_({ ok: false, status: 400, error: "不明な操作です" });
  } catch (err) {
    return json_({ ok: false, status: 500, error: String(err) });
  }
}

// ---------- 個人登録ページ用 ----------

// 受付中のイベントと、その参加者・ユーザー一覧（名前の候補・自分の登録の読み込み用）
function pubGet_(token) {
  var f = readFile_(token);
  if (!f.ok) return f;
  var d = f.data;
  var events = (d.events || []).filter(function(e) { return e.open; });
  var ids = {};
  events.forEach(function(e) { ids[e.id] = true; });
  return {
    ok: true,
    events: events,
    users: (d.users || []).map(function(u) { return { id: u.id, name: u.name, alliance: u.alliance, aliases: u.aliases || [] }; }),
    entries: (d.entries || []).filter(function(x) { return ids[x.eventId]; })
  };
}

// 1人分の参加登録・変更・取消。受付中のイベントだけ。
// p: { eventId, userId?（候補から選んだ既存ユーザー）, name, cancel?, entry: {alliance, entry, grade, ...} }
function selfSave_(token, p) {
  var cache = CacheService.getScriptCache();
  var minuteKey = "self_" + Math.floor(Date.now() / 60000);
  var count = Number(cache.get(minuteKey) || 0);
  if (count >= SELF_LIMIT_PER_MIN) return { ok: false, status: 429, error: "混み合っています。1分ほど待ってからもう一度押してください" };
  cache.put(minuteKey, String(count + 1), 120);

  var name = clip_(p.name, 30);
  if (!name) return { ok: false, status: 400, error: "名前を入力してください" };
  var row = null;
  if (!p.cancel) {
    row = cleanEntry_(p.entry || {});
    if (!row.alliance) return { ok: false, status: 400, error: "同盟を入力してください" };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, status: 503, error: "混み合っています。少し待ってからもう一度押してください" };
  try {
    for (var attempt = 0; attempt < 3; attempt++) {
      var f = readFile_(token);
      if (!f.ok) return f;
      var d = f.data;
      d.users = d.users || []; d.events = d.events || []; d.entries = d.entries || [];

      var ev = d.events.filter(function(e) { return e.id === p.eventId; })[0];
      if (!ev || !ev.open) return { ok: false, status: 403, error: "このイベントの受付は終了しました" };

      // ユーザーを決める: 候補から選んだ人 → 名前（旧名含む）が一致する人 → 新規
      var user = p.userId ? d.users.filter(function(u) { return u.id === p.userId; })[0] : null;
      if (user && key_(user.name) !== key_(name)) {
        // 本人が「この名前は自分」と選んだので、今の名前に更新して前の名前は旧名に残す
        var old = user.name;
        user.aliases = (user.aliases || []).filter(function(a) { return key_(a) !== key_(name); });
        if (!user.aliases.some(function(a) { return key_(a) === key_(old); })) user.aliases.push(old);
        user.name = name;
      }
      if (!user) user = findUser_(d.users, name);
      var result;
      if (p.cancel) {
        if (!user) return { ok: false, status: 404, error: "このイベントに登録がありません" };
        var before = d.entries.length;
        d.entries = d.entries.filter(function(x) { return !(x.eventId === ev.id && x.userId === user.id); });
        if (d.entries.length === before) return { ok: false, status: 404, error: "このイベントに登録がありません" };
        result = "canceled";
      } else {
        if (!user) {
          if (d.users.length >= 5000) return { ok: false, status: 400, error: "登録できる人数の上限です。管理者に連絡してください" };
          user = { id: newId_("u"), name: name, alliance: row.alliance, aliases: [] };
          d.users.push(user);
        }
        user.alliance = row.alliance;
        var existing = d.entries.filter(function(x) { return x.eventId === ev.id && x.userId === user.id; })[0];
        var e = {
          alliance: row.alliance, entry: row.entry, grade: row.grade, monthly: row.monthly, leaveEarly: row.leaveEarly,
          vc: row.vc, vivian4: row.vivian4, troops: row.troops, tier: row.tier, joinAt: row.joinAt, leaveAt: row.leaveAt,
          note: row.note, marchCount: row.marchCount, marchPet: row.marchPet, rallyCount: row.rallyCount,
          rallyPet: row.rallyPet, id: existing ? existing.id : newId_("r"), eventId: ev.id, userId: user.id
        };
        if (existing) d.entries[d.entries.indexOf(existing)] = e;
        else d.entries.push(e);
        result = existing ? "updated" : "added";
      }

      d.updated = new Date().toISOString();
      var w = writeFile_(token, d, f.sha, "Self registration: " + ev.type + " " + ev.date);
      if (w.ok) return { ok: true, result: result, userId: user.id, name: user.name };
      if (w.status !== 409 && w.status !== 422) return w;
      // 直前に他の人が保存した → 取り直してもう一度
    }
    return { ok: false, status: 409, error: "混み合っています。もう一度押してください" };
  } finally {
    lock.releaseLock();
  }
}

function cleanEntry_(m) {
  var grade = clip_(m.grade, 5).toUpperCase();
  var tier = Number(String(m.tier == null ? "" : m.tier).replace(/^T/i, ""));
  var troopsIn = String(m.troops || "");
  var r = {
    alliance: clip_(m.alliance, 20),
    entry: m.entry === "late" ? "late" : "start",
    grade: GRADES.indexOf(grade) >= 0 ? grade : "その他",
    monthly: m.monthly === true,
    leaveEarly: m.leaveEarly === true,
    vc: m.vc === true,
    vivian4: m.vivian4 === true,
    troops: "歩騎弓".split("").filter(function(t) { return troopsIn.indexOf(t) >= 0; }).join(""),
    tier: tier >= 1 && tier <= 30 && Math.floor(tier) === tier ? tier : null,
    joinAt: clip_(m.joinAt, 20),
    leaveAt: clip_(m.leaveAt, 20),
    note: clip_(m.note, 100),
    marchCount: count_(m.marchCount),
    marchPet: count_(m.marchPet),
    rallyCount: count_(m.rallyCount),
    rallyPet: count_(m.rallyPet)
  };
  if (r.leaveAt) r.leaveEarly = true;
  return r;
}

function findUser_(users, name) {
  var k = key_(name);
  return users.filter(function(u) { return key_(u.name) === k; })[0]
    || users.filter(function(u) { return (u.aliases || []).some(function(a) { return key_(a) === k; }); })[0]
    || null;
}

// 部隊数・ペットLv（0〜99999の整数、空なら null）
function count_(v) {
  var n = Number(String(v == null ? "" : v).replace(/[,，]/g, ""));
  return String(v == null ? "" : v).trim() !== "" && n >= 0 && n <= 99999 && Math.floor(n) === n ? n : null;
}

function key_(s) { return String(s).trim().toLowerCase(); }
function clip_(v, n) { return String(v == null ? "" : v).replace(/[\r\n\t]/g, " ").trim().slice(0, n); }
function newId_(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ---------- GitHub ----------

function fileUrl_() {
  return "https://api.github.com/repos/" + GH.owner + "/" + GH.repo + "/contents/" + GH.path;
}

function ghHeaders_(token) {
  return { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" };
}

function readFile_(token) {
  var r = UrlFetchApp.fetch(fileUrl_() + "?ref=" + GH.branch, { headers: ghHeaders_(token), muteHttpExceptions: true });
  var code = r.getResponseCode();
  if (code === 404) return { ok: true, data: { users: [], events: [], entries: [], notSame: [] }, sha: null };
  if (code !== 200) return { ok: false, status: code, error: "GitHubから取得できませんでした" };
  var j = JSON.parse(r.getContentText());
  var text = Utilities.newBlob(Utilities.base64Decode(j.content.replace(/\s/g, ""))).getDataAsString("UTF-8");
  return { ok: true, data: JSON.parse(text || "{}"), sha: j.sha };
}

function writeFile_(token, data, sha, message) {
  var text = JSON.stringify(data, null, 2) + "\n";
  var content = Utilities.base64Encode(text, Utilities.Charset.UTF_8);
  if (content.length * 3 / 4 > MAX_BYTES) return { ok: false, status: 413, error: "データが大きすぎます。管理者に連絡してください" };
  var body = { message: message, content: content, branch: GH.branch };
  if (sha) body.sha = sha;
  var r = UrlFetchApp.fetch(fileUrl_(), {
    method: "put", headers: ghHeaders_(token), contentType: "application/json",
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  var c = r.getResponseCode();
  if (c === 200 || c === 201) return { ok: true };
  return { ok: false, status: c, error: "GitHubへの保存に失敗しました" };
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
