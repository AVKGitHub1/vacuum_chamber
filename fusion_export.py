"""Generate a dependency-free Autodesk Fusion Python script.

The application stores lengths in millimetres, regardless of display units.
The generated script uses expressions with explicit units and Fusion's native
sketch, construction-plane, extrude, loft, and pattern features.
"""

from __future__ import annotations

import copy
import json
import math


_FLANGE_DIMENSIONS = (
    "od", "bore", "tubeOD", "tubeWall", "thickness", "boltCircle",
    "holeDiameter", "holeCount", "sealInner", "sealOuter", "sealDepth",
    "knifeEdgeDiameter", "knifeTipSetback", "knifeHalfWidth", "knifeTipWidth",
    "hubOD", "shoulderOD", "shoulderDepth", "threadDiameter", "threadPitch",
)


def _positive(value, label, allow_zero=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a finite number in millimetres")
    if not math.isfinite(value) or (value < 0 if allow_zero else value <= 0):
        raise ValueError(f"{label} must be {'non-negative' if allow_zero else 'positive'}")
    return float(value)


def _flange_profile(raw, family, label, warnings, bore=None):
    d = copy.deepcopy(raw)
    d["family"] = family
    if bore is not None:
        d["bore"] = bore
    for key in ("od", "bore", "thickness", "boltCircle", "holeDiameter", "holeCount"):
        _positive(d.get(key), f"{label}: {key}")
    if d["bore"] >= d["od"]:
        raise ValueError(f"{label}: bore must be smaller than flange OD")
    if d["holeCount"] != int(d["holeCount"]):
        raise ValueError(f"{label}: hole count must be a whole number")
    if not d.get("sealInner"):
        d["sealInner"] = d["bore"]
    if not d.get("sealOuter"):
        # Explicitly provisional, kept outside the bolt-hole envelope.
        d["sealOuter"] = (d["bore"] + d["boltCircle"] - d["holeDiameter"]) / 2
        warnings.append(f"{label}: sealing recess diameter is provisional; review supplier drawing.")
    if not d.get("sealDepth"):
        d["sealDepth"] = 1.2 if family == "CF" else 2.5
        warnings.append(f"{label}: sealing recess depth is provisional ({d['sealDepth']:g} mm).")
    if family == "CF":
        defaults = {
            "knifeEdgeDiameter": (d["bore"] + d["sealOuter"]) / 2,
            "knifeTipSetback": d["sealDepth"] / 2,
            "knifeHalfWidth": min(0.5, (d["sealOuter"] - d["bore"]) / 8),
            "knifeTipWidth": 0.04,
        }
        for key, value in defaults.items():
            if d.get(key) is None:
                d[key] = value
        warnings.append(f"{label}: CF knife-edge microprofile is a provisional CAD profile, not a manufacturing drawing.")
    for key in ("sealInner", "sealOuter", "sealDepth"):
        _positive(d[key], f"{label}: {key}")
    if not d["bore"] <= d["sealInner"] < d["sealOuter"] < d["od"]:
        raise ValueError(f"{label}: invalid sealing-recess diameters")
    if d["sealDepth"] >= d["thickness"]:
        raise ValueError(f"{label}: seal depth must be less than flange thickness")
    if family == "CF":
        for key in ("knifeEdgeDiameter", "knifeHalfWidth", "knifeTipWidth"):
            _positive(d[key], f"{label}: {key}")
        _positive(d["knifeTipSetback"], f"{label}: knifeTipSetback", True)
        if not 0 <= d["knifeTipSetback"] < d["sealDepth"]:
            raise ValueError(f"{label}: CF tip setback must be less than recess depth")
        if not d["sealInner"] < d["knifeEdgeDiameter"] - 2*d["knifeHalfWidth"]:
            raise ValueError(f"{label}: CF knife-edge root intersects the flange bore")
        if not d["knifeEdgeDiameter"] + 2*d["knifeHalfWidth"] < d["sealOuter"]:
            raise ValueError(f"{label}: CF knife-edge root exceeds sealing recess")
        if d["knifeTipWidth"] >= 2*d["knifeHalfWidth"]:
            raise ValueError(f"{label}: CF knife tip must be narrower than its root")
    if not d.get("verified", False):
        warnings.append(f"{label}: some dimensions are provisional; inspect the saved catalog source and notes.")
    return d


def prepare_export(config, catalog):
    """Resolve catalog values into the immutable payload used by the script."""
    cfg = copy.deepcopy(config)
    body = cfg.get("body", {})
    warnings = []
    for key in ("od", "height", "wall"):
        _positive(body.get(key), f"Chamber {key}")
    if body["wall"] * 2 >= body["od"]:
        raise ValueError("Chamber wall leaves no interior")
    bore = body["od"] - 2 * body["wall"]
    for end in ("top", "bottom"):
        choice = body.get(end, "ISO-F")
        family = "CF" if str(choice).upper().startswith("CF") else "ISO-F"
        if family == "ISO-F" and choice != "ISO-F":
            raise ValueError(f"Unsupported {end} end: {choice}")
        spec = body.get(end + "Spec")
        if not isinstance(spec, dict):
            raise ValueError(f"{end}Spec flange dimensions are required")
        body[end + "Spec"] = _flange_profile(
            spec, family, end.capitalize(), warnings, None if spec.get("bore") else bore
        )
    if body["topSpec"]["thickness"] + body["bottomSpec"]["thickness"] >= body["height"]:
        raise ValueError("End flanges leave no cylindrical chamber wall")
    by_id = {f["id"]: f for f in catalog.get("flanges", [])}
    for index, p in enumerate(cfg.get("ports", [])):
        label = "Port " + str(p.get("id", index + 1))
        if p.get("flange") not in by_id:
            raise ValueError(f"{label}: unknown flange {p.get('flange')!r}")
        d = copy.deepcopy(by_id[p["flange"]])
        d.update(p.get("dimensions") or {})
        family = d.get("family", "CF" if p["flange"].startswith("CF") else "ISO-F")
        if family not in ("CF", "ISO-F"):
            raise ValueError(f"{label}: only CF and ISO-F flanges are supported")
        d = _flange_profile(d, family, label, warnings)
        for key in ("tubeOD", "tubeWall"):
            _positive(d.get(key), f"{label}: {key}")
        if d["tubeWall"] * 2 >= d["tubeOD"]:
            raise ValueError(f"{label}: tube has no open bore")
        _positive(p.get("focalLength"), f"{label}: focal length")
        _positive(p.get("elevation"), f"{label}: elevation", True)
        for angle in ("alpha", "beta"):
            value = p.get(angle)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f"{label}: {angle} must be a finite angle")
        if not 45 <= p["beta"] <= 135:
            raise ValueError(f"{label}: beta must be between 45 and 135 degrees")
        if p["focalLength"] <= d["thickness"]:
            raise ValueError(f"{label}: focal length must exceed flange thickness")
        style = p.get("style", "fixed-through")
        if style not in ("fixed-through", "fixed-tapped", "rotatable-through", "rotatable-tapped"):
            raise ValueError(f"{label}: unsupported flange style {style!r}")
        if "rotat" in style.lower():
            if family != "CF":
                raise ValueError(f"{label}: rotatable rings are only supported for CF")
            if d.get("hubOD") is None:
                d["hubOD"] = (d["sealOuter"] + d["boltCircle"] - d["holeDiameter"]) / 2
            if d.get("shoulderOD") is None:
                d["shoulderOD"] = (d["hubOD"] + d["boltCircle"] - d["holeDiameter"]) / 2
            if d.get("shoulderDepth") is None:
                d["shoulderDepth"] = d["thickness"] / 3
            if not d["sealOuter"] < d["hubOD"] < d["shoulderOD"] < d["boltCircle"] - d["holeDiameter"]:
                raise ValueError(f"{label}: invalid rotatable insert/shoulder dimensions")
            if not 0 < d["shoulderDepth"] < d["thickness"]:
                raise ValueError(f"{label}: invalid rotatable shoulder depth")
            warnings.append(f"{label}: rotatable CF insert and retaining shoulder dimensions are provisional.")
        if "tap" in style.lower():
            if not d.get("thread"):
                raise ValueError(f"{label}: tapped style needs a thread designation")
            _positive(d.get("threadDiameter"), f"{label}: threadDiameter")
        p["dimensions"] = d
    warnings.append("Weld sockets, counterbores, edge chamfers, weld beads, covers and attached hardware are not modeled; supplier section drawings are needed for those details.")
    cfg["body"] = body
    cfg["exportWarnings"] = list(dict.fromkeys(warnings))
    return cfg


def generate_script(config, catalog) -> str:
    """Return a standalone .py file for Fusion's Scripts and Add-Ins dialog."""
    payload = prepare_export(config, catalog)
    serialized = json.dumps(payload, ensure_ascii=True, allow_nan=False, separators=(",", ":"))
    return _SCRIPT.replace("__CHAMBER_PAYLOAD__", repr(serialized))


_SCRIPT = r'''# Generated by the local Vacuum Chamber Builder.
# All saved dimensions are millimetres; angles are degrees.
# Requires an active Fusion DESIGN with Capture Design History enabled.
# Construction dimensions and sealing-profile assumptions are embedded below.
import adsk.core
import adsk.fusion
import json
import math
import traceback

CONFIG = json.loads(__CHAMBER_PAYLOAD__)


class ChamberBuilder:
    def __init__(self, design, component, prefix):
        self.design = design
        self.comp = component
        self.prefix = prefix
        self.warnings = list(CONFIG.get('exportWarnings', []))
        self.stage = 'initialization'
        self.opening_tools = []

    def parameter(self, name, value, units='mm', comment=''):
        full = self.prefix + name
        if isinstance(value, str):
            expression = value
        else:
            expression = format(float(value), '.15g') + (' ' + units if units else '')
        result = self.design.userParameters.add(full, self.value(expression), units, comment)
        if result is None:
            raise RuntimeError('Could not create parameter ' + full)
        return full

    def value(self, expression):
        return adsk.core.ValueInput.createByString(str(expression))

    def cm(self, expression):
        return self.design.unitsManager.evaluateExpression(str(expression), 'cm')

    def point(self, x=0, y=0, z=0):
        return adsk.core.Point3D.create(x, y, z)

    def collection(self, items):
        result = adsk.core.ObjectCollection.create()
        for item in items:
            result.add(item)
        return result

    def offset(self, plane, distance, name):
        inp = self.comp.constructionPlanes.createInput()
        if not inp.setByOffset(plane, self.value(distance)):
            raise RuntimeError('Invalid offset plane: ' + name)
        result = self.comp.constructionPlanes.add(inp)
        result.name = name
        result.isLightBulbOn = False
        return result

    def angle_plane(self, axis, angle, plane, name):
        inp = self.comp.constructionPlanes.createInput()
        if not inp.setByAngle(axis, self.value(angle), plane):
            raise RuntimeError('Invalid angle plane: ' + name)
        result = self.comp.constructionPlanes.add(inp)
        result.name = name
        result.isLightBulbOn = False
        return result

    def intersection_axis(self, plane1, plane2, name):
        inp = self.comp.constructionAxes.createInput()
        if not inp.setByTwoPlanes(plane1, plane2):
            raise RuntimeError('Invalid intersecting planes: ' + name)
        result = self.comp.constructionAxes.add(inp)
        result.name = name
        result.isLightBulbOn = False
        return result

    def sketch(self, plane, name, center=None):
        sk = self.comp.sketches.add(plane)
        sk.name = name
        if center is None:
            ref = sk.originPoint
        else:
            projected = self.project(sk, center)
            ref = next((x for x in projected if x.objectType == adsk.fusion.SketchPoint.classType()), None)
            if ref is None:
                raise RuntimeError('Could not project the flange center into ' + name)
        return sk, ref

    def project(self, sk, entity):
        # Explicit linked projections preserve recomputation after parameter edits.
        return sk.project2([entity], True) if hasattr(sk, 'project2') else sk.project(entity)

    def circle(self, sk, ref, diameter):
        r = self.cm(diameter) / 2
        circle = sk.sketchCurves.sketchCircles.addByCenterRadius(ref.geometry, r)
        sk.geometricConstraints.addCoincident(circle.centerSketchPoint, ref)
        loc = ref.geometry.copy()
        loc.x += r * 0.8
        loc.y += r * 0.8
        dim = sk.sketchDimensions.addDiameterDimension(circle, loc)
        dim.parameter.expression = diameter
        return circle

    def profile(self, sk, annulus=False):
        for profile in sk.profiles:
            if profile.profileLoops.count == (2 if annulus else 1):
                return profile
        raise RuntimeError('Expected ' + ('annular' if annulus else 'circular') + ' profile in ' + sk.name)

    def ring_sketch(self, plane, center, od, bore, name):
        sk, ref = self.sketch(plane, name, center)
        circle = self.circle(sk, ref, od)
        if bore is not None:
            self.circle(sk, ref, bore)
        return sk, ref, self.profile(sk, bore is not None), circle

    def extrude(self, profile, distance, sign, operation, name, bodies=None):
        inp = self.comp.features.extrudeFeatures.createInput(profile, operation)
        extent = adsk.fusion.DistanceExtentDefinition.create(self.value(distance))
        direction = (adsk.fusion.ExtentDirections.PositiveExtentDirection if sign > 0
                     else adsk.fusion.ExtentDirections.NegativeExtentDirection)
        inp.setOneSideExtent(extent, direction)
        if bodies is not None:
            inp.participantBodies = bodies
        result = self.comp.features.extrudeFeatures.add(inp)
        result.name = name
        profile.parentSketch.isLightBulbOn = False
        return result

    def direction_sign(self, sk, direction):
        origin = sk.sketchToModelSpace(self.point())
        normal_point = sk.sketchToModelSpace(self.point(0, 0, 1))
        normal = origin.vectorTo(normal_point)
        dot = normal.x*direction[0] + normal.y*direction[1] + normal.z*direction[2]
        if abs(dot) < 0.999:
            raise RuntimeError('Flange construction plane normal does not match port direction')
        return 1 if dot > 0 else -1

    def plane_sign(self, plane, direction):
        normal = plane.geometry.normal
        dot = normal.x*direction[0] + normal.y*direction[1] + normal.z*direction[2]
        if abs(dot) < 0.999:
            raise RuntimeError('Construction plane normal does not match requested direction')
        return 1 if dot > 0 else -1

    def flange_parameters(self, stem, dims, bore_expression=None):
        params = {}
        dimensional = ('od', 'bore', 'thickness', 'boltCircle', 'holeDiameter',
                       'sealInner', 'sealOuter', 'sealDepth', 'knifeEdgeDiameter',
                       'knifeTipSetback', 'knifeHalfWidth', 'knifeTipWidth',
                       'tubeOD', 'tubeWall', 'hubOD', 'shoulderOD', 'shoulderDepth',
                       'threadDiameter', 'threadPitch')
        for key in dimensional:
            if dims.get(key) is not None:
                expr = bore_expression if key == 'bore' and bore_expression else dims[key]
                params[key] = self.parameter(stem + '_' + key, expr, 'mm', dims.get('notes', ''))
        if bore_expression:
            params['sealInner'] = params['bore']
        params['holeCount'] = self.parameter(stem + '_holeCount', dims['holeCount'], '', 'Bolt pattern count')
        return params

    def holes(self, face_plane, center, direction, params, body, name, tapped=False, dims=None):
        sk, ref = self.sketch(face_plane, name + ' bolt seed', center)
        radius = self.cm(params['boltCircle']) / 2
        radial_length = math.hypot(direction[0], direction[1])
        if radial_length < 0.001:
            world_radial = (1, 0, 0)
            reference_axis = self.comp.xConstructionAxis
        else:
            # Rz(alpha) Ry(beta) applied to +X, matching the browser mesh's
            # bolt phase. Its line is parallel to the projection of the Z axis.
            world_radial = (direction[2]*direction[0]/radial_length,
                            direction[2]*direction[1]/radial_length, -radial_length)
            reference_axis = self.comp.zConstructionAxis
        world_target = sk.sketchToModelSpace(ref.geometry)
        world_target.x += radius*world_radial[0]
        world_target.y += radius*world_radial[1]
        world_target.z += radius*world_radial[2]
        target = sk.modelToSketchSpace(world_target)
        projected = self.project(sk, reference_axis)
        phase_line = next((x for x in projected if x.objectType == adsk.fusion.SketchLine.classType()), None)
        if phase_line is None:
            raise RuntimeError('Could not create a linked bolt-phase reference for ' + name)
        phase_line.isConstruction = True
        line = sk.sketchCurves.sketchLines.addByTwoPoints(ref, target)
        line.isConstruction = True
        sk.geometricConstraints.addParallel(line, phase_line)
        dim = sk.sketchDimensions.addDistanceDimension(line.startSketchPoint, line.endSketchPoint,
            adsk.fusion.DimensionOrientations.AlignedDimensionOrientation, target)
        dim.parameter.expression = params['boltCircle'] + ' / 2'
        hole_diameter = params['threadDiameter'] if tapped else params['holeDiameter']
        self.circle(sk, line.endSketchPoint, hole_diameter)
        hole_profile = self.profile(sk)
        sign = self.direction_sign(sk, direction)
        feature = self.extrude(hole_profile, params['thickness'], -sign,
            adsk.fusion.FeatureOperations.CutFeatureOperation, name + ' bolt hole', [body])
        # The construction circle supplies a stable parametric pattern axis.
        axis_sk, axis_ref = self.sketch(face_plane, name + ' pattern axis', center)
        axis_circle = self.circle(axis_sk, axis_ref, params['boltCircle'])
        pattern_in = self.comp.features.circularPatternFeatures.createInput(self.collection([feature]), axis_circle)
        pattern_in.quantity = self.value(params['holeCount'])
        pattern_in.totalAngle = self.value('360 deg')
        pattern_in.isSymmetric = False
        pattern = self.comp.features.circularPatternFeatures.add(pattern_in)
        pattern.name = name + ' bolt circle'
        axis_sk.isLightBulbOn = False
        if tapped:
            self.add_threads(body, dims, name)

    def add_threads(self, body, dims, name):
        # Cosmetic native thread features keep the model responsive. An unavailable
        # table/designation is reported visibly and in the component attributes.
        try:
            query = (adsk.fusion.ThreadDataQuery.create(False)
                     if hasattr(adsk.fusion.ThreadDataQuery, 'create')
                     else self.comp.features.threadFeatures.threadDataQuery)
            requested = str(dims['thread']).replace(' ', '').replace('#', '').upper()
            match = None
            for thread_type in query.allThreadTypes:
                if ('metric' in thread_type.lower()) != requested.startswith('M'):
                    continue
                for size in query.allSizes(thread_type):
                    for designation in query.allDesignations(thread_type, size):
                        normalized = designation.replace(' ', '').replace('#', '').upper()
                        if normalized == requested or normalized.split('UN')[0].rstrip('-') == requested:
                            classes = query.allClasses(True, thread_type, designation)
                            if classes:
                                match = (thread_type, designation, classes[0])
                                break
                    if match:
                        break
                if match:
                    break
            if not match:
                raise RuntimeError('No exact installed Fusion thread designation matched ' + str(dims['thread']))
            if hasattr(adsk.fusion.ThreadInfo, 'create'):
                info = adsk.fusion.ThreadInfo.create(False, True, match[0], match[1], match[2], True)
            else:
                info = self.comp.features.threadFeatures.createThreadInfo(True, *match)
            faces = []
            for face in body.faces:
                cylinder = adsk.core.Cylinder.cast(face.geometry)
                if cylinder and abs(cylinder.radius*20 - dims['threadDiameter']) < 0.01:
                    faces.append(face)
            if len(faces) != int(dims['holeCount']):
                raise RuntimeError('Could not identify every tapped bolt-hole face')
            inp = self.comp.features.threadFeatures.createInput(self.collection(faces), info)
            inp.isModeled = False
            feature = self.comp.features.threadFeatures.add(inp)
            feature.name = name + ' ' + str(dims['thread']) + ' cosmetic threads'
        except Exception as exc:
            self.warnings.append(name + ': THREAD FEATURES NOT CREATED: ' + str(exc)
                                 + '. Nominal-diameter holes remain; add or correct threads in Fusion.')

    def loft(self, profiles, operation, name, bodies=None):
        inp = self.comp.features.loftFeatures.createInput(operation)
        for profile in profiles:
            inp.loftSections.add(profile)
        if bodies is not None:
            inp.participantBodies = bodies
        result = self.comp.features.loftFeatures.add(inp)
        result.name = name
        for profile in profiles:
            profile.parentSketch.isLightBulbOn = False
        return result

    def seal(self, face_plane, center, direction, params, dims, body, name):
        sk, ref, profile, _ = self.ring_sketch(face_plane, center,
            params['sealOuter'], params['sealInner'], name + ' seal recess')
        sign = self.direction_sign(sk, direction)
        self.extrude(profile, params['sealDepth'], -sign,
            adsk.fusion.FeatureOperations.CutFeatureOperation, name + ' sealing recess', [body])
        if dims['family'] != 'CF':
            return
        plane_sign = self.plane_sign(face_plane, direction)
        base_plane = self.offset(face_plane, f'-({plane_sign}) * ({params["sealDepth"]})', name + ' knife root plane')
        tip_plane = self.offset(face_plane, f'-({plane_sign}) * ({params["knifeTipSetback"]})', name + ' knife tip plane')
        outer_root = params['knifeEdgeDiameter'] + ' + 2 * ' + params['knifeHalfWidth']
        outer_tip = params['knifeEdgeDiameter'] + ' + ' + params['knifeTipWidth']
        inner_root = params['knifeEdgeDiameter'] + ' - 2 * ' + params['knifeHalfWidth']
        inner_tip = params['knifeEdgeDiameter'] + ' - ' + params['knifeTipWidth']
        # Two disk lofts make conical faces, without relying on annular loft support.
        _, _, root_profile, _ = self.ring_sketch(base_plane, center, outer_root, None, name + ' knife outer root')
        _, _, tip_profile, _ = self.ring_sketch(tip_plane, center, outer_tip, None, name + ' knife outer tip')
        cone = self.loft([root_profile, tip_profile], adsk.fusion.FeatureOperations.NewBodyFeatureOperation, name + ' knife outer cone')
        cone_body = cone.bodies.item(0)
        _, _, root_cut, _ = self.ring_sketch(base_plane, center, inner_root, None, name + ' knife inner root')
        _, _, tip_cut, _ = self.ring_sketch(tip_plane, center, inner_tip, None, name + ' knife inner tip')
        self.loft([root_cut, tip_cut], adsk.fusion.FeatureOperations.CutFeatureOperation, name + ' knife inner cone', [cone_body])
        combine = self.comp.features.combineFeatures.createInput(body, self.collection([cone_body]))
        combine.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation
        combined = self.comp.features.combineFeatures.add(combine)
        combined.name = name + ' knife join'

    def flange(self, face_plane, center, direction, params, dims, name, style='fixed-through'):
        rotating = 'rotat' in style.lower()
        tapped = 'tap' in style.lower()
        sk, ref, profile, _ = self.ring_sketch(face_plane, center, params['od'],
            params['hubOD'] if rotating else params['bore'], name + ' ring outline')
        sign = self.direction_sign(sk, direction)
        flange_feature = self.extrude(profile, params['thickness'], -sign,
            adsk.fusion.FeatureOperations.NewBodyFeatureOperation, name + ' ring')
        ring = flange_feature.bodies.item(0)
        ring.name = name + (' rotatable bolt ring' if rotating else ' flange')
        sealing_body = ring
        if rotating:
            psign = self.plane_sign(face_plane, direction)
            rear = self.offset(face_plane, f'-({psign}) * ({params["thickness"]})', name + ' back plane')
            seat_sk, _, seat, _ = self.ring_sketch(rear, center, params['shoulderOD'], params['hubOD'], name + ' retaining seat')
            self.extrude(seat, params['shoulderDepth'], self.direction_sign(seat_sk, direction),
                adsk.fusion.FeatureOperations.CutFeatureOperation, name + ' retaining seat cut', [ring])
            ins_sk, _, ins_profile, _ = self.ring_sketch(face_plane, center, params['hubOD'], params['bore'], name + ' insert outline')
            ins = self.extrude(ins_profile, params['thickness'], -self.direction_sign(ins_sk, direction),
                adsk.fusion.FeatureOperations.NewBodyFeatureOperation, name + ' insert')
            sealing_body = ins.bodies.item(0)
            sealing_body.name = name + ' sealing insert (provisional shoulder)'
            shoulder_sk, _, shoulder, _ = self.ring_sketch(rear, center, params['shoulderOD'], params['bore'], name + ' insert shoulder')
            # Separate body followed by explicit combine avoids joining the adjacent ring.
            shoulder_feature = self.extrude(shoulder, params['shoulderDepth'], self.direction_sign(shoulder_sk, direction),
                adsk.fusion.FeatureOperations.NewBodyFeatureOperation, name + ' shoulder solid')
            combine = self.comp.features.combineFeatures.createInput(sealing_body, self.collection([shoulder_feature.bodies.item(0)]))
            combine.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation
            combined = self.comp.features.combineFeatures.add(combine)
            combined.name = name + ' insert shoulder join'
        self.seal(face_plane, center, direction, params, dims, sealing_body, name)
        self.holes(face_plane, center, direction, params, ring, name, tapped, dims)
        return ring, sealing_body

    def build(self):
        body = CONFIG['body']
        self.stage = 'chamber parameters and end flanges'
        od = self.parameter('BodyOD', body['od'])
        height = self.parameter('Height', body['height'])
        wall = self.parameter('Wall', body['wall'])
        interior = self.parameter('BodyID', od + ' - 2 * ' + wall)
        end_params = {}
        for end in ('bottom', 'top'):
            dims = body[end + 'Spec']
            params = self.flange_parameters(end.capitalize(), dims)
            end_params[end] = params
            plane = self.comp.xYConstructionPlane if end == 'bottom' else self.offset(self.comp.xYConstructionPlane, height, 'Top outer face')
            direction = (0, 0, -1) if end == 'bottom' else (0, 0, 1)
            self.flange(plane, None, direction, params, dims, end.capitalize())
        self.stage = 'cylindrical shell'
        shell_plane = self.offset(self.comp.xYConstructionPlane, end_params['bottom']['thickness'], 'Shell bottom')
        shell_sk, _, shell_profile, _ = self.ring_sketch(shell_plane, None, od, interior, 'Shell section')
        shell_length = height + ' - ' + end_params['bottom']['thickness'] + ' - ' + end_params['top']['thickness']
        shell_feature = self.extrude(shell_profile, shell_length, self.direction_sign(shell_sk, (0, 0, 1)),
            adsk.fusion.FeatureOperations.NewBodyFeatureOperation, 'Cylindrical shell')
        shell = shell_feature.bodies.item(0)
        shell.name = 'Chamber shell'
        for index, port in enumerate(CONFIG.get('ports', []), 1):
            label = 'Port ' + str(port.get('id', index))
            self.stage = label
            self.build_port(index, port, shell, interior, height)
        if self.opening_tools:
            self.stage = 'cutting all port openings'
            # One Boolean accepts overlapping/coincident tools. Separate cut
            # features can fail when an earlier port already removed the material.
            opening_cut = self.comp.features.combineFeatures.createInput(shell, self.collection(self.opening_tools))
            opening_cut.operation = adsk.fusion.FeatureOperations.CutFeatureOperation
            opening_cut.isKeepToolBodies = False
            feature = self.comp.features.combineFeatures.add(opening_cut)
            feature.name = 'All port openings'
        self.comp.attributes.add('VacuumChamberBuilder', 'configuration', json.dumps(CONFIG))
        self.comp.attributes.add('VacuumChamberBuilder', 'warnings', json.dumps(self.warnings))
        self.comp.attributes.add('VacuumChamberBuilder', 'parameterPrefix', self.prefix)

    def build_port(self, index, port, shell, interior, height):
        stem = 'Port' + str(index)
        label = 'Port ' + str(port.get('id', index))
        dims = port['dimensions']
        params = self.flange_parameters(stem, dims)
        elev = self.parameter(stem + '_elevation', port['elevation'])
        focal = self.parameter(stem + '_focalLength', port['focalLength'])
        alpha = self.parameter(stem + '_alpha', port['alpha'], 'deg')
        beta = self.parameter(stem + '_beta', port['beta'], 'deg')
        a, b = math.radians(port['alpha']), math.radians(port['beta'])
        direction = (math.sin(b)*math.cos(a), math.sin(b)*math.sin(a), math.cos(b))
        tangent = (-math.sin(a), math.cos(a), 0)
        horizontal = self.offset(self.comp.xYConstructionPlane, elev, label + ' focal elevation')
        focus_sk, focus = self.sketch(horizontal, label + ' focal point')
        focus_sk.isLightBulbOn = False
        # The vertical tangential plane and elevated horizontal plane intersect
        # along a tangent axis passing through the point (0, 0, elevation).
        tangential_plane = self.angle_plane(self.comp.zConstructionAxis, alpha,
            self.comp.yZConstructionPlane, label + ' azimuth')
        tangent_axis = self.intersection_axis(horizontal, tangential_plane, label + ' tilt axis')
        av = tangent_axis.geometry.direction
        tangent_sign = 1 if av.x*tangent[0] + av.y*tangent[1] >= 0 else -1
        port_plane = self.angle_plane(tangent_axis, f'({tangent_sign}) * ({beta})', horizontal, label + ' port direction')
        psign = self.plane_sign(port_plane, direction)
        face = self.offset(port_plane, f'({psign}) * ({focal})', label + ' outer sealing face')
        self.flange(face, focus, direction, params, dims, label, port.get('style', 'fixed-through'))
        self.stage = label + ' tube and shell opening'
        tube_id = params['tubeOD'] + ' - 2 * ' + params['tubeWall']
        tube_sk, _, tube_profile, _ = self.ring_sketch(port_plane, focus, params['tubeOD'], tube_id, label + ' tube section')
        tube = self.extrude(tube_profile, focal + ' - ' + params['thickness'], self.direction_sign(tube_sk, direction),
            adsk.fusion.FeatureOperations.NewBodyFeatureOperation, label + ' untrimmed tube').bodies.item(0)
        tube.name = label + ' saddle-trimmed tube'
        # Remove tube material inside the chamber to obtain the true saddle.
        trim_plane = self.offset(self.comp.xYConstructionPlane, '-(' + height + ')', label + ' saddle tool plane')
        trim_sk, _, trim_profile, _ = self.ring_sketch(trim_plane, None, interior, None, label + ' chamber interior tool')
        self.extrude(trim_profile, '3 * ' + height, self.direction_sign(trim_sk, (0, 0, 1)),
            adsk.fusion.FeatureOperations.CutFeatureOperation, label + ' saddle trim', [tube])
        # Cut a tube-OD opening so the inserted tube and chamber wall meet.
        opening_sk, _, opening, _ = self.ring_sketch(port_plane, focus, params['tubeOD'], None, label + ' shell opening profile')
        tool_feature = self.extrude(opening, focal, self.direction_sign(opening_sk, direction),
            adsk.fusion.FeatureOperations.NewBodyFeatureOperation, label + ' opening tool')
        self.opening_tools.append(tool_feature.bodies.item(0))


def run(context):
    app = adsk.core.Application.get()
    ui = app.userInterface
    builder = None
    occurrence = None
    try:
        design = adsk.fusion.Design.cast(app.activeProduct)
        if design is None:
            raise RuntimeError('Open a Fusion design in the Design workspace before running this script.')
        if design.designType != adsk.fusion.DesignTypes.ParametricDesignType:
            raise RuntimeError('This script requires Capture Design History. Enable it in your design, then run again. No geometry has been added.')
        # Newer Fusion releases distinguish Part and Hybrid design intent. Hybrid
        # permits adding a chamber component without removing existing history.
        if hasattr(design, 'designIntent') and design.designIntent == adsk.fusion.DesignIntentTypes.PartDesignIntentType:
            design.designIntent = adsk.fusion.DesignIntentTypes.HybridDesignIntentType
        design.timeline.moveToEnd()
        start = design.timeline.count
        index = 1
        while design.userParameters.itemByName('VC' + str(index) + '_BodyOD'):
            index += 1
        prefix = 'VC' + str(index) + '_'
        occurrence = design.rootComponent.occurrences.addNewComponent(adsk.core.Matrix3D.create())
        component = occurrence.component
        component.name = 'Vacuum chamber ' + str(index)
        builder = ChamberBuilder(design, component, prefix)
        builder.build()
        builder.stage = 'recomputing and checking feature health'
        design.computeAll()
        finish = design.timeline.count - 1
        for timeline_index in range(start, finish + 1):
            entity = design.timeline.item(timeline_index).entity
            if entity is None or not hasattr(entity, 'healthState'):
                continue
            if entity.healthState == adsk.fusion.FeatureHealthStates.ErrorFeatureHealthState:
                raise RuntimeError(entity.name + ': ' + entity.errorOrWarningMessage)
            if entity.healthState == adsk.fusion.FeatureHealthStates.WarningFeatureHealthState:
                builder.warnings.append(entity.name + ': ' + entity.errorOrWarningMessage)
        component.attributes.add('VacuumChamberBuilder', 'warnings', json.dumps(builder.warnings))
        if finish >= start:
            group = design.timeline.timelineGroups.add(start, finish)
            group.name = component.name
        app.activeViewport.fit()
        message = 'Created ' + component.name + '.\nEdit dimensions under Modify > Change Parameters (prefix ' + prefix + ').\n'
        message += 'Open CF/ISO-F end rings are included; covers and attached hardware are not included.'
        if builder.warnings:
            message += '\n\nDIMENSION / DETAIL NOTES:\n' + '\n'.join('- ' + text for text in builder.warnings)
        ui.messageBox(message, 'Chamber generated')
    except Exception:
        if occurrence is not None:
            occurrence.component.name = 'INCOMPLETE chamber - inspect error'
        stage = builder.stage if builder else 'preflight'
        ui.messageBox('Chamber generation stopped during ' + stage + '.\n'
                      'Any partial geometry is in the INCOMPLETE component; inspect or delete it before retrying.\n\n'
                      + traceback.format_exc(), 'Chamber generation failed')
'''
