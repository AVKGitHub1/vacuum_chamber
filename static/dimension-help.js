import {getDimensionHelp} from './dimension-diagrams.js';
import {escapeHTML as esc} from './state.js';

let tooltip, active, pendingButton, showTimer, hideTimer, pinned=false, hovered=false;
let pointerX, pointerY;

export function hideDimensionHelp() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  showTimer=hideTimer=null;
  pendingButton=null;
  if(active){
    active.removeAttribute('aria-describedby');
    active.setAttribute('aria-expanded','false');
  }
  if(tooltip)tooltip.hidden=true;
  active=null;
  pinned=false;
  hovered=false;
}

function positionTooltip() {
  if(!active?.isConnected){hideDimensionHelp();return;}
  const anchor=active.getBoundingClientRect();
  const width=document.documentElement.clientWidth||window.innerWidth;
  const height=window.innerHeight;
  if(anchor.bottom<0||anchor.top>height){hideDimensionHelp();return;}
  const box=tooltip.getBoundingClientRect(),margin=10,gap=12;
  let left=anchor.right+gap,top=anchor.top-12;
  if(left+box.width>width-margin)left=anchor.left-box.width-gap;
  if(left<margin){
    left=Math.min(Math.max(anchor.left,margin),width-box.width-margin);
    const field=active.closest('.field')?.getBoundingClientRect()||anchor;
    top=field.top-box.height-gap;
    if(top<margin)top=field.bottom+gap;
  }
  top=Math.min(Math.max(top,margin),height-box.height-margin);
  tooltip.style.left=`${Math.max(margin,left)}px`;
  tooltip.style.top=`${Math.max(margin,top)}px`;
}

function showHelp(button) {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  showTimer=hideTimer=null;
  pendingButton=null;
  const help=getDimensionHelp(button.dataset.helpPath);
  if(!help)return;
  if(active!==button){hideDimensionHelp();active=button;}
  tooltip.innerHTML=`<div class="dimension-tooltip-head"><span class="eyebrow">DIMENSION GUIDE</span><span class="dimension-view">${esc(help.view)}</span></div><h3>${esc(help.title)}</h3>${help.svg}<p id="dimension-tooltip-description">${esc(help.description)}</p><small>Schematic · not to scale</small>`;
  tooltip.dataset.helpKey=help.key;
  tooltip.hidden=false;
  active.setAttribute('aria-describedby','dimension-tooltip-description');
  active.setAttribute('aria-expanded','true');
  positionTooltip();
}

function queueHide() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  showTimer=null;
  pendingButton=null;
  hideTimer=setTimeout(()=>{
    hideTimer=null;
    if(!pinned&&!hovered&&document.activeElement!==active)hideDimensionHelp();
  },180);
}

export function initDimensionHelp() {
  if(tooltip)return;
  tooltip=document.createElement('aside');
  tooltip.id='dimension-tooltip';
  tooltip.className='dimension-tooltip';
  tooltip.setAttribute('role','tooltip');
  tooltip.hidden=true;
  document.body.append(tooltip);

  document.addEventListener('pointermove',event=>{
    if(event.pointerType==='touch')return;
    // Replacing or repositioning a field can emit pointerover without the user
    // moving. Only actual movement should reopen a dismissed schematic.
    if(event.clientX===pointerX&&event.clientY===pointerY)return;
    pointerX=event.clientX;pointerY=event.clientY;
    const button=event.target.closest?.('.dimension-help');
    if(!button)return;
    clearTimeout(hideTimer);
    if(button===active||button===pendingButton)return;
    clearTimeout(showTimer);
    pendingButton=button;
    showTimer=setTimeout(()=>{showTimer=null;pendingButton=null;if(button.isConnected)showHelp(button);},160);
  });
  document.addEventListener('pointerout',event=>{
    const button=event.target.closest?.('.dimension-help');
    if(!button||button.contains(event.relatedTarget))return;
    if(tooltip.contains(event.relatedTarget)){clearTimeout(hideTimer);return;}
    queueHide();
  });
  tooltip.addEventListener('pointerenter',()=>{hovered=true;clearTimeout(hideTimer);});
  tooltip.addEventListener('pointerleave',event=>{
    hovered=false;
    if(active?.contains(event.relatedTarget))return;
    queueHide();
  });
  document.addEventListener('focusin',event=>{
    const button=event.target.closest?.('.dimension-help');
    if(button)showHelp(button);
    else hideDimensionHelp();
  });
  document.addEventListener('focusout',event=>{
    if(event.target===active&&!tooltip.contains(event.relatedTarget))hideDimensionHelp();
  });
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('.dimension-help');
    if(!button)return;
    event.preventDefault();
    if(active===button&&pinned)hideDimensionHelp();
    else {showHelp(button);pinned=true;}
  });
  document.addEventListener('pointerdown',event=>{
    if(!event.target.closest?.('.dimension-help')&&!tooltip.contains(event.target))hideDimensionHelp();
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&(active||showTimer)){event.preventDefault();hideDimensionHelp();}
  });
  document.addEventListener('toggle',event=>{
    if(!event.target.open&&active&&event.target.contains(active))hideDimensionHelp();
  },true);
  document.addEventListener('scroll',()=>{if(active)positionTooltip();},true);
  window.addEventListener('resize',()=>{if(active)positionTooltip();});
}
