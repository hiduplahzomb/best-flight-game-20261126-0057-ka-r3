// audio.js — procedural sound for Aurelia Wings: a twin-prop drone built
// from detuned oscillators plus filtered wind noise, and short blips for
// gates, drops and touchdowns. No audio files; everything is synthesised
// in the browser, and it stays silent until the player first interacts.

export function createAudio() {
  let ctx = null;
  let engineOsc = [];
  let engineGain = null;
  let windSrc = null;
  let windGain = null;
  let windFilter = null;
  let started = false;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineGain.connect(ctx.destination);
    // Two low oscillators, slightly detuned: the prop beat.
    for (const freq of [58, 58.7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 320;
      o.connect(g);
      g.connect(lp);
      lp.connect(engineGain);
      o.start();
      engineOsc.push(o);
    }
    // Wind: looped noise through a band-pass filter.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    windSrc = ctx.createBufferSource();
    windSrc.buffer = buf;
    windSrc.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 700;
    windFilter.Q.value = 0.6;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(ctx.destination);
    windSrc.start();
    return ctx;
  }

  return {
    // Call from a user gesture (click or keypress) to unlock sound.
    unlock() {
      const c = ensure();
      if (c && c.state === 'suspended') c.resume();
      started = true;
    },
    // Per-frame: throttle sets the drone, speed sets the wind.
    update(throttle, speed, onGround) {
      if (!started || !ctx) return;
      const t = ctx.currentTime;
      engineGain.gain.setTargetAtTime(onGround && speed < 3 ? 0.0 : 0.05 + throttle * 0.10, t, 0.1);
      const freq = 52 + throttle * 46;
      engineOsc.forEach((o, i) => o.frequency.setTargetAtTime(freq + i * 0.7, t, 0.1));
      windGain.gain.setTargetAtTime(Math.min(0.12, speed * 0.0016), t, 0.15);
      windFilter.frequency.setTargetAtTime(400 + speed * 12, t, 0.2);
    },
    blip(freq, dur = 0.12, type = 'sine', vol = 0.18) {
      if (!started || !ctx) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + dur);
    },
    gate() {
      this.blip(880, 0.1);
      setTimeout(() => this.blip(1318, 0.16), 90);
    },
    touchdown() {
      this.blip(120, 0.25, 'triangle', 0.3);
    },
  };
}
