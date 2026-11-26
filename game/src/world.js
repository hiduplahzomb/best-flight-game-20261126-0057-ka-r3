// world.js — the Aurelia archipelago: heightfield terrain, the sea, the
// sky dome, villages, hangar, tower, lighthouse, runways, gates, glide
// chevrons, beacon and clouds. One height function drives the terrain
// mesh, the sea foam, the flight model's ground and the minimap.

import { MeshBuilder, Mesh } from './renderer.js';
import {
  makeRng, clamp, smoothstep, mat4Identity, mat4RotateZ,
} from './math3.js';

// Islands: gaussian hills. `plateau` flattens the top into a mesa so a
// short mountain strip can sit on it.
export const ISLANDS = [
  { x: 100, z: -80, r: 820, h: 58 },            // home island, village
  { x: 2450, z: 150, r: 680, h: 72 },          // Coral island, main runway
  { x: 2900, z: -750, r: 620, h: 150, plateau: 118 }, // mountain island
  { x: 2300, z: -1250, r: 330, h: 42 },        // lighthouse isle
  { x: 1400, z: 1350, r: 470, h: 105 },        // ridge north
  { x: 1950, z: 1650, r: 420, h: 98 },         // ridge north-east
  { x: 900, z: 950, r: 210, h: 26 },
  { x: -650, z: 620, r: 270, h: 32 },
  { x: 1800, z: -950, r: 190, h: 22 },
  { x: -1250, z: -520, r: 310, h: 36 },
  { x: -300, z: 1500, r: 240, h: 24 },
];

// Runways: flat strips carved into the terrain.
export const RUNWAYS = {
  main: {
    name: 'RWY 09', cx: 2450, cz: 150, heading: 90,
    length: 560, width: 28, elev: 8,
  },
  mountain: {
    name: 'RWY 27', cx: 2900, cz: -750, heading: 90,
    length: 340, width: 20, elev: 118,
  },
};

function distToRect(x, z, rwy) {
  // Runways run east-west, so the rect is axis aligned.
  const dx = Math.max(Math.abs(x - rwy.cx) - rwy.length / 2, 0);
  const dz = Math.max(Math.abs(z - rwy.cz) - rwy.width / 2, 0);
  return Math.hypot(dx, dz);
}

export function groundHeight(x, z) {
  let h = 0;
  for (const isl of ISLANDS) {
    const dx = x - isl.x, dz = z - isl.z;
    const d2 = (dx * dx + dz * dz) / (isl.r * isl.r);
    let bump = isl.h * Math.exp(-d2 * 2.1);
    if (isl.plateau) {
      const mesa = isl.plateau * Math.exp(-d2 * 5.0);
      bump = Math.max(bump, mesa);
    }
    h += bump;
  }
  // Carve the runway flats: blend to the runway elevation near each strip.
  for (const key of Object.keys(RUNWAYS)) {
    const rwy = RUNWAYS[key];
    const d = distToRect(x, z, rwy);
    const w = 1 - smoothstep(0, 90, d);
    if (w > 0) h = h * (1 - w) + rwy.elev * w;
  }
  // Carve a clear approach valley west of the main runway, so the final
  // approach flies over flat ground instead of the island's west slope.
  {
    const rwy = RUNWAYS.main;
    const cx = rwy.cx - rwy.length / 2 - 160;
    const dx = Math.max(Math.abs(x - cx) - 160, 0);
    const dz = Math.max(Math.abs(z - rwy.cz) - 55, 0);
    const d = Math.hypot(dx, dz);
    const w = 1 - smoothstep(0, 70, d);
    if (w > 0) h = h * (1 - w) + 8 * w;
  }
  return h;
}

function terrainColor(h, slope, rng) {
  const jitter = (rng() - 0.5) * 0.10;
  let c;
  if (h < 1.5) c = [0.86, 0.76, 0.55];                    // sand
  else if (h < 6) c = [0.55, 0.68, 0.35];                // pale shore grass
  else if (slope > 0.55) c = [0.52, 0.45, 0.38];         // cliffs
  else if (h < 55) c = [0.32, 0.58, 0.27];              // meadow green
  else if (h < 95) c = [0.22, 0.46, 0.22];              // deep forest green
  else c = [0.45, 0.42, 0.36];                           // high rock
  return [c[0] + jitter, c[1] + jitter, c[2] + jitter];
}

export function buildWorld(gl) {
  const rng = makeRng(20261126);
  const out = {};

  // ---- Terrain heightfield -------------------------------------------
  {
    const N = 150, HALF = 3200, step = (HALF * 2) / N;
    const b = new MeshBuilder();
    const H = [];
    for (let j = 0; j <= N; j++) {
      const row = [];
      for (let i = 0; i <= N; i++) {
        row.push(groundHeight(-HALF + i * step, -HALF + j * step));
      }
      H.push(row);
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x0 = -HALF + i * step, z0 = -HALF + j * step;
        const x1 = x0 + step, z1 = z0 + step;
        const h00 = H[j][i], h10 = H[j][i + 1], h01 = H[j + 1][i], h11 = H[j + 1][i + 1];
        const slope = Math.abs(h10 - h00) / step + Math.abs(h01 - h00) / step;
        const c00 = terrainColor(h00, slope, rng);
        // Winding is chosen so the face normal points up, toward the sun.
        b.addTriangle([x0, h00, z0], [x1, h11, z1], [x1, h10, z0], c00);
        b.addTriangle([x0, h00, z0], [x0, h01, z1], [x1, h11, z1], c00);
      }
    }
    out.terrain = b.build(gl);
  }

  // ---- Heightmap texture for the sea shader ---------------------------
  {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(256, 256);
    for (let j = 0; j < 256; j++) {
      for (let i = 0; i < 256; i++) {
        const x = -3200 + (i / 255) * 6400;
        const z = -3200 + (j / 255) * 6400;
        const h = groundHeight(x, z);
        const v = Math.max(0, Math.min(255, Math.round((h / 55) * 255)));
        const k = (j * 256 + i) * 4;
        img.data[k] = v; img.data[k + 1] = v; img.data[k + 2] = v; img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    out.heightCanvas = cv;
  }

  // ---- Sea (one big quad) ---------------------------------------------
  {
    const b = new MeshBuilder();
    const S = 6400;
    b.addQuad([-S, 0, -S], [S, 0, -S], [S, 0, S], [-S, 0, S], [1, 1, 1]);
    out.sea = b.build(gl);
  }

  // ---- Sky dome ---------------------------------------------------------
  {
    const b = new MeshBuilder();
    b.addSphere([0, 0, 0], 8000, [1, 1, 1], 16, 10);
    out.sky = b.build(gl);
  }

  // ---- Trees, village, hangar, tower, lighthouse, runway furniture -----
  const props = new MeshBuilder();
  const lights = new MeshBuilder();
  const GREEN = [0.16, 0.42, 0.18];
  const GREEN2 = [0.20, 0.50, 0.22];
  const TRUNK = [0.35, 0.24, 0.15];

  // Trees: only where the ground is green and gentle, clear of runways.
  let placed = 0, tries = 0;
  while (placed < 420 && tries < 6000) {
    tries++;
    const x = -3000 + rng() * 6000;
    const z = -3000 + rng() * 6000;
    const h = groundHeight(x, z);
    if (h < 5 || h > 60) continue;
    if (distToRect(x, z, RUNWAYS.main) < 120) continue;
    if (distToRect(x, z, RUNWAYS.mountain) < 100) continue;
    const slope = Math.abs(groundHeight(x + 8, z) - h) + Math.abs(groundHeight(x, z + 8) - h);
    if (slope > 6) continue;
    const s = 0.8 + rng() * 0.9;
    props.addCylinder([x, h + 2.2 * s, z], 0.5 * s, 0.7 * s, 4.4 * s, 5, TRUNK);
    props.addCone([x, h + 6.5 * s, z], 3.4 * s, 7 * s, 6, rng() > 0.5 ? GREEN : GREEN2);
    props.addCone([x, h + 10 * s, z], 2.4 * s, 5 * s, 6, GREEN2);
    placed++;
  }

  // Village beside the main runway's west end: white walls, red roofs.
  const village = [[2180, 260], [2220, 300], [2260, 240], [2300, 290], [2340, 250],
    [2180, 330], [2240, 340], [2320, 330], [2380, 280], [2420, 330],
    [2120, 280], [2360, 210], [2440, 230], [2200, 190], [2280, 180]];
  for (const [x, z] of village) {
    const h = groundHeight(x, z);
    const w = 10 + rng() * 6, d = 9 + rng() * 5, ht = 5 + rng() * 3;
    props.addBox([x, h + ht / 2, z], [w, ht, d], mat4Identity(), [0.92, 0.88, 0.80]);
    props.addCone([x, h + ht + 2.2, z], Math.max(w, d) * 0.72, 4.4, 4,
      [0.72, 0.22, 0.16]);
  }
  // Village on the home island too, near the spawn flight path.
  const village2 = [[-80, 120], [-40, 160], [0, 110], [40, 170], [90, 130], [-120, 170]];
  for (const [x, z] of village2) {
    const h = groundHeight(x, z);
    props.addBox([x, h + 3, z], [11, 6, 9], mat4Identity(), [0.92, 0.88, 0.80]);
    props.addCone([x, h + 8.2, z], 8.5, 4.4, 4, [0.72, 0.22, 0.16]);
  }

  // Hangar + control tower near the main runway.
  {
    const hx = 2330, hz = 60, h = groundHeight(hx, hz);
    props.addBox([hx, h + 6, hz], [34, 12, 24], mat4Identity(), [0.78, 0.80, 0.82]);
    // Half-round hangar roof: a cylinder laid on its side, axis along X.
    props.addCylinder([hx, h + 12, hz], 12, 12, 34, 12, [0.55, 0.58, 0.62],
      mat4RotateZ(Math.PI / 2));
    const tx = 2540, tz = 60, th = groundHeight(tx, tz);
    props.addCylinder([tx, th + 11, tz], 3.2, 4.2, 22, 8, [0.85, 0.85, 0.86]);
    props.addBox([tx, th + 24, tz], [11, 5, 11], mat4Identity(), [0.15, 0.35, 0.55]);
    props.addBox([tx, th + 27.5, tz], [12, 1.2, 12], mat4Identity(), [0.85, 0.85, 0.86]);
  }

  // Lighthouse on its isle, white with red bands.
  {
    const lx = 2300, lz = -1250, lh = groundHeight(lx, lz);
    props.addCylinder([lx, lh + 4, lz], 7, 8.5, 8, 10, [0.90, 0.88, 0.84]);
    props.addCylinder([lx, lh + 11, lz], 6, 7, 6, 10, [0.78, 0.20, 0.16]);
    props.addCylinder([lx, lh + 17, lz], 5, 6, 6, 10, [0.90, 0.88, 0.84]);
    props.addCylinder([lx, lh + 22, lz], 4.2, 5, 4, 10, [0.78, 0.20, 0.16]);
    props.addBox([lx, lh + 26, lz], [7, 4.5, 7], mat4Identity(), [0.12, 0.14, 0.16]);
    lights.addSphere([lx, lh + 27, lz], 2.2, [1.0, 0.95, 0.6], 8, 6);
  }

  // Runway strips: asphalt, threshold bars, centreline dashes, edge lights.
  for (const key of Object.keys(RUNWAYS)) {
    const rwy = RUNWAYS[key];
    const e = rwy.elev;
    props.addBox([rwy.cx, e + 0.15, rwy.cz], [rwy.length, 0.3, rwy.width],
      mat4Identity(), [0.20, 0.20, 0.22]);
    const nDash = Math.floor(rwy.length / 40);
    for (let i = 0; i < nDash; i++) {
      const x = rwy.cx - rwy.length / 2 + 20 + i * 40;
      props.addBox([x, e + 0.35, rwy.cz], [18, 0.12, 1.6], mat4Identity(), [0.95, 0.95, 0.9]);
    }
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const x = rwy.cx + s * (rwy.length / 2 - 14 - i * 7);
        props.addBox([x, e + 0.35, rwy.cz - 7], [4.5, 0.12, 2.4], mat4Identity(), [0.95, 0.95, 0.9]);
        props.addBox([x, e + 0.35, rwy.cz + 7], [4.5, 0.12, 2.4], mat4Identity(), [0.95, 0.95, 0.9]);
      }
    }
    const nLights = Math.floor(rwy.length / 45);
    for (let i = 0; i <= nLights; i++) {
      const x = rwy.cx - rwy.length / 2 + i * 45;
      for (const s of [-1, 1]) {
        lights.addSphere([x, e + 0.9, rwy.cz + s * (rwy.width / 2 + 3)], 0.8,
          [1.0, 0.9, 0.55], 6, 4);
      }
    }
    // PAPI: two white, two red beside the threshold, as seen on approach.
    const tx0 = rwy.cx - rwy.length / 2 + 60;
    const papiCols = [[1, 1, 1], [1, 1, 1], [1, 0.15, 0.12], [1, 0.15, 0.12]];
    for (let i = 0; i < 4; i++) {
      lights.addBox([tx0, e + 1.0, rwy.cz + rwy.width / 2 + 8 + i * 3.4],
        [1.6, 1.2, 2.2], mat4Identity(), papiCols[i]);
    }
  }

  out.props = props.build(gl);
  out.lights = lights.build(gl);

  // ---- Gates: one shared golden torus, drawn per gate ------------------
  {
    const b = new MeshBuilder();
    b.addTorus([0, 0, 0], 24, 1.5, [1.0, 0.72, 0.15], 30, 8);
    out.gate = b.build(gl);
    const inner = new MeshBuilder();
    inner.addTorus([0, 0, 0], 20, 0.7, [1.0, 0.9, 0.45], 30, 6);
    out.gateInner = inner.build(gl);
  }

  // ---- Glide-path chevrons: flat arrows floating toward the threshold --
  {
    const b = new MeshBuilder();
    const rwy = RUNWAYS.main;
    for (let i = 0; i < 5; i++) {
      const d = 180 + i * 150; // metres out from the threshold
      const x = rwy.cx - rwy.length / 2 - d;
      const y = rwy.elev + 6 + d * Math.tan((3 * Math.PI) / 180);
      const z = rwy.cz;
      const s = 9;
      b.addTriangle([x - s, y, z - s], [x + s, y, z], [x - s, y, z + s],
        [0.35, 0.95, 0.95]);
      b.addTriangle([x - s, y, z - s * 0.55], [x + s * 0.4, y, z], [x - s, y, z + s * 0.55],
        [0.65, 1.0, 1.0]);
    }
    out.chevrons = b.build(gl);
  }

  // ---- Beacon: tall cyan column over the main threshold ----------------
  {
    const b = new MeshBuilder();
    const rwy = RUNWAYS.main;
    b.addCylinder([rwy.cx - rwy.length / 2, rwy.elev + 90, rwy.cz], 2.6, 3.4, 180, 10,
      [0.3, 0.9, 0.95]);
    out.beacon = b.build(gl);
    const ring = new MeshBuilder();
    ring.addTorus([rwy.cx - rwy.length / 2, rwy.elev + 2, rwy.cz], 14, 1.0,
      [0.35, 0.95, 0.95], 28, 6);
    out.beaconRing = ring.build(gl);
  }

  // ---- Lighthouse beam (rotating, drawn with its own model matrix) -----
  {
    const b = new MeshBuilder();
    // A long thin cone pointing +X from the lamp.
    const len = 260;
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2;
      const tip = [0, 0, 0];
      const p0 = [len, Math.cos(a0) * 9, Math.sin(a0) * 9];
      const p1 = [len, Math.cos(a1) * 9, Math.sin(a1) * 9];
      b.addTriangle(tip, p0, p1, [1.0, 0.95, 0.6]);
    }
    out.beam = b.build(gl);
  }

  // ---- Clouds: flattened puffs ----------------------------------------
  {
    const b = new MeshBuilder();
    const crng = makeRng(777);
    for (let i = 0; i < 30; i++) {
      const x = -3000 + crng() * 6000;
      const z = -3000 + crng() * 6000;
      // Keep the flight corridor over the home island clear of puffs.
      if (Math.hypot(x, z) < 700) continue;
      const y = 320 + crng() * 180;
      const s = 40 + crng() * 70;
      const warm = 0.92 + crng() * 0.08;
      const col = [1.0 * warm, 0.93 * warm, 0.85 * warm];
      b.addSphere([x, y, z], s, col, 8, 5, 0.45);
      b.addSphere([x + s * 0.7, y + s * 0.12, z + s * 0.2], s * 0.7, col, 8, 5, 0.45);
      b.addSphere([x - s * 0.7, y + s * 0.08, z - s * 0.15], s * 0.6, col, 8, 5, 0.45);
    }
    out.clouds = b.build(gl);
  }

  return out;
}

// Sky dome mesh is also built here for the renderer to hold.
export function buildSkyMesh(gl) {
  const b = new MeshBuilder();
  b.addSphere([0, 0, 0], 8000, [1, 1, 1], 16, 10);
  return b.build(gl);
}
