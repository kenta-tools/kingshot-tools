// test環境の管理画面で「アンケート（確認事項）の設問を追加→保存」ができるかを、GASを模擬して確認する（本物のGASには触らない）
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const ROOT = resolve(".");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const port = 9800 + Math.floor(Math.random()*100);
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(),"sv-"))}`, "--allow-file-access-from-files","--window-size=1300,1000","about:blank"], {stdio:"ignore"});
const sleep = ms => new Promise(r=>setTimeout(r,ms));
let targets; for (let i=0;i<50;i++){ try{ targets=await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break;}catch{await sleep(200);} }
const ws = new WebSocket(targets.find(t=>t.type==="page").webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
let id=0; const pend={}; const errs=[];
ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend[m.id]){pend[m.id](m);delete pend[m.id];} if(m.method==="Runtime.exceptionThrown")errs.push((m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text).split("\n")[0]); if(m.method==="Page.javascriptDialogOpening")send("Page.handleJavaScriptDialog",{accept:true});};
const send=(method,params={})=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method,params}));});
const ev=async ex=>{const r=await send("Runtime.evaluate",{expression:ex,returnByValue:true,awaitPromise:true}); return r.result?.result?.value ?? r.result?.exceptionDetails?.text;};
await send("Runtime.enable");await send("Page.enable");
const data={updated:"2026-11-15T00:00:00Z",users:[{id:"u1",name:"テスト太郎",alliance:"EGG"}],events:[{id:"e1",type:"KVK",date:"2026-11-20",open:true}],entries:[],notSame:[]};
await send("Page.addScriptToEvaluateOnNewDocument",{source:`
 sessionStorage.setItem("ksAdminPw","x"); localStorage.setItem("ksAdminPwSaved","x"); window.__puts=[]; window.__data=${JSON.stringify(data)};
 const of=window.fetch; window.fetch=function(u,o){ if(String(u).includes("script.google.com")){ const b=JSON.parse(o.body);
   const enc=t=>{const by=new TextEncoder().encode(t);let s="";by.forEach(c=>s+=String.fromCharCode(c));return btoa(s)};
   if(b.action==="get") return Promise.resolve({json:()=>({ok:true,sha:"s1",content:enc(JSON.stringify(window.__data))})});
   if(b.action==="put"){ window.__puts.push(b); return Promise.resolve({json:()=>({ok:true,sha:"s2"})}); }
   return Promise.resolve({json:()=>({ok:true})}); } return of.apply(this,arguments); };`});
async function run(page){
  await send("Page.navigate",{url:pathToFileURL(join(ROOT,page)).href}); await sleep(1500);
  await ev(`(function(){const p=document.getElementById("pwInput"); if(p&&document.getElementById("loginView").style.display!=="none"){p.value="x"; document.getElementById("loginBtn").click();}})()`); await sleep(2500);
}
await run("test/admin/events.html");
console.log("dbg:", await ev(`JSON.stringify({pw:sessionStorage.getItem("ksAdminPw"),gas:typeof GAS_URL!=="undefined"?GAS_URL.slice(0,20):"none",put:typeof window.__puts,app:getComputedStyle(document.getElementById("appView")).display, ev:getComputedStyle(document.getElementById("eventView")).display, sel:document.getElementById("eventSelect").value, opts:document.getElementById("eventSelect").options.length, slot:!!document.getElementById("surveySlot"), msg:(document.getElementById("loginMsg")||{}).textContent})`));
console.log("surveyCard:", await ev(`!!document.getElementById("surveyCard") && document.getElementById("surveyCard").style.display`));
console.log("設問追加ボタン:", await ev(`!!document.querySelector('#surveyCard [data-sv="add"]')`));
console.log("既定設問ボタン:", await ev(`!!document.querySelector('#surveyCard [data-sv="default"]')`));
await ev(`document.querySelector('#surveyCard [data-sv="default"]').click()`); await sleep(300);
await ev(`document.querySelector('#surveyCard [data-sv="add"]').click()`); await sleep(300);
await ev(`(function(){const i=[...document.querySelectorAll('#surveyCard input[data-sv-text]')].pop(); i.value="テスト設問ABC"; i.dispatchEvent(new Event("change",{bubbles:true}));})()`); await sleep(300);
console.log("設問数:", await ev(`document.querySelectorAll('#surveyCard input[data-sv-text]').length`));
await ev(`document.getElementById("publishBtn").click()`); await sleep(2000);
console.log("保存回数:", await ev(`window.__puts.length`));
console.log("保存内容にsurvey含む:", await ev(`window.__puts.length? atob(window.__puts[0].content).length>0 && new TextDecoder().decode(Uint8Array.from(atob(window.__puts[0].content),c=>c.charCodeAt(0))).includes("テスト設問ABC") : false`));
console.log("保存メッセージ:", await ev(`(document.getElementById("publishMsg")||{}).textContent`));
await run("test/admin/participants.html");
console.log("participants: 答えの欄", await ev(`!!document.getElementById("surveyCard")`), "設問追加ボタン(出ない想定)", await ev(`!!document.querySelector('#surveyCard [data-sv="add"]')`), "設問がテスト設問ABC:", await ev(`document.getElementById("surveyCard").innerText.includes("テスト設問ABC")`));
console.log("events: 新規ボタン", await ev(`!!document.getElementById("newEventBtn")`), "アンケート欄", await ev(`!!document.getElementById("surveyCard")`));
console.log("JSエラー:", errs.length?errs:"なし");
ws.close(); chrome.kill(); process.exit(0);
