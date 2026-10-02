# Chamber Studio

A local browser configurator for cylindrical vacuum chambers, based on the supplied Lesker screenshots and narrowed to **CF and ISO-F** ends and ports.

## Start

On Windows, double-click **Start Chamber Builder.cmd**, then open **http://127.0.0.1:8766**. Leave the server window running. Python 3.10 or newer is required; the launcher installs the Python dependencies into `.venv` if needed. This workspace already has them installed.

Manual launch:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe server.py
```

The application binds to `127.0.0.1`. Three.js and OrbitControls are included locally; after dependency installation, normal use requires no internet connection or Node.js. The interface autosaves in browser storage. Use **Save / Open** for portable JSON configuration files.

## Configuration

- Body OD choices: 12.75, 16, 20, 24, 30, 36 inches. Overall height is limited to 36 inches, as shown in the reference.
- CF and ISO-F top/bottom flange rings; chamber ends stay open, with no covers or hardware.
- CF and ISO-F port sizes, the four CF flange styles, focal elevation, focal length, alpha, beta, port notes and configuration notes.
- Inch/mm display switch; saved geometry always uses millimeters.
- Editable body wall and advanced flange dimensions. Catalog-backed values and provisional detail profiles are identified in the interface and [source notes](docs/catalog-sources.md).

Z is vertical. Alpha rotates counterclockwise from +X; beta is measured from +Z (45–135°, 90° radial). Focal elevation is measured from the bottom outside flange face. Focal length terminates at the port’s outside sealing face. The [coordinate guide](http://127.0.0.1:8766) is available beside the port controls.

The screenshots establish fields and some limits, but do not reveal all of Lesker’s hidden validation or dimensional rules. The implementation reproduces the supplied conventions and adds explicit geometric validity checks; it is not a verified replica of all server-side Lesker logic.

## Collisions and preview

Drag to orbit, scroll to zoom, or use Top / Front / 3D and X-ray. Port labels correspond to the form. Colliding tubes/flanges turn red and the warning names each port pair. **Locate** highlights their controls and centers the view. Export is allowed with collisions; invalid geometry inputs must be corrected.

Interference uses Boolean intersections of the actual hollow port tube and flange meshes, including bores and bolt holes. Intended connections to the shell and between parts of the same port are excluded. The check does not include chamber-end interference as a port-to-port collision, bolt/tool clearance, weld access, or attached equipment. A port that crosses the end-ring region is flagged as invalid placement.

Mesh curves use 128 segments and bolt holes 32 segments. Tangent contact with zero intersection volume is excluded. Tiny gaps or overlaps near tessellation resolution may differ from exact CAD geometry; the API exposes `portSurfaceChordError` and `collisionToleranceVolume` in its metrics.

## Fusion export

Click **Export Fusion Python** to download `Chamber.py`. Create a Python script named `Chamber` through Fusion’s Scripts and Add-Ins dialog, replace its generated `Chamber.py` with the downloaded file, and run it in the destination parametric design. Full instructions: [Running the Fusion export](docs/fusion.md), also available as **Run in Fusion** inside the app.

The script creates a new component with named parameters driving actual sketches, planes, extrusions, sealing features and bolt patterns. It preserves existing design history. Each run uses a fresh parameter prefix and adds a new chamber; it does not update an earlier one. Changes made inside Fusion are not synchronized back to the browser.

**Detail limitations:** sealing sections, knife microprofiles, rotatable shoulders and some tube walls remain provisional. Weld sockets/counterbores with unconfirmed depth datums, chamfers and weld beads are omitted. These are tracked in the catalog and exported notes. The result therefore does not yet include every manufacturing detail.

**Runtime verification:** automated tests cover geometry, collision cases, UI form behavior, HTTP export and generated Python syntax. The script has not been executed in Autodesk Fusion here, and the WebGL preview has not been visually verified in an interactive browser in this environment.

## Development checks

```powershell
.\.venv\Scripts\python.exe -m pytest -q
npm install
npm test
```

Python tests cover collision/noncollision cases, angled ports, hollow geometry, invalid input, catalog/export coverage and the HTTP contract. Node tests use jsdom with the real Python backend to exercise form edits, unit switching, persistence recovery, collision warnings and downloading; WebGL is intentionally unavailable in that test environment. Node dependencies are development-only.

Dependencies: NumPy, Manifold3D and Three.js 0.180.0. Three.js’s MIT license is included at `static/vendor/THREE-LICENSE.txt`.
