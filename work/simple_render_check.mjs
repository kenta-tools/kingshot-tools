import { spawn } from "node:child_process";import { mkdtempSync } from "node:fs";import { tmpdir } from "node:os";import { join, resolve } from "node:path";import { pathToFileURL } from "node:url";
const port=9700+Math.floor(Math.random()*90);
const ch=spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",["--headless=new",`--remote-debugging-port=${port}`,`--user-data-dir=${mkdtempSync(join(tmpdir(),"sr-"))}`,"--allow-file-access-from-files","about:blank"],{stdio:"ignore"});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let t;for(let i=0;i<50;i++){try{t=await (await fetch(`http://127.0.0.1:${port}/json`)).json();break}catch{await sleep(200)}}
const ws=new WebSocket(t.find(x=>x.type==="page").webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const pe={},errs=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pe[m.id]){pe[m.id](m);delete pe[m.id]}if(m.method==="Runtime.exceptionThrown")errs.push(m.params.exceptionDetails.exception?.description||"exc")};
const send=(method,params={})=>new Promise(r=>{const i=++id;pe[i]=r;ws.send(JSON.stringify({id:i,method,params}))});
await send("Runtime.enable");await send("Page.enable");
await send("Page.navigate",{url:pathToFileURL(resolve("test/tools/gold-calculator-simple.html")).href});await sleep(1500);
const ev=async x=>{const r=await send("Runtime.evaluate",{expression:x,returnByValue:true});return r.result?.result?.value??JSON.stringify(r.result?.exceptionDetails?.exception?.description||r)};
for(const [lv,tg,ttg] of [[5,4000,0],[5,5500,0],[3,6000,0],[6,11000,0]]){
 await ev(`(function(){const c=document.getElementById("cur");const o=[...c.options].find(x=>x.value==="${lv}");c.value=o?o.value:c.options[1].value;c.dispatchEvent(new Event("change",{bubbles:true}));const a=document.getElementById("ownTG");a.value=${tg};a.dispatchEvent(new Event("input",{bubbles:true}));const b=document.getElementById("ownTTG");b.value=${ttg};b.dispatchEvent(new Event("input",{bubbles:true}));})()`);await sleep(400);
 console.log("---",lv,tg,ttg);console.log(await ev("document.getElementById('outB').innerText.replace(/\s+/g,' ')"));
}
console.log("禁止文言:",await ev(`/使う黄金の合計|が作れます|にするには、黄金があと/.test(document.body.innerText)`),"JSエラー:",errs.length?errs:"なし");
ws.close();ch.kill();process.exit(0);
