(() => {
  "use strict";

  const KEY = "domino-match-manager-v1";
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
  let undoSnapshot = null;
  let activeStandings = "match";
  let arenaOpen = Boolean(state.pendingBattle?.arena);
  let arenaPreviousFocus = null;
  let toastTimer = null;

  function fresh() {
    return {
      sessionName: "", started: false, players: [], active: [], queue: [], rounds: [],
      nextId: 1, nextQueueOrder: 1, matchRoundCount: 0, matchNumber: 1,
      matchPoints: {}, lastMatch: null, pendingBattle: null, lastBattle: null
    };
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved && Array.isArray(saved.players) && Array.isArray(saved.active) &&
          Array.isArray(saved.queue) && Array.isArray(saved.rounds)) {
        return {
          ...fresh(), ...saved, matchPoints: saved.matchPoints || {},
          matchNumber: saved.matchNumber || 1, matchRoundCount: saved.matchRoundCount || 0,
          pendingBattle: saved.pendingBattle || null, lastBattle: saved.lastBattle || null
        };
      }
    } catch (error) {}
    return fresh();
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (error) {}
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
    const dialog = $("confirmDialog");
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
    if (themeColor) themeColor.content = isDark ? "#111713" : "#f4f6f3";
  }

  function player(id) {
    return state.players.find(item => item.id === id);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    })[character]);
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
      id: state.nextId++, name, points: 0, rounds: 0, queueOrder: state.nextQueueOrder++
    };
    state.players.push(newPlayer);
    if (state.active.length < 4 && !state.started) state.active.push(newPlayer.id);
    else state.queue.push(newPlayer.id);
    persist();
    render();
    $("playerName").value = "";
    toast(name + " ditambahkan.");
  }

  function startSession() {
    if (state.players.length < 4) {
      toast("Tambahkan minimal 4 pemain terlebih dahulu.", "warning");
      return;
    }
    while (state.active.length < 4 && state.queue.length) state.active.push(state.queue.shift());
    if (state.active.length !== 4) {
      toast("Meja perlu tepat 4 pemain untuk memulai.", "warning");
      return;
    }
    state.started = true;
    state.sessionName = $("sessionName").value.trim();
    persist();
    render();
    toast("Sesi dimulai.", "info");
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
    $("activePlayers").innerHTML = state.active.map((id, index) => {
      const currentPlayer = player(id);
      if (!currentPlayer) return "";
      return '<article class="player">' +
        '<div class="player-top"><div class="avatar">' +
        escapeHtml(currentPlayer.name.slice(0, 1).toUpperCase()) +
        '</div><div class="player-heading"><div class="player-name">' +
        escapeHtml(currentPlayer.name) + '</div><div class="player-sub">Pemain meja · ' +
        (index + 1) + '</div></div></div>' +
        '<div class="player-score"><div><div class="score">' + currentPlayer.points +
        '</div><div class="pts">POIN KESELURUHAN</div></div><div class="player-sub">' +
        currentPlayer.rounds + ' ronde</div></div>' +
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
      $("leaderHead").innerHTML = "<tr><th>#</th><th>Nama pemain</th><th>Ronde</th><th>Poin</th></tr>";
      const overallPlayers = [...state.players].sort((a, b) =>
        b.points - a.points || a.name.localeCompare(b.name)
      );
      $("leaderboard").innerHTML = overallPlayers.map((item, index) =>
        '<tr><td><span class="rank-number ' + (index === 0 ? "winner" : "") + '">' +
        (index + 1) + '</span></td><td><strong>' + escapeHtml(item.name) + "</strong>" +
        (state.active.includes(item.id) ? ' <span class="active-tag">● AKTIF</span>' : "") +
        "</td><td>" + item.rounds + '</td><td><strong>' + item.points +
        "</strong></td></tr>"
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
        ? "Lanjutkan Battle Arena · " + poolSize + " kartu →"
        : "Masuk Battle Arena · " + poolSize + " kartu →";
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
      const replacementId = state.queue.shift();
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
    $("arenaMatchLabel").textContent = "MATCH " + pending.matchNumber + " · BATTLE ARENA";

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
        '</strong><span>' + pending.points[id] + ' poin match' + (current ? ' · GILIRANMU' : "") +
        '</span></div><div class="arena-duelist-slot">' + slot + "</div></div>";
    }).join("");

    const pickedIds = new Set(arena.picks.map(pick => pick.cardId));
    const remaining = arena.cards.filter(card => !pickedIds.has(card.id));
    const reserveOnly = arena.picks.length === arena.players.length;
    $("arenaDeckCount").textContent = remaining.length + " KARTU TERTUTUP";
    $("arenaDeck").innerHTML = remaining.map((card, index) =>
      '<button class="arena-pick-card' + (reserveOnly ? " arena-extra-card" : "") + '" type="button" ' +
      (reserveOnly ? "disabled" : 'data-arena-card="' + card.id + '"') +
      ' aria-label="' + (reserveOnly ? "Kartu cadangan" : "Pilih kartu tertutup " + (index + 1)) + '"><span class="arena-card-index">' +
      (reserveOnly ? "BONUS" : String(index + 1).padStart(2, "0")) + '</span><span class="arena-card-back">◆</span>' +
      '<span class="arena-card-prompt">' + (reserveOnly ? "CADANGAN" : "PILIH") + "</span></button>"
    ).join("");

    $("arenaDeckWrap").hidden = isRevealed;
    $("arenaReveal").hidden = !isRevealed;
    $("arenaActions").innerHTML = "";
    if (isRevealed) {
      const result = arena.result;
      const outgoing = result.outgoingIds;
      const winners = result.winnerIds;
      $("arenaReveal").innerHTML = '<div class="arena-result-heading"><span>HASIL PENENTUAN</span><strong>' +
        result.cards.length + ' pemain · ' + (result.extraCard ? "1 kartu cadangan" : "") + "</strong></div>" +
        '<div class="arena-result-cards">' + result.cards.map(card => {
          const isOut = outgoing.includes(card.id);
          const isWinner = winners.includes(card.id);
          return '<article class="arena-final-card ' + (isOut ? "final-out" : isWinner ? "final-winner" : "") + '">' +
            '<div class="arena-final-name"><strong>' + escapeHtml(card.name) + '</strong><span>' +
            (isOut ? "KELUAR" : isWinner ? "MENANG SERI" : "BERTAHAN") + '</span></div>' +
            dominoTileMarkup(card, false) + '<div class="arena-final-score">Poin match <b>' + card.points +
            '</b><span>Jumlah kartu <b>' + card.total + "</b></span></div></article>";
        }).join("") + "</div>" +
        (result.extraCard ? '<div class="arena-extra"><span>KARTU CADANGAN</span>' + dominoTileMarkup(result.extraCard, true) +
          '<small>Kartu tambahan ini tidak ikut menentukan hasil.</small></div>' : "");
      $("arenaActions").innerHTML = '<button class="primary arena-finish" id="finishArenaBtn" type="button">Selesaikan battle →</button>';
    } else if (arena.picks.length === arena.players.length) {
      $("arenaActions").innerHTML = '<button class="primary arena-reveal-button" id="revealArenaBtn" type="button">Buka semua kartu →</button>';
    }
    if (wasHidden) requestAnimationFrame(() => $("closeArena").focus());
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
    $("queuePill").textContent = state.queue.length + " menunggu";
    $("statusBadge").textContent = state.started ? "● SESI BERJALAN" : "● SIAP DIMULAI";
    $("roundInstructions").textContent = state.pendingBattle
      ? "Match " + state.pendingBattle.matchNumber + " selesai. Selesaikan tie-break di Battle Arena untuk melihat klasemen dan pergantian pemain."
      : state.started
      ? "Match " + (state.matchNumber || 1) + " · ronde " + Math.min(state.matchRoundCount + 1, 2) + "/2. " +
        (state.matchRoundCount === 1 ? "Empat pemain yang sama menyelesaikan match ini." : "Pilih satu juara untuk setiap pemain.")
      : "Pilih peringkat di setiap kartu pemain. Setiap ronde harus memiliki juara 1 sampai 4 masing-masing satu.";
    $("activeEmpty").style.display = state.active.length ? "none" : "block";
    $("queueEmpty").style.display = state.queue.length ? "none" : "block";
    $("queueList").innerHTML = state.queue.map((id, index) => {
      const item = player(id);
      if (!item) return "";
      return '<div class="queue-item"><div class="queue-no">' + (index + 1) +
        '</div><div class="queue-name">' + escapeHtml(item.name) +
        '</div><button class="small-btn subtle" data-remove="' + id +
        '" title="Hapus dari sesi"' + (state.pendingBattle ? " disabled" : "") + '>×</button></div>';
    }).join("");
    renderPlayers();
    $("startBtn").disabled = state.started;
    $("startBtn").textContent = state.started ? "Sesi berjalan" : "Mulai sesi";
    $("submitResult").disabled = !state.started || Boolean(state.pendingBattle) || !choicesAreComplete();
    renderStandings();
    renderHistory();
    renderBattle();
  }

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
    if (event.target.closest("#revealArenaBtn")) revealArenaCards();
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

    undoSnapshot = JSON.stringify(state);
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
      const replacementCount = Math.min(state.queue.length, Math.max(0, state.players.length - 4));
      const matchPoints = { ...state.matchPoints };
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
    toast(round.matchRound === 1
      ? "Ronde pertama Match " + round.matchNumber + " tersimpan. Empat pemain yang sama lanjut ronde kedua."
      : state.pendingBattle
        ? "Poin seri setelah dua ronde. Buka Battle Arena dan acak kartu domino untuk menentukan juara."
      : round.rotations.length
        ? "Match " + round.matchNumber + " selesai. " + round.rotations.length + " pemain dengan poin terendah diganti."
        : "Match " + round.matchNumber + " selesai. Antrean kosong, belum ada pemain yang diganti.",
      round.matchRound === 1 ? "info" : state.pendingBattle ? "warning" : "success");
  });

  $("queueList").addEventListener("click", async event => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    const id = Number(button.dataset.remove);
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
  });

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
    if (undoSnapshot) {
      state = JSON.parse(undoSnapshot);
      undoSnapshot = null;
      persist();
      render();
      toast("Ronde terakhir dibatalkan.");
    } else {
      toast("Pembatalan tersedia hanya sampai halaman dimuat ulang. Ekspor cadangan sebelum perubahan besar.", "warning");
    }
  });

  $("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "domino-match-backup.json";
    anchor.click();
    URL.revokeObjectURL(url);
    toast("Cadangan JSON diekspor.");
  });

  $("clearBtn").addEventListener("click", async () => {
    const accepted = await confirmDialog({
      kicker: "Reset sesi",
      title: "Hapus semua data?",
      message: "Semua pemain, poin, antrean, dan riwayat Domino Match di browser ini akan dihapus. Tindakan ini tidak dapat dibatalkan.",
      confirmText: "Reset semua data",
      tone: "danger"
    });
    if (!accepted) return;
    state = fresh();
    undoSnapshot = null;
    persist();
    render();
    toast("Semua data sesi direset.");
  });

  applyTheme();
  render();
})();
