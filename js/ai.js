/* ============================================================
   ai.js — opponent behavior
   Readable behavior: mostly dodge the incoming fast ball; occasionally
   move to intercept and bat it toward the player or another AI.
   Difficulty (speed + aggression) scales with the round.
   Exposed on window.AI.
   ============================================================ */
(function () {
  "use strict";
  const C = window.CONFIG;
  const GEO = window.GEO;

  // Decide and apply movement for one AI character this frame.
  function updateAI(ai, ball, allChars, oct, aggro) {
    const now = performance.now();
    if (!ai.alive) return;

    if (ai.frozen) { ai.vx *= 0.6; ai.vy *= 0.6; ai.x += ai.vx; ai.y += ai.vy; clampInside(ai, oct); return; }

    // Re-pick an intent a few times per second so movement looks deliberate.
    if (!ai._nextDecision || now > ai._nextDecision) {
      ai._nextDecision = now + GEO.rand(180, 420);
      chooseIntent(ai, ball, allChars, aggro);
    }

    // Steer toward the current target point.
    let tx = ai._tx, ty = ai._ty;

    // Always overlay an avoidance vector when a fast ball is heading at us.
    const avoid = ballThreat(ai, ball);
    if (avoid) { tx = ai.x + avoid.x * 220; ty = ai.y + avoid.y * 220; }

    const dx = tx - ai.x, dy = ty - ai.y;
    const d = Math.hypot(dx, dy) || 1;
    const spd = ai.speed();
    // Smooth acceleration toward target direction
    const desiredVx = (dx / d) * spd;
    const desiredVy = (dy / d) * spd;
    ai.vx += (desiredVx - ai.vx) * 0.2;
    ai.vy += (desiredVy - ai.vy) * 0.2;

    // Small wander jitter for personality
    ai.vx += GEO.rand(-0.25, 0.25);
    ai.vy += GEO.rand(-0.25, 0.25);

    ai.x += ai.vx;
    ai.y += ai.vy;
    clampInside(ai, oct);
  }

  function clampInside(ai, oct) {
    const c = GEO.clampCircleInside(oct, ai.x, ai.y, ai.r);
    ai.x = c.x; ai.y = c.y;
    if (c.hit) {
      // slide along wall instead of sticking
      ai.vx *= 0.5; ai.vy *= 0.5;
    }
  }

  // Is a dangerous (fast) ball approaching? Return a unit avoidance vector or null.
  function ballThreat(ai, ball) {
    if (ball.speed < C.HIT_SPEED * 0.8) return null;
    const dx = ai.x - ball.x, dy = ai.y - ball.y;
    const d = Math.hypot(dx, dy);
    if (d > 320) return null;
    // Is the ball moving roughly toward us?
    const towards = (ball.vx * -dx + ball.vy * -dy);
    if (towards <= 0) return null;
    // Dodge perpendicular to the ball's velocity (pick the side away from center-line)
    let px = -ball.vy, py = ball.vx;
    const dot = px * dx + py * dy;
    if (dot < 0) { px = -px; py = -py; }
    const len = Math.hypot(px, py) || 1;
    // Blend straight-away + perpendicular so dodges look natural
    const ax = (dx / (d || 1)) * 0.6 + (px / len) * 0.8;
    const ay = (dy / (d || 1)) * 0.6 + (py / len) * 0.8;
    const al = Math.hypot(ax, ay) || 1;
    return { x: ax / al, y: ay / al };
  }

  // Pick a wander / intercept target.
  function chooseIntent(ai, ball, allChars, aggro) {
    // Sometimes go on the offensive: intercept the ball to bat it at a target.
    if (Math.random() < aggro && ball.speed < C.HIT_SPEED) {
      // Predict ball a little ahead and move to strike it.
      ai._tx = ball.x + ball.vx * 6;
      ai._ty = ball.y + ball.vy * 6;
      return;
    }
    // Otherwise keep some spacing: drift toward open space away from the ball.
    const away = 260;
    const dx = ai.x - ball.x, dy = ai.y - ball.y;
    const d = Math.hypot(dx, dy) || 1;
    ai._tx = ball.x + (dx / d) * away + GEO.rand(-120, 120);
    ai._ty = ball.y + (dy / d) * away + GEO.rand(-120, 120);
  }

  window.AI = { updateAI };
})();
