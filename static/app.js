import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { displayLength, canonicalLength, nextPortId, escapeHTML as esc, validateImport, suggestedEnd } from './state.js';
import { apiFetch, isBrowserRuntime, onRuntimeProgress } from './api.js';
import { initDimensionHelp, hideDimensionHelp } from './dimension-help.js';

const $ = selector => document.querySelector(selector);
const STORAGE_KEY='chamber-studio-v1';
let catalog, config, evaluation=null, timer, version=0, activeRequest=null, firstView=true, renderer, scene, camera, controls, meshGroup, labelPoints=[], labels=[], selectedPorts=[];
let renderFrame=null;
const viewport=$('#viewport');
const dimensionFields=[['od','Flange OD'],['bore','Bore'],['thickness','Thickness'],['boltCircle','Bolt circle'],['holeDiameter','Hole diameter'],['holeCount','Hole count','count'],['sealInner','Seal inner Ø'],['sealOuter','Seal outer Ø'],['sealDepth','Recess depth']];
const knifeFields=[['knifeEdgeDiameter','Knife circle Ø'],['knifeTipSetback','Knife setback'],['knifeHalfWidth','Knife half-width']];

function toast(message){const box=$('#toast');box.textContent=message;box.hidden=false;clearTimeout(box.timer);box.timer=setTimeout(()=>box.hidden=true,6500);}
function pathValue(path){return path.split('.').reduce((o,k)=>o?.[k],config);}
function setPath(path,value){const keys=path.split('.');let node=config;for(const key of keys.slice(0,-1)){node[key]??={};node=node[key];}node[keys.at(-1)]=value;}
function numericFieldName(path,label,unit=''){
  const id='field-'+path.replaceAll('.','-');
  return `<span class="field-name"><label for="${esc(id)}">${esc(label)}${unit?` <em>${unit}</em>`:''}</label><button type="button" class="dimension-help" data-help-path="${esc(path)}" aria-label="Explain ${esc(label)}" aria-controls="dimension-tooltip" aria-expanded="false"><span class="dimension-help-icon" aria-hidden="true">?</span></button></span>`;
}
function numberField(path,label,{value=pathValue(path),kind='length',min,max}={}){
  const shown=kind==='length'?displayLength(value,config.units):(value??'');
  const unit=kind==='length'?config.units:kind==='angle'?'°':'';
  return `<div class="field">${numericFieldName(path,label,unit)}<input id="field-${esc(path.replaceAll('.','-'))}" type="number" inputmode="decimal" data-path="${esc(path)}" data-kind="${kind}" value="${shown}" step="${kind==='count'?'1':'any'}" ${min!=null?`min="${min}"`:''} ${max!=null?`max="${max}"`:''} aria-label="${esc(label)}${unit?' ('+unit+')':''}"></div>`;
}
function selectField(path,label,options,disabled=false){const numeric=path==='body.od';return `<${numeric?'div':'label'} class="field">${numeric?numericFieldName(path,label):`<span>${esc(label)}</span>`}<select ${numeric?'id="field-body-od"':''} data-path="${esc(path)}" ${disabled?'disabled':''}>${options.map(o=>{const value=typeof o==='string'?o:o.id;const text=typeof o==='string'?o:o.label;return `<option value="${esc(value)}" ${pathValue(path)===value?'selected':''}>${esc(text)}</option>`;}).join('')}</select></${numeric?'div':'label'}>`;}
function sourceNote(dims){const url=dims.source;let link='';try{if(url&&new URL(url).protocol==='https:')link=` <a href="${esc(url)}" target="_blank" rel="noopener">Dimension source ↗</a>`;}catch{}
  return `<p class="profile-note">${esc(dims.notes||'Editable custom profile. Confirm its dimensions.')} ${link}</p>`;
}
function profileFields(path,dims,family,port=false){
  const fields=[...dimensionFields,...(port?[['tubeOD','Tube OD'],['tubeWall','Tube wall']]:[]),...(family==='CF'?knifeFields:[])];
  return `<div class="form-grid three">${fields.map(([key,label,kind])=>numberField(`${path}.${key}`,label,{value:dims[key],kind:kind||'length'})).join('')}</div>`;
}
function renderBody(){
  const b=config.body;
  const diameters=(catalog.bodyDiameters||[323.85,406.4,508,609.6,762,914.4]).map(d=>({id:String(d),label:`${displayLength(d,config.units)} ${config.units}`}));
  const old=b.od;b.od=String(b.od);
  const odSelect=selectField('body.od','Chamber body OD',diameters);b.od=old;
  $('#body-fields').innerHTML=`<div class="form-grid three">${odSelect}${numberField('body.height','Chamber height',{max:displayLength(914.4,config.units),min:0})}${numberField('body.wall','Wall thickness',{min:0})}</div><div class="body-divider"></div><div class="form-grid">${selectField('body.top','Chamber top',['ISO-F','CF FXD'])}${selectField('body.bottom','Chamber bottom',['ISO-F','CF FXD'])}</div><details class="advanced" data-detail="body"><summary>End-flange dimensions & sealing details</summary><p>Height is measured between the outward end faces. Wall thickness and unsourced seal sections are editable design assumptions.</p>${['top','bottom'].map(side=>`<h3 class="dim-title">${side==='top'?'Top':'Bottom'} · ${esc(b[side])}</h3>${sourceNote(b[side+'Spec'])}${profileFields('body.'+side+'Spec',b[side+'Spec'],b[side]==='CF FXD'?'CF':'ISO-F')}`).join('')}</details>`;
}
function flangeFor(port){return {...catalog.flanges.find(f=>f.id===port.flange),...port.dimensions};}
function renderPorts(){
  $('#port-count').textContent=config.ports.length;
  $('#add-port').disabled=config.ports.length>=32;
  $('#ports').innerHTML=config.ports.length?config.ports.map((port,i)=>{
    const path=`ports.${i}`, dims=flangeFor(port);
    return `<article class="port-card" data-port="${esc(port.id)}"><div class="port-heading"><span class="port-id">${esc(port.id)}</span><span class="port-name">Port ${esc(port.id)}</span><span class="port-state">Ready</span><button class="duplicate-port" data-duplicate="${i}" title="Duplicate port ${esc(port.id)}">Duplicate</button><button data-remove="${i}" aria-label="Remove port ${esc(port.id)}">×</button></div><div class="port-fields"><div class="form-grid">${selectField(path+'.flange','Flange type',catalog.flanges.map(f=>({id:f.id,label:f.label})))}${dims.family==='CF'?selectField(path+'.style','CF flange style',catalog.cfStyles||[{id:'fixed-through',label:'Fixed, Through-hole'},{id:'fixed-tapped',label:'Fixed, Tapped'},{id:'rotatable-through',label:'Rotatable, Through-hole'},{id:'rotatable-tapped',label:'Rotatable, Tapped'}]):'<label class="field"><span>Flange style</span><input value="Fixed, Through-hole" disabled></label>'}</div><div class="angles">${numberField(path+'.elevation','Focal pt. elevation')}${numberField(path+'.focalLength','Focal length')}${numberField(path+'.alpha','Alpha',{kind:'angle',min:0,max:360})}${numberField(path+'.beta','Beta',{kind:'angle',min:45,max:135})}</div><label class="field port-notes"><input data-path="${path}.notes" value="${esc(port.notes)}" aria-label="Port ${esc(port.id)} notes" placeholder="Port use / notes"></label><details class="advanced" data-detail="port-${esc(port.id)}"><summary>Flange dimensions & sealing details</summary>${sourceNote(dims)}${profileFields(path+'.dimensions',dims,dims.family,true)}${dims.family==='CF'?`<p>Imperial threads on tapped flanges: ${esc(dims.thread||'custom')}. Thread preview uses the nominal envelope.</p>`:''}</details></div></article>`;
  }).join(''):'<p class="empty-ports">No ports yet. Add a port to begin placing connections.</p>';
}
function render(){
  hideDimensionHelp();
  const open=new Set([...document.querySelectorAll('details[data-detail][open]')].map(d=>d.dataset.detail));
  renderBody();renderPorts();$('#notes').value=config.notes||'';
  document.querySelectorAll('[data-unit]').forEach(b=>b.classList.toggle('active',b.dataset.unit===config.units));
  document.querySelectorAll('details[data-detail]').forEach(d=>d.open=open.has(d.dataset.detail));
  updatePortStates();
}
function persist(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(config));$('#save-state').textContent='Saved in this browser';}catch{$('#save-state').textContent='Use Save to keep this configuration';}}
function schedule(){
  hideDimensionHelp();
  version++;evaluation=null;$('#export').disabled=true;$('#compute-state').textContent='Updating…';$('#compute-state').className='status-chip busy';
  $('#collision-summary').className='neutral';$('#collision-summary').innerHTML='<span class="icon">⋯</span><div><strong>Checking current configuration</strong><small>The previous preview remains visible while geometry updates.</small></div>';
  $('#collision-list').replaceChildren();$('#validation').replaceChildren();
  clearTimeout(timer);persist();timer=setTimeout(compute,450);
}
async function compute(){
  const requestVersion=version;
  if(activeRequest)activeRequest.abort();activeRequest=new AbortController();
  try{
    const response=await apiFetch('/api/evaluate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(config),signal:activeRequest.signal});
    const result=await response.json();if(requestVersion!==version)return;
    if(!response.ok)throw Error(result.error||'Could not evaluate the chamber.');
    evaluation=result;updateResults();updateMeshes(result.meshes||[]);if(firstView&&(result.meshes||[]).length){fitView();firstView=false;}
  }catch(error){if(error.name==='AbortError'||requestVersion!==version)return;$('#compute-state').textContent='Check failed';$('#compute-state').className='status-chip bad';$('#collision-summary').className='neutral';$('#collision-summary').innerHTML='<div><strong>Collision check unavailable</strong><small>Geometry has not been verified for the current inputs.</small></div>';$('#validation').textContent=error.message;$('#export').disabled=true;}
}
function updatePortStates(){
  const collisions=new Set(evaluation?.collisions?.flatMap(c=>c.ports)||[]);
  const coincidences=new Set(evaluation?.coincidences?.flatMap(c=>c.ports)||[]);
  document.querySelectorAll('.port-card').forEach(card=>{const hit=collisions.has(card.dataset.port),coincident=coincidences.has(card.dataset.port);card.classList.toggle('colliding',hit||coincident);const invalid=evaluation?.errors?.some(e=>{const i=config.ports.findIndex(p=>p.id===card.dataset.port);return e.path?.startsWith(`ports.${i}.`);});card.querySelector('.port-state').textContent=hit?(coincident?'Collision + coincident':'Collision'):coincident?'Coincident':invalid?'Check inputs':evaluation?'Clear':'…';});
}
function updateResults(){
  const {errors=[],warnings=[],collisions=[],coincidences=[],metrics={}}=evaluation;
  const pairs=new Map();
  for(const [items,kind] of [[collisions,'collision'],[coincidences,'coincident']])for(const item of items){
    const ports=[...item.ports].sort(),key=JSON.stringify(ports);
    if(!pairs.has(key))pairs.set(key,{ports,parts:new Set(),coincident:false});
    const pair=pairs.get(key);if(kind==='coincident')pair.coincident=true;else pair.parts.add(item.parts.join(' / '));
  }
  const box=$('#collision-summary');box.className=pairs.size?'danger':errors.length?'neutral':'';
  const pairLabel=pairs.size===1?'pair':'pairs';
  const heading=coincidences.length?(collisions.length?`${pairs.size} port ${pairLabel} with collisions or coincident axes`:`${pairs.size} coincident port ${pairLabel}`):`${pairs.size} colliding port ${pairLabel}`;
  const detail=coincidences.length?'Ports with coincident axes or overlapping solids are red. Export remains available.':'Overlapping tubes or flanges are red. Export remains available.';
  box.innerHTML=pairs.size?`<span class="icon">!</span><div><strong>${heading}</strong><small>${detail}</small></div>`:errors.length?'<span class="icon">!</span><div><strong>Complete the configuration</strong><small>Resolve the inputs below to check all ports.</small></div>':'<span class="icon">✓</span><div><strong>No port collisions detected</strong><small>Port tubes and flanges are clear of one another; no coincident axes detected.</small></div>';
  $('#collision-list').innerHTML=[...pairs.values()].map(pair=>`<div class="collision-item"><span><strong>${esc(pair.ports.join(' / '))}</strong> · ${[...(pair.coincident?['Coincident axes (same position and direction)']:[]),...pair.parts].map(esc).join(', ')}</span><button data-focus="${esc(pair.ports.join('|'))}">Locate</button></div>`).join('');
  $('#validation').innerHTML=errors.length?`<ul>${errors.map(e=>`<li>${esc(e.message)}</li>`).join('')}</ul>`:'';
  $('#warnings').innerHTML=[...new Set(warnings)].map(w=>`<p>${esc(w)}</p>`).join('');
  $('#compute-state').textContent=errors.length?'Check inputs':collisions.length?'Interference':coincidences.length?'Coincident ports':'Up to date';$('#compute-state').className='status-chip'+(errors.length||pairs.size?' bad':'');
  $('#export').disabled=errors.length>0;
  $('#model-stats').innerHTML=`<div>BODY OD<strong>${displayLength(config.body.od,config.units)} ${config.units}</strong></div><div>HEIGHT<strong>${displayLength(config.body.height,config.units)} ${config.units}</strong></div><div>PORTS<strong>${metrics.portCount??config.ports.length}</strong></div><div>EXPORT<strong>Editable Fusion features</strong></div>`;
  updatePortStates();
}

function requestSceneRender(){
  if(renderFrame!==null)return;
  renderFrame=requestAnimationFrame(()=>{
    renderFrame=null;
    // OrbitControls emits change while damping is moving the camera, scheduling
    // the next frame. Once it settles, the static preview uses no draw loop.
    controls.update();renderer.render(scene,camera);updateLabels();
  });
}
function setupScene(){
  try{
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0xedf2f4,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
    viewport.prepend(renderer.domElement);scene=new THREE.Scene();
    camera=new THREE.PerspectiveCamera(35,1,0.1,20000);camera.up.set(0,0,1);camera.position.set(850,-1100,850);
    controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.07;controls.minDistance=50;controls.maxDistance=10000;controls.target.set(0,0,254);
    controls.addEventListener('change',requestSceneRender);
    scene.add(new THREE.HemisphereLight(0xf7fcff,0x7d9199,2.3));
    for(const [position,intensity] of [[[700,-600,1500],2.7],[[-600,300,600],1.3],[[0,800,1500],1.5]]){const light=new THREE.DirectionalLight(0xffffff,intensity);light.position.set(...position);scene.add(light);}
    const grid=new THREE.GridHelper(2600,52,0xb8cbd1,0xd9e3e6);grid.rotation.x=Math.PI/2;grid.position.z=-.7;grid.material.transparent=true;grid.material.opacity=.4;scene.add(grid);
    meshGroup=new THREE.Group();scene.add(meshGroup);
    const axes=new THREE.AxesHelper(100);axes.position.set(0,0,-.5);axes.material.transparent=true;axes.material.opacity=.65;scene.add(axes);
    new ResizeObserver(()=>{const w=viewport.clientWidth,h=viewport.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();requestSceneRender();}).observe(viewport);
    requestSceneRender();
  }catch(error){$('#webgl-error').hidden=false;$('#webgl-error').textContent='The 3D preview needs WebGL. Enable hardware acceleration in your browser, then reload. Configuration and export remain available. '+error.message;}
}
function updateMeshes(meshes){
  if(!meshGroup)return;
  while(meshGroup.children.length){const obj=meshGroup.children[0];obj.traverse(child=>{child.geometry?.dispose();if(child.material)child.material.dispose();});meshGroup.remove(obj);}
  const xray=$('#transparent').checked;
  for(const data of meshes){
    if(!data.positions?.length)continue;
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));geo.setIndex(data.indices);geo.computeVertexNormals();
    // Flat normals retain crisp bolt holes and sealing edges across the CSG mesh.
    const material=new THREE.MeshStandardMaterial({color:data.collision||data.coincident?0xd94a55:data.kind==='body'?0xb3c6cf:0xc9d7dd,metalness:.35,roughness:.38,side:THREE.DoubleSide,flatShading:true,transparent:xray,opacity:xray?.35:1,depthWrite:!xray});
    const mesh=new THREE.Mesh(geo,material);mesh.userData=data;meshGroup.add(mesh);
  }
  labelPoints=[];$('#port-labels').replaceChildren();labels=[];
  for(const p of config.ports){
    if(!meshes.some(m=>m.portId===p.id))continue;
    const a=p.alpha*Math.PI/180,b=p.beta*Math.PI/180,L=p.focalLength;
    const point=new THREE.Vector3(L*Math.sin(b)*Math.cos(a),L*Math.sin(b)*Math.sin(a),p.elevation+L*Math.cos(b));
    const label=document.createElement('span');label.className='port-label'+([...(evaluation?.collisions||[]),...(evaluation?.coincidences||[])].some(c=>c.ports.includes(p.id))?' bad':'');label.textContent=p.id;$('#port-labels').append(label);labels.push(label);labelPoints.push(point);
  }
  requestSceneRender();
}
function updateLabels(){
  if(!camera)return;labelPoints.forEach((point,i)=>{const p=point.clone().project(camera);const visible=p.z>=-1&&p.z<=1&&Math.abs(p.x)<1&&Math.abs(p.y)<1;labels[i].style.display=visible?'block':'none';if(visible){labels[i].style.left=`${(p.x*.5+.5)*viewport.clientWidth}px`;labels[i].style.top=`${(-p.y*.5+.5)*viewport.clientHeight}px`;}});
}
function fitView(kind='3d'){
  if(!meshGroup?.children.length)return;const box=new THREE.Box3().setFromObject(meshGroup),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
  const extent=Math.max(size.x,size.y,size.z),distance=extent/(2*Math.tan(camera.fov*Math.PI/360))*1.4/Math.min(1,camera.aspect);
  const dir=kind==='top'?new THREE.Vector3(0,-.001,1):kind==='front'?new THREE.Vector3(0,-1,.001):new THREE.Vector3(1.25,-1.8,1.05).normalize();
  controls.target.copy(center);camera.position.copy(center).addScaledVector(dir,distance);camera.near=Math.max(.1,extent/10000);camera.far=distance*20;camera.updateProjectionMatrix();controls.update();
  requestSceneRender();
  document.querySelectorAll('.view-toolbar button').forEach(b=>b.classList.toggle('active',b.id===(kind==='3d'?'view-iso':'view-'+kind)));
}
function focusPorts(ids){
  selectedPorts=ids;
  document.querySelectorAll('.port-card').forEach(c=>{c.classList.remove('part-highlight');if(ids.includes(c.dataset.port)){c.classList.add('part-highlight');}});
  const first=[...document.querySelectorAll('.port-card')].find(c=>c.dataset.port===ids[0]);first?.scrollIntoView({behavior:'smooth',block:'center'});
  if(!meshGroup)return;const box=new THREE.Box3();meshGroup.children.filter(m=>ids.includes(m.userData.portId)).forEach(m=>box.expandByObject(m));if(!box.isEmpty()){const center=box.getCenter(new THREE.Vector3()),offset=camera.position.clone().sub(controls.target);controls.target.copy(center);camera.position.copy(center).add(offset);controls.update();requestSceneRender();}
}

function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function bindEvents(){
  document.querySelector('.editor').addEventListener('input',event=>{
    const el=event.target,path=el.dataset.path;if(!path||el.tagName==='SELECT')return;
    let value=el.type==='number'?(el.dataset.kind==='length'?canonicalLength(el.value,config.units):el.value===''?null:Number(el.value)):el.value;
    setPath(path,value);if(path.includes('.dimensions.'))setPath(path.split('.dimensions.')[0]+'.dimensions.verified',false);schedule();
  });
  document.querySelector('.editor').addEventListener('change',event=>{
    const el=event.target,path=el.dataset.path;if(!path||el.tagName!=='SELECT')return;
    setPath(path,path==='body.od'?Number(el.value):el.value);
    if(path==='body.od'||path==='body.top'||path==='body.bottom'){
      for(const side of ['top','bottom']){if(path==='body.od'||path===`body.${side}`)config.body[side+'Spec']=suggestedEnd(config.body.od,config.body[side]==='CF FXD'?'CF':'ISO-F',catalog);}
    }
    if(path.endsWith('.flange')){const port=config.ports[Number(path.split('.')[1])];port.dimensions={};port.style='fixed-through';}
    render();schedule();
  });
  $('#notes').addEventListener('input',()=>{config.notes=$('#notes').value;persist();});
  document.querySelectorAll('[data-unit]').forEach(b=>b.addEventListener('click',()=>{config.units=b.dataset.unit;render();persist();if(evaluation)updateResults();}));
  $('#add-port').addEventListener('click',()=>{if(config.ports.length>=32)return;const template=config.ports.at(-1);config.ports.push({id:nextPortId(config.ports),flange:'CF40',style:'fixed-through',elevation:config.body.height/2,focalLength:config.body.od/2+80,alpha:template?(template.alpha+60)%360:0,beta:90,notes:'',dimensions:{}});render();schedule();});
  $('#ports').addEventListener('click',event=>{
    const remove=event.target.closest('[data-remove]'),duplicate=event.target.closest('[data-duplicate]');
    if(remove){config.ports.splice(Number(remove.dataset.remove),1);render();schedule();}
    if(duplicate&&config.ports.length<32){const port=structuredClone(config.ports[Number(duplicate.dataset.duplicate)]);port.id=nextPortId(config.ports);config.ports.push(port);render();schedule();toast('Port duplicated at the same position. Change its placement to clear the overlap.');}
  });
  $('#collision-list').addEventListener('click',e=>{const b=e.target.closest('[data-focus]');if(b)focusPorts(b.dataset.focus.split('|'));});
  $('#fit').onclick=()=>fitView();$('#view-iso').onclick=()=>fitView();$('#view-top').onclick=()=>fitView('top');$('#view-front').onclick=()=>fitView('front');
  $('#transparent').onchange=()=>{if(evaluation)updateMeshes(evaluation.meshes||[]);};
  $('#help-open').onclick=()=>$('#help').showModal();$('#help-close').onclick=()=>$('#help').close();
  $('#save').onclick=()=>download(JSON.stringify(config,null,2),'chamber-config.json','application/json');
  $('#open-file').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>1_000_000)throw Error('Configuration file is too large.');const candidate=validateImport(JSON.parse(await file.text()));const response=await apiFetch('/api/evaluate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(candidate)});const result=await response.json();if(!response.ok)throw Error(result.error);if(result.errors?.some(e=>!e.path?.startsWith('ports.')))throw Error(result.errors.map(e=>e.message).join(' '));config=candidate;firstView=true;render();schedule();toast('Configuration opened.');}catch(error){toast('Could not open configuration: '+error.message);}finally{event.target.value='';}};
  $('#reset').onclick=async()=>{try{const response=await apiFetch('/api/default');if(!response.ok)throw Error('Could not load example');config=await response.json();firstView=true;render();schedule();}catch(error){toast(error.message);}};
  $('#export').onclick=async()=>{const button=$('#export'),snapshot=structuredClone(config);button.disabled=true;button.textContent='Preparing…';try{const response=await apiFetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot)});if(!response.ok){const error=await response.json();throw Error(error.error||'Export failed');}download(await response.text(),'Chamber.py','text/x-python');toast('Chamber.py downloaded. Create a Python script named Chamber in Fusion, replace its Chamber.py, then Run. See Run in Fusion for instructions.');}catch(error){toast(error.message);}finally{button.textContent='↓ Export Fusion Python';button.disabled=!evaluation||evaluation.errors?.length>0;}};
}

async function start(){
  let stopProgress=()=>{};
  if(isBrowserRuntime){
    $('#workspace-label').textContent='Browser workspace';
    $('#compute-state').textContent='Loading geometry…';
    $('#compute-state').className='status-chip busy';
    $('#validation').textContent='Loading geometry tools. The first visit may take a moment.';
    stopProgress=onRuntimeProgress(message=>{$('#validation').textContent=message;});
  }
  try{
    const responses=await Promise.all([apiFetch('/api/catalog'),apiFetch('/api/default')]);if(responses.some(r=>!r.ok))throw Error('Could not load chamber data.');[catalog,config]=await Promise.all(responses.map(r=>r.json()));
    try{const stored=localStorage.getItem(STORAGE_KEY);if(stored)config=validateImport(JSON.parse(stored));}catch{toast('The saved configuration could not be loaded. The example has been restored.');}
    stopProgress();initDimensionHelp();render();bindEvents();setupScene();schedule();
  }catch(error){stopProgress();$('#compute-state').textContent=isBrowserRuntime?'Could not start':'Disconnected';$('#compute-state').className='status-chip bad';$('#validation').textContent=error.message+(isBrowserRuntime?(error.name==='GeometryRuntimeError'?'':' Check your connection and reload this page.'):' Start the local server and reload this page.');}
}
start();
