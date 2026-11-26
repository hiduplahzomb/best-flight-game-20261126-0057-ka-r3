// math3.js — small vector and matrix helpers for the Aurelia Wings renderer.
// Everything here is plain arrays: a vec3 is [x, y, z], a mat4 is a flat
// 16-number column-major array, the way WebGL expects it.

export function vec3(x = 0, y = 0, z = 0) {
  return [x, y, z];
}

export function vadd(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vsub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vscale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function vdot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vcross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vlength(a) {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}

export function vnorm(a) {
  const l = vlength(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

export function vlerp(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

// Heading in degrees (0 = north, -Z; 90 = east, +X) and pitch/roll in
// degrees turn into the three aircraft axes: forward, right and up.
export function axesFromEuler(headingDeg, pitchDeg, rollDeg) {
  const h = (headingDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const r = (rollDeg * Math.PI) / 180;
  const ch = Math.cos(h), sh = Math.sin(h);
  const cp = Math.cos(p), sp = Math.sin(p);
  const cr = Math.cos(r), sr = Math.sin(r);
  // Forward: heading around Y, then pitch up.
  const forward = [sh * cp, sp, -ch * cp];
  // Right: forward crossed with world up, then rolled around forward.
  const right0 = [ch, 0, sh];
  const up0 = vcross(right0, forward);
  const right = vadd(vscale(right0, cr), vscale(up0, sr));
  const up = vsub(vscale(up0, cr), vscale(right0, sr));
  return { forward: vnorm(forward), right: vnorm(right), up: vnorm(up) };
}

export function mat4Identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function mat4Multiply(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

export function mat4Perspective(fovDeg, aspect, near, far) {
  const f = 1 / Math.tan(((fovDeg * Math.PI) / 180) / 2);
  const nf = 1 / (near - far);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ];
}

export function mat4LookAt(eye, target, up) {
  const z = vnorm(vsub(eye, target));
  const x = vnorm(vcross(up, z));
  const y = vcross(z, x);
  return [
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -vdot(x, eye), -vdot(y, eye), -vdot(z, eye), 1,
  ];
}

// Build a model matrix from a position and the aircraft axes.
export function mat4FromAxes(pos, right, up, forward) {
  return [
    right[0], up[0], -forward[0], 0,
    right[1], up[1], -forward[1], 0,
    right[2], up[2], -forward[2], 0,
    pos[0], pos[1], pos[2], 1,
  ];
}

export function mat4Translate(x, y, z) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

export function mat4Scale(x, y, z) {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
}

export function mat4RotateY(angleRad) {
  const c = Math.cos(angleRad), s = Math.sin(angleRad);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

export function mat4RotateX(angleRad) {
  const c = Math.cos(angleRad), s = Math.sin(angleRad);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}

export function mat4RotateZ(angleRad) {
  const c = Math.cos(angleRad), s = Math.sin(angleRad);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

// Deterministic pseudo-random generator so the world looks the same
// every run (and every screenshot) for a given seed.
export function makeRng(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export function angleWrapDeg(a) {
  let v = a % 360;
  if (v > 180) v -= 360;
  if (v < -180) v += 360;
  return v;
}
