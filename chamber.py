"""Canonical millimetre chamber geometry, validation, and solid interference checks.

The preview and Fusion exporter use the same resolved dimensions.  Z is the
chamber axis; alpha is measured anticlockwise from +X and beta from +Z.  A port's
focal length terminates at its outward flange face, not its weld or tube end.
"""

from __future__ import annotations

from copy import deepcopy
import math
from typing import Any

import manifold3d as mf
import numpy as np


SEGMENTS = 128
HOLE_SEGMENTS = 32
VOLUME_EPSILON = 1e-5  # mm³; touching faces have no interference volume.
CF_STYLES = {"fixed-through", "fixed-tapped", "rotatable-through", "rotatable-tapped"}
END_TYPES = {"CF FXD", "ISO-F"}


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _catalog_map(catalog: Any) -> dict:
    rows = catalog.get("flanges", []) if isinstance(catalog, dict) else catalog
    return {row["id"]: row for row in rows if isinstance(row, dict) and "id" in row}


def resolve_config(config: dict, catalog: Any) -> dict:
    """Resolve flange overrides without changing units or the caller's object."""
    result = deepcopy(config)
    flanges = _catalog_map(catalog)
    for port in result.get("ports", []):
        if not isinstance(port, dict):
            continue
        defaults = deepcopy(flanges.get(port.get("flange"), {}))
        overrides = port.get("dimensions", {})
        if isinstance(overrides, dict):
            defaults.update(overrides)
        port["dimensions"] = defaults
    return result


def port_direction(port: dict) -> np.ndarray:
    alpha, beta = math.radians(port["alpha"]), math.radians(port["beta"])
    return np.array([math.sin(beta) * math.cos(alpha), math.sin(beta) * math.sin(alpha), math.cos(beta)])


def validate_config(config: dict, catalog: Any) -> dict:
    """Validate inputs before any geometry work; all distance values are in mm."""
    errors, warnings = [], []

    def error(path, message):
        errors.append({"path": path, "message": message})

    if not isinstance(config, dict):
        return {"errors": [{"path": "config", "message": "Configuration must be an object."}], "warnings": [], "config": {}}
    body = config.get("body")
    if not isinstance(body, dict):
        return {"errors": [{"path": "body", "message": "Chamber body is required."}], "warnings": [], "config": deepcopy(config)}
    if config.get("units", "mm") not in ("mm", "in"):
        error("units", "Display units must be mm or in; stored dimensions are always mm.")
    assumptions = catalog.get("defaultAssumptions", {}) if isinstance(catalog, dict) else {}
    if assumptions.get("bodyWallVerified") is False:
        warnings.append("Chamber wall thickness is an editable engineering assumption; the selected flange standard does not specify a chamber wall.")
    for name in ("od", "height", "wall"):
        value = body.get(name)
        if not _number(value) or value <= 0:
            error(f"body.{name}", f"Chamber {name} must be a finite positive dimension.")
    if _number(body.get("height")) and body["height"] > 914.4 + 1e-8:
        error("body.height", "Chamber height cannot exceed 36 inches (914.4 mm).")
    if all(_number(body.get(k)) for k in ("od", "wall")) and body["wall"] >= body["od"] / 2:
        error("body.wall", "Wall thickness must be smaller than the chamber radius.")

    def dimensions(dims, path, end=False, family=None, style="fixed-through"):
        style = style if isinstance(style, str) else ""
        if not isinstance(dims, dict):
            error(path, "Flange dimensions are required.")
            return
        required = ("od", "thickness") if end else ("od", "bore", "tubeOD", "tubeWall", "thickness")
        for key in required:
            if not _number(dims.get(key)) or dims[key] <= 0:
                error(f"{path}.{key}", f"{key} must be a finite positive dimension.")
        for key in ("bore", "boltCircle", "holeDiameter", "holeCount", "sealInner", "sealOuter", "sealDepth", "knifeEdgeDiameter", "knifeHalfWidth", "knifeTipSetback", "knifeTipWidth", "threadDiameter", "threadPitch", "hubOD", "shoulderOD", "shoulderDepth"):
            value = dims.get(key)
            if value is not None and (not _number(value) or value < 0):
                error(f"{path}.{key}", f"{key} must be a finite nonnegative value.")
        holes = dims.get("holeCount", 0)
        if _number(holes) and (int(holes) != holes or holes > 128):
            error(f"{path}.holeCount", "Hole count must be a whole number from 0 through 128.")
        if _number(holes) and holes > 0:
            for key in ("boltCircle", "holeDiameter"):
                if not _number(dims.get(key)) or dims[key] <= 0:
                    error(f"{path}.{key}", f"{key} is required for a bolt pattern.")
            if all(_number(dims.get(k)) for k in ("boltCircle", "holeDiameter", "od")) and dims["boltCircle"] + dims["holeDiameter"] >= dims["od"]:
                error(f"{path}.boltCircle", "Bolt holes must fit inside the flange outside diameter.")
            hole_diameter = dims.get("threadDiameter") if "tapped" in style else dims.get("holeDiameter")
            if all(_number(value) for value in (dims.get("boltCircle"), hole_diameter)):
                inner_edge = dims["boltCircle"] - hole_diameter
                if _number(dims.get("bore")) and inner_edge <= dims["bore"]:
                    error(f"{path}.boltCircle", "Bolt holes intersect the flange bore; increase their bolt circle or reduce their diameter.")
                if _number(dims.get("sealOuter")) and inner_edge <= dims["sealOuter"]:
                    error(f"{path}.sealOuter", "The sealing recess must stay inside the bolt-hole inner edges.")
                if _number(dims.get("od")) and dims["boltCircle"] + hole_diameter >= dims["od"]:
                    error(f"{path}.holeDiameter", "The selected hole or thread diameter extends beyond the flange outside edge.")
        if all(_number(dims.get(k)) for k in ("bore", "od")) and dims["bore"] >= dims["od"]:
            error(f"{path}.bore", "Flange bore must be smaller than its outside diameter.")
        if not end and all(_number(dims.get(k)) for k in ("tubeOD", "tubeWall")) and dims["tubeWall"] * 2 >= dims["tubeOD"]:
            error(f"{path}.tubeWall", "Tube wall must be smaller than the tube radius.")
        if not end and all(_number(dims.get(k)) for k in ("tubeOD", "od")) and dims["tubeOD"] >= dims["od"]:
            error(f"{path}.tubeOD", "Port tube outside diameter must be smaller than flange outside diameter.")
        if not end and all(_number(dims.get(k)) for k in ("tubeOD", "bore")) and dims["bore"] >= dims["tubeOD"]:
            error(f"{path}.bore", "Flange bore must be smaller than tube outside diameter so the tube and flange meet over an annular face.")
        if end and dims.get("bore") is not None and _number(dims["bore"]) and dims["bore"] <= 0:
            error(f"{path}.bore", "An open end flange must have a positive bore.")
        if all(_number(dims.get(k)) for k in ("sealDepth", "thickness")) and dims["sealDepth"] >= dims["thickness"]:
            error(f"{path}.sealDepth", "Seal recess depth must be less than flange thickness.")
        if all(_number(dims.get(k)) for k in ("sealInner", "sealOuter")) and dims["sealOuter"] > 0 and dims["sealInner"] >= dims["sealOuter"]:
            error(f"{path}.sealOuter", "Seal outer diameter must exceed its inner diameter.")
        if all(_number(dims.get(k)) for k in ("sealOuter", "od")) and dims["sealOuter"] >= dims["od"]:
            error(f"{path}.sealOuter", "Seal recess must fit inside the flange outside diameter.")
        if all(_number(dims.get(k)) for k in ("sealInner", "bore")) and dims["sealInner"] < dims["bore"]:
            error(f"{path}.sealInner", "Seal inner diameter cannot be smaller than the flange bore.")
        if family in ("CF", "CF FXD"):
            for key in ("knifeEdgeDiameter", "knifeHalfWidth", "knifeTipWidth"):
                if dims.get(key) is not None and _number(dims[key]) and dims[key] <= 0:
                    error(f"{path}.{key}", f"{key} must be positive for a CF knife profile.")
            if all(_number(dims.get(k)) for k in ("knifeTipSetback", "sealDepth")) and dims["knifeTipSetback"] >= dims["sealDepth"]:
                error(f"{path}.knifeTipSetback", "CF knife tip setback must be less than the seal recess depth.")
            if all(_number(dims.get(k)) for k in ("knifeHalfWidth", "knifeEdgeDiameter")):
                root_inner = dims["knifeEdgeDiameter"] - 2 * dims["knifeHalfWidth"]
                root_outer = dims["knifeEdgeDiameter"] + 2 * dims["knifeHalfWidth"]
                if _number(dims.get("sealInner")) and root_inner <= dims["sealInner"]:
                    error(f"{path}.knifeHalfWidth", "CF knife root must lie entirely outside the seal inner diameter.")
                if _number(dims.get("sealOuter")) and root_outer >= dims["sealOuter"]:
                    error(f"{path}.knifeHalfWidth", "CF knife root must lie entirely inside the seal outer diameter.")
                tip_width = dims.get("knifeTipWidth", 0.04)
                if _number(tip_width) and tip_width >= 2 * dims["knifeHalfWidth"]:
                    error(f"{path}.knifeTipWidth", "CF knife tip width must be smaller than its root width.")
        if "rotatable" in style and all(_number(dims.get(k)) for k in ("sealOuter", "hubOD", "shoulderOD", "boltCircle", "holeDiameter")):
            if not dims["sealOuter"] < dims["hubOD"] < dims["shoulderOD"] < dims["boltCircle"] - dims["holeDiameter"]:
                error(f"{path}.hubOD", "Rotatable insert and shoulder must fit between the sealing recess and bolt holes.")
        if "rotatable" in style and all(_number(dims.get(k)) for k in ("shoulderDepth", "thickness")):
            if not 0 < dims["shoulderDepth"] < dims["thickness"]:
                error(f"{path}.shoulderDepth", "Rotatable shoulder depth must be positive and smaller than flange thickness.")

    for side in ("top", "bottom"):
        if body.get(side) not in END_TYPES:
            error(f"body.{side}", "Select a CF FXD or ISO-F chamber end.")
        spec = body.get(side + "Spec")
        dimensions(spec, f"body.{side}Spec", end=True, family=body.get(side))
        if isinstance(spec, dict) and all(_number(v) for v in (spec.get("od"), body.get("od"))) and spec["od"] <= body["od"]:
            error(f"body.{side}Spec.od", "End flange outside diameter must exceed the chamber body diameter.")
        if isinstance(spec, dict) and all(_number(v) for v in (spec.get("bore"), body.get("od"))) and spec["bore"] >= body["od"]:
            error(f"body.{side}Spec.bore", "End flange bore must be smaller than chamber body OD so its annular weld face meets the wall.")
        if isinstance(spec, dict) and spec.get("verified") is False:
            warnings.append(f"{side.title()} end dimensions include editable provisional values; check the displayed source before fabrication.")
    if all(isinstance(body.get(s + "Spec"), dict) and _number(body[s + "Spec"].get("thickness")) for s in ("top", "bottom")) and _number(body.get("height")):
        if body["topSpec"]["thickness"] + body["bottomSpec"]["thickness"] >= body["height"]:
            error("body.height", "Chamber height must exceed the combined end-flange thicknesses.")

    ports = config.get("ports", [])
    if not isinstance(ports, list):
        error("ports", "Ports must be an array.")
        return {"errors": errors, "warnings": warnings, "config": deepcopy(config)}
    if len(ports) > 32:
        error("ports", "At most 32 ports can be evaluated together.")
    resolved = resolve_config(config, catalog)
    flanges, seen = _catalog_map(catalog), set()
    for index, port in enumerate(resolved.get("ports", [])):
        path = f"ports.{index}"
        if not isinstance(port, dict):
            error(path, "Each port must be an object.")
            continue
        port_id = port.get("id")
        if not isinstance(port_id, str) or not port_id.strip() or port_id in seen:
            error(path + ".id", "Each port needs a unique, nonempty identifier.")
        else:
            seen.add(port_id)
        if port.get("flange") not in flanges:
            error(path + ".flange", "Select a flange from the catalog.")
            continue
        dims = port["dimensions"]
        family = dims.get("family")
        if family not in ("CF", "ISO-F"):
            error(path + ".flange", "Only CF and ISO-F ports are supported.")
        if family == "CF" and port.get("style") not in CF_STYLES:
            error(path + ".style", "Select a fixed or rotatable CF flange with through or tapped holes.")
        dimensions(dims, path + ".dimensions", family=family, style=port.get("style", "fixed-through"))
        for key in ("elevation", "focalLength", "alpha", "beta"):
            if not _number(port.get(key)):
                error(path + "." + key, f"{key} is required and must be finite.")
        if _number(port.get("alpha")) and not 0 <= port["alpha"] <= 360:
            error(path + ".alpha", "Alpha must be from 0 to 360 degrees.")
        if _number(port.get("beta")) and not 45 <= port["beta"] <= 135:
            error(path + ".beta", "Beta must be from 45 to 135 degrees (90 is radial).")
        if _number(port.get("elevation")) and _number(body.get("height")) and not 0 <= port["elevation"] <= body["height"]:
            error(path + ".elevation", "Focal point elevation must be within the chamber's overall height.")
        if _number(port.get("focalLength")) and port["focalLength"] <= 0:
            error(path + ".focalLength", "Focal length must be positive.")
        if any(e["path"].startswith(path + ".") for e in errors):
            continue
        if _number(body.get("od")) and 45 <= port["beta"] <= 135:
            beta = math.radians(port["beta"])
            # The rear flange must clear the outer chamber. This is a conservative
            # analytic envelope; it also guarantees a positive exposed tube length.
            rear_clearance = ((port["focalLength"] - dims["thickness"]) * math.sin(beta)
                              - dims["od"] * 0.5 * abs(math.cos(beta)) - body["od"] * 0.5)
            if rear_clearance < 0:
                error(path + ".focalLength", "Focal length is too short: the flange rear face intersects the chamber body.")
        if dims.get("verified") is False or dims.get("sealVerified") is False:
            warnings.append(f"Port {port_id}: some flange/seal dimensions are provisional; inspect the source and editable dimensions.")
        if family == "CF" and "tapped" in port.get("style", ""):
            warnings.append(f"Port {port_id}: preview holes show thread nominal envelopes; editable Fusion threads are created on export.")
        if family == "CF" and "rotatable" in port.get("style", ""):
            warnings.append(f"Port {port_id}: the rotatable insert shoulder uses editable provisional dimensions; preview interference uses its combined solid envelope.")

    return {"errors": errors, "warnings": list(dict.fromkeys(warnings)), "config": resolved}


def _cylinder(radius: float, height: float, z: float = 0, segments: int = SEGMENTS) -> mf.Manifold:
    return mf.Manifold.cylinder(height, radius, circular_segments=segments).translate([0, 0, z])


def _annulus(outer: float, inner: float, height: float, z: float = 0) -> mf.Manifold:
    result = _cylinder(outer, height, z)
    return result - _cylinder(inner, height + 2, z - 1) if inner > 0 else result


def _orient(shape: mf.Manifold, port: dict) -> mf.Manifold:
    return shape.rotate([0, port["beta"], 0]).rotate([0, 0, port["alpha"]]).translate([0, 0, port["elevation"]])


def flange_solid(dims: dict, family: str, style: str = "fixed-through", bore: float | None = None) -> mf.Manifold:
    """Build a local +Z facing flange with its rear face at z=0.

    Seal dimensions are diameters, knifeHalfWidth is a radial half-width. The CF
    profile is a face recess plus a triangular annular knife ridge. Unverified
    profile values remain explicit in the catalog and its source notes.
    """
    thickness = dims["thickness"]
    bore = dims.get("bore", 0) if bore is None else bore
    result = _annulus(dims["od"] / 2, bore / 2, thickness)
    recess_depth = dims.get("sealDepth") or 0
    seal_outer = dims.get("sealOuter") or 0
    seal_inner = dims.get("sealInner") or bore
    if recess_depth > 0 and seal_outer > seal_inner:
        result -= _annulus(seal_outer / 2, max(bore, seal_inner) / 2, recess_depth + 0.1, thickness - recess_depth)
        knife = dims.get("knifeEdgeDiameter")
        half_width = dims.get("knifeHalfWidth")
        setback = dims.get("knifeTipSetback") or 0
        if family == "CF" and knife and half_width and recess_depth > setback:
            radius = knife / 2
            tip_half = (dims.get("knifeTipWidth") if dims.get("knifeTipWidth") is not None else 0.04) / 2
            ridge = mf.Manifold.revolve(mf.CrossSection([[
                [radius - half_width, thickness - recess_depth],
                [radius + half_width, thickness - recess_depth],
                [radius + tip_half, thickness - setback],
                [radius - tip_half, thickness - setback],
            ]]), circular_segments=SEGMENTS)
            result += ridge
    holes = int(dims.get("holeCount") or 0)
    bolt_circle = dims.get("boltCircle") or 0
    hole_diameter = dims.get("holeDiameter") or 0
    if "tapped" in style:
        hole_diameter = dims.get("threadDiameter") or hole_diameter
    if holes and bolt_circle and hole_diameter:
        cutters = []
        for index in range(holes):
            angle = math.tau * index / holes
            cutters.append(_cylinder(hole_diameter / 2, thickness + 2, -1, HOLE_SEGMENTS).translate([
                bolt_circle / 2 * math.cos(angle), bolt_circle / 2 * math.sin(angle), 0]))
        result -= mf.Manifold.batch_boolean(cutters, mf.OpType.Add)
    return result


def _boxes_overlap(first: mf.Manifold, second: mf.Manifold) -> bool:
    a, b = first.bounding_box(), second.bounding_box()
    return all(min(a[i + 3], b[i + 3]) - max(a[i], b[i]) > 1e-7 for i in range(3))


def solid_intersection(first: mf.Manifold, second: mf.Manifold) -> tuple[float, list[float] | None]:
    """Narrow-phase Boolean of actual hollow solids; broad phase only rejects."""
    if not _boxes_overlap(first, second):
        return 0.0, None
    common = first ^ second
    volume = common.volume()
    if common.is_empty() or volume <= VOLUME_EPSILON:
        return 0.0, None
    box = common.bounding_box()
    return volume, [(box[i] + box[i + 3]) / 2 for i in range(3)]


def _mesh(shape: mf.Manifold, identity: str, name: str, kind: str, port_id=None) -> dict:
    mesh = shape.to_mesh()
    return {"id": identity, "name": name, "kind": kind, "portId": port_id,
            "positions": np.asarray(mesh.vert_properties)[:, :3].reshape(-1).round(6).tolist(),
            "indices": np.asarray(mesh.tri_verts).reshape(-1).tolist(), "collision": False}


def evaluate(config: dict, catalog: Any, include_mesh: bool = True) -> dict:
    """Return validated geometry, actual solid intersections, and preview meshes."""
    validation = validate_config(config, catalog)
    result = {"errors": validation["errors"], "warnings": validation["warnings"], "collisions": [],
              "meshes": [], "metrics": {}, "resolvedConfig": validation["config"]}
    resolved = validation["config"]
    if any(not e["path"].startswith("ports.") for e in result["errors"]):
        return result
    body = resolved["body"]
    radius, inner_radius = body["od"] / 2, body["od"] / 2 - body["wall"]
    low = body["bottomSpec"]["thickness"]
    high = body["height"] - body["topSpec"]["thickness"]
    shell = _annulus(radius, inner_radius, high - low, low)
    # Infinite-in-practice cavity cuts saddle ends consistently even for tilted
    # ports; the tube is therefore never retained across the chamber interior.
    reach = max(body["height"], body["od"], max((p.get("focalLength", 0) for p in resolved.get("ports", []) if isinstance(p, dict) and _number(p.get("focalLength"))), default=0)) * 4 + 100
    cavity = _cylinder(inner_radius, reach * 2, -reach)
    parts, ports = [], []
    for index, port in enumerate(resolved.get("ports", [])):
        if any(e["path"] == f"ports.{index}" or e["path"].startswith(f"ports.{index}.") for e in result["errors"]):
            continue
        dims = port["dimensions"]
        length = port["focalLength"]
        tube_end = length - dims["thickness"]
        tube_inner = dims["tubeOD"] / 2 - dims["tubeWall"]
        tube = _orient(_annulus(dims["tubeOD"] / 2, tube_inner, tube_end), port) - cavity
        bore_cut = _orient(_cylinder(dims["tubeOD"] / 2, length + 1), port)
        shell -= bore_cut
        flange = _orient(flange_solid(dims, dims["family"], port.get("style", "fixed-through")).translate([0, 0, tube_end]), port)
        # The saddle's entire tube/chamber contact must remain on the straight
        # wall; an angled tube outside that range needs a different end design.
        outer_sleeve = _annulus(radius, inner_radius, reach * 2, -reach)
        contact = tube ^ outer_sleeve
        if contact.is_empty():
            result["errors"].append({"path": f"ports.{index}.focalLength", "message": f"Port {port['id']} does not reach the chamber wall."})
        else:
            bounds = contact.bounding_box()
            if bounds[2] < low - 1e-5 or bounds[5] > high + 1e-5:
                result["errors"].append({"path": f"ports.{index}.elevation", "message": f"Port {port['id']} crosses an end flange; adjust elevation, beta, or chamber height."})
        port_parts = {"tube": tube, "flange": flange}
        ports.append((port, port_parts))
        for kind, solid in port_parts.items():
            parts.append((f"port-{port['id']}-{kind}", f"Port {port['id']} {kind}", kind, port["id"], solid))

    parts.insert(0, ("chamber-body", "Chamber wall", "body", None, shell))
    for side in ("top", "bottom"):
        dims = body[side + "Spec"]
        flange = flange_solid(dims, "CF" if body[side] == "CF FXD" else "ISO-F", bore=dims.get("bore", inner_radius * 2))
        if side == "top":
            flange = flange.translate([0, 0, high])
        else:
            flange = flange.rotate([180, 0, 0]).translate([0, 0, low])
        parts.append(("chamber-" + side, side.title() + " end flange", "end", None, flange))

    collision_ids = set()
    for index, (first_port, first_parts) in enumerate(ports):
        for second_port, second_parts in ports[index + 1:]:
            for first_kind, first_solid in first_parts.items():
                for second_kind, second_solid in second_parts.items():
                    volume, point = solid_intersection(first_solid, second_solid)
                    if volume:
                        result["collisions"].append({"ports": [first_port["id"], second_port["id"]],
                                                     "parts": [first_kind, second_kind], "volume": round(volume, 6), "point": point})
                        collision_ids.add(f"port-{first_port['id']}-{first_kind}")
                        collision_ids.add(f"port-{second_port['id']}-{second_kind}")
    if result["collisions"]:
        pairs = {tuple(c["ports"]) for c in result["collisions"]}
        result["warnings"].append(f"Port interference detected between {len(pairs)} pair(s). Red parts overlap. Export remains available.")
    if include_mesh:
        for identity, name, kind, port_id, solid in parts:
            mesh = _mesh(solid, identity, name, kind, port_id)
            mesh["collision"] = identity in collision_ids
            result["meshes"].append(mesh)
    result["metrics"] = {"portCount": len(ports), "collisionCount": len(result["collisions"]),
                         "bodyOD": body["od"], "height": body["height"], "innerDiameter": inner_radius * 2,
                         "materialVolume": sum(s.volume() for *_, s in parts), "meshSegments": SEGMENTS,
                         "collisionToleranceVolume": VOLUME_EPSILON,
                         "portSurfaceChordError": max((
                             max(p["dimensions"]["od"] / 2 * (1 - math.cos(math.pi / SEGMENTS)),
                                 (p["dimensions"].get("holeDiameter") or 0) / 2 * (1 - math.cos(math.pi / HOLE_SEGMENTS)))
                             for p, _ in ports), default=0)}
    return result
