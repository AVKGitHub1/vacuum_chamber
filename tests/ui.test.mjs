// Browser DOM integration with the real Python geometry/export server.
// This deliberately does not claim to exercise WebGL or the Fusion CAD kernel.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {JSDOM,VirtualConsole} from 'jsdom';

let child,dom,base,doc;
const nativeFetch=globalThis.fetch;
function loopbackFetch(url,options={}){
  return new Promise((resolve,reject)=>{
    const headers={...options.headers};if(options.body)headers['Content-Length']=Buffer.byteLength(options.body);
    const req=http.request(new URL(url,base),{method:options.method||'GET',headers,agent:false},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
    });
    req.on('error',reject);
    if(options.body)req.write(options.body);
    req.end();
  });
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(predicate,timeout=12000){const end=Date.now()+timeout;while(!predicate()){if(Date.now()>end)throw Error('Timed out waiting for UI state: '+doc.querySelector('#compute-state').textContent+' / '+doc.querySelector('#validation').textContent);await sleep(30);}}
function change(selector,value){const el=doc.querySelector(selector);el.value=String(value);el.dispatchEvent(new dom.window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));}

before(async()=>{
  const python=process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python';
  child=spawn(python,['server.py','--port','0'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  base=await new Promise((resolve,reject)=>{child.once('error',reject);child.stdout.on('data',b=>{const match=b.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});child.once('exit',code=>reject(Error('Server exited '+code)));});
  const virtualConsole=new VirtualConsole();
  dom=new JSDOM(await readFile('static/index.html','utf8'),{url:base,pretendToBeVisual:true,virtualConsole});doc=dom.window.document;
  // Exercise recovery from a malformed document in persistent browser storage.
  dom.window.localStorage.setItem('chamber-studio-v1',JSON.stringify({schemaVersion:1,units:'in',body:{},ports:[]}));
  Object.assign(globalThis,{window:dom.window,document:doc,localStorage:dom.window.localStorage,devicePixelRatio:1});
  globalThis.fetch=loopbackFetch;
  dom.window.HTMLCanvasElement.prototype.getContext=()=>null;
  dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  dom.window.HTMLAnchorElement.prototype.click=function(){doc.body.dataset.download=this.download;};
  await import('../static/app.js');
  await waitFor(()=>doc.querySelector('#compute-state').textContent==='Up to date');
});
after(()=>{clearTimeout(doc?.querySelector('#toast')?.timer);child?.kill();dom?.window.close();globalThis.fetch=nativeFetch;});

test('startup restores example after bad storage and exposes editable form',()=>{
  assert.equal(doc.querySelectorAll('.port-card').length,2);
  assert.equal(doc.querySelector('[data-path="body.height"]').value,'20');
  assert.equal(doc.querySelector('#export').disabled,false);
  assert.match(doc.querySelector('#collision-summary').textContent,/No port collisions/);
});
test('display units round-trip without modifying the saved millimeters',()=>{
  const before=JSON.parse(localStorage.getItem('chamber-studio-v1')).body;
  doc.querySelector('[data-unit="mm"]').click();assert.equal(doc.querySelector('[data-path="body.height"]').value,'508');
  doc.querySelector('[data-unit="in"]').click();assert.equal(doc.querySelector('[data-path="body.height"]').value,'20');
  assert.deepEqual(JSON.parse(localStorage.getItem('chamber-studio-v1')).body,before);
});
test('duplicate ports display red collision states while still exporting',async()=>{
  doc.querySelector('[data-duplicate="0"]').click();
  await waitFor(()=>doc.querySelector('#compute-state').textContent==='Interference');
  assert.equal(doc.querySelectorAll('.port-card.colliding').length,2);
  assert.equal(doc.querySelector('#export').disabled,false);
  doc.querySelector('#export').click();
  await waitFor(()=>doc.body.dataset.download==='Chamber.py');
  doc.querySelector('[data-remove="2"]').click();await waitFor(()=>doc.querySelector('#compute-state').textContent==='Up to date');
});
test('invalid angle blocks export and correction clears the validation',async()=>{
  change('[data-path="ports.0.beta"]',44);
  await waitFor(()=>doc.querySelector('#compute-state').textContent==='Check inputs');
  assert.equal(doc.querySelector('#export').disabled,true);assert.match(doc.querySelector('#validation').textContent,/45/);
  change('[data-path="ports.0.beta"]',90);await waitFor(()=>doc.querySelector('#compute-state').textContent==='Up to date');
});
test('switching to ISO-F hides CF styles and produces a valid standard profile',async()=>{
  change('[data-path="ports.0.flange"]','ISO63F');
  await waitFor(()=>doc.querySelector('#compute-state').textContent==='Up to date');
  assert.equal(doc.querySelector('[data-path="ports.0.style"]'),null);
  assert.equal(doc.querySelector('#export').disabled,false);
});
