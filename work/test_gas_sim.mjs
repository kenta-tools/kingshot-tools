// 本番GASの候補コードを、Apps Script の部品を模擬した環境（Node の vm）で動かし、「本番データの形」で動作を確認する自動テスト。
// 本番のGASにもドライブにも触らない（pubGet の公開データを読み取って模擬データを作る）。昇格のたびに実行できる。
// 使い方: node work/test_gas_sim.mjs [GASコードのパス] [pubGetのJSONのパス（省略時は本番のpubGetを読み取りで取得）]
import fs from "node:fs";
import vm from "node:vm";

const codePath = process.argv[2] || "work/gas_members_proxy.gs";
const code = fs.readFileSync(codePath, "utf8");
let pub;
if (process.argv[3]) pub = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
else {
  const cfg = fs.readFileSync("config.js", "utf8");
  const url = cfg.match(/GAS_URL = "([^"]+)"/)[1];
  pub = await (await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "pubGet" }) })).json();
}

// ---- 本番の公開データから、保存データ（members.json 相当）を作る ----
const openIds = new Set((pub.events || []).map(e => e.id));
const history = pub.history || { events: [], entries: [] };
let data = {
  updated: "2026-11-13T00:00:00Z",
  users: (pub.users || []).map(u => ({ id: u.id, name: u.name, alliance: u.alliance, aliases: u.aliases || [], nameHistory: [], ...(u.gid ? { gid: u.gid } : {}) })),
  events: (history.events || []).map(e => ({ ...e, open: openIds.has(e.id) })),
  entries: history.entries || [],
  notSame: [], teams: [], kvkRosters: JSON.parse(JSON.stringify(pub.kvkRosters || [])), flameRosters: JSON.parse(JSON.stringify(pub.flameRosters || [])),
  matchupPairs: pub.matchupPairs || [], kvkChatHistory: [], selfUndo: [], inquiries: [],
};
// kvkRosters は「旧形式（kindなし）」のまま保存されている想定（本番の今の形）。pubGet が補った tabs を元の形に戻す
data.kvkRosters.forEach(r => { r.tabs = (r.tabs || []).map(t => { const c = { ...t }; delete c.kind; delete c.site; return c; }); });
const rawBeforeRosters = JSON.stringify(data.kvkRosters);

// ---- Apps Script の模擬 ----
const props = { DATA_FILE_ID: "f", DATA_VERSION: "1", EDIT_PASSWORD: "pw" };
const store = { text: JSON.stringify(data) };
const ctx = {
  console, Date, Math, JSON, String, Number, Array, Object, RegExp, Error, parseInt, parseFloat, isFinite, isNaN,
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
  DriveApp: { getFileById: () => ({ getBlob: () => ({ getDataAsString: () => store.text }), setContent: t => { store.text = t; }, makeCopy: n => ({ getName: () => n }), getName: () => "f" }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
  Utilities: { getUuid: () => "xxxxxxxx-xxxx-xxxx-xxxx-" + Math.random().toString(16).slice(2, 14), sleep: () => {}, formatDate: () => "20261113_000000",
    base64Decode: s => [...Buffer.from(s, "base64")], base64Encode: x => Buffer.from(x).toString("base64"), newBlob: b => ({ getDataAsString: () => Buffer.from(b).toString("utf8") }), Charset: { UTF_8: "UTF-8" } },
  ContentService: { createTextOutput: t => ({ text: t, setMimeType() { return this; } }), MimeType: { JSON: "json" } },
  MimeType: { PLAIN_TEXT: "text/plain" }, ScriptApp: { getProjectTriggers: () => [], deleteTrigger: () => {} }, Logger: { log: () => {} },
  UrlFetchApp: { fetch: () => { throw new Error("通信は模擬環境では使いません"); } },
};
vm.createContext(ctx);
vm.runInContext(code, ctx, { filename: "gas" });
const call = o => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(o) } }).text);
const cur = () => JSON.parse(store.text);

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? "OK  " : "NG  ") + msg); if (!cond) fail++; };

// 1) pubGet：本番の今の形の項目が全部あり、公開の中身が変わらない（追加は項目の追加のみ）
const g = call({ action: "pubGet" });
ok(g.ok, "pubGet が動く");
const prodKeys = Object.keys(pub).filter(k => k !== "kvkRosters");
ok(prodKeys.every(k => k in g), "本番の今の pubGet の項目（" + prodKeys.length + "個）が全部そろっている");
ok(JSON.stringify(g.users.map(u => ({ id: u.id, name: u.name, alliance: u.alliance }))) === JSON.stringify((pub.users || []).map(u => ({ id: u.id, name: u.name, alliance: u.alliance }))), "users（id・名前・同盟）が同じ");
ok(JSON.stringify(g.history.entries.length) === JSON.stringify(history.entries.length) && g.history.events.length === history.events.length, "履歴のイベント・参加登録の件数が同じ（" + history.events.length + "件・" + history.entries.length + "件）");
ok(g.entries.every(e => !("survey" in e) && !("surveyProxy" in e)), "公開の参加登録にアンケートの答えは出ない");

// 2) 旧形式の共有名簿：pubGet で読んでも保存データは変わらない。画面には新形式（設定＋名簿1）として出る
ok(JSON.stringify(cur().kvkRosters) === rawBeforeRosters, "旧形式の共有名簿（" + data.kvkRosters.length + "件・タブ" + (data.kvkRosters[0] ? data.kvkRosters[0].tabs.length : 0) + "個）は、読んだだけでは保存データが変わらない");
if (g.kvkRosters.length) {
  const t = g.kvkRosters[0].tabs;
  ok(t[0].kind === "settings" && t[1].kind === "tab", "旧形式の共有名簿は、画面には「設定＋名簿1（空）」の新形式で出る（旧タブの中身は表示されない）");
}
ok(JSON.stringify(g.flameRosters) === JSON.stringify(pub.flameRosters || []), "炎龍の共有名簿は変わらない");

// 3) 書き込み系
const evOpen = data.events.find(e => e.open && !e.done);
const evDone = data.events.find(e => e.done);
if (evOpen) {
  const evId = evOpen.id;
  const user = data.users[0];
  // 古い登録ページ（アンケートの答えを送らない）の登録：設問が無いイベントなら通る
  const slots = evOpen.type === "遺跡争奪" ? { slots: { 12: "yes", 18: "yes", 22: "yes", 23: "yes", 25: "yes" } } : {}; // 遺跡争奪は時間の選択が必要
  const r0 = call({ action: "selfSave", eventId: evId, name: "模擬テスト太郎", ip: "203.0.113.9", entry: { alliance: "TST", entry: "start", grade: "G8", ...slots } });
  ok(r0.ok, "アンケートの無いイベントへの登録（アンケートの答えなし）が通る" + (r0.ok ? "" : "：" + r0.error));
  // 設問のあるイベントでは、答えが無いと断られる（新機能）
  const cur1 = cur(); cur1.events.find(e => e.id === evId).survey = [{ id: "q1", text: "テスト設問" }]; store.text = JSON.stringify(cur1);
  const r1 = call({ action: "selfSave", eventId: evId, name: "模擬テスト花子", ip: "203.0.113.77", entry: { alliance: "TST", entry: "start", grade: "G8", ...slots } });
  ok(!r1.ok && r1.status === 400, "設問のあるイベントでは、答えがないと断られる（新機能の想定どおり）");
  const r2 = call({ action: "selfSave", eventId: evId, name: "模擬テスト花子", ip: "203.0.113.77", entry: { alliance: "TST", entry: "start", grade: "G8", ...slots, survey: { q1: "ok" } } });
  ok(r2.ok, "設問に答えれば通る");
  ok(call({ action: "pubGet" }).entries.every(e => !("survey" in e)), "登録後も公開データにアンケートの答えは出ない");
  // 共有名簿：旧形式のイベントへ保存すると新形式で書き換わる
  const rk = call({ action: "kvkSave", eventId: evId, tabId: "settings", baseUpdatedAt: null, force: true, rows: [{ id: "r1", name: "A", plain: { castle: 36 } }] });
  ok(rk.ok, "共有名簿（設定タブ）の保存が通る");
  ok(cur().kvkRosters.find(r => r.eventId === evId).tabs[0].kind === "settings", "保存すると、そのイベントの共有名簿は新形式で書き換わる");
}
// 4) チーム分け：完了したイベントは保存を断る
if (evDone) {
  const rt = call({ action: "teamSave", password: "pw", eventId: evDone.id, draft: { teams: [] } });
  ok(!rt.ok && rt.status === 403, "完了したイベントのチーム分けの保存は断られる");
}
// 5) 管理画面の保存（put）：gid が消えない・ほかのキーが残る
const gd = call({ action: "get", password: "pw" });
const cd = JSON.parse(Buffer.from(gd.content, "base64").toString("utf8"));
const withGid = cd.users.filter(u => u.gid).length;
const stripped = JSON.parse(JSON.stringify(cd)); stripped.users.forEach(u => { delete u.gid; });
const rp = call({ action: "put", password: "pw", sha: gd.sha, content: Buffer.from(JSON.stringify(stripped)).toString("base64") });
ok(rp.ok && cur().users.filter(u => u.gid).length === withGid, "古い管理画面（gidを知らない）で保存しても、gid が消えない（" + withGid + "人）");
ok(Array.isArray(cur().kvkRosters) && Array.isArray(cur().flameRosters), "管理画面の保存で、共有名簿など他のキーが残る");

console.log(fail ? "\n失敗 " + fail + " 件" : "\nすべて通りました");
process.exit(fail ? 1 : 0);
