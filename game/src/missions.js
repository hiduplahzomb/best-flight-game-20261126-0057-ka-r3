// missions.js — five short sorties across the Aurelia islands. Each one
// is a chain of golden gates ending at a runway (or a drop zone), so the
// player always sees the next gate and the destination in one glance.
// Passing a gate scores; landing well grades S/A/B and pays a bonus.

import { RUNWAYS } from './world.js';

export const MISSIONS = [
  {
    id: 1,
    name: 'Coral Mail',
    short: 'Coral Mail',
    instruction: 'Fly the gates, then land RWY 09',
    spawn: { x: -420, alt: 130, z: -20, heading: 90, speed: 52, throttle: 0.62 },
    gates: [
      { x: 150, y: 135, z: -40 },
      { x: 600, y: 125, z: 60 },
      { x: 1050, y: 140, z: -60 },
      { x: 1500, y: 130, z: 40 },
      { x: 1950, y: 120, z: 0 },
    ],
    runway: 'main',
    gateRadius: 24,
  },
  {
    id: 2,
    name: 'Ridge Slalom',
    short: 'Ridge Slalom',
    instruction: 'Weave the ridge gates, land RWY 09',
    spawn: { x: 700, alt: 170, z: 900, heading: 120, speed: 55, throttle: 0.66 },
    gates: [
      { x: 1050, y: 175, z: 1100 },
      { x: 1300, y: 185, z: 1300 },
      { x: 1550, y: 175, z: 1480 },
      { x: 1800, y: 165, z: 1620 },
      { x: 2050, y: 150, z: 1450 },
      { x: 2250, y: 120, z: 900 },
    ],
    runway: 'main',
    gateRadius: 24,
  },
  {
    id: 3,
    name: 'Mountain STOL',
    short: 'Mountain STOL',
    instruction: 'Climb the valley, land the short strip',
    spawn: { x: 2100, alt: 170, z: -300, heading: 59, speed: 50, throttle: 0.7 },
    gates: [
      { x: 2400, y: 185, z: -480 },
      { x: 2620, y: 195, z: -620 },
      { x: 2780, y: 175, z: -720 },
    ],
    runway: 'mountain',
    gateRadius: 22,
  },
  {
    id: 4,
    name: 'Lighthouse Cargo',
    short: 'Lighthouse Cargo',
    instruction: 'Drop the cargo at the light, land RWY 09',
    spawn: { x: 1500, alt: 150, z: -700, heading: 58, speed: 52, throttle: 0.64 },
    gates: [
      { x: 1900, y: 150, z: -950 },
      { x: 2150, y: 140, z: -1120 },
      { x: 2300, y: 120, z: -1250 },
    ],
    runway: 'main',
    dropZone: { x: 2300, z: -1250, radius: 90 },
    gateRadius: 24,
  },
  {
    id: 5,
    name: 'Crosswind Final',
    short: 'Crosswind Final',
    instruction: 'Hold the centreline in the crosswind',
    spawn: { x: 1500, alt: 120, z: 150, heading: 90, speed: 50, throttle: 0.55 },
    gates: [
      { x: 1950, y: 100, z: 150 },
      { x: 2120, y: 60, z: 150 },
    ],
    runway: 'main',
    gateRadius: 26,
    crosswind: true,
  },
];

export function createMissionState(mission) {
  return {
    mission,
    gateIndex: 0,
    gatesPassed: 0,
    score: 0,
    dropped: false,
    done: false,
    message: '',
    messageAt: 0,
  };
}

// Distance from the aircraft to a gate centre, in metres.
export function gateDistance(pos, gate) {
  const dx = pos[0] - gate.x, dy = pos[1] - gate.y, dz = pos[2] - gate.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Advance the mission: gate passes, cargo drop, landing, scoring.
// Returns a list of events for the HUD and the sound maker.
export function updateMission(ms, flight, now) {
  const events = [];
  const m = ms.mission;
  const gate = m.gates[ms.gateIndex];
  if (gate) {
    const d = gateDistance(flight.pos, gate);
    if (d < m.gateRadius) {
      ms.gateIndex++;
      ms.gatesPassed++;
      ms.score += 100;
      ms.message = `Gate ${ms.gatesPassed}/${m.gates.length} — nice line`;
      ms.messageAt = now;
      events.push({ type: 'gate', index: ms.gatesPassed, total: m.gates.length });
      if (ms.gateIndex >= m.gates.length) {
        ms.message = 'All gates — line up for the runway';
        ms.messageAt = now;
      }
    }
  } else if (m.dropZone && !ms.dropped) {
    const dz = Math.hypot(flight.pos[0] - m.dropZone.x, flight.pos[2] - m.dropZone.z);
    if (dz < m.dropZone.radius && flight.pos[1] < 130) {
      ms.dropped = true;
      ms.score += 150;
      ms.message = 'Cargo away — right on the light';
      ms.messageAt = now;
      events.push({ type: 'drop' });
    }
  }
  if (flight.landed && !ms.done) {
    const rwy = RUNWAYS[m.runway];
    const onTarget = Math.hypot(flight.pos[0] - rwy.cx, flight.pos[2] - rwy.cz) <
      rwy.length / 2;
    if (onTarget) {
      ms.done = true;
      const bonus = 200 + ms.gatesPassed * 25;
      ms.score += bonus;
      events.push({ type: 'landed', bonus });
    }
  }
  return events;
}

export function nextGate(ms) {
  return ms.mission.gates[ms.gateIndex] || null;
}

export function missionRunway(ms) {
  return RUNWAYS[ms.mission.runway];
}

export function missionProgress(ms) {
  const total = ms.mission.gates.length;
  return { passed: ms.gatesPassed, total, done: ms.done };
}
