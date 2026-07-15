/* ============================================================
   game.js — orchestrates everything: state, input, round flow,
   difficulty, elimination, and the requestAnimationFrame loop.
   ============================================================ */
(function () {
  "use strict";
  const C = window.CONFIG;
  const GEO = window.GEO;
  const ENT = window.ENT;
  const AI = window.AI;
  const PU = window.PU;
  const FX = window.FX;
  const RENDER = window.RENDER;
  const UI = window.UI;
  const AUDIO = window.AUDIO;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  // ------------------------------------------------------------
  // Central game state
  // ------------------------------------------------------------
  const state = {
    phase: "start",         // start | playing | roundclear | over
    round: 1,
    mode: "lives",
    oct: null,
    chars: [],
    player: null,
    ball: null,        // primary ball (also state.balls[0])
    balls: [],         // all balls in play (Multi-Ball adds extras)
    powerups: new PU.PowerUpManager(),
    fx: new FX.Particles(),
    roundStart: 0,
    best: 0,
    playerChoice: 0,
    pointer: { x: C.WORLD / 2, y: C.WORLD / 2, active: false },
    control: "pointer",   // "pointer" (mouse) | "joystick" (touch)
    // Floating joystick (touch): coords are in canvas pixels for drawing.
    joystick: { active: false, ox: 0, oy: 0, kx: 0, ky: 0, dirX: 0, dirY: 0, mag: 0, radius: 60 },
    toScreen: null,
    scale: 1,
    shake: 0,          // screen-shake magnitude (world units), decays each frame
    hitStop: 0,        // frames of frozen logic for impact punch
    ballLive: false,   // is the ball in play? (false during the pre-round countdown)
    cdSteps: [],       // "Ga! Ga! Ga! Ball!" countdown timeline
    cdIndex: 0,
  };

  state.oct = GEO.buildOctagon();

  // ------------------------------------------------------------
  // Canvas sizing (crisp on hi-dpi, square logical world)
  // ------------------------------------------------------------
  function resize() {
    const rect = canvas.getBoundingClientRect();
    // Cap the pixel ratio and absolute size: the neon effects scale with
    // pixel count, and Firefox in particular gets expensive at high res.
    // Scale both dimensions by the same factor so the canvas aspect matches
    // its CSS box (no stretching on non-square/mobile layouts).
    let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const MAX = 1100;
    const maxSide = Math.max(rect.width, rect.height) * dpr;
    if (maxSide > MAX) dpr *= MAX / maxSide;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
  }
  window.addEventListener("resize", resize);

  // ------------------------------------------------------------
  // Input — pointer position mapped back into world coordinates.
  // The inverse of render's tilt transform.
  // ------------------------------------------------------------
  function pointerToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const W = canvas.width, H = canvas.height, half = C.WORLD / 2;
    // Inverse of render's fit-and-center transform.
    const scale = Math.min(W / C.WORLD, H / (C.WORLD * C.TILT));
    const cxp = (clientX - rect.left) * (W / rect.width);
    const cyp = (clientY - rect.top) * (H / rect.height);
    const x = half + (cxp - W / 2) / scale;
    const y = half + (cyp - H / 2) / (C.TILT * scale);
    return { x, y };
  }

  // ---- Desktop: mouse position drives a follow target ----
  function onMove(clientX, clientY) {
    const w = pointerToWorld(clientX, clientY);
    state.pointer.x = w.x;
    state.pointer.y = w.y;
    state.pointer.active = true;
    state.control = "pointer";
  }
  canvas.addEventListener("mousemove", (e) => onMove(e.clientX, e.clientY));

  // ---- Touch: floating joystick that keeps the hand off the play field ----
  function clientToCanvas(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function joyStart(clientX, clientY) {
    const p = clientToCanvas(clientX, clientY);
    const j = state.joystick;
    j.active = true;
    j.ox = j.kx = p.x;
    j.oy = j.ky = p.y;
    j.dirX = j.dirY = 0;
    j.mag = 0;
    j.radius = Math.min(canvas.width, canvas.height) * 0.11;
    state.control = "joystick";
  }

  function joyMove(clientX, clientY) {
    const j = state.joystick;
    if (!j.active) return;
    const p = clientToCanvas(clientX, clientY);
    const dx = p.x - j.ox, dy = p.y - j.oy;
    const len = Math.hypot(dx, dy) || 0.0001;
    const clamped = Math.min(len, j.radius);
    j.kx = j.ox + (dx / len) * clamped;
    j.ky = j.oy + (dy / len) * clamped;
    j.mag = clamped / j.radius;
    // World direction: undo the vertical tilt squash so up/down feel natural.
    const wdx = dx, wdy = dy / C.TILT;
    const wl = Math.hypot(wdx, wdy) || 1;
    j.dirX = wdx / wl;
    j.dirY = wdy / wl;
  }

  function joyEnd() {
    const j = state.joystick;
    j.active = false;
    j.mag = 0;
    j.dirX = j.dirY = 0;
  }

  canvas.addEventListener("touchstart", (e) => {
    if (e.touches[0]) { joyStart(e.touches[0].clientX, e.touches[0].clientY); }
  }, { passive: true });
  canvas.addEventListener("touchmove", (e) => {
    if (e.touches[0]) { joyMove(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }
  }, { passive: false });
  canvas.addEventListener("touchend", joyEnd, { passive: true });
  canvas.addEventListener("touchcancel", joyEnd, { passive: true });

  // ------------------------------------------------------------
  // Round / match setup
  // ------------------------------------------------------------
  function aiCountForRound(r) {
    return Math.min(C.MAX_AI, C.START_AI + Math.floor((r - 1) / C.AI_ADD_EVERY));
  }
  function aiSpeedForRound(r) { return C.AI_SPEED_BASE + (r - 1) * C.AI_SPEED_PER_ROUND; }
  function aiAggroForRound(r) { return Math.min(0.8, C.AI_AGGRO_BASE + (r - 1) * C.AI_AGGRO_PER_ROUND); }

  function pickAIColors(n, excludeIndex) {
    const pool = C.CHARACTERS.map((c, i) => ({ c, i })).filter((o) => o.i !== excludeIndex);
    // shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0; [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n).map((o) => o.c);
  }

  function spawnRing(count) {
    // Evenly space spawn points around the pit center.
    const pts = [];
    const R = state.oct.R * 0.55;
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count - Math.PI / 2;
      pts.push({ x: state.oct.cx + Math.cos(a) * R, y: state.oct.cy + Math.sin(a) * R });
    }
    return pts;
  }

  function startMatch(choices) {
    state.playerChoice = choices.charIndex;
    state.mode = choices.mode;
    state.round = 1;
    startRound(1, true);
  }

  function startRound(round, freshMatch) {
    state.round = round;
    state.phase = "playing";

    const aiN = aiCountForRound(round);
    const total = aiN + 1;
    const spawns = spawnRing(total);

    state.chars = [];

    // Player
    const pColor = C.CHARACTERS[state.playerChoice];
    const player = new ENT.Character({
      x: spawns[0].x, y: spawns[0].y,
      color: pColor, isPlayer: true, lives: C.LIVES,
    });
    // On a fresh match, snap pointer to player start so it doesn't lurch.
    if (freshMatch) { state.pointer.x = player.x; state.pointer.y = player.y; }
    state.chars.push(player);
    state.player = player;

    // AI opponents
    const aiColors = pickAIColors(aiN, state.playerChoice);
    const aiSpeed = aiSpeedForRound(round);
    for (let i = 0; i < aiN; i++) {
      const ai = new ENT.Character({
        x: spawns[i + 1].x, y: spawns[i + 1].y,
        color: aiColors[i], isPlayer: false, lives: C.LIVES,
      });
      ai.aiSpeed = aiSpeed;
      state.chars.push(ai);
    }

    // Ball — created at center but held out of play until the countdown ends.
    const ball = new ENT.Ball(state.oct.cx, state.oct.cy);
    ball.vx = 0; ball.vy = 0;
    state.ball = ball;
    state.balls = [ball];
    state.ballLive = false;

    state.powerups.reset(round, state.oct);
    state.roundStart = performance.now();
    state.aggro = aiAggroForRound(round);

    // "Ga! Ga! Ga! Ball!" chant — players can move to position during it.
    const t0 = performance.now() + C.COUNTDOWN_START_DELAY;
    const step = C.COUNTDOWN_STEP;
    state.cdSteps = [
      { text: "GA!", at: t0, pitch: 500 },
      { text: "GA!", at: t0 + step, pitch: 560 },
      { text: "GA!", at: t0 + step * 2, pitch: 630 },
      { text: "BALL!", at: t0 + step * 3, pitch: 840, serve: true },
    ];
    state.cdIndex = 0;

    UI.showScreen(null);
    UI.setHudVisible(true);
    UI.updateHud(state);
  }

  // Drop the ball into play (called on the "BALL!" beat).
  function serveBall() {
    const b = state.ball;
    const dir = Math.random() * Math.PI * 2;
    b.x = state.oct.cx; b.y = state.oct.cy;
    b.vx = Math.cos(dir); b.vy = Math.sin(dir);
    b.setSpeed(C.BALL_BASE_SPEED + (state.round - 1) * 0.4);
    b.z = 150; b.vz = 0;      // drops in from above
    b.trail.length = 0;
    state.balls = [b];        // reset to a single ball each new round
    state.ballLive = true;
    state.roundStart = performance.now();   // speed ramp starts now
    AUDIO.setIntensity(0);
    AUDIO.startMusic();       // music kicks in as the ball enters play
  }

  // Nearest live ball to a point (AI targeting, face tracking).
  function nearestBall(x, y) {
    let best = null, bd = Infinity;
    for (const b of state.balls) {
      const d = GEO.dist(x, y, b.x, b.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // Multi-Ball: add a temporary extra ball dropping in near the collector.
  function spawnExtraBall(ch) {
    if (state.balls.length >= C.MAX_BALLS) return;
    const b = new ENT.Ball(state.oct.cx, state.oct.cy);
    const dir = Math.random() * Math.PI * 2;
    b.vx = Math.cos(dir); b.vy = Math.sin(dir);
    b.setSpeed(C.BALL_BASE_SPEED + (state.round - 1) * 0.4);
    b.z = 150; b.vz = 0;
    b.expires = performance.now() + C.MULTIBALL_MS;
    state.balls.push(b);
  }

  // Retire expired extra balls (Multi-Ball) with a little poof.
  function manageBalls() {
    const now = performance.now();
    for (let i = state.balls.length - 1; i >= 1; i--) {  // never remove primary (0)
      const b = state.balls[i];
      if (b.expires && now > b.expires) {
        state.fx.poof(b.x, b.y, "#ff8a3d");
        state.balls.splice(i, 1);
      }
    }
  }

  // The ball always coasts down toward this low, safe drift speed (well below
  // HIT_SPEED) if it isn't struck — a neglected ball becomes slow and harmless.
  function speedFloor() {
    return C.BALL_MIN_SPEED;
  }

  // Bat launch speed for the current round: grows with round number and with
  // time elapsed in the round. This is what makes the pace climb over the
  // round, while the ball still decelerates between hits.
  function launchBase() {
    const elapsed = (performance.now() - state.roundStart) / 1000;
    return Math.min(
      C.BALL_MAX_SPEED,
      C.HIT_LAUNCH + (state.round - 1) * C.LAUNCH_PER_ROUND + elapsed * C.LAUNCH_RAMP_PER_SEC
    );
  }

  // ------------------------------------------------------------
  // Damage / elimination
  // ------------------------------------------------------------
  // A damaging ball contact. If the ball is a Bomb Ball, it detonates for an
  // area knockout; otherwise it's a normal single hit.
  function applyDamage(target, ball) {
    if (!target.alive) return;
    if (ball && ball.bomb) { detonateBomb(ball); return; }
    hitChar(target);
  }

  // Resolve a single hit on one character (shield / lives / elimination).
  function hitChar(target) {
    if (!target.alive) return;
    const now = performance.now();

    // Shield blocks one hit (pops with a little feedback, no damage).
    if (target.shield) {
      target.shield = false;
      target.hitFlash = 8;
      state.shake = Math.max(state.shake, C.SHAKE_HIT * 0.5);
      state.fx.shockwave(target.x, target.y, "#4dc3ff");
      AUDIO.shieldBlock();
      return;
    }

    target.hitFlash = 10;
    target.dizzyUntil = now + 900;
    state.fx.shockwave(target.x, target.y, "#ffffff");

    if (state.mode === "lives") {
      target.lives--;
      if (target.lives <= 0) { eliminate(target); return; }
      state.shake = C.SHAKE_HIT;
      state.hitStop = Math.max(state.hitStop, C.HITSTOP_HIT);
    } else {
      eliminate(target);
    }
  }

  // Bomb Ball: knock out everyone within the blast radius, then disarm all balls.
  function detonateBomb(ball) {
    state.fx.poof(ball.x, ball.y, "#ff7722");
    state.fx.shockwave(ball.x, ball.y, "#ff5522", true);
    state.fx.shockwave(ball.x, ball.y, "#ffd15a", true);
    state.shake = C.SHAKE_ELIM * 1.4;
    state.hitStop = Math.max(state.hitStop, C.HITSTOP_ELIM);
    AUDIO.eliminate();
    for (const ch of state.chars) {
      if (ch.alive && GEO.dist(ball.x, ball.y, ch.x, ch.y) < C.BOMB_RADIUS) hitChar(ch);
    }
    for (const b of state.balls) b.bomb = false;
  }

  function eliminate(ch) {
    ch.alive = false;
    state.fx.poof(ch.x, ch.y, ch.color.fill);
    state.fx.shockwave(ch.x, ch.y, ch.color.fill, true);
    state.shake = C.SHAKE_ELIM;
    state.hitStop = Math.max(state.hitStop, C.HITSTOP_ELIM);
    AUDIO.eliminate();
    AUDIO.duck();
    if (ch.isPlayer) UI.toast("OUT!", 1000);
  }

  function checkEnd() {
    const alive = state.chars.filter((c) => c.alive);
    const playerAlive = state.player.alive;

    if (!playerAlive) {
      // Run over.
      state.phase = "over";
      state.best = Math.max(state.best, state.round);
      AUDIO.stopMusic();
      UI.setHudVisible(false);
      setTimeout(() => {
        AUDIO.gameOver();
        UI.showGameOver(state.round, state.best);
      }, 900);
      return;
    }
    if (alive.length <= 1) {
      // Player is last standing -> round clear.
      state.phase = "roundclear";
      state.best = Math.max(state.best, state.round);
      const nextRound = state.round + 1;
      const newPowers = state.powerups.newlyUnlockedAt(nextRound);
      AUDIO.stopMusic();
      AUDIO.roundClear();
      UI.setHudVisible(false);
      setTimeout(() => UI.showRoundClear(nextRound, newPowers), 700);
    }
  }

  // ------------------------------------------------------------
  // Per-frame updates
  // ------------------------------------------------------------
  function updatePlaying() {
    const player = state.player;
    const now = performance.now();

    // Pre-round countdown: chant beats + hold the ball until "BALL!".
    if (!state.ballLive) {
      while (state.cdIndex < state.cdSteps.length && now >= state.cdSteps[state.cdIndex].at) {
        const s = state.cdSteps[state.cdIndex++];
        UI.toast(s.text, C.COUNTDOWN_STEP - 60);
        AUDIO.count(s.pitch, !!s.serve);
        if (s.serve) serveBall();
      }
    }

    // Move the player: joystick (touch, velocity-based) or mouse follow.
    if (player.alive) {
      const j = state.joystick;
      if (state.control === "joystick" && j.active && j.mag > 0.05) {
        const spd = player.speed() * j.mag;
        player.x += j.dirX * spd;
        player.y += j.dirY * spd;
      } else if (state.control === "pointer") {
        const dx = state.pointer.x - player.x;
        const dy = state.pointer.y - player.y;
        const d = Math.hypot(dx, dy);
        const step = Math.min(d, player.speed());
        if (d > 0.01) { player.x += (dx / d) * step; player.y += (dy / d) * step; }
      }
      const c = GEO.clampCircleInside(state.oct, player.x, player.y, player.r);
      player.x = c.x; player.y = c.y;
    }

    // AI — each opponent reacts to the ball nearest to it.
    for (const ch of state.chars) {
      if (ch.isPlayer || !ch.alive) continue;
      AI.updateAI(ch, nearestBall(ch.x, ch.y), state.chars, state.oct, state.aggro);
    }

    ENT.separateChars(state.chars);

    // Ball physics only runs once the ball is in play.
    if (state.ballLive) {
      const magnetHolders = state.chars.filter((c) => c.alive && c.magnet);
      const floor = speedFloor();
      const lb = launchBase();
      for (const b of state.balls) {
        // Ball size (giant power-up)
        b.r = b.giant ? b.baseR * C.BALL_GIANT_SCALE : b.baseR;
        const events = ENT.stepBall(b, state.chars, state.oct, floor, lb, magnetHolders, state.fx, AUDIO);
        for (const ev of events) applyDamage(ev.target, b);
      }
      manageBalls();

      // Drive music tempo from the fastest ball on the court.
      let maxSpd = 0;
      for (const b of state.balls) maxSpd = Math.max(maxSpd, b.speed);
      const lo = C.HIT_SPEED * 0.6, hi = C.BALL_MAX_SPEED;
      AUDIO.setIntensity((maxSpd - lo) / (hi - lo));
    }

    // Power-ups
    state.powerups.update(state.oct);
    const grabs = state.powerups.checkPickups(
      state.chars, state.balls, state.mode, state.fx, AUDIO, { addBall: spawnExtraBall }
    );
    for (const g of grabs) {
      if (g.char.isPlayer) UI.toast(C.POWERUPS[g.id].label + "!", 1100, "power");
    }

    trackMotion(true);
    state.fx.update();

    UI.updateHud(state);
    checkEnd();
  }

  // Record each character's per-frame displacement (drives squash-and-stretch)
  // and kick up dust when they're dashing.
  function trackMotion(spawnDust) {
    for (const ch of state.chars) {
      if (!ch.alive) { ch.dispX = 0; ch.dispY = 0; continue; }
      ch.dispX = ch.x - ch.px;
      ch.dispY = ch.y - ch.py;
      ch.px = ch.x;
      ch.py = ch.y;
      if (spawnDust) {
        const spd = Math.hypot(ch.dispX, ch.dispY);
        if (spd > C.DUST_SPEED && Math.random() < 0.5) {
          state.fx.dust(ch.x - ch.dispX * 0.6, ch.y + ch.r * 0.3);
        }
      }
    }
  }

  // Idle demo scene behind the start screen (ball + wandering AI, no stakes).
  function setupDemo() {
    state.chars = [];
    const colors = pickAIColors(4, -1);
    const spawns = spawnRing(4);
    for (let i = 0; i < 4; i++) {
      const ai = new ENT.Character({ x: spawns[i].x, y: spawns[i].y, color: colors[i], isPlayer: false, lives: 99 });
      ai.aiSpeed = 4.2;
      state.chars.push(ai);
    }
    const ball = new ENT.Ball(state.oct.cx, state.oct.cy);
    ball.setSpeed(4);
    state.ball = ball;
    state.balls = [ball];
    state.ballLive = true;  // demo ball is always in play
    state.player = state.chars[0]; // placeholder so HUD calls are safe (HUD hidden anyway)
  }

  function updateDemo() {
    for (const ch of state.chars) AI.updateAI(ch, nearestBall(ch.x, ch.y), state.chars, state.oct, 0.15);
    ENT.separateChars(state.chars);
    for (const b of state.balls) {
      b.r = b.baseR;
      ENT.stepBall(b, state.chars, state.oct, C.BALL_MIN_SPEED, C.HIT_LAUNCH, [], state.fx, null);
    }
    trackMotion(true);
    state.fx.update();
  }

  // ------------------------------------------------------------
  // Main loop
  // ------------------------------------------------------------
  function frame() {
    // Shake always decays in real time, even during a hit-stop freeze.
    state.shake *= C.SHAKE_DECAY;
    if (state.shake < 0.15) state.shake = 0;

    if (state.hitStop > 0) {
      // Frozen frame for impact punch — keep drawing but skip logic.
      state.hitStop--;
    } else if (state.phase === "playing") {
      updatePlaying();
    } else {
      updateDemo();
    }

    RENDER.draw(ctx, state);
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------
  // UI wiring
  // ------------------------------------------------------------
  UI.init({
    onStart(choices) {
      AUDIO.init();
      AUDIO.resume();
      // Music now starts when the ball drops in (serveBall), so the
      // "Ga! Ga! Ga! Ball!" chant plays clean.
      startMatch(choices);
    },
    onNext() { startRound(state.round + 1); },
    onPlayAgain() {
      // Return to start screen so the player can re-pick.
      state.phase = "start";
      UI.setHudVisible(false);
      UI.showScreen("screen-start");
      setupDemo();
    },
    onToggleMute() {
      AUDIO.setMuted(!AUDIO.muted);
      UI.setMuteIcon(AUDIO.muted);
    },
    onVolume(v) {
      AUDIO.setVolume(v);
      if (AUDIO.muted && v > 0) { AUDIO.setMuted(false); UI.setMuteIcon(false); }
    },
  });

  // ------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------
  resize();
  setupDemo();
  UI.showScreen("screen-start");
  requestAnimationFrame(frame);
})();
