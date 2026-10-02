// The document stores millimeters regardless of display units.
export const MM_PER_INCH = 25.4;
export function displayLength(mm, units) { return mm == null ? '' : +(mm / (units === 'in' ? MM_PER_INCH : 1)).toFixed(5); }
export function canonicalLength(value, units) { return value === '' ? null : Number(value) * (units === 'in' ? MM_PER_INCH : 1); }
export function portLabel(index) { let out=''; for(let n=index+1;n>0;n=Math.floor((n-1)/26)) out=String.fromCharCode(65+(n-1)%26)+out; return out; }
export function nextPortId(ports) { for(let i=0;;i++){const id=portLabel(i);if(!ports.some(p=>p.id===id))return id;} }
export function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function validateImport(value) {
  if(!value || typeof value!=='object'||value.schemaVersion!==1||!value.body||typeof value.body!=='object'||!Array.isArray(value.ports)) throw Error('This is not a Chamber Studio configuration.');
  if(!['in','mm'].includes(value.units)) throw Error('Configuration units must be in or mm.');
  if(!['od','height','wall'].every(k=>typeof value.body[k]==='number'&&Number.isFinite(value.body[k]))) throw Error('Chamber dimensions are missing or invalid.');
  for(const side of ['top','bottom']){
    if(!['CF FXD','ISO-F'].includes(value.body[side])||!value.body[side+'Spec']||typeof value.body[side+'Spec']!=='object') throw Error('Chamber end profiles are missing or invalid.');
  }
  if(value.ports.length>32) throw Error('A configuration can contain up to 32 ports.');
  if(value.ports.some(p=>!p||typeof p!=='object'||typeof p.id!=='string'||typeof p.flange!=='string')) throw Error('Invalid port entries.');
  return value;
}
export function suggestedEnd(od, family, catalog) {
  const match=(catalog.endProfiles||[]).find(p=>p.family===family&&Math.abs(p.bodyOD-od)<0.1);
  if(match) return structuredClone(match);
  return {od:od+80,bore:od-6.35,thickness:24,boltCircle:od+50,holeDiameter:14,holeCount:24,sealInner:od-3,sealOuter:od+9,sealDepth:2.5,knifeEdgeDiameter:od+3,knifeTipSetback:1.25,knifeHalfWidth:.5,verified:false,notes:'Custom end profile: confirm all dimensions against a drawing.'};
}
