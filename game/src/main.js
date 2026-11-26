// main.js — Aurelia Wings: bootstrap, the game loop, the chase and
// cockpit cameras, the shot-staging autopilot (for screenshots), wind
// streaks, wingtip trails and the landing debrief.

import { Renderer, DynamicMesh } from './renderer.js';
import { buildWorld, buildSkyMesh, groundHeight, RUNWAYS } from './world.js';
import { buildPlaneMeshes, planeModelMatrix, propModelMatrix, discModelMatrix, wingtipPositions, updateTrails } from './plane.js';
import { createFlightState, updateFlight, landingGrade, runwayUnder } from './flight.js';
import { MISSIONS, createMissionState, updateMission, nextGate, missionRunway } from './missions.js';
import { Hud } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import {
  mat4Identity, mat4Multiply, mat4RotateX, mat4RotateY, mat4Translate,
  mat4Scale, clamp, lerp, angleWrapDeg, vadd, vsub, vscale, vnorm,
  axesFromEuler, makeRng,
} from './math3.js';

// Staged poses for real screenshots: a genuine sortie, flown by the
// in-game autopilot for a fixed number of steps, then held still.
// Each stage is framed so its subject is actually in the picture:
// the cover flies over the sea strait toward the Coral island with the
// runway and beacon beyond the next gate; the lighthouse shot closes
// in until the tower fills the frame behind its gate; the final is a
// three-quarter view from beside the threshold, so the whole runway
// reads instead of a foreshortened line.
const SHOTS = {
  cover: {
    mission: 1, camera: 'chase',
    stage: { x: 1500, alt: 135, z: 200, heading: 66, speed: 52, throttle: 0.62, gateIndex: 4 },
    settle: 30,
  },
  cockpit: {
    mission: 2, camera: 'cockpit',
    stage: { x: 930, alt: 178, z: 1010, heading: 127, speed: 55, throttle: 0.66 },
    settle: 25,
  },
  lighthouse: {
    mission: 4, camera: 'chase',
    stage: { x: 2050, alt: 140, z: -1080, heading: 55, speed: 52, throttle: 0.64, gateIndex: 1 },
    settle: 30,
  },
  final: {
    mission: 5, camera: 'apron',
    stage: { x: 1980, alt: 45, z: 150, heading: 90, speed: 48, throttle: 0.45, flaps: 1, gearDown: true, gateIndex: 2 },
    settle: 20,
  },
};

function parseQuery() {
  const q = new URLSearchParams(window.location.search);
  return { shot: q.get('shot') || '', seed: Number(q.get('seed') || 1) };
}

function startGame() {
  const canvas = document.getElementById('gl');
  const renderer = new Renderer(canvas);
  const world = buildWorld(renderer.gl);
  renderer.uploadHeightTexture(world.heightCanvas);
  renderer.setSkyMesh(buildSkyMesh(renderer.gl));
  const plane = buildPlaneMeshes(renderer.gl);
  const hud = new Hud(document);
  const input = createInput(canvas);
  const audio = createAudio();
  const { shot } = parseQuery();
  const shotSpec = SHOTS[shot] || null;

  let missionIndex = 0;
  let flight = null;
  let ms = null;
  let camMode = 'chase';
  let camDist = 22;
  let camPos = [0, 140, -60];
  let camTarget = [0, 130, 0];
  let spinAngle = 0;
  let simTime = 0;
  let frozen = false;
  let settleLeft = 0;
  let autopilot = false;
  let listOpen = false;
  let lowFuelWarned = false;
  let trailHistory = [[], []];
  let windParticles = [];
  const windRng = makeRng(4242);
  for (let i = 0; i < 70; i++) {
    windParticles.push([
      (windRng() - 0.5) * 120,
      (windRng() - 0.5) * 60,
      (windRng() - 0.5) * 120,
    ]);
  }
  const windMesh = new DynamicMesh(renderer.gl, 1024);

  function loadMission(index, staged) {
    missionIndex = index;
    const m = MISSIONS[index];
    const spawn = staged || m.spawn;
    flight = createFlightState(spawn);
    if (staged && staged.flaps) flight.flaps = staged.flaps;
    ms = createMissionState(m);
    // A staged shot can start part-way down the gate chain, so the
    // framed gate is the one ahead of the aircraft, not one behind it.
    if (staged && staged.gateIndex != null) {
      ms.gateIndex = staged.gateIndex;
      ms.gatesPassed = staged.gateIndex;
    }
    // Ring facing: each gate looks back along the path that leads to it.
    let prev = [spawn.x, spawn.alt, spawn.z];
    m.gates.forEach((g) => {
      const dx = g.x - prev[0], dz = g.z - prev[2];
      g.faceHeading = (Math.atan2(dx, -dz) * 180) / Math.PI;
      prev = [g.x, g.y, g.z];
    });
    hud.hideLanding();
    hud.hideMissionList();
    listOpen = false;
    lowFuelWarned = false;
    trailHistory = [[], []];
  }

  if (shotSpec) {
    loadMission(shotSpec.mission - 1, shotSpec.stage);
    camMode = shotSpec.camera;
    autopilot = true;
    settleLeft = shotSpec.settle;
    // Stage the camera right behind the tail at once: no swoop-in.
    const { forward, up } = flight.axes;
    camPos = vadd(vadd(flight.pos, vscale(forward, -camDist)), vscale(up, 4));
    camTarget = vadd(flight.pos, vscale(forward, 30));
  } else {
    loadMission(0);
  }

  window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
  window.addEventListener('keydown', () => audio.unlock(), { once: true });

  // Steer toward the next gate or the runway threshold, gently. A gate
  // far behind the nose is not a target: line up for the runway instead.
  function flyAutopilot(dt) {
    const gate = nextGate(ms);
    const rwy = missionRunway(ms);
    let target = [rwy.cx - rwy.length / 2, rwy.elev + 18, rwy.cz];
    if (gate) {
      const dx = gate.x - flight.pos[0], dz = gate.z - flight.pos[2];
      const gateHeading = (Math.atan2(dx, -dz) * 180) / Math.PI;
      if (Math.abs(angleWrapDeg(gateHeading - flight.heading)) < 100) {
        target = [gate.x, gate.y, gate.z];
      }
    }
    const dx = target[0] - flight.pos[0];
    const dy = target[1] - flight.pos[1];
    const dz = target[2] - flight.pos[2];
    const desiredHeading = (Math.atan2(dx, -dz) * 180) / Math.PI;
    const turn = clamp(angleWrapDeg(desiredHeading - flight.heading), -26 * dt, 26 * dt);
    flight.heading = (flight.heading + turn + 360) % 360;
    const horiz = Math.hypot(dx, dz);
    const desiredPitch = clamp((Math.atan2(dy, Math.max(30, horiz)) * 180) / Math.PI, -7, 9);
    flight.pitch += clamp(desiredPitch - flight.pitch, -9 * dt, 9 * dt);
    flight.roll = clamp(angleWrapDeg(desiredHeading - flight.heading) * 0.9, -14, 14);
    flight.throttle = shot === 'final' ? 0.42 : 0.62;
  }

  function updateCamera(dt) {
    const { forward, right, up } = flight.axes;
    if (camMode === 'cockpit') {
      // Sit IN the cabin, just behind the glareshield, so the dash,
      // pillars and yoke frame the view and the cowl sits low in it.
      // The old seat hovered above the fuselage and showed no cockpit.
      const eye = vadd(vadd(flight.pos, vscale(forward, -0.6)), vscale(up, 0.95));
      const target = vadd(vadd(flight.pos, vscale(forward, 120)), vscale(up, -6));
      camPos = eye;
      camTarget = target;
      return { eye, target };
    }
    if (camMode === 'apron') {
      // High three-quarter view from south of the final: the plane on
      // short final at left, the whole runway strip receding to the
      // right. The strip sits in a valley with 50 m hills north and
      // south, so a low side view hides it behind the slope — the
      // camera has to be high enough to look over the ridge.
      const rwy = missionRunway(ms);
      const hr = (rwy.heading * Math.PI) / 180;
      const thr = [rwy.cx - (rwy.length / 2) * Math.sin(hr), rwy.elev,
        rwy.cz + (rwy.length / 2) * Math.cos(hr)];
      const eye = vadd(vadd(vadd(flight.pos, vscale(right, 170)),
        vscale(forward, -55)), vscale(up, 85));
      const target = [
        (flight.pos[0] + thr[0]) / 2,
        (flight.pos[1] + thr[1]) / 2,
        (flight.pos[2] + thr[2]) / 2,
      ];
      camPos = eye;
      camTarget = target;
      return { eye, target };
    }
    camDist = clamp(camDist + input.zoom * 6, 16, 34);
    input.zoom = 0;
    const desired = vadd(
      vadd(flight.pos, vscale(forward, -camDist)),
      vscale(up, 3.6),
    );
    // Keep the camera out of the hills.
    const minY = groundHeight(desired[0], desired[2]) + 2.5;
    if (desired[1] < minY) desired[1] = minY;
    const k = 1 - Math.exp(-dt * 7);
    camPos = vadd(camPos, vscale(vsub(desired, camPos), k));
    const target = vadd(vadd(flight.pos, vscale(forward, 34)), vscale(up, 1.2));
    const k2 = 1 - Math.exp(-dt * 10);
    camTarget = vadd(camTarget, vscale(vsub(target, camTarget), k2));
    return { eye: camPos, target: camTarget };
  }

  function updateWindStreaks() {
    const { forward, right } = flight.axes;
    const speed = flight.speed;
    const pos = [], nor = [], col = [], idx = [];
    if (speed > 24) {
      const span = 60;
      windParticles.forEach((p, i) => {
        // Recycle streaks that fell behind the aircraft.
        const rel = vsub(p, flight.pos);
        const along = rel[0] * forward[0] + rel[1] * forward[1] + rel[2] * forward[2];
        if (along < -20 || along > 90 || Math.abs(rel[1]) > 35) {
          p[0] = flight.pos[0] + forward[0] * (40 + windRng() * 50) +
            (windRng() - 0.5) * span;
          p[1] = flight.pos[1] + (windRng() - 0.5) * 40;
          p[2] = flight.pos[2] + forward[2] * (40 + windRng() * 50) +
            (windRng() - 0.5) * span;
        }
        const w = 0.05;
        const len = 0.6 + speed * 0.015;
        const base = pos.length / 3;
        const a = [p[0] - forward[0] * len, p[1] - forward[1] * len, p[2] - forward[2] * len];
        const b = [p[0] + forward[0] * len, p[1] + forward[1] * len, p[2] + forward[2] * len];
        for (const [pt, s] of [[a, -1], [b, -1], [a, 1], [b, 1]]) {
          pos.push(pt[0] + right[0] * w * s, pt[1] + right[1] * w * s, pt[2] + right[2] * w * s);
          nor.push(0, 0, 1);
          col.push(1, 1, 1);
        }
        idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        void i;
      });
    }
    windMesh.update(pos, nor, col, idx);
  }

  let lastNow = performance.now();
  let landedShown = false;

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000));
    lastNow = now;
    renderer.resize();
    renderer.time = simTime;

    // --- Actions ---------------------------------------------------------
    input.poll();
    const act = input.takeAction();
    if (act.camera) camMode = camMode === 'chase' ? 'cockpit' : 'chase';
    if (act.missions) {
      if (listOpen) { hud.hideMissionList(); listOpen = false; }
      else { hud.showMissionList(MISSIONS[missionIndex].id, (id) => {
        loadMission(id - 1);
      }); listOpen = true; }
    }
    if (act.mission) loadMission(act.mission - 1);
    if (act.reset) {
      loadMission(missionIndex);
      landedShown = false;
    }

    // --- Simulation ------------------------------------------------------
    // Shot staging runs on a fixed timestep so the frozen frame is the
    // same no matter how fast the machine renders.
    const pdt = (shotSpec && autopilot && !frozen) ? 1 / 60 : dt;
    if (!frozen) {
      simTime += pdt;
      if (autopilot) {
        flyAutopilot(pdt);
        updateFlight(flight, { autopilot: true }, pdt);
        if (shotSpec) {
          settleLeft--;
          if (settleLeft <= 0) {
            frozen = true;
            window.__shotReady = true;
          }
        }
      } else {
        updateFlight(flight, input, dt);
      }
      spinAngle += pdt * (18 + flight.throttle * 55);

      // Wingtip trails.
      const tips = wingtipPositions(flight);
      tips.forEach((t, i) => {
        trailHistory[i].unshift([t[0], t[1], t[2]]);
        if (trailHistory[i].length > 34) trailHistory[i].pop();
      });
      updateTrails(plane.trails, trailHistory);
      updateWindStreaks();

      // Mission progress and events.
      const events = updateMission(ms, flight, simTime);
      for (const ev of events) {
        if (ev.type === 'gate') audio.gate();
        if (ev.type === 'drop') audio.blip(660, 0.2, 'sine', 0.25);
        if (ev.type === 'landed') {
          audio.touchdown();
          const gradeInfo = landingGrade(flight);
          hud.showLanding(flight, gradeInfo, ms.score);
          landedShown = true;
        }
      }
      if (flight.crashed && !landedShown) {
        hud.showLanding(flight,
          { grade: '—', fpm: Math.round(Math.abs(flight.verticalSpeed * 196.85)),
            centerBonus: 0, smoothBonus: 0 }, ms.score);
        hud.landing.querySelector('.land-title').textContent = 'CRASHED — press R to fly again';
        landedShown = true;
      }
      if (flight.fuel < 25 && !lowFuelWarned) {
        ms.message = 'Fuel low — head for the runway';
        ms.messageAt = simTime;
        lowFuelWarned = true;
      }
      audio.update(flight.throttle, flight.speed, flight.onGround);
    }

    // --- Camera and view ---------------------------------------------------
    const { eye, target } = updateCamera(frozen ? 0.016 : dt);
    const aspect = renderer.canvas.width / Math.max(1, renderer.canvas.height);
    const proj = Renderer.perspective(58, aspect, 0.5, 12000);
    const view = Renderer.lookAt(eye, target, [0, 1, 0]);
    renderer.beginFrame(view, proj, eye);

    // --- Draw the world -----------------------------------------------------
    renderer.drawSea(world.sea);
    renderer.drawSolid(world.terrain, mat4Identity());
    renderer.drawSolid(world.props, mat4Identity());
    renderer.drawSolid(world.lights, mat4Identity(), 0.85);
    // Clouds after the opaque world, so hills and sea occlude them
    // properly instead of the sea painting over them.
    const cloudDrift = (simTime * 2.2) % 600;
    renderer.drawSolid(world.clouds,
      mat4Translate(cloudDrift - 300, 0, 0), 0.5, 0.9);
    // Runway beacon and glide chevrons.
    const pulse = 0.5 + 0.5 * Math.sin(simTime * 2.4);
    renderer.drawSolid(world.beacon, mat4Identity(), 0.6, 0.30 + 0.10 * pulse);
    renderer.drawSolid(world.beaconRing, mat4Identity(), 0.6, 0.35 + 0.3 * pulse);
    renderer.drawSolid(world.chevrons, mat4Identity(), 0.55, 0.9);
    // Lighthouse beam, sweeping.
    const beamModel = mat4Multiply(
      mat4Translate(2300, groundHeight(2300, -1250) + 34, -1250),
      mat4RotateY(simTime * 0.7),
    );
    renderer.drawSolid(world.beam, beamModel, 0.5, 0.16);

    // Gates: the active one glows, passed ones fade, later ones wait.
    // A ring must face the incoming aircraft: its normal is the travel
    // direction (sin h, 0, -cos h), and RotateY(a) points +Z at
    // (sin a, 0, cos a), so the angle is 180° - heading, not heading.
    ms.mission.gates.forEach((g, i) => {
      const face = mat4Multiply(
        mat4Translate(g.x, g.y, g.z),
        mat4RotateY(((180 - g.faceHeading) * Math.PI) / 180),
      );
      const ringModel = mat4Multiply(face, mat4RotateX(Math.PI / 2));
      if (i < ms.gateIndex) {
        renderer.drawSolid(world.gate, ringModel, 0, 0.3);
      } else if (i === ms.gateIndex) {
        const s = 1 + 0.03 * Math.sin(simTime * 3);
        const pulseModel = mat4Multiply(ringModel, mat4Scale(s, s, s));
        renderer.drawSolid(world.gate, pulseModel, 0.7, 1);
        renderer.drawSolid(world.gateInner, ringModel, 0.9, 0.85);
      } else {
        renderer.drawSolid(world.gate, ringModel, 0.12, 0.85);
      }
    });

    // --- The aircraft --------------------------------------------------------
    // In the cockpit the nose stays in frame at the bottom; everywhere
    // else the whole twin-prop is the hero. Props are drawn faint: at
    // speed they read as a blur disc, not a black cross.
    const model = planeModelMatrix(flight);
    if (camMode !== 'cockpit') {
      renderer.drawSolid(plane.body, model);
      if (flight.gearDown) renderer.drawSolid(plane.gear, model);
      // One prop per engine, each spinning around its own shaft; the
      // two counter-rotate. The blur disc sits on the same shafts.
      renderer.drawSolid(plane.prop, propModelMatrix(flight, spinAngle, -3.4), 0, 0.22);
      renderer.drawSolid(plane.prop, propModelMatrix(flight, -spinAngle, 3.4), 0, 0.22);
      renderer.drawSolid(plane.disc, discModelMatrix(flight), 0, 0.10);
      const strobe = Math.sin(simTime * 5) > 0.55 ? 1.0 : 0.25;
      renderer.drawSolid(plane.nav, model, strobe);
      renderer.drawSolid(plane.trails, mat4Identity(), 0, 0.32);
    } else {
      renderer.drawSolid(plane.body, model);
      renderer.drawSolid(plane.cockpit, model);
      renderer.drawSolid(plane.prop, propModelMatrix(flight, spinAngle, -3.4), 0, 0.22);
      renderer.drawSolid(plane.prop, propModelMatrix(flight, -spinAngle, 3.4), 0, 0.22);
      renderer.drawSolid(plane.disc, discModelMatrix(flight), 0, 0.10);
    }
    if (flight.speed > 24) {
      renderer.drawSolid(windMesh, mat4Identity(), 0, 0.2);
    }

    // --- HUD -------------------------------------------------------------------
    hud.update(flight, ms, camMode, simTime, view, proj);
  }

  requestAnimationFrame(frame);
}

startGame();
