// flight.js — a forgiving six-degree flight model for a STOL twin-prop:
// lift, drag, flaps and ground effect you can feel, but no flat spins.
// Throttle and turn discipline are rewarded: smooth flying keeps speed
// and fuel, hard yanking bleeds both.

import {
  axesFromEuler, clamp, lerp, angleWrapDeg, vadd, vscale,
} from './math3.js';
import { groundHeight, RUNWAYS } from './world.js';

export const STALL_SPEED = 26;      // m/s, clean
export const STALL_FLAPS = 21;      // m/s, full flaps
export const MAX_SPEED = 78;        // m/s at full throttle, level
export const CRUISE_SPEED = 55;

export function createFlightState(spawn) {
  return {
    pos: [spawn.x, spawn.alt, spawn.z],
    heading: spawn.heading,
    pitch: 0,
    roll: 0,
    speed: spawn.speed,
    throttle: spawn.throttle ?? 0.62,
    flaps: 0,               // 0, 1, 2
    gearDown: spawn.gearDown ?? false,
    brakes: false,
    fuel: 100,              // percent, one value only
    hull: 100,              // percent
    verticalSpeed: 0,
    onGround: false,
    crashed: false,
    landed: false,
    touchdownFpm: 0,
    touchdownSpeed: 0,
    centerlineError: 0,
    axes: axesFromEuler(spawn.heading, 0, 0),
    windHeading: 340,       // crosswind from the north-west
    windSpeed: 7,
  };
}

// Is the aircraft over a runway strip (for landing checks)?
export function runwayUnder(state) {
  for (const key of Object.keys(RUNWAYS)) {
    const rwy = RUNWAYS[key];
    const dx = Math.abs(state.pos[0] - rwy.cx);
    const dz = Math.abs(state.pos[2] - rwy.cz);
    if (dx < rwy.length / 2 && dz < rwy.width / 2 + 4) return rwy;
  }
  return null;
}

export function updateFlight(state, input, dt) {
  if (state.crashed) return state;
  const s = state;

  // --- Throttle ---------------------------------------------------------
  if (input.throttleUp) s.throttle = clamp(s.throttle + dt * 0.5, 0, 1);
  if (input.throttleDown) s.throttle = clamp(s.throttle - dt * 0.5, 0, 1);
  if (input.throttleSet != null) s.throttle = clamp(input.throttleSet, 0, 1);

  // --- Flaps and gear ---------------------------------------------------
  if (input.flapsToggle) {
    s.flaps = (s.flaps + 1) % 3;
    input.flapsToggle = false;
  }
  if (input.gearToggle) {
    s.gearDown = !s.gearDown;
    input.gearToggle = false;
  }
  s.brakes = !!input.brakes;

  // --- Attitude ---------------------------------------------------------
  // Autopilot sets heading/pitch/roll itself; the pilot's hands stay off.
  if (!input.autopilot) {
    const authority = clamp(s.speed / 40, 0.25, 1); // mushy when slow
    const rollRate = 55 * authority;
    const pitchRate = 28 * authority;
    if (input.rollLeft) s.roll = clamp(s.roll - rollRate * dt, -55, 55);
    else if (input.rollRight) s.roll = clamp(s.roll + rollRate * dt, -55, 55);
    else {
      // Gentle auto-level: the wing comes back on its own.
      s.roll = lerp(s.roll, 0, Math.min(1, dt * 0.9));
    }
    if (input.pitchUp) s.pitch = clamp(s.pitch + pitchRate * dt, -18, 22);
    else if (input.pitchDown) s.pitch = clamp(s.pitch - pitchRate * dt, -18, 22);
    else s.pitch = lerp(s.pitch, 0, Math.min(1, dt * 0.45));

    // Mouse yoke: dragging steers a little, like holding the stick.
    if (input.mousePitch || input.mouseRoll) {
      s.pitch = clamp(s.pitch + input.mousePitch * dt * 14, -18, 22);
      s.roll = clamp(s.roll + input.mouseRoll * dt * 30, -55, 55);
      input.mousePitch = 0;
      input.mouseRoll = 0;
    }
  }

  // Bank turns the nose: coordinated turn, no skid. Positive roll is a
  // right bank, so it turns right (heading increases with sin(roll)).
  const turnRate = Math.sin((s.roll * Math.PI) / 180) * (s.speed / 38) * 22;
  s.heading = (s.heading + turnRate * dt + 360) % 360;

  // --- Speed, lift and sink ---------------------------------------------
  const stall = s.flaps === 2 ? STALL_FLAPS : s.flaps === 1 ? 23.5 : STALL_SPEED;
  const targetSpeed = s.throttle * MAX_SPEED;
  const drag = 1 + (s.flaps * 0.35) + (s.gearDown ? 0.12 : 0) +
    Math.abs(s.roll) / 90 + Math.abs(s.pitch) / 60;
  s.speed += (targetSpeed - s.speed) * Math.min(1, (dt * 0.55) / drag);
  if (s.pitch > 0) s.speed -= Math.sin((s.pitch * Math.PI) / 180) * 9 * dt;
  if (s.pitch < 0) s.speed += Math.sin((-s.pitch * Math.PI) / 180) * 5 * dt;
  s.speed = clamp(s.speed, 0, 95);

  // Climb from pitch, with lift falling away below stall speed.
  const liftFactor = clamp(s.speed / stall, 0, 1.25);
  let climb = Math.sin((s.pitch * Math.PI) / 180) * s.speed * liftFactor;
  if (s.speed < stall) {
    // Sinking, nose drops gently instead of spinning.
    climb -= (stall - s.speed) * 1.6;
    s.pitch = lerp(s.pitch, -6, Math.min(1, dt * 0.8));
  }

  // Crosswind pushes the nose and the track sideways a touch.
  const windPush = Math.sin(((s.windHeading - s.heading) * Math.PI) / 180) *
    s.windSpeed * 0.12;

  // Ground effect: a cushion of lift in the last few metres. This has
  // to damp the climb BEFORE the position is updated — damping the
  // vertical speed after the move only changes the displayed sink rate
  // and never the actual descent.
  const groundPre = groundHeight(s.pos[0], s.pos[2]);
  const rwyPre = runwayUnder(s);
  const groundYPre = rwyPre ? rwyPre.elev : groundPre;
  const heightPre = s.pos[1] - groundYPre;
  if (heightPre < 7 && heightPre > 0 && climb < 0) {
    climb *= 1 - (1 - heightPre / 7) * 0.35;
  }

  s.axes = axesFromEuler(s.heading, s.pitch, s.roll);
  const fwd = s.axes.forward;
  const move = vscale(fwd, s.speed * dt);
  move[1] = climb * dt;
  move[0] += -fwd[2] * windPush * dt;
  move[2] += fwd[0] * windPush * dt;
  s.pos = vadd(s.pos, move);
  s.verticalSpeed = climb;

  // --- Fuel and hull ------------------------------------------------------
  s.fuel = Math.max(0, s.fuel - (0.12 + s.throttle * 0.5) * dt);
  if (s.fuel <= 0 && s.throttle > 0.15) s.throttle = 0.15;

  // --- Ground -------------------------------------------------------------
  const ground = groundHeight(s.pos[0], s.pos[2]);
  const rwy = runwayUnder(s);
  const groundY = rwy ? rwy.elev : ground;
  const heightAbove = s.pos[1] - groundY;

  // Gear comes down on its own on final: near a runway, low and slow.
  // It never comes down by itself in cruise.
  if (!s.gearDown && !s.onGround && s.speed < 65 && heightAbove < 130) {
    for (const key of Object.keys(RUNWAYS)) {
      const r = RUNWAYS[key];
      const dx = Math.max(Math.abs(s.pos[0] - r.cx) - r.length / 2, 0);
      const dz = Math.max(Math.abs(s.pos[2] - r.cz) - r.width / 2, 0);
      if (Math.hypot(dx, dz) < 700) { s.gearDown = true; break; }
    }
  }

  if (heightAbove <= 0.4) {
    if (rwy && Math.abs(s.verticalSpeed) < 4.5 && s.speed > 18 &&
        Math.abs(angleWrapDeg(s.heading - rwy.heading)) < 25) {
      // Touchdown on the strip.
      if (!s.onGround) {
        s.touchdownFpm = s.verticalSpeed * 196.85;
        s.touchdownSpeed = s.speed;
        s.centerlineError = Math.abs(s.pos[2] - rwy.cz);
        s.landed = true;
      }
      s.onGround = true;
      s.pos[1] = groundY + 0.4;
      s.pitch = lerp(s.pitch, 0, Math.min(1, dt * 4));
      s.roll = lerp(s.roll, 0, Math.min(1, dt * 4));
      // Roll out: brakes and drag slow the aircraft.
      const decel = s.brakes ? 14 : 5;
      s.speed = Math.max(0, s.speed - decel * dt);
      if (s.speed < 2) s.speed = 0;
    } else if (heightAbove <= 0) {
      // Rough ground or a hard arrival: damage, then a stop.
      const hard = Math.abs(s.verticalSpeed) > 6 || s.speed > 60;
      s.hull = Math.max(0, s.hull - (hard ? 55 : 25));
      s.pos[1] = groundY + 0.4;
      s.speed = Math.max(0, s.speed - 30 * dt);
      if (s.hull <= 0 || hard) {
        s.crashed = true;
      } else {
        s.onGround = true;
      }
    }
  } else {
    s.onGround = false;
  }

  // Stay inside the archipelago.
  s.pos[0] = clamp(s.pos[0], -3100, 3300);
  s.pos[2] = clamp(s.pos[2], -3100, 3300);
  s.pos[1] = clamp(s.pos[1], 0, 900);

  return s;
}

// Landing grade from the touchdown numbers.
export function landingGrade(state) {
  const fpm = Math.abs(state.touchdownFpm);
  let grade = 'C';
  if (fpm < 180 && state.centerlineError < 4) grade = 'S';
  else if (fpm < 320 && state.centerlineError < 7) grade = 'A';
  else if (fpm < 550) grade = 'B';
  const centerBonus = Math.max(0, Math.round(100 - state.centerlineError * 8));
  const smoothBonus = Math.max(0, Math.round(100 - fpm / 6));
  return { grade, centerBonus, smoothBonus, fpm: Math.round(fpm) };
}
