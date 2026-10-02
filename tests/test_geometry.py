"""Interference/regression tests use real manifold booleans, not collision mocks."""

import math
import unittest
from copy import deepcopy

import manifold3d as mf

from chamber import evaluate, flange_solid, port_direction, resolve_config, solid_intersection, validate_config


CATALOG = {"flanges": [{"id": "CF40", "label": "CF40", "family": "CF", "od": 70.0,
    "bore": 36.0, "tubeOD": 38.0, "tubeWall": 2.0, "thickness": 13.0,
    "boltCircle": 58.7, "holeDiameter": 6.5, "holeCount": 6,
    "sealInner": 36.0, "sealOuter": 47.0, "sealDepth": 1.2,
    "knifeEdgeDiameter": 41.9, "knifeHalfWidth": 0.5, "knifeTipSetback": 0.6,
    "threadDiameter": 6.35, "threadPitch": 1.27, "verified": True}]}


def configuration():
    end = {"od": 450, "thickness": 22, "bore": 394.4,
           "boltCircle": 428, "holeDiameter": 10, "holeCount": 16,
           "sealInner": 395, "sealOuter": 405, "sealDepth": 2}
    return {"schemaVersion": 1, "units": "mm", "body": {
        "od": 406.4, "height": 508.0, "wall": 6.0, "top": "ISO-F", "bottom": "ISO-F",
        "topSpec": deepcopy(end), "bottomSpec": deepcopy(end)}, "ports": [port("A")], "notes": ""}


def port(identity, alpha=0, beta=90, elevation=254, length=270):
    return {"id": identity, "flange": "CF40", "style": "fixed-through", "elevation": elevation,
            "focalLength": length, "alpha": alpha, "beta": beta, "notes": ""}


class ChamberTests(unittest.TestCase):
    def test_direction_definition(self):
        d = port_direction(port("A", 90, 45))
        self.assertAlmostEqual(d[0], 0)
        self.assertAlmostEqual(d[1], math.sqrt(0.5))
        self.assertAlmostEqual(d[2], math.sqrt(0.5))

    def test_single_port_has_no_self_collisions_and_meshes_are_finite(self):
        result = evaluate(configuration(), CATALOG)
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["collisions"], [])
        self.assertEqual(len(result["meshes"]), 5)
        for mesh in result["meshes"]:
            self.assertTrue(mesh["indices"])
            self.assertTrue(all(math.isfinite(x) for x in mesh["positions"]))
            self.assertFalse(mesh["collision"])

    def test_identical_ports_collide_and_only_port_parts_turn_red(self):
        config = configuration()
        config["ports"].append(port("B"))
        result = evaluate(config, CATALOG)
        self.assertEqual(result["errors"], [])
        self.assertTrue(any(c["parts"] == ["tube", "tube"] for c in result["collisions"]))
        self.assertTrue(any(c["parts"] == ["flange", "flange"] for c in result["collisions"]))
        self.assertTrue(all(m["collision"] == (m["portId"] is not None) for m in result["meshes"]))

    def test_opposite_ports_do_not_collide_through_chamber_cavity(self):
        config = configuration()
        config["ports"].append(port("B", alpha=180))
        result = evaluate(config, CATALOG, include_mesh=False)
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["collisions"], [])

    def test_disjoint_ports_at_different_elevations_do_not_collide(self):
        config = configuration()
        config["ports"].append(port("B", elevation=354))
        result = evaluate(config, CATALOG, include_mesh=False)
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["collisions"], [])

    def test_converging_tilted_tubes_detect_interference(self):
        config = configuration()
        config["ports"] = [port("A", beta=80, elevation=200, length=330),
                           port("B", beta=100, elevation=305.8, length=330)]
        result = evaluate(config, CATALOG, include_mesh=False)
        self.assertEqual(result["errors"], [])
        self.assertTrue(any(c["parts"] == ["tube", "tube"] for c in result["collisions"]))

    def test_hollow_annulus_does_not_collide_with_object_inside_bore(self):
        annulus = mf.Manifold.cylinder(20, 20, circular_segments=96) - mf.Manifold.cylinder(22, 15, circular_segments=96).translate([0, 0, -1])
        inside = mf.Manifold.cylinder(10, 10, circular_segments=96).translate([0, 0, 5])
        self.assertEqual(solid_intersection(annulus, inside), (0.0, None))
        touching = mf.Manifold.cylinder(10, 15, circular_segments=96).translate([0, 0, 5])
        self.assertEqual(solid_intersection(annulus, touching), (0.0, None))

    def test_collisions_do_not_create_validation_errors(self):
        config = configuration()
        config["ports"].append(port("B", alpha=5))
        result = evaluate(config, CATALOG, include_mesh=False)
        self.assertTrue(result["collisions"])
        self.assertFalse(result["errors"])
        self.assertTrue(any("Export remains available" in w for w in result["warnings"]))

    def test_inch_display_does_not_rescale_canonical_mm(self):
        config = configuration()
        config["units"] = "in"
        config["body"]["height"] = 914.4
        self.assertEqual(validate_config(config, CATALOG)["errors"], [])
        config["body"]["height"] += 0.01
        self.assertTrue(any(e["path"] == "body.height" for e in validate_config(config, CATALOG)["errors"]))

    def test_invalid_port_is_skipped_without_dropping_good_geometry(self):
        config = configuration()
        config["ports"].append(port("B", beta=float("nan")))
        result = evaluate(config, CATALOG)
        self.assertTrue(any(e["path"] == "ports.1.beta" for e in result["errors"]))
        self.assertEqual(result["metrics"]["portCount"], 1)

    def test_invalid_wall_returns_errors_before_boolean(self):
        config = configuration()
        config["body"]["wall"] = config["body"]["od"]
        result = evaluate(config, CATALOG)
        self.assertTrue(result["errors"])
        self.assertFalse(result["meshes"])

    def test_too_short_port_or_end_crossing_is_rejected(self):
        config = configuration()
        config["ports"][0]["focalLength"] = 150
        self.assertTrue(any(e["path"] == "ports.0.focalLength" for e in evaluate(config, CATALOG)["errors"]))
        config["ports"] = [port("A", elevation=25)]
        self.assertTrue(any(e["path"] == "ports.0.elevation" for e in evaluate(config, CATALOG)["errors"]))

    def test_resolve_overrides_and_no_input_mutation(self):
        config = configuration()
        config["ports"][0]["dimensions"] = {"thickness": 15}
        result = resolve_config(config, CATALOG)
        self.assertEqual(result["ports"][0]["dimensions"]["thickness"], 15)
        self.assertEqual(result["ports"][0]["dimensions"]["tubeOD"], 38)
        self.assertEqual(config["ports"][0]["dimensions"], {"thickness": 15})

    def test_flange_seal_and_bolt_holes_remove_material(self):
        dims = CATALOG["flanges"][0]
        detailed = flange_solid(dims, "CF")
        plain = flange_solid({**dims, "holeCount": 0, "sealDepth": 0}, "CF")
        self.assertGreater(plain.volume(), detailed.volume())
        self.assertGreater(detailed.volume(), 0)

    def test_disconnected_tube_flange_overrides_are_rejected(self):
        for overrides, key in [({"tubeOD": 80}, "tubeOD"), ({"bore": 38}, "bore")]:
            with self.subTest(overrides=overrides):
                config = configuration()
                config["ports"][0]["dimensions"] = overrides
                result = evaluate(config, CATALOG, include_mesh=False)
                self.assertTrue(any(e["path"] == "ports.0.dimensions." + key for e in result["errors"]))
                self.assertEqual(result["metrics"]["portCount"], 0)

    def test_end_bore_cannot_disconnect_end_from_shell(self):
        config = configuration()
        config["body"]["topSpec"]["bore"] = config["body"]["od"]
        result = evaluate(config, CATALOG)
        self.assertTrue(any(e["path"] == "body.topSpec.bore" for e in result["errors"]))
        self.assertFalse(result["meshes"])

    def test_bolt_holes_cannot_break_through_bore_or_seal(self):
        for overrides, key in [({"boltCircle": 40}, "boltCircle"), ({"sealOuter": 55}, "sealOuter")]:
            with self.subTest(overrides=overrides):
                config = configuration()
                config["ports"][0]["dimensions"] = overrides
                errors = validate_config(config, CATALOG)["errors"]
                self.assertTrue(any(e["path"] == "ports.0.dimensions." + key for e in errors))

    def test_invalid_knife_profiles_are_rejected_before_boolean(self):
        for overrides, key in [({"knifeHalfWidth": 10}, "knifeHalfWidth"),
                               ({"knifeTipWidth": 1.2}, "knifeTipWidth"),
                               ({"knifeTipSetback": 2}, "knifeTipSetback"),
                               ({"knifeEdgeDiameter": -1}, "knifeEdgeDiameter"),
                               ({"knifeHalfWidth": float("nan")}, "knifeHalfWidth")]:
            with self.subTest(overrides=overrides):
                config = configuration()
                config["ports"][0]["dimensions"] = overrides
                result = evaluate(config, CATALOG)
                self.assertTrue(any(e["path"] == "ports.0.dimensions." + key for e in result["errors"]))
                self.assertFalse(any(m["portId"] is not None for m in result["meshes"]))


if __name__ == "__main__":
    unittest.main()
