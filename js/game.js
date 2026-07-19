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
  const OBS = window.OBS;
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
    obstacles: new window.OBS.ObstacleManager(),
    fx: new FX.Particles(),
    roundStart: 0,
    best: 0,
    playerChoice: 0,
    pointer: { x: C.WORLD / 2, y: C.WORLD / 2, active: false },
    control: "pointer",   // "pointer" (mouse) | "drag" (touch)
    // Touch relative-drag: brawler moves in the direction the finger slides.
    touch: { active: false, x: 0, y: 0 },  // current finger pos (canvas px) for feedback
    dragDX: 0, dragDY: 0,                  // world-space drag accumulated since last frame
    dragVX: 0, dragVY: 0,                  // smoothed touch velocity (for natural accel/glide)
    toScreen: null,
    scale: 1,
    world: { w: C.WORLD, h: C.WORLD },   // logical world size (height grows on mobile portrait)
    tilt: C.TILT,                         // perspective squash; flatter on mobile so it isn't squished
    shake: 0,          // screen-shake magnitude (world units), decays each frame
    hitStop: 0,        // frames of frozen logic for impact punch
    ballLive: false,   // is the ball in play? (false during the pre-round countdown)
    cdSteps: [],       // "Ga! Ga! Ga! Ball!" countdown timeline
    cdIndex: 0,
    difficulty: "normal",
    diff: null,        // resolved CONFIG.DIFFICULTIES entry
    paused: false,
    combo: { count: 0, time: 0 },  // player knockout streak
    score: 0,          // run score (KOs + combos + round survival)
    kos: 0,            // rivals the player has knocked out this run
    startBest: null,   // best for the chosen config, snapshotted at match start
  };
  state.diff = C.DIFFICULTIES[state.difficulty];

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

    // Recompute the logical world to fit the canvas aspect, then rebuild the pit.
    updateWorld();
  }

  // The world stays square (even octagon) on every device; mobile just uses a
  // slimmer wall margin so the pit fills more of a phone's width.
  function updateWorld() {
    const mobile = window.matchMedia("(max-width: 820px), (pointer: coarse)").matches;
    const margin = mobile ? C.PIT_MARGIN_MOBILE : C.PIT_MARGIN;
    state.tilt = mobile ? C.TILT_MOBILE : C.TILT;
    state.world = { w: C.WORLD, h: C.WORLD };
    state.oct = GEO.buildOctagon(C.WORLD, C.WORLD, margin);
  }
  window.addEventListener("resize", resize);

  // ------------------------------------------------------------
  // Input — pointer position mapped back into world coordinates.
  // The inverse of render's tilt transform.
  // ------------------------------------------------------------
  function pointerToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const W = canvas.width, H = canvas.height;
    const ww = state.world.w, wh = state.world.h;
    // Inverse of render's fit-and-center transform (aspect-aware).
    const tilt = state.tilt || C.TILT;
    const scale = Math.min(W / ww, H / (wh * tilt));
    const cxp = (clientX - rect.left) * (W / rect.width);
    const cyp = (clientY - rect.top) * (H / rect.height);
    const x = ww / 2 + (cxp - W / 2) / scale;
    const y = wh / 2 + (cyp - H / 2) / (tilt * scale);
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

  // ---- Touch: relative drag — the brawler moves in the direction the finger
  // slides (from anywhere on screen, including outside the court), amplified. ----
  function clientToCanvas(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  let lastTX = 0, lastTY = 0;

  function dragStart(clientX, clientY) {
    const p = clientToCanvas(clientX, clientY);
    lastTX = p.x; lastTY = p.y;
    state.touch.active = true;
    state.touch.x = p.x; state.touch.y = p.y;
    state.control = "drag";
  }

  function dragMove(clientX, clientY) {
    if (!state.touch.active) return;
    const p = clientToCanvas(clientX, clientY);
    const tilt = state.tilt || C.TILT;
    const scale = Math.min(canvas.width / state.world.w, canvas.height / (state.world.h * tilt));
    // Screen delta -> world delta (undo tilt on Y), amplified.
    state.dragDX += ((p.x - lastTX) / scale) * C.DRAG_SENS;
    state.dragDY += ((p.y - lastTY) / (scale * tilt)) * C.DRAG_SENS;
    lastTX = p.x; lastTY = p.y;
    state.touch.x = p.x; state.touch.y = p.y;
  }

  function dragEnd() {
    state.touch.active = false;
  }

  canvas.addEventListener("touchstart", (e) => {
    if (e.touches[0]) { dragStart(e.touches[0].clientX, e.touches[0].clientY); }
  }, { passive: true });
  canvas.addEventListener("touchmove", (e) => {
    if (e.touches[0]) { dragMove(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }
  }, { passive: false });
  canvas.addEventListener("touchend", dragEnd, { passive: true });
  canvas.addEventListener("touchcancel", dragEnd, { passive: true });

  // ------------------------------------------------------------
  // Round / match setup
  // ------------------------------------------------------------
  function aiCountForRound(r) {
    return Math.min(C.MAX_AI, C.START_AI + Math.floor((r - 1) / C.AI_ADD_EVERY));
  }
  function aiSpeedForRound(r) { return (C.AI_SPEED_BASE + (r - 1) * C.AI_SPEED_PER_ROUND) * state.diff.aiSpeed; }
  function aiAggroForRound(r) { return Math.min(0.85, (C.AI_AGGRO_BASE + (r - 1) * C.AI_AGGRO_PER_ROUND) * state.diff.aiAggro); }

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
    state.difficulty = choices.difficulty || "normal";
    state.diff = C.DIFFICULTIES[state.difficulty] || C.DIFFICULTIES.normal;
    state.round = 1;
    state.score = 0;
    state.kos = 0;
    state.startBest = getBest();   // remember the bar to beat for "NEW BEST"
    startRound(1, true);
  }

  // Add (or subtract) points from the run score, scaled by the difficulty's
  // score multiplier. Penalties may be negative; the total never drops below 0.
  function addScore(pts) {
    state.score = Math.max(0, state.score + Math.round(pts * (state.diff.score || 1)));
  }

  function startRound(round, freshMatch) {
    state.round = round;
    state.phase = "playing";

    const aiN = aiCountForRound(round);
    const total = aiN + 1;
    const spawns = spawnRing(total);

    // Every BOSS_EVERY rounds, one opponent is a tougher "champion" brawler.
    state.isBoss = round % C.BOSS_EVERY === 0;

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
      // On a boss round, promote the first opponent to a champion: bigger,
      // faster, tougher, and more aggressive.
      if (state.isBoss && i === 0) {
        ai.isBoss = true;
        ai.r = C.CHAR_RADIUS * C.BOSS.sizeMult;
        ai.aiSpeed = aiSpeed * C.BOSS.speedMult;
        if (state.mode === "lives") ai.lives = C.LIVES + C.BOSS.extraLives;
        ai.name = "Champion";
      }
      state.chars.push(ai);
    }

    // Ball — created at center but held out of play until the countdown ends.
    const ball = new ENT.Ball(state.oct.cx, state.oct.cy);
    ball.vx = 0; ball.vy = 0;
    state.ball = ball;
    state.balls = [ball];
    state.ballLive = false;

    state.powerups.reset(round, state.oct, state.diff.powerEvery);
    state.obstacles.reset(round, state.oct);
    state.roundStart = performance.now();
    state.aggro = aiAggroForRound(round);
    state.combo.count = 0; state.combo.time = 0;

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
      (C.HIT_LAUNCH + (state.round - 1) * C.LAUNCH_PER_ROUND + elapsed * C.LAUNCH_RAMP_PER_SEC) * state.diff.launch
    );
  }

  // ------------------------------------------------------------
  // Damage / elimination
  // ------------------------------------------------------------
  // A damaging ball contact. If the ball is a Bomb Ball, it detonates for an
  // area knockout; otherwise it's a normal single hit.
  function applyDamage(target, ball, attacker) {
    if (!target.alive) return;
    // Prefer the attacker captured at impact (ball.lastHitter gets reassigned to
    // the victim during the collision, so reading it here would be wrong).
    if (attacker === undefined) attacker = ball ? ball.lastHitter : null;
    if (ball && ball.bomb) { detonateBomb(ball, attacker); return; }
    hitChar(target, attacker);
  }

  // Resolve a single hit on one character (shield / lives / elimination).
  // `attacker` is the character whose shot caused it (for combo credit).
  function hitChar(target, attacker) {
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

    // Getting hit costs the player points (every hit taken, fatal or not).
    // Scale the penalty by difficulty and show the actual amount lost.
    if (target.isPlayer) {
      const pen = Math.round(C.SCORE.HIT_TAKEN * (state.diff.score || 1));
      state.score = Math.max(0, state.score - pen);
      UI.toast("-" + pen, 800, "penalty");
    }

    if (state.mode === "lives") {
      target.lives--;
      if (target.lives <= 0) { eliminate(target, attacker); return; }
      // Non-fatal hit landed by the player on a rival: award chip-damage points
      // (knockouts are scored separately in creditCombo).
      if (attacker && attacker.isPlayer && !target.isPlayer) addScore(C.SCORE.HIT);
      state.shake = C.SHAKE_HIT;
      state.hitStop = Math.max(state.hitStop, C.HITSTOP_HIT);
    } else {
      eliminate(target, attacker);
    }
  }

  // Bomb Ball: knock out everyone within the blast radius, then disarm all balls.
  function detonateBomb(ball, attacker) {
    state.fx.poof(ball.x, ball.y, "#ff7722");
    state.fx.shockwave(ball.x, ball.y, "#ff5522", true);
    state.fx.shockwave(ball.x, ball.y, "#ffd15a", true);
    state.shake = C.SHAKE_ELIM * 1.4;
    state.hitStop = Math.max(state.hitStop, C.HITSTOP_ELIM);
    AUDIO.eliminate();
    for (const ch of state.chars) {
      if (ch.alive && GEO.dist(ball.x, ball.y, ch.x, ch.y) < C.BOMB_RADIUS) hitChar(ch, attacker);
    }
    for (const b of state.balls) b.bomb = false;
  }

  function eliminate(ch, attacker) {
    ch.alive = false;
    state.fx.poof(ch.x, ch.y, ch.color.fill);
    state.fx.shockwave(ch.x, ch.y, ch.color.fill, true);
    state.shake = C.SHAKE_ELIM;
    state.hitStop = Math.max(state.hitStop, C.HITSTOP_ELIM);
    AUDIO.eliminate();
    AUDIO.duck();
    if (ch.isPlayer) UI.toast("OUT!", 1000);
    else if (attacker === state.player) creditCombo();
  }

  // Player knocked out a rival — chain it into a combo if quick enough.
  function creditCombo() {
    const now = performance.now();
    if (now - state.combo.time < C.COMBO_WINDOW) state.combo.count++;
    else state.combo.count = 1;
    state.combo.time = now;
    state.kos++;
    // KO points escalate with the combo level (1st KO = base, each chained
    // KO within the window is worth COMBO_STEP more).
    addScore(C.SCORE.KO + (state.combo.count - 1) * C.SCORE.COMBO_STEP);
    if (state.combo.count >= 2) {
      UI.toast(state.combo.count + "x COMBO!", 1000, "power");
      AUDIO.combo(state.combo.count);
    }
  }

  function checkEnd() {
    const alive = state.chars.filter((c) => c.alive);
    const playerAlive = state.player.alive;

    if (!playerAlive) {
      // Run over.
      state.phase = "over";
      const prevBest = state.startBest || { score: 0, round: 0 };
      recordBest();
      const isNewBest = state.score > (prevBest.score || 0);
      AUDIO.stopMusic();
      UI.setHudVisible(false);
      setTimeout(() => {
        AUDIO.gameOver();
        UI.showGameOver(state.round, state.score, state.kos, getBest(), isNewBest);
      }, 900);
      return;
    }
    if (alive.length <= 1) {
      // Player is last standing -> round clear.
      state.phase = "roundclear";
      addScore(C.SCORE.ROUND_CLEAR * state.round);  // survival bonus grows each round
      recordBest();
      const nextRound = state.round + 1;
      const newPowers = state.powerups.newlyUnlockedAt(nextRound);
      AUDIO.stopMusic();
      AUDIO.roundClear();
      UI.setHudVisible(false);
      setTimeout(() => UI.showRoundClear(nextRound, newPowers, state.score), 700);
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

    // Move the player: relative drag (touch) or mouse follow (desktop).
    // A frozen player can't move (Freeze Ray now affects the human too).
    if (player.alive) {
      if (player.frozen) {
        state.dragDX = 0; state.dragDY = 0;
        state.dragVX = 0; state.dragVY = 0;
      } else if (state.control === "drag") {
        // Target movement from drag accumulated since last frame.
        // Speed Boost amplifies drag movement so the power-up works on touch too.
        const boost = player.boosted ? C.SPEED_MULT : 1;
        let tdx = state.dragDX * boost, tdy = state.dragDY * boost;
        // Ease the applied velocity toward the target so motion accelerates and
        // glides to a stop naturally instead of snapping the full delta each frame.
        state.dragVX += (tdx - state.dragVX) * C.DRAG_SMOOTH;
        state.dragVY += (tdy - state.dragVY) * C.DRAG_SMOOTH;
        // Cap per-frame travel to avoid teleporting on a fast flick.
        let ddx = state.dragVX, ddy = state.dragVY;
        const dl = Math.hypot(ddx, ddy);
        const cap = 300;
        if (dl > cap) { ddx = ddx / dl * cap; ddy = ddy / dl * cap; }
        player.x += ddx;
        player.y += ddy;
        state.dragDX = 0; state.dragDY = 0;
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

    // AI — each opponent reacts to the ball nearest to it (bosses more aggressively).
    for (const ch of state.chars) {
      if (ch.isPlayer || !ch.alive) continue;
      const agg = ch.isBoss ? Math.min(0.95, state.aggro * C.BOSS.aggroMult) : state.aggro;
      AI.updateAI(ch, nearestBall(ch.x, ch.y), state.chars, state.oct, agg);
    }

    ENT.separateChars(state.chars);

    // Obstacles: advance movers, push everyone out of solid obstacles, then
    // re-clamp inside the pit walls so nothing gets shoved through a wall.
    state.obstacles.update(state.oct);
    for (const ch of state.chars) {
      if (!ch.alive) continue;
      OBS.collideChar(ch, state.obstacles.obstacles);
      const cc = GEO.clampCircleInside(state.oct, ch.x, ch.y, ch.r);
      ch.x = cc.x; ch.y = cc.y;
    }

    // Ball physics only runs once the ball is in play.
    if (state.ballLive) {
      const magnetHolders = state.chars.filter((c) => c.alive && c.magnet);
      const floor = speedFloor();
      const lb = launchBase();
      for (const b of state.balls) {
        // Ball size (giant power-up)
        b.r = b.giant ? b.baseR * C.BALL_GIANT_SCALE : b.baseR;
        const events = ENT.stepBall(b, state.chars, state.oct, floor, lb, magnetHolders, state.fx, AUDIO, state.obstacles.obstacles);
        for (const ev of events) applyDamage(ev.target, b, ev.attacker);
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
    state.obstacles.obstacles = [];   // no obstacles on the title/demo scene
    state.isBoss = false;
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
  // One fixed simulation step (~60 Hz), independent of display refresh rate.
  function tick() {
    state.shake *= C.SHAKE_DECAY;
    if (state.shake < 0.15) state.shake = 0;

    if (state.hitStop > 0) {
      state.hitStop--;            // frozen frame for impact punch
    } else if (state.phase === "playing") {
      updatePlaying();
    } else {
      updateDemo();
    }
  }

  // Fixed-timestep loop: accumulate real elapsed time and run the sim at a
  // constant rate, so speed is identical on 60/120/144 Hz screens and the
  // game doesn't run fast/slow on different hardware. Render once per frame.
  const SIM_STEP = 1000 / 60;
  let _lastT = 0, _acc = 0;
  function frame(now) {
    if (!now) now = performance.now();
    if (!_lastT) _lastT = now;
    let dt = now - _lastT;
    _lastT = now;

    if (state.paused) {
      _acc = 0;                   // don't bank time while paused
      RENDER.draw(ctx, state);
      requestAnimationFrame(frame);
      return;
    }

    if (dt > 250) dt = 250;       // clamp big gaps (tab switch) to avoid a spiral
    _acc += dt;
    let steps = 0;
    while (_acc >= SIM_STEP && steps < 5) { tick(); _acc -= SIM_STEP; steps++; }

    RENDER.draw(ctx, state);
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------
  // Persistence (localStorage) — best round + audio settings.
  // Guarded so it can't break in private mode / sandboxed iframes.
  // ------------------------------------------------------------
  const STORE_KEY = "gbb.v1";
  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveStore(patch) {
    try {
      const cur = loadStore();
      localStorage.setItem(STORE_KEY, JSON.stringify(Object.assign(cur, patch)));
    } catch (e) { /* ignore */ }
  }
  // Bests are tracked per mode+difficulty so every configuration has its own
  // target. Each entry stores the best score and the furthest round reached.
  function currentKey() { return state.mode + ":" + state.difficulty; }
  function getBest(key) {
    const bests = loadStore().bests || {};
    return bests[key || currentKey()] || { score: 0, round: 0 };
  }
  function recordBest() {
    const key = currentKey();
    const store = loadStore();
    const bests = store.bests || {};
    const cur = bests[key] || { score: 0, round: 0 };
    bests[key] = {
      score: Math.max(cur.score || 0, state.score),
      round: Math.max(cur.round || 0, state.round),
    };
    saveStore({ bests });
    state.best = bests[key].round;  // kept for any legacy references
  }

  // ------------------------------------------------------------
  // Pause / resume
  // ------------------------------------------------------------
  function doPause() {
    if (state.phase !== "playing" || state.paused) return;
    state.paused = true;
    AUDIO.pauseAll();
    UI.showPause(true);
  }
  function doResume() {
    if (!state.paused) return;
    state.paused = false;
    AUDIO.resumeAll();
    UI.showPause(false);
  }
  window.addEventListener("keydown", (e) => {
    if (e.key === "p" || e.key === "P" || e.key === "Escape") {
      if (state.phase === "playing") { state.paused ? doResume() : doPause(); }
    }
  });

  // ------------------------------------------------------------
  // UI wiring
  // ------------------------------------------------------------
  UI.init({
    onStart(choices) {
      AUDIO.init();
      AUDIO.resume();
      // Apply saved audio prefs now that the AudioContext exists.
      const s = state._savedAudio || {};
      if (typeof s.vol === "number") AUDIO.setVolume(s.vol);
      if (s.muted) AUDIO.setMuted(true);
      UI.setMuteIcon(AUDIO.muted);
      // Music now starts when the ball drops in (serveBall), so the
      // "Ga! Ga! Ga! Ball!" chant plays clean.
      startMatch(choices);
    },
    onNext() { startRound(state.round + 1); },
    onPlayAgain() {
      // Return to start screen so the player can re-pick.
      state.phase = "start";
      state.paused = false;
      UI.showPause(false);
      UI.setHudVisible(false);
      UI.showScreen("screen-start");
      setupDemo();
    },
    onPause() { doPause(); },
    onResume() { doResume(); },
    onToggleMute() {
      AUDIO.setMuted(!AUDIO.muted);
      UI.setMuteIcon(AUDIO.muted);
      saveStore({ muted: AUDIO.muted });
    },
    onVolume(v) {
      AUDIO.setVolume(v);
      if (AUDIO.muted && v > 0) { AUDIO.setMuted(false); UI.setMuteIcon(false); }
      saveStore({ vol: v, muted: AUDIO.muted });
    },
  });

  // ------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------
  const saved = loadStore();
  // Migrate a legacy single "best" round into the per-config store once.
  if (typeof saved.best === "number" && !saved.bests) {
    saveStore({ bests: { "lives:normal": { score: 0, round: saved.best } } });
  }
  state.best = saved.best || 0;
  UI.setBests((loadStore().bests) || {});
  // Apply saved audio prefs to the volume slider / mute (applied to the
  // AudioContext once it's created on first Start).
  if (typeof saved.vol === "number") UI.setVolumeSlider(saved.vol);
  if (saved.muted) UI.setMuteIcon(true);
  state._savedAudio = saved;   // consumed in onStart via AUDIO after init

  resize();
  setupDemo();
  UI.showScreen("screen-start");
  requestAnimationFrame(frame);
})();
