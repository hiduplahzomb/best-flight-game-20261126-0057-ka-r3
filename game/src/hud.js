// hud.js — every instrument the pilot sees: compass tape, IAS and ALT
// tapes, pitch ladder, top-down minimap, the six-pack of analogue dials,
// throttle/fuel/hull bars, mission card, toasts and the landing debrief.
// Five clean edge zones; the middle of the screen stays open for flying.

import { clamp, lerp, angleWrapDeg, mat4Multiply } from './math3.js';
import { ISLANDS, RUNWAYS, groundHeight } from './world.js';
import { MISSIONS } from './missions.js';

const KT = 1.94384;      // m/s -> knots
const FT = 3.28084;      // m -> feet
const FPM = 196.85;      // m/s -> feet per minute

function setupCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function panel(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(8, 16, 26, 0.66)';
  ctx.strokeStyle = 'rgba(120, 200, 220, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();
}

function projectPoint(p, view, proj, w, h) {
  const v = mat4Multiply(proj, view);
  const x = p[0], y = p[1], z = p[2];
  const cx = v[0] * x + v[4] * y + v[8] * z + v[12];
  const cy = v[1] * x + v[5] * y + v[9] * z + v[13];
  const cw = v[3] * x + v[7] * y + v[11] * z + v[15];
  if (cw <= 0.01) return null;
  return [((cx / cw) * 0.5 + 0.5) * w, (0.5 - (cy / cw) * 0.5) * h];
}

export class Hud {
  constructor(doc) {
    this.doc = doc;
    this.compass = doc.getElementById('compass');
    this.ias = doc.getElementById('ias');
    this.alt = doc.getElementById('alt');
    this.minimap = doc.getElementById('minimap');
    this.sixpack = doc.getElementById('sixpack');
    this.overlay = doc.getElementById('overlay');
    this.missionName = doc.getElementById('mission-name');
    this.missionLine = doc.getElementById('mission-line');
    this.missionProg = doc.getElementById('mission-prog');
    this.barThr = doc.getElementById('bar-thr');
    this.barFuel = doc.getElementById('bar-fuel');
    this.barHull = doc.getElementById('bar-hull');
    this.pillFlaps = doc.getElementById('pill-flaps');
    this.pillGear = doc.getElementById('pill-gear');
    this.toast = doc.getElementById('toast');
    this.landing = doc.getElementById('landing');
    this.missionList = doc.getElementById('mission-list');
    this.camLabel = doc.getElementById('cam-label');
    this.scoreEl = doc.getElementById('score');
  }

  drawCompass(heading) {
    const c = this.compass;
    const ctx = setupCanvas(c);
    const w = c.clientWidth, h = c.clientHeight;
    ctx.clearRect(0, 0, w, h);
    panel(ctx, 0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(4, 4, w - 8, h - 8);
    ctx.clip();
    const pxPerDeg = (w - 16) / 60;
    const cx = w / 2;
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    // Snap ticks to absolute 5° steps, so the numbers are always there.
    // The old loop stepped from heading ± 40, and deg % 15 == 0 almost
    // never landed on a tick unless the heading itself was a multiple
    // of 5 — at 089° or 127° the tape was blank.
    const first = Math.floor((heading - 40) / 5) * 5;
    for (let deg = first; deg <= heading + 40; deg += 5) {
      const norm = ((deg % 360) + 360) % 360;
      const x = cx + (deg - heading) * pxPerDeg;
      const major = norm % 45 === 0;
      const mid = norm % 15 === 0;
      ctx.strokeStyle = major ? '#ffd27a' : 'rgba(200,230,240,0.7)';
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 8);
      ctx.lineTo(x, major ? 20 : mid ? 16 : 12);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = '#ffe9b0';
        if (x > 20 && x < w - 20) ctx.fillText(names[norm] || String(norm), x, 28);
      } else if (mid) {
        ctx.fillStyle = 'rgba(200,230,240,0.85)';
        ctx.font = '10px system-ui, sans-serif';
        if (x > 18 && x < w - 18) ctx.fillText(String(norm), x, 28);
        ctx.font = '600 11px system-ui, sans-serif';
      }
    }
    ctx.restore();
    // Heading readout box, below the tick labels.
    ctx.fillStyle = '#0a1420';
    ctx.strokeStyle = '#ffd27a';
    ctx.beginPath();
    ctx.roundRect(cx - 26, h - 15, 52, 14, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffd27a';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.fillText(String(Math.round(heading)).padStart(3, '0') + '°', cx, h - 4);
    // Centre caret.
    ctx.fillStyle = '#ff9a3c';
    ctx.beginPath();
    ctx.moveTo(cx - 5, 4); ctx.lineTo(cx + 5, 4); ctx.lineTo(cx, 10);
    ctx.closePath();
    ctx.fill();
  }

  drawTape(canvas, value, unit, step, majorStep, label) {
    const ctx = setupCanvas(canvas);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    panel(ctx, 0, 0, w, h);
    ctx.fillStyle = 'rgba(200,230,240,0.8)';
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, w / 2, 13);
    const cy = h / 2 + 6;
    const pxPerUnit = (h - 40) / (step * 8);
    ctx.save();
    ctx.beginPath();
    ctx.rect(4, 18, w - 8, h - 24);
    ctx.clip();
    const start = Math.floor((value - step * 4) / step) * step;
    for (let v = start; v <= value + step * 4; v += step) {
      if (v < 0) continue;
      const y = cy - (v - value) * pxPerUnit;
      const major = v % majorStep === 0;
      ctx.strokeStyle = major ? '#e8f4f8' : 'rgba(200,230,240,0.55)';
      ctx.lineWidth = major ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(major ? 20 : 15, y);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = '#dfeef4';
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'left';
        // Never draw a scale label where the centre readout box will
        // cover it: the old code let the nearest label (e.g. 400 under
        // a 440 readout) sit half under the box and read as clipped.
        if (y > 32 && y < h - 36 && Math.abs(y - cy) > 30) ctx.fillText(String(Math.round(v)), 24, y + 4);
      }
    }
    ctx.restore();
    // Centre readout.
    ctx.fillStyle = '#0a1420';
    ctx.strokeStyle = '#7fd4e8';
    ctx.beginPath();
    ctx.roundRect(6, cy - 13, w - 12, 26, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#8fe3f5';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(Math.round(value)), w / 2, cy + 5);
    ctx.fillStyle = 'rgba(200,230,240,0.8)';
    ctx.font = '9px system-ui, sans-serif';
    ctx.fillText(unit, w / 2, h - 16);
  }

  drawMinimap(flight, ms) {
    const c = this.minimap;
    const ctx = setupCanvas(c);
    const w = c.clientWidth, h = c.clientHeight;
    ctx.clearRect(0, 0, w, h);
    panel(ctx, 0, 0, w, h);
    const S = 6400, k = (w - 16) / S;
    const toX = (x) => 8 + (x + 3200) * k;
    const toY = (z) => 8 + (z + 3200) * k;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, 7);
    ctx.clip();
    ctx.fillStyle = '#0d2a3d';
    ctx.fillRect(0, 0, w, h);
    for (const isl of ISLANDS) {
      ctx.fillStyle = '#3f7d3a';
      ctx.beginPath();
      ctx.ellipse(toX(isl.x), toY(isl.z), isl.r * k * 1.15, isl.r * k * 1.15, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Runways.
    for (const key of Object.keys(RUNWAYS)) {
      const r = RUNWAYS[key];
      ctx.strokeStyle = '#f2f2f2';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(toX(r.cx - r.length / 2), toY(r.cz));
      ctx.lineTo(toX(r.cx + r.length / 2), toY(r.cz));
      ctx.stroke();
    }
    // Route: spawn → gates in order → runway threshold, dashed gold.
    {
      const route = [[ms.mission.spawn.x, ms.mission.spawn.z]];
      for (const g of ms.mission.gates) route.push([g.x, g.z]);
      const rwy = RUNWAYS[ms.mission.runway];
      const hr = (rwy.heading * Math.PI) / 180;
      route.push([rwy.cx - (rwy.length / 2) * Math.sin(hr),
        rwy.cz + (rwy.length / 2) * Math.cos(hr)]);
      ctx.strokeStyle = 'rgba(255, 196, 77, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      route.forEach(([x, z], i) => {
        if (i === 0) ctx.moveTo(toX(x), toY(z));
        else ctx.lineTo(toX(x), toY(z));
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Gates in order.
    const gates = ms.mission.gates;
    ctx.font = '700 8px system-ui, sans-serif';
    ctx.textAlign = 'center';
    gates.forEach((g, i) => {
      const passed = i < ms.gateIndex;
      ctx.fillStyle = passed ? '#7ddc7d' : i === ms.gateIndex ? '#ffc44d' : '#e8f4f8';
      ctx.beginPath();
      ctx.arc(toX(g.x), toY(g.z), passed ? 3 : 4.5, 0, Math.PI * 2);
      ctx.fill();
      if (i === ms.gateIndex) {
        ctx.strokeStyle = '#ffc44d';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(toX(g.x), toY(g.z), 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    // Plane icon.
    const px = toX(flight.pos[0]), py = toY(flight.pos[2]);
    const a = ((flight.heading - 90) * Math.PI) / 180;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ff9a3c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(a) * 8, py + Math.sin(a) * 8);
    ctx.lineTo(px + Math.cos(a + 2.5) * 6, py + Math.sin(a + 2.5) * 6);
    ctx.lineTo(px + Math.cos(a - 2.5) * 6, py + Math.sin(a - 2.5) * 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(220,240,245,0.85)';
    ctx.font = '600 8px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('MAP', 8, h - 6);
  }

  drawSixPack(flight) {
    const c = this.sixpack;
    const ctx = setupCanvas(c);
    const w = c.clientWidth, h = c.clientHeight;
    ctx.clearRect(0, 0, w, h);
    const dials = 6;
    const dw = w / dials;
    // Leave a strip under each dial face for its label: with the old
    // radius the label baseline fell past the canvas edge.
    const cx0 = dw / 2, cy = h / 2 - 2, r = Math.min(dw / 2 - 5, h / 2 - 12);
    const speedKt = flight.speed * KT;
    const altFt = flight.pos[1] * FT;
    const vsi = flight.verticalSpeed * FPM;

    const dial = (i, labelText, draw) => {
      const cx = cx0 + i * dw;
      ctx.fillStyle = 'rgba(8, 16, 26, 0.7)';
      ctx.strokeStyle = 'rgba(120, 200, 220, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      draw(cx, cy, r);
      ctx.restore();
      ctx.strokeStyle = '#9fd8e8';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      // The label lives BELOW the dial face, outside the clip: drawing
      // it inside the clipped draw() cut it off entirely.
      ctx.fillStyle = 'rgba(220,240,245,0.85)';
      ctx.font = '600 8px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(labelText, cx, cy + r + 10);
    };
    const needle = (cx, cy, r, frac, color) => {
      // Standard gauge sweep: 270°, gap at the BOTTOM — min at 7:30,
      // mid-scale at 12, max at 4:30. (Canvas y runs down, so the arc
      // starts at +0.75π, not −0.75π: the old start put the gap on the
      // left and every needle 90° off.)
      const a = Math.PI * 0.75 + frac * Math.PI * 1.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    };
    const ticks = (cx, cy, r) => {
      ctx.strokeStyle = 'rgba(220,240,245,0.75)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r * 0.88, cy + Math.sin(a) * r * 0.88);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.stroke();
      }
    };
    // Small scale numbers inside the dial face: [needle fraction, text].
    const nums = (cx, cy, r, marks) => {
      ctx.fillStyle = 'rgba(220,240,245,0.9)';
      ctx.font = '700 7px system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (const [frac, text] of marks) {
        const a = Math.PI * 0.75 + frac * Math.PI * 1.5;
        ctx.fillText(text, cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62 + 2.5);
      }
    };

    dial(0, 'KT', (cx, cy, r) => { // ASI
      ticks(cx, cy, r);
      nums(cx, cy, r, [[0, '0'], [0.25, '30'], [0.5, '60'], [0.75, '90'], [1, '120']]);
      needle(cx, cy, r, clamp(speedKt / 120, 0, 1), '#8fe3f5');
    });
    dial(1, 'ATT', (cx, cy, r) => { // Attitude
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((-flight.roll * Math.PI) / 180);
      const off = (flight.pitch / 30) * r;
      ctx.fillStyle = '#3a7bd5';
      ctx.fillRect(-r, -r + off, r * 2, r);
      ctx.fillStyle = '#c98a3d';
      ctx.fillRect(-r, off, r * 2, r);
      ctx.fillStyle = '#fff';
      ctx.fillRect(-r, off - 1, r * 2, 2);
      ctx.restore();
      ctx.fillStyle = '#ffd27a';
      ctx.fillRect(cx - r * 0.55, cy - 1.5, r * 0.4, 3);
      ctx.fillRect(cx + r * 0.15, cy - 1.5, r * 0.4, 3);
    });
    dial(2, 'ALT FT', (cx, cy, r) => { // Altimeter
      ticks(cx, cy, r);
      nums(cx, cy, r, [[0, '0'], [0.25, '3'], [0.5, '6'], [0.75, '9']]);
      needle(cx, cy, r, clamp((altFt % 1000) / 1000, 0, 1), '#8fe3f5');
    });
    dial(3, 'HDG', (cx, cy, r) => { // Heading
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((-flight.heading * Math.PI) / 180);
      ctx.fillStyle = '#dfeef4';
      ctx.font = '700 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (const [deg, t] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
        const a = ((deg - 90) * Math.PI) / 180;
        ctx.fillText(t, Math.cos(a) * r * 0.68, Math.sin(a) * r * 0.68 + 3);
      }
      ctx.restore();
      ctx.fillStyle = '#ff9a3c';
      ctx.beginPath();
      ctx.moveTo(cx - 4, cy - r + 2); ctx.lineTo(cx + 4, cy - r + 2); ctx.lineTo(cx, cy - r + 9);
      ctx.closePath();
      ctx.fill();
    });
    dial(4, 'VSI', (cx, cy, r) => { // VSI, ×100 FPM
      ticks(cx, cy, r);
      nums(cx, cy, r, [[0, '-20'], [0.5, '0'], [1, '+20']]);
      needle(cx, cy, r, clamp(vsi / 2000 / 2 + 0.5, 0, 1), vsi < -100 ? '#ffb066' : '#8fe3f5');
    });
    dial(5, 'THR', (cx, cy, r) => { // Throttle / RPM
      ticks(cx, cy, r);
      nums(cx, cy, r, [[0, '0'], [0.5, '50'], [1, '100']]);
      needle(cx, cy, r, clamp(flight.throttle, 0, 1), '#ffd27a');
    });
  }

  drawOverlay(flight, ms, view, proj, camMode) {
    const c = this.overlay;
    const ctx = setupCanvas(c);
    const w = c.clientWidth, h = c.clientHeight;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    // In the cockpit the old centre (h*0.52) put the crosshair and the
    // pitch ladder on the black glareshield, below the horizon — the
    // ladder rungs hung over the dashboard. In cockpit view the marker
    // rides up into the windscreen sky (h*0.40) and the ladder is
    // hidden: the attitude dial already shows pitch, and a ladder here
    // would only cross the gate ring. Chase view keeps the full ladder.
    const cy = camMode === 'cockpit' ? h * 0.40 : h * 0.52;
    // Pitch ladder, thin and quiet, centred where the nose points.
    // The whole ladder slides with pitch (nose up → horizon drops on
    // screen); the old code only rolled it, so it never moved.
    if (camMode !== 'cockpit') {
    ctx.save();
    const pxPerDeg = 4.5;
    ctx.translate(cx, cy + flight.pitch * pxPerDeg);
    ctx.rotate((-flight.roll * Math.PI) / 180);
    ctx.strokeStyle = 'rgba(230, 245, 250, 0.5)';
    ctx.fillStyle = 'rgba(230, 245, 250, 0.6)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-w * 0.22, 0);
    ctx.lineTo(w * 0.22, 0);
    ctx.stroke();
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    // Rungs only, no degree numbers: the 10/20 labels sat on the
    // aircraft body and the gate ring in the chase shots.
    for (const deg of [-20, -10, 10, 20]) {
      const y = -deg * pxPerDeg;
      const len = 34;
      ctx.beginPath();
      ctx.moveTo(-len, y);
      ctx.lineTo(len, y);
      ctx.stroke();
    }
    ctx.restore();
    }
    // Flight-path marker.
    ctx.strokeStyle = 'rgba(255, 210, 122, 0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy); ctx.lineTo(cx - 9, cy);
    ctx.moveTo(cx + 9, cy); ctx.lineTo(cx + 14, cy);
    ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy - 9);
    ctx.stroke();

    // Gate and runway labels, projected from the 3D world.
    const gate = ms.mission.gates[ms.gateIndex];
    // `anchor` is the 3D point the pill hangs from. For a gate it is
    // the TOP of the ring (centre + 27 m: ring radius 24 + tube), so
    // the pill floats just above the ring instead of covering its top
    // arc the way the centre-anchored pill did.
    const drawTag = (pos, text, hot, anchor) => {
      const p = projectPoint(anchor || pos, view, proj, w, h);
      if (!p || p[0] < 60 || p[0] > w - 60 || p[1] < 70 || p[1] > h - 120) return;
      ctx.font = '700 13px system-ui, sans-serif';
      const tw = ctx.measureText(text).width + 18;
      ctx.fillStyle = hot ? 'rgba(255, 196, 77, 0.92)' : 'rgba(10, 20, 32, 0.78)';
      ctx.strokeStyle = hot ? '#ff9a3c' : 'rgba(140, 210, 225, 0.6)';
      ctx.beginPath();
      ctx.roundRect(p[0] - tw / 2, p[1] - 34, tw, 22, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = hot ? '#1a1206' : '#cfeef6';
      ctx.textAlign = 'center';
      ctx.fillText(text, p[0], p[1] - 19);
      ctx.strokeStyle = hot ? '#ffc44d' : 'rgba(140, 210, 225, 0.8)';
      ctx.beginPath();
      ctx.moveTo(p[0], p[1] - 12);
      ctx.lineTo(p[0], p[1] - 2);
      ctx.stroke();
    };
    if (gate) {
      const d = Math.hypot(
        flight.pos[0] - gate.x, flight.pos[1] - gate.y, flight.pos[2] - gate.z);
      const dist = d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m';
      drawTag([gate.x, gate.y, gate.z],
        `GATE ${ms.gateIndex + 1}/${ms.mission.gates.length} · ${dist}`, true,
        [gate.x, gate.y + 27, gate.z]);
      // Next gate, smaller and cooler, so the chain reads at a glance.
      // Skip it when it would land on top of the active gate's label.
      const next = ms.mission.gates[ms.gateIndex + 1];
      if (next) {
        const p1 = projectPoint([gate.x, gate.y, gate.z], view, proj, w, h);
        const p2 = projectPoint([next.x, next.y, next.z], view, proj, w, h);
        if (p1 && p2 && Math.hypot(p1[0] - p2[0], p1[1] - p2[1]) > 70) {
          const d2 = Math.hypot(
            flight.pos[0] - next.x, flight.pos[1] - next.y, flight.pos[2] - next.z);
          drawTag([next.x, next.y, next.z],
            `GATE ${ms.gateIndex + 2} · ${Math.round(d2)} m`, false,
            [next.x, next.y + 27, next.z]);
        }
      }
    } else {
      const rwy = RUNWAYS[ms.mission.runway];
      const d = Math.hypot(flight.pos[0] - rwy.cx, flight.pos[2] - rwy.cz);
      const dist = d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m';
      // Tag the threshold you actually fly toward (east end for 270).
      const hr = (rwy.heading * Math.PI) / 180;
      drawTag([rwy.cx - (rwy.length / 2) * Math.sin(hr), rwy.elev + 20,
        rwy.cz + (rwy.length / 2) * Math.cos(hr)],
        `${rwy.name} · ${dist}`, true);
    }
  }

  update(flight, ms, camMode, now, view, proj) {
    const speedKt = flight.speed * KT;
    const altFt = flight.pos[1] * FT;
    this.drawCompass(flight.heading);
    this.drawTape(this.ias, speedKt, 'KT', 10, 20, 'IAS');
    this.drawTape(this.alt, altFt, 'FT', 100, 200, 'ALT');
    this.drawMinimap(flight, ms);
    this.drawSixPack(flight);
    this.drawOverlay(flight, ms, view, proj, camMode);

    const gate = ms.mission.gates[ms.gateIndex];
    let distText = '';
    if (gate) {
      const d = Math.hypot(
        flight.pos[0] - gate.x, flight.pos[1] - gate.y, flight.pos[2] - gate.z);
      distText = d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m';
    }
    this.missionName.textContent =
      `${ms.mission.name}  ·  ${ms.gatesPassed}/${ms.mission.gates.length} gates`;
    this.missionLine.textContent = gate
      ? `Next gate ${distText} — then land ${RUNWAYS[ms.mission.runway].name}`
      : `All gates clear — land ${RUNWAYS[ms.mission.runway].name}`;
    this.missionProg.textContent = `Fuel ${Math.round(flight.fuel)}%`;

    const setBar = (el, frac, color) => {
      el.style.width = `${clamp(frac * 100, 0, 100).toFixed(0)}%`;
      el.style.background = color;
    };
    setBar(this.barThr, flight.throttle, '#7fd4e8');
    setBar(this.barFuel, flight.fuel / 100, flight.fuel < 25 ? '#ff9a3c' : '#7ddc7d');
    setBar(this.barHull, flight.hull / 100, flight.hull < 40 ? '#ff6b5e' : '#8fe3f5');
    this.pillFlaps.textContent = `FLAPS ${flight.flaps * 15}°`;
    this.pillFlaps.classList.toggle('on', flight.flaps > 0);
    this.pillGear.textContent = flight.gearDown ? 'GEAR DOWN' : 'GEAR UP';
    this.pillGear.classList.toggle('on', flight.gearDown);
    this.camLabel.textContent = camMode === 'cockpit' ? 'COCKPIT [C]' : 'CHASE [C]';
    this.scoreEl.textContent = String(ms.score);

    if (ms.message && now - ms.messageAt < 3.5) {
      this.toast.textContent = ms.message;
      this.toast.style.opacity = '1';
    } else {
      this.toast.style.opacity = '0';
    }
  }

  showLanding(flight, gradeInfo, score) {
    this.landing.innerHTML =
      `<div class="land-title">TOUCHDOWN — GRADE ${gradeInfo.grade}</div>
       <div class="land-row">Sink rate <b>${gradeInfo.fpm} FPM</b></div>
       <div class="land-row">Centreline bonus <b>+${gradeInfo.centerBonus}</b></div>
       <div class="land-row">Smoothness <b>+${gradeInfo.smoothBonus}</b></div>
       <div class="land-row">Score <b>${score}</b></div>
       <div class="land-hint">Press R to fly again · M for another mission</div>`;
    this.landing.style.display = 'block';
  }

  hideLanding() {
    this.landing.style.display = 'none';
  }

  showMissionList(currentId, onPick) {
    const list = this.missionList;
    list.innerHTML = '<div class="ml-title">MISSIONS — pick a sortie</div>';
    const missions = MISSIONS;
    missions.forEach((m, i) => {
      const row = this.doc.createElement('button');
      row.className = 'ml-row' + (m.id === currentId ? ' ml-current' : '');
      row.textContent = `${i + 1} · ${m.name} — ${m.instruction}`;
      row.addEventListener('click', () => { onPick(m.id); });
      list.appendChild(row);
    });
    const hint = this.doc.createElement('div');
    hint.className = 'ml-hint';
    hint.textContent = 'Keys 1–5 pick a mission · M closes this list';
    list.appendChild(hint);
    list.style.display = 'block';
  }

  hideMissionList() {
    this.missionList.style.display = 'none';
  }
}
