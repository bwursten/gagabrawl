/* ============================================================
   powerups.js — spawning field pickups + applying effects
   Exposed on window.PU.
   ============================================================ */
(function () {
  "use strict";
  const C = window.CONFIG;
  const GEO = window.GEO;

  class PowerUpManager {
    constructor() {
      this.pickups = [];        // active field pickups
      this.nextSpawn = 0;
      this.available = [];      // power-up ids unlocked this round
    }

    reset(round, oct, everyMult) {
      this.pickups.length = 0;
      this.everyMult = everyMult || 1;   // difficulty: <1 = more frequent power-ups
      this.nextSpawn = performance.now() + C.POWERUP_FIRST_MS * this.everyMult;
      // Unlock power-ups progressively as rounds advance.
      this.available = C.POWERUP_ORDER.filter((id) => C.POWERUPS[id].unlockRound <= round);
    }

    // Which power-ups become newly available at a given round (for round-clear message).
    newlyUnlockedAt(round) {
      return C.POWERUP_ORDER.filter((id) => C.POWERUPS[id].unlockRound === round);
    }

    update(oct) {
      const now = performance.now();
      // Expire old pickups
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        if (now > this.pickups[i].expires) this.pickups.splice(i, 1);
      }
      // Spawn a new one on cadence (max 2 on the field at once)
      if (now > this.nextSpawn && this.pickups.length < 2 && this.available.length) {
        this.spawn(oct);
        this.nextSpawn = now + C.POWERUP_EVERY_MS * (this.everyMult || 1);
      }
    }

    spawn(oct) {
      const id = this.available[(Math.random() * this.available.length) | 0];
      const p = GEO.randomInside(oct, C.POWERUP_RADIUS + 40);
      this.pickups.push({
        id,
        x: p.x, y: p.y,
        r: C.POWERUP_RADIUS,
        expires: performance.now() + C.POWERUP_LIFETIME_MS,
        bob: Math.random() * Math.PI * 2,
        born: performance.now(),
      });
    }

    // Check every living character against pickups. Returns collected events
    // [{ char, id }] and applies the effect.
    // `hooks` provides game-level actions (e.g., addBall for Multi-Ball).
    checkPickups(chars, balls, mode, fx, audio, hooks) {
      const events = [];
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const pk = this.pickups[i];
        for (const ch of chars) {
          if (!ch.alive) continue;
          if (GEO.dist(pk.x, pk.y, ch.x, ch.y) < pk.r + ch.r) {
            this.apply(pk.id, ch, chars, balls, mode, hooks);
            fx.sparkle(pk.x, pk.y, C.POWERUPS[pk.id].color);
            if (audio) audio.pickup();
            events.push({ char: ch, id: pk.id });
            this.pickups.splice(i, 1);
            break;
          }
        }
      }
      return events;
    }

    apply(id, ch, chars, balls, mode, hooks) {
      const now = performance.now();
      const dur = C.DURATIONS[id];
      switch (id) {
        case "speed":
          ch.speedBoostUntil = now + dur;
          break;
        case "giant":
          for (const b of balls) b.giantUntil = now + dur;
          break;
        case "freeze":
          // Freeze opponents near the collector.
          for (const other of chars) {
            if (other === ch || !other.alive) continue;
            if (GEO.dist(ch.x, ch.y, other.x, other.y) < C.FREEZE_RANGE) {
              other.frozenUntil = now + dur;
            }
          }
          break;
        case "magnet":
          ch.magnetUntil = now + dur;
          break;
        case "shield":
          ch.shield = true;
          break;
        case "smash":
          ch.smashReady = true;
          break;
        case "bomb":
          // Arm every ball in play; the next knockout detonates.
          for (const b of balls) b.bomb = true;
          break;
        case "life":
          // Add a heart in 3-Lives mode (can stack above the starting count,
          // up to MAX_LIVES); otherwise grant a free one-hit save.
          if (mode === "lives" && ch.lives < C.MAX_LIVES) ch.lives++;
          else ch.shield = true;
          break;
        case "multi":
          if (hooks && hooks.addBall) hooks.addBall(ch);
          break;
      }
    }
  }

  window.PU = { PowerUpManager };
})();
