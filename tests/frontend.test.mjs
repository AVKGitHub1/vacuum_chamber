import {test} from 'node:test';
import assert from 'node:assert/strict';
import {displayLength,canonicalLength,nextPortId,validateImport,suggestedEnd,escapeHTML} from '../static/state.js';

test('unit switching preserves canonical millimeters and angles remain untouched',()=>{
  assert.equal(displayLength(508,'in'),20);
  assert.equal(canonicalLength('20','in'),508);
  assert.equal(canonicalLength('508','mm'),508);
  assert.equal(canonicalLength('','in'),null);
  for(const mm of [3.175,323.85,36.576,914.4]) assert.ok(Math.abs(canonicalLength(String(displayLength(mm,'in')),'in')-mm)<.0002);
});
test('port identifiers remain stable after deletion and extend beyond Z',()=>{
  assert.equal(nextPortId([{id:'A'},{id:'C'}]),'B');
  assert.equal(nextPortId(Array.from({length:26},(_,i)=>({id:String.fromCharCode(65+i)}))),'AA');
});
test('saved documents reject incompatible versions and excessive port counts',()=>{
  const base={schemaVersion:1,units:'mm',body:{od:323.85,height:508,wall:3.175,top:'ISO-F',bottom:'ISO-F',topSpec:{},bottomSpec:{}},ports:[]};assert.equal(validateImport(base),base);
  assert.throws(()=>validateImport({...base,schemaVersion:2}));
  assert.throws(()=>validateImport({...base,ports:Array(33).fill({id:'A'})}));
  assert.throws(()=>validateImport({...base,units:'cm'}));
  assert.throws(()=>validateImport({...base,body:{}}));
});
test('end profile uses vendor match without mutating catalog and labels custom fallback',()=>{
  const profile={bodyOD:323.85,family:'CF',od:419.1};const result=suggestedEnd(323.85,'CF',{endProfiles:[profile]});assert.equal(result.od,419.1);result.od=450;assert.equal(profile.od,419.1);
  assert.equal(suggestedEnd(914.4,'CF',{}).verified,false);
});
test('notes and imported labels are escaped before insertion in HTML',()=>{
  assert.equal(escapeHTML('<img src="x">'),'&lt;img src=&quot;x&quot;&gt;');
});
