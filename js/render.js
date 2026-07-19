/* ============================================================
   render.js — neon-arcade renderer (performance-optimized).

   Angled top-down look: world is vertically squashed around its center
   (CONFIG.TILT) so round sprites read as slight-perspective ellipses.

   PERF: the static arena (background, floor, grid, neon walls with baked
   bloom) is pre-rendered to an offscreen canvas ONCE per size/round-theme
   and blitted each frame. Entity/ball/pickup glows use cached sprites
   (see sprites.js) instead of building gradients or running shadowBlur
   every frame — this is what keeps Firefox (slow at both) smooth.
   Exposed on window.RENDER.
   ============================================================ */
(function () {
  "use strict";
  const C = window.CONFIG;
  const SPR = window.SPR;

  // Effective perspective squash for the current frame (set in draw() from
  // state.tilt so mobile can use a flatter, un-squished view). All render
  // helpers read this instead of TILT directly.
  let TILT = C.TILT;

  // Fit-and-center the world into a canvas of any aspect ratio: the pit is
  // centered and scaled to fit both dimensions (letterboxing with arena
  // background). Works for square (desktop) and tall (mobile) canvases alike.
  function fitScale(W, H, worldW, worldH) {
    worldW = worldW || C.WORLD;
    worldH = worldH || C.WORLD;
    return Math.min(W / worldW, H / (worldH * TILT));
  }
  function makeToScreen(scale, W, H, worldW, worldH) {
    const halfX = (worldW || C.WORLD) / 2;
    const halfY = (worldH || C.WORLD) / 2;
    return function (x, y) {
      return { x: W / 2 + (x - halfX) * scale, y: H / 2 + (y - halfY) * TILT * scale };
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
    for (let i = 0; i < 30; i++) {
      motes.push({
        x: Math.random(), y: Math.random(),
        r: 0.6 + Math.random() * 2.2,
        spd: 0.00006 + Math.random() * 0.00016,
        drift: (Math.random() - 0.5) * 0.00008,
        a: 0.1 + Math.random() * 0.3,
      });
    }
  }

  // ---------------- Pre-rendered arena cache ----------------
  let arena = { key: "", base: null, vignette: null };

  function getArena(w, h, scale, theme, oct, world) {
    const key = w + "x" + h + ":" + theme.name + ":" + Math.round((world && world.h) || C.WORLD) + ":" + Math.round(TILT * 100);
    if (arena.key === key && arena.base) return arena;
    arena.key = key;
    arena.base = buildArenaBase(w, h, scale, theme, oct, world);
    arena.vignette = buildVignette(w, h);
    return arena;
  }

  function newCanvas(w, h) {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    return cv;
  }

  function buildArenaBase(w, h, scale, theme, oct, world) {
    const cv = newCanvas(w, h);
    const ctx = cv.getContext("2d");
    const toScreen = makeToScreen(scale, w, h, world && world.w, world && world.h);
    const c = toScreen(oct.cx, oct.cy);
    // Elongated pits have distinct horizontal/vertical radii; fall back to R.
    const Rx = oct.Rx || oct.R;
    const Ry = oct.Ry || oct.R;
    const RR = Math.max(Rx, Ry);

    // Background gradient + corner glow blobs
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, C.BG_TOP); bg.addColorStop(1, C.BG_BOTTOM);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    blob(ctx, w * 0.15, h * 0.12, h * 0.5, theme.wall, 0.10);
    blob(ctx, w * 0.88, h * 0.9, h * 0.55, "#ff3df0", 0.07);

    // Floor
    ctx.save();
    tracePoly(ctx, oct.verts, toScreen);
    ctx.clip();
    const fg = ctx.createLinearGradient(0, c.y - Ry * scale, 0, c.y + Ry * scale);
    fg.addColorStop(0, C.FLOOR_TOP); fg.addColorStop(1, C.FLOOR_BOTTOM);
    ctx.fillStyle = fg; ctx.fillRect(0, 0, w, h);

    const cg = ctx.createRadialGradient(c.x, c.y, 10, c.x, c.y, RR * scale);
    cg.addColorStop(0, hexA(theme.glow, 0.85)); cg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = cg; ctx.fillRect(0, 0, w, h);

    // Neon grid (static)
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1.5 * scale;
    const step = 78;
    ctx.beginPath();
    for (let wx = oct.cx - Rx; wx <= oct.cx + Rx; wx += step) {
      const sx = toScreen(wx, oct.cy).x; ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
    }
    for (let wy = oct.cy - Ry; wy <= oct.cy + Ry; wy += step) {
      const sy = toScreen(oct.cx, wy).y; ctx.moveTo(0, sy); ctx.lineTo(w, sy);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 2 * scale;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      const rr = oct.R * scale * (i / 4);
      ctx.ellipse(c.x, c.y, rr, rr * TILT, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // Neon-tube walls with baked bloom (shadowBlur done ONCE here, not per frame)
    ctx.lineJoin = "round";
    tracePoly(ctx, oct.verts, toScreen);
    ctx.lineWidth = C.WALL_THICKNESS * scale;
    ctx.strokeStyle = "#0a0e28"; ctx.stroke();
    ctx.shadowColor = theme.wall;
    ctx.shadowBlur = 16 * scale;
    tracePoly(ctx, oct.verts, toScreen);
    ctx.lineWidth = C.WALL_THICKNESS * 0.5 * scale;
    ctx.strokeStyle = theme.wall; ctx.globalAlpha = 0.9; ctx.stroke();
    ctx.shadowBlur = 8 * scale;
    tracePoly(ctx, oct.verts, toScreen);
    ctx.lineWidth = C.WALL_THICKNESS * 0.22 * scale;
    ctx.strokeStyle = lighten(theme.wall, 0.6); ctx.globalAlpha = 1; ctx.stroke();
    ctx.shadowBlur = 0;

    return cv;
  }

  function buildVignette(w, h) {
    const cv = newCanvas(w, h);
    const ctx = cv.getContext("2d");
    const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.32, w / 2, h / 2, h * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(2,2,12,0.62)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    return cv;
  }

  // ---------------- Main draw ----------------
  function draw(ctx, state) {
    const canvas = ctx.canvas;
    const W = canvas.width, H = canvas.height;
    TILT = state.tilt || C.TILT;
    const world = state.world || { w: C.WORLD, h: C.WORLD };
    const scale = fitScale(W, H, world.w, world.h);
    const toScreen = makeToScreen(scale, W, H, world.w, world.h);
    state.toScreen = toScreen;
    state.scale = scale;
    const theme = themeForRound(state.round);
    const A = getArena(W, H, scale, theme, state.oct, world);

    // Cover the whole canvas first so screen-shake never reveals gaps.
    ctx.fillStyle = C.BG_BOTTOM;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    const shake = state.shake || 0;
    if (shake > 0.2) {
      ctx.translate((Math.random() * 2 - 1) * shake * scale, (Math.random() * 2 - 1) * shake * scale);
    }

    // Static arena (single blit)
    ctx.drawImage(A.base, 0, 0);

    // Cheap animated overlays: drifting motes + wall-impact flash
    drawMotes(ctx, W, H, theme);
    drawWallFlash(ctx, state, toScreen, scale, theme);

    // Hazard zones are floor effects — draw them under everything else.
    const obstacles = (state.obstacles && state.obstacles.obstacles) || [];
    drawHazards(ctx, obstacles, toScreen, scale);

    const activeBalls = state.ballLive ? state.balls : [];

    // Glows (cached sprites, additive)
    for (const ch of state.chars) if (ch.alive) drawUnderglow(ctx, ch.x, ch.y, ch.r * 1.6, ch.color.fill, toScreen, scale);
    for (const b of activeBalls) drawUnderglow(ctx, b.x, b.y, b.r * 1.5, b.bomb ? "#ff3b3b" : "#ff8a3d", toScreen, scale);

    // Depth sort by world-y (solid obstacles included so they occlude correctly).
    const drawables = [];
    for (const ch of state.chars) if (ch.alive) drawables.push({ y: ch.y, kind: "char", obj: ch });
    for (const b of activeBalls) drawables.push({ y: b.y, kind: "ball", obj: b });
    for (const o of obstacles) if (o.solid) drawables.push({ y: o.y, kind: "obstacle", obj: o });
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) {
      if (d.kind === "char") {
        if (d.obj.isBoss) drawBossRing(ctx, d.obj, toScreen, scale);
        drawCharacter(ctx, d.obj, activeBalls, toScreen, scale);
      } else if (d.kind === "obstacle") {
        drawObstacle(ctx, d.obj, toScreen, scale, theme);
      } else {
        drawBall(ctx, d.obj, toScreen, scale);
      }
    }

    for (const pk of state.powerups.pickups) drawPickup(ctx, pk, toScreen, scale);

    state.fx.draw(ctx, toScreen, scale);
    ctx.restore();

    ctx.drawImage(A.vignette, 0, 0);

    // Subtle touch indicator (screen space) so the player sees the drag registered.
    if (state.touch && state.touch.active) {
      const rr = Math.min(W, H) * 0.05;
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = Math.max(2, rr * 0.12);
      ctx.strokeStyle = "#22e6ff";
      ctx.beginPath(); ctx.arc(state.touch.x, state.touch.y, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "#22e6ff";
      ctx.beginPath(); ctx.arc(state.touch.x, state.touch.y, rr * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawMotes(ctx, W, H, theme) {
    if (!motes) seedMotes();
    const now = performance.now();
    ctx.save();
    ctx.fillStyle = theme.wall;
    for (const m of motes) {
      m.y -= m.spd; m.x += m.drift;
      if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }
      ctx.globalAlpha = m.a * (0.6 + 0.4 * Math.sin(now / 700 + m.x * 20));
      ctx.beginPath();
      ctx.arc(m.x * W, m.y * H, m.r * (H / 900), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Cheap additive stroke over the (already glowing) baked walls on impact.
  function drawWallFlash(ctx, state, toScreen, scale, theme) {
    let last = 0;
    for (const b of state.balls) if (b.wallFlash > last) last = b.wallFlash;
    const flash = Math.max(0, 1 - (performance.now() - last) / 220);
    if (flash <= 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = flash;
    ctx.lineJoin = "round";
    ctx.lineWidth = C.WALL_THICKNESS * 0.4 * scale;
    ctx.strokeStyle = flash > 0.5 ? "#ffffff" : theme.wall;
    tracePoly(ctx, state.oct.verts, toScreen);
    ctx.stroke();
    ctx.restore();
  }

  // ---- Obstacles ----
  // Neon polygon path (centered at 0,0; local space) — points on a circle of
  // radius r, offset so it reads flat-topped like the arena wall.
  function polyPath(ctx, r, sides, rot) {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = rot + (i * 2 * Math.PI) / sides + Math.PI / sides;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  // Star path (alternating outer/inner radius) in local space.
  function starPath(ctx, outer, inner, points, rot) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const a = rot + (Math.PI / points) * i - Math.PI / 2;
      const rr = i % 2 ? inner : outer;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  // Hazard floor zones: pulsing neon-red pool with a rotating dashed hazard
  // ring and warning spokes.
  function drawHazards(ctx, obstacles, toScreen, scale) {
    const now = performance.now();
    for (const o of obstacles) {
      if (!o.hazard) continue;
      const s = toScreen(o.x, o.y);
      const r = o.r * scale;
      const pulse = 0.5 + 0.5 * Math.sin(now / 300 + o.x * 0.01);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.scale(1, TILT);
      const g = ctx.createRadialGradient(0, 0, 1, 0, 0, r);
      g.addColorStop(0, "rgba(255,90,45," + (0.34 + 0.16 * pulse).toFixed(3) + ")");
      g.addColorStop(0.65, "rgba(255,50,25,0.14)");
      g.addColorStop(1, "rgba(255,25,12,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      // rotating dashed hazard ring
      ctx.rotate(now / 2600);
      ctx.strokeStyle = "rgba(255,140,70," + (0.55 + 0.3 * pulse).toFixed(3) + ")";
      ctx.lineWidth = Math.max(1.5, 3 * scale);
      ctx.setLineDash([10 * scale, 7 * scale]);
      ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      // warning spokes
      ctx.strokeStyle = "rgba(255,185,115," + (0.35 + 0.4 * pulse).toFixed(3) + ")";
      ctx.lineWidth = Math.max(1.5, 2.5 * scale);
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.moveTo(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3);
        ctx.lineTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // Solid obstacles as neon-tube structures matching the arena aesthetic:
  //   pillar — slowly rotating octagon in the round's wall color
  //   bumper — pulsing orange ring with outward boost chevrons
  //   mover  — spinning violet 4-point star
  function drawObstacle(ctx, o, toScreen, scale, theme) {
    const s = toScreen(o.x, o.y);
    const r = o.r * scale;
    const now = performance.now();
    const flash = Math.max(0, 1 - (now - (o.flash || 0)) / 220);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.scale(1, TILT);              // draw in circular space; perspective via transform
    ctx.lineJoin = "round";
    // soft ground shadow
    ctx.fillStyle = "rgba(0,0,0,0.30)";
    ctx.beginPath(); ctx.arc(0, r * 0.32, r * 0.96, 0, Math.PI * 2); ctx.fill();

    if (o.type === "bumper") drawBumper(ctx, r, scale, now, flash);
    else if (o.type === "mover") drawMover(ctx, r, scale, now, flash);
    else drawPillar(ctx, r, scale, now, flash, theme);
    ctx.restore();
  }

  function drawPillar(ctx, r, scale, now, flash, theme) {
    const col = theme.wall;
    const rot = now / 2600;
    ctx.globalAlpha = 0.16; ctx.fillStyle = col;
    polyPath(ctx, r * 0.95, 8, rot); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = (10 + flash * 22) * scale;
    ctx.lineWidth = Math.max(2.5, 4 * scale);
    polyPath(ctx, r * 0.95, 8, rot); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = lighten(col, 0.6); ctx.globalAlpha = 0.9;
    ctx.lineWidth = Math.max(1.5, 2 * scale);
    polyPath(ctx, r * 0.5, 8, -rot * 1.6); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawBumper(ctx, r, scale, now, flash) {
    const col = "#ff9b2f";
    const pulse = 0.86 + 0.14 * Math.sin(now / 180);
    ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = (12 + flash * 24) * scale;
    ctx.lineWidth = Math.max(2.5, 5 * scale);
    ctx.beginPath(); ctx.arc(0, 0, r * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.55; ctx.lineWidth = Math.max(1.5, 2.5 * scale);
    ctx.beginPath(); ctx.arc(0, 0, r * 0.58, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    // outward boost chevrons
    const rot = now / 700;
    ctx.strokeStyle = lighten(col, 0.5); ctx.lineWidth = Math.max(2, 3 * scale);
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.rotate(rot + (i * Math.PI) / 2);
      ctx.translate(r * 0.74, 0);
      const s2 = r * 0.2;
      ctx.beginPath();
      ctx.moveTo(-s2, -s2); ctx.lineTo(s2 * 0.55, 0); ctx.lineTo(-s2, s2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawMover(ctx, r, scale, now, flash) {
    const col = "#c07bff";
    ctx.rotate(now / 500);
    ctx.globalAlpha = 0.18; ctx.fillStyle = col;
    starPath(ctx, r * 0.98, r * 0.42, 4, 0); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = (10 + flash * 22) * scale;
    ctx.lineWidth = Math.max(2.5, 4 * scale);
    starPath(ctx, r * 0.98, r * 0.42, 4, 0); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = lighten(col, 0.6);
    ctx.beginPath(); ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2); ctx.fill();
  }

  // Golden pulsing ground ring marking the boss brawler.
  function drawBossRing(ctx, ch, toScreen, scale) {
    const s = toScreen(ch.x, ch.y);
    const rx = ch.r * scale * 1.3, ry = ch.r * scale * TILT * 1.3;
    const now = performance.now();
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.5 + 0.3 * Math.sin(now / 240);
    ctx.strokeStyle = "#ffd23f";
    ctx.shadowColor = "#ffd23f"; ctx.shadowBlur = 14 * scale;
    ctx.lineWidth = Math.max(2, 3 * scale);
    ctx.beginPath(); ctx.ellipse(s.x, s.y + ry * 0.35, rx, ry * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function blob(ctx, x, y, r, color, alpha) {
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.globalAlpha = alpha; ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function tracePoly(ctx, verts, toScreen) {
    ctx.beginPath();
    verts.forEach((v, i) => {
      const s = toScreen(v.x, v.y);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
  }

  // ---------------- Underglow (cached sprite) ----------------
  function drawUnderglow(ctx, x, y, r, color, toScreen, scale) {
    const s = toScreen(x, y);
    const rr = r * scale;
    ctx.save();
    // soft dark contact shadow
    ctx.fillStyle = "rgba(0,0,0,0.30)";
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + rr * 0.28, rr * 0.62, rr * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    // neon puddle (pre-rendered sprite, additive)
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.55;
    const spr = SPR.glowPuddle(color);
    const w = rr * 2.2, hh = rr * 1.3;
    ctx.drawImage(spr, s.x - w / 2, s.y + rr * 0.28 - hh / 2, w, hh);
    ctx.restore();
  }

  // ---------------- Characters ----------------
  function drawCharacter(ctx, ch, balls, toScreen, scale) {
    const now = performance.now();
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
    const ang = spd > 0.3 ? Math.atan2(ch.dispY * TILT, ch.dispX) : 0;
    let hk = 0;
    if (ch.squashT > 0) { hk = ch.squashT / 8; ch.squashT--; }

    ctx.save();
    ctx.translate(cx, cy);

    ctx.save();
    ctx.rotate(ang);
    ctx.scale(1 + stretch, 1 - stretch * 0.55);
    ctx.rotate(-ang);
    ctx.scale(1 + hk * 0.3, 1 - hk * 0.4);
    ctx.scale(1, TILT * 1.05);
    const body = SPR.charBody(ch.color);
    const d = r * 1.16;
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
      const ay = -r * (TILT * 1.05) - 10 * scale;
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
      ctx.ellipse(0, 0, r, r * TILT * 1.05, 0, 0, Math.PI * 2);
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

    if (ch.smashReady) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const pulse = 0.7 + Math.sin(now / 70) * 0.3;
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = "#ffb02e";
      ctx.lineWidth = 3 * scale;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.45, r * TILT * 1.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#fff3c4";
      ctx.lineWidth = 2 * scale;
      for (let i = 0; i < 5; i++) {
        const a = now / 90 + i * (Math.PI * 2 / 5);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 1.3, Math.sin(a) * r * 1.3 * TILT);
        ctx.lineTo(Math.cos(a) * r * (1.7 + Math.random() * 0.3), Math.sin(a) * r * 1.7 * TILT);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (ch.shield) {
      const pulse = 1 + Math.sin(now / 150) * 0.05;
      ctx.strokeStyle = "rgba(120,215,255,0.95)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.35 * pulse, r * TILT * 1.4 * pulse, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(77,195,255,0.12)";
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.35 * pulse, r * TILT * 1.4 * pulse, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Danger warning ring for the human player when a hot ball is closing in.
    if (ch.isPlayer && ball && ball.heat > 0.5 && !ch.shield) {
      const dd = Math.hypot(ball.x - ch.x, ball.y - ch.y);
      const batterGrace = ball.lastHitter === ch && (now - ball.lastHitTime) < C.HIT_GRACE_MS;
      if (dd < 230 && !batterGrace) {
        const near = 1 - dd / 230;
        const pulse = 0.6 + Math.sin(now / 80) * 0.4;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = near * pulse;
        ctx.strokeStyle = "#ff3b2e";
        ctx.lineWidth = 4 * scale;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.5, r * TILT * 1.55, 0, 0, Math.PI * 2);
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
      const dx = ball.x - ch.x, dy = (ball.y - ch.y) * TILT;
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

    ball.heat += (ball.danger - ball.heat) * 0.2;
    const hot = ball.heat;

    // Trail
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
      ctx.ellipse(s.x, s.y - p.z * scale, r * (0.3 + f * (0.5 + hot * 0.3)), r * (0.3 + f * 0.5) * TILT, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const s = toScreen(ball.x, ball.y);
    const cx = s.x, cy = s.y - ball.z * scale;

    // Danger aura via cached glow sprite (no per-frame gradient).
    if (hot < 0.4) {
      const a = (0.4 - hot) / 0.4;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.3 * a;
      const p = SPR.glowPuddle("#63d9ff");
      const d = r * 3;
      ctx.drawImage(p, cx - d / 2, cy - d / 2 * TILT, d, d * TILT);
      ctx.restore();
    }
    if (hot > 0.3) {
      const pulse = 1 + Math.sin(now / 90) * 0.12;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.55 * hot;
      const p = SPR.glowPuddle("#ff5028");
      const d = r * 4 * pulse;
      ctx.drawImage(p, cx - d / 2, cy - d / 2 * TILT, d, d * TILT);
      ctx.globalAlpha = 0.6 * hot;
      ctx.strokeStyle = "#ffdc78";
      ctx.lineWidth = 2 * scale;
      for (let i = 0; i < 6; i++) {
        const a = now / 120 + i * (Math.PI / 3);
        const r0 = r * 1.25, r1 = r * (1.7 + Math.random() * 0.4);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * TILT);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * TILT);
        ctx.stroke();
      }
      ctx.restore();
    }

    let sk = 0, ang = 0;
    if (ball.squashT > 0) { sk = ball.squashT / 9; ang = ball.squashAng; }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.scale(1 - sk * 0.4, 1 + sk * 0.25);
    ctx.rotate(-ang);
    ctx.scale(1, TILT * 1.05);

    const spr = SPR.ball();
    const d = r * 1.18;
    ctx.drawImage(spr, -d, -d, d * 2, d * 2);

    if (hot > 0.3) {
      ctx.globalAlpha = (hot - 0.3) * 0.55;
      ctx.fillStyle = "#ff3524";
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.94, r * 0.94, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

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
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + 4 * scale, r * 0.8, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = blink;
    // pulsing glow via cached sprite (additive), no shadowBlur
    const pulse = 3 + Math.sin(now / 220) * 0.5;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = blink * 0.9;
    const glow = SPR.glowPuddle(def.color);
    const gd = r * pulse;
    ctx.drawImage(glow, cx - gd / 2, cy - gd / 2, gd, gd);
    ctx.restore();

    // dark neon disc + ring
    ctx.globalAlpha = blink;
    ctx.fillStyle = "#0b1030";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = def.color; ctx.stroke();

    const icon = SPR.powerIcon(pk.id);
    const isz = r * 1.5;
    ctx.drawImage(icon, cx - isz / 2, cy - isz / 2, isz, isz);

    // Name label
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
