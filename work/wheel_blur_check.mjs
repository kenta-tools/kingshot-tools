import { spawn } from "node:child_process";import { mkdtempSync } from "node:fs";import { tmpdir } from "node:os";import { join, resolve } from "node:path";import { pathToFileURL } from "node:url";
const port=9500+Math.floor(Math.random()*90);
const ch=spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",["--headless=new",`--remote-debugging-port=${port}`,`--user-data-dir=${mkdtempSync(join(tmpdir(),"wb-"))}`,"--allow-file-access-from-files","about:blank"],{stdio:"ignore"});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let t;for(let i=0;i<50;i++){try{t=await (await fetch(`http://127.0.0.1:${port}/json`)).json();break}catch{await sleep(200)}}
const ws=new WebSocket(t.find(x=>x.type==="page").webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const pe={};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pe[m.id]){pe[m.id](m);delete pe[m.id]}};
const send=(method,params={})=>new Promise(r=>{const i=++id;pe[i]=r;ws.send(JSON.stringify({id:i,method,params}))});
const ev=async x=>(await send("Runtime.evaluate",{expression:x,returnByValue:true})).result?.result?.value;
await send("Page.enable");
let bad=0;
for(const p of process.argv.slice(2)){
  await send("Page.navigate",{url:pathToFileURL(resolve(p)).href});await sleep(2000);
  const r=await ev(`(function(){const s=[...document.querySelectorAll("select")].find(x=>x.options.length>1);if(!s)return "selectなし";s.focus();const before=document.activeElement===s;s.dispatchEvent(new WheelEvent("wheel",{deltaY:100,bubbles:true,cancelable:true}));if(!before)return "対象外(非表示でフォーカス不可)";return document.activeElement!==s?"OK":"NG(blurされない)"})()`);
  if(r.startsWith("NG"))bad++;
  console.log(r.padEnd(14),p);
}
ws.close();ch.kill();process.exit(bad?1:0);
