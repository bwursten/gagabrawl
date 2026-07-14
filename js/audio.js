/* ============================================================
   audio.js — fully procedural chiptune + SFX via Web Audio API.
   No asset files: everything is synthesized in-browser, so the game
   stays self-contained and works offline / inside an iframe.
   Exposed on window.AUDIO (a single instance).
   ============================================================ */
(function () {
  "use strict";

  class GameAudio {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.musicGain = null;
      this.sfxGain = null;
      this.muted = false;
      this.volume = 0.6;
      this.playing = false;
      this._timer = null;
      this._nextNoteTime = 0;
      this._step = 0;
      this._tempo = 126;          // current bpm (eased toward target)
      this._targetTempo = 126;    // driven by ball speed via setIntensity()
      this._baseTempo = 126;
      this._maxTempo = 182;
      this._musicBase = 0.35;     // resting music gain (for ducking)
      this._lastWall = 0;
    }

    // Must be called from a user gesture (e.g., Start button) to satisfy autoplay policy.
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;

      // Master compressor/limiter so overlapping SFX + music don't clip.
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.knee.value = 24;
      this.comp.ratio.value = 4;
      this.comp.attack.value = 0.003;
      this.comp.release.value = 0.2;
      this.master.connect(this.comp);
      this.comp.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this._musicBase;
      this.musicGain.connect(this.master);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.9;
      this.sfxGain.connect(this.master);
    }

    resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); }

    setVolume(v) {
      this.volume = v;
      if (this.master) this.master.gain.value = this.muted ? 0 : v;
    }
    setMuted(m) {
      this.muted = m;
      if (this.master) this.master.gain.value = m ? 0 : this.volume;
    }

    // ---------------- Music scheduler ----------------
    startMusic() {
      if (!this.ctx || this.playing) return;
      this.playing = true;
      this._step = 0;
      this._nextNoteTime = this.ctx.currentTime + 0.06;
      const loop = () => {
        if (!this.playing) return;
        // Wide lookahead so a busy main thread (frame hitches) doesn't
        // starve the scheduler and cause music gaps / stutter.
        const ahead = 0.28;
        while (this._nextNoteTime < this.ctx.currentTime + ahead) {
          // Ease current tempo toward the gameplay-driven target.
          this._tempo += (this._targetTempo - this._tempo) * 0.05;
          this._scheduleStep(this._step, this._nextNoteTime);
          const spb = 60 / this._tempo;
          this._nextNoteTime += spb / 4;      // 16th notes
          this._step = (this._step + 1) % 32;
        }
        this._timer = setTimeout(loop, 25);
      };
      loop();
    }

    stopMusic() {
      this.playing = false;
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    }

    // 0 = calm, 1 = frantic. Drives music tempo (called from gameplay).
    setIntensity(x) {
      x = Math.max(0, Math.min(1, x));
      this._targetTempo = this._baseTempo + (this._maxTempo - this._baseTempo) * x;
    }

    // Briefly dip the music for impact punch (used on eliminations).
    duck() {
      if (!this.ctx || !this.musicGain) return;
      const t = this.ctx.currentTime;
      const g = this.musicGain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0.09, t + 0.03);
      g.linearRampToValueAtTime(this._musicBase, t + 0.55);
    }

    _scheduleStep(step, t) {
      // Two-bar chord loop (I - V - vi - IV in a chirpy major key).
      const roots = [0, 7, 9, 5]; // semitone offsets from C
      const bar = Math.floor(step / 8) % 4;
      const root = 48 + roots[bar]; // MIDI-ish, low
      const scale = [0, 2, 4, 5, 7, 9, 11];

      // Bass on the beat
      if (step % 4 === 0) {
        this._blip(this._mtof(root - 12), t, 0.18, "triangle", 0.5);
      }
      // Arpeggio lead (square) — bouncy 8th/16th pattern
      const arpPat = [0, 4, 7, 4, 2, 5, 7, 9];
      const idx = step % 8;
      const deg = arpPat[idx];
      if (step % 2 === 0 || Math.random() < 0.5) {
        const note = root + 12 + deg;
        this._blip(this._mtof(note), t, 0.12, "square", 0.22);
      }
      // Hi-hat (filtered noise) on offbeats
      if (step % 2 === 1) this._hat(t, 0.03);
      // Kick-ish on strong beats
      if (step % 8 === 0) this._kick(t);
    }

    _mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

    _blip(freq, t, dur, type, vol) {
      if (!this.ctx) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.musicGain);
      o.start(t); o.stop(t + dur + 0.02);
    }

    _hat(t, dur) {
      if (!this.ctx) return;
      const src = this._noise(dur);
      const hp = this.ctx.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = 7000;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(hp); hp.connect(g); g.connect(this.musicGain);
      src.start(t); src.stop(t + dur + 0.01);
    }

    _kick(t) {
      if (!this.ctx) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(g); g.connect(this.musicGain);
      o.start(t); o.stop(t + 0.16);
    }

    _noise(dur) {
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      return src;
    }

    // ---------------- SFX ----------------
    // A clean, satisfying "pock" for a safe bat (no damage).
    hitBat(speed) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "triangle";
      const f = 520 + Math.min(520, speed * 45);
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.08);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      o.connect(g); g.connect(this.sfxGain);
      o.start(t); o.stop(t + 0.12);
      // click transient for "snap"
      const n = this._noise(0.02);
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0.14, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      n.connect(ng); ng.connect(this.sfxGain);
      n.start(t); n.stop(t + 0.03);
    }

    // A harsh, low "crunch" when a hit actually damages someone.
    hitDamage(speed) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(330, t);
      o.frequency.exponentialRampToValueAtTime(85, t + 0.18);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.34, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g); g.connect(this.sfxGain);
      o.start(t); o.stop(t + 0.22);
      // gritty band-passed noise burst
      const n = this._noise(0.14);
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 800;
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0.3, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      n.connect(bp); bp.connect(ng); ng.connect(this.sfxGain);
      n.start(t); n.stop(t + 0.16);
    }

    // Bright metallic "ting" when a Shield Bubble blocks a hit.
    shieldBlock() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      [1568, 2093].forEach((f, i) => {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = "square";
        o.frequency.value = f * (i ? 1.003 : 1);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.2, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
        o.connect(g); g.connect(this.sfxGain);
        o.start(t); o.stop(t + 0.26);
      });
    }

    // Backward-compatible alias.
    hit(speed) { this.hitBat(speed); }

    wallBounce(speed) {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      if (now - this._lastWall < 0.04) return; // throttle
      this._lastWall = now;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(180 + speed * 20, now);
      o.frequency.exponentialRampToValueAtTime(90, now + 0.08);
      g.gain.setValueAtTime(0.18, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
      o.connect(g); g.connect(this.sfxGain);
      o.start(now); o.stop(now + 0.12);
    }

    pickup() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const notes = [523, 659, 784, 1047];
      notes.forEach((f, i) => {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = "square";
        const tt = t + i * 0.05;
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, tt);
        g.gain.exponentialRampToValueAtTime(0.3, tt + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.12);
        o.connect(g); g.connect(this.sfxGain);
        o.start(tt); o.stop(tt + 0.14);
      });
    }

    eliminate() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      // Descending "poof" plus a noise burst
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(700, t);
      o.frequency.exponentialRampToValueAtTime(120, t + 0.35);
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(g); g.connect(this.sfxGain);
      o.start(t); o.stop(t + 0.42);

      const src = this._noise(0.25);
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 1200;
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0.25, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      src.connect(bp); bp.connect(ng); ng.connect(this.sfxGain);
      src.start(t); src.stop(t + 0.26);
    }

    // Countdown chant beat. `big` = the final "BALL!" (adds a drop thud).
    count(freq, big) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = big ? "square" : "triangle";
      o.frequency.setValueAtTime(freq, t);
      if (big) o.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.12);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(big ? 0.4 : 0.26, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (big ? 0.34 : 0.18));
      o.connect(g); g.connect(this.sfxGain);
      o.start(t); o.stop(t + 0.4);
      if (big) {
        // ball drops in — a low thud
        const o2 = this.ctx.createOscillator();
        const g2 = this.ctx.createGain();
        o2.type = "sine";
        o2.frequency.setValueAtTime(300, t + 0.05);
        o2.frequency.exponentialRampToValueAtTime(80, t + 0.32);
        g2.gain.setValueAtTime(0.36, t + 0.05);
        g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
        o2.connect(g2); g2.connect(this.sfxGain);
        o2.start(t + 0.05); o2.stop(t + 0.36);
      }
    }

    roundClear() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const notes = [523, 659, 784, 1047, 1319];
      notes.forEach((f, i) => {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = "square";
        const tt = t + i * 0.09;
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, tt);
        g.gain.exponentialRampToValueAtTime(0.32, tt + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.22);
        o.connect(g); g.connect(this.sfxGain);
        o.start(tt); o.stop(tt + 0.24);
      });
    }

    gameOver() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const notes = [523, 494, 440, 349];
      notes.forEach((f, i) => {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = "triangle";
        const tt = t + i * 0.16;
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, tt);
        g.gain.exponentialRampToValueAtTime(0.3, tt + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.3);
        o.connect(g); g.connect(this.sfxGain);
        o.start(tt); o.stop(tt + 0.32);
      });
    }
  }

  window.AUDIO = new GameAudio();
})();
