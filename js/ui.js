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
      C.CHARACTERS.forEach((ch, i) => {
        const sw = document.createElement("div");
        sw.className = "char-swatch" + (i === 0 ? " selected" : "");
        sw.style.background = ch.fill;
        sw.style.borderColor = i === 0 ? "#1b2440" : "rgba(27,36,64,0.25)";
        sw.title = ch.name;
        sw.addEventListener("click", () => {
          this.selectedChar = i;
          document.querySelectorAll(".char-swatch").forEach((s) => s.classList.remove("selected"));
          sw.classList.add("selected");
        });
        wrap.appendChild(sw);
      });
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
      el("hud-round-num").textContent = state.round;
      const scoreEl = el("hud-score");
      if (scoreEl) scoreEl.textContent = (state.score || 0).toLocaleString();

      // Live combo meter: appears while a knockout chain (2+) is still within
      // its window, with a bar that drains as the window runs out.
      const comboEl = el("hud-combo");
      if (comboEl) {
        const remain = C.COMBO_WINDOW - (performance.now() - state.combo.time);
        if (state.combo.count >= 2 && remain > 0) {
          comboEl.classList.remove("hidden");
          comboEl.querySelector(".hc-count").textContent = state.combo.count + "x COMBO";
          comboEl.querySelector(".hc-fill").style.width =
            Math.max(0, Math.min(100, (remain / C.COMBO_WINDOW) * 100)) + "%";
        } else {
          comboEl.classList.add("hidden");
        }
      }

      const player = state.player;
      const livesEl = el("hud-lives");
      if (state.mode === "lives" && player.alive) {
        livesEl.textContent = "❤️".repeat(player.lives) + "🖤".repeat(Math.max(0, C.LIVES - player.lives));
      } else {
        livesEl.textContent = state.mode === "oneHit" ? "☝️ 1-Hit" : "";
      }
      const aliveCount = state.chars.filter((c) => c.alive).length;
      el("hud-alive").textContent = `${aliveCount} left in the pit`;

      // Active power chips for the player
      const now = performance.now();
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
      el("hud-powers").innerHTML = chips.join("");

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
