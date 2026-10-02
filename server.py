"""Loopback-only chamber builder. Run with Python 3.10+ after installing requirements."""
from __future__ import annotations

import argparse
import copy
import json
import math
import threading
from functools import lru_cache
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from chamber import evaluate
from fusion_export import generate_script, prepare_export

ROOT = Path(__file__).resolve().parent
CATALOG = json.loads((ROOT / "data/catalog.json").read_text(encoding="utf-8"))
COMPUTE_LOCK = threading.Lock()


def end_profile(body_od, family):
    for item in CATALOG.get("endProfiles", []):
        if item.get("family") == family and abs(item.get("bodyOD", 0) - body_od) < 0.1:
            return copy.deepcopy(item)
    # An explicit editable starting profile, never represented as a catalog part.
    return dict(od=body_od+80, bore=body_od-6.35, thickness=24, boltCircle=body_od+50,
                holeDiameter=14, holeCount=24, sealInner=body_od-3,
                sealOuter=body_od+9, sealDepth=2.5, verified=False,
                notes="Custom end profile: confirm all dimensions against a drawing.")


def default_config():
    od = 323.85
    spec = end_profile(od, "ISO-F")
    return dict(schemaVersion=1, units="in", body=dict(
        od=od, height=508, wall=CATALOG.get("defaultAssumptions", {}).get("bodyWall", 3.175), top="ISO-F", bottom="ISO-F",
        topRing="Flat, with holes", bottomRing="Flat, with holes", mountingBoss="None",
        topSpec=copy.deepcopy(spec), bottomSpec=copy.deepcopy(spec)),
        ports=[dict(id="A", flange="CF40", style="fixed-through", elevation=254,
                    focalLength=240, alpha=0, beta=90, notes="", dimensions={}),
               dict(id="B", flange="CF40", style="fixed-through", elevation=254,
                    focalLength=240, alpha=120, beta=90, notes="", dimensions={})], notes="")


def validate_document(config):
    if not isinstance(config, dict) or config.get("schemaVersion") != 1:
        raise ValueError("Expected a chamber configuration with schemaVersion 1.")
    if not isinstance(config.get("body"), dict) or not isinstance(config.get("ports"), list):
        raise ValueError("The configuration must contain a body and a ports list.")
    if len(config["ports"]) > 32:
        raise ValueError("A configuration can contain up to 32 ports.")
    if any(not isinstance(p, dict) for p in config["ports"]):
        raise ValueError("Every port must be an object.")
    def finite(value):
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError("All numeric values must be finite.")
        if isinstance(value, dict):
            for x in value.values(): finite(x)
        if isinstance(value, list):
            for x in value: finite(x)
    finite(config)


@lru_cache(maxsize=5)
def evaluated(serialized):
    with COMPUTE_LOCK:
        config = json.loads(serialized)
        # Share resolved detail dimensions between browser mesh and Fusion output.
        try:
            prepared = prepare_export(config, CATALOG)
        except (ValueError, TypeError, KeyError) as exc:
            result = evaluate(config, CATALOG, include_mesh=True)
            if not result["errors"]:
                result["errors"].append({"path": "export", "message": str(exc)})
            return result
        result = evaluate(prepared, CATALOG, include_mesh=True)
        result["warnings"] = list(dict.fromkeys(result["warnings"] + prepared.get("exportWarnings", [])))
        return result


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "static"), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def respond(self, data, status=200, content_type="application/json; charset=utf-8", filename=None):
        body = json.dumps(data, allow_nan=False, separators=(",", ":")).encode() if isinstance(data, (dict, list)) else data
        if isinstance(body, str): body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if filename: self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        try: self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError): pass

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/catalog": return self.respond(CATALOG)
        if path == "/api/default": return self.respond(default_config())
        if path == "/api/health": return self.respond({"status": "ok", "app": "chamber-studio"})
        if path.startswith("/api/"): return self.respond({"error": "Not found"}, 404)
        return super().do_GET()

    def do_POST(self):
        origin = self.headers.get("Origin")
        if origin and urlsplit(origin).netloc != self.headers.get("Host"):
            return self.respond({"error": "Use the builder from its local address."}, 403)
        path = urlsplit(self.path).path
        if path not in ("/api/evaluate", "/api/export"):
            return self.respond({"error": "Not found"}, 404)
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 1_000_000: raise ValueError("Invalid configuration size.")
            config = json.loads(self.rfile.read(size))
            validate_document(config)
            result = evaluated(json.dumps(config, sort_keys=True, allow_nan=False))
            if path == "/api/evaluate": return self.respond(result)
            if result.get("errors"):
                return self.respond({"error": "Resolve invalid dimensions before export.", "errors": result["errors"]}, 422)
            script = generate_script(config, CATALOG)
            return self.respond(script, content_type="text/x-python; charset=utf-8", filename="Chamber.py")
        except (ValueError, TypeError, KeyError) as exc:
            return self.respond({"error": str(exc)}, 400)
        except Exception as exc:
            import traceback
            traceback.print_exc()
            return self.respond({"error": "Geometry generation failed: " + str(exc)}, 500)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--open", action="store_true", help="Open the interface after starting")
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Chamber builder: http://127.0.0.1:{server.server_port}", flush=True)
    if args.open:
        import webbrowser
        threading.Timer(0.4, lambda: webbrowser.open(f"http://127.0.0.1:{server.server_port}")).start()
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()


if __name__ == "__main__": main()
