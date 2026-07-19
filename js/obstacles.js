/* ============================================================
   obstacles.js — in-pit obstacles that appear in later rounds.
   Four kinds:
     pillar  — solid post; the ball ricochets off it (blocks players too)
     bumper  — solid; also accelerates + heats the ball on contact
     mover   — solid; slowly orbits the pit center, sweeping the arena
     hazard  — floor zone (not solid); heats the ball passing over it
   Exposed on window.OBS.
   ============================================================ */
(function () {
  "use strict";
  const C = window.CONFIG;
  const GEO = window.GEO;

  const SOLID = { pillar: true, bumper: true, mover: true, hazard: false };

  // Which obstacle types are unlocked by a given round.
  function availableTypes(round) {
    const U = C.OBSTACLES.UNLOCK;
    return Object.keys(U).filter((t) => round >= U[t]);
  }

  // How many obstacles a round should have (starts at 1 on FIRST_ROUND,
  // grows by one every couple of rounds, capped at MAX).
  function countForRound(round) {
    const O = C.OBSTACLES;
    if (round < O.FIRST_ROUND) return 0;
    return Math.min(O.MAX, 1 + Math.floor((round - O.FIRST_ROUND) / 2));
  }

  class ObstacleManager {
    constructor() {
      this.obstacles = [];
    }

    // Build a fresh layout for the round (empty before FIRST_ROUND).
    reset(round, oct) {
      this.obstacles = [];
      const O = C.OBSTACLES;
      const n = countForRound(round);
      if (n <= 0) return;
      const types = availableTypes(round);
      if (!types.length) return;

      let tries = 0;
      while (this.obstacles.length < n && tries < 300) {
        tries++;
        const type = types[(Math.random() * types.length) | 0];
        const r = O.RADIUS[type];
        const p = GEO.randomInside(oct, r + 24);
        // Keep the serve zone clear.
        if (GEO.dist(p.x, p.y, oct.cx, oct.cy) < O.CENTER_CLEAR) continue;
        // Don't overlap existing obstacles.
        if (this.obstacles.some((o) => GEO.dist(o.x, o.y, p.x, p.y) < o.r + r + O.SPACING)) continue;
        this.obstacles.push(makeObstacle(type, p.x, p.y, r, oct));
      }
    }

    // Advance movers along their orbit; keep them safely inside the pit.
    update(oct) {
      for (const o of this.obstacles) {
        if (o.type !== "mover") continue;
        o.angle += o.spin;
        o.x = o.ox + Math.cos(o.angle) * o.orbit;
        o.y = o.oy + Math.sin(o.angle) * o.orbit;
        const c = GEO.clampCircleInside(oct, o.x, o.y, o.r);
        o.x = c.x; o.y = c.y;
      }
    }
  }

  function makeObstacle(type, x, y, r, oct) {
    const o = { type, x, y, r, solid: SOLID[type], accel: type === "bumper", hazard: type === "hazard", flash: 0, spin: 0 };
    if (type === "mover") {
      // Orbit the pit center at the spawn distance (clamped so it stays inside).
      const maxOrbit = oct.R * C.OBSTACLES.MOVER_MAX_ORBIT;
      o.ox = oct.cx; o.oy = oct.cy;
      o.orbit = Math.min(GEO.dist(x, y, oct.cx, oct.cy), maxOrbit);
      o.angle = Math.atan2(y - oct.cy, x - oct.cx);
      o.spin = C.OBSTACLES.MOVER_SPEED * (Math.random() < 0.5 ? 1 : -1);
      o.x = o.ox + Math.cos(o.angle) * o.orbit;
      o.y = o.oy + Math.sin(o.angle) * o.orbit;
    }
    return o;
  }

  // Push a character out of any solid obstacle it overlaps (players included).
  function collideChar(ch, obstacles) {
    if (!obstacles || !ch.alive) return;
    for (const o of obstacles) {
      if (!o.solid) continue;
      const dx = ch.x - o.x, dy = ch.y - o.y;
      const raw = Math.hypot(dx, dy);
      const min = ch.r + o.r;
      if (raw < min) {
        const d = raw || 0.0001;
        // If dead-centered on the obstacle, pick an arbitrary push direction.
        const nx = raw < 0.0001 ? 1 : dx / d;
        const ny = raw < 0.0001 ? 0 : dy / d;
        ch.x = o.x + nx * min;
        ch.y = o.y + ny * min;
        if (!ch.isPlayer) { ch.vx *= 0.5; ch.vy *= 0.5; }  // AI slides instead of sticking
      }
    }
  }

  window.OBS = { ObstacleManager, collideChar, availableTypes, countForRound };
})();
