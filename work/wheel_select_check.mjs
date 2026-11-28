// プルダウン（select）にマウスホイールを回したとき、値が変わってしまうかを調べる。使い方: node work/wheel_select_check.mjs <html相対パス> ...
import { spawn } from "node:child_process";import { mkdtempSync } from "node:fs";import { tmpdir } from "node:os";import { join, resolve } from "node:path";import { pathToFileURL } from "node:url";
const pages=process.argv.slice(2);const port=9600+Math.floor(Math.random()*90);
const ch=spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",["--headless=new",`--remote-debugging-port=${port}`,`--user-data-dir=${mkdtempSync(join(tmpdir(),"ws-"))}`,"--allow-file-access-from-files","--window-size=1200,900","about:blank"],{stdio:"ignore"});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let t;for(let i=0;i<50;i++){try{t=await (await fetch(`http://127.0.0.1:${port}/json`)).json();break}catch{await sleep(200)}}
const ws=new WebSocket(t.find(x=>x.type==="page").webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let id=0;const pe={};
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pe[m.id]){pe[m.id](m);delete pe[m.id]}if(m.method==="Page.javascriptDialogOpening")send("Page.handleJavaScriptDialog",{accept:false})};
const send=(method,params={})=>new Promise(r=>{const i=++id;pe[i]=r;ws.send(JSON.stringify({id:i,method,params}))});
const ev=async x=>{const r=await send("Runtime.evaluate",{expression:x,returnByValue:true});return r.result?.result?.value};
await send("Runtime.enable");await send("Page.enable");
let bad=0;
for(const p of pages){
  await send("Page.navigate",{url:pathToFileURL(resolve(p)).href});await sleep(2000);
  const n=await ev(`document.querySelectorAll("select").length`);
  // 画面に見えていて、選択肢が2つ以上あるselectを順に試す（最大6個）
  const info=await ev(`(function(){const out=[];document.querySelectorAll("select").forEach((s,i)=>{const r=s.getBoundingClientRect();if(s.options.length>1&&r.width>0&&r.height>0&&!s.disabled)out.push(i)});return out.slice(0,6)})()`)||[];
  let changed=0;
  for(const i of info){
    const pos=await ev(`(function(){const s=document.querySelectorAll("select")[${i}];s.scrollIntoView({block:"center"});const r=s.getBoundingClientRect();s.focus();window.__v=s.value;return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await send("Input.dispatchMouseEvent",{type:"mouseMoved",x:pos.x,y:pos.y});
    await send("Input.dispatchMouseEvent",{type:"mouseWheel",x:pos.x,y:pos.y,deltaX:0,deltaY:100});await sleep(150);
    await send("Input.dispatchMouseEvent",{type:"mouseWheel",x:pos.x,y:pos.y,deltaX:0,deltaY:100});await sleep(150);
    const diff=await ev(`document.querySelectorAll("select")[${i}].value!==window.__v`);
    if(diff)changed++;
  }
  if(changed)bad++;
  console.log((changed?"NG  ":"OK  ")+p+`（select ${n}個・試した${info.length}個・ホイールで値が変わった${changed}個）`);
}
ws.close();ch.kill();process.exit(bad?1:0);
