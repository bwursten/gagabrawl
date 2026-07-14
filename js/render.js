/* ============================================================
   render.js — neon-arcade renderer.
   Angled top-down look: world is vertically squashed around its center
   (CONFIG.TILT) so round sprites read as slight-perspective ellipses.

   Neon theme: dark stage + corner glow, drifting motes, a glowing grid
   floor, neon-tube walls with bloom + impact flash, per-entity neon
   underglow, round-based hue cycling, and a strong vignette.

   Bodies / ball / power-up icons are stamped from pre-rendered sprites
   (see sprites.js); faces, seams, squash, and trails are drawn live.
   Exposed on window.RENDER.
   ============================================================ */
(function () {
  "use strict";
  const C = window.CONFIG;
  const SPR = window.SPR;

  function makeToScreen(scale) {
    const half = C.WORLD / 2;
    return function (x, y) {
      return { x: x * scale, y: (half + (y - half) * C.TILT) * scale };
    };
  }

  function themeForRound(r) {
    const t = C.NEON_THEMES;
    return t[((r || 1) - 1) % t.length];
  }

  // ---- ambient background motes (seeded once) ----
  let motes = null;
  function seedMotes() {
    motes = [];
    for (let i = 0; i < 34; i++) {
      motes.push({
        x: Math.random(), y: Math.random(),
        r: 0.6 + Math.random() * 2.2,
        spd: 0.00006 + Math.random() * 0.00016,
        drift: (Math.random() - 0.5) * 0.00008,
        a: 0.1 + Math.random() * 0.3,
      });
    }
  }

  function draw(ctx, state) {
    const canvas = ctx.canvas;
    const scale = canvas.width / C.WORLD;
    const toScreen = makeToScreen(scale);
    state.toScreen = toScreen;
    state.scale = scale;
    const theme = themeForRound(state.round);

    drawBackground(ctx, canvas, theme);

    // ---- screen shake ----
    ctx.save();
    const shake = state.shake || 0;
    if (shake > 0.2) {
      ctx.translate((Math.random() * 2 - 1) * shake * scale, (Math.random() * 2 - 1) * shake * scale);
    }

    drawPit(ctx, state, toScreen, scale, theme);

    for (const pk of state.powerups.pickups) drawPickup(ctx, pk, toScreen, scale);

    const activeBalls = state.ballLive ? state.balls : [];

    // Neon underglow + subtle contact shadow beneath every entity.
    for (const ch of state.chars) if (ch.alive) drawUnderglow(ctx, ch.x, ch.y, ch.r * 1.5, ch.color.fill, toScreen, scale);
    for (const b of activeBalls) drawUnderglow(ctx, b.x, b.y, b.r * 1.4, b.bomb ? "#ff3b3b" : "#ff8a3d", toScreen, scale);

    // Depth sort by world-y.
    const drawables = [];
    for (const ch of state.chars) if (ch.alive) drawables.push({ y: ch.y, kind: "char", obj: ch });
    for (const b of activeBalls) drawables.push({ y: b.y, kind: "ball", obj: b });
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) {
      if (d.kind === "char") drawCharacter(ctx, d.obj, activeBalls, toScreen, scale);
      else drawBall(ctx, d.obj, toScreen, scale);
    }

    state.fx.draw(ctx, toScreen, scale);
    ctx.restore();

    drawVignette(ctx, canvas);
  }

  // ---------------- Background ----------------
  function drawBackground(ctx, canvas, theme) {
    const W = canvas.width, H = canvas.height;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, C.BG_TOP);
    g.addColorStop(1, C.BG_BOTTOM);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Corner glow blobs
    blob(ctx, W * 0.15, H * 0.12, H * 0.5, theme.wall, 0.10);
    blob(ctx, W * 0.88, H * 0.9, H * 0.55, "#ff3df0", 0.07);

    // Drifting motes
    if (!motes) seedMotes();
    const now = performance.now();
    ctx.save();
    for (const m of motes) {
      m.y -= m.spd; m.x += m.drift;
      if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }
      const tw = 0.6 + 0.4 * Math.sin(now / 700 + m.x * 20);
      ctx.globalAlpha = m.a * tw;
      ctx.fillStyle = theme.wall;
      ctx.beginPath();
      ctx.arc(m.x * W, m.y * H, m.r * (H / 900), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function blob(ctx, x, y, r, color, alpha) {
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ---------------- Pit / arena ----------------
  function drawPit(ctx, state, toScreen, scale, theme) {
    const oct = state.oct;
    const c = toScreen(oct.cx, oct.cy);
    const now = performance.now();

    // ---- Floor ----
    ctx.save();
    tracePoly(ctx, oct.verts, toScreen);
    ctx.clip();

    const fg = ctx.createLinearGradient(0, c.y - oct.R * scale, 0, c.y + oct.R * scale);
    fg.addColorStop(0, C.FLOOR_TOP);
    fg.addColorStop(1, C.FLOOR_BOTTOM);
    ctx.fillStyle = fg;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Center glow
    const cg = ctx.createRadialGradient(c.x, c.y, 10, c.x, c.y, oct.R * scale);
    cg.addColorStop(0, hexA(theme.glow, 0.85));
    cg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = cg;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Neon grid (world-aligned lines, scrolling slowly)
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1.5 * scale;
    const step = 78;
    const scroll = (now / 45) % step;
    ctx.beginPath();
    for (let wx = oct.cx - oct.R; wx <= oct.cx + oct.R; wx += step) {
      const sx = wx * scale;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, ctx.canvas.height);
    }
    for (let wy = oct.cy - oct.R - step; wy <= oct.cy + oct.R; wy += step) {
      const sy = toScreen(0, wy + scroll).y;
      ctx.moveTo(0, sy); ctx.lineTo(ctx.canvas.width, sy);
    }
    ctx.stroke();

    // Faint concentric rings
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 2 * scale;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      const rr = oct.R * scale * (i / 4);
      ctx.ellipse(c.x, c.y, rr, rr * C.TILT, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // ---- Neon-tube walls ----
    const flash = Math.max(0, 1 - (now - (state.ball.wallFlash || -9999)) / 220);
    ctx.save();
    ctx.lineJoin = "round";
    // dark base ring
    tracePoly(ctx, oct.verts, toScreen);
    ctx.lineWidth = C.WALL_THICKNESS * scale;
    ctx.strokeStyle = "#0a0e28";
    ctx.stroke();
    // glowing tube
    ctx.shadowColor = theme.wall;
    ctx.shadowBlur = (16 + flash * 26) * scale;
    tracePoly(ctx, oct.verts, toScreen);
    ctx.lineWidth = (C.WALL_THICKNESS * 0.5) * scale;
    ctx.strokeStyle = theme.wall;
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    // bright core
    ctx.shadowBlur = (8 + flash * 16) * scale;
    tracePoly(ctx, oct.verts, toScreen);
    ctx.lineWidth = (C.WALL_THICKNESS * 0.22) * scale;
    ctx.strokeStyle = flash > 0.4 ? "#ffffff" : lighten(theme.wall, 0.6);
    ctx.globalAlpha = 1;
    ctx.stroke();
    ctx.restore();
  }

  function drawVignette(ctx, canvas) {
    const g = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, canvas.height * 0.32,
      canvas.width / 2, canvas.height / 2, canvas.height * 0.75
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(2,2,12,0.62)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function tracePoly(ctx, verts, toScreen) {
    ctx.beginPath();
    verts.forEach((v, i) => {
      const s = toScreen(v.x, v.y);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
  }

  // ---------------- Underglow (replaces heavy shadow) ----------------
  function drawUnderglow(ctx, x, y, r, color, toScreen, scale) {
    const s = toScreen(x, y);
    const rr = r * scale;
    ctx.save();
    // soft dark contact shadow
    ctx.fillStyle = "rgba(0,0,0,0.30)";
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + rr * 0.28, rr * 0.7, rr * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    // neon puddle
    const g = ctx.createRadialGradient(s.x, s.y + rr * 0.28, 2, s.x, s.y + rr * 0.28, rr);
    g.addColorStop(0, hexA(color, 0.5));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + rr * 0.28, rr, rr * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---------------- Characters ----------------
  function drawCharacter(ctx, ch, balls, toScreen, scale) {
    const now = performance.now();
    // React to the nearest ball (faces, worry, danger ring).
    let ball = null, bd = Infinity;
    for (const b of balls) {
      const d = Math.hypot(b.x - ch.x, b.y - ch.y);
      if (d < bd) { bd = d; ball = b; }
    }
    ch.bob += 0.08;
    const bobY = Math.sin(ch.bob) * C.HOP_HEIGHT;
    const s = toScreen(ch.x, ch.y);
    const cx = s.x, cy = s.y - bobY * scale;
    const r = ch.r * scale;

    const spd = Math.hypot(ch.dispX, ch.dispY);
    const stretch = Math.min(0.28, spd * 0.03);
    const ang = spd > 0.3 ? Math.atan2(ch.dispY * C.TILT, ch.dispX) : 0;
    let hk = 0;
    if (ch.squashT > 0) { hk = ch.squashT / 8; ch.squashT--; }

    ctx.save();
    ctx.translate(cx, cy);

    // Body sprite, stamped inside the stretch/squash/tilt frame.
    ctx.save();
    ctx.rotate(ang);
    ctx.scale(1 + stretch, 1 - stretch * 0.55);
    ctx.rotate(-ang);
    ctx.scale(1 + hk * 0.3, 1 - hk * 0.4);
    ctx.scale(1, C.TILT * 1.05);
    const body = SPR.charBody(ch.color);
    const d = r * 1.16; // sprite includes glow padding
    if (ch.frozen) ctx.globalAlpha = 0.85;
    ctx.drawImage(body, -d, -d, d * 2, d * 2);
    ctx.globalAlpha = 1;
    if (ch.frozen) {
      ctx.fillStyle = "rgba(150,220,255,0.4)";
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    drawFace(ctx, ch, ball, r, now);

    if (ch.isPlayer) {
      ctx.fillStyle = "#ffe14d";
      ctx.strokeStyle = "#1b2440";
      ctx.lineWidth = 2;
      const ay = -r * (C.TILT * 1.05) - 10 * scale;
      ctx.beginPath();
      ctx.moveTo(0, ay);
      ctx.lineTo(-8 * scale, ay - 12 * scale);
      ctx.lineTo(8 * scale, ay - 12 * scale);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }

    if (ch.hitFlash > 0) {
      ctx.globalAlpha = Math.min(0.7, ch.hitFlash / 10);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * C.TILT * 1.05, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ch.hitFlash--;
    }

    if (ch.boosted) {
      ctx.fillStyle = "rgba(255,231,77,0.9)";
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc((Math.random() - 0.5) * r * 1.6, (Math.random() - 0.5) * r * 1.6, 2 + Math.random() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Super Smash charged aura — crackling ring until the next bat.
    if (ch.smashReady) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const pulse = 0.7 + Math.sin(now / 70) * 0.3;
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = "#ffb02e";
      ctx.lineWidth = 3 * scale;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.45, r * C.TILT * 1.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#fff3c4";
      ctx.lineWidth = 2 * scale;
      for (let i = 0; i < 5; i++) {
        const a = now / 90 + i * (Math.PI * 2 / 5);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 1.3, Math.sin(a) * r * 1.3 * C.TILT);
        ctx.lineTo(Math.cos(a) * r * (1.7 + Math.random() * 0.3), Math.sin(a) * r * 1.7 * C.TILT);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (ch.shield) {
      const pulse = 1 + Math.sin(now / 150) * 0.05;
      ctx.save();
      ctx.shadowColor = "#4dc3ff";
      ctx.shadowBlur = 12 * scale;
      ctx.strokeStyle = "rgba(120,215,255,0.95)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.35 * pulse, r * C.TILT * 1.4 * pulse, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = "rgba(77,195,255,0.12)";
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.35 * pulse, r * C.TILT * 1.4 * pulse, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Danger warning ring for the human player when a hot ball is closing in.
    if (ch.isPlayer && ball && ball.heat > 0.5 && !ch.shield) {
      const d = Math.hypot(ball.x - ch.x, ball.y - ch.y);
      const batterGrace = ball.lastHitter === ch && (now - ball.lastHitTime) < C.HIT_GRACE_MS;
      if (d < 230 && !batterGrace) {
        const near = 1 - d / 230;
        const pulse = 0.6 + Math.sin(now / 80) * 0.4;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = near * pulse;
        ctx.strokeStyle = "#ff3b2e";
        ctx.lineWidth = 4 * scale;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.5, r * C.TILT * 1.55, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.restore();
  }

  function drawFace(ctx, ch, ball, r, now) {
    const eyeY = -r * 0.12;
    const eyeDX = r * 0.34;
    const eyeR = r * 0.17;

    let tx = 0, ty = 0;
    if (ball) {
      const dx = ball.x - ch.x, dy = (ball.y - ch.y) * C.TILT;
      const d = Math.hypot(dx, dy) || 1;
      tx = (dx / d) * eyeR * 0.5;
      ty = (dy / d) * eyeR * 0.5;
    }
    ch.pupilX += (tx - ch.pupilX) * 0.2;
    ch.pupilY += (ty - ch.pupilY) * 0.2;

    if (ch.blinkT > 0) ch.blinkT--;
    else if (now > ch.blinkAt) { ch.blinkT = 6; ch.blinkAt = now + 1200 + Math.random() * 3500; }

    const dizzy = now < ch.dizzyUntil;
    const blinking = ch.blinkT > 0;

    if (dizzy) {
      ctx.fillStyle = "#12183a";
      const spin = now / 120;
      for (const sx of [-eyeDX, eyeDX]) {
        ctx.save(); ctx.translate(sx, eyeY); ctx.rotate(spin); drawTinyStar(ctx, eyeR * 1.1); ctx.restore();
      }
    } else if (blinking) {
      ctx.strokeStyle = "#12183a";
      ctx.lineWidth = Math.max(2, r * 0.09);
      ctx.beginPath();
      ctx.moveTo(-eyeDX - eyeR, eyeY); ctx.lineTo(-eyeDX + eyeR, eyeY);
      ctx.moveTo(eyeDX - eyeR, eyeY); ctx.lineTo(eyeDX + eyeR, eyeY);
      ctx.stroke();
    } else {
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(-eyeDX, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(eyeDX, eyeY, eyeR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#12183a";
      ctx.beginPath(); ctx.arc(-eyeDX + ch.pupilX, eyeY + ch.pupilY, eyeR * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(eyeDX + ch.pupilX, eyeY + ch.pupilY, eyeR * 0.55, 0, Math.PI * 2); ctx.fill();
    }

    ctx.strokeStyle = "#12183a";
    ctx.lineWidth = Math.max(1.5, r * 0.09);
    let worried = false;
    if (ball) {
      const d = Math.hypot(ball.x - ch.x, ball.y - ch.y);
      worried = ball.speed >= C.HIT_SPEED && d < 220;
    }
    if (worried || dizzy) {
      ctx.fillStyle = "#12183a";
      ctx.beginPath();
      ctx.ellipse(0, r * 0.34, r * 0.16, r * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(0, r * 0.16, r * 0.34, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }
  }

  function drawTinyStar(ctx, sz) {
    ctx.beginPath();
    let rot = -Math.PI / 2;
    const step = Math.PI / 5;
    ctx.moveTo(0, -sz);
    for (let i = 0; i < 5; i++) {
      ctx.lineTo(Math.cos(rot) * sz, Math.sin(rot) * sz); rot += step;
      ctx.lineTo(Math.cos(rot) * sz * 0.45, Math.sin(rot) * sz * 0.45); rot += step;
    }
    ctx.closePath();
    ctx.fill();
  }

  // ---------------- Ball ----------------
  function drawBall(ctx, ball, toScreen, scale) {
    const r = ball.r * scale;
    const now = performance.now();

    // Smooth the "heat" so danger reads clearly and doesn't flicker.
    ball.heat += (ball.danger - ball.heat) * 0.2;
    const hot = ball.heat;

    // Trail: cool amber when safe, blazing red/white when dangerous.
    const trailCol = hot > 0.5 ? "#ff3b2e" : "#ff9b3d";
    const n = ball.trail.length;
    for (let i = 0; i < n; i++) {
      const p = ball.trail[i];
      const s = toScreen(p.x, p.y);
      const f = (i + 1) / n;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = f * (0.25 + hot * 0.35);
      ctx.fillStyle = trailCol;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y - p.z * scale, r * (0.3 + f * (0.5 + hot * 0.3)), r * (0.3 + f * 0.5) * C.TILT, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const s = toScreen(ball.x, ball.y);
    const cx = s.x, cy = s.y - ball.z * scale;

    // Aura ring under the ball: blue "safe" halo when calm, pulsing red "danger" when hot.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    if (hot < 0.4) {
      // calm/safe cue
      const a = (0.4 - hot) / 0.4;
      ctx.globalAlpha = 0.35 * a;
      ctx.strokeStyle = "#63d9ff";
      ctx.lineWidth = 3 * scale;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 1.28, r * 1.28 * C.TILT, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (hot > 0.3) {
      // danger cue: pulsing red-hot glow + radiating sparks
      const pulse = 1 + Math.sin(now / 90) * 0.12;
      const g = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 2.1 * pulse);
      g.addColorStop(0, `rgba(255,80,40,${0.5 * hot})`);
      g.addColorStop(1, "rgba(255,40,20,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 2.1 * pulse, r * 2.1 * pulse * C.TILT, 0, 0, Math.PI * 2);
      ctx.fill();
      // sparks
      ctx.strokeStyle = `rgba(255,220,120,${0.6 * hot})`;
      ctx.lineWidth = 2 * scale;
      for (let i = 0; i < 6; i++) {
        const a = now / 120 + i * (Math.PI / 3);
        const r0 = r * 1.25, r1 = r * (1.7 + Math.random() * 0.5);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * C.TILT);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * C.TILT);
        ctx.stroke();
      }
    }
    ctx.restore();

    let sk = 0, ang = 0;
    if (ball.squashT > 0) { sk = ball.squashT / 9; ang = ball.squashAng; }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.scale(1 - sk * 0.4, 1 + sk * 0.25);
    ctx.rotate(-ang);
    ctx.scale(1, C.TILT * 1.05);

    const spr = SPR.ball();
    const d = r * 1.18;
    ctx.drawImage(spr, -d, -d, d * 2, d * 2);

    // Red-hot overlay tints the ball toward danger (kept inside the ball radius).
    if (hot > 0.3) {
      ctx.globalAlpha = (hot - 0.3) * 0.55;
      ctx.fillStyle = "#ff3524";
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.94, r * 0.94, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Bomb Ball look — dark shell with a pulsing red core.
    if (ball.bomb) {
      const bp = 0.5 + Math.sin(now / 110) * 0.5;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "#160606";
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.94, r * 0.94, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.5 + bp * 0.5;
      ctx.fillStyle = "#ff3b2e";
      ctx.beginPath(); ctx.arc(0, 0, r * 0.34, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Live spinning seam
    ctx.strokeStyle = ball.bomb ? "rgba(255,120,90,0.7)" : "rgba(120,20,10,0.55)";
    ctx.lineWidth = Math.max(1.5, r * 0.08);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.6, r * 0.6, ball.spin, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ---------------- Power-ups ----------------
  function drawPickup(ctx, pk, toScreen, scale) {
    const def = C.POWERUPS[pk.id];
    pk.bob += 0.06;
    const s = toScreen(pk.x, pk.y);
    const r = pk.r * scale;
    const floaty = Math.sin(pk.bob) * 6 * scale;
    const cx = s.x, cy = s.y - floaty;
    const now = performance.now();
    const blink = pk.expires - now < 2500 ? (Math.sin(now / 120) * 0.4 + 0.6) : 1;

    ctx.save();
    // ground shadow
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + 4 * scale, r * 0.8, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = blink;
    const pulse = 1.5 + Math.sin(now / 220) * 0.25;
    ctx.shadowColor = def.color;
    ctx.shadowBlur = 18 * scale;
    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, r * pulse);
    glow.addColorStop(0, def.color);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, r * pulse, 0, Math.PI * 2); ctx.fill();

    // dark neon disc + ring
    ctx.fillStyle = "#0b1030";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 10 * scale;
    ctx.lineWidth = 3; ctx.strokeStyle = def.color; ctx.stroke();
    ctx.shadowBlur = 0;

    // pre-rendered neon icon
    const icon = SPR.powerIcon(pk.id);
    const isz = r * 1.5;
    ctx.drawImage(icon, cx - isz / 2, cy - isz / 2, isz, isz);

    // Name label beneath the pickup so players learn what it is on sight.
    ctx.globalAlpha = blink;
    ctx.font = `${Math.round(r * 0.6)}px Impact, "Haettenschweiler", "Arial Black", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3 * scale;
    ctx.strokeStyle = "rgba(5,6,20,0.9)";
    ctx.fillStyle = def.color;
    const ly = cy + r + r * 0.7;
    ctx.strokeText(def.label, cx, ly);
    ctx.fillText(def.label, cx, ly);
    ctx.restore();
  }

  // ---- color helpers ----
  function lighten(hex, t) {
    const c = hex.replace("#", "");
    const n = parseInt(c.length === 3 ? c.split("").map((x) => x + x).join("") : c, 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.round(r + (255 - r) * t);
    g = Math.round(g + (255 - g) * t);
    b = Math.round(b + (255 - b) * t);
    return `rgb(${r},${g},${b})`;
  }
  function hexA(hex, a) {
    const c = hex.replace("#", "");
    const n = parseInt(c.length === 3 ? c.split("").map((x) => x + x).join("") : c, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  window.RENDER = { draw };
})();
