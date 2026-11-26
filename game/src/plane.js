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
  gear.addCylinder([0, -1.75, 4.6], 0.1, 0.1, 1.4, 5, DARK);
  gear.addCylinder([0, -2.28, 4.6], 0.42, 0.42, 0.3, 8, [0.08, 0.08, 0.09],
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

  // Cockpit, seen from the pilot's seat. The seat sits 0.9 m behind the
  // panel (eye z = +0.9 in model space), so the panel is a low brow
  // across the bottom of the windscreen instead of a wall in the face:
  // panel top y = 0.70 reads at ~58% of the frame, dials below it.
  // Six lit dials (cream faces, orange needles, tick marks) sit on the
  // panel face; a dark glareshield strip covers the nose's rear face
  // above the panel; A-pillars run UP-FORWARD along the windscreen
  // edges to a roof beam, framing the canopy; a shaped yoke stands in
  // front of the panel; a cabin floor hides the wing where it passes
  // under the fuselage, so no wing shows through the cabin floor.
  // It lives inside the fuselage, so it is only drawn in cockpit view.
  const cockpit = new MeshBuilder();
  const DASH = [0.13, 0.14, 0.16];
  const DASH2 = [0.19, 0.20, 0.22];
  const YOKE = [0.55, 0.56, 0.58];
  const FLOOR = [0.30, 0.30, 0.32];
  // Low panel at the cabin front, face toward the pilot.
  cockpit.addBox([0, 0.50, -1.05], [1.9, 0.40, 0.35], mI, DASH);
  // Glareshield brow over the panel top, and a dark strip above it
  // covering the nose's rear face up to the cowl line.
  cockpit.addBox([0, 0.71, -1.0], [1.9, 0.05, 0.35], mI, DASH2);
  cockpit.addBox([0, 0.78, -1.18], [1.72, 0.18, 0.04], mI, DASH);
  // Six dials: dark rim, lit face, needle and tick marks. The needle
  // angle follows the standard gauge sweep — 270° with the gap at the
  // bottom (min at 7:30, mid at 12, max at 4:30) — matching the HUD
  // six-pack. `f` is the needle fraction; rotating the needle box
  // about Z by a = 0.75π − 1.5πf points its long axis along the dial.
  const DIAL_X = [-0.75, -0.45, -0.15, 0.15, 0.45, 0.75];
  const DIAL_F = [0.62, null, 0.30, 0.50, 0.50, 0.66]; // ATT has no needle
  const dialA = (f) => 0.75 * Math.PI - 1.5 * Math.PI * f;
  const dialDir = (f) => {
    const a = dialA(f);
    return [-Math.sin(a), Math.cos(a)];
  };
  DIAL_X.forEach((gx, i) => {
    const f = DIAL_F[i];
    // Rim and face: cylinders tipped to face the pilot (+Z).
    cockpit.addCylinder([gx, 0.50, -0.868], 0.115, 0.115, 0.018, 12,
      [0.07, 0.08, 0.10], mat4RotateX(Math.PI / 2));
    const faceCol = i === 1 ? [0.30, 0.50, 0.85] // ATT: blue sky half
      : [0.93, 0.91, 0.80];                       // lit cream faces
    cockpit.addCylinder([gx, 0.50, -0.864], 0.098, 0.098, 0.02, 12,
      faceCol, mat4RotateX(Math.PI / 2));
    // Tick marks at min / mid / max.
    for (const tf of [0, 0.5, 1]) {
      const [dx, dy] = dialDir(tf);
      cockpit.addBox([gx + dx * 0.088, 0.50 + dy * 0.088, -0.854],
        [0.014, 0.028, 0.01], mat4RotateZ(dialA(tf)), [0.12, 0.13, 0.15]);
    }
    if (f == null) {
      // Attitude indicator: white horizon bar across the blue face.
      cockpit.addBox([gx, 0.50, -0.852], [0.14, 0.02, 0.012], mI, [0.95, 0.95, 0.92]);
    } else {
      const [dx, dy] = dialDir(f);
      cockpit.addBox([gx + dx * 0.03, 0.50 + dy * 0.03, -0.852],
        [0.02, 0.085, 0.012], mat4RotateZ(dialA(f)), [1.0, 0.45, 0.12]);
    }
    cockpit.addBox([gx, 0.50, -0.851], [0.03, 0.03, 0.012], mI, [0.10, 0.11, 0.13]);
  });
  // Warm lamps on the glareshield brow.
  for (const lx of [-0.45, 0.45]) {
    cockpit.addBox([lx, 0.745, -0.95], [0.07, 0.03, 0.07], mI, [1.0, 0.8, 0.3]);
  }
  // A-pillars: from the panel's top corners UP-FORWARD along the
  // windscreen edges to the roof beam — a canopy frame, not a fence
  // rail. Thin (0.08), outboard of the nose (x = ±0.95) so the whole
  // pillar shows instead of vanishing inside the nose box.
  for (const s of [-1, 1]) {
    cockpit.addBox([s * 0.95, 0.86, -1.52], [0.08, 1.1, 0.08], mat4RotateX(-1.28), DASH);
  }
  // Roof beam across the top of the windscreen, thin so it reads as
  // the roof edge, not a bar across the sky.
  cockpit.addBox([0, 1.0, -2.0], [1.95, 0.05, 0.05], mI, DASH);
  // Yoke: column, crossbar grip and two hand grips, light grey so it
  // reads against the dark panel, tall enough to clear the panel top.
  // The bar sits just above the dials so the whole yoke reads as one
  // piece instead of two floating blocks.
  cockpit.addBox([0, 0.42, -0.15], [0.09, 0.5, 0.09], mI, YOKE);
  cockpit.addBox([0, 0.66, -0.18], [0.52, 0.09, 0.09], mI, YOKE);
  for (const s of [-1, 1]) {
    cockpit.addBox([s * 0.22, 0.72, -0.18], [0.09, 0.14, 0.09], mI, YOKE);
  }
  // Cabin floor and kick panels: they sit just above the wing (top
  // y = 0.32), so from the seat the wing never shows through the floor.
  // Light enough to read as a floor, not a black hole.
  cockpit.addBox([0, 0.38, 0.3], [1.9, 0.06, 2.6], mI, FLOOR);
  for (const s of [-1, 1]) {
    cockpit.addBox([s * 0.92, 0.50, 0.3], [0.06, 0.24, 2.6], mI, FLOOR);
  }
  // Side consoles flanking the seat, on the floor, with a throttle
  // lever on the left one.
  for (const s of [-1, 1]) {
    cockpit.addBox([s * 0.82, 0.52, 0.35], [0.28, 0.28, 1.3], mI, [0.16, 0.17, 0.19]);
  }
  cockpit.addBox([-0.82, 0.72, 0.1], [0.05, 0.12, 0.05], mI, DASH);
  cockpit.addBox([-0.82, 0.79, 0.1], [0.09, 0.05, 0.05], mI, [0.85, 0.2, 0.15]);

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
      const w = 0.16 * fade + 0.02;
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
