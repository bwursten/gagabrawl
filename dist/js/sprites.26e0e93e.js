/* ============================================================
   sprites.js — runtime pre-rendering.
   We draw each character body, the ball, and the power-up icons ONCE
   to offscreen canvases (with rich, expensive shading) and then just
   stamp those images every frame. No external asset files: everything
   is generated in-browser, so the embed stays fully self-contained.
   Exposed on window.SPR.
   ============================================================ */
(function () {
  "use strict";
  const C = window.CONFIG;

  const BODY = 220;   // native character-body sprite size (px, square)
  const BALLPX = 200; // native ball sprite size
  const ICON = 128;   // native power-up icon size

  const bodyCache = new Map();   // color.fill -> canvas
  let ballCache = null;
  const iconCache = new Map();   // id -> canvas
  const iconURL = new Map();     // id -> dataURL (for the HUD)

  function make(w, h) {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    return cv;
  }

  function lighten(hex, t) {
    const c = hex.replace("#", "");
    const n = parseInt(c.length === 3 ? c.split("").map((x) => x + x).join("") : c, 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.round(r + (255 - r) * t);
    g = Math.round(g + (255 - g) * t);
    b = Math.round(b + (255 - b) * t);
    return `rgb(${r},${g},${b})`;
  }

  // ---- Character body: a glossy neon sphere ----
  function charBody(color) {
    if (bodyCache.has(color.fill)) return bodyCache.get(color.fill);
    const cv = make(BODY, BODY);
    const g = cv.getContext("2d");
    const cx = BODY / 2, cy = BODY / 2, r = BODY / 2 - 14;

    // Outer neon glow halo
    g.save();
    g.shadowColor = color.fill;
    g.shadowBlur = 26;

    // Base sphere
    const grad = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.2, cx, cy, r);
    grad.addColorStop(0, lighten(color.fill, 0.55));
    grad.addColorStop(0.65, color.fill);
    grad.addColorStop(1, color.rim);
    g.fillStyle = grad;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.restore();

    // Ambient occlusion at the bottom
    const ao = g.createRadialGradient(cx, cy + r * 0.55, r * 0.1, cx, cy + r * 0.2, r);
    ao.addColorStop(0, "rgba(0,0,0,0.28)");
    ao.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = ao;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();

    // Neon rim light (bright upper edge)
    g.lineWidth = 5;
    g.strokeStyle = lighten(color.fill, 0.7);
    g.beginPath(); g.arc(cx, cy, r - 2, Math.PI * 1.05, Math.PI * 1.95); g.stroke();

    // Crisp outline
    g.lineWidth = 4;
    g.strokeStyle = color.rim;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();

    // Glossy specular highlight
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.beginPath();
    g.ellipse(cx - r * 0.32, cy - r * 0.38, r * 0.26, r * 0.17, -0.5, 0, Math.PI * 2);
    g.fill();

    bodyCache.set(color.fill, cv);
    return cv;
  }

  // ---- Ball: glossy sphere (seam + squash drawn live in render) ----
  function ball() {
    if (ballCache) return ballCache;
    const cv = make(BALLPX, BALLPX);
    const g = cv.getContext("2d");
    const cx = BALLPX / 2, cy = BALLPX / 2, r = BALLPX / 2 - 16;

    g.save();
    g.shadowColor = "rgba(255,150,60,0.9)";
    g.shadowBlur = 26;
    const grad = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.15, cx, cy, r);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.25, "#ffe27a");
    grad.addColorStop(0.7, "#ff9b3d");
    grad.addColorStop(1, "#ff6a2a");
    g.fillStyle = grad;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.restore();

    g.lineWidth = 5;
    g.strokeStyle = "#d9531e";
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();

    g.fillStyle = "rgba(255,255,255,0.65)";
    g.beginPath();
    g.ellipse(cx - r * 0.3, cy - r * 0.34, r * 0.22, r * 0.15, -0.5, 0, Math.PI * 2);
    g.fill();

    ballCache = cv;
    return cv;
  }

  // ---- Power-up icons: custom neon vector glyphs ----
  function powerIcon(id) {
    if (iconCache.has(id)) return iconCache.get(id);
    const def = C.POWERUPS[id];
    const cv = make(ICON, ICON);
    const g = cv.getContext("2d");
    g.save();
    g.translate(ICON / 2, ICON / 2);
    g.shadowColor = def.color;
    g.shadowBlur = 14;
    g.fillStyle = "#ffffff";
    g.strokeStyle = "#ffffff";
    g.lineJoin = "round";
    g.lineCap = "round";
    const s = ICON * 0.30; // glyph radius unit
    GLYPHS[id](g, s);
    // second pass for a bright neon core
    g.shadowBlur = 0;
    GLYPHS[id](g, s);
    g.restore();
    iconCache.set(id, cv);
    return cv;
  }

  function powerIconURL(id) {
    if (iconURL.has(id)) return iconURL.get(id);
    const url = powerIcon(id).toDataURL();
    iconURL.set(id, url);
    return url;
  }

  // Vector glyph drawers (centered at 0,0; `s` ~ half-size)
  const GLYPHS = {
    speed(g, s) { // lightning bolt
      g.beginPath();
      g.moveTo(s * 0.25, -s);
      g.lineTo(-s * 0.55, s * 0.18);
      g.lineTo(-s * 0.05, s * 0.18);
      g.lineTo(-s * 0.25, s);
      g.lineTo(s * 0.6, -s * 0.2);
      g.lineTo(s * 0.08, -s * 0.2);
      g.closePath();
      g.fill();
    },
    shield(g, s) { // shield
      g.beginPath();
      g.moveTo(0, -s);
      g.quadraticCurveTo(s, -s * 0.8, s, -s * 0.2);
      g.quadraticCurveTo(s, s * 0.7, 0, s);
      g.quadraticCurveTo(-s, s * 0.7, -s, -s * 0.2);
      g.quadraticCurveTo(-s, -s * 0.8, 0, -s);
      g.closePath();
      g.fill();
      g.strokeStyle = "#0b1030"; g.lineWidth = s * 0.14;
      g.beginPath(); g.moveTo(-s * 0.35, 0); g.lineTo(-s * 0.08, s * 0.35); g.lineTo(s * 0.42, -s * 0.35); g.stroke();
      g.strokeStyle = "#ffffff";
    },
    giant(g, s) { // big circle + small satellite
      g.beginPath(); g.arc(-s * 0.1, s * 0.05, s * 0.85, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#0b1030";
      g.beginPath(); g.arc(-s * 0.1, s * 0.05, s * 0.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#ffffff";
      g.beginPath(); g.arc(s * 0.7, -s * 0.6, s * 0.3, 0, Math.PI * 2); g.fill();
    },
    freeze(g, s) { // snowflake
      g.lineWidth = s * 0.16;
      for (let i = 0; i < 6; i++) {
        g.save(); g.rotate((Math.PI / 3) * i);
        g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -s); g.stroke();
        g.beginPath(); g.moveTo(0, -s * 0.6); g.lineTo(s * 0.3, -s * 0.8); g.stroke();
        g.beginPath(); g.moveTo(0, -s * 0.6); g.lineTo(-s * 0.3, -s * 0.8); g.stroke();
        g.restore();
      }
    },
    smash(g, s) { // explosive starburst
      g.beginPath();
      const pts = 10;
      for (let i = 0; i < pts * 2; i++) {
        const rad = i % 2 === 0 ? s : s * 0.45;
        const a = (Math.PI * i) / pts - Math.PI / 2;
        const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
      g.fill();
    },
    life(g, s) { // heart
      g.beginPath();
      g.moveTo(0, s * 0.85);
      g.bezierCurveTo(-s * 1.3, -s * 0.1, -s * 0.5, -s, 0, -s * 0.35);
      g.bezierCurveTo(s * 0.5, -s, s * 1.3, -s * 0.1, 0, s * 0.85);
      g.closePath();
      g.fill();
    },
    bomb(g, s) { // bomb with a fuse
      g.beginPath(); g.arc(0, s * 0.22, s * 0.72, 0, Math.PI * 2); g.fill();
      // fuse
      g.strokeStyle = "#ffffff"; g.lineWidth = s * 0.16;
      g.beginPath(); g.moveTo(s * 0.35, -s * 0.35); g.quadraticCurveTo(s * 0.75, -s * 0.7, s * 0.55, -s * 0.95); g.stroke();
      // spark
      g.fillStyle = "#ffd76a";
      g.beginPath(); g.arc(s * 0.55, -s, s * 0.16, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#ffffff";
    },
    multi(g, s) { // two overlapping balls
      g.beginPath(); g.arc(-s * 0.35, s * 0.15, s * 0.6, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(s * 0.4, -s * 0.2, s * 0.5, 0, Math.PI * 2); g.fill();
    },
    magnet(g, s) { // horseshoe magnet
      g.lineWidth = s * 0.5;
      g.strokeStyle = "#ffffff";
      g.beginPath();
      g.arc(0, 0, s * 0.72, Math.PI, 0, false);
      g.stroke();
      // legs
      g.beginPath(); g.moveTo(-s * 0.72, 0); g.lineTo(-s * 0.72, s * 0.7); g.stroke();
      g.beginPath(); g.moveTo(s * 0.72, 0); g.lineTo(s * 0.72, s * 0.7); g.stroke();
      // poles
      g.lineWidth = 1;
      g.fillStyle = "#0b1030";
      g.fillRect(-s * 0.95, s * 0.55, s * 0.46, s * 0.28);
      g.fillRect(s * 0.49, s * 0.55, s * 0.46, s * 0.28);
      g.fillStyle = "#ffffff";
    },
  };

  // ---- Cached soft radial "glow puddle" per color ----
  // Used for entity underglow, ball danger aura, pickup glow — stamped with
  // drawImage instead of building a fresh gradient every frame (huge win on
  // Firefox, which is slow at per-frame createRadialGradient/shadowBlur).
  const PUDDLE = 128;
  const puddleCache = new Map();
  function glowPuddle(color) {
    if (puddleCache.has(color)) return puddleCache.get(color);
    const cv = make(PUDDLE, PUDDLE);
    const g = cv.getContext("2d");
    const c = PUDDLE / 2;
    const grad = g.createRadialGradient(c, c, 1, c, c, c);
    grad.addColorStop(0, color);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.fill();
    puddleCache.set(color, cv);
    return cv;
  }

  window.SPR = {
    BODY, BALLPX, ICON,
    charBody, ball, powerIcon, powerIconURL, glowPuddle,
    // rebuild everything if palette changes (not used at runtime, handy for dev)
    clear() { bodyCache.clear(); ballCache = null; iconCache.clear(); iconURL.clear(); puddleCache.clear(); },
  };
})();
