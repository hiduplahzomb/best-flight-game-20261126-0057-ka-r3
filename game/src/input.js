// input.js — keyboard and mouse for Aurelia Wings. Arrows or WASD fly,
// Shift / Ctrl work the throttle, F flaps, G gear, C camera, M missions,
// R resets the sortie, Space brakes, 1–5 pick a mission. The mouse drags
// as a yoke; the wheel zooms the chase camera.

export function createInput(canvas) {
  const keys = new Set();
  const input = {
    rollLeft: false,
    rollRight: false,
    pitchUp: false,
    pitchDown: false,
    throttleUp: false,
    throttleDown: false,
    throttleSet: null,
    brakes: false,
    flapsToggle: false,
    gearToggle: false,
    mousePitch: 0,
    mouseRoll: 0,
    zoom: 0,
  };
  let dragging = false;
  let lastX = 0, lastY = 0;
  const pressed = new Set(); // one-shot keys, consumed by the game loop
  const edge = new Set();    // keys the loop should act on once

  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) {
      e.preventDefault();
    }
    if (!keys.has(k)) edge.add(k);
    keys.add(k);
    pressed.add(k);
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.key.toLowerCase());
  });
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    input.mouseRoll += dx * 0.02;
    input.mousePitch -= dy * 0.02;
  });
  const endDrag = () => { dragging = false; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    input.zoom += Math.sign(e.deltaY) * 0.12;
  }, { passive: false });

  // Read the held keys into the per-frame input state. Call once a frame.
  input.poll = () => {
    input.rollLeft = keys.has('arrowleft') || keys.has('a');
    input.rollRight = keys.has('arrowright') || keys.has('d');
    input.pitchUp = keys.has('arrowdown') || keys.has('s');
    input.pitchDown = keys.has('arrowup') || keys.has('w');
    input.throttleUp = keys.has('shift');
    input.throttleDown = keys.has('control');
    input.brakes = keys.has(' ');
    if (edge.has('f')) input.flapsToggle = true;
    if (edge.has('g')) input.gearToggle = true;
    edge.clear();
  };

  // One-shot actions the game loop consumes (camera, missions, reset).
  input.takeAction = () => {
    const out = { camera: false, missions: false, reset: false, mission: 0 };
    if (pressed.has('c')) out.camera = true;
    if (pressed.has('m')) out.missions = true;
    if (pressed.has('r')) out.reset = true;
    for (let i = 1; i <= 5; i++) {
      if (pressed.has(String(i))) out.mission = i;
    }
    pressed.clear();
    return out;
  };

  return input;
}
