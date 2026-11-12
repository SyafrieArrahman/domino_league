(() => {
  "use strict";

  const KEY = "domino-match-manager-v1";
  const UNDO_KEY = "domino-match-undo-v1";
  const POINT_OPTIONS = [
    { value: "1:4", label: "Juara 1 · +4 poin" },
    { value: "1:5", label: "Juara 1 · +5 poin" },
    { value: "2:3", label: "Juara 2 · +3 poin" },
    { value: "3:2", label: "Juara 3 · +2 poin" },
    { value: "4:1", label: "Juara 4 · +1 poin" },
    { value: "4:-1", label: "Juara 4 · -1 poin" }
  ];
  const $ = id => document.getElementById(id);
  const THEME_KEY = "domino-match-theme-v1";
  let theme = "light";
  try {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === "light" || savedTheme === "dark") theme = savedTheme;
  } catch (error) {}
  document.documentElement.dataset.theme = theme;
  let state = load();
  let undoSnapshot = loadUndo();
  let activeStandings = "match";
  let arenaOpen = Boolean(state.pendingBattle?.arena);
  let arenaPreviousFocus = null;
  let toastTimer = null;
  let timerInterval = null;
  let wakeLock = null;
  let wakeLockBusy = false;

  function fresh() {
    return {
      sessionName: "", started: false, players: [], active: [], queue: [], rounds: [],
      nextId: 1, nextQueueOrder: 1, matchRoundCount: 0, matchNumber: 1,
      matchPoints: {}, lastMatch: null, pendingBattle: null, lastBattle: null,
      timer: { running: false, elapsedMs: 0, startedAt: null }
    };
  }

  function normalizeState(saved) {
    if (!saved || !Array.isArray(saved.players) || !Array.isArray(saved.active) ||
        !Array.isArray(saved.queue) || !Array.isArray(saved.rounds)) return null;
    const players = saved.players.map(item => ({
      ...item,
      onBreak: Boolean(item.onBreak)
    }));
    const timer = saved.timer && typeof saved.timer === "object"
      ? {
          running: Boolean(saved.timer.running),
          elapsedMs: Number(saved.timer.elapsedMs) || 0,
          startedAt: saved.timer.startedAt ? Number(saved.timer.startedAt) : null
        }
      : { running: false, elapsedMs: 0, startedAt: null };
    return {
      ...fresh(), ...saved, players,
      matchPoints: saved.matchPoints || {},
      matchNumber: saved.matchNumber || 1,
      matchRoundCount: saved.matchRoundCount || 0,
      pendingBattle: saved.pendingBattle || null,
      lastBattle: saved.lastBattle || null,
      timer
    };
  }

  function load() {
    try {
      const normalized = normalizeState(JSON.parse(localStorage.getItem(KEY)));
      if (normalized) return normalized;
    } catch (error) {}
    return fresh();
  }

  /* Membersihkan file cadangan sebelum dipakai: id unik, antrean/meja hanya berisi
     pemain yang ada, dan timer selalu dijeda agar jeda antara ekspor dan impor tidak ikut terhitung. */
  function importState(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.players) || !Array.isArray(raw.rounds)) return null;
    const seen = new Set();
    const players = [];
    raw.players.forEach(item => {
      const id = Number(item && item.id);
      if (!item || !Number.isFinite(id) || seen.has(id)) return;
      if (typeof item.name !== "string" || !item.name.trim()) return;
      seen.add(id);
      players.push({
        ...item, id, name: item.name.trim().slice(0, 32),
        points: Number(item.points) || 0, rounds: Number(item.rounds) || 0, onBreak: Boolean(item.onBreak)
      });
    });
    const known = new Set(players.map(item => item.id));
    const clean = ids => [...new Set((Array.isArray(ids) ? ids : []).map(Number))].filter(id => known.has(id));
    const active = clean(raw.active).slice(0, 4);
    const onBreakIds = new Set(players.filter(item => item.onBreak).map(item => item.id));
    const queue = clean(raw.queue).filter(id => !active.includes(id) && !onBreakIds.has(id));
    players.forEach(item => {
      if (!item.onBreak && !active.includes(item.id) && !queue.includes(item.id)) queue.push(item.id);
    });
    const timer = raw.timer && typeof raw.timer === "object" ? raw.timer : {};
    let elapsedMs = Number(timer.elapsedMs) || 0;
    if (timer.running && timer.startedAt) {
      const endedAt = Number(raw.exportedAt) || Number(timer.startedAt);
      elapsedMs += Math.max(0, endedAt - Number(timer.startedAt));
    }
    const maxId = players.reduce((max, item) => Math.max(max, item.id), 0);
    const imported = normalizeState({
      ...raw, players, active, queue,
      rounds: raw.rounds.filter(round => round && Array.isArray(round.results)),
      nextId: Math.max(Number(raw.nextId) || 1, maxId + 1),
      timer: { running: false, elapsedMs, startedAt: null }
    });
    if (imported) delete imported.exportedAt;
    return imported;
  }

  /* Snapshot undo disimpan di localStorage agar tetap bisa dipakai setelah halaman dimuat ulang.
     Snapshot hanya valid jika tepat satu ronde di belakang kondisi sekarang. */
  function loadUndo() {
    try {
      const raw = localStorage.getItem(UNDO_KEY);
      if (!raw) return null;
      const snapshot = JSON.parse(raw);
      return snapshot && Array.isArray(snapshot.rounds) && snapshot.rounds.length === state.rounds.length - 1 ? raw : null;
    } catch (error) {
      return null;
    }
  }

  function saveUndo(snapshot) {
    undoSnapshot = snapshot;
    try {
      if (snapshot) localStorage.setItem(UNDO_KEY, snapshot);
      else localStorage.removeItem(UNDO_KEY);
    } catch (error) {}
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (error) {}
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return String(hours).padStart(2, "0") + ":" +
        String(minutes).padStart(2, "0") + ":" +
        String(seconds).padStart(2, "0");
    }
    return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  }

  function currentTimerMs() {
    if (!state.timer) state.timer = { running: false, elapsedMs: 0, startedAt: null };
    if (state.timer.running && state.timer.startedAt) {
      return state.timer.elapsedMs + Math.max(0, Date.now() - state.timer.startedAt);
    }
    return state.timer.elapsedMs || 0;
  }

  function syncTimerLoop() {
    clearInterval(timerInterval);
    timerInterval = null;
    if (state.timer?.running) {
      timerInterval = setInterval(renderTimerDisplay, 250);
    }
    syncWakeLock();
  }

  /* Layar tetap menyala selama timer berjalan (jika browser mendukung). */
  async function syncWakeLock() {
    if (!navigator.wakeLock || wakeLockBusy) return;
    wakeLockBusy = true;
    const wanted = () => Boolean(state.timer?.running) && document.visibilityState === "visible";
    try {
      if (wanted() && !wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      }
      if (!wanted() && wakeLock) {
        const lock = wakeLock;
        wakeLock = null;
        await lock.release();
      }
    } catch (error) {
      wakeLock = null;
    }
    wakeLockBusy = false;
  }

  function startStopwatch() {
    if (!state.timer) state.timer = { running: false, elapsedMs: 0, startedAt: null };
    if (!state.timer.running) {
      state.timer.running = true;
      state.timer.startedAt = Date.now();
      persist();
      syncTimerLoop();
      renderTimerDisplay();
    }
  }

  function pauseStopwatch() {
    if (!state.timer || !state.timer.running) return;
    state.timer.elapsedMs = currentTimerMs();
    state.timer.running = false;
    state.timer.startedAt = null;
    persist();
    syncTimerLoop();
    renderTimerDisplay();
  }

  function toggleStopwatch() {
    if (state.timer?.running) {
      pauseStopwatch();
      toast("Waktu dijeda.", "info");
    } else {
      startStopwatch();
      toast("Waktu berjalan.", "info");
    }
  }

  function restartStopwatch(autoStart) {
    const shouldRun = typeof autoStart === "boolean" ? autoStart : Boolean(state.timer?.running);
    state.timer = {
      running: shouldRun,
      elapsedMs: 0,
      startedAt: shouldRun ? Date.now() : null
    };
    persist();
    syncTimerLoop();
    renderTimerDisplay();
  }

  function renderTimerDisplay() {
    const ms = currentTimerMs();
    const isRunning = Boolean(state.timer?.running);
    $("timerDisplay").textContent = formatDuration(ms);
    const toggleBtn = $("timerToggleBtn");
    const badge = $("timerBadge");
    if (isRunning) {
      toggleBtn.textContent = "Jeda";
      toggleBtn.className = "small-btn break-btn";
      badge.textContent = "Berjalan";
      badge.dataset.status = "running";
    } else if (ms > 0) {
      toggleBtn.textContent = "Lanjut";
      toggleBtn.className = "small-btn primary";
      badge.textContent = "Dijeda";
      badge.dataset.status = "paused";
    } else {
      toggleBtn.textContent = "Mulai";
      toggleBtn.className = "small-btn primary";
      badge.textContent = "Berhenti";
      badge.dataset.status = "stopped";
    }
  }

  function toast(message, type) {
    const element = $("toast");
    const styles = {
      success: { icon: "✓", label: "Berhasil" },
      warning: { icon: "!", label: "Perhatian" },
      error: { icon: "×", label: "Ada masalah" },
      info: { icon: "i", label: "Info" }
    };
    const selected = styles[type || "success"] || styles.info;
    $("toastIcon").textContent = selected.icon;
    $("toastMessage").textContent = message;
    element.dataset.type = type || "success";
    element.setAttribute("aria-label", selected.label + ": " + message);
    element.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("show"), type === "error" ? 4600 : 3300);
  }

  function confirmDialog(options) {
    const layer = $("dialogLayer");
    const cancelButton = $("dialogCancel");
    const confirmButton = $("dialogConfirm");
    const closeButton = $("dialogClose");
    const previousFocus = document.activeElement;

    $("dialogKicker").textContent = options.kicker || "Konfirmasi";
    $("dialogTitle").textContent = options.title;
    $("dialogMessage").textContent = options.message;
    $("dialogIcon").textContent = options.icon || (options.tone === "danger" ? "!" : "?");
    cancelButton.textContent = options.cancelText || "Kembali";
    confirmButton.textContent = options.confirmText || "Lanjutkan";
    layer.dataset.tone = options.tone || "default";
    confirmButton.className = "dialog-confirm" + (options.tone === "danger" ? " dialog-danger" : "");
    layer.hidden = false;
    document.body.classList.add("dialog-open");

    return new Promise(resolve => {
      let completed = false;
      const finish = accepted => {
        if (completed) return;
        completed = true;
        layer.hidden = true;
        document.body.classList.remove("dialog-open");
        layer.removeEventListener("click", onBackdrop);
        document.removeEventListener("keydown", onKeydown);
        cancelButton.removeEventListener("click", onCancel);
        confirmButton.removeEventListener("click", onConfirm);
        closeButton.removeEventListener("click", onCancel);
        if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
        resolve(accepted);
      };
      const onCancel = () => finish(false);
      const onConfirm = () => finish(true);
      const onBackdrop = event => { if (event.target === layer) finish(false); };
      const onKeydown = event => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        } else if (event.key === "Tab") {
          const focusable = [closeButton, cancelButton, confirmButton];
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      };
      layer.addEventListener("click", onBackdrop);
      document.addEventListener("keydown", onKeydown);
      cancelButton.addEventListener("click", onCancel);
      confirmButton.addEventListener("click", onConfirm);
      closeButton.addEventListener("click", onCancel);
      requestAnimationFrame(() => cancelButton.focus());
    });
  }

  function applyTheme() {
    document.documentElement.dataset.theme = theme;
    const isDark = theme === "dark";
    $("themeToggle").innerHTML = isDark ? "☀ <span>Terang</span>" : "☾ <span>Gelap</span>";
    $("themeToggle").setAttribute("aria-label", isDark ? "Ganti ke mode terang" : "Ganti ke mode gelap");
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = isDark ? "#0b1310" : "#17503a";
  }

  function player(id) {
    return state.players.find(item => item.id === id);
  }

  function readyQueueIds() {
    return state.queue.filter(id => {
      const p = player(id);
      return p && !p.onBreak;
    });
  }

  function shiftNextReadyFromQueue() {
    const idx = state.queue.findIndex(id => {
      const p = player(id);
      return p && !p.onBreak;
    });
    if (idx === -1) return null;
    const [nextId] = state.queue.splice(idx, 1);
    return nextId;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    })[character]);
  }

  /* ---------- Streak, win rate & gelar dinamis ----------
     Semua dihitung ulang dari state.rounds, jadi otomatis ikut benar
     saat ronde dibatalkan (undo) dan tidak mengubah format data tersimpan.
     BADGE_GUIDE adalah satu-satunya sumber daftar gelar: dipakai untuk
     badge di klasemen sekaligus penjelasan di menu dropdown. */
  const BADGE_LIMIT = 3;
  const BADGE_GUIDE = [
    { cls: "crown", label: "👑 Penguasa Meja", rule: "Poin keseluruhan tertinggi, minimal 2 ronde dimainkan." },
    { cls: "fire", label: "🔥 Win Streak ×N", rule: "Juara 1 minimal 2 ronde berturut-turut." },
    { cls: "comeback", label: "⚡ Comeback", rule: "Juara 1 tepat setelah 3 ronde atau lebih tanpa juara 1." },
    { cls: "king", label: "🎯 Raja Juara 1", rule: "Pemegang juara 1 terbanyak (minimal 3×)." },
    { cls: "arena", label: "⚔️ Jawara Arena", rule: "Menang Battle Arena minimal 2×." },
    { cls: "bonus", label: "⭐ Pemburu Bonus", rule: "Juara 1 dengan +5 poin minimal 2×." },
    { cls: "record", label: "🏅 Rekor Streak ×N", rule: "Pernah win streak 3 ronde atau lebih. Tampil saat streak itu sudah berakhir." },
    { cls: "wall", label: "🧱 Tembok Kokoh", rule: "Minimal 4 ronde dan belum pernah juara 4." },
    { cls: "veteran", label: "🎖 Veteran Meja", rule: "Sudah memainkan 10 ronde atau lebih." },
    { cls: "ice", label: "🥶 Lose Streak ×N", rule: "3 ronde atau lebih berturut-turut tanpa juara 1." },
    { cls: "last", label: "🐌 Juru Kunci", rule: "Juara 4 di separuh ronde atau lebih (minimal 4 ronde)." },
    { cls: "new", label: "🌱 Pendatang Baru", rule: "Baru memainkan 1–2 ronde." }
  ];

  function computePlayerStats() {
    const stats = new Map();
    state.players.forEach(item => stats.set(item.id, {
      played: 0, wins: 0, lastPlaces: 0, bonusWins: 0, arenaWins: 0, bestWin: 0,
      run: { type: null, count: 0 }, comebackFrom: 0
    }));
    state.rounds.forEach(round => {
      (round.results || []).forEach(result => {
        const entry = stats.get(result.id);
        if (!entry) return;
        const type = result.rank === 1 ? "win" : "lose";
        entry.played += 1;
        if (result.rank === 4) entry.lastPlaces += 1;
        if (type === "win") {
          entry.wins += 1;
          if (result.points === 5) entry.bonusWins += 1;
        }
        if (entry.run.type === type) {
          entry.run.count += 1;
          if (type === "win") entry.comebackFrom = 0;
        } else {
          entry.comebackFrom = type === "win" && entry.run.type === "lose" ? entry.run.count : 0;
          entry.run = { type, count: 1 };
        }
        if (type === "win") entry.bestWin = Math.max(entry.bestWin, entry.run.count);
      });
      const cards = round.tieBreakCards || [];
      if (cards.length) {
        const bestByGroup = new Map();
        cards.forEach(card => {
          const best = bestByGroup.get(card.tiedScore);
          if (!best || card.total > best.total) bestByGroup.set(card.tiedScore, card);
        });
        bestByGroup.forEach(card => {
          const entry = stats.get(card.id);
          if (entry) entry.arenaWins += 1;
        });
      }
    });
    return stats;
  }

  function streakChip(entry) {
    if (!entry || !entry.run.count) return "";
    const isWin = entry.run.type === "win";
    const count = entry.run.count;
    const title = isWin
      ? "Juara 1 " + count + " ronde berturut-turut"
      : "Belum juara 1 dalam " + count + " ronde terakhir";
    return '<span class="streak ' + (isWin ? "streak-win" : "streak-lose") +
      (count >= 3 ? " streak-hot" : "") + '" title="' + title + '">' +
      (isWin ? "W" : "L") + count + "</span>";
  }

  function winRateText(entry) {
    return entry && entry.played ? Math.round((entry.wins / entry.played) * 100) + "%" : "–";
  }

  function badgesFor(item, entry, context) {
    if (!entry || !entry.played) return [];
    const list = [];
    const add = (cls, count, hint) => {
      const def = BADGE_GUIDE.find(badge => badge.cls === cls);
      list.push({ cls, text: def.label.replace("×N", count ? "×" + count : ""), hint });
    };
    const runCount = entry.run.count;
    const onWinStreak = entry.run.type === "win" && runCount >= 2;
    if (context.topPoints > 0 && item.points === context.topPoints && entry.played >= 2) add("crown", 0, "Poin keseluruhan tertinggi");
    if (onWinStreak) add("fire", runCount, "Juara 1 " + runCount + " ronde berturut-turut");
    if (entry.comebackFrom >= 3) add("comeback", 0, "Juara 1 setelah " + entry.comebackFrom + " ronde tanpa juara 1");
    if (context.maxWins >= 3 && entry.wins === context.maxWins) add("king", 0, "Juara 1 terbanyak (" + entry.wins + "×)");
    if (entry.arenaWins >= 2) add("arena", 0, "Menang Battle Arena " + entry.arenaWins + "×");
    if (entry.bonusWins >= 2) add("bonus", 0, "Juara 1 dengan +5 poin sebanyak " + entry.bonusWins + "×");
    if (entry.bestWin >= 3 && !onWinStreak) add("record", entry.bestWin, "Win streak terpanjang: " + entry.bestWin + " ronde");
    if (entry.played >= 4 && entry.lastPlaces === 0) add("wall", 0, "Belum pernah juara 4 dalam " + entry.played + " ronde");
    if (entry.played >= 10) add("veteran", 0, "Sudah memainkan " + entry.played + " ronde");
    if (entry.run.type === "lose" && runCount >= 3) add("ice", runCount, runCount + " ronde berturut-turut tanpa juara 1");
    if (entry.played >= 4 && entry.lastPlaces * 2 >= entry.played) add("last", 0, "Juara 4 di " + entry.lastPlaces + " dari " + entry.played + " ronde");
    if (entry.played <= 2) add("new", 0, "Baru memainkan " + entry.played + " ronde");
    return list;
  }

  function badgeMarkup(badges) {
    if (!badges.length) return "";
    return '<div class="badge-row">' + badges.slice(0, BADGE_LIMIT).map(badge =>
      '<span class="badge badge-' + badge.cls + '" title="' + escapeHtml(badge.hint) + '">' + badge.text + "</span>"
    ).join("") + "</div>";
  }

  function renderBadgeGuide() {
    const target = $("badgeGuide");
    if (!target) return;
    const item = (label, rule) =>
      '<div class="badge-guide-item">' + label + '<span class="guide-rule">' + rule + "</span></div>";
    target.innerHTML =
      '<div class="guide-title">Streak &amp; win rate</div>' +
      item('<span class="streak streak-win">W3</span>', "Juara 1 tiga ronde berturut-turut (angka mengikuti jumlah ronde).") +
      item('<span class="streak streak-lose">L2</span>', "Dua ronde berturut-turut tanpa juara 1.") +
      item('<span class="streak streak-none">67%</span>', "Win rate: jumlah juara 1 dibagi jumlah ronde yang dimainkan.") +
      '<div class="guide-title">Gelar (maksimal ' + BADGE_LIMIT + ' tampil, urut dari atas)</div>' +
      BADGE_GUIDE.map(badge => item(
        '<span class="badge badge-' + badge.cls + '">' + badge.label + "</span>", badge.rule
      )).join("");
  }

  function streakAnnouncement(round) {
    const winner = round.results.find(result => result.rank === 1);
    const entry = winner && computePlayerStats().get(winner.id);
    if (!entry) return "";
    if (entry.run.type === "win" && entry.run.count >= 2) {
      return " 🔥 " + winner.name + " win streak ×" + entry.run.count + ".";
    }
    if (entry.comebackFrom >= 3) return " ⚡ " + winner.name + " comeback!";
    return "";
  }

  /* ---------- Rekap sesi ---------- */
  let recapOpen = false;
  let recapData = null;
  let recapFile = null;
  let recapPreviousFocus = null;

  function buildRecap() {
    const stats = computePlayerStats();
    const ranked = state.players
      .filter(item => stats.get(item.id) && stats.get(item.id).played > 0)
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    if (!ranked.length) return null;
    const best = (score, min) => {
      let top = null;
      ranked.forEach(item => {
        const value = score(stats.get(item.id));
        if (value >= min && (!top || value > top.value)) top = { name: item.name, value };
      });
      return top;
    };
    const highlights = [];
    const mostWins = best(entry => entry.wins, 1);
    if (mostWins) highlights.push({ icon: "", label: "Juara 1 terbanyak", name: mostWins.name, value: mostWins.value + "×" });
    const longest = best(entry => entry.bestWin, 2);
    if (longest) highlights.push({ icon: "", label: "Win streak terpanjang", name: longest.name, value: longest.value + " ronde" });
    const rate = best(entry => (entry.played >= 3 ? entry.wins / entry.played : -1), 0.01);
    if (rate) highlights.push({ icon: "", label: "Win rate tertinggi", name: rate.name, value: Math.round(rate.value * 100) + "%" });
    const arena = best(entry => entry.arenaWins, 1);
    if (arena) highlights.push({ icon: "", label: "Jawara Arena", name: arena.name, value: arena.value + "×" });
    const now = new Date();
    const elapsed = currentTimerMs();
    return {
      title: state.sessionName || "Domino Match",
      date: now.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
      fileDate: now.toISOString().slice(0, 10),
      rounds: state.rounds.length,
      matches: state.rounds.filter(round => round.matchRound === 2).length,
      duration: elapsed > 0 ? formatDuration(elapsed) : "–",
      podium: ranked.slice(0, 3).map((item, index) => ({
        medal: String(index + 1), name: item.name, points: item.points,
        rate: winRateText(stats.get(item.id)), played: stats.get(item.id).played
      })),
      highlights
    };
  }

  function recapMarkup(data) {
    const stat = (value, label) =>
      '<div class="recap-stat"><b>' + escapeHtml(value) + "</b><span>" + label + "</span></div>";
    const podium = data.podium.map(row =>
      '<div class="recap-row"><span class="recap-medal">' + row.medal + '</span><span class="recap-name">' +
      escapeHtml(row.name) + '<span class="recap-sub">Win rate ' + row.rate + " · " + row.played +
      ' ronde</span></span><span class="recap-score">' + row.points + "</span></div>"
    ).join("");
    const highlights = data.highlights.map(row =>
      '<div class="recap-row"><span class="recap-medal">' + row.icon + '</span><span class="recap-name">' +
      escapeHtml(row.name) + '<span class="recap-sub">' + row.label + '</span></span><span class="recap-value">' +
      escapeHtml(row.value) + "</span></div>"
    ).join("");
    return '<div class="recap-top"><div class="recap-kicker">Rekap sesi domino</div>' +
      '<h2 class="recap-title" id="recapTitle">' + escapeHtml(data.title) + '</h2>' +
      '<div class="recap-date">' + escapeHtml(data.date) + "</div></div>" +
      '<div class="recap-body"><div class="recap-stats">' + stat(data.rounds, "Ronde") +
      stat(data.matches, "Match") + stat(data.duration, "Durasi") + "</div>" +
      '<div><h3 class="recap-section-title">Podium</h3>' + podium + "</div>" +
      (highlights ? '<div><h3 class="recap-section-title">Sorotan</h3>' + highlights + "</div>" : "") +
      '</div><div class="recap-foot">Domino Match Manager</div>';
  }

  function drawRecapCanvas(data) {
    // Format story Instagram: 1080 x 1920 (9:16). Konten ditengahkan secara vertikal.
    const W = 1080, H = 1920, CX = 60, CW = W - CX * 2, PAD = 56, ROW = 118, HROW = 92, DIV = 470;
    const rows = data.podium.length, hl = data.highlights.length;
    const innerX = CX + PAD, innerW = CW - PAD * 2;
    const ink = "#16201a", muted = "#566057", ivory = "#f3f1e7", soft = "#cbc7b3", red = "#c4351f", brass = "#c8941f";
    const font = '"Schibsted Grotesk", "Helvetica Neue", Arial, sans-serif';
    const bottomH = 50 + 84 + rows * ROW + (hl ? 40 + 84 + hl * HROW : 0) + 30 + 96;
    const CH = DIV + bottomH, CY = Math.round((H - CH) / 2);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const c = canvas.getContext("2d");
    const write = (str, x, y, weight, size, color, align) => {
      c.font = weight + " " + size + "px " + font; c.fillStyle = color; c.textAlign = align || "left"; c.textBaseline = "alphabetic";
      c.fillText(str, x, y);
    };
    const fit = (str, weight, size, maxWidth) => {
      c.font = weight + " " + size + "px " + font;
      if (c.measureText(str).width <= maxWidth) return str;
      let out = str;
      while (out.length > 1 && c.measureText(out + "…").width > maxWidth) out = out.slice(0, -1);
      return out + "…";
    };
    const sizeFor = (str, weight, size, min, maxWidth) => {
      while (size > min) { c.font = weight + " " + size + "px " + font; if (c.measureText(str).width <= maxWidth) break; size -= 2; }
      return size;
    };
    const tile = (x, y, w, h, r) => {
      c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
    };
    const dot = (x, y, r, color) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = color; c.fill(); };
    const line = (x1, y1, x2, y2, color, width) => {
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineWidth = width; c.strokeStyle = color; c.stroke();
    };

    // Latar: meja felt (60%)
    c.fillStyle = "#17503a"; c.fillRect(0, 0, W, H);
    const glow = c.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * 0.7);
    glow.addColorStop(0, "rgba(255,255,255,.10)"); glow.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = glow; c.fillRect(0, 0, W, H);
    c.fillStyle = "rgba(255,255,255,.04)";
    for (let gy = 0; gy < H; gy += 6) for (let gx = 0; gx < W; gx += 6) c.fillRect(gx, gy, 2, 2);

    // Ubin gading (30%)
    tile(CX, CY + 18, CW, CH, 56); c.fillStyle = "rgba(0,0,0,.28)"; c.fill();
    tile(CX, CY, CW, CH, 56); c.fillStyle = ivory; c.fill();
    tile(CX + 4, CY + 4, CW - 8, CH - 8, 52); c.lineWidth = 8; c.strokeStyle = ink; c.stroke();

    // Bagian atas: judul dan angka sesi
    write("Rekap sesi domino", innerX, CY + 96, 600, 30, muted);
    const titleSize = sizeFor(data.title, 700, 84, 48, innerW);
    write(fit(data.title, 700, titleSize, innerW), innerX, CY + 188, 700, titleSize, ink);
    write(data.date, innerX, CY + 246, 500, 32, muted);
    const colW = innerW / 3;
    [[String(data.rounds), "Ronde"], [String(data.matches), "Match"], [data.duration, "Durasi"]].forEach((item, index) => {
      const x = innerX + index * colW;
      if (index) line(x, CY + 296, x, CY + 416, soft, 4);
      const numSize = sizeFor(item[0], 700, 76, 40, colW - 28);
      write(fit(item[0], 700, numSize, colW - 28), x + colW / 2, CY + 372, 700, numSize, ink, "center");
      write(item[1], x + colW / 2, CY + 414, 500, 28, muted, "center");
    });

    // Garis pembagi domino + pin
    line(innerX - 8, CY + DIV, innerX + innerW + 8, CY + DIV, ink, 6);
    dot(W / 2, CY + DIV, 22, brass); c.beginPath(); c.arc(W / 2, CY + DIV, 22, 0, Math.PI * 2); c.lineWidth = 6; c.strokeStyle = ink; c.stroke();

    // Bagian bawah: podium
    let y = CY + DIV + 50;
    write("Podium", innerX, y + 44, 700, 44, ink);
    line(innerX, y + 68, innerX + innerW, y + 68, ink, 4);
    y += 84;
    data.podium.forEach((row, index) => {
      const cy2 = y + ROW / 2 - 8;
      dot(innerX + 36, cy2, 34, index === 0 ? red : ink);
      write(String(index + 1), innerX + 36, cy2 + 14, 700, 40, ivory, "center");
      write(fit(row.name, 700, 40, innerW - 270), innerX + 100, y + 52, 700, 40, ink);
      write("Win rate " + row.rate + " · " + row.played + " ronde", innerX + 100, y + 90, 500, 28, muted);
      write(String(row.points), innerX + innerW, y + 72, 700, 60, ink, "right");
      y += ROW;
      line(innerX, y - 8, innerX + innerW, y - 8, soft, 3);
    });

    if (hl) {
      y += 40;
      write("Sorotan", innerX, y + 44, 700, 44, ink);
      line(innerX, y + 68, innerX + innerW, y + 68, ink, 4);
      y += 84;
      data.highlights.forEach(row => {
        dot(innerX + 36, y + HROW / 2 - 6, 10, red);
        write(fit(row.name, 700, 36, innerW - 340), innerX + 100, y + 44, 700, 36, ink);
        write(row.label, innerX + 100, y + 78, 500, 28, muted);
        write(row.value, innerX + innerW, y + 60, 700, 40, ink, "right");
        y += HROW;
      });
    }

    line(innerX, CY + CH - 96, innerX + innerW, CY + CH - 96, soft, 3);
    write("Domino Match Manager", W / 2, CY + CH - 46, 600, 28, muted, "center");
    return canvas;
  }

  async function prepareRecapFile(data) {
    recapFile = null;
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      if (document.fonts && document.fonts.load) {
        try { await Promise.all([700, 600, 500].map(w => document.fonts.load(w + ' 40px "Schibsted Grotesk"'))); } catch (error) { /* pakai font cadangan */ }
      }
      const blob = await new Promise(resolve => drawRecapCanvas(data).toBlob(resolve, "image/png"));
      if (blob && recapOpen && recapData === data) {
        recapFile = new File([blob], "rekap-domino-" + data.fileDate + ".png", { type: "image/png" });
      }
    } catch (error) {
      recapFile = null;
    }
  }

  function openRecap() {
    const data = buildRecap();
    if (!data) {
      toast("Belum ada ronde yang bisa direkap.", "warning");
      return;
    }
    recapPreviousFocus = document.activeElement;
    recapData = data;
    recapOpen = true;
    $("recapCard").innerHTML = recapMarkup(data);
    $("recapLayer").hidden = false;
    $("recapLayer").scrollTop = 0;
    document.body.classList.add("recap-open");
    requestAnimationFrame(() => $("recapShare").focus());
    prepareRecapFile(data);
  }

  function closeRecap() {
    recapOpen = false;
    recapData = null;
    recapFile = null;
    $("recapLayer").hidden = true;
    document.body.classList.remove("recap-open");
    if (recapPreviousFocus && typeof recapPreviousFocus.focus === "function") recapPreviousFocus.focus();
  }

  async function shareRecap() {
    const data = recapData;
    if (!data) return;
    if (!recapFile) await prepareRecapFile(data);
    const file = recapFile;
    if (!file) {
      toast("Gagal membuat gambar rekap.", "error");
      return;
    }
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: data.title });
        return;
      }
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast("Gambar rekap disimpan ke perangkat.");
  }

  function addPlayer(name) {
    name = name.trim();
    if (!name) return;
    if (state.pendingBattle) {
      toast("Selesaikan Battle Arena sebelum mengubah antrean.", "warning");
      return;
    }
    if (state.players.some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      toast("Nama pemain sudah terdaftar.", "error");
      return;
    }
    const newPlayer = {
      id: state.nextId++, name, points: 0, rounds: 0, queueOrder: state.nextQueueOrder++, onBreak: false
    };
    state.players.push(newPlayer);
    if (state.active.length < 4) {
      state.active.push(newPlayer.id);
      if (state.started && state.matchPoints[newPlayer.id] === undefined) {
        state.matchPoints[newPlayer.id] = 0;
      }
    } else {
      state.queue.push(newPlayer.id);
    }
    persist();
    render();
    $("playerName").value = "";
    toast(name + " ditambahkan.");
  }

  function setPlayerBreak(id) {
    if (state.pendingBattle) {
      toast("Selesaikan Battle Arena terlebih dahulu.", "warning");
      return;
    }
    const current = player(id);
    if (!current || current.onBreak) return;

    if (state.active.includes(id)) {
      const replacementId = shiftNextReadyFromQueue();
      if (replacementId == null && state.started) {
        toast("Tidak ada pemain siap di antrean untuk menggantikan " + current.name + ".", "warning");
        return;
      }
      const activeIdx = state.active.indexOf(id);
      if (replacementId != null) {
        state.active.splice(activeIdx, 1, replacementId);
        if (state.matchPoints[replacementId] === undefined) {
          state.matchPoints[replacementId] = 0;
        }
      } else {
        state.active.splice(activeIdx, 1);
      }
      current.onBreak = true;
      state.queue = state.queue.filter(qId => qId !== id);
      persist();
      render();
      if (replacementId != null) {
        const rep = player(replacementId);
        toast(current.name + " istirahat (Break). Digantikan oleh " + (rep ? rep.name : "pemain antrean") + ".", "info");
      } else {
        toast(current.name + " istirahat (Break).", "info");
      }
      return;
    }

    current.onBreak = true;
    state.queue = state.queue.filter(qId => qId !== id);
    persist();
    render();
    toast(current.name + " istirahat (Break). Poin tetap tersimpan.", "info");
  }

  function resumePlayerFromBreak(id) {
    if (state.pendingBattle) {
      toast("Selesaikan Battle Arena terlebih dahulu.", "warning");
      return;
    }
    const current = player(id);
    if (!current || !current.onBreak) return;
    current.onBreak = false;

    if (state.active.length < 4) {
      state.active.push(id);
      if (state.started && state.matchPoints[id] === undefined) {
        state.matchPoints[id] = 0;
      }
      persist();
      render();
      toast(current.name + " kembali bermain dan langsung masuk ke meja.", "success");
    } else {
      if (!state.queue.includes(id)) state.queue.push(id);
      persist();
      render();
      toast(current.name + " aktif kembali dan masuk antrean.", "success");
    }
  }

  function startSession() {
    const availableCount = state.players.filter(p => !p.onBreak).length;
    if (availableCount < 4) {
      toast("Perlu minimal 4 pemain siap (tidak sedang break) untuk memulai.", "warning");
      return;
    }
    while (state.active.length < 4) {
      const nextId = shiftNextReadyFromQueue();
      if (nextId == null) break;
      state.active.push(nextId);
    }
    if (state.active.length !== 4) {
      toast("Meja perlu tepat 4 pemain aktif untuk memulai.", "warning");
      return;
    }
    state.started = true;
    state.sessionName = $("sessionName").value.trim();
    startStopwatch();
    persist();
    render();
    toast("Sesi dimulai & waktu berjalan.", "info");
  }

  function readChoices() {
    return [...document.querySelectorAll(".rank-choice")];
  }

  function choicesAreComplete() {
    const selects = readChoices();
    if (selects.length !== 4 || selects.some(select => !select.value)) return false;
    const ranks = selects.map(select => Number(select.value.split(":")[0]));
    return new Set(ranks).size === 4 && [1, 2, 3, 4].every(rank => ranks.includes(rank));
  }

  function updateChoiceOptions() {
    const selects = readChoices();
    const selectedRanks = selects.filter(select => select.value)
      .map(select => Number(select.value.split(":")[0]));
    selects.forEach(select => {
      const ownRank = select.value ? Number(select.value.split(":")[0]) : null;
      [...select.options].forEach(option => {
        if (!option.value) return;
        const rank = Number(option.value.split(":")[0]);
        option.disabled = rank !== ownRank && selectedRanks.includes(rank);
      });
    });
    $("submitResult").disabled = !state.started || !choicesAreComplete();
  }

  function renderPlayers() {
    const options = POINT_OPTIONS.map(option =>
      '<option value="' + option.value + '">' + option.label + "</option>"
    ).join("");
    const hasReadyReplacement = readyQueueIds().length > 0;
    const statsMap = computePlayerStats();
    $("activePlayers").innerHTML = state.active.map((id, index) => {
      const currentPlayer = player(id);
      if (!currentPlayer) return "";
      const matchPts = state.matchPoints[id] || 0;
      const canBreakNow = !state.pendingBattle && (!state.started || hasReadyReplacement);
      const breakTitle = state.started && !hasReadyReplacement
        ? "Perlu minimal 1 pemain menunggu di antrean untuk menggantikan"
        : "Istirahat & ganti dengan pemain antrean";
      return '<article class="player">' +
        '<div class="player-top"><div class="avatar">' +
        escapeHtml(currentPlayer.name.slice(0, 1).toUpperCase()) +
        '</div><div class="player-heading"><div class="player-name">' +
        escapeHtml(currentPlayer.name) + '</div><div class="player-sub">Pemain meja · ' +
        (index + 1) + (state.matchRoundCount > 0 ? " · Poin match: " + matchPts : "") + '</div></div>' +
        '<button type="button" class="break-btn" data-break-active="' + id + '" title="' + breakTitle + '"' +
        (canBreakNow ? "" : " disabled") + '>Break</button></div>' +
        '<div class="player-score"><div><div class="score">' + currentPlayer.points +
        '</div><div class="pts">POIN KESELURUHAN</div></div><div class="player-meta"><div class="player-sub">' +
        currentPlayer.rounds + ' ronde</div>' + streakChip(statsMap.get(id)) + '</div></div>' +
        '<label class="choice-label" for="choice-' + id + '">Hasil ronde ini</label>' +
        '<select class="rank-choice" id="choice-' + id + '" data-player-id="' + id + '"' +
        (state.started && !state.pendingBattle ? "" : " disabled") +
        '><option value="">Pilih juara dan poin…</option>' + options + "</select></article>";
    }).join("");
  }

  function renderStandings() {
    const currentMatch = state.matchRoundCount > 0;
    const matchSource = currentMatch
      ? { number: state.matchNumber, points: state.matchPoints, players: state.active }
      : state.lastMatch;
    $("matchStandingsLabel").textContent = matchSource
      ? "Match " + matchSource.number + (currentMatch ? " · ronde " + state.matchRoundCount + "/2" : " · terakhir")
      : "Match berjalan";

    document.querySelectorAll("[data-standings]").forEach(button => {
      const selected = button.dataset.standings === activeStandings;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", String(selected));
    });

    if (activeStandings === "match") {
      $("leaderHead").innerHTML = "<tr><th>#</th><th>Nama pemain</th><th>Poin match</th></tr>";
      const matchPlayers = matchSource ? (matchSource.players || []).map(id => player(id)).filter(Boolean) : [];
      const tieTotals = new Map((matchSource?.tieBreakCards || []).map(card => [card.id, card.total]));
      matchPlayers.sort((a, b) =>
        (matchSource.points[b.id] || 0) - (matchSource.points[a.id] || 0) ||
        (tieTotals.get(b.id) || 0) - (tieTotals.get(a.id) || 0) ||
        a.name.localeCompare(b.name)
      );
      $("leaderboard").innerHTML = matchPlayers.map((item, index) =>
        '<tr><td><span class="rank-number ' + (index === 0 ? "winner" : "") + '">' +
        (index + 1) + '</span></td><td><strong>' + escapeHtml(item.name) +
        '</strong></td><td><strong>' + (matchSource.points[item.id] || 0) +
        "</strong></td></tr>"
      ).join("");
      $("leaderEmpty").textContent = "Klasemen match muncul setelah ronde pertama.";
      $("leaderEmpty").style.display = matchPlayers.length ? "none" : "block";
    } else {
      $("leaderHead").innerHTML = "<tr><th>#</th><th>Nama pemain</th><th class=\"col-mid\">Ronde</th><th class=\"col-mid\">Win rate</th><th>Poin</th></tr>";
      const overallPlayers = [...state.players].sort((a, b) =>
        b.points - a.points || a.name.localeCompare(b.name)
      );
      const statsMap = computePlayerStats();
      const badgeContext = {
        topPoints: Math.max(0, ...overallPlayers.map(item => item.points)),
        maxWins: Math.max(0, ...[...statsMap.values()].map(entry => entry.wins))
      };
      $("leaderboard").innerHTML = overallPlayers.map((item, index) =>
        '<tr><td><span class="rank-number ' + (index === 0 ? "winner" : "") + '">' +
        (index + 1) + '</span></td><td><div class="name-line"><strong>' + escapeHtml(item.name) + "</strong>" +
        streakChip(statsMap.get(item.id)) +
        (state.active.includes(item.id)
          ? ' <span class="active-tag">Aktif</span>'
          : item.onBreak
          ? ' <span class="break-tag">Break</span>'
          : "") +
        "</div>" + badgeMarkup(badgesFor(item, statsMap.get(item.id), badgeContext)) +
        '</td><td class="col-mid">' + item.rounds + '</td><td class="col-mid"><strong>' +
        winRateText(statsMap.get(item.id)) + '</strong></td><td><strong>' + item.points + "</strong></td></tr>"
      ).join("");
      $("leaderEmpty").textContent = "Klasemen muncul setelah pemain ditambahkan.";
      $("leaderEmpty").style.display = state.players.length ? "none" : "block";
    }
  }

  function renderHistory() {
    $("historyEmpty").style.display = state.rounds.length ? "none" : "block";
    $("history").innerHTML = [...state.rounds].reverse().map(round =>
      '<article class="history-item"><div class="history-top"><span>Match ' +
      (round.matchNumber || "—") + " · Ronde " + (round.matchRound || "—") +
      '/2</span><span class="muted history-time">' + escapeHtml(round.time) +
      '</span></div><div class="history-detail">' +
      round.results.map(result =>
        result.rank + ". " + escapeHtml(result.name) + " (" +
        (result.points > 0 ? "+" : "") + result.points + ")"
      ).join(" · ") + "</div>" +
      (round.rotations && round.rotations.length
        ? '<div class="history-detail rotation-detail">Pergantian: ' +
          round.rotations.map(change =>
            escapeHtml(change.outName) + " keluar, " + escapeHtml(change.inName) + " masuk"
          ).join(" · ") + "</div>" : "") +
      (round.tieBreakCards && round.tieBreakCards.length
        ? '<div class="history-detail rotation-detail">Battle Arena: ' +
          round.tieBreakCards.map(card => escapeHtml(card.name) + " " + card.left + "|" + card.right +
            " (" + (card.total > 0 ? "+" : "") + card.total + ")").join(" · ") +
          (round.tieBreakExtra ? " · Kartu cadangan " + round.tieBreakExtra.left + "|" + round.tieBreakExtra.right : "") +
          "</div>" : "") +
      "</article>"
    ).join("");
    $("undoBtn").disabled = state.rounds.length === 0;
  }

  function pipMarkup(value) {
    const pips = Array.from({ length: value }, () => "<i></i>").join("");
    return '<div class="pips" data-value="' + value + '">' + pips + "</div>";
  }

  function dominoTileMarkup(card, compact) {
    return '<div class="arena-domino' + (compact ? " compact" : "") + '"><div class="arena-half">' +
      pipMarkup(card.left) + '</div><div class="arena-domino-divider"></div><div class="arena-half">' +
      pipMarkup(card.right) + "</div></div>";
  }

  function battleCardMarkup(card, outgoingIds, winnerIds) {
    const isOut = outgoingIds.includes(card.id);
    const isWinner = winnerIds.includes(card.id);
    const status = isOut ? "KELUAR" : isWinner ? "JUARA SERI" : "BERTAHAN";
    const style = isOut ? "card-out" : isWinner ? "card-winner" : "card-stays";
    return '<article class="domino-card ' + style + '"><div class="domino-card-top"><span>' +
      escapeHtml(card.name) + '</span><b>' + status + "</b></div>" + dominoTileMarkup(card, false) +
      '<div class="domino-card-foot"><span>Poin match ' + card.points +
      '</span><strong>Nilai ' + card.total + "</strong></div></article>";
  }

  function renderBattle() {
    const pending = state.pendingBattle;
    const last = state.lastBattle;
    $("battleArena").hidden = !pending && !last;
    if (!pending && !last) return;

    if (pending) {
      const tiedCards = pending.groups.flatMap(group => group.ids.map(id => ({
        id, name: player(id)?.name || "Pemain", points: pending.points[id]
      })));
      const poolSize = tiedCards.length + 1;
      $("battleBadge").textContent = "SERI · " + tiedCards.length + " PEMAIN";
      $("battleMessage").textContent = "Poin match seri. Masuk ke arena untuk memilih satu kartu secara blind dari " +
        poolSize + " kartu domino.";
      $("battleCards").innerHTML = tiedCards.map(card =>
        '<div class="battle-preview-player"><span class="battle-preview-avatar">' +
        escapeHtml(card.name.slice(0, 1).toUpperCase()) + '</span><span>' + escapeHtml(card.name) +
        '</span><strong>' + card.points + " poin</strong></div>"
      ).join("");
      $("openArenaBtn").textContent = pending.arena
        ? "Lanjutkan Battle Arena · " + poolSize + " kartu"
        : "Masuk Battle Arena · " + poolSize + " kartu";
      $("openArenaBtn").hidden = false;
      if (arenaOpen) renderArena();
      return;
    }

    $("battleBadge").textContent = "MATCH " + last.number + " · SELESAI";
    $("battleMessage").textContent = last.outgoingIds.length
      ? "Tie-break selesai. Kartu tertinggi menang; pemain yang keluar masuk ke antrean."
      : "Tie-break selesai. Nilai kartu menentukan urutan juara pada klasemen match.";
    $("battleCards").innerHTML = last.cards.map(card =>
      battleCardMarkup(card, last.outgoingIds, last.winnerIds || [])
    ).join("");
    $("openArenaBtn").hidden = true;
  }

  function shuffle(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function randomInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function finishMatch(round, participants, points, outgoingIds, tieBreakCards) {
    const cards = tieBreakCards || [];
    round.rotations = [];
    round.tieBreakCards = cards;
    outgoingIds.forEach(outgoingId => {
      const replacementId = shiftNextReadyFromQueue();
      if (replacementId == null) return;
      const outgoingPlayer = player(outgoingId);
      const incomingPlayer = player(replacementId);
      state.active = state.active.filter(id => id !== outgoingId);
      state.active.push(replacementId);
      state.queue.push(outgoingId);
      round.rotations.push({
        outId: outgoingId, outName: outgoingPlayer.name,
        inId: replacementId, inName: incomingPlayer.name
      });
    });
    state.lastMatch = {
      number: round.matchNumber, players: participants, points: points, tieBreakCards: cards
    };
    state.lastBattle = cards.length ? {
      number: round.matchNumber, cards: cards, outgoingIds: round.rotations.map(item => item.outId)
    } : null;
    state.pendingBattle = null;
    state.matchRoundCount = 0;
    state.matchNumber = round.matchNumber + 1;
    state.matchPoints = {};
  }

  function openBattleArena() {
    const pending = state.pendingBattle;
    if (!pending) return;
    arenaPreviousFocus = document.activeElement;
    if (!pending.arena) {
      const tiedIds = shuffle(pending.groups.flatMap(group => group.ids));
      const totals = shuffle(Array.from({ length: 13 }, (_, total) => total)).slice(0, tiedIds.length + 1);
      const cards = totals.map((total, index) => {
        const left = randomInt(Math.max(0, total - 6), Math.min(6, total));
        const right = total - left;
        const sides = Math.random() < 0.5 ? [left, right] : [right, left];
        return { id: index + 1, left: sides[0], right: sides[1], total };
      });
      pending.arena = { players: tiedIds, cards: shuffle(cards), picks: [], stage: "pick" };
    }
    arenaOpen = true;
    persist();
    renderArena();
  }

  function closeBattleArena() {
    arenaOpen = false;
    $("arenaOverlay").hidden = true;
    document.body.classList.remove("arena-open");
    persist();
    if (arenaPreviousFocus && typeof arenaPreviousFocus.focus === "function") arenaPreviousFocus.focus();
    toast("Pilihan tersimpan. Arena bisa dilanjutkan kapan saja.", "info");
  }

  function renderArena() {
    const pending = state.pendingBattle;
    if (!pending?.arena) return;
    const arena = pending.arena;
    const picksByPlayer = new Map(arena.picks.map(pick => [pick.playerId, pick]));
    const isRevealed = arena.stage === "revealed";
    const currentId = arena.players[arena.picks.length];
    const wasHidden = $("arenaOverlay").hidden;
    $("arenaOverlay").hidden = false;
    document.body.classList.add("arena-open");
    $("arenaMatchLabel").textContent = "Match " + pending.matchNumber + " · Battle Arena";

    if (isRevealed) {
      $("arenaTitle").textContent = "Kartu dibuka";
      $("arenaInstruction").textContent = "Nilai kartu menentukan urutan seri. Kartu tertinggi menang; " +
        (pending.replacementCount ? "poin match terendah bersama kartu menentukan pemain yang keluar." : "urutan ini masuk ke klasemen match.");
    } else if (currentId) {
      $("arenaTitle").textContent = "Giliran memilih kartu";
      $("arenaInstruction").textContent = (player(currentId)?.name || "Pemain") +
        ", pilih satu kartu tertutup. Semua kartu dibuka setelah setiap pemain mengambil satu.";
    } else if (arena.picks.length === arena.players.length) {
      $("arenaTitle").textContent = "Semua kartu sudah dipilih";
      $("arenaInstruction").textContent = "Satu kartu tersisa sebagai kartu cadangan. Saat semua siap, buka kartu untuk menentukan hasil.";
    } else {
      $("arenaTitle").textContent = "Semua kartu sudah dipilih";
      $("arenaInstruction").textContent = "Semua pilihan masih tertutup. Siap untuk penentuan?";
    }

    $("arenaDuelists").innerHTML = arena.players.map((id, index) => {
      const item = player(id);
      const pick = picksByPlayer.get(id);
      const current = id === currentId && !isRevealed;
      let slot = '<div class="arena-mini-back">?</div>';
      if (isRevealed && pick) {
        const card = arena.cards.find(candidate => candidate.id === pick.cardId);
        slot = card ? dominoTileMarkup(card, true) : '<div class="arena-mini-back">?</div>';
      } else if (pick) {
        slot = '<div class="arena-mini-back selected">✓</div>';
      }
      return '<div class="arena-duelist ' + (current ? "duelist-current" : pick ? "duelist-picked" : "") + '">' +
        '<div class="arena-duelist-number">' + String(index + 1).padStart(2, "0") + '</div>' +
        '<div class="arena-duelist-info"><strong>' + escapeHtml(item?.name || "Pemain") +
        '</strong><span>' + pending.points[id] + ' poin match' + (current ? ' · Giliranmu' : "") +
        '</span></div><div class="arena-duelist-slot">' + slot + "</div></div>";
    }).join("");

    const pickedIds = new Set(arena.picks.map(pick => pick.cardId));
    const remaining = arena.cards.filter(card => !pickedIds.has(card.id));
    const reserveOnly = arena.picks.length === arena.players.length;
    $("arenaDeckCount").textContent = remaining.length + " kartu tertutup";
    $("arenaDeck").innerHTML = remaining.map((card, index) =>
      '<button class="arena-pick-card' + (reserveOnly ? " arena-extra-card" : "") + '" type="button" ' +
      (reserveOnly ? "disabled" : 'data-arena-card="' + card.id + '"') +
      ' aria-label="' + (reserveOnly ? "Kartu cadangan" : "Pilih kartu tertutup " + (index + 1)) + '"><span class="arena-card-index">' +
      (reserveOnly ? "Bonus" : String(index + 1).padStart(2, "0")) + '</span><span class="arena-card-back">◆</span>' +
      '<span class="arena-card-prompt">' + (reserveOnly ? "Cadangan" : "Pilih") + "</span></button>"
    ).join("");

    $("arenaDeckWrap").hidden = isRevealed;
    $("arenaReveal").hidden = !isRevealed;
    $("arenaActions").innerHTML = "";
    if (isRevealed) {
      const result = arena.result;
      const outgoing = result.outgoingIds;
      const winners = result.winnerIds;
      $("arenaReveal").innerHTML = '<div class="arena-result-heading"><span>Hasil penentuan</span><strong>' +
        result.cards.length + ' pemain · ' + (result.extraCard ? "1 kartu cadangan" : "") + "</strong></div>" +
        '<div class="arena-result-cards">' + result.cards.map(card => {
          const isOut = outgoing.includes(card.id);
          const isWinner = winners.includes(card.id);
          return '<article class="arena-final-card ' + (isOut ? "final-out" : isWinner ? "final-winner" : "") + '">' +
            '<div class="arena-final-name"><strong>' + escapeHtml(card.name) + '</strong><span>' +
            (isOut ? "Keluar" : isWinner ? "Menang seri" : "Bertahan") + '</span></div>' +
            dominoTileMarkup(card, false) + '<div class="arena-final-score">Poin match <b>' + card.points +
            '</b><span>Jumlah kartu <b>' + card.total + "</b></span></div></article>";
        }).join("") + "</div>" +
        (result.extraCard ? '<div class="arena-extra"><span>Kartu cadangan</span>' + dominoTileMarkup(result.extraCard, true) +
          '<small>Kartu tambahan ini tidak ikut menentukan hasil.</small></div>' : "");
      $("arenaActions").innerHTML = '<button class="primary arena-finish" id="finishArenaBtn" type="button">Selesaikan battle</button>';
    } else if (arena.picks.length === arena.players.length) {
      $("arenaActions").innerHTML = '<button class="primary arena-reveal-button" id="revealArenaBtn" type="button">Buka semua kartu</button>';
    }
    if (wasHidden) requestAnimationFrame(() => $("closeArena").focus());
  }

  let suspenseTimer = null;
  function revealWithSuspense() {
    if (suspenseTimer) return;
    const overlay = $("arenaOverlay");
    const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (calm) { revealArenaCards(); return; }
    const count = document.createElement("div");
    count.className = "arena-countdown";
    count.setAttribute("aria-hidden", "true");
    overlay.querySelector(".arena-window").appendChild(count);
    overlay.classList.add("is-suspense");
    const button = $("revealArenaBtn");
    if (button) button.disabled = true;
    let n = 3;
    const finish = () => {
      clearInterval(suspenseTimer); suspenseTimer = null;
      count.remove(); overlay.classList.remove("is-suspense");
      if (!overlay.hidden) revealArenaCards();
    };
    const tick = () => {
      if (overlay.hidden) { finish(); return; }
      if (n === 0) { finish(); return; }
      count.textContent = n; count.style.animation = "none"; void count.offsetWidth; count.style.animation = "";
      n -= 1;
    };
    tick();
    suspenseTimer = setInterval(tick, 750);
  }

  function revealArenaCards() {
    const pending = state.pendingBattle;
    const arena = pending?.arena;
    if (!arena || arena.picks.length !== arena.players.length) return;
    const cards = arena.picks.map(pick => {
      const card = arena.cards.find(candidate => candidate.id === pick.cardId);
      const group = pending.groups.find(candidate => candidate.ids.includes(pick.playerId));
      return {
        id: pick.playerId, name: player(pick.playerId)?.name || "Pemain",
        points: pending.points[pick.playerId], tiedScore: group?.score,
        left: card.left, right: card.right, total: card.total
      };
    });
    const cardTotals = new Map(cards.map(card => [card.id, card.total]));
    const winnerIds = pending.groups.map(group => [...group.ids].sort((a, b) =>
      cardTotals.get(b) - cardTotals.get(a)
    )[0]);
    const ranked = [...pending.participants].sort((a, b) =>
      (pending.points[b] || 0) - (pending.points[a] || 0) ||
      (cardTotals.get(b) || 0) - (cardTotals.get(a) || 0)
    );
    const outgoingIds = ranked.slice(ranked.length - pending.replacementCount);
    const usedCardIds = new Set(arena.picks.map(pick => pick.cardId));
    arena.result = {
      cards, winnerIds, outgoingIds,
      extraCard: arena.cards.find(card => !usedCardIds.has(card.id)) || null
    };
    arena.stage = "revealed";
    persist();
    renderArena();
  }

  function completeBattleArena() {
    const pending = state.pendingBattle;
    const arena = pending?.arena;
    if (!arena || arena.stage !== "revealed" || !arena.result) return;
    const round = state.rounds[state.rounds.length - 1];
    finishMatch(round, pending.participants, pending.points, arena.result.outgoingIds, arena.result.cards);
    state.lastBattle.winnerIds = arena.result.winnerIds;
    state.lastBattle.extraCard = arena.result.extraCard;
    round.tieBreakExtra = arena.result.extraCard;
    arenaOpen = false;
    $("arenaOverlay").hidden = true;
    document.body.classList.remove("arena-open");
    persist();
    render();
    $("matchStandingsLabel").setAttribute("tabindex", "-1");
    $("matchStandingsLabel").focus();
    arenaPreviousFocus = null;
    toast("Battle Arena selesai. Hasil tie-break Match " + pending.matchNumber + " disimpan.");
  }

  function render() {
    $("sessionName").value = state.sessionName || "";
    $("statPlayers").textContent = state.players.length;
    $("statRounds").textContent = state.rounds.length;
    $("statActive").textContent = state.active.length + "/4";
    $("tablePill").textContent = "Meja 1 · " + state.active.length + "/4 pemain";
    const readyQueue = readyQueueIds();
    const breakPlayers = state.players.filter(p => p.onBreak);
    $("queuePill").textContent = readyQueue.length + " menunggu";
    $("statusBadge").textContent = state.started ? "Sesi berjalan" : "Siap dimulai";
    $("roundInstructions").textContent = state.pendingBattle
      ? "Match " + state.pendingBattle.matchNumber + " selesai. Selesaikan tie-break di Battle Arena untuk melihat klasemen dan pergantian pemain."
      : state.started
      ? "Match " + (state.matchNumber || 1) + " · ronde " + Math.min(state.matchRoundCount + 1, 2) + "/2. " +
        (state.matchRoundCount === 1 ? "Empat pemain di meja menyelesaikan match ini." : "Pilih satu juara untuk setiap pemain.")
      : "Pilih peringkat di setiap kartu pemain. Setiap ronde harus memiliki juara 1 sampai 4 masing-masing satu.";
    $("activeEmpty").style.display = state.active.length ? "none" : "block";
    $("queueEmpty").style.display = readyQueue.length ? "none" : "block";
    $("queueList").innerHTML = readyQueue.map((id, index) => {
      const item = player(id);
      if (!item) return "";
      return '<div class="queue-item"><div class="queue-no">' + (index + 1) +
        '</div><div class="queue-name">' + escapeHtml(item.name) +
        '<span class="queue-sub">' + item.points + ' poin · ' + item.rounds + ' ronde</span></div>' +
        '<button type="button" class="break-btn" data-break-queue="' + id +
        '" title="Istirahat sementara"' + (state.pendingBattle ? " disabled" : "") + '>Break</button>' +
        '<button type="button" class="small-btn subtle" data-remove="' + id +
        '" title="Hapus dari sesi"' + (state.pendingBattle ? " disabled" : "") + '>×</button></div>';
    }).join("");

    $("breakSection").hidden = breakPlayers.length === 0;
    $("breakPill").textContent = breakPlayers.length + " break";
    $("breakList").innerHTML = breakPlayers.map(item =>
      '<div class="queue-item is-break"><div class="queue-no">B</div>' +
      '<div class="queue-name">' + escapeHtml(item.name) +
      '<span class="queue-sub">Poin tersimpan: ' + item.points + ' poin (' + item.rounds + ' ronde)</span></div>' +
      '<button type="button" class="resume-btn" data-resume="' + item.id + '"' +
      (state.pendingBattle ? " disabled" : "") + '>Main lagi</button>' +
      '<button type="button" class="small-btn subtle" data-remove="' + item.id +
      '" title="Hapus dari sesi"' + (state.pendingBattle ? " disabled" : "") + '>×</button></div>'
    ).join("");

    renderPlayers();
    $("recapBtn").disabled = state.rounds.length === 0;
    $("startBtn").disabled = state.started;
    $("startBtn").textContent = state.started ? "Sesi berjalan" : "Mulai sesi";
    $("submitResult").disabled = !state.started || Boolean(state.pendingBattle) || !choicesAreComplete();
    renderStandings();
    renderHistory();
    renderBattle();
    renderTimerDisplay();
  }

  $("timerToggleBtn").addEventListener("click", toggleStopwatch);
  $("timerRestartBtn").addEventListener("click", () => {
    restartStopwatch(Boolean(state.timer?.running));
    toast("Waktu di-restart ke 00:00.", "info");
  });

  $("addPlayerForm").addEventListener("submit", event => {
    event.preventDefault();
    const name = $("playerName").value.trim();
    if (!name) {
      toast("Masukkan nama pemain terlebih dahulu.", "warning");
      $("playerName").focus();
      return;
    }
    addPlayer(name);
  });
  $("startBtn").addEventListener("click", startSession);
  $("openArenaBtn").addEventListener("click", openBattleArena);
  $("closeArena").addEventListener("click", closeBattleArena);
  $("arenaDeck").addEventListener("click", event => {
    const button = event.target.closest("[data-arena-card]");
    const pending = state.pendingBattle;
    const arena = pending?.arena;
    if (!button || !arena || arena.stage !== "pick") return;
    const playerId = arena.players[arena.picks.length];
    if (playerId == null) return;
    const cardId = Number(button.dataset.arenaCard);
    if (arena.picks.some(pick => pick.cardId === cardId)) return;
    arena.picks.push({ playerId, cardId });
    persist();
    renderArena();
    const nextFocus = arena.picks.length === arena.players.length
      ? $("revealArenaBtn") : $("arenaDeck").querySelector("[data-arena-card]");
    if (nextFocus) nextFocus.focus();
    if (arena.picks.length === arena.players.length) {
      toast("Semua pilihan terkunci. Siap buka kartu?", "info");
    }
  });
  $("arenaActions").addEventListener("click", event => {
    if (event.target.closest("#revealArenaBtn")) revealWithSuspense();
    if (event.target.closest("#finishArenaBtn")) completeBattleArena();
  });
  document.addEventListener("keydown", event => {
    if (!arenaOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeBattleArena();
    } else if (event.key === "Tab") {
      const focusable = [...$("arenaOverlay").querySelectorAll("button:not([disabled])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  $("themeToggle").addEventListener("click", () => {
    theme = theme === "light" ? "dark" : "light";
    applyTheme();
    try { localStorage.setItem(THEME_KEY, theme); } catch (error) {}
  });
  $("sessionName").addEventListener("change", () => {
    state.sessionName = $("sessionName").value.trim();
    persist();
  });
  $("activePlayers").addEventListener("change", updateChoiceOptions);
  $("activePlayers").addEventListener("click", event => {
    const breakBtn = event.target.closest("[data-break-active]");
    if (!breakBtn) return;
    const id = Number(breakBtn.dataset.breakActive);
    setPlayerBreak(id);
  });
  $("resetRanks").addEventListener("click", () => {
    readChoices().forEach(select => { select.value = ""; });
    updateChoiceOptions();
  });
  document.querySelectorAll("[data-standings]").forEach(button => {
    button.addEventListener("click", () => {
      activeStandings = button.dataset.standings;
      renderStandings();
    });
  });

  $("resultForm").addEventListener("submit", event => {
    event.preventDefault();
    if (!state.started || state.active.length !== 4 || state.pendingBattle) {
      toast("Mulai sesi dengan empat pemain aktif terlebih dahulu.", "warning");
      return;
    }

    const selections = readChoices().map(select => {
      const parts = select.value.split(":").map(Number);
      const id = Number(select.dataset.playerId);
      return { id, rank: parts[0], points: parts[1], name: player(id).name };
    });
    const ranks = selections.map(result => result.rank);
    if (selections.length !== 4 || selections.some(result => !result.rank) ||
        new Set(ranks).size !== 4 || ![1, 2, 3, 4].every(rank => ranks.includes(rank))) {
      toast("Pilih juara 1, 2, 3, dan 4 masing-masing satu kali.", "warning");
      return;
    }

    saveUndo(JSON.stringify(state));
    if (state.matchRoundCount === 0) state.lastBattle = null;
    selections.forEach(result => {
      const currentPlayer = player(result.id);
      currentPlayer.points += result.points;
      currentPlayer.rounds += 1;
    });
    selections.sort((a, b) => a.rank - b.rank);
    state.matchRoundCount += 1;
    selections.forEach(result => {
      state.matchPoints[result.id] = (state.matchPoints[result.id] || 0) + result.points;
    });

    const round = {
      number: state.rounds.length + 1,
      time: new Date().toLocaleString("id-ID"),
      results: selections.map(({ rank, points, name, id }) => ({ rank, points, name, id })),
      matchNumber: state.matchNumber,
      matchRound: state.matchRoundCount,
      rotations: []
    };

    if (state.matchRoundCount === 2) {
      const matchParticipants = [...state.active];
      const readyWaitingCount = readyQueueIds().length;
      const activeNonBreakPlayers = state.players.filter(p => !p.onBreak).length;
      const replacementCount = Math.min(readyWaitingCount, Math.max(0, activeNonBreakPlayers - 4));
      const matchPoints = {};
      matchParticipants.forEach(id => {
        matchPoints[id] = state.matchPoints[id] || 0;
      });
      const scoreGroups = new Map();
      matchParticipants.forEach(id => {
        const score = matchPoints[id] || 0;
        if (!scoreGroups.has(score)) scoreGroups.set(score, []);
        scoreGroups.get(score).push(id);
      });
      const tiedGroups = [...scoreGroups.entries()]
        .filter(([, ids]) => ids.length > 1)
        .map(([score, ids]) => ({ score, ids }));

      if (tiedGroups.length) {
        state.pendingBattle = {
          matchNumber: round.matchNumber,
          participants: matchParticipants,
          points: matchPoints,
          replacementCount,
          groups: tiedGroups
        };
      } else {
        const outgoing = [...matchParticipants].sort((a, b) =>
          (matchPoints[a] ?? 0) - (matchPoints[b] ?? 0) ||
          (player(a)?.name || "").localeCompare(player(b)?.name || "")
        ).slice(0, replacementCount);
        finishMatch(round, matchParticipants, matchPoints, outgoing, []);
      }
    }

    state.rounds.push(round);
    persist();
    render();
    if (state.pendingBattle) {
      $("battleArena").scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const streakNote = streakAnnouncement(round);
    toast((round.matchRound === 1
      ? "Ronde pertama Match " + round.matchNumber + " tersimpan. Empat pemain di meja lanjut ronde kedua."
      : state.pendingBattle
        ? "Poin seri setelah dua ronde. Buka Battle Arena dan acak kartu domino untuk menentukan juara."
      : round.rotations.length
        ? "Match " + round.matchNumber + " selesai. " + round.rotations.length + " pemain dengan poin terendah diganti."
        : "Match " + round.matchNumber + " selesai. Antrean siap kosong, belum ada pemain yang diganti.") + streakNote,
      round.matchRound === 1 ? "info" : state.pendingBattle ? "warning" : "success");
  });

  async function handleQueueOrBreakActions(event) {
    const breakBtn = event.target.closest("[data-break-queue]");
    if (breakBtn) {
      setPlayerBreak(Number(breakBtn.dataset.breakQueue));
      return;
    }
    const resumeBtn = event.target.closest("[data-resume]");
    if (resumeBtn) {
      resumePlayerFromBreak(Number(resumeBtn.dataset.resume));
      return;
    }
    const removeBtn = event.target.closest("[data-remove]");
    if (!removeBtn) return;
    const id = Number(removeBtn.dataset.remove);
    const item = player(id);
    if (!item) return;
    if (state.pendingBattle) {
      toast("Selesaikan Battle Arena sebelum mengubah antrean.", "warning");
      return;
    }
    const accepted = await confirmDialog({
      kicker: "Hapus pemain",
      title: "Keluarkan " + item.name + "?",
      message: "Pemain ini akan dihapus dari antrean dan sesi. Total poinnya juga akan terhapus.",
      confirmText: "Hapus pemain",
      tone: "danger"
    });
    if (!accepted) return;
    state.queue = state.queue.filter(queueId => queueId !== id);
    state.players = state.players.filter(current => current.id !== id);
    persist();
    render();
    toast("Pemain dihapus.");
  }

  $("queueList").addEventListener("click", handleQueueOrBreakActions);
  $("breakList").addEventListener("click", handleQueueOrBreakActions);

  $("undoBtn").addEventListener("click", async () => {
    if (!state.rounds.length) return;
    const accepted = await confirmDialog({
      kicker: "Batalkan hasil",
      title: "Batalkan ronde terakhir?",
      message: "Poin, klasemen, dan posisi pemain akan dikembalikan ke kondisi sebelum ronde ini.",
      confirmText: "Batalkan ronde",
      tone: "warning"
    });
    if (!accepted) return;
    const snapshot = undoSnapshot ? JSON.parse(undoSnapshot) : null;
    if (snapshot && snapshot.rounds.length === state.rounds.length - 1) {
      const currentTimer = state.timer;
      state = snapshot;
      state.timer = currentTimer;
      saveUndo(null);
      arenaOpen = false;
      $("arenaOverlay").hidden = true;
      document.body.classList.remove("arena-open");
      persist();
      syncTimerLoop();
      render();
      toast("Ronde terakhir dibatalkan.");
    } else {
      saveUndo(null);
      toast("Data pembatalan untuk ronde ini tidak tersedia. Ekspor cadangan sebelum perubahan besar.", "warning");
    }
  });

  $("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ ...state, exportedAt: Date.now() }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "domino-match-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    anchor.click();
    URL.revokeObjectURL(url);
    toast("Cadangan JSON diekspor.");
  });

  $("recapBtn").addEventListener("click", openRecap);
  $("recapClose").addEventListener("click", closeRecap);
  $("recapShare").addEventListener("click", shareRecap);
  $("recapLayer").addEventListener("click", event => {
    if (event.target === $("recapLayer")) closeRecap();
  });
  document.addEventListener("keydown", event => {
    if (!recapOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeRecap();
    } else if (event.key === "Tab") {
      const focusable = [$("recapShare"), $("recapClose")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", async event => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (error) {
      toast("File bukan JSON yang valid.", "error");
      return;
    }
    const imported = importState(parsed);
    if (!imported) {
      toast("Format cadangan tidak dikenali. Pakai file hasil Ekspor JSON.", "error");
      return;
    }
    const accepted = await confirmDialog({
      kicker: "Impor cadangan",
      title: "Timpa data saat ini?",
      message: "Data di browser ini akan diganti dengan cadangan berisi " + imported.players.length +
        " pemain dan " + imported.rounds.length + " ronde. Timer akan dijeda. Tindakan ini tidak dapat dibatalkan.",
      confirmText: "Impor cadangan",
      tone: "warning"
    });
    if (!accepted) return;
    state = imported;
    saveUndo(null);
    arenaOpen = false;
    $("arenaOverlay").hidden = true;
    document.body.classList.remove("arena-open");
    persist();
    syncTimerLoop();
    render();
    toast("Cadangan diimpor: " + imported.players.length + " pemain, " + imported.rounds.length + " ronde.");
  });

  $("clearBtn").addEventListener("click", async () => {
    const accepted = await confirmDialog({
      kicker: "Reset sesi",
      title: "Hapus semua data?",
      message: "Semua pemain, poin, antrean, waktu, dan riwayat Domino Match di browser ini akan dihapus. Tindakan ini tidak dapat dibatalkan.",
      confirmText: "Reset semua data",
      tone: "danger"
    });
    if (!accepted) return;
    state = fresh();
    saveUndo(null);
    persist();
    syncTimerLoop();
    render();
    toast("Semua data sesi direset.");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncWakeLock();
  });

  applyTheme();
  syncTimerLoop();
  renderBadgeGuide();
  render();
})();
