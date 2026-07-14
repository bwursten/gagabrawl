/* ============================================================
   config.js — tuning constants and preset data
   All gameplay "feel" knobs live here so they're easy to adjust.
   Exposed on the global CONFIG object.
   ============================================================ */
(function () {
  "use strict";

  const CONFIG = {
    // ---- World / pit ----
    // Logical world is a square. Rendering scales this to the canvas.
    WORLD: 1000,
    PIT_MARGIN: 90,          // gap between world edge and pit wall
    WALL_THICKNESS: 26,
    TILT: 0.90,              // vertical squash to fake an angled top-down view (1 = flat top-down)

    // ---- Characters ----
    CHAR_RADIUS: 30,
    PLAYER_SPEED: 8.2,       // how fast the player lerps toward the cursor
    PLAYER_FOLLOW: 0.18,     // easing factor toward pointer
    HOP_HEIGHT: 6,           // idle bob amount

    // ---- Ball ----
    BALL_RADIUS: 26,
    BALL_BASE_SPEED: 5.2,    // speed a fresh round starts at (floaty / moderate)
    BALL_MIN_SPEED: 2.2,     // resting drift; below this the ball is "safe" to bat
    BALL_MAX_SPEED: 16,
    BALL_FRICTION: 0.995,    // gentle so it stays floaty
    BALL_RAMP_PER_SEC: 0.10, // how much max drift speed climbs each second of the round
    HIT_SPEED: 6.4,          // ball must be at/above this speed to DAMAGE a character
    HIT_LAUNCH: 9.5,         // speed imparted when a character bats the ball
    HIT_GRACE_MS: 260,       // the batter is immune to their own shot briefly
    BALL_GIANT_SCALE: 2.1,

    // ---- Rounds / difficulty ----
    START_AI: 3,
    MAX_AI: 5,
    AI_ADD_EVERY: 2,         // +1 AI every N rounds (capped at MAX_AI)
    AI_SPEED_BASE: 4.6,
    AI_SPEED_PER_ROUND: 0.35,
    AI_AGGRO_BASE: 0.25,     // chance per decision to actively intercept
    AI_AGGRO_PER_ROUND: 0.06,

    // ---- Power-ups ----
    POWERUP_FIRST_MS: 6000,  // first spawn delay after round start
    POWERUP_EVERY_MS: 9000,  // spawn cadence
    POWERUP_LIFETIME_MS: 9000,
    POWERUP_RADIUS: 24,
    DURATIONS: {             // effect durations in ms
      speed: 6000,
      giant: 6000,
      freeze: 3500,
      magnet: 6500,
      shield: 0,             // lasts until consumed
      smash: 0,              // lasts until next bat
      bomb: 0,               // lasts until next knockout
      life: 0,               // instant
    },
    SPEED_MULT: 1.7,
    FREEZE_RANGE: 300,
    MAGNET_RANGE: 260,
    MAGNET_PULL: 0.55,
    BOMB_RADIUS: 210,        // area-of-effect radius for Bomb Ball
    MULTIBALL_MS: 9000,      // lifespan of an extra ball from Multi-Ball
    MAX_BALLS: 3,            // safety cap on simultaneous balls

    LIVES: 3,

    // ---- Juice / visual feel ----
    BALL_TRAIL: 10,          // number of trail ghosts behind the ball
    SHAKE_HIT: 9,            // screen-shake magnitude on a damaging hit
    SHAKE_ELIM: 16,         // screen-shake magnitude on an elimination
    SHAKE_DECAY: 0.86,      // per-frame shake falloff
    HITSTOP_HIT: 3,         // frames of freeze on a damaging hit
    HITSTOP_ELIM: 6,        // frames of freeze on an elimination
    DUST_SPEED: 3.2,        // char movement speed above which dust puffs kick up

    // ---- Pre-round "Ga! Ga! Ga! Ball!" countdown ----
    COUNTDOWN_START_DELAY: 500,  // ms before the chant begins (lets players settle)
    COUNTDOWN_STEP: 580,         // ms between each chant beat

    // ---- Neon-arcade theme ----
    // Each round cycles to the next accent so advancing visibly reskins the arena.
    NEON_THEMES: [
      { name: "cyan",    wall: "#22e6ff", grid: "rgba(34,230,255,0.30)", glow: "#0e5a72" },
      { name: "magenta", wall: "#ff3df0", grid: "rgba(255,61,240,0.28)", glow: "#5e1160" },
      { name: "lime",    wall: "#8dff3a", grid: "rgba(141,255,58,0.26)", glow: "#2f6a12" },
      { name: "orange",  wall: "#ff9b2f", grid: "rgba(255,155,47,0.28)", glow: "#6b3910" },
      { name: "violet",  wall: "#9b6dff", grid: "rgba(155,109,255,0.30)", glow: "#3a2a75" },
    ],
    BG_TOP: "#0a0824",
    BG_BOTTOM: "#04030e",
    FLOOR_TOP: "#0b1436",
    FLOOR_BOTTOM: "#070b22",
  };

  // Character color presets (rim + fill + a friendly face accent)
  CONFIG.CHARACTERS = [
    { id: "tomato",   name: "Tomato",   fill: "#ff5d73", rim: "#c62f45" },
    { id: "tangerine",name: "Tangerine",fill: "#ff9d3f", rim: "#cc6d10" },
    { id: "sunny",    name: "Sunny",    fill: "#ffcf3f", rim: "#c99a00" },
    { id: "lime",     name: "Lime",     fill: "#5fd86b", rim: "#2f9e3a" },
    { id: "sky",      name: "Sky",      fill: "#4dc3ff", rim: "#1f8fd1" },
    { id: "grape",    name: "Grape",    fill: "#a97bff", rim: "#7346d6" },
    { id: "bubble",   name: "Bubble",   fill: "#ff8fd0", rim: "#d martin" },
    { id: "mint",     name: "Mint",     fill: "#57e8c9", rim: "#1fae91" },
  ];
  // fix a typo above safely
  CONFIG.CHARACTERS[6].rim = "#d64fa0";

  // AI-only palette (player's chosen color is removed from this at runtime)
  CONFIG.AI_COLORS = CONFIG.CHARACTERS.slice();

  // Power-up definitions: icon, color, label, description
  CONFIG.POWERUPS = {
    speed:  { icon: "⚡", color: "#ffcf3f", label: "Speed Boost",  unlockRound: 1, desc: "Zip around faster." },
    shield: { icon: "🛡️", color: "#4dc3ff", label: "Shield Bubble",unlockRound: 1, desc: "Blocks one hit." },
    giant:  { icon: "🔴", color: "#ff5d73", label: "Giant Ball",   unlockRound: 2, desc: "Ball gets huge." },
    smash:  { icon: "💥", color: "#ff9b2f", label: "Super Smash",  unlockRound: 2, desc: "Next bat fires at max speed." },
    freeze: { icon: "❄️", color: "#9fe6ff", label: "Freeze Ray",   unlockRound: 3, desc: "Freezes nearby foes." },
    life:   { icon: "❤️", color: "#37d67a", label: "Extra Life",   unlockRound: 3, desc: "Regain a life (or a free save)." },
    magnet: { icon: "🧲", color: "#a97bff", label: "Magnet Hands", unlockRound: 4, desc: "Ball curves to you." },
    bomb:   { icon: "💣", color: "#ff3b3b", label: "Bomb Ball",    unlockRound: 4, desc: "Blast out everyone nearby on the next knockout." },
    multi:  { icon: "⊚",  color: "#ff6ad5", label: "Multi-Ball",   unlockRound: 5, desc: "A second ball joins the chaos." },
  };
  // Ordered list for spawn selection
  CONFIG.POWERUP_ORDER = ["speed", "shield", "giant", "smash", "freeze", "life", "magnet", "bomb", "multi"];

  window.CONFIG = CONFIG;
})();
