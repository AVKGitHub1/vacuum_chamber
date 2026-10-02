"""Shared application operations for the native server and browser worker."""
from __future__ import annotations

import copy
import math

from chamber import evaluate
from fusion_export import prepare_export


def end_profile(body_od, family, catalog):
    for item in catalog.get("endProfiles", []):
        if item.get("family") == family and abs(item.get("bodyOD", 0) - body_od) < 0.1:
            return copy.deepcopy(item)
    return dict(od=body_od+80, bore=body_od-6.35, thickness=24, boltCircle=body_od+50,
                holeDiameter=14, holeCount=24, sealInner=body_od-3,
                sealOuter=body_od+9, sealDepth=2.5, verified=False,
                notes="Custom end profile: confirm all dimensions against a drawing.")


def default_config(catalog):
    od = 323.85
    spec = end_profile(od, "ISO-F", catalog)
    return dict(schemaVersion=1, units="in", body=dict(
        od=od, height=508, wall=catalog.get("defaultAssumptions", {}).get("bodyWall", 3.175), top="ISO-F", bottom="ISO-F",
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
            for x in value.values():
                finite(x)
        if isinstance(value, list):
            for x in value:
                finite(x)
    finite(config)


def evaluate_document(config, catalog, include_mesh=True):
    """Apply identical document, preview, and export validation on both runtimes."""
    validate_document(config)
    try:
        prepared = prepare_export(config, catalog)
    except (ValueError, TypeError, KeyError) as exc:
        result = evaluate(config, catalog, include_mesh=include_mesh)
        if not result["errors"]:
            result["errors"].append({"path": "export", "message": str(exc)})
        return result
    result = evaluate(prepared, catalog, include_mesh=include_mesh)
    result["warnings"] = list(dict.fromkeys(result["warnings"] + prepared.get("exportWarnings", [])))
    return result
