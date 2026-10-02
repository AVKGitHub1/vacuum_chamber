# Chamber Studio

A browser configurator for cylindrical vacuum chambers, based on the supplied Lesker screenshots and narrowed to **CF and ISO-F** ends and ports. Run it entirely in your browser on GitHub Pages, or use the local Python server.

## Deploy to GitHub Pages

1. Commit these files and push to the repository's `main` branch, including `.github/workflows/pages.yml` and `package-lock.json`.
2. In the repository, open **Settings → Pages → Build and deployment → Source** and select **GitHub Actions**.
3. Open **Actions → Test and deploy GitHub Pages** and run the workflow on `main` if the initial push ran before Pages was enabled. Later pushes to `main` deploy automatically after the tests pass.
4. Open the URL shown by the deployment. For this repository, the expected address is **https://AVKGitHub1.github.io/vacuum_chamber/**.

The workflow tests the native application, builds `dist/`, tests the static site in Chromium under a repository subpath, then publishes only `dist/`. Pull requests run the same checks without deploying. No server account, API URL, or deployment secret is required. See [GitHub's publishing-source instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) for the repository setting.

The Pages version runs the same Python validation, chamber geometry, and Fusion export code in a Web Worker using Pyodide. An adapter connects it to the official Manifold WebAssembly library. Collision and coincidence warnings, 3D preview, editable dimensions, Save/Open, and Fusion downloads work without a Python server. Configurations remain in your browser; the site sends no geometry requests to a backend.

All runtime assets are bundled with the site, including NumPy and both WebAssembly engines. The first load downloads approximately 18 MB of uncompressed files and shows loading progress. The build fetches NumPy from the pinned Pyodide release and verifies its SHA-256 against Pyodide's lockfile. The deployed site does not need a third-party CDN. A browser with WebAssembly, module workers, and WebGL support is required for the full preview.

### Build and preview the static site

Install Node.js 22.12 or newer in the 22.x series, or Node.js 24 or newer, then run:

```sh
npm ci
npm run build
npm run preview
```

Open **http://127.0.0.1:4173/vacuum_chamber/**. This preview serves static files only, matching the GitHub Pages deployment. Build dependencies require network access on first installation/build. Python is not required to build, preview, or use the Pages site. Do not open `dist/index.html` using a `file://` URL; browser workers need an HTTP(S) origin.

## Start

On Windows, double-click **Start Chamber Builder.cmd**, then open **http://127.0.0.1:8766**. Leave the server window running. Python 3.10 or newer is required; the launcher installs the Python dependencies into `.venv` if needed.

Manual launch:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe server.py
```

The local Python application binds to `127.0.0.1`. Three.js and OrbitControls are included locally; after dependency installation, this mode requires no internet connection or Node.js.

Both modes automatically load [examples/Chamber/chamber-config.json](examples/Chamber/chamber-config.json) on every startup or page reload, taking precedence over the previous browser snapshot. **Reload startup** restores that same configuration. Use **Save** before leaving or reloading to keep edits as a JSON file, and **Open** to restore it. To change the startup chamber, edit that file; for GitHub Pages, commit and push it so the next build bundles the updated configuration.

## Configuration

- Body OD choices: 12.75, 16, 20, 24, 30, 36 inches. Overall height is limited to 36 inches, as shown in the reference.
- CF and ISO-F top/bottom flange rings; chamber ends stay open, with no covers or hardware.
- CF and ISO-F port sizes, the four CF flange styles, focal elevation, focal length, alpha, beta, port notes and configuration notes.
- Inch/mm display switch; saved geometry always uses millimeters.
- Editable body wall and advanced flange dimensions. Catalog-backed values and provisional detail profiles are identified in the interface and [source notes](docs/catalog-sources.md).
- Schematic guides for every numeric field, including the body-diameter selector. Click or tap the **?** beside the field title to see the measured dimension, or focus the question-mark button and press Enter or Space. Click it again, press Escape, or click outside to dismiss the guide.

Z is vertical. Alpha rotates counterclockwise from +X; beta is measured from +Z (45–135°, 90° radial). Focal elevation is measured from the bottom outside flange face. Focal length is the distance along the port axis from its outer flange face to the chamber centerline at that focal elevation, including for tilted ports. It includes the distance inside the chamber; it is not the exposed tube length. The coordinate guide is available beside the port controls.

The screenshots establish fields and some limits, but do not reveal all of Lesker’s hidden validation or dimensional rules. The implementation reproduces the supplied conventions and adds explicit geometric validity checks; it is not a verified replica of all server-side Lesker logic.

## Collisions and preview

Drag to orbit, scroll to zoom, or use Top / Front / 3D and X-ray. Port labels correspond to the form. Colliding tubes/flanges turn red and the warning names each port pair. Ports with coincident axes also turn red and warn, including a smaller port nested inside a larger port's bore with no material overlap. **Locate** highlights their controls and centers the view. Export is allowed with collisions or coincident ports; invalid geometry inputs must be corrected.

Interference uses Boolean intersections of the actual hollow port tube and flange meshes, including bores and bolt holes. Intended connections to the shell and between parts of the same port are excluded. The check does not include chamber-end interference as a port-to-port collision, bolt/tool clearance, weld access, or attached equipment. A port that crosses the end-ring region is flagged as invalid placement.

Coincidence checks compare focal elevation and outward axis direction, independently of flange size and focal length. Alpha 0° and 360° represent the same direction; ports on opposite sides are not coincident. Change elevation, alpha, or beta to separate coincident ports. The API reports these pairs separately in `coincidences`, with a `coincident` mesh flag and `coincidenceCount` metric; `collisions` remains limited to actual material overlap.

Mesh curves use 128 segments and bolt holes 32 segments. Tangent contact with zero intersection volume is excluded. Tiny gaps or overlaps near tessellation resolution may differ from exact CAD geometry; the API exposes `portSurfaceChordError` and `collisionToleranceVolume` in its metrics.

## Fusion export

Click **Export Fusion Python** to download `Chamber.py`. Create a Python script named `Chamber` through Fusion’s Scripts and Add-Ins dialog, replace its generated `Chamber.py` with the downloaded file, and run it in the destination parametric design. Full instructions: [Running the Fusion export](docs/fusion.md), also available as **Run in Fusion** inside the app.

The script creates a new component with named parameters driving actual sketches, planes, extrusions, sealing features and bolt patterns. It preserves existing design history. Each run uses a fresh parameter prefix and adds a new chamber; it does not update an earlier one. Changes made inside Fusion are not synchronized back to the browser.

**Detail limitations:** sealing sections, knife microprofiles, rotatable shoulders and some tube walls remain provisional. Weld sockets/counterbores with unconfirmed depth datums, chamfers and weld beads are omitted. These are tracked in the catalog and exported notes. The result therefore does not yet include every manufacturing detail.

**Runtime verification:** automated tests cover geometry, collision cases, UI form behavior, HTTP export and generated Python syntax. Browser tests exercise the static build with real Web Workers, WebAssembly, WebGL, and downloaded exports. The exported script has not been executed in Autodesk Fusion here.

## Development checks

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
npm ci
npm test
npm run build
npm run test:wasm
npx playwright install chromium
npm run test:pages
```

Python tests cover collision/noncollision cases, angled ports, hollow geometry, invalid input, catalog/export coverage and the HTTP contract. Node tests cover the worker API client and use jsdom with the real Python backend to exercise form edits, unit switching, persistence recovery, warnings and downloading. `test:wasm` compares actual browser-engine geometry and exports with native Python; it needs the build and Python test dependencies. The separate Playwright suite uses only the static site under `/vacuum_chamber/`, with actual browser geometry and no Python API. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can point to an existing Chromium browser for local testing. Node dependencies are build/test tools; visitors need only a browser.

Dependencies: NumPy, Manifold3D/Manifold 3.5.4, Pyodide 0.28.3 for Pages, and Three.js 0.180.0. Three.js’s MIT license is included at `static/vendor/THREE-LICENSE.txt`; the static build includes Manifold's license and a Pyodide license notice in `dist/vendor/`.
