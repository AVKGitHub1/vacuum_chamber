import copy
import json
import threading
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler

import pytest
import server

urlopen = build_opener(ProxyHandler({})).open  # Loopback must not use a system HTTP proxy.


@pytest.fixture(scope="module")
def endpoint():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield "http://127.0.0.1:" + str(httpd.server_port)
    httpd.shutdown()
    thread.join()
    httpd.server_close()


def post(endpoint, path, config):
    req = Request(endpoint + path, json.dumps(config).encode(), headers={"Content-Type": "application/json"})
    try:
        response = urlopen(req)
    except HTTPError as exc:
        response = exc
    return response.status, response.read(), response.headers


def test_default_api_and_download_have_consistent_valid_geometry(endpoint):
    config = json.load(urlopen(endpoint + "/api/default"))
    expected = json.loads((server.ROOT / "examples/Chamber/chamber-config.json").read_text(encoding="utf-8"))
    assert config == expected
    status, payload, _ = post(endpoint, "/api/evaluate", config)
    result = json.loads(payload)
    assert status == 200
    assert result["errors"] == []
    assert result["collisions"] == []
    assert result["coincidences"] == []
    assert len(result["meshes"]) == 3 + 2 * len(config["ports"])
    status, script, headers = post(endpoint, "/api/export", config)
    assert status == 200
    compile(script.decode(), "Chamber.py", "exec")
    assert "Chamber.py" in headers["Content-Disposition"]


def test_collision_is_red_and_export_is_still_allowed(endpoint):
    config = server.default_config()
    config["ports"][1] = copy.deepcopy(config["ports"][0])
    config["ports"][1]["id"] = "B"
    status, payload, _ = post(endpoint, "/api/evaluate", config)
    result = json.loads(payload)
    assert status == 200 and not result["errors"]
    assert result["collisions"]
    assert sum(m["collision"] for m in result["meshes"]) == 4
    assert post(endpoint, "/api/export", config)[0] == 200


def test_nested_coincident_ports_warn_without_material_overlap_and_can_export(endpoint):
    config = server.default_config()
    config["ports"][0].update(flange="CF40", elevation=254, alpha=0, beta=90, focalLength=240)
    config["ports"][0].pop("dimensions", None)
    nested = copy.deepcopy(config["ports"][0])
    nested.update(id="B", flange="CF16", focalLength=220)
    unrelated = copy.deepcopy(config["ports"][0])
    unrelated.update(id="C", alpha=180)
    config["ports"] = [config["ports"][0], nested, unrelated]

    status, payload, _ = post(endpoint, "/api/evaluate", config)
    result = json.loads(payload)
    assert status == 200 and result["errors"] == []
    assert result["collisions"] == []
    assert result["coincidences"] == [{"ports": ["A", "B"]}]
    assert result["metrics"]["collisionCount"] == 0
    assert result["metrics"]["coincidenceCount"] == 1
    assert any("Ports A and B" in warning and "coincident" in warning
               and "Export remains available" in warning for warning in result["warnings"])
    assert all(not mesh["collision"] for mesh in result["meshes"])
    assert all(mesh["coincident"] == (mesh["portId"] in ("A", "B")) for mesh in result["meshes"])
    assert sum(mesh["coincident"] for mesh in result["meshes"]) == 4

    status, script, _ = post(endpoint, "/api/export", config)
    assert status == 200
    compile(script.decode(), "Chamber.py", "exec")

    config["ports"][1]["alpha"] = 90
    _, payload, _ = post(endpoint, "/api/evaluate", config)
    separated = json.loads(payload)
    assert separated["errors"] == []
    assert separated["coincidences"] == []
    assert all(not mesh["coincident"] for mesh in separated["meshes"])
    assert not any("coincident" in warning for warning in separated["warnings"])


def test_invalid_dimensions_disable_preview_success_and_export(endpoint):
    config = server.default_config()
    config["ports"][0]["flange"] = "CF40"
    config["ports"][0]["dimensions"] = {"knifeHalfWidth": 50}
    _, payload, _ = post(endpoint, "/api/evaluate", config)
    assert json.loads(payload)["errors"]
    assert post(endpoint, "/api/export", config)[0] == 422


def test_canonical_mm_identical_under_display_units(endpoint):
    config = server.default_config()
    _, payload, _ = post(endpoint, "/api/evaluate", config)
    first = json.loads(payload)
    config["units"] = "mm"
    _, payload, _ = post(endpoint, "/api/evaluate", config)
    second = json.loads(payload)
    assert first["meshes"] == second["meshes"]
    assert first["collisions"] == second["collisions"]


def test_invalid_schema_is_rejected(endpoint):
    assert post(endpoint, "/api/evaluate", {"schemaVersion": 4})[0] == 400


def test_static_javascript_is_served_with_executable_mime(endpoint):
    response = urlopen(endpoint + "/app.js")
    assert response.headers.get_content_type() in ("text/javascript", "application/javascript")
    assert response.read().startswith(b"import")
