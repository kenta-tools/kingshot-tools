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
 *   - 問い合わせ・質問フォーム（inquiry/index.html）:
 *     パスワードなしで送信（askSave）。回答済みの質問はpubGetに同梱（質問者名は含めない）。
 *     管理画面（admin/inquiries.html）でパスワード付きで一覧取得（getInquiries）・回答の保存（answerInquiry）
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
var RUIN_TYPE = "遺跡争奪";                       // 時間ごとに参加できるかを登録するイベント
var RUIN_SLOTS = ["12", "18", "22", "23", "25"];  // 遺跡争奪の時間（25＝翌1時）。entry/index.html と同じ
var SELF_SAME_IP_MIN = 30;   // 代理入力モードでないとき、同じIPから別の人の登録が続くのを断る時間（分）
var SELF_UNDO_MAX = 400;     // 個人登録の「変更前の内容」を残す件数（いたずらを元に戻すため。d.selfUndo、非公開）

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
    // 問い合わせ・質問フォーム用（パスワード不要）
    if (p.action === "askSave") return json_(askSave_(token, p));
    // チーム分けの公開分（teams/ の閲覧ページ・個人登録ページ用。パスワード不要、公開ボタンを押したものだけ）
    if (p.action === "teamsGet") return json_(teamsGet_(token));

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
    if (p.action === "setDiscordInvite") return json_(setDiscordInvite_(p.invite, p.key));
    // いたずらの取り消し: 指定IP（末尾 * で前方一致）からの個人登録を、新しい順に元へ戻す（dryRun なら一覧だけ）
    if (p.action === "revertByIp") return json_(revertByIp_(token, p));
    // KvK相手突合せの「うちの誰が相手の誰と対戦するか」の保存（管理者のみ）。組み合わせ（パターン）を複数持てる。matchupId なしは「標準」を上書き
    if (p.action === "matchupSave") return json_(matchupSave_(token, p));
    // 組み合わせの名前変更・削除（管理者のみ）
    if (p.action === "matchupRename") return json_(matchupRename_(token, p));
    if (p.action === "matchupDelete") return json_(matchupDelete_(token, p));
    // KvK同着カウントダウン表の共有タブの追加・名前変更・並べ替え・削除・突合せの選択（管理者のみ）
    if (p.action === "kvkTabs") return json_(kvkTabs_(token, p));
    // KvK同着カウントダウン表「チャット用テキストの履歴」の保存・削除（管理者のみ。閲覧はpubGetのkvkChatHistory）
    if (p.action === "kvkHistSave" || p.action === "kvkHistDelete") return json_(kvkHist_(token, p));
    // KvK相手突合せで「ゲーム内の名前」を登録済みユーザーの旧名（別表記）に追加する（次回から名前が自動で一致する）
    if (p.action === "addAlias") return json_(addAlias_(token, p));
    // 問い合わせ・質問の一覧（管理者のみ。未回答も含めて全部見られる）
    if (p.action === "getInquiries") return json_(getInquiries_(token));
    // 問い合わせへの回答を保存（管理者のみ）
    if (p.action === "answerInquiry") return json_(answerInquiry_(token, p));
    // チーム分け（admin/teams.html、管理者のみ）の下書き保存・公開・非公開。イベントID単位で1件
    if (p.action === "teamSave") return json_(teamSave_(token, p));

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
// 確認事項（アンケート）の答えは管理者だけが見られる。誰でも読める pubGet には出さない
var SURVEY_RULE_ID = "q_rule"; // 固定の設問（ルール未理解のチェック）の答えのキー。イベントの設問データには持たない

function noSurvey_(x) {
  if (!x.survey && !x.surveyProxy) return x;
  var c = {};
  Object.keys(x).forEach(function(k) { if (k !== "survey" && k !== "surveyProxy") c[k] = x[k]; });
  return c;
}

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
    entries: (d.entries || []).filter(function(x) { return ids[x.eventId]; }).map(noSurvey_),
    // kvkRosters/flameRostersは終了したイベント分も含めて全部返す（終了後も閲覧はできるようにするため。
    // 更新を締め切るかどうかはクライアント側で「そのイベントがopenか」を見て判断する）
    kvkChatHistory: d.kvkChatHistory || [], // チャット用テキストの履歴（イベントごと。閲覧は誰でも）
    kvkRosters: (d.kvkRosters || []).map(kvkRosterNorm_), // 各イベントの共有名簿。tabs（名前付きタブ）を補って返す（昔の1つの名簿は「標準」タブ）
    flameRosters: d.flameRosters || [],
    // KvK相手突合せで保存した「うちの誰が相手の誰と対戦するか」（名前のペアのみ。管理者のみ保存可、閲覧はパスワード不要）
    matchupPairs: matchupList_(d), // 組み合わせ（パターン）の一覧。昔の1件は id=eventId・name「標準」で返す
    // 問い合わせ・質問のうち回答済みのものだけ（質問者の名前は含めない。未回答はgetInquiries＝管理者のみ）
    inquiries: (d.inquiries || []).filter(function(i) { return i.answered; }).map(function(i) {
      return { id: i.id, text: i.text, answerText: i.answerText, answeredAt: i.answeredAt };
    }),
    history: {
      // doneはKvK相手突合せ・聖剣リーグ等の自動更新が「このイベントは終わったか」を判断するのに使う（パスワード不要で見られる）
      events: (d.events || []).map(function(e) { return { id: e.id, type: e.type, date: e.date, done: e.done === true }; }),
      entries: (d.entries || []).map(noSurvey_)
    },
    // Discord の招待リンク（GitHub Actions が毎朝作り直して setDiscordInvite で送ってくる。未設定なら ""）
    discordInvite: PropertiesService.getScriptProperties().getProperty("DISCORD_INVITE") || "",
    // 816用Discordサーバーの招待リンク（EGG新規加入者マニュアルが読む。未設定なら ""）
    discordInvite816: PropertiesService.getScriptProperties().getProperty("DISCORD_INVITE_816") || ""
  };
}

// KvK同着カウントダウン表「共有用」画面の名簿。イベントID単位で1件、その中に名前付きの「タブ」を複数持てる（1イベント10タブまで）。
// 1件: { eventId, rows（＝最初のタブ＝設定の行。古い画面との互換用）, updatedAt, tabs: [{id, title, kind, site, matchupId, rows, updatedAt}, ...] }
// 2026-11-08 タブの作り直し：tabs[0] は必ず kind:"settings"（id "settings"・左端固定・複製/削除/名前変更/移動不可）。ほかは kind:"tab"（拠点 site を選び、設定の行を id で参照する）。
// 設定の行: {id,name,plain{拠点:秒|null},petOv{拠点:秒|null},adj,petLevel,group,opponentName,opponentSec} ／ 名簿タブの行: {id(設定の行のid),usePet,own,ownSec}
// 昔の形（settingsタブが無い）は読まずに、設定＋名簿1の新しい形として扱う（旧データの変換はしない）。
var KVK_MAX_TABS = 11; // 「設定」タブ＋名簿タブ10個
var KVK_SITES = ["castle", "north", "east", "south", "west"]; // 王城・北砲台・東砲台・南砲台・西砲台

function kvkSiteMap_(src, round) {
  var o = {};
  KVK_SITES.forEach(function(k) {
    var v = src ? numOrNull_(src[k]) : null;
    if (v !== null && round) v = Math.round(v);
    o[k] = v;
  });
  return o;
}

// 設定タブの行
function kvkSettingsRows_(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 500).map(function(r) {
    return {
      id: clip_(r.id, 24),
      name: clip_(r.name, 30),
      plain: kvkSiteMap_(r.plain, false),
      petOv: kvkSiteMap_(r.petOv, true),
      adj: numOrNull_(r.adj) || 0, // 遅延秒数
      petLevel: count_(r.petLevel, 8) || 0,
      group: clip_(r.group, 20),
      opponentName: clip_(r.opponentName, 30),
      opponentSec: numOrNull_(r.opponentSec)
    };
  }).filter(function(r) { return r.name && r.id; });
}

// 名簿タブの行（設定の行を id で参照する）
function kvkTabRows_(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 500).map(function(r) {
    var os = numOrNull_(r.own === true ? r.ownSec : null);
    return { id: clip_(r.id, 24), usePet: r.usePet !== false, own: r.own === true, ownSec: os === null ? (r.own === true && numOrNull_(r.ownSec) !== null ? Math.round(numOrNull_(r.ownSec)) : null) : Math.round(os) };
  }).filter(function(r) { return r.id; });
}

function kvkRowsFor_(kind, rows) { return kind === "settings" ? kvkSettingsRows_(rows) : kvkTabRows_(rows); }

function kvkDefaultTabs_() {
  return [
    { id: "settings", title: "設定", kind: "settings", site: "", matchupId: "", rows: [], updatedAt: "" },
    { id: "main", title: "名簿1", kind: "tab", site: "castle", matchupId: "", rows: [], updatedAt: "" }
  ];
}

// 保存データの1件から、タブの一覧を取り出す（tabsなしの昔の形は「標準」1つにする）。1件も無ければ []
function kvkTabsOf_(rec) {
  if (!rec) return [];
  if (Array.isArray(rec.tabs) && rec.tabs.length && rec.tabs[0].kind === "settings") {
    return rec.tabs.map(function(t) {
      var settings = t.kind === "settings";
      return { id: t.id, title: settings ? "設定" : (t.title || "名簿"), kind: settings ? "settings" : "tab",
        site: settings ? "" : (KVK_SITES.indexOf(t.site) >= 0 ? t.site : "castle"),
        matchupId: t.matchupId || "", rows: t.rows || [], updatedAt: t.updatedAt || "" };
    });
  }
  return kvkDefaultTabs_(); // 昔の形：新しい形（設定＋名簿1）として扱う。保存されるまで元のデータは触らない
}

// pubGet で返す形：tabs を補う（rows は最初のタブの名簿のまま）
function kvkRosterNorm_(rec) {
  var o = {};
  Object.keys(rec).forEach(function(k) { o[k] = rec[k]; });
  o.tabs = kvkTabsOf_(rec);
  return o;
}

function kvkRecordOf_(d, eventId) {
  d.kvkRosters = d.kvkRosters || [];
  return d.kvkRosters.filter(function(x) { return x.eventId === eventId; })[0];
}

// 保存データに書き戻す。rows（最初のタブの名簿）は古い画面との互換用に同期する
function kvkPutTabs_(d, eventId, tabs) {
  var rec = kvkRecordOf_(d, eventId);
  var now = new Date().toISOString();
  var record = { eventId: eventId, rows: (tabs[0] && tabs[0].rows) || [], updatedAt: now, tabs: tabs };
  if (rec) d.kvkRosters[d.kvkRosters.indexOf(rec)] = record; else d.kvkRosters.push(record);
}

// p: { eventId, rows: [...], tabId?, baseUpdatedAt?, force? }
//   tabId なし（古い画面）：最初のタブの名簿を上書き。tabId あり：そのタブだけ上書き（baseUpdatedAt が今と違えば、他の人が先に更新したので止める。force なら上書き）
function kvkSave_(token, p) {
  var cache = CacheService.getScriptCache();
  var minuteKey = "kvk_" + Math.floor(Date.now() / 60000);
  var count = Number(cache.get(minuteKey) || 0);
  if (count >= SELF_LIMIT_PER_MIN) return { ok: false, status: 429, error: "混み合っています。1分ほど待ってからもう一度押してください" };
  cache.put(minuteKey, String(count + 1), 120);

  if (!p.eventId) return { ok: false, status: 400, error: "イベントが選ばれていません" };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, status: 503, error: "混み合っています。少し待ってからもう一度押してください" };
  try {
    for (var attempt = 0; attempt < 3; attempt++) {
      var f = readFile_(token);
      if (!f.ok) return f;
      var d = f.data;
      if (!isEventEditable_(d, p.eventId)) return { ok: false, status: 403, error: "このイベントは終了（完了）しているため更新できません" };
      var tabs = kvkTabsOf_(kvkRecordOf_(d, p.eventId));
      if (!tabs.length) tabs = kvkDefaultTabs_();
      var tab = p.tabId ? tabs.filter(function(t) { return t.id === p.tabId; })[0] : tabs[0];
      if (!tab) return { ok: false, status: 404, error: "そのタブが見つかりません（削除された可能性があります）" };
      if (p.tabId && p.baseUpdatedAt != null && !p.force && String(tab.updatedAt || "") !== String(p.baseUpdatedAt)) {
        return { ok: false, status: 409, conflict: true, error: "他の人が先にこのタブを更新しました", updatedAt: tab.updatedAt };
      }
      tab.rows = kvkRowsFor_(tab.kind, p.rows);
      tab.updatedAt = new Date().toISOString();
      kvkPutTabs_(d, p.eventId, tabs);

      d.updated = new Date().toISOString();
      var w = writeFile_(token, d, f.sha, "KvK shared roster saved");
      if (w.ok) return { ok: true, tabId: tab.id, updatedAt: tab.updatedAt };
      if (w.status !== 409 && w.status !== 422) return w;
      // 直前に他の人が保存した → 取り直してもう一度
    }
    return { ok: false, status: 409, error: "混み合っています。もう一度押してください" };
  } finally {
    lock.releaseLock();
  }
}

// 共有タブの追加・名前変更・並べ替え・削除・突合せの選択（管理者のみ）。受付中のイベントだけ。
// p: { eventId, op: "add"|"rename"|"move"|"delete"|"setMatchup", tabId?, title?, rows?, matchupId?, order? }
// 返す tabs は全タブ（id・title・matchupId・rows・updatedAt）。画面はこれで置き換える
function kvkTabs_(token, p) {
  if (!p.eventId) return { ok: false, status: 400, error: "イベントが選ばれていません" };
  var op = p.op;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, status: 503, error: "混み合っています。少し待ってからもう一度押してください" };
  try {
    for (var attempt = 0; attempt < 3; attempt++) {
      var f = readFile_(token);
      if (!f.ok) return f;
      var d = f.data;
      if (!isEventEditable_(d, p.eventId)) return { ok: false, status: 403, error: "このイベントは終了（完了）しているため更新できません" };
      var tabs = kvkTabsOf_(kvkRecordOf_(d, p.eventId));
      if (!tabs.length) tabs = kvkDefaultTabs_();
      var tab = p.tabId ? tabs.filter(function(t) { return t.id === p.tabId; })[0] : null;
      // 設定タブは、複製（kind:settingsの追加）・名前変更・削除・移動を受け付けない
      if (tab && tab.kind === "settings" && (op === "rename" || op === "delete" || op === "setSite")) return { ok: false, status: 400, error: "設定タブは変更できません" };
      var result = {};

      if (op === "add") {
        if (p.kind === "settings") return { ok: false, status: 400, error: "設定タブは追加・複製できません" };
        if (tabs.length >= KVK_MAX_TABS) return { ok: false, status: 400, error: "タブは「設定」のほかに" + (KVK_MAX_TABS - 1) + "個までです" };
        var title = clip_(p.title, 20) || "名簿" + tabs.length;
        var nt = { id: "t" + Utilities.getUuid().replace(/-/g, "").slice(0, 8), title: title, kind: "tab", site: KVK_SITES.indexOf(p.site) >= 0 ? p.site : "castle", matchupId: clip_(p.matchupId, 40),
          rows: kvkTabRows_(p.rows), updatedAt: new Date().toISOString() };
        tabs.push(nt);
        result.tabId = nt.id;
      } else if (op === "rename") {
        if (!tab) return { ok: false, status: 404, error: "そのタブが見つかりません" };
        var name = clip_(p.title, 20);
        if (!name) return { ok: false, status: 400, error: "タブの名前を入れてください" };
        tab.title = name;
      } else if (op === "setSite") {
        if (!tab) return { ok: false, status: 404, error: "そのタブが見つかりません" };
        if (KVK_SITES.indexOf(p.site) < 0) return { ok: false, status: 400, error: "拠点が正しくありません" };
        tab.site = p.site;
      } else if (op === "setMatchup") {
        if (!tab) return { ok: false, status: 404, error: "そのタブが見つかりません" };
        tab.matchupId = clip_(p.matchupId, 40);
      } else if (op === "move") {
        var order = Array.isArray(p.order) ? p.order : [];
        var byId = {};
        tabs.forEach(function(t) { byId[t.id] = t; });
        var next = [];
        order.forEach(function(id) { if (byId[id]) { next.push(byId[id]); delete byId[id]; } });
        tabs.forEach(function(t) { if (byId[t.id]) next.push(t); }); // 指定に無かったタブは末尾へ（他の人が追加したタブを消さない）
        // 設定タブは常に左端
        var st = next.filter(function(t) { return t.kind === "settings"; })[0];
        if (st) { next.splice(next.indexOf(st), 1); next.unshift(st); }
        tabs = next;
      } else if (op === "delete") {
        if (!tab) return { ok: false, status: 404, error: "そのタブが見つかりません（すでに削除された可能性があります）" };
        if (tabs.length <= 2) return { ok: false, status: 400, error: "名簿タブは最後の1つを削除できません" };
        tabs.splice(tabs.indexOf(tab), 1);
      } else {
        return { ok: false, status: 400, error: "不明な操作です" };
      }

      kvkPutTabs_(d, p.eventId, tabs);
      d.updated = new Date().toISOString();
      var w = writeFile_(token, d, f.sha, "KvK shared tabs: " + op);
      if (w.ok) { result.ok = true; result.tabs = tabs; return result; }
      if (w.status !== 409 && w.status !== 422) return w;
    }
    return { ok: false, status: 409, error: "混み合っています。もう一度押してください" };
  } finally {
    lock.releaseLock();
  }
}

// チャット用テキストの履歴: [{id, eventId, tabTitle, savedAt, items:[{key, text}]}]。イベントごとに最大50件、古いものから消える。
// 保存（kvkHistSave）・削除（kvkHistDelete）は管理者パスワード必須（呼び出し側で確認済み）。
var KVK_HIST_MAX = 50;
function kvkHist_(token, p) {
  if (!p.eventId) return { ok: false, status: 400, error: "イベントが選ばれていません" };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, status: 503, error: "混み合っています。少し待ってからもう一度押してください" };
  try {
    for (var attempt = 0; attempt < 3; attempt++) {
      var f = readFile_(token);
      if (!f.ok) return f;
      var d = f.data;
      var all = d.kvkChatHistory || [];
      if (p.action === "kvkHistSave") {
        if (!isEventEditable_(d, p.eventId)) return { ok: false, status: 403, error: "このイベントは終了（完了）しているため保存できません" };
        var items = (Array.isArray(p.items) ? p.items : []).slice(0, 20).map(function(it) {
          return { key: clip_(it.key, 30), text: String(it.text == null ? "" : it.text).slice(0, 5000) };
        }).filter(function(it) { return it.key && it.text; });
        if (!items.length) return { ok: false, status: 400, error: "保存する項目がありません" };
        all.push({ id: "h" + Utilities.getUuid().replace(/-/g, "").slice(0, 10), eventId: p.eventId, tabTitle: clip_(p.tabTitle, 20),
          savedAt: new Date().toISOString(), items: items });
        var mine = all.filter(function(h) { return h.eventId === p.eventId; });
        if (mine.length > KVK_HIST_MAX) {
          var drop = {};
          mine.slice(0, mine.length - KVK_HIST_MAX).forEach(function(h) { drop[h.id] = true; });
          all = all.filter(function(h) { return !drop[h.id]; });
        }
      } else {
        var before = all.length;
        all = all.filter(function(h) { return !(h.eventId === p.eventId && h.id === p.id); });
        if (all.length === before) return { ok: false, status: 404, error: "その履歴が見つかりません（すでに削除された可能性があります）" };
      }
      d.kvkChatHistory = all;
      d.updated = new Date().toISOString();
      var w = writeFile_(token, d, f.sha, "KvK chat history: " + p.action);
      if (w.ok) return { ok: true, history: all.filter(function(h) { return h.eventId === p.eventId; }) };
      if (w.status !== 409 && w.status !== 422) return w;
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

// 共有名簿・共有タブ（kvkSave・kvkTabs）を編集できるイベントか：存在し、完了していない（受付中・進行中のどちらでも可。完了済みは閲覧のみ）
function isEventEditable_(d, eventId) {
  var ev = (d.events || []).filter(function(e) { return e.id === eventId; })[0];
  return !!(ev && ev.done !== true);
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

// KvK相手突合せ（管理者のみ・パスワード必須）の「うちの誰が相手の誰と対戦するか」の保存。
// KvK相手突合せの「うちの誰が相手の誰と対戦するか」。イベントごとに、名前を付けた「組み合わせ（パターン）」を複数持てる（1イベント10件まで、名前20文字）。
// 1件: { id, eventId, name, opponentLabel, pairs:[{ourName,ourTag,theirName,theirTag}], updatedAt }
// 昔の形（id・nameなし、イベントIDごとに1件）は id=eventId・name「標準」として扱う（保存し直さなくてよい）。
var MATCHUP_MAX_PER_EVENT = 10;
function matchupNorm_(r) {
  var o = {};
  Object.keys(r).forEach(function(k) { o[k] = r[k]; });
  o.id = r.id || r.eventId;
  o.name = r.name || "標準";
  return o;
}
function matchupList_(d) { return (d.matchupPairs || []).map(matchupNorm_); }

// p: { eventId, matchupId?, name?, opponentLabel, pairs }
//   matchupId なし（昔のページ）：「標準」（id=eventId）を上書き。matchupId="new"：新しい組み合わせを作る。それ以外：その組み合わせを上書き
function matchupSave_(token, p) {
  if (!p.eventId) return { ok: false, status: 400, error: "イベントが選ばれていません" };
  var pairs = (Array.isArray(p.pairs) ? p.pairs : []).slice(0, 200).map(function(x) {
    return {
      ourName: clip_(x.ourName, 30),
      ourTag: clip_(x.ourTag, 10),
      theirName: clip_(x.theirName, 30),
      theirTag: clip_(x.theirTag, 10)
    };
  }).filter(function(x) { return x.ourName && x.theirName; });

  return matchupEdit_(token, function(d, list) {
    if (!(d.events || []).some(function(e) { return e.id === p.eventId; })) return { error: "そのイベントが見つかりません", status: 400 };
    var mid = p.matchupId || p.eventId, isNew = mid === "new";
    var name = clip_(p.name, 20);
    var sameEvent = list.filter(function(x) { return x.eventId === p.eventId; });
    var existing = isNew ? null : sameEvent.filter(function(x) { return x.id === mid; })[0];
    if (!isNew && !existing && p.matchupId) return { error: "その組み合わせが見つかりません（削除された可能性があります）", status: 404 };
    if (isNew && sameEvent.length >= MATCHUP_MAX_PER_EVENT) return { error: "組み合わせは1イベントに" + MATCHUP_MAX_PER_EVENT + "件までです", status: 400 };
    if (!name) name = existing ? existing.name : isNew ? "パターン" + (sameEvent.length + 1) : "標準";
    var dup = sameEvent.filter(function(x) { return x.name === name && (!existing || x.id !== existing.id); })[0];
    if (dup) return { error: "同じ名前の組み合わせがあります（「" + name + "」）", status: 400 };
    var record = { id: isNew ? "m" + Utilities.getUuid().replace(/-/g, "").slice(0, 8) : (existing ? existing.id : p.eventId), eventId: p.eventId,
      name: name, opponentLabel: clip_(p.opponentLabel, 40), pairs: pairs, updatedAt: new Date().toISOString() };
    if (existing) list[list.indexOf(existing)] = record; else list.push(record);
    return { id: record.id, name: record.name };
  });
}

// 組み合わせの名前だけ変える（管理者のみ）。p: { eventId, matchupId, name }
function matchupRename_(token, p) {
  var name = clip_(p.name, 20);
  if (!p.eventId || !p.matchupId) return { ok: false, status: 400, error: "組み合わせが選ばれていません" };
  if (!name) return { ok: false, status: 400, error: "名前を入れてください" };
  return matchupEdit_(token, function(d, list) {
    var sameEvent = list.filter(function(x) { return x.eventId === p.eventId; });
    var rec = sameEvent.filter(function(x) { return x.id === p.matchupId; })[0];
    if (!rec) return { error: "その組み合わせが見つかりません", status: 404 };
    if (sameEvent.some(function(x) { return x.name === name && x.id !== rec.id; })) return { error: "同じ名前の組み合わせがあります（「" + name + "」）", status: 400 };
    rec.name = name; rec.updatedAt = new Date().toISOString();
    return { id: rec.id, name: name };
  });
}

// 組み合わせを削除（管理者のみ）。p: { eventId, matchupId }
function matchupDelete_(token, p) {
  if (!p.eventId || !p.matchupId) return { ok: false, status: 400, error: "組み合わせが選ばれていません" };
  return matchupEdit_(token, function(d, list) {
    var rec = list.filter(function(x) { return x.eventId === p.eventId && x.id === p.matchupId; })[0];
    if (!rec) return { error: "その組み合わせが見つかりません", status: 404 };
    list.splice(list.indexOf(rec), 1);
    return { id: rec.id };
  });
}

// 突合せの 読む→変える→書く。fn(d, list) は list（id・name を補った写し）を直接書き換え、{error,status} か結果のオブジェクトを返す
function matchupEdit_(token, fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, status: 503, error: "混み合っています。少し待ってからもう一度押してください" };
  try {
    for (var attempt = 0; attempt < 3; attempt++) {
      var f = readFile_(token);
      if (!f.ok) return f;
      var d = f.data, list = matchupList_(d);
      var r = fn(d, list) || {};
      if (r.error) return { ok: false, status: r.status || 400, error: r.error };
      d.matchupPairs = list;
      d.updated = new Date().toISOString();
      var w = writeFile_(token, d, f.sha, "KvK matchup pairs saved");
      if (w.ok) { r.ok = true; return r; }
      if (w.status !== 409 && w.status !== 422) return w;
      // 直前に他の人が保存した → 取り直してもう一度
    }
    return { ok: false, status: 409, error: "混み合っています。もう一度押してください" };
  } finally {
    lock.releaseLock();
  }
}

// KvK相手突合せ用：登録済みユーザー（p.userId）の aliases に p.alias（ゲーム内の名前など）を追加する。
// 別のユーザーの名前・旧名と同じなら追加しない（同一人物の取り違え防止）。すでにあれば何もしない
function addAlias_(token, p) {
  var alias = clip_(p.alias, 30);
  if (!p.userId || !alias) return { ok: false, status: 400, error: "ユーザーか名前が空です" };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, status: 503, error: "混み合っています。少し待ってからもう一度押してください" };
  try {
    for (var attempt = 0; attempt < 3; attempt++) {
      var f = readFile_(token);
      if (!f.ok) return f;
      var d = f.data;
      var users = d.users || [];
      var u = users.filter(function(x) { return x.id === p.userId; })[0];
      if (!u) return { ok: false, status: 404, error: "そのユーザーが見つかりません" };
      var k = key_(alias);
      var other = users.filter(function(x) {
        return x.id !== u.id && (key_(x.name) === k || (x.aliases || []).some(function(a) { return key_(a) === k; }));
      })[0];
      if (other) return { ok: false, status: 409, error: "「" + alias + "」は別のユーザー（" + other.name + "）の名前として登録済みです" };
      u.aliases = u.aliases || [];
      if (key_(u.name) === k || u.aliases.some(function(a) { return key_(a) === k; })) return { ok: true, user: { id: u.id, name: u.name, aliases: u.aliases } };
      u.aliases.push(alias);
      d.updated = new Date().toISOString();
      var w = writeFile_(token, d, f.sha, "alias added");
      if (w.ok) return { ok: true, user: { id: u.id, name: u.name, aliases: u.aliases } };
      if (w.status !== 409 && w.status !== 422) return w;
    }
    return { ok: false, status: 409, error: "混み合っています。もう一度押してください" };
  } finally {
    lock.releaseLock();
  }
}

// 問い合わせ・質問フォームの送信（パスワード不要）。d.inquiriesに1件追加するだけ。
// p: { name?, text }
function askSave_(token, p) {
  var cache = CacheService.getScriptCache();
  var minuteKey = "ask_" + Math.floor(Date.now() / 60000);
  var count = Number(cache.get(minuteKey) || 0);
  if (count >= SELF_LIMIT_PER_MIN) return { ok: false, status: 429, error: "混み合っています。1分ほど待ってからもう一度押してください" };
  cache.put(minuteKey, String(count + 1), 120);

  var text = clip_(p.text, 1000);
  if (!text) return { ok: false, status: 400, error: "質問の内容を入力してください" };
  var record = {
    id: newId_("q"),
    name: clip_(p.name, 30),
    text: text,
    createdAt: new Date().toISOString(),
    answered: false,
    answerText: "",
    answeredAt: null
  };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, status: 503, error: "混み合っています。少し待ってからもう一度押してください" };
  try {
    for (var attempt = 0; attempt < 3; attempt++) {
      var f = readFile_(token);
      if (!f.ok) return f;
      var d = f.data;
      d.inquiries = d.inquiries || [];
      if (d.inquiries.length >= 1000) d.inquiries.shift(); // 古いものから間引く（いたずら・肥大化対策）
      d.inquiries.push(record);

      d.updated = new Date().toISOString();
      var w = writeFile_(token, d, f.sha, "Inquiry submitted");
      if (w.ok) return { ok: true };
      if (w.status !== 409 && w.status !== 422) return w;
      // 直前に他の人が保存した → 取り直してもう一度
    }
    return { ok: false, status: 409, error: "混み合っています。もう一度押してください" };
  } finally {
    lock.releaseLock();
  }
}

// 問い合わせ・質問の一覧（管理者のみ）。未回答も含めて全部返す。
function getInquiries_(token) {
  var f = readFile_(token);
  if (!f.ok) return f;
  var d = f.data;
  return { ok: true, inquiries: (d.inquiries || []).slice().reverse() };
}

// 問い合わせへの回答を保存（管理者のみ）。p: { id, answerText }
function answerInquiry_(token, p) {
  if (!p.id) return { ok: false, status: 400, error: "質問が指定されていません" };
  var answerText = clip_(p.answerText, 2000);
  if (!answerText) return { ok: false, status: 400, error: "回答の内容を入力してください" };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, status: 503, error: "混み合っています。少し待ってからもう一度押してください" };
  try {
    for (var attempt = 0; attempt < 3; attempt++) {
      var f = readFile_(token);
      if (!f.ok) return f;
      var d = f.data;
      d.inquiries = d.inquiries || [];
      var rec = d.inquiries.filter(function(x) { return x.id === p.id; })[0];
      if (!rec) return { ok: false, status: 404, error: "その質問が見つかりません" };
      rec.answered = true;
      rec.answerText = answerText;
      rec.answeredAt = new Date().toISOString();

      d.updated = new Date().toISOString();
      var w = writeFile_(token, d, f.sha, "Inquiry answered");
      if (w.ok) return { ok: true };
      if (w.status !== 409 && w.status !== 422) return w;
      // 直前に他の人が保存した → 取り直してもう一度
    }
    return { ok: false, status: 409, error: "混み合っています。もう一度押してください" };
  } finally {
    lock.releaseLock();
  }
}

// ---------- チーム分け ----------
// d.teams: [{ eventId, draft, updatedAt, updatedBy, published, publishedAt }]
//   draft     : 管理画面（admin/teams.html）の編集内容そのまま（ユーザーIDで持つ。非公開）
//   published : 公開ボタンを押した時点の表示用データ（名前・印・時間などを埋め込み済み）。teamsGet で誰でも見られる
var TEAM_JSON_MAX = 300 * 1024;

// チーム分けの保存（管理者のみ）。p: { eventId, draft, baseUpdatedAt, publish: "keep"|"publish"|"unpublish", view?, by? }
// 完了したイベント（events[].done）は、どの保存も403で拒否する（2026-11-08）
// baseUpdatedAt は読み込んだ時点の updatedAt。違えば他の管理者が先に保存しているので、上書きせず最新を返す（force で上書き）
function teamSave_(token, p) {
  if (!p.eventId) return { ok: false, status: 400, error: "イベントが選ばれていません" };
  if (!p.draft || typeof p.draft !== "object") return { ok: false, status: 400, error: "チーム分けの内容がありません" };
  if (JSON.stringify(p.draft).length > TEAM_JSON_MAX) return { ok: false, status: 413, error: "データが大きすぎます" };
  var publish = p.publish === "publish" || p.publish === "unpublish" ? p.publish : "keep";
  if (publish === "publish") {
    if (!p.view || typeof p.view !== "object") return { ok: false, status: 400, error: "公開する内容がありません" };
    if (JSON.stringify(p.view).length > TEAM_JSON_MAX) return { ok: false, status: 413, error: "データが大きすぎます" };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, status: 503, error: "混み合っています。少し待ってからもう一度押してください" };
  try {
    for (var attempt = 0; attempt < 3; attempt++) {
      var f = readFile_(token);
      if (!f.ok) return f;
      var d = f.data;
      var ev = (d.events || []).filter(function(e) { return e.id === p.eventId; })[0];
      if (!ev) return { ok: false, status: 400, error: "そのイベントが見つかりません" };
      // 完了したイベントは、下書き保存・公開・非公開のどれも受け付けない（画面だけで止めず、ここでも拒否する）
      if (ev.done === true) return { ok: false, status: 403, error: "このイベントは完了しているため、チーム分けは保存・公開できません" };
      d.teams = d.teams || [];
      var existing = d.teams.filter(function(x) { return x.eventId === p.eventId; })[0];
      if (existing && !p.force && (p.baseUpdatedAt || "") !== (existing.updatedAt || "")) {
        return { ok: false, status: 409, conflict: true, error: "ほかの人が先に保存しています", record: existing };
      }
      var now = new Date().toISOString();
      var record = {
        eventId: p.eventId,
        draft: p.draft,
        updatedAt: now,
        updatedBy: clip_(p.by, 30),
        published: existing ? existing.published || null : null,
        publishedAt: existing ? existing.publishedAt || "" : ""
      };
      if (publish === "publish") { record.published = p.view; record.publishedAt = now; }
      if (publish === "unpublish") { record.published = null; record.publishedAt = ""; }
      if (existing) d.teams[d.teams.indexOf(existing)] = record;
      else d.teams.push(record);

      d.updated = now;
      var w = writeFile_(token, d, f.sha, "Teams saved");
      if (w.ok) return { ok: true, record: record };
      if (w.status !== 409 && w.status !== 422) return w;
      // 直前に他の人が保存した → 取り直してもう一度
    }
    return { ok: false, status: 409, error: "混み合っています。もう一度押してください" };
  } finally {
    lock.releaseLock();
  }
}

// 公開済みのチーム分けだけを返す（パスワード不要）。下書き（draft）は返さない
function teamsGet_(token) {
  var f = readFile_(token);
  if (!f.ok) return f;
  var d = f.data;
  var events = {};
  (d.events || []).forEach(function(e) { events[e.id] = e; });
  return {
    ok: true,
    teams: (d.teams || []).filter(function(t) { return t.published && events[t.eventId]; }).map(function(t) {
      var e = events[t.eventId];
      return { eventId: t.eventId, type: e.type, date: e.date, done: e.done === true, publishedAt: t.publishedAt, view: t.published };
    })
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
      if (row && ev.type === RUIN_TYPE) {
        // 遺跡争奪は、対象（要塞・遺跡）のある時間を全部選んでもらう（対象が未登録なら全部の時間）。
        // 対象のない時間は保存しない。どこかに参加（行けるかも含む）なら参加扱い
        var times = RUIN_SLOTS.filter(function(k) { return ev.ruinTargets && (ev.ruinTargets[k] || []).length; });
        if (!times.length) times = RUIN_SLOTS;
        if (!row.slots || times.some(function(k) { return !row.slots[k]; })) return { ok: false, status: 400, error: "参加できる時間を全部選んでください" };
        var kept = {};
        times.forEach(function(k) { kept[k] = row.slots[k]; });
        row.slots = kept;
        row.entry = times.some(function(k) { return row.slots[k] !== "no"; }) ? "start" : "absent";
      } else if (row) {
        delete row.slots;
      }
      // 確認事項（アンケート）。固定の設問「そもそも{種類}のルールがあまりわかってません」（SURVEY_RULE_ID）は、どのイベントにも出る。
      //   チェックした人（答えが check）は、ほかの設問に答えなくてよい。チェックしなくても登録はできる（この設問は必須ではない）。
      // イベントの設問（ev.survey = [{id, text, show?}]）は、不参加以外は全部答えてもらう（ok＝了解／unknown＝内容わかりません）。
      //   show: "rally"＝集結の欄（集結部隊数など）を入れた人だけに出す。古いデータの kind:"skip" の設問は、固定の設問に置き換わったので無視する。
      // 代理入力は答えを持たず、本人に伝える設問があるときに「連携します」（surveyProxy）のチェックだけ
      if (row) {
        var rallyOn = row.rallyCount != null || row.rallyPet != null || row.rallySpeedPet != null;
        var askQ = (Array.isArray(ev.survey) ? ev.survey : []).filter(function(q) { return q && q.id && q.text && q.kind !== "skip" && (q.show !== "rally" || rallyOn); });
        var ans = row.survey || {}, link = row.surveyProxy === true;
        delete row.survey; delete row.surveyProxy;
        if (row.entry !== "absent") {
          if (clip_(p.proxyBy, 30)) {
            if (askQ.length) {
              if (!link) return { ok: false, status: 400, error: "確認事項の「連携します」にチェックしてください" };
              row.surveyProxy = true;
            }
          } else if (ans[SURVEY_RULE_ID] === "check") {
            row.survey = {};
            row.survey[SURVEY_RULE_ID] = "check";
          } else {
            var keptAns = {};
            askQ.forEach(function(q) { if (ans[q.id] === "ok" || ans[q.id] === "unknown") keptAns[q.id] = ans[q.id]; });
            if (askQ.some(function(q) { return !keptAns[q.id]; })) return { ok: false, status: 400, error: "確認事項に全部答えてください" };
            if (askQ.length) row.survey = keptAns;
          }
        }
      }

      // ユーザーを決める: 候補から選んだ人 → 名前（旧名含む）が一致する人 → 新規
      var user = p.userId ? d.users.filter(function(u) { return u.id === p.userId; })[0] : null;
      var userSnap = user ? snapUser_(user) : null; // 名前を変える前の状態（元に戻すため）
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
      d.selfUndo = d.selfUndo || [];
      var proxyBy = clip_(p.proxyBy, 30);
      // 代理入力モードの入力者は、先にこのイベントに自分を登録している人だけ（名前は登録済みの今の名前にそろえる）
      if (proxyBy) {
        var pu = findUser_(d.users, proxyBy);
        if (!pu || !d.entries.some(function(x) { return x.eventId === ev.id && x.userId === pu.id; })) {
          return { ok: false, status: 403, error: "代理入力モードを使う前に、まず自分を登録してください" };
        }
        proxyBy = pu.name;
      }
      // 代理入力モードでないのに、同じIPから短い時間に別の人の登録が続く → 断る（家族などは代理入力モードで）
      if (ip && !proxyBy) {
        var since = Date.now() - SELF_SAME_IP_MIN * 60000, uid = user ? user.id : "";
        var other = d.selfUndo.filter(function(r) {
          return r.ip === ip && !r.by && !r.reverted && r.uid !== uid && Date.parse(r.t) >= since;
        })[0];
        if (other) return { ok: false, status: 429, error: "他の人を入力する場合は、代理入力モードからお願いします" };
      }
      // 変更前の内容（いたずらを元に戻すため）
      var undo = { t: "", ip: ip, by: proxyBy, uid: "", ev: ev.id, act: "",
        userBefore: userSnap || (user ? snapUser_(user) : null), entryBefore: null, afterAt: "", userAfterName: "" };
      var nowEntry = user && d.entries.filter(function(x) { return x.eventId === ev.id && x.userId === user.id; })[0];
      if (nowEntry) undo.entryBefore = JSON.parse(JSON.stringify(nowEntry));
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
          slots: row.slots, // 遺跡争奪の時間ごとの参加（それ以外のイベントでは入らない）
          survey: row.survey, // 確認事項の答え {設問id: "ok"|"unknown"}（設問のないイベント・不参加・代理入力では入らない。管理者だけが見られる）
          surveyProxy: row.surveyProxy, // 代理入力で「連携します」にチェックした
          proxyBy: proxyBy, // 代理で入力した人の名前（本人の入力なら ""）
          updatedAt: new Date().toISOString(),
          id: existing ? existing.id : newId_("r"), eventId: ev.id, userId: user.id
        };
        if (existing) d.entries[d.entries.indexOf(existing)] = e;
        else d.entries.push(e);
        result = existing ? "updated" : "added";
      }

      d.updated = new Date().toISOString();
      undo.t = d.updated; undo.uid = user.id; undo.act = result; undo.userAfterName = user.name;
      undo.afterAt = result === "canceled" ? "" : e.updatedAt;
      d.selfUndo.unshift(undo); // 新しい順
      if (d.selfUndo.length > SELF_UNDO_MAX) d.selfUndo.length = SELF_UNDO_MAX;
      var w = writeFile_(token, d, f.sha, "Self registration: " + ev.type + " " + ev.date);
      if (w.ok) {
        appendLog_({ t: d.updated, ev: ev.type + " " + ev.date, name: user.name, uid: user.id, act: result, by: proxyBy,
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

function snapUser_(u) {
  return { name: u.name, alliance: u.alliance, aliases: (u.aliases || []).slice(), nameHistory: (u.nameHistory || []).slice() };
}

// いたずらの取り消し（管理者が指示したときだけ。パスワード必須）
// p: { ip: "203.0.113.5" または "203.0.113.*", since: ISO（省略可）, dryRun: true/false }
// 新しい順に「その登録の直前の状態」へ戻す。そのあとに別の登録・変更があったものは戻さずに「スキップ」と返す。
function revertByIp_(token, p) {
  var pat = String(p.ip || "").trim();
  if (!pat) return { ok: false, status: 400, error: "IPを指定してください" };
  function hit(ip) { return pat.slice(-1) === "*" ? String(ip).indexOf(pat.slice(0, -1)) === 0 : ip === pat; }
  var since = p.since ? Date.parse(p.since) : 0;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, status: 503, error: "混み合っています" };
  try {
    for (var attempt = 0; attempt < 3; attempt++) {
      var f = readFile_(token);
      if (!f.ok) return f;
      var d = f.data;
      d.users = d.users || []; d.events = d.events || []; d.entries = d.entries || [];
      d.selfUndo = d.selfUndo || [];
      var report = [], changed = 0;
      d.selfUndo.forEach(function(r) { // 新しい順に並んでいる
        if (r.reverted || !r.ip || !hit(r.ip) || Date.parse(r.t) < since) return;
        var user = d.users.filter(function(u) { return u.id === r.uid; })[0];
        var ev = d.events.filter(function(e) { return e.id === r.ev; })[0];
        var item = { t: r.t, ip: r.ip, by: r.by || "", name: r.userAfterName || (user && user.name) || "?",
          ev: ev ? ev.type + " " + ev.date : r.ev, act: r.act };
        var cur = d.entries.filter(function(x) { return x.eventId === r.ev && x.userId === r.uid; })[0];
        var unchanged = r.act === "canceled" ? !cur : !!cur && cur.updatedAt === r.afterAt;
        if (!unchanged) { item.result = "スキップ（そのあと別の登録・変更があった）"; report.push(item); return; }
        d.entries = d.entries.filter(function(x) { return x !== cur; });
        if (r.entryBefore) d.entries.push(r.entryBefore);
        item.result = r.entryBefore ? (r.act === "canceled" ? "取消を戻す" : "変更前の内容に戻す") : "登録を消す";
        if (user && r.userBefore && user.name === r.userAfterName) {
          if (r.userBefore.name !== user.name) item.result += "・名前を「" + r.userBefore.name + "」に戻す";
          user.name = r.userBefore.name; user.alliance = r.userBefore.alliance;
          user.aliases = r.userBefore.aliases; user.nameHistory = r.userBefore.nameHistory;
        }
        if (user && !r.userBefore && !d.entries.some(function(x) { return x.userId === user.id; })) {
          d.users = d.users.filter(function(u) { return u !== user; });
          item.result += "・この登録で新しく作られた人なので、ユーザーも消す";
        }
        if (!p.dryRun) r.reverted = new Date().toISOString();
        changed++;
        report.push(item);
      });
      if (p.dryRun || !changed) return { ok: true, dryRun: !!p.dryRun, items: report };
      d.updated = new Date().toISOString();
      var w = writeFile_(token, d, f.sha, "Revert by IP " + pat);
      if (w.ok) {
        appendLog_({ t: d.updated, ev: "", name: "（管理者が元に戻した）", uid: "", act: "reverted", by: "", ip: pat, ua: changed + "件を戻した" });
        return { ok: true, dryRun: false, items: report };
      }
      if (w.status !== 409 && w.status !== 422) return w;
    }
    return { ok: false, status: 409, error: "混み合っています。もう一度実行してください" };
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
  // 遺跡争奪の時間ごとの参加（yes＝参加、maybe＝行けるかも、no＝不参加）
  var slotsIn = m.slots || {}, slots = {};
  RUIN_SLOTS.forEach(function(k) { if (["yes", "maybe", "no"].indexOf(slotsIn[k]) >= 0) slots[k] = slotsIn[k]; });
  if (Object.keys(slots).length) r.slots = slots;
  // 確認事項（アンケート）の答え。設問のidごとに ok／unknown／check（わかってません）だけ残す（イベントの設問との突き合わせは selfSave_ で）
  var svIn = m.survey && typeof m.survey === "object" ? m.survey : {}, sv = {};
  Object.keys(svIn).slice(0, 20).forEach(function(k) { if (svIn[k] === "ok" || svIn[k] === "unknown" || svIn[k] === "check") sv[clip_(k, 40)] = svIn[k]; });
  if (Object.keys(sv).length) r.survey = sv;
  if (m.surveyProxy === true) r.surveyProxy = true;
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
// key: 省略／"" ＝ 全体鯖（DISCORD_INVITE）、"816" ＝ 816用サーバー（DISCORD_INVITE_816 / DISCORD_INVITE_816_AT）
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
