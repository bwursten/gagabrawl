/* ============================================================
   geometry.js — octagonal pit math and small vector helpers
   Exposed on window.GEO.
   ============================================================ */
(function () {
  "use strict";
  const C = window.CONFIG;

  // Build a regular octagon centered in the world, as a list of vertices
  // and a list of edges each with an inward-pointing "wall" definition:
  //   { nx, ny, d }  where a point p is inside that edge when p.x*nx + p.y*ny <= d.
  // worldW/worldH default to a square C.WORLD world; passing a taller worldH
  // (mobile portrait) yields a vertically elongated octagon with independent
  // horizontal (Rx) and vertical (Ry) radii. All edge math below is generic,
  // so the physics work unchanged for a stretched pit.
  function buildOctagon(worldW, worldH, margin) {
    worldW = worldW || C.WORLD;
    worldH = worldH || C.WORLD;
    if (margin == null) margin = C.PIT_MARGIN;
    const cx = worldW / 2;
    const cy = worldH / 2;
    const Rx = worldW / 2 - margin;
    const Ry = worldH / 2 - margin;
    const verts = [];
    // Flat-top-ish octagon: start offset so edges are horizontal/vertical/diagonal
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i + Math.PI / 8;
      verts.push({ x: cx + Rx * Math.cos(a), y: cy + Ry * Math.sin(a) });
    }
    const edges = [];
    for (let i = 0; i < 8; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % 8];
      // Edge direction
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      // Outward normal (points away from center). For a CCW/CW polygon we
      // just orient it away from the center explicitly.
      let nx = ey;
      let ny = -ex;
      const len = Math.hypot(nx, ny) || 1;
      nx /= len; ny /= len;
      // ensure it points outward (away from center)
      const mx = (a.x + b.x) / 2 - cx;
      const my = (a.y + b.y) / 2 - cy;
      if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
      const d = nx * a.x + ny * a.y; // wall offset along outward normal
      edges.push({ nx, ny, d });
    }
    // R kept for callers that want a single "safe" radius (spawn rings, etc.).
    const R = Math.min(Rx, Ry);
    return { cx, cy, R, Rx, Ry, verts, edges };
  }

  // Push a circle of given radius back inside the octagon.
  // Returns { x, y, hit, nx, ny } — hit true if it touched a wall.
  function clampCircleInside(oct, x, y, r) {
    let hit = false, hnx = 0, hny = 0;
    for (const e of oct.edges) {
      const dist = x * e.nx + y * e.ny - (e.d - r);
      if (dist > 0) {
        // outside this edge by `dist` — push back along inward normal
        x -= e.nx * dist;
        y -= e.ny * dist;
        hit = true; hnx = e.nx; hny = e.ny;
      }
    }
    return { x, y, hit, nx: hnx, ny: hny };
  }

  // Reflect velocity v across a wall normal n (unit). Adds slight energy for bounce.
  function reflect(vx, vy, nx, ny, restitution) {
    const dot = vx * nx + vy * ny;
    return {
      vx: (vx - 2 * dot * nx) * restitution,
      vy: (vy - 2 * dot * ny) * restitution,
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
  function rand(min, max) { return min + Math.random() * (max - min); }

  // Random point comfortably inside the octagon (used for spawns).
  function randomInside(oct, pad) {
    for (let i = 0; i < 40; i++) {
      const x = oct.cx + GEO.rand(-oct.Rx, oct.Rx);
      const y = oct.cy + GEO.rand(-oct.Ry, oct.Ry);
      const c = clampCircleInside(oct, x, y, pad);
      if (Math.abs(c.x - x) < 0.5 && Math.abs(c.y - y) < 0.5) return { x, y };
    }
    return { x: oct.cx, y: oct.cy };
  }

  const GEO = { buildOctagon, clampCircleInside, reflect, clamp, dist, rand, randomInside };
  window.GEO = GEO;
})();
