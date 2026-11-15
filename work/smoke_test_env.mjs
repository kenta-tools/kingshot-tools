// 昇格後の本番ファイルが「開けて、JSエラーが出ず、本番のGASだけを向く」ことを、ヘッドレスChromeで確認するスモークテスト。
// 本番GASには pubGet（読み取り）しか呼ばれない（登録・保存の操作はしない。管理画面はログイン画面が出るところまで）。
// 使い方（リポジトリのルートで）: node work/smoke_pages.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(".");
const PROD_ID = readFileSync("test/config.js", "utf8").match(/macros\/s\/([^/]+)\/exec/)[1];
const PAGES = [
  "test/index.html","test/entry/index.html","test/ruins/index.html","test/teams/index.html","test/egg/index.html","test/egg/entry/index.html","test/egg/teams/index.html",
  "test/tools/tools-index.html","test/tools/useful.html","test/tools/gold-calculator.html","test/tools/kvk-countdown.html",
  "test/inquiry/index.html","test/kvk-matchup/index.html","test/holy-sword-league/index.html",
  "test/admin/users.html","test/admin/events.html","test/admin/participants.html","test/admin/teams.html","test/admin/logs.html","test/admin/inquiries.html","test/admin/members-admin.html","test/admin/user-import.html",
];
// 旧い日本語名のURL → 新しい英語名のページへ自動で移ること（2026-11-15の改名）
const REDIRECTS = [
  ["tools/KvK同着スタート カウントダウン表.html", "kvk-countdown.html"], ["tools/KvKストップウォッチ.html", "stopwatch.html"], ["tools/黄金計算機.html", "gold-calculator.html"],
  ["tools/KvK占領判定.html", "kvk-occupation.html"], ["tools/周期ウェーブタイマー.html", "wave-timer.html"], ["tools/炎龍の覇者_攻城タイムライン計算.html", "flame-dragon-timeline.html"],
  ["tools/王城到着同期カウントアップ.html", "castle-sync-countup.html"], ["tools/音声アナウンス付きストップウォッチ.html", "voice-stopwatch.html"],
];
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "smoke-"))}`, "--allow-file-access-from-files", "--window-size=1200,900", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
const page = targets.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let id = 0; const pending = {}; let logs = [], gasUrls = new Set(), gasActions = new Set();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
  if (m.method === "Runtime.exceptionThrown") logs.push("EXC: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split("\n")[0]);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") logs.push("ERR: " + m.params.args.map(a => a.value ?? a.description).join(" ").slice(0, 160));
  if (m.method === "Page.javascriptDialogOpening") send("Page.handleJavaScriptDialog", { accept: false });
  if (m.method === "Network.requestWillBeSent" && /script\.google\.com/.test(m.params.request.url)) {
    gasUrls.add(m.params.request.url.split("/exec")[0].split("/s/")[1]);
    try { gasActions.add(JSON.parse(m.params.request.postData || "{}").action); } catch {}
  }
};
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");

let fail = 0;
for (const p of PAGES) {
  logs = []; gasUrls = new Set(); gasActions = new Set();
  await send("Page.navigate", { url: pathToFileURL(join(ROOT, p)).href });
  await sleep(4500);
  const r = await send("Runtime.evaluate", { expression: "document.body ? document.body.innerText.length : -1", returnByValue: true });
  const len = r.result?.result?.value ?? -1;
  const wrongGas = [...gasUrls].filter(u => u !== PROD_ID);
  const writes = [...gasActions].filter(a => a && !["pubGet", "teamsGet"].includes(a));
  const ok = len > 50 && !logs.length && !wrongGas.length && !writes.length;
  if (!ok) fail++;
  console.log((ok ? "OK  " : "NG  ") + p + `（本文${len}字・GAS先=${[...gasUrls].map(u => u === PROD_ID ? "test用GAS" : "★別").join(",") || "なし"}・呼んだaction=${[...gasActions].join(",") || "なし"}）` + (logs.length ? " " + logs.slice(0, 3).join(" | ") : "") + (writes.length ? " ★読み取り以外のaction: " + writes.join(",") : ""));
}
ws.close(); chrome.kill();
console.log(fail ? `\n失敗 ${fail} 件` : "\nすべて通りました");
process.exit(fail ? 1 : 0);
