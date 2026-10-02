"""The subset of manifold3d used by chamber.py, backed by official Manifold WASM.

The worker registers ``_manifold_bridge`` before importing this module and
releases its tracked WASM objects after each request, including failed requests.
This adapter deliberately contains no chamber geometry or validation rules.
"""
from types import SimpleNamespace

import numpy as np
from pyodide.ffi import to_js
import _manifold_bridge as _bridge


class OpType:
    Add = "add"


class CrossSection:
    def __init__(self, contours):
        self._shape = _bridge.crossSection(to_js(contours))


class Manifold:
    def __init__(self, shape):
        self._shape = shape

    @staticmethod
    def cylinder(height, radius, circular_segments=0):
        return Manifold(_bridge.cylinder(height, radius, circular_segments))

    @staticmethod
    def revolve(section, circular_segments=0):
        return Manifold(_bridge.revolve(section._shape, circular_segments))

    @staticmethod
    def batch_boolean(shapes, operation):
        if operation != OpType.Add:
            raise ValueError("Unsupported browser Manifold batch operation")
        return Manifold(_bridge.union(to_js([shape._shape for shape in shapes])))

    def translate(self, vector):
        return Manifold(_bridge.translate(self._shape, to_js(vector)))

    def rotate(self, vector):
        return Manifold(_bridge.rotate(self._shape, to_js(vector)))

    def __sub__(self, other):
        return Manifold(_bridge.subtract(self._shape, other._shape))

    def __add__(self, other):
        return Manifold(_bridge.add(self._shape, other._shape))

    def __xor__(self, other):
        return Manifold(_bridge.intersect(self._shape, other._shape))

    def bounding_box(self):
        return _bridge.bounds(self._shape).to_py()

    def volume(self):
        return self._shape.volume()

    def is_empty(self):
        return self._shape.isEmpty()

    def to_mesh(self):
        mesh = self._shape.getMesh()
        # Copy the typed arrays before the worker releases the WASM shapes.
        return SimpleNamespace(
            vert_properties=np.asarray(mesh.vertProperties.to_py()).reshape(-1, mesh.numProp),
            tri_verts=np.asarray(mesh.triVerts.to_py()).reshape(-1, 3),
        )
