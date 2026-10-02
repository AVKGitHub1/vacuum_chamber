// Produce a self-contained site. No Python server or runtime CDN is needed.
import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'dist');
const cache=path.join(root,'.build-cache','pyodide');
const packages=path.join(root,'node_modules');
const pyodideDir=path.join(packages,'pyodide');
const pyodidePackage=JSON.parse(await readFile(path.join(pyodideDir,'package.json'),'utf8'));
const lock=JSON.parse(await readFile(path.join(pyodideDir,'pyodide-lock.json'),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

async function bundledPackage(name, seen=new Set()){
  if(seen.has(name))return;
  seen.add(name);
  const item=lock.packages[name];
  if(!item)throw Error(`Pyodide package ${name} is absent from its pinned lockfile.`);
  for(const dependency of item.depends)await bundledPackage(dependency,seen);
  const cached=path.join(cache,item.file_name);
  let bytes;
  try{bytes=await readFile(cached);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!bytes||hash(bytes)!==item.sha256){
    const url=`https://cdn.jsdelivr.net/pyodide/v${pyodidePackage.version}/full/${item.file_name}`;
    console.log(`Downloading ${name} ${item.version} for the browser…`);
    const response=await fetch(url,{signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw Error(`Could not download ${url}: HTTP ${response.status}`);
    bytes=Buffer.from(await response.arrayBuffer());
    if(hash(bytes)!==item.sha256)throw Error(`Integrity check failed for ${item.file_name}.`);
    await mkdir(cache,{recursive:true});
    await writeFile(cached,bytes);
  }
  await writeFile(path.join(output,'vendor','pyodide',item.file_name),bytes);
}

// The only directory removed is this project's fixed, generated dist directory.
if(path.dirname(output)!==root||path.basename(output)!=='dist')throw Error('Invalid build output directory.');
await rm(output,{recursive:true,force:true});
await cp(path.join(root,'static'),output,{recursive:true});
await mkdir(path.join(output,'python'),{recursive:true});
await mkdir(path.join(output,'data'),{recursive:true});
for(const filename of ['chamber.py','fusion_export.py','service.py']){
  await cp(path.join(root,filename),path.join(output,'python',filename));
}
await cp(path.join(root,'browser','manifold3d.py'),path.join(output,'python','manifold3d.py'));
await cp(path.join(root,'data','catalog.json'),path.join(output,'data','catalog.json'));
await mkdir(path.join(output,'examples','Chamber'),{recursive:true});
await cp(path.join(root,'examples','Chamber','chamber-config.json'),path.join(output,'examples','Chamber','chamber-config.json'));

await mkdir(path.join(output,'vendor','pyodide'),{recursive:true});
for(const filename of ['pyodide.mjs','pyodide.asm.js','pyodide.asm.wasm','pyodide-lock.json','python_stdlib.zip']){
  await cp(path.join(pyodideDir,filename),path.join(output,'vendor','pyodide',filename));
}
await bundledPackage('numpy');
await mkdir(path.join(output,'vendor','manifold'),{recursive:true});
for(const filename of ['manifold.js','manifold.wasm','LICENSE']){
  await cp(path.join(packages,'manifold-3d',filename),path.join(output,'vendor','manifold',filename));
}

const indexPath=path.join(output,'index.html');
const html=await readFile(indexPath,'utf8');
const marker='<meta name="chamber-runtime" content="server">';
if(!html.includes(marker))throw Error('The source HTML is missing the chamber-runtime marker.');
await writeFile(indexPath,html.replace(marker,'<meta name="chamber-runtime" content="browser">'));
await writeFile(path.join(output,'.nojekyll'),'');
await writeFile(path.join(output,'vendor','PYODIDE-NOTICE.txt'),
  `Pyodide ${pyodidePackage.version}: Mozilla Public License 2.0\n`+
  'Source and license: https://github.com/pyodide/pyodide\n'+
  'License text: https://www.mozilla.org/MPL/2.0/\n'+
  'Python and NumPy retain their own licenses included in the runtime and NumPy wheel.\n');
console.log(`Built GitHub Pages site in ${output}`);
