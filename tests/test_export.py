"""Tests for the actual exported artifact and its dimensional payload.

Autodesk's CAD kernel is available only inside Fusion. These tests deliberately
do not pretend that compiling a script verifies its CAD features.
"""

import ast
import copy
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

from fusion_export import generate_script, prepare_export


ROOT = Path(__file__).resolve().parents[1]


def fixture():
    catalog = json.loads((ROOT / "data" / "catalog.json").read_text(encoding="utf-8"))
    end = copy.deepcopy(catalog["endProfiles"][0])
    config = {
        "schemaVersion": 1,
        "units": "in",
        "body": {
            "od": 323.85, "height": 508, "wall": 3.048,
            "top": "ISO-F", "bottom": "ISO-F",
            "topSpec": copy.deepcopy(end), "bottomSpec": copy.deepcopy(end),
        },
        "ports": [{"id": "A", "flange": "CF40", "style": "fixed-through",
                   "elevation": 254, "focalLength": 260, "alpha": 0, "beta": 90}],
        "notes": "",
    }
    return config, catalog


def embedded_config(script):
    tree = ast.parse(script)
    assignment = next(node for node in tree.body if isinstance(node, ast.Assign)
                      and any(isinstance(t, ast.Name) and t.id == "CONFIG" for t in node.targets))
    return json.loads(ast.literal_eval(assignment.value.args[0]))


def load_runtime(config, catalog):
    """Load the real artifact without pretending to supply a Fusion CAD kernel."""
    adsk = ModuleType("adsk")
    adsk.core = ModuleType("adsk.core")
    adsk.fusion = ModuleType("adsk.fusion")
    adsk.fusion.FeatureOperations = SimpleNamespace(
        NewBodyFeatureOperation="new", CutFeatureOperation="cut", JoinFeatureOperation="join")
    scope = {}
    with patch.dict(sys.modules, {"adsk": adsk, "adsk.core": adsk.core, "adsk.fusion": adsk.fusion}):
        exec(compile(generate_script(config, catalog), "generated.py", "exec"), scope)
    return scope


class CombineRecorder:
    def __init__(self, events):
        self.events = events
        self.inputs = []

    def createInput(self, target, tools):
        result = SimpleNamespace(target=target, tools=list(tools))
        self.inputs.append(result)
        self.events.append(("combine-input", result))
        return result

    def add(self, inp):
        self.events.append(("combine-add", inp))
        return SimpleNamespace(name="")


class ExportTests(unittest.TestCase):
    def test_knife_operations_are_scoped_before_joining_target(self):
        runtime = load_runtime(*fixture())
        builder = runtime["ChamberBuilder"].__new__(runtime["ChamberBuilder"])
        events = []
        combines = CombineRecorder(events)
        intended_flange, new_cone, unrelated_overlapping_flange = object(), object(), object()
        builder.comp = SimpleNamespace(features=SimpleNamespace(combineFeatures=combines))
        builder.ring_sketch = lambda *args: ("sketch", "center", args[-1], "circle")
        builder.direction_sign = lambda *args: 1
        builder.plane_sign = lambda *args: 1
        builder.offset = lambda *args: args[-1]
        builder.collection = list
        builder.extrude = lambda *args: events.append(("extrude", args))

        def loft(profiles, operation, name, bodies=None):
            events.append(("loft", operation, bodies))
            return SimpleNamespace(bodies=SimpleNamespace(item=lambda index: new_cone))

        builder.loft = loft
        params = {key: key for key in ("sealOuter", "sealInner", "sealDepth", "knifeEdgeDiameter",
                                      "knifeHalfWidth", "knifeTipWidth", "knifeTipSetback")}
        builder.seal("face", "center", (1, 0, 0), params, {"family": "CF"}, intended_flange, "Port A")
        lofts = [e for e in events if e[0] == "loft"]
        self.assertEqual(lofts, [("loft", "new", None), ("loft", "cut", [new_cone])])
        self.assertEqual(len(combines.inputs), 1)
        self.assertIs(combines.inputs[0].target, intended_flange)
        self.assertEqual(combines.inputs[0].tools, [new_cone])
        self.assertEqual(combines.inputs[0].operation, "join")
        self.assertLess(events.index(lofts[1]), next(i for i, e in enumerate(events) if e[0] == "combine-input"))
        self.assertNotIn(unrelated_overlapping_flange, combines.inputs[0].tools)

    def test_overlapping_opening_tools_are_submitted_in_one_shell_cut(self):
        config, catalog = fixture()
        config["ports"].append(dict(config["ports"][0], id="B"))
        runtime = load_runtime(config, catalog)
        builder = runtime["ChamberBuilder"].__new__(runtime["ChamberBuilder"])
        events = []
        combines = CombineRecorder(events)
        shell = SimpleNamespace(name="")
        builder.comp = SimpleNamespace(xYConstructionPlane="xy",
            features=SimpleNamespace(combineFeatures=combines),
            attributes=SimpleNamespace(add=lambda *args: None))
        builder.prefix = "VC1_"
        builder.warnings = []
        builder.opening_tools = []
        builder.parameter = lambda name, *args: name
        builder.flange_parameters = lambda stem, *args: {"thickness": stem + "Thickness"}
        builder.flange = lambda *args: None
        builder.offset = lambda *args: args[-1]
        builder.ring_sketch = lambda *args: ("sketch", "center", "profile", "circle")
        builder.direction_sign = lambda *args: 1
        builder.extrude = lambda *args: SimpleNamespace(bodies=SimpleNamespace(item=lambda index: shell))
        builder.collection = list
        # The two physical cutter bodies can have identical geometry. They remain
        # independently parameterized and enter the same Boolean operation.
        builder.build_port = lambda *args: builder.opening_tools.append(object())
        builder.build()
        self.assertEqual(len(combines.inputs), 1)
        cut = combines.inputs[0]
        self.assertIs(cut.target, shell)
        self.assertEqual(cut.operation, "cut")
        self.assertEqual(cut.tools, builder.opening_tools)
        self.assertEqual(len(cut.tools), 2)
        self.assertFalse(cut.isKeepToolBodies)

    def test_generated_artifact_compiles_and_embeds_canonical_mm(self):
        config, catalog = fixture()
        script = generate_script(config, catalog)
        compile(script, "generated_chamber.py", "exec")
        saved = embedded_config(script)
        self.assertEqual(saved["units"], "in")
        self.assertEqual(saved["body"]["height"], 508)
        self.assertEqual(saved["ports"][0]["focalLength"], 260)
        self.assertEqual(saved["ports"][0]["dimensions"]["od"], 69.85)

    def test_export_is_standalone_and_does_not_switch_design_mode(self):
        script = generate_script(*fixture())
        tree = ast.parse(script)
        imports = {alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names}
        self.assertEqual(imports, {"adsk.core", "adsk.fusion", "json", "math", "traceback"})
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                self.assertFalse(any(isinstance(t, ast.Attribute) and t.attr == "designType" for t in node.targets))
        self.assertIn("ParametricDesignType", script)
        self.assertNotIn("DirectDesignType", script)

    def test_quotes_newlines_and_code_in_notes_remain_data(self):
        config, catalog = fixture()
        text = "'); raise RuntimeError('injected')\n雪\\path\n__CHAMBER_PAYLOAD__"
        config["notes"] = text
        config["ports"][0]["id"] = text
        script = generate_script(config, catalog)
        compile(script, "generated_chamber.py", "exec")
        result = embedded_config(script)
        self.assertEqual(result["notes"], text)
        self.assertEqual(result["ports"][0]["id"], text)

    def test_inputs_are_not_mutated_and_overrides_are_preserved(self):
        config, catalog = fixture()
        config["ports"][0]["dimensions"] = {"thickness": 14.0, "sealDepth": 1.4}
        before = copy.deepcopy((config, catalog))
        resolved = prepare_export(config, catalog)
        self.assertEqual((config, catalog), before)
        self.assertEqual(resolved["ports"][0]["dimensions"]["thickness"], 14)
        self.assertEqual(resolved["ports"][0]["dimensions"]["sealDepth"], 1.4)

    def test_standard_end_bore_does_not_become_chamber_id(self):
        config, catalog = fixture()
        expected = config["body"]["topSpec"]["bore"]
        config["body"]["wall"] = 4.0
        result = prepare_export(config, catalog)
        self.assertEqual(result["body"]["topSpec"]["bore"], expected)

    def test_every_catalog_flange_generates(self):
        config, catalog = fixture()
        for flange in catalog["flanges"]:
            with self.subTest(flange=flange["id"]):
                config["ports"][0]["flange"] = flange["id"]
                compile(generate_script(config, catalog), "generated.py", "exec")

    def test_rotatable_cf_and_tapped_exports_keep_requested_details(self):
        config, catalog = fixture()
        config["ports"][0]["style"] = "rotatable-tapped"
        result = prepare_export(config, catalog)
        d = result["ports"][0]["dimensions"]
        self.assertLess(d["sealOuter"], d["hubOD"])
        self.assertLess(d["hubOD"], d["shoulderOD"])
        self.assertGreater(d["threadDiameter"], 0)
        self.assertTrue(any("rotatable" in w for w in result["exportWarnings"]))
        self.assertTrue(any("knife" in w for w in result["exportWarnings"]))

    def test_rejects_missing_flange_dimensions(self):
        config, catalog = fixture()
        del config["body"]["topSpec"]
        with self.assertRaisesRegex(ValueError, "topSpec"):
            generate_script(config, catalog)

    def test_rejects_non_finite_geometry_and_invalid_knife(self):
        for patch, expected in (({"focalLength": float("nan")}, "focal length"),
                                ({"beta": 0}, "beta"),
                                ({"dimensions": {"knifeHalfWidth": 100}}, "knife-edge root")):
            config, catalog = fixture()
            config["ports"][0].update(patch)
            with self.subTest(patch=patch), self.assertRaisesRegex(ValueError, expected):
                generate_script(config, catalog)

    def test_warnings_survive_offline_export(self):
        saved = embedded_config(generate_script(*fixture()))
        self.assertTrue(saved["exportWarnings"])
        self.assertTrue(any("provisional" in note for note in saved["exportWarnings"]))
        self.assertTrue(any("counterbores" in note for note in saved["exportWarnings"]))


if __name__ == "__main__":
    unittest.main()
