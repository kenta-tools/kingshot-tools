import { spawn } from "node:child_process";import { mkdtempSync } from "node:fs";import { tmpdir } from "node:os";import { join, resolve } from "node:path";import { pathToFileURL } from "node:url";
const port=9400+Math.floor(Math.random()*90);
const ch=spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",["--headless=new",`--remote-debugging-port=${port}`,`--user-data-dir=${mkdtempSync(join(tmpdir(),"cp-"))}`,"--allow-file-access-from-files","about:blank"],{stdio:"ignore"});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let t;for(let i=0;i<50;i++){try{t=await (await fetch(`http://127.0.0.1:${port}/json`)).json();break}catch{await sleep(200)}}
const ws=new WebSocket(t.find(x=>x.type==="page").webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const pe={};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pe[m.id]){pe[m.id](m);delete pe[m.id]}};
const send=(method,params={})=>new Promise(r=>{const i=++id;pe[i]=r;ws.send(JSON.stringify({id:i,method,params}))});
const ev=async x=>(await send("Runtime.evaluate",{expression:x,returnByValue:true})).result?.result?.value;
await send("Page.enable");
async function run(page,outId,cur,tg,ttg){
  await send("Page.navigate",{url:pathToFileURL(resolve(page)).href});await sleep(1200);
  await ev(`(function(){const c=document.getElementById("cur");c.value="${cur}";c.dispatchEvent(new Event("change",{bubbles:true}));for(const [i,v] of [["ownTG",${tg}],["ownTTG",${ttg}]]){const a=document.getElementById(i);a.value=v;a.dispatchEvent(new Event("input",{bubbles:true}))}})()`);await sleep(400);
  return await ev(`document.getElementById("${outId}").innerText.replace(/\s+/g," ").trim()`);
}
let diff=0;
for(const [cur,tg,ttg] of [[1,3000,0],[3,5000,10],[5,10000,0],[5,100,0],[5,500000,3000],[6,20000,200],[7,50000,500],[0,0,0],[2,15000,100]]){
  const a=await run("test/tools/gold-calculator-simple.html","outB",cur,tg,ttg);
  const b=await run("test/tools/gold-refine-plan.html","out",cur,tg,ttg);
  console.log(a===b?"同じ":"違う","現在Lv"+cur,tg,ttg);
  if(a!==b){diff++;console.log("  超簡単:",a.slice(0,260));console.log("  簡易 :",b.slice(0,260));}
}
console.log(diff?`違い ${diff}件`:"全部同じ");
ws.close();ch.kill();process.exit(0);
