import {createManifoldBridge} from './manifold-bridge.js';

const resource = path => new URL(path, import.meta.url);
const progress = message => self.postMessage({type: 'progress', message});
let initialization;
let queue = Promise.resolve();

async function readResource(path) {
  const response = await fetch(resource(path));
  if (!response.ok) throw new Error(`Cannot load ${path} (${response.status}).`);
  return response.text();
}

async function initialize() {
  progress('Loading the browser geometry engine…');
  const [{loadPyodide}, {default: ManifoldModule}, catalog, sources] = await Promise.all([
    import(resource('./vendor/pyodide/pyodide.mjs').href),
    import(resource('./vendor/manifold/manifold.js').href),
    readResource('./data/catalog.json'),
    Promise.all(['manifold3d.py', 'chamber.py', 'fusion_export.py', 'service.py']
      .map(async name => [name, await readResource(`./python/${name}`)])),
  ]);
  const [pyodide, wasm] = await Promise.all([
    loadPyodide({indexURL: resource('./vendor/pyodide/').href}),
    ManifoldModule({locateFile: path => resource(`./vendor/manifold/${path}`).href}),
  ]);
  wasm.setup();
  const bridge = createManifoldBridge(wasm);
  pyodide.registerJsModule('_manifold_bridge', bridge);
  progress('Preparing geometry calculations…');
  await pyodide.loadPackage('numpy');
  for (const [name, source] of sources) pyodide.FS.writeFile(`/home/pyodide/${name}`, source);
  pyodide.globals.set('_catalog_json', catalog);
  pyodide.runPython(`
import json
from service import default_config, evaluate_document
from fusion_export import generate_script

_catalog = json.loads(_catalog_json)
del _catalog_json

def _browser_request(path, serialized):
    try:
        if path == "/api/catalog":
            return json.dumps({"status": 200, "body": _catalog}, allow_nan=False)
        if path == "/api/default":
            return json.dumps({"status": 200, "body": default_config(_catalog)}, allow_nan=False)
        if path not in ("/api/evaluate", "/api/export"):
            return json.dumps({"status": 404, "body": {"error": "Not found"}})
        if not isinstance(serialized, str) or not 0 < len(serialized.encode("utf-8")) <= 1_000_000:
            raise ValueError("Invalid configuration size.")
        config = json.loads(serialized)
        result = evaluate_document(config, _catalog, include_mesh=path == "/api/evaluate")
        if path == "/api/evaluate":
            body, status = result, 200
        elif result.get("errors"):
            body, status = {"error": "Resolve invalid dimensions before export.", "errors": result["errors"]}, 422
        else:
            body, status = generate_script(config, _catalog), 200
        return json.dumps({"status": status, "body": body}, allow_nan=False, separators=(",", ":"))
    except (ValueError, TypeError, KeyError) as exc:
        return json.dumps({"status": 400, "body": {"error": str(exc)}})
    except Exception as exc:
        return json.dumps({"status": 500, "body": {"error": "Geometry generation failed: " + str(exc)}})
`);
  progress('Browser geometry engine ready.');
  return {bridge, request: pyodide.globals.get('_browser_request')};
}

async function handleRequest({id, path, body}) {
  let runtime;
  try {
    initialization ??= initialize();
    runtime = await initialization;
    const result = JSON.parse(runtime.request(path, body ?? null));
    self.postMessage({id, ...result});
  } catch (error) {
    self.postMessage({id, status: 500, body: {error: `Browser geometry engine failed: ${error.message || error}`}});
  } finally {
    runtime?.bridge.releaseAll();
  }
}

self.addEventListener('message', event => {
  // One Python/WASM call at a time, including during the initial downloads.
  queue = queue.then(() => handleRequest(event.data)).catch(error => {
    self.postMessage({id: event.data.id, status: 500, body: {error: String(error)}});
  });
});
