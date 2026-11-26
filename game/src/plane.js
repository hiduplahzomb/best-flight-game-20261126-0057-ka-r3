// plane.js — the Aurelia twin-prop: a bright white fuselage with an
// orange-red cheatline, built from boxes, cones and cylinders, plus
// spinning propellers, navigation lights and fading wingtip trails.
//
// Model space follows the renderer's convention: the nose points toward
// model -Z (forward), the tail toward +Z, wings span X, up is +Y.

import { MeshBuilder, DynamicMesh } from './renderer.js';
import {
  mat4Identity, mat4Multiply, mat4RotateX, mat4RotateY, mat4RotateZ,
  mat4Translate, mat4FromAxes, vadd, vscale,
} from './math3.js';

const WHITE = [0.94, 0.93, 0.90];
const ORANGE = [0.95, 0.38, 0.12];
const RED = [0.85, 0.16, 0.12];
const DARK = [0.16, 0.17, 0.20];
const GLASS = [0.10, 0.28, 0.45];
const GREY = [0.55, 0.57, 0.60];

export function buildPlaneMeshes(gl) {
  const b = new MeshBuilder();
  const mI = mat4Identity();
  // Fuselage: nose, cabin and tapered tail, nose toward -Z.
  b.addBox([0, 0, -2.2], [1.7, 1.7, 3.4], mI, WHITE);          // nose
  b.addBox([0, 0, 0.6], [2.0, 2.0, 3.6], mI, WHITE);           // cabin
  b.addBox([0, 0.25, 3.4], [1.5, 1.5, 3.2], mI, WHITE);        // rear
  b.addCone([0, 0.35, 6.4], 0.85, 3.4, 6, WHITE,
    mat4RotateX(Math.PI / 2));                                   // tail cone
  // Orange cheatline along the fuselage sides.
  b.addBox([0, -0.15, -0.4], [2.06, 0.42, 6.4], mI, ORANGE);
  b.addBox([0, -0.15, 3.4], [1.56, 0.38, 3.0], mI, ORANGE);
  // Cockpit windows and side windows.
  b.addBox([0, 0.55, -2.6], [1.3, 0.62, 1.4], mI, GLASS);
  b.addBox([-1.02, 0.35, -0.6], [0.08, 0.5, 1.6], mI, GLASS);
  b.addBox([1.02, 0.35, -0.6], [0.08, 0.5, 1.6], mI, GLASS);
  // Main wing: long, slightly swept, orange tips.
  b.addBox([0, 0.15, -0.4], [15.5, 0.34, 2.6], mI, WHITE);
  b.addBox([-7.1, 0.15, -0.4], [1.6, 0.36, 2.6], mI, ORANGE);
  b.addBox([7.1, 0.15, -0.4], [1.6, 0.36, 2.6], mI, ORANGE);
  // Tailplane and fin.
  b.addBox([0, 0.55, 5.4], [5.6, 0.26, 1.7], mI, WHITE);
  b.addBox([-2.5, 0.55, 5.4], [0.8, 0.28, 1.7], mI, ORANGE);
  b.addBox([2.5, 0.55, 5.4], [0.8, 0.28, 1.7], mI, ORANGE);
  b.addBox([0, 1.45, 5.5], [0.28, 2.2, 2.0], mI, ORANGE);
  // Engine nacelles under the wings.
  for (const s of [-1, 1]) {
    b.addCylinder([s * 3.4, -0.35, -0.9], 0.85, 0.95, 3.4, 8, GREY,
      mat4RotateX(Math.PI / 2));
    b.addBox([s * 3.4, -0.35, 0.9], [1.5, 1.5, 1.2], mI, [0.45, 0.47, 0.50]);
  }
  // Fixed STOL gear: struts and wheels.
  for (const s of [-1, 1]) {
    b.addCylinder([s * 1.1, -1.5, -1.2], 0.12, 0.12, 1.4, 5, DARK);
    b.addCylinder([s * 1.1, -2.15, -1.2], 0.55, 0.55, 0.35, 8, [0.08, 0.08, 0.09],
      mat4RotateZ(Math.PI / 2));
    b.addCylinder([0, -1.9, 4.6], 0.1, 0.1, 1.6, 5, DARK);
    b.addCylinder([0, -2.6, 4.6], 0.42, 0.42, 0.3, 8, [0.08, 0.08, 0.09],
      mat4RotateZ(Math.PI / 2));
  }
  // Belly antenna and pitot.
  b.addCylinder([0, -1.05, 1.5], 0.06, 0.1, 0.7, 5, DARK);
  b.addCylinder([0.9, 0.1, -4.0], 0.05, 0.05, 0.9, 5, DARK,
    mat4RotateX(Math.PI / 2));

  // Propeller blades (two per engine, spun in main.js) and blur discs.
  // Thin and mid-grey: a spinning prop reads as a blur, not a black cross.
  const prop = new MeshBuilder();
  for (const s of [-1, 1]) {
    prop.addBox([s * 3.4, 0, 0], [0.22, 4.4, 0.12], mI, [0.38, 0.38, 0.42]);
    prop.addBox([s * 3.4, 0, 0], [4.4, 0.22, 0.12], mI, [0.38, 0.38, 0.42]);
    prop.addSphere([s * 3.4, 0, 0], 0.4, GREY, 8, 5);
  }
  const disc = new MeshBuilder();
  for (const s of [-1, 1]) {
    // A flat disc facing forward: built as a many-sided cylinder squashed thin.
    disc.addCylinder([s * 3.4, 0, 0], 2.3, 2.3, 0.06, 20, [0.75, 0.75, 0.78],
      mat4RotateX(Math.PI / 2));
  }

  // Navigation lights: red on the left tip, green on the right.
  const nav = new MeshBuilder();
  nav.addSphere([-7.9, 0.15, -0.4], 0.28, [1, 0.1, 0.1], 6, 4);
  nav.addSphere([7.9, 0.15, -0.4], 0.28, [0.15, 1, 0.3], 6, 4);
  nav.addSphere([0, 0.9, 6.9], 0.22, [1, 1, 1], 6, 4);

  return {
    body: b.build(gl),
    prop: prop.build(gl),
    disc: disc.build(gl),
    nav: nav.build(gl),
    trails: new DynamicMesh(gl, 512),
  };
}

// Model matrix for the whole aircraft from its flight state.
export function planeModelMatrix(state) {
  const { forward, right, up } = state.axes;
  return mat4FromAxes(state.pos, right, up, forward);
}

// Propellers sit ahead of the nacelles and spin around the forward axis.
export function propModelMatrix(state, spinAngle) {
  const base = planeModelMatrix(state);
  const local = mat4Multiply(
    mat4Translate(0, -0.35, -2.75),
    mat4RotateZ(spinAngle),
  );
  return mat4Multiply(base, local);
}

// Wingtip world positions, for the trail ribbons.
export function wingtipPositions(state) {
  const { right, up } = state.axes;
  const out = [];
  for (const s of [-7.9, 7.9]) {
    out.push(vadd(vadd(state.pos, vscale(right, s)), vscale(up, 0.15)));
  }
  return out;
}

// A fading ribbon behind each wingtip. `history` holds the last N
// positions per tip; the mesh is rebuilt every frame.
export function updateTrails(trailsMesh, history) {
  const pos = [], nor = [], col = [], idx = [];
  for (const tip of history) {
    const n = tip.length;
    if (n < 2) continue;
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const p = tip[i];
      const fade = 1 - i / n;
      const w = 0.35 * fade + 0.05;
      pos.push(p[0], p[1] - w, p[2], p[0], p[1] + w, p[2]);
      nor.push(0, 0, 1, 0, 0, 1);
      col.push(1, 1, 1, 1, 1, 1);
    }
    for (let i = 0; i < n - 1; i++) {
      const k = base + i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  trailsMesh.update(pos, nor, col, idx);
}
