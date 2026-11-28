// test環境の本物のGAS（テスト用）に実際にログインして、イベント作成→アンケート編集→保存→読み込み直し→削除 まで通す。最後に元の状態へ戻す。
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const ROOT = resolve("."), PW = process.env.TEST_PW, SHOT = process.env.SHOT_DIR || tmpdir();
if (!PW) { console.error("環境変数 TEST_PW（テスト環境のログインパスワード）を指定してください"); process.exit(2); }
const TEST_ID = readFileSync("test/config.js","utf8").match(/macros\/s\/([^/]+)\/exec/)[1];
const port = 9900 + Math.floor(Math.random()*90);
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new",`--remote-debugging-port=${port}`,`--user-data-dir=${mkdtempSync(join(tmpdir(),"e2e-"))}`,"--allow-file-access-from-files","--window-size=1300,1100","about:blank"],{stdio:"ignore"});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targets; for(let i=0;i<50;i++){try{targets=await (await fetch(`http://127.0.0.1:${port}/json`)).json();break;}catch{await sleep(200);}}
const ws=new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
let id=0; const pend={}, errs=[], gas=new Set();
ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend[m.id]){pend[m.id](m);delete pend[m.id];}
 if(m.method==="Runtime.exceptionThrown")errs.push((m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text).split("\n")[0]);
 if(m.method==="Page.javascriptDialogOpening")send("Page.handleJavaScriptDialog",{accept:true});
 if(m.method==="Network.requestWillBeSent"&&/script\.google\.com/.test(m.params.request.url))gas.add(m.params.request.url.split("/exec")[0].split("/s/")[1]);};
const send=(method,params={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}));});
const ev=async ex=>{const r=await send("Runtime.evaluate",{expression:ex,returnByValue:true,awaitPromise:true});return r.result?.result?.value??r.result?.exceptionDetails?.text;};
await send("Runtime.enable");await send("Page.enable");await send("Network.enable");
let fail=0; const ck=(name,ok,extra="")=>{console.log((ok?"OK  ":"NG  ")+name+(extra?"  "+extra:""));if(!ok)fail++;};
const shot=async n=>{const r=await send("Page.captureScreenshot",{format:"png"});writeFileSync(join(SHOT,n+".png"),Buffer.from(r.result.data,"base64"));};
async function open(page){await send("Page.navigate",{url:pathToFileURL(join(ROOT,"test/admin/"+page)).href});await sleep(1500);
 await ev(`(function(){const p=document.getElementById("pwInput");if(p&&document.getElementById("loginView").style.display!=="none"){p.value=${JSON.stringify(PW)};document.getElementById("loginBtn").click();}})()`);await sleep(5000);}
const click=s=>ev(`document.querySelector(${JSON.stringify(s)}).click()`);
const DATE="2098-01-01";
await open("events.html");
ck("ログインできた", await ev(`getComputedStyle(document.getElementById("appView")).display`)==="block");
const before=await ev(`document.getElementById("eventSelect").options.length`);
// 作成
await click("#newEventBtn"); await sleep(300);
ck("作成パネルが出て、登録済み欄が隠れた", await ev(`document.body.classList.contains("creating") && getComputedStyle(document.getElementById("eventView")).display==="none"`));
await shot("1_creating");
await ev(`document.getElementById("newEventType").value="KVK";document.getElementById("newEventDate").value="${DATE}"`);
await click("#createEventBtn"); await sleep(800);
ck("作成後に通常表示へ戻り、そのイベントが選択", await ev(`!document.body.classList.contains("creating") && document.getElementById("eventSelect").selectedOptions[0].textContent.includes("2098")`));
ck("既定の設問が付いた(6問)", await ev(`document.querySelectorAll('#surveyCard input[data-sv-text]').length`)===6, "実際:"+await ev(`document.querySelectorAll('#surveyCard input[data-sv-text]').length`));
// 設問追加
await click('#surveyCard [data-sv="add"]'); await sleep(300);
await ev(`(function(){const i=[...document.querySelectorAll('#surveyCard input[data-sv-text]')].pop();i.value="E2E追加設問";i.dispatchEvent(new Event("change",{bubbles:true}));})()`);await sleep(300);
ck("設問が7問になった", await ev(`document.querySelectorAll('#surveyCard input[data-sv-text]').length`)===7);
await shot("2_events_survey");
await click("#publishBtn"); await sleep(6000);
console.log("保存メッセージ:", await ev(`(document.getElementById("ghMsg")||{}).textContent`));
// 読み込み直し
await open("events.html");
await ev(`(function(){const s=document.getElementById("eventSelect");const o=[...s.options].find(x=>x.textContent.includes("2098"));if(o){s.value=o.value;s.dispatchEvent(new Event("change",{bubbles:true}));}})()`);await sleep(500);
const texts=await ev(`[...document.querySelectorAll('#surveyCard input[data-sv-text]')].map(i=>i.value).join("|")`);
ck("読み込み直しても設問が残る（保存できた）", texts.includes("E2E追加設問")&&texts.split("|").length===7, texts.slice(-30));
// 参加者一覧
await open("participants.html");
await ev(`(function(){const s=document.getElementById("eventSelect");const o=[...s.options].find(x=>x.textContent.includes("2098"));if(o){s.value=o.value;s.dispatchEvent(new Event("change",{bubbles:true}));}})()`);await sleep(500);
ck("参加者一覧に答えの欄があり、設問の編集欄は無い", await ev(`!!document.getElementById("surveyCard") && !document.querySelector('#surveyCard [data-sv="add"]') && document.getElementById("surveyCard").innerText.includes("アンケート（確認事項）の答え")`));
ck("参加者一覧にまとめて登録がある", await ev(`document.body.innerText.includes("まとめて登録")`));
await shot("3_participants");
// 後始末：削除して保存
await open("events.html");
await ev(`(function(){const s=document.getElementById("eventSelect");const o=[...s.options].find(x=>x.textContent.includes("2098"));if(o){s.value=o.value;s.dispatchEvent(new Event("change",{bubbles:true}));}})()`);await sleep(500);
await click("#deleteEventBtn"); await sleep(500); await click("#publishBtn"); await sleep(6000);
await open("events.html");
ck("後始末：テストイベントを削除して元の数に戻った", await ev(`document.getElementById("eventSelect").options.length`)===before, `前${before}→後${await ev(`document.getElementById("eventSelect").options.length`)}`);
ck("通信先がテスト用GASだけ", [...gas].every(g=>g===TEST_ID)&&gas.size>0, [...gas].length+"種");
ck("JSエラーなし", !errs.length, errs.join(" | "));
console.log(fail?`\n失敗 ${fail} 件`:"\nすべて通りました");
ws.close();chrome.kill();process.exit(fail?1:0);
