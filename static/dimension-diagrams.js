// Illustrative engineering diagrams. Dimensions follow the geometry model;
// proportions are deliberately fixed so even small features remain legible.
const INK = '#617987';
const FILL = '#e1ebef';
const ACCENT = '#087e78';

function text(x, y, value, extra = '') {
  return `<text x="${x}" y="${y}" ${extra}>${value}</text>`;
}
function line(x1, y1, x2, y2, extra = '') {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${extra}/>`;
}
function circle(cx, cy, r, extra = '') {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" ${extra}/>`;
}
function construction(x1, y1, x2, y2) {
  return line(x1, y1, x2, y2, 'stroke="#9fb3bc" stroke-dasharray="4 4"');
}
function extension(x1, y1, x2, y2) {
  return line(x1, y1, x2, y2, 'stroke="#77aaa7" stroke-width="1"');
}
function dimension(key, x1, y1, x2, y2) {
  return line(x1, y1, x2, y2, `stroke="${ACCENT}" stroke-width="1.6" marker-start="url(#dim-${key}-arrow)" marker-end="url(#dim-${key}-arrow)"`);
}
function label(x, y, value, extra = '') {
  return text(x, y, value, `fill="${ACCENT}" font-weight="650" ${extra}`);
}
function wrap(key, title, contents) {
  return `<svg class="dimension-schematic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" role="img" aria-labelledby="dim-${key}-title">
    <title id="dim-${key}-title">${title}</title>
    <defs><marker id="dim-${key}-arrow" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M8 4 0 0 0 8Z" fill="${ACCENT}"/></marker></defs>
    <style>.dimension-schematic text{font-family:system-ui,sans-serif;font-size:11px;stroke:#f8fbfc;stroke-width:3px;stroke-linejoin:round;paint-order:stroke;fill:#496371;text-anchor:middle}.dimension-schematic text[fill="${ACCENT}"]{fill:${ACCENT}}</style>
    <rect width="320" height="200" rx="10" fill="#f8fbfc"/>
    <g stroke="${INK}" stroke-width="1.35" stroke-linejoin="round" fill="none">${contents}</g>
  </svg>`;
}

function annulus(key, {wall = false, tube = false} = {}) {
  const cx = 154, cy = 98, outer = 65, inner = wall ? 48 : 53;
  let content = circle(cx, cy, outer, `fill="${FILL}"`) + circle(cx, cy, inner, 'fill="#f8fbfc"');
  content += construction(cx - 82, cy, cx + 87, cy) + construction(cx, 17, cx, 177);
  if (wall) {
    content += circle(cx, cy, inner, `stroke="${ACCENT}"`) + circle(cx, cy, outer, `stroke="${ACCENT}"`);
    content += dimension(key, cx + inner, cy, cx + outer, cy);
    content += extension(cx + inner, cy - 5, cx + inner, 60) + extension(cx + outer, cy - 5, cx + outer, 60);
    content += label(239, 49, 'Wall') + line(230, 54, 212, 68, `stroke="${ACCENT}"`);
    content += text(cx, 187, tube ? 'Tube wall, one side' : 'Chamber wall, one side');
  } else {
    content += dimension(key, cx - outer, cy, cx + outer, cy);
    content += label(cx, cy - 11, tube ? 'Tube OD' : 'Body OD');
    content += text(cx, 187, 'Outside diameter · through center');
  }
  return content;
}

function chamberSection(cx = 160, top = 34, bottom = 172) {
  // A longitudinal section has open bores at both end flanges.
  return `<path d="M${cx - 65} ${top}h23v17h-8v${bottom - top - 34}h8v17h-23v-17h8V${top + 17}h-8Z M${cx + 65} ${top}h-23v17h8v${bottom - top - 34}h-8v17h23v-17h-8V${top + 17}h8Z" fill="${FILL}"/>`
    + construction(cx, top - 12, cx, bottom + 10);
}

function bodyHeight(key) {
  return chamberSection()
    + extension(89, 34, 55, 34) + extension(89, 172, 55, 172)
    + dimension(key, 61, 34, 61, 172)
    + label(42, 103, 'Overall height', 'transform="rotate(-90 42 103)"')
    + text(171, 103, 'Open bore')
    + text(160, 192, 'Between outside end faces');
}

function portSide(cx = 145, cy = 117) {
  return `<g transform="translate(${cx} ${cy}) rotate(-20)">
    <path d="M53 -12H115V-24H127V24H115V12H53V5H127V-5H53Z" fill="${FILL}"/>
    ${construction(-8, 0, 148, 0)}
  </g>` + circle(cx, cy, 3, `fill="${ACCENT}" stroke="${ACCENT}"`);
}

function elevation(key) {
  return chamberSection(145) + portSide()
    + extension(145, 117, 45, 117) + extension(80, 172, 45, 172)
    + dimension(key, 51, 117, 51, 172)
    + label(31, 145, 'Elevation', 'transform="rotate(-90 31 145)"')
    + text(157, 142, 'Focus on axis')
    + line(150, 133, 146, 122)
    + text(157, 192, 'Bottom outside face = Z 0');
}

function focalLength(key) {
  return chamberSection(190, 30, 174)
    + `<g transform="translate(190 125) rotate(200)">
      <path d="M53 -12H115V-24H127V24H115V12H53V5H127V-5H53Z" fill="${FILL}"/>
      ${construction(-8, 0, 148, 0)}
      ${extension(0, 5, 0, 48)}${extension(127, 25, 127, 48)}
      ${dimension(key, 0, 41, 127, 41)}
    </g>`
    + circle(190, 125, 3, `fill="${ACCENT}" stroke="${ACCENT}"`)
    + label(148, 53, 'Focal length', 'transform="rotate(20 148 53)"')
    + text(196, 151, 'Focus on axis') + line(191, 140, 190, 131)
    + text(55, 132, 'Outer face') + line(61, 120, 70, 85)
    + text(160, 193, 'Measured along the port axis');
}

function alpha(key) {
  return circle(134, 112, 58, `fill="${FILL}"`)
    + circle(134, 112, 50, 'fill="#f8fbfc"')
    + construction(62, 112, 282, 112) + construction(134, 181, 134, 21)
    + `<g transform="translate(134 112) rotate(-35)"><path d="M55 -9H111V-20H123V20H111V9H55V4H123V-4H55Z" fill="${FILL}"/>${construction(0, 0, 143, 0)}</g>`
    + line(134, 112, 276, 112)
    + `<path d="M176 112A42 42 0 0 0 168.4 87.9" stroke="${ACCENT}" stroke-width="1.8" marker-end="url(#dim-${key}-arrow)"/>`
    + circle(134, 112, 3, `fill="${ACCENT}" stroke="${ACCENT}"`)
    + label(192, 95, 'α') + text(284, 129, '+X') + text(119, 23, '+Y')
    + text(160, 191, 'Anticlockwise from +X · Z out of page');
}

function beta(key) {
  return chamberSection(124, 38, 172)
    + `<g transform="translate(124 133) rotate(-30)"><path d="M53 -9H111V-20H123V20H111V9H53V4H123V-4H53Z" fill="${FILL}"/>${construction(0, 0, 150, 0)}</g>`
    + line(124, 133, 124, 20) + construction(124, 133, 286, 133)
    + `<path d="M124 88A45 45 0 0 1 163 110.5" stroke="${ACCENT}" stroke-width="1.8" marker-end="url(#dim-${key}-arrow)"/>`
    + circle(124, 133, 3, `fill="${ACCENT}" stroke="${ACCENT}"`)
    + label(148, 86, 'β') + text(107, 21, '+Z') + text(276, 151, 'Radial')
    + text(167, 191, 'From +Z · 90° is horizontal');
}

function flangeFace({cx = 160, cy = 99, radius = 72, holes = false} = {}) {
  const scale = radius / 72;
  let result = circle(cx, cy, radius, `fill="${FILL}"`)
    + circle(cx, cy, 49 * scale, 'fill="#d1e0e7"')
    + circle(cx, cy, 39 * scale, `fill="${FILL}"`)
    + circle(cx, cy, 27 * scale, 'fill="#f8fbfc"')
    + circle(cx, cy, 60 * scale, 'stroke="#9fb3bc" stroke-dasharray="4 4"')
    + construction(cx - radius - 13, cy, cx + radius + 13, cy)
    + construction(cx, cy - radius - 13, cx, cy + radius + 13);
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    result += circle(cx + Math.cos(angle) * 60 * scale, cy + Math.sin(angle) * 60 * scale, 4.5 * scale,
      holes ? `fill="#b7e1dc" stroke="${ACCENT}" stroke-width="1.7"` : 'fill="#f8fbfc"');
  }
  return result;
}

function flangeDiameter(key, radius, title) {
  return flangeFace()
    + circle(160, 99, radius, `stroke="${ACCENT}" stroke-width="2" ${key === 'boltCircle' ? 'stroke-dasharray="5 3"' : ''}`)
    + dimension(key, 160 - radius, 99, 160 + radius, 99)
    + label(160, 87, title)
    + text(160, 190, key === 'boltCircle' ? 'Circle through bolt-hole centers' : key === 'knifeEdgeDiameter' ? 'Circle through the knife-edge tips' : 'Diameter · through flange center');
}

function holeDiameter(key) {
  return flangeFace({cx: 102, cy: 99, radius: 63})
    + circle(154.5, 99, 5, `stroke="${ACCENT}" stroke-width="2"`)
    + extension(158, 95, 226, 71) + extension(158, 103, 226, 127)
    + circle(251, 99, 31, `fill="${FILL}"`)
    + circle(251, 99, 23, 'fill="#f8fbfc"')
    + dimension(key, 228, 99, 274, 99)
    + label(251, 51, 'Hole Ø')
    + text(251, 147, 'Enlarged') + text(160, 190, 'Diameter of one bolt hole');
}

function holeCount() {
  return flangeFace({holes: true})
    + line(225, 99, 259, 99, `stroke="${ACCENT}"`)
    + label(279, 103, '8 ×')
    + text(160, 190, 'Count all bolt holes · 8 shown');
}

function flangeThickness(key) {
  return `<path d="M74 65H132V132H112V166H102V132H74Z M246 65H188V132H208V166H218V132H246Z" fill="${FILL}"/>`
    + construction(160, 33, 160, 176)
    + extension(68, 65, 41, 65) + extension(68, 132, 41, 132)
    + dimension(key, 47, 65, 47, 132)
    + label(27, 99, 'Thickness', 'transform="rotate(-90 27 99)"')
    + text(246, 48, 'Front face') + text(264, 152, 'Rear face')
    + line(262, 143, 243, 132)
    + text(160, 191, 'Axial thickness of the flange');
}

function sealSection(key) {
  const knife = key !== 'sealDepth';
  let result = `<path d="M36 54H70V135H117${knife ? 'L154 84H158L195 135' : 'H195'}H248V54H282V164H36Z" fill="${FILL}"/>`
    + construction(70, 54, 248, 54)
    + text(159, 29, 'Nominal front face');
  if (key === 'sealDepth') {
    result += extension(283, 54, 298, 54) + extension(249, 135, 298, 135)
      + dimension(key, 291, 54, 291, 135)
      + label(311, 95, 'Depth', 'transform="rotate(-90 311 95)"')
      + text(156, 191, 'Front face to recess floor');
  } else if (key === 'knifeTipSetback') {
    result += extension(160, 84, 231, 84)
      + dimension(key, 222, 54, 222, 84)
      + label(222, 110, 'Setback')
      + text(156, 191, 'Front face to knife tip');
  } else {
    result += construction(156, 67, 156, 176)
      + extension(195, 135, 195, 179)
      + dimension(key, 156, 173, 195, 173)
      + label(181, 192, 'Half-width')
      + text(94, 106, 'Root') + line(106, 111, 121, 135);
  }
  return result;
}

const definitions = {
  'body.od': {
    title: 'Chamber body outside diameter', view: 'Chamber cross-section',
    description: 'The outside diameter of the cylindrical chamber body, measured through its center. The end flanges extend beyond it.',
    draw: key => annulus(key),
  },
  'body.height': {
    title: 'Chamber overall height', view: 'Longitudinal section',
    description: 'The axial distance between the outside faces of the bottom and top end flanges. Both flange thicknesses are included.',
    draw: bodyHeight,
  },
  'body.wall': {
    title: 'Chamber wall thickness', view: 'Chamber cross-section',
    description: 'The radial thickness of one chamber wall. The inside diameter equals the body OD minus twice this thickness.',
    draw: key => annulus(key, {wall: true}),
  },
  elevation: {
    title: 'Focal point elevation', view: 'Chamber side section',
    description: 'The height of the port axis origin on the chamber centerline, measured from the bottom outside end face. A tilted flange center can be at a different height.',
    draw: elevation,
  },
  focalLength: {
    title: 'Port focal length', view: 'Chamber side section',
    description: 'The distance from the radial port’s outer flange face to the main chamber centerline, measured along the port axis. The focal point is on that centerline at the selected elevation.',
    draw: focalLength,
  },
  alpha: {
    title: 'Alpha · rotation around the chamber', view: 'Top view · +Z toward you',
    description: 'The port direction measured anticlockwise from +X in the XY plane, viewed from above with +Z pointing toward you. 0° is +X; 90° is +Y.',
    draw: alpha,
  },
  beta: {
    title: 'Beta · port inclination', view: 'Side view in the port plane',
    description: 'The port angle from the upward +Z axis. 90° is horizontal; smaller angles point upward and larger angles point downward.',
    draw: beta,
  },
  od: {
    title: 'Flange outside diameter', view: 'Flange face view',
    description: 'The full outside diameter of the flange disk, measured across its center.',
    draw: key => flangeDiameter(key, 72, 'Flange OD'),
  },
  bore: {
    title: 'Flange bore diameter', view: 'Flange face view',
    description: 'The diameter of the clear central opening through the flange. This is a diameter, not a radius.',
    draw: key => flangeDiameter(key, 27, 'Bore Ø'),
  },
  thickness: {
    title: 'Flange thickness', view: 'Flange axial section',
    description: 'The axial distance from the flange rear face to its nominal front face. The sealing recess is cut into this thickness.',
    draw: flangeThickness,
  },
  boltCircle: {
    title: 'Bolt-circle diameter', view: 'Flange face view',
    description: 'The diameter of the circle passing through the centers of all bolt holes. It does not measure across the outside edges of the holes.',
    draw: key => flangeDiameter(key, 60, 'Bolt circle Ø'),
  },
  holeDiameter: {
    title: 'Bolt-hole diameter', view: 'Flange face with enlarged hole',
    description: 'The diameter of one through bolt hole. On tapped CF flanges, the nominal thread diameter is used for the modeled hole instead.',
    draw: holeDiameter,
  },
  holeCount: {
    title: 'Bolt-hole count', view: 'Flange face view',
    description: 'The total number of bolt holes, equally spaced around the bolt circle. The illustration shows eight holes as an example.',
    draw: holeCount,
  },
  sealInner: {
    title: 'Seal recess inner diameter', view: 'Flange face view',
    description: 'The diameter of the inner boundary of the annular sealing recess, measured through the flange center.',
    draw: key => flangeDiameter(key, 39, 'Seal inner Ø'),
  },
  sealOuter: {
    title: 'Seal recess outer diameter', view: 'Flange face view',
    description: 'The diameter of the outer boundary of the annular sealing recess, measured through the flange center.',
    draw: key => flangeDiameter(key, 49, 'Seal outer Ø'),
  },
  sealDepth: {
    title: 'Sealing recess depth', view: 'Enlarged radial section',
    description: 'The axial depth from the nominal flange front face to the bottom of the sealing recess. A CF knife ridge rises from this floor.',
    draw: sealSection,
  },
  tubeOD: {
    title: 'Port tube outside diameter', view: 'Tube cross-section',
    description: 'The outside diameter of the port tube, measured across its center. This is separate from the flange outside diameter.',
    draw: key => annulus(key, {tube: true}),
  },
  tubeWall: {
    title: 'Port tube wall thickness', view: 'Tube cross-section',
    description: 'The radial thickness of one tube wall. The tube inside diameter equals the tube OD minus twice this thickness.',
    draw: key => annulus(key, {wall: true, tube: true}),
  },
  knifeEdgeDiameter: {
    title: 'CF knife-edge circle diameter', view: 'CF flange face view',
    description: 'The diameter of the circular knife-edge tip around the bore. It is measured through the flange center, not across the width of the ridge.',
    draw: key => flangeDiameter(key, 44, 'Knife circle Ø'),
  },
  knifeTipSetback: {
    title: 'CF knife-tip setback', view: 'Enlarged CF radial section',
    description: 'The axial distance from the nominal front face down to the knife tip. The tip is below the front face and above the recess floor.',
    draw: sealSection,
  },
  knifeHalfWidth: {
    title: 'CF knife-root half-width', view: 'Enlarged CF radial section',
    description: 'The radial distance from the knife ridge centerline to one edge of its root at the recess floor. The full root width is twice this value.',
    draw: sealSection,
  },
};

export const dimensionHelpKeys = Object.freeze(Object.keys(definitions));
const profileKeys = new Set(['od', 'bore', 'thickness', 'boltCircle', 'holeDiameter', 'holeCount', 'sealInner', 'sealOuter', 'sealDepth', 'tubeOD', 'tubeWall', 'knifeEdgeDiameter', 'knifeTipSetback', 'knifeHalfWidth']);

/** Resolve only recognized numeric form paths; unknown controls have no help. */
export function getDimensionHelp(path) {
  if (typeof path !== 'string') return undefined;
  let key;
  if (/^body\.(od|height|wall)$/.test(path)) key = path;
  else if (/^ports\.\d+\.(elevation|focalLength|alpha|beta)$/.test(path)) key = path.split('.').at(-1);
  else if (/^(?:body\.(?:topSpec|bottomSpec)|ports\.\d+\.dimensions)\.[A-Za-z]+$/.test(path)) {
    const candidate = path.split('.').at(-1);
    if (profileKeys.has(candidate)) key = candidate;
  }
  if (!Object.hasOwn(definitions, key)) return undefined;
  const help = definitions[key];
  const svgKey = key.replaceAll('.', '-');
  return {key, title: help.title, description: help.description, view: help.view, svg: wrap(svgKey, help.title, help.draw(svgKey))};
}
