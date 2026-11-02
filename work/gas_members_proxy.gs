/**
 * メンバー管理の保存用 中継役（Google Apps Script ウェブアプリ）。
 *
 * データ（ユーザー・イベント・参加情報・KvK名簿）は、このスクリプトの持ち主の Google ドライブにある
 * 非公開ファイル（DATA_FILE_ID）に保存する。公開サイトには置かない（2026-11-01 に GitHub の data/members.json から移行）。
 *   - 管理画面（admin/members-admin.html）: パスワード付きで「取得（get）」「保存（put）」
 *   - 個人登録ページ（entry/index.html）: パスワードなしで「受付中イベントの取得（pubGet）」
 *     「自分の参加登録・変更・取消（selfSave）」。受付中のイベントの、1人分の参加情報しか変えられない
 *   - KvK同着スタート カウントダウン表（tools/）の「共有用」画面:
 *     パスワードなしで「名簿の取得（pubGetに同梱）」「名簿の保存（kvkSave）」。イベントID単位で1件（名簿まるごと上書き）
 *
 * スクリプトプロパティ（プロジェクトの設定 → スクリプト プロパティ）:
 *   EDIT_PASSWORD : 管理画面のログインパスワードと同じ文字列
 *   DATA_FILE_ID  : データを保存するドライブのファイルID（setupStorage を実行すると自動で入る）
 *   DATA_VERSION  : 保存のたびに1増える番号（同時保存の衝突検出用。自動）
 *   GITHUB_TOKEN  : 移行元（GitHub の data/members.json）を読むためだけに使う。移行後は不要
 *
 * 初回だけ: エディタで関数「setupStorage」を選んで「実行」→ ドライブへのアクセスを許可する
 *（GitHub の data/members.json をドライブのファイルにコピーして、以後はそこを使う）
 *
 * デプロイ: デプロイ → 新しいデプロイ → 種類「ウェブアプリ」→ 実行ユーザー「自分」→ アクセス「全員」
 * 更新時: デプロイ → デプロイを管理 → 鉛筆 → バージョン「新バージョン」→ デプロイ（URLは変わらない）
 */
var GH = { owner: "kenta-tools", repo: "kingshot-tools", path: "data/members.json", branch: "main" }; // 移行元
var MAX_BYTES = 5 * 1024 * 1024; // 保存データの上限（いたずら対策）
var DATA_FILE_NAME = "Kingshot メンバー管理データ（非公開）.json";
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
    var token = props.getProperty("GITHUB_TOKEN"); // 移行（importFromGitHub）にだけ使う
    if (!password) return json_({ ok: false, status: 500, error: "中継役の設定（スクリプトプロパティ）が未完了です" });
    if (!props.getProperty("DATA_FILE_ID")) return json_({ ok: false, status: 500, error: "データの保存先が未設定です（setupStorage を実行してください）" });

    // 個人登録ページ用（パスワード不要）
    if (p.action === "pubGet") return json_(pubGet_(token));
    if (p.action === "selfSave") return json_(selfSave_(token, p));
    // KvK同着カウントダウン表「共有用」画面用（パスワード不要）
    if (p.action === "kvkSave") return json_(kvkSave_(token, p));
    // 炎龍 集結タイムライン計算「共有用」画面用（パスワード不要）
    if (p.action === "flameSave") return json_(flameSave_(token, p));

    if (p.password !== password) {
      Utilities.sleep(1000); // 総当たり対策
      return json_({ ok: false, status: 401, error: "パスワードが違います" });
    }

    // GitHub の data/members.json の内容で、ドライブのデータを置き換える（移行の取り直し用）
    if (p.action === "importFromGitHub") return json_(importFromGitHub_(token));

    // 個人登録の記録（管理画面用。公開データには入れない）
    if (p.action === "getLog") return json_({ ok: true, log: readLog_(), blocklist: readBlocklist_() });
    // ブロックするIPの一覧（管理画面で編集。まるごと置き換え）
    if (p.action === "setBlocklist") return json_(writeBlocklist_(p.list));
    // Discord の招待リンク（GitHub Actions が毎朝作って送ってくる）
    if (p.action === "setDiscordInvite") return json_(setDiscordInvite_(p.invite));

    // 管理画面とのやりとりは GitHub 時代と同じ形（content=Base64のJSON、sha=版番号）
    if (p.action === "get") {
      var g = readFile_(token);
      if (!g.ok) return json_(g);
      return json_({ ok: true, content: Utilities.base64Encode(JSON.stringify(g.data), Utilities.Charset.UTF_8), sha: g.sha });
    }

    if (p.action === "put") {
      // members.json の形になっているかだけ確認してから保存する
      var bytes = Utilities.base64Decode(p.content || "");
      if (bytes.length > MAX_BYTES) return json_({ ok: false, status: 413, error: "データが大きすぎます" });
      var data = JSON.parse(Utilities.newBlob(bytes).getDataAsString("UTF-8"));
      if (!Array.isArray(data.users) || !Array.isArray(data.events) || !Array.isArray(data.entries)) {
        return json_({ ok: false, status: 400, error: "members.json の形式ではありません" });
      }
      var lock = LockService.getScriptLock();
      if (!lock.tryLock(30000)) return json_({ ok: false, status: 503, error: "混み合っています。少し待ってからもう一度押してください" });
      try {
        return json_(writeFile_(token, data, p.sha, "admin"));
      } finally {
        lock.releaseLock();
      }
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
    entries: (d.entries || []).filter(function(x) { return ids[x.eventId]; }),
    // kvkRosters/flameRostersは終了したイベント分も含めて全部返す（終了後も閲覧はできるようにするため。
    // 更新を締め切るかどうかはクライアント側で「そのイベントがopenか」を見て判断する）
    kvkRosters: d.kvkRosters || [],
    flameRosters: d.flameRosters || [],
    history: {
      events: (d.events || []).map(function(e) { return { id: e.id, type: e.type, date: e.date }; }),
      entries: d.entries || []
    },
    // Discord の招待リンク（GitHub Actions が毎朝作り直して setDiscordInvite で送ってくる。未設定なら ""）
    discordInvite: PropertiesService.getScriptProperties().getProperty("DISCORD_INVITE") || ""
  };
}

// KvK同着カウントダウン表「共有用」画面の名簿保存。イベントID単位で1件、名簿まるごと上書き。
// p: { eventId, rows: [{name, march, petLevel, usePet, group, opponentName, opponentSec}, ...] }
function kvkSave_(token, p) {
  var cache = CacheService.getScriptCache();
  var minuteKey = "kvk_" + Math.floor(Date.now() / 60000);
  var count = Number(cache.get(minuteKey) || 0);
  if (count >= SELF_LIMIT_PER_MIN) return { ok: false, status: 429, error: "混み合っています。1分ほど待ってからもう一度押してください" };
  cache.put(minuteKey, String(count + 1), 120);

  if (!p.eventId) return { ok: false, status: 400, error: "イベントが選ばれていません" };
  var rows = (Array.isArray(p.rows) ? p.rows : []).slice(0, 500).map(function(r) {
    return {
      name: clip_(r.name, 30),
      march: numOrNull_(r.march),
      petLevel: count_(r.petLevel, 8) || 0,
      usePet: r.usePet !== false,
      group: clip_(r.group, 20),
      opponentName: clip_(r.opponentName, 30),
      opponentSec: numOrNull_(r.opponentSec)
    };
  }).filter(function(r) { return r.name; });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, status: 503, error: "混み合っています。少し待ってからもう一度押してください" };
  try {
    for (var attempt = 0; attempt < 3; attempt++) {
      var f = readFile_(token);
      if (!f.ok) return f;
      var d = f.data;
      if (!isEventOpen_(d, p.eventId)) return { ok: false, status: 403, error: "このイベントは終了しているため更新できません" };
      d.kvkRosters = d.kvkRosters || [];
      var existing = d.kvkRosters.filter(function(x) { return x.eventId === p.eventId; })[0];
      var record = { eventId: p.eventId, rows: rows, updatedAt: new Date().toISOString() };
      if (existing) d.kvkRosters[d.kvkRosters.indexOf(existing)] = record;
      else d.kvkRosters.push(record);

      d.updated = new Date().toISOString();
      var w = writeFile_(token, d, f.sha, "KvK shared roster saved");
      if (w.ok) return { ok: true };
      if (w.status !== 409 && w.status !== 422) return w;
      // 直前に他の人が保存した → 取り直してもう一度
    }
    return { ok: false, status: 409, error: "混み合っています。もう一度押してください" };
  } finally {
    lock.releaseLock();
  }
}

function numOrNull_(v) {
  var n = Number(v);
  return v !== "" && v != null && isFinite(n) ? n : null;
}

// eventIdが「受付中（open:true）」のイベントかどうか（終了済みイベントへの共有保存を止めるため）
function isEventOpen_(d, eventId) {
  var ev = (d.events || []).filter(function(e) { return e.id === eventId; })[0];
  return !!(ev && ev.open);
}

// 炎龍 集結タイムライン計算「共有用」画面の保存。イベントID単位で1件、まるごと上書き。
// p: { eventId, members: [{id,role,label,march,petLevel,usePet}], patterns: [{id,name,kezuriIds,reinforceIds}], settings: {...} }
function flameSave_(token, p) {
  var cache = CacheService.getScriptCache();
  var minuteKey = "flame_" + Math.floor(Date.now() / 60000);
  var count = Number(cache.get(minuteKey) || 0);
  if (count >= SELF_LIMIT_PER_MIN) return { ok: false, status: 429, error: "混み合っています。1分ほど待ってからもう一度押してください" };
  cache.put(minuteKey, String(count + 1), 120);

  if (!p.eventId) return { ok: false, status: 400, error: "イベントが選ばれていません" };
  var members = (Array.isArray(p.members) ? p.members : []).slice(0, 200).map(function(m) {
    return {
      id: clip_(m.id, 20),
      role: clip_(m.role, 10),
      label: clip_(m.label, 30),
      march: numOrNull_(m.march) || 0,
      petLevel: count_(m.petLevel, 8) || 0,
      usePet: m.usePet !== false
    };
  }).filter(function(m) { return m.id; });
  var patterns = (Array.isArray(p.patterns) ? p.patterns : []).slice(0, 50).map(function(pt) {
    return {
      id: clip_(pt.id, 20),
      name: clip_(pt.name, 10),
      kezuriIds: (Array.isArray(pt.kezuriIds) ? pt.kezuriIds : []).map(function(x) { return clip_(x, 20); }),
      reinforceIds: (Array.isArray(pt.reinforceIds) ? pt.reinforceIds : []).map(function(x) { return clip_(x, 20); })
    };
  }).filter(function(pt) { return pt.id; });
  var s = p.settings || {};
  var settings = {
    kezuriRallyMin: numOrNull_(s.kezuriRallyMin) || 0,
    mainRallyMin: numOrNull_(s.mainRallyMin) || 0,
    phaseGap: numOrNull_(s.phaseGap) || 0,
    buffer: numOrNull_(s.buffer) || 0
  };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, status: 503, error: "混み合っています。少し待ってからもう一度押してください" };
  try {
    for (var attempt = 0; attempt < 3; attempt++) {
      var f = readFile_(token);
      if (!f.ok) return f;
      var d = f.data;
      if (!isEventOpen_(d, p.eventId)) return { ok: false, status: 403, error: "このイベントは終了しているため更新できません" };
      d.flameRosters = d.flameRosters || [];
      var existing = d.flameRosters.filter(function(x) { return x.eventId === p.eventId; })[0];
      var record = { eventId: p.eventId, members: members, patterns: patterns, settings: settings, updatedAt: new Date().toISOString() };
      if (existing) d.flameRosters[d.flameRosters.indexOf(existing)] = record;
      else d.flameRosters.push(record);

      d.updated = new Date().toISOString();
      var w = writeFile_(token, d, f.sha, "Flame dragon shared roster saved");
      if (w.ok) return { ok: true };
      if (w.status !== 409 && w.status !== 422) return w;
      // 直前に他の人が保存した → 取り直してもう一度
    }
    return { ok: false, status: 409, error: "混み合っています。もう一度押してください" };
  } finally {
    lock.releaseLock();
  }
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
  var ip = String(p.ip || "").replace(/[^0-9a-fA-F:.]/g, "").slice(0, 45);
  if (isBlocked_(ip)) {
    appendLog_({ t: new Date().toISOString(), ev: String(p.eventId || ""), name: name, uid: String(p.userId || ""), act: "blocked",
      ip: ip, ua: clip_(p.ua, 120) });
    return { ok: false, status: 403, error: "登録できませんでした。管理者に連絡してください" };
  }
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
        var taken = findUser_(d.users, name);
        if (taken && taken.id !== user.id) return { ok: false, status: 409, error: "「" + name + "」はすでに別の人の名前として登録されています" };
        // 本人が「この名前は自分」と選んだ／名前を変更したので、今の名前に更新して前の名前は旧名に残す
        var old = user.name;
        user.aliases = (user.aliases || []).filter(function(a) { return key_(a) !== key_(name); });
        if (!user.aliases.some(function(a) { return key_(a) === key_(old); })) user.aliases.push(old);
        user.nameHistory = (user.nameHistory || []).concat([{ name: old, until: new Date().toISOString() }]); // いつまでその名前だったか
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
          vc: row.vc, vivian4: row.vivian4, mayChange: row.mayChange, troops: row.troops, tier: row.tier, joinAt: row.joinAt, leaveAt: row.leaveAt,
          note: row.note, marchCount: row.marchCount, marchPet: row.marchPet, rallyCount: row.rallyCount,
          rallyPet: row.rallyPet, rallySpeedPet: row.rallySpeedPet, marchCap: row.marchCap, rallyCap: row.rallyCap,
          proxyBy: clip_(p.proxyBy, 30), // 代理で入力した人の名前（本人の入力なら ""）
          updatedAt: new Date().toISOString(),
          id: existing ? existing.id : newId_("r"), eventId: ev.id, userId: user.id
        };
        if (existing) d.entries[d.entries.indexOf(existing)] = e;
        else d.entries.push(e);
        result = existing ? "updated" : "added";
      }

      d.updated = new Date().toISOString();
      var w = writeFile_(token, d, f.sha, "Self registration: " + ev.type + " " + ev.date);
      if (w.ok) {
        appendLog_({ t: d.updated, ev: ev.type + " " + ev.date, name: user.name, uid: user.id, act: result, by: clip_(p.proxyBy, 30),
          ip: String(p.ip || "").replace(/[^0-9a-fA-F:.]/g, "").slice(0, 45), ua: clip_(p.ua, 120) });
        return { ok: true, result: result, userId: user.id, name: user.name };
      }
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
    entry: m.entry === "late" || m.entry === "absent" ? m.entry : "start",
    grade: GRADES.indexOf(grade) >= 0 ? grade : "その他",
    monthly: m.monthly === true,
    leaveEarly: m.leaveEarly === true,
    vc: m.vc === true,
    vivian4: m.vivian4 === true,
    mayChange: m.mayChange === true,
    troops: "歩騎弓".split("").filter(function(t) { return troopsIn.indexOf(t) >= 0; }).join(""),
    tier: tier >= 1 && tier <= 30 && Math.floor(tier) === tier ? tier : null,
    joinAt: clip_(m.joinAt, 20),
    leaveAt: clip_(m.leaveAt, 20),
    note: clip_(m.note, 100),
    marchCount: count_(m.marchCount),
    marchPet: count_(m.marchPet, 10),
    rallyCount: count_(m.rallyCount),
    rallyPet: count_(m.rallyPet, 10),
    rallySpeedPet: count_(m.rallySpeedPet, 8)
  };
  if (r.leaveAt) r.leaveEarly = true;
  var c = calcCap_(r);
  r.marchCap = c.march;
  r.rallyCap = c.rally;
  return r;
}

// 計算後の容量（管理画面の calcCapacity と同じ条件）: 出征スキル・集結スキルあり、バフ20%をスキルなしの出征容量にかけ、
// 出征で増えた分（スキル＋バフ）はそのまま集結容量にも入る
function calcCap_(m) {
  var mUp = (m.marchPet ? 1500 * m.marchPet : 0) + (m.marchCount != null ? Math.floor(m.marchCount * 0.2) : 0);
  return {
    march: m.marchCount != null ? m.marchCount + mUp : null,
    rally: m.rallyCount != null ? m.rallyCount + mUp + (m.rallyPet ? 50000 + 10000 * m.rallyPet : 0) : null
  };
}

function findUser_(users, name) {
  var k = key_(name);
  return users.filter(function(u) { return key_(u.name) === k; })[0]
    || users.filter(function(u) { return (u.aliases || []).some(function(a) { return key_(a) === k; }); })[0]
    || null;
}

// 部隊数・ペットLv（0〜max の整数。max 省略時は 99,999,999（部隊数は容量の数字で 100万を超える）。空や範囲外なら null）
function count_(v, max) {
  var n = Number(String(v == null ? "" : v).replace(/[,，]/g, ""));
  return String(v == null ? "" : v).trim() !== "" && n >= 0 && n <= (max || 99999999) && Math.floor(n) === n ? n : null;
}

function key_(s) { return String(s).trim().toLowerCase(); }
// ---------- 個人登録の記録 ----------
// スクリプトプロパティ（非公開）に selfLog_<番号> として LOG_CHUNK 件ずつ保存し、古いものから消す（最大 LOG_CHUNK × LOG_MAX_CHUNKS 件）。
// IP は登録ページが調べて送る値（GAS は相手のIPを受け取れないため）。目安として扱う
var LOG_CHUNK = 25;       // 1つの値は9KBまでなので、1件200バイト前後×25件に収める
var LOG_MAX_CHUNKS = 80;  // 約2,000件

// ---------- IPブラックリスト ----------
// スクリプトプロパティ BLOCK_IPS（非公開）に [{ ip, note, at }] で保存。ip の末尾が * なら前方一致
function readBlocklist_() {
  return JSON.parse(PropertiesService.getScriptProperties().getProperty("BLOCK_IPS") || "[]");
}

function writeBlocklist_(list) {
  if (!Array.isArray(list)) return { ok: false, status: 400, error: "一覧の形式が違います" };
  var clean = list.slice(0, 500).map(function(b) {
    return { ip: String(b.ip || "").replace(/[^0-9a-fA-F:.*]/g, "").slice(0, 46), note: clip_(b.note, 60), at: clip_(b.at, 30) };
  }).filter(function(b) { return b.ip && b.ip !== "*"; });
  PropertiesService.getScriptProperties().setProperty("BLOCK_IPS", JSON.stringify(clean));
  return { ok: true, blocklist: clean };
}

function isBlocked_(ip) {
  if (!ip) return false;
  return readBlocklist_().some(function(b) {
    return b.ip.slice(-1) === "*" ? ip.indexOf(b.ip.slice(0, -1)) === 0 : ip === b.ip;
  });
}

function appendLog_(rec) {
  try {
    var props = PropertiesService.getScriptProperties();
    var meta = JSON.parse(props.getProperty("selfLog_meta") || '{"first":0,"last":0}');
    var key = "selfLog_" + meta.last;
    var list = JSON.parse(props.getProperty(key) || "[]");
    if (list.length >= LOG_CHUNK) {
      meta.last++;
      key = "selfLog_" + meta.last;
      list = [];
    }
    list.push(rec);
    props.setProperty(key, JSON.stringify(list));
    while (meta.last - meta.first + 1 > LOG_MAX_CHUNKS) {
      props.deleteProperty("selfLog_" + meta.first);
      meta.first++;
    }
    props.setProperty("selfLog_meta", JSON.stringify(meta));
  } catch (err) {
    // 記録に失敗しても登録自体は成功扱いにする
  }
}

// 新しい順
function readLog_() {
  var props = PropertiesService.getScriptProperties();
  var meta = JSON.parse(props.getProperty("selfLog_meta") || '{"first":0,"last":0}');
  var all = [];
  for (var i = meta.first; i <= meta.last; i++) {
    all = all.concat(JSON.parse(props.getProperty("selfLog_" + i) || "[]"));
  }
  return all.reverse();
}

function clip_(v, n) { return String(v == null ? "" : v).replace(/[\r\n\t]/g, " ").trim().slice(0, n); }
function newId_(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ---------- GitHub ----------

function fileUrl_() {
  return "https://api.github.com/repos/" + GH.owner + "/" + GH.repo + "/contents/" + GH.path;
}

function ghHeaders_(token) {
  return { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" };
}

// ---------- データの保存先（Google ドライブの非公開ファイル） ----------
// 戻り値の sha は保存のたびに増える版番号。writeFile_ に渡した sha が今の版と違えば、その間に誰かが保存したので 409 を返す
// （呼び出し側は読み直してやり直す）。token は GitHub 時代の名残で使わない
function readFile_(token) {
  var props = PropertiesService.getScriptProperties();
  var text = DriveApp.getFileById(props.getProperty("DATA_FILE_ID")).getBlob().getDataAsString("UTF-8");
  return { ok: true, data: JSON.parse(text || "{}"), sha: props.getProperty("DATA_VERSION") || "0" };
}

// 呼び出し側で LockService のロックを取ってから呼ぶこと（版番号の確認と書き込みの間に割り込まれないように）
function writeFile_(token, data, sha, message) {
  var props = PropertiesService.getScriptProperties();
  var version = props.getProperty("DATA_VERSION") || "0";
  if (sha != null && String(sha) !== version) return { ok: false, status: 409, error: "直前に他の人が保存しました" };
  var text = JSON.stringify(data, null, 2) + "\n";
  if (text.length > MAX_BYTES) return { ok: false, status: 413, error: "データが大きすぎます。管理者に連絡してください" };
  DriveApp.getFileById(props.getProperty("DATA_FILE_ID")).setContent(text);
  props.setProperty("DATA_VERSION", String(Number(version) + 1));
  return { ok: true };
}

// GitHub の data/members.json を読む（移行用）
function readGitHub_(token) {
  if (!token) return { ok: false, status: 500, error: "GITHUB_TOKEN がありません" };
  var r = UrlFetchApp.fetch(fileUrl_() + "?ref=" + GH.branch, { headers: ghHeaders_(token), muteHttpExceptions: true });
  var code = r.getResponseCode();
  if (code === 404) return { ok: false, status: 404, error: "GitHub に data/members.json がありません" };
  if (code !== 200) return { ok: false, status: code, error: "GitHubから取得できませんでした" };
  var j = JSON.parse(r.getContentText());
  var text = Utilities.newBlob(Utilities.base64Decode(j.content.replace(/\s/g, ""))).getDataAsString("UTF-8");
  return { ok: true, data: JSON.parse(text || "{}") };
}

function importFromGitHub_(token) {
  var g = readGitHub_(token);
  if (!g.ok) return g;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, status: 503, error: "混み合っています" };
  try {
    var w = writeFile_(token, g.data, null, "import");
    if (!w.ok) return w;
    return { ok: true, users: (g.data.users || []).length, entries: (g.data.entries || []).length };
  } finally {
    lock.releaseLock();
  }
}

// 初回だけエディタから実行する: ドライブにデータ用ファイルを作り、GitHub の data/members.json をコピーする
// ---------- Discord の招待リンク ----------
// Discord は Google（GAS）のサーバーからの通信を断る（403 / 40333 internal network error）ため、
// リンクを作るのは GitHub Actions（.github/workflows/discord-invite.yml、毎朝5時台）。作ったリンクを
// action=setDiscordInvite（パスワード必須）でここに送ってきて、pubGet の discordInvite で個人登録ページに出す。
//   DISCORD_INVITE / DISCORD_INVITE_AT : 今の招待リンクと、受け取った日時（自動）
function setDiscordInvite_(invite) {
  var url = String(invite || "");
  if (!/^https:\/\/discord\.gg\/[A-Za-z0-9-]{2,32}$/.test(url)) return { ok: false, status: 400, error: "招待リンクの形が違います" };
  var props = PropertiesService.getScriptProperties();
  props.setProperty("DISCORD_INVITE", url);
  props.setProperty("DISCORD_INVITE_AT", new Date().toISOString());
  return { ok: true, invite: url };
}

// 以前 GAS で作り直していたときのトリガーの後始末（トリガーから呼ばれたら自分を消す）
function refreshDiscordInvite() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "refreshDiscordInvite") ScriptApp.deleteTrigger(t);
  });
  Logger.log("招待リンクの作り直しは GitHub Actions に移しました（このトリガーは消しました）");
}

function setupStorage() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("DATA_FILE_ID");
  if (id) {
    Logger.log("設定済みです: " + DriveApp.getFileById(id).getName() + " (" + id + ")");
    return;
  }
  var g = readGitHub_(props.getProperty("GITHUB_TOKEN"));
  var text = JSON.stringify(g.ok ? g.data : { users: [], events: [], entries: [], notSame: [] }, null, 2) + "\n";
  var file = DriveApp.createFile(DATA_FILE_NAME, text, MimeType.PLAIN_TEXT);
  props.setProperty("DATA_FILE_ID", file.getId());
  props.setProperty("DATA_VERSION", "1");
  Logger.log("ドライブにデータ用ファイルを作りました: " + file.getName() + " (" + file.getId() + ") " +
    (g.ok ? "GitHub からユーザー" + (g.data.users || []).length + "人・参加情報" + (g.data.entries || []).length + "件をコピー" : "空で作成（" + g.error + "）"));
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
