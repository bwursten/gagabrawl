/* ============================================================
   entities.js — Character and Ball classes + physics/collision
   Exposed on window.ENT.
   ============================================================ */
(function () {
  "use strict";
  const C = window.CONFIG;
  const GEO = window.GEO;

  // ---------------------------------------------------------
  // Character (player or AI)
  // ---------------------------------------------------------
  class Character {
    constructor(opts) {
      this.x = opts.x;
      this.y = opts.y;
      this.r = C.CHAR_RADIUS;
      this.color = opts.color;          // {fill, rim, name}
      this.isPlayer = !!opts.isPlayer;
      this.name = opts.color.name;
      this.alive = true;

      this.lives = opts.lives;          // used in 3-lives mode
      this.shield = false;              // shield bubble active
      this.frozenUntil = 0;             // ms timestamp
      this.speedBoostUntil = 0;
      this.magnetUntil = 0;
      this.smashReady = false;          // Super Smash: next bat fires at max speed

      this.vx = 0; this.vy = 0;         // for AI movement smoothing
      this.hitFlash = 0;                // frames of white flash after a hit
      this.bob = Math.random() * Math.PI * 2;

      // --- juice / animation state ---
      this.px = opts.x;                 // previous-frame position (for squash-stretch)
      this.py = opts.y;
      this.dispX = 0;                   // per-frame displacement, filled by the game loop
      this.dispY = 0;
      this.squashT = 0;                 // hit-squash timer (frames)
      this.dizzyUntil = 0;              // ms — dizzy face after a hit
      this.blinkAt = performance.now() + GEO.rand(1200, 4200);
      this.blinkT = 0;                  // frames remaining in a blink
      this.pupilX = 0;                  // smoothed pupil offset (eye tracking)
      this.pupilY = 0;
    }

    get frozen() { return performance.now() < this.frozenUntil; }
    get boosted() { return performance.now() < this.speedBoostUntil; }
    get magnet() { return performance.now() < this.magnetUntil; }

    speed() {
      const base = this.isPlayer ? C.PLAYER_SPEED : this.aiSpeed;
      return this.boosted ? base * C.SPEED_MULT : base;
    }
  }

  // ---------------------------------------------------------
  // Ball
  // ---------------------------------------------------------
  class Ball {
    constructor(x, y) {
      this.x = x; this.y = y;
      this.vx = GEO.rand(-1, 1);
      this.vy = GEO.rand(-1, 1);
      this.baseR = C.BALL_RADIUS;
      this.r = C.BALL_RADIUS;
      this.z = 0;                 // fake height for a little visual arc
      this.vz = 0;
      this.lastHitter = null;     // Character who most recently batted it
      this.lastHitTime = 0;
      this.giantUntil = 0;
      this.spin = 0;

      // --- juice ---
      this.trail = [];            // recent positions for a motion trail
      this.squashT = 0;           // impact-squash timer (frames)
      this.squashAng = 0;         // direction of squash deformation
      this.wallFlash = 0;         // ms timestamp of last wall impact (wall glow)
      this.heat = 0;              // 0 = calm/safe, 1 = red-hot/dangerous (smoothed in render)
      this.bomb = false;          // Bomb Ball: detonates (area knockout) on next hit
      this.expires = 0;           // ms; >0 means a temporary extra ball (Multi-Ball)
    }

    // How dangerous the ball looks right now: ramps from safe to hot as speed
    // approaches and crosses the damage threshold. Used purely for visuals.
    get danger() {
      return GEO.clamp((this.speed - (C.HIT_SPEED - 1.5)) / 3, 0, 1);
    }

    get giant() { return performance.now() < this.giantUntil; }
    get speed() { return Math.hypot(this.vx, this.vy); }

    setSpeed(s) {
      const cur = this.speed || 0.0001;
      this.vx = (this.vx / cur) * s;
      this.vy = (this.vy / cur) * s;
    }
  }

  // ---------------------------------------------------------
  // Physics step for the ball. Returns an array of "damage" events:
  //   [{ target: Character }]
  // roundSpeedCap gradually rises over the round for the speed ramp.
  // ---------------------------------------------------------
  function stepBall(ball, chars, oct, speedFloor, magnetHolders, fx, audio) {
    const now = performance.now();

    // Magnet Hands: bend the ball toward the nearest magnet holder in range.
    for (const h of magnetHolders) {
      const d = GEO.dist(ball.x, ball.y, h.x, h.y);
      if (d < C.MAGNET_RANGE && d > 1) {
        const pull = C.MAGNET_PULL * (1 - d / C.MAGNET_RANGE);
        ball.vx += ((h.x - ball.x) / d) * pull;
        ball.vy += ((h.y - ball.y) / d) * pull;
      }
    }

    // Integrate position
    ball.x += ball.vx;
    ball.y += ball.vy;

    // Fake vertical hop for flair
    ball.z += ball.vz;
    ball.vz -= 0.9;             // gravity on the fake height
    if (ball.z < 0) { ball.z = 0; ball.vz = 0; }

    ball.spin += ball.speed * 0.02;

    // Motion trail: record recent positions (with height) for ghosting.
    ball.trail.push({ x: ball.x, y: ball.y, z: ball.z });
    if (ball.trail.length > C.BALL_TRAIL) ball.trail.shift();
    if (ball.squashT > 0) ball.squashT--;

    // Friction, then clamp speed into the allowed band.
    // `speedFloor` ramps up over the round for the difficulty curve: the ball
    // never decays below it, so it gradually becomes fast enough to threaten.
    ball.vx *= C.BALL_FRICTION;
    ball.vy *= C.BALL_FRICTION;
    const sp = ball.speed;
    if (sp > C.BALL_MAX_SPEED) ball.setSpeed(C.BALL_MAX_SPEED);
    if (sp < speedFloor) {
      if (sp < 0.001) { ball.vx = GEO.rand(-1, 1); ball.vy = GEO.rand(-1, 1); }
      ball.setSpeed(speedFloor);
    }

    // Wall collision (octagon)
    const c = GEO.clampCircleInside(oct, ball.x, ball.y, ball.r);
    if (c.hit) {
      ball.x = c.x; ball.y = c.y;
      const ref = GEO.reflect(ball.vx, ball.vy, c.nx, c.ny, 1.0);
      ball.vx = ref.vx; ball.vy = ref.vy;
      // exaggerated arc off the wall
      if (ball.speed > C.HIT_SPEED) { ball.vz = Math.min(9, ball.speed * 0.6); }
      // squash against the wall (deform perpendicular to the normal)
      ball.squashT = 8;
      ball.squashAng = Math.atan2(c.ny, c.nx);
      // neon-arcade reactivity: flash the wall + ripple the floor on impact
      ball.wallFlash = now;
      if (fx && ball.speed > C.HIT_SPEED * 0.7) fx.shockwave(ball.x, ball.y, "#7ff0ff");
      if (audio) audio.wallBounce(ball.speed);
    }

    // Character collisions
    const events = [];
    for (const ch of chars) {
      if (!ch.alive) continue;
      const dx = ball.x - ch.x;
      const dy = ball.y - ch.y;
      const d = Math.hypot(dx, dy);
      const min = ball.r + ch.r;
      if (d < min && d > 0.0001) {
        const nx = dx / d, ny = dy / d;
        // Separate ball from character
        const overlap = min - d;
        ball.x += nx * overlap;
        ball.y += ny * overlap;

        const incomingSpeed = ball.speed;

        // Determine whether this is a DAMAGING hit:
        //  - ball was moving fast (recently launched by someone), AND
        //  - this character isn't the one who just launched it (grace window)
        const isBatter = ball.lastHitter === ch && (now - ball.lastHitTime) < C.HIT_GRACE_MS;
        const damaging = incomingSpeed >= C.HIT_SPEED && !isBatter;

        // Reflect ball off the character
        const ref = GEO.reflect(ball.vx, ball.vy, nx, ny, 1.0);
        ball.vx = ref.vx; ball.vy = ref.vy;

        // The character bats it — launch it away from them.
        let launch = Math.max(C.HIT_LAUNCH, incomingSpeed * 0.85);
        // Super Smash: this character's next bat fires at max speed.
        if (ch.smashReady) {
          launch = C.BALL_MAX_SPEED;
          ch.smashReady = false;
          ball.squashT = 11;
        }
        ball.vx = nx * launch;
        ball.vy = ny * launch;
        ball.vz = Math.min(10, launch * 0.55);
        ball.lastHitter = ch;
        ball.lastHitTime = now;

        // squash the ball along the bat direction + kick a character squash pulse
        ball.squashT = 9;
        ball.squashAng = Math.atan2(ny, nx);
        ch.squashT = 8;

        // Distinct audio: harsh crunch for a damaging hit, clean pock for a bat.
        if (audio) {
          if (damaging) audio.hitDamage(incomingSpeed);
          else audio.hitBat(incomingSpeed);
        }

        if (damaging) {
          events.push({ target: ch });
        }
      }
    }
    return events;
  }

  // Character-character soft separation so they don't stack.
  function separateChars(chars) {
    for (let i = 0; i < chars.length; i++) {
      const a = chars[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < chars.length; j++) {
        const b = chars[j];
        if (!b.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = a.r + b.r;
        if (d < min && d > 0.0001) {
          const push = (min - d) / 2;
          const nx = dx / d, ny = dy / d;
          if (!a.isPlayer) { a.x -= nx * push; a.y -= ny * push; }
          if (!b.isPlayer) { b.x += nx * push; b.y += ny * push; }
        }
      }
    }
  }

  window.ENT = { Character, Ball, stepBall, separateChars };
})();
