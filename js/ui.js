/* ============================================================
   ui.js — DOM screens + HUD management.
   Keeps all querySelector wiring in one place; game.js drives it.
   Exposed on window.UI.
   ============================================================ */
(function () {
  "use strict";
  const C = window.CONFIG;

  const el = (id) => document.getElementById(id);

  const UI = {
    selectedChar: 0,
    selectedMode: "lives",
    selectedDifficulty: "normal",
    bests: {},

    init(handlers) {
      this.handlers = handlers;
      this.buildCharPicker();
      this.buildLegend();

      // Title-screen tabs: Play (options) / How to Play (instructions).
      document.querySelectorAll(".tab").forEach((btn) => {
        btn.addEventListener("click", () => {
          const t = btn.dataset.tab;
          document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("selected", b === btn));
          el("tab-play").classList.toggle("hidden", t !== "play");
          el("tab-help").classList.toggle("hidden", t !== "help");
        });
      });

      // Mode buttons
      document.querySelectorAll(".mode-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("selected"));
          btn.classList.add("selected");
          this.selectedMode = btn.dataset.mode;
          this.refreshBestLine();
        });
      });

      // Difficulty buttons
      document.querySelectorAll(".diff-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          document.querySelectorAll(".diff-btn").forEach((b) => b.classList.remove("selected"));
          btn.classList.add("selected");
          this.selectedDifficulty = btn.dataset.diff;
          this.refreshBestLine();
        });
      });

      el("btn-start").addEventListener("click", () => handlers.onStart(this.getChoices()));
      el("btn-next").addEventListener("click", () => handlers.onNext());
      el("btn-again").addEventListener("click", () => handlers.onPlayAgain());

      // Pause / resume
      const bp = el("btn-pause"); if (bp) bp.addEventListener("click", () => handlers.onPause());
      const br = el("btn-resume"); if (br) br.addEventListener("click", () => handlers.onResume());

      // Audio controls
      const mute = el("btn-mute");
      const vol = el("vol");
      mute.addEventListener("click", () => handlers.onToggleMute());
      vol.addEventListener("input", () => handlers.onVolume(vol.value / 100));
    },

    buildCharPicker() {
      const wrap = el("char-picker");
      wrap.innerHTML = "";
      const RES = 128;   // fixed backing resolution; CSS scales each face so all fit one row
      this._portraits = [];
      // Track the cursor/finger in client coords so the eyes can follow it.
      if (!this._cursorHooked) {
        this._cursor = { x: -1e5, y: -1e5 };
        const track = (x, y) => { this._cursor.x = x; this._cursor.y = y; };
        window.addEventListener("mousemove", (e) => track(e.clientX, e.clientY));
        window.addEventListener("touchmove", (e) => {
          if (e.touches[0]) track(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });
        this._cursorHooked = true;
      }

      C.CHARACTERS.forEach((ch, i) => {
        const sw = document.createElement("div");
        sw.className = "char-swatch" + (i === 0 ? " selected" : "");
        sw.title = ch.name;

        const cv = document.createElement("canvas");
        cv.className = "swatch-face";
        cv.width = RES; cv.height = RES;

        sw.appendChild(cv);
        sw.addEventListener("click", () => {
          this.selectedChar = i;
          document.querySelectorAll(".char-swatch").forEach((s) => s.classList.remove("selected"));
          sw.classList.add("selected");
        });
        wrap.appendChild(sw);

        this._portraits.push({
          canvas: cv, ctx: cv.getContext("2d"), color: ch.color || ch,
          size: RES, bob: Math.random() * Math.PI * 2,
          pupilX: 0, pupilY: 0, blinkT: 0, blinkAt: performance.now() + 800 + Math.random() * 3000,
        });
      });
    },

    // Animate the picker faces (bob + blink + cursor-following eyes) only while
    // the start screen is visible, so it costs nothing during gameplay.
    startPortraits() {
      if (this._portraitRAF || !this._portraits || !window.RENDER || !window.RENDER.portrait) return;
      const loop = () => {
        this._portraitRAF = requestAnimationFrame(loop);
        this.drawPortraits();
      };
      this._portraitRAF = requestAnimationFrame(loop);
    },
    stopPortraits() {
      if (this._portraitRAF) { cancelAnimationFrame(this._portraitRAF); this._portraitRAF = 0; }
    },
    drawPortraits() {
      const now = performance.now();
      const cur = this._cursor || { x: -1e5, y: -1e5 };
      for (const p of this._portraits) {
        const g = p.ctx, size = p.size;
        // Eye target: unit direction from this face's center toward the cursor.
        const rect = p.canvas.getBoundingClientRect();
        const dx = cur.x - (rect.left + rect.width / 2);
        const dy = cur.y - (rect.top + rect.height / 2);
        const d = Math.hypot(dx, dy) || 1;
        const tx = d > 2 ? dx / d : 0, ty = d > 2 ? dy / d : 0;
        p.pupilX += (tx - p.pupilX) * 0.2;
        p.pupilY += (ty - p.pupilY) * 0.2;
        // Blink timer.
        if (p.blinkT > 0) p.blinkT--;
        else if (now > p.blinkAt) { p.blinkT = 6; p.blinkAt = now + 1500 + Math.random() * 3500; }
        // Gentle idle bob.
        p.bob += 0.06;
        const bobY = Math.sin(p.bob) * size * 0.03;

        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, size, size);
        g.translate(size / 2, size / 2 + bobY);
        window.RENDER.portrait(g, p.color, size * 0.4, {
          pupilX: p.pupilX, pupilY: p.pupilY, blink: p.blinkT > 0,
        });
      }
    },

    // Start-screen power-up key: icon + name + what it does.
    buildLegend() {
      const wrap = el("power-legend");
      if (!wrap) return;
      wrap.innerHTML = "";
      C.POWERUP_ORDER.forEach((id) => {
        const def = C.POWERUPS[id];
        const icon = (window.SPR && window.SPR.powerIconURL)
          ? `<img src="${window.SPR.powerIconURL(id)}" alt="" />`
          : `<span>${def.icon}</span>`;
        const item = document.createElement("div");
        item.className = "legend-item";
        item.style.setProperty("--pu", def.color);
        item.innerHTML = `<span class="legend-icon">${icon}</span>` +
          `<span class="legend-text"><b>${def.label}</b>${def.desc}</span>`;
        wrap.appendChild(item);
      });
    },

    getChoices() {
      return { charIndex: this.selectedChar, mode: this.selectedMode, difficulty: this.selectedDifficulty };
    },

    // ---- best score / settings display ----
    // Bests are keyed by "mode:difficulty"; the title line shows the record
    // for whatever configuration is currently selected.
    setBests(bests) {
      this.bests = bests || {};
      this.refreshBestLine();
    },
    refreshBestLine() {
      const e = el("best-line");
      if (!e) return;
      const rec = this.bests[this.selectedMode + ":" + this.selectedDifficulty];
      if (rec && rec.score) {
        e.textContent = `Best: ${rec.score.toLocaleString()} pts · Round ${rec.round}`;
      } else if (rec && rec.round) {
        e.textContent = `Best: Round ${rec.round}`;
      } else {
        e.textContent = "";
      }
    },
    setVolumeSlider(v) {
      const e = el("vol");
      if (e) e.value = Math.round(v * 100);
    },

    // ---- pause overlay ----
    showPause(on) {
      const e = el("screen-pause");
      if (e) e.classList.toggle("hidden", !on);
    },

    // ---- screen switching ----
    show(id) { el(id).classList.remove("hidden"); },
    hide(id) { el(id).classList.add("hidden"); },
    showScreen(which) {
      ["screen-start", "screen-round", "screen-over"].forEach((s) => this.hide(s));
      if (which) this.show(which);
      // Only animate the picker faces while the title screen is on view.
      if (which === "screen-start") this.startPortraits();
      else this.stopPortraits();
    },

    setHudVisible(v) {
      el("hud").classList.toggle("hidden", !v);
      // The pause button lives in the always-visible settings cluster, so show
      // it only while a round is actually in progress.
      const bp = el("btn-pause");
      if (bp) bp.classList.toggle("hidden", !v);
    },

    // ---- HUD ----
    updateHud(state) {
      // Cache element handles once (called every rendered frame, so avoid
      // re-querying the DOM and only write when a value actually changes).
      const h = this._hud || (this._hud = {
        round: el("hud-round-num"),
        score: el("hud-score"),
        combo: el("hud-combo"),
        comboCount: el("hud-combo") && el("hud-combo").querySelector(".hc-count"),
        comboFill: el("hud-combo") && el("hud-combo").querySelector(".hc-fill"),
        lives: el("hud-lives"),
        alive: el("hud-alive"),
        powers: el("hud-powers"),
      });
      const now = performance.now();
      const player = state.player;

      if (h.round) h.round.textContent = state.round;

      const scoreStr = (state.score || 0).toLocaleString();
      if (h.score && scoreStr !== this._lastScore) { h.score.textContent = scoreStr; this._lastScore = scoreStr; }

      // Live combo meter: appears while a knockout chain (2+) is still within
      // its window, with a bar that drains as the window runs out.
      if (h.combo) {
        const remain = C.COMBO_WINDOW - (now - state.combo.time);
        if (state.combo.count >= 2 && remain > 0) {
          h.combo.classList.remove("hidden");
          if (h.comboCount) h.comboCount.textContent = state.combo.count + "x COMBO";
          if (h.comboFill) h.comboFill.style.width =
            Math.max(0, Math.min(100, (remain / C.COMBO_WINDOW) * 100)) + "%";
        } else {
          h.combo.classList.add("hidden");
        }
      }

      let livesStr;
      if (state.mode === "lives" && player.alive) {
        livesStr = "❤️".repeat(player.lives) + "🖤".repeat(Math.max(0, C.LIVES - player.lives));
      } else {
        livesStr = state.mode === "oneHit" ? "☝️ 1-Hit" : "";
      }
      if (h.lives && livesStr !== this._lastLives) { h.lives.textContent = livesStr; this._lastLives = livesStr; }

      let aliveCount = 0;
      for (const c of state.chars) if (c.alive) aliveCount++;
      if (h.alive && aliveCount !== this._lastAlive) {
        h.alive.textContent = `${aliveCount} left in the pit`;
        this._lastAlive = aliveCount;
      }

      // Active power chips for the player. The bar widths animate, so the
      // string changes while a timed power is active; when none are active the
      // string is "" and the dirty-check skips the innerHTML write entirely.
      const chips = [];
      const p = player;
      const balls = state.balls || [];
      if (p.alive) {
        if (p.boosted) chips.push(chip("speed", p.speedBoostUntil - now, C.DURATIONS.speed));
        if (p.magnet) chips.push(chip("magnet", p.magnetUntil - now, C.DURATIONS.magnet));
        const giantBall = balls.find((b) => b.giant);
        if (giantBall) chips.push(chip("giant", giantBall.giantUntil - now, C.DURATIONS.giant));
        if (p.smashReady) chips.push(chip("smash", 1, 1));
        if (balls.some((b) => b.bomb)) chips.push(chip("bomb", 1, 1));
        if (p.shield) chips.push(chip("shield", 1, 1));
        if (p.frozen) chips.push(chip("freeze", p.frozenUntil - now, C.DURATIONS.freeze));
      }
      const chipsHTML = chips.join("");
      if (h.powers && chipsHTML !== this._lastChips) { h.powers.innerHTML = chipsHTML; this._lastChips = chipsHTML; }

      function chip(id, remain, total) {
        const def = C.POWERUPS[id];
        const pct = total > 0 ? Math.max(0, Math.min(100, (remain / total) * 100)) : 100;
        const noBar = id === "shield" || id === "smash" || id === "bomb";
        const bar = noBar
          ? ""
          : `<span class="pc-bar"><span class="pc-fill" style="width:${pct}%"></span></span>`;
        // Use the pre-rendered neon icon so the HUD matches the arena art.
        const icon = (window.SPR && window.SPR.powerIconURL)
          ? `<img class="pc-icon" src="${window.SPR.powerIconURL(id)}" alt="" />`
          : `<span class="pc-icon">${def.icon}</span>`;
        return `<span class="power-chip">${icon}<span class="pc-name">${def.label}</span>${bar}</span>`;
      }
    },

    // ---- toast ----
    toast(text, ms, variant) {
      const t = el("toast");
      t.textContent = text;
      t.classList.remove("hidden");
      t.classList.toggle("toast-power", variant === "power");
      t.classList.toggle("toast-penalty", variant === "penalty");
      // retrigger animation
      t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
      clearTimeout(this._toastTimer);
      if (ms) this._toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
    },
    hideToast() { el("toast").classList.add("hidden"); },

    // ---- round clear screen ----
    showRoundClear(nextRound, newPowers, score) {
      const rs = el("round-score");
      if (rs) rs.textContent = `${(score || 0).toLocaleString()} pts`;
      const boss = C.BOSS_EVERY && nextRound % C.BOSS_EVERY === 0;
      el("round-next").textContent = boss
        ? `Round ${nextRound}: BOSS ROUND — a Champion awaits!`
        : `Get ready for Round ${nextRound}!`;
      const np = el("round-newpower");
      if (newPowers && newPowers.length) {
        const names = newPowers.map((id) => `${C.POWERUPS[id].icon} ${C.POWERUPS[id].label}`).join("  •  ");
        np.innerHTML = `New power-up unlocked!<br>${names}`;
        np.classList.remove("hidden");
      } else {
        np.classList.add("hidden");
      }
      this.showScreen("screen-round");
    },

    // ---- game over ----
    showGameOver(round, score, kos, best, isNewBest) {
      const koLine = kos === 1 ? "1 knockout" : `${kos} knockouts`;
      el("over-result").textContent = `Round ${round} · ${koLine}`;
      el("over-score").innerHTML =
        `<span class="os-num">${(score || 0).toLocaleString()}</span>` +
        `<span class="os-label">POINTS</span>` +
        (isNewBest ? `<span class="os-new">★ NEW BEST!</span>` : "");
      el("over-best").textContent =
        best && best.score ? `Best: ${best.score.toLocaleString()} pts · Round ${best.round}` : "";
      // Refresh the title-screen record so it reflects this run next time.
      if (best) { this.bests[this.selectedMode + ":" + this.selectedDifficulty] = best; }
      this.showScreen("screen-over");
    },

    setMuteIcon(muted) { el("btn-mute").textContent = muted ? "🔇" : "🔊"; },
  };

  window.UI = UI;
})();
