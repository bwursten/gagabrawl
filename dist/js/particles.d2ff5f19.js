/* ============================================================
   particles.js — lightweight particle system for confetti/stars
   poof on elimination, pickup sparkles, and toasts.
   Exposed on window.FX.
   ============================================================ */
(function () {
  "use strict";
  const GEO = window.GEO;

  class Particles {
    constructor() { this.list = []; this.rings = []; }

    // Confetti + star burst when a character is eliminated.
    poof(x, y, color) {
      const colors = ["#ff5d73", "#ffcf3f", "#4dc3ff", "#5fd86b", "#a97bff", color || "#fff"];
      for (let i = 0; i < 34; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = GEO.rand(2, 9);
        this.list.push({
          x, y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 2,
          g: 0.28,
          life: 1,
          decay: GEO.rand(0.012, 0.03),
          size: GEO.rand(5, 12),
          color: colors[(Math.random() * colors.length) | 0],
          star: Math.random() < 0.4,
          rot: Math.random() * Math.PI,
          vr: GEO.rand(-0.3, 0.3),
        });
      }
    }

    // Small sparkle ring when a power-up is collected.
    sparkle(x, y, color) {
      for (let i = 0; i < 18; i++) {
        const a = (Math.PI * 2 * i) / 18;
        const sp = GEO.rand(3, 6);
        this.list.push({
          x, y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          g: 0.02,
          life: 1,
          decay: 0.04,
          size: GEO.rand(4, 8),
          color,
          star: true,
          rot: a,
          vr: 0.2,
        });
      }
    }

    // Soft dust puff kicked up at a character's feet while dashing.
    dust(x, y, color) {
      const a = Math.random() * Math.PI * 2;
      const sp = GEO.rand(0.4, 1.8);
      this.list.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 0.6,
        g: -0.02,
        life: 1,
        decay: GEO.rand(0.05, 0.09),
        size: GEO.rand(5, 11),
        color: color || "rgba(255,255,255,0.7)",
        dust: true,
        rot: 0, vr: 0,
      });
    }

    // Expanding shockwave ring on a solid impact / elimination.
    shockwave(x, y, color, big) {
      this.rings.push({
        x, y,
        r: big ? 14 : 8,
        grow: big ? 9 : 6,
        life: 1,
        decay: big ? 0.05 : 0.07,
        color: color || "#ffffff",
        width: big ? 7 : 4,
      });
    }

    update() {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const p = this.list[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.g;
        p.vx *= 0.99;
        if (p.dust) { p.vx *= 0.92; p.vy *= 0.92; p.size *= 1.03; }
        p.rot += p.vr;
        p.life -= p.decay;
        if (p.life <= 0) this.list.splice(i, 1);
      }
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i];
        r.r += r.grow;
        r.grow *= 0.94;
        r.life -= r.decay;
        if (r.life <= 0) this.rings.splice(i, 1);
      }
    }

    draw(ctx, toScreen, scale) {
      scale = scale || 1;
      // Shockwave rings (drawn under confetti)
      for (const r of this.rings) {
        const s = toScreen(r.x, r.y);
        ctx.save();
        ctx.globalAlpha = Math.max(0, r.life) * 0.7;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = r.width * scale;
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, r.r * scale, r.r * 0.55 * scale, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      for (const p of this.list) {
        const s = toScreen(p.x, p.y);
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.translate(s.x, s.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.dust) {
          ctx.globalAlpha = Math.max(0, p.life) * 0.5;
          ctx.beginPath();
          ctx.arc(0, 0, p.size * scale, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.star) {
          drawStar(ctx, 0, 0, 5, p.size * scale, p.size * 0.45 * scale);
        } else {
          const sz = p.size * scale;
          ctx.fillRect(-sz / 2, -sz / 2, sz, sz * 0.7);
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawStar(ctx, cx, cy, spikes, outer, inner) {
    let rot = -Math.PI / 2;
    const step = Math.PI / spikes;
    ctx.beginPath();
    ctx.moveTo(cx, cy - outer);
    for (let i = 0; i < spikes; i++) {
      ctx.lineTo(cx + Math.cos(rot) * outer, cy + Math.sin(rot) * outer); rot += step;
      ctx.lineTo(cx + Math.cos(rot) * inner, cy + Math.sin(rot) * inner); rot += step;
    }
    ctx.closePath();
    ctx.fill();
  }

  window.FX = { Particles };
})();
