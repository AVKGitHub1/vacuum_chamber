// Keep the canonical Python geometry and the browser on the same Manifold engine.
// WASM objects need explicit deletion; release all intermediates per request.
export function createManifoldBridge(wasm) {
  const objects = [];
  const track = object => { objects.push(object); return object; };
  return {
    cylinder: (height, radius, segments) => track(wasm.Manifold.cylinder(height, radius, radius, segments)),
    crossSection: contours => track(new wasm.CrossSection(contours)),
    revolve: (section, segments) => track(section.revolve(segments)),
    union: shapes => track(wasm.Manifold.union(shapes)),
    translate: (shape, vector) => track(shape.translate(vector)),
    rotate: (shape, vector) => track(shape.rotate(vector)),
    subtract: (first, second) => track(first.subtract(second)),
    add: (first, second) => track(first.add(second)),
    intersect: (first, second) => track(first.intersect(second)),
    bounds: shape => {
      const box = shape.boundingBox();
      return [...box.min, ...box.max];
    },
    releaseAll() {
      // Reverse construction order also frees results before their inputs.
      while (objects.length) objects.pop().delete();
    },
    get liveObjects() { return objects.length; },
  };
}
