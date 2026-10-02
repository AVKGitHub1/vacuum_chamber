import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import test from 'node:test';
import {loadPyodide} from 'pyodide';
import ManifoldModule from 'manifold-3d';
import {createManifoldBridge} from '../static/manifold-bridge.js';

const root = fileURLToPath(new URL('../', import.meta.url));

test('browser WASM geometry matches native validation, solids and Fusion export', {timeout: 180000}, async () => {
  const python = process.env.PYTHON || join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const native = spawnSync(python, ['-c', `
import copy, json
from server import CATALOG, default_config
from service import evaluate_document
from fusion_export import generate_script
base = default_config()
variants = {"default": base}
collision = copy.deepcopy(base)
collision["ports"][1] = dict(copy.deepcopy(collision["ports"][0]), id="B")
variants["collision"] = collision
nested = copy.deepcopy(collision)
nested["ports"] = nested["ports"][:2]
nested["ports"][0].update(flange="CF40", dimensions={}, focalLength=240)
nested["ports"][1]["dimensions"] = {}
nested["ports"][1].update(flange="CF16", focalLength=220)
variants["nested"] = nested
tilted = copy.deepcopy(base)
tilted["ports"][1].update(alpha=185, beta=75)
variants["tilted"] = tilted
invalid = copy.deepcopy(base)
invalid["ports"][0]["flange"] = "CF40"
invalid["ports"][0]["dimensions"] = {"knifeHalfWidth": 50}
variants["invalid"] = invalid
results = {}
for name, config in variants.items():
    result = evaluate_document(config, CATALOG, include_mesh=False)
    results[name] = {"config": config, "result": result,
                     "script": None if result["errors"] else generate_script(config, CATALOG)}
print(json.dumps(results, allow_nan=False))
`], {cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024});
  assert.equal(native.status, 0, native.stderr);
  const fixtures = JSON.parse(native.stdout);
  const [pyodide, wasm] = await Promise.all([
    // The npm package has the CommonJS package boundary its Node loader needs;
    // serve the identical bundled files from dist when running in a browser.
    loadPyodide({indexURL: join(root, 'node_modules', 'pyodide'),
      packageCacheDir: join(root, 'dist', 'vendor', 'pyodide')}),
    ManifoldModule(),
  ]);
  wasm.setup();
  const bridge = createManifoldBridge(wasm);
  pyodide.registerJsModule('_manifold_bridge', bridge);
  await pyodide.loadPackage('numpy');
  for (const name of ['manifold3d.py', 'chamber.py', 'fusion_export.py', 'service.py']) {
    pyodide.FS.writeFile(`/home/pyodide/${name}`, await readFile(join(root, 'dist', 'python', name), 'utf8'));
  }
  pyodide.FS.mkdirTree('/home/pyodide/examples/Chamber');
  pyodide.FS.writeFile('/home/pyodide/examples/Chamber/chamber-config.json',
    await readFile(join(root, 'dist', 'examples', 'Chamber', 'chamber-config.json'), 'utf8'));
  assert.deepEqual(JSON.parse(pyodide.runPython('import json\nfrom service import default_config\njson.dumps(default_config())')),
    fixtures.default.config, 'Both runtimes load the checked-in startup configuration');
  pyodide.globals.set('_catalog_json', await readFile(join(root, 'data', 'catalog.json'), 'utf8'));
  pyodide.runPython('import json\nfrom service import evaluate_document\nfrom fusion_export import generate_script\n_catalog = json.loads(_catalog_json)');
  for (const [name, fixture] of Object.entries(fixtures)) {
    pyodide.globals.set('_config_json', JSON.stringify(fixture.config));
    try {
      const actual = JSON.parse(pyodide.runPython('json.dumps(evaluate_document(json.loads(_config_json), _catalog), allow_nan=False)'));
      const expected = fixture.result;
      assert.deepEqual(actual.errors, expected.errors, `${name}: errors`);
      assert.deepEqual(actual.warnings, expected.warnings, `${name}: warnings`);
      assert.deepEqual(actual.coincidences, expected.coincidences, `${name}: coincidences`);
      assert.equal(actual.collisions.length, expected.collisions.length, `${name}: collisions`);
      for (let i = 0; i < actual.collisions.length; i++) {
        assert.deepEqual(actual.collisions[i].ports, expected.collisions[i].ports);
        assert.deepEqual(actual.collisions[i].parts, expected.collisions[i].parts);
        assert.ok(Math.abs(actual.collisions[i].volume - expected.collisions[i].volume) < 0.001, `${name}: intersection volume`);
      }
      if (expected.metrics.materialVolume) {
        const difference = Math.abs(actual.metrics.materialVolume - expected.metrics.materialVolume);
        assert.ok(difference < expected.metrics.materialVolume * 1e-9, `${name}: material volume differs by ${difference}`);
      }
      assert.ok(actual.meshes.length > 0, `${name}: preview geometry`);
      for (const mesh of actual.meshes) {
        assert.ok(mesh.positions.length > 0 && mesh.indices.length > 0);
        assert.ok(mesh.positions.every(Number.isFinite));
        assert.ok(mesh.indices.every(index => index >= 0 && index < mesh.positions.length / 3));
        assert.equal(mesh.coincident, expected.coincidences.some(pair => pair.ports.includes(mesh.portId)));
      }
      if (fixture.script) {
        assert.equal(pyodide.runPython('generate_script(json.loads(_config_json), _catalog)'), fixture.script, `${name}: Fusion export`);
      }
    } finally {
      bridge.releaseAll();
    }
    assert.equal(bridge.liveObjects, 0, `${name}: WASM objects were released`);
  }
  // Request failure also goes through cleanup, so a malformed shape cannot leak
  // a partially constructed set of WASM solids into the next evaluation.
  assert.throws(() => {
    try {
      pyodide.runPython('from manifold3d import Manifold\n_shape = Manifold.cylinder(5, 2)\nraise ValueError("failure after allocating geometry")');
    } finally {
      bridge.releaseAll();
    }
  }, /failure after allocating geometry/);
  assert.equal(bridge.liveObjects, 0);
});
