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
  // Fuselage: nose, cabin and tapered tail, nose toward -Z. The nose
  // ends flush with the cabin front (z = -1.2): the old nose ran back
  // to z = -0.5, and its rear face stood inside the cabin like a wall
  // 1 m in front of the pilot, hiding the whole instrument panel.
  b.addBox([0, 0, -2.55], [1.7, 1.7, 2.7], mI, WHITE);         // nose
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
  // Retractable gear: struts and wheels, drawn only when the gear is
  // down (its own mesh, so cruise shows clean lines like the HUD says).
  const gear = new MeshBuilder();
  for (const s of [-1, 1]) {
    gear.addCylinder([s * 1.1, -1.5, -1.2], 0.12, 0.12, 1.4, 5, DARK);
    gear.addCylinder([s * 1.1, -2.15, -1.2], 0.55, 0.55, 0.35, 8, [0.08, 0.08, 0.09],
      mat4RotateZ(Math.PI / 2));
  }
  gear.addCylinder([0, -1.9, 4.6], 0.1, 0.1, 1.6, 5, DARK);
  gear.addCylinder([0, -2.6, 4.6], 0.42, 0.42, 0.3, 8, [0.08, 0.08, 0.09],
    mat4RotateZ(Math.PI / 2));
  // Belly antenna and pitot.
  b.addCylinder([0, -1.05, 1.5], 0.06, 0.1, 0.7, 5, DARK);
  b.addCylinder([0.9, 0.1, -4.0], 0.05, 0.05, 0.9, 5, DARK,
    mat4RotateX(Math.PI / 2));

  // Propeller blades (two per engine, spun in main.js) and blur discs.
  // Thin and mid-grey: a spinning prop reads as a blur, not a black cross.
  // The blade mesh is centred on its own hub (x = 0): each engine gets
  // its own model matrix, so the blades spin around their own nacelle
  // shaft instead of orbiting the fuselage centreline.
  const prop = new MeshBuilder();
  prop.addBox([0, 0, 0], [0.22, 4.4, 0.12], mI, [0.38, 0.38, 0.42]);
  prop.addBox([0, 0, 0], [4.4, 0.22, 0.12], mI, [0.38, 0.38, 0.42]);
  prop.addSphere([0, 0, 0], 0.4, GREY, 8, 5);
  const disc = new MeshBuilder();
  for (const s of [-1, 1]) {
    // A flat disc facing forward: built as a many-sided cylinder squashed thin.
    disc.addCylinder([s * 3.4, 0, 0], 2.3, 2.3, 0.06, 20, [0.75, 0.75, 0.78],
      mat4RotateX(Math.PI / 2));
  }

  // Cockpit frame, seen from the pilot's seat: glareshield with a gauge
  // strip, windscreen pillars running up to the roof, yoke and side
  // consoles. It lives inside the fuselage, so it is only drawn in
  // cockpit view (from outside the fuselage hides it).
  const cockpit = new MeshBuilder();
  const DASH = [0.13, 0.14, 0.16];
  const DASH2 = [0.19, 0.20, 0.22];
  // The panel sits at the cabin front (z = -1.2), its face toward the
  // pilot — in front of the nose's rear face, never behind it.
  cockpit.addBox([0, 0.45, -1.05], [1.9, 0.55, 0.55], mI, DASH);
  cockpit.addBox([0, 0.72, -1.07], [1.9, 0.08, 0.5], mI, DASH2);
  for (const gx of [-0.62, -0.21, 0.21, 0.62]) {
    cockpit.addBox([gx, 0.52, -0.75], [0.24, 0.24, 0.05], mI, [0.05, 0.08, 0.10]);
  }
  for (const lx of [-0.45, 0.45]) {
    cockpit.addBox([lx, 0.78, -0.78], [0.07, 0.04, 0.07], mI, [1.0, 0.8, 0.3]);
  }
  // Dark trim across the top of the panel, hiding the white strip of
  // the nose's rear face that used to read as a blank beige wall above
  // the dash. It sits just in front of the firewall, flush with the
  // nose top, so the whole panel reads as one dark instrument panel.
  cockpit.addBox([0, 0.755, -1.19], [1.72, 0.21, 0.04], mI, DASH);
  for (const s of [-1, 1]) {
    cockpit.addBox([s * 0.885, 0.86, -0.375], [0.13, 1.38, 0.13], mat4RotateX(1.37), DASH);
  }
  // Yoke: column and grip, low in the middle of the view.
  cockpit.addBox([0, 0.18, -0.62], [0.09, 0.45, 0.09], mI, DASH);
  cockpit.addBox([0, 0.42, -0.66], [0.55, 0.09, 0.10], mI, DASH);
  // Side consoles flanking the seat.
  for (const s of [-1, 1]) {
    cockpit.addBox([s * 0.82, 0.28, -0.35], [0.28, 0.3, 1.3], mI, [0.16, 0.17, 0.19]);
  }

  // Navigation lights: red on the left tip, green on the right.
  const nav = new MeshBuilder();
  nav.addSphere([-7.9, 0.15, -0.4], 0.28, [1, 0.1, 0.1], 6, 4);
  nav.addSphere([7.9, 0.15, -0.4], 0.28, [0.15, 1, 0.3], 6, 4);
  nav.addSphere([0, 0.9, 6.9], 0.22, [1, 1, 1], 6, 4);

  return {
    body: b.build(gl),
    gear: gear.build(gl),
    prop: prop.build(gl),
    disc: disc.build(gl),
    cockpit: cockpit.build(gl),
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
// Each engine spins around ITS OWN shaft: the blade mesh is centred on
// the hub, and the engine offset (±3.4 m) is applied outside the spin,
// so the blades sweep a disc in front of their nacelle instead of
// orbiting the fuselage.
export function propModelMatrix(state, spinAngle, xOffset) {
  const base = planeModelMatrix(state);
  const local = mat4Multiply(
    mat4Translate(xOffset, -0.35, -2.75),
    mat4RotateZ(spinAngle),
  );
  return mat4Multiply(base, local);
}

// Blur discs sit on the same shafts but do not spin.
export function discModelMatrix(state) {
  const base = planeModelMatrix(state);
  return mat4Multiply(base, mat4Translate(0, -0.35, -2.75));
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
