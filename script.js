(() => {
  "use strict";

  const KEY = "domino-match-manager-v1";
  const POINT_OPTIONS = [
    { value: "1:4", label: "Juara 1 · +4 poin" },
    { value: "1:5", label: "Juara 1 · +5 poin" },
    { value: "2:3", label: "Juara 2 · +3 poin" },
    { value: "3:2", label: "Juara 3 · +2 poin" },
    { value: "4:1", label: "Juara 4 · +1 poin" },
    { value: "4:-2", label: "Juara 4 · -2 poin" }
  ];
  const $ = id => document.getElementById(id);
  let state = load();
  let undoSnapshot = null;
  let activeStandings = "match";

  function fresh() {
    return {
      sessionName: "", started: false, players: [], active: [], queue: [], rounds: [],
      nextId: 1, nextQueueOrder: 1, matchRoundCount: 0, matchNumber: 1,
      matchPoints: {}, lastMatch: null
    };
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved && Array.isArray(saved.players) && Array.isArray(saved.active) &&
          Array.isArray(saved.queue) && Array.isArray(saved.rounds)) {
        return {
          ...fresh(), ...saved, matchPoints: saved.matchPoints || {},
          matchNumber: saved.matchNumber || 1, matchRoundCount: saved.matchRoundCount || 0
        };
      }
    } catch (error) {}
    return fresh();
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (error) {}
  }

  function toast(message) {
    const element = $("toast");
    element.textContent = message;
    element.classList.add("show");
    setTimeout(() => element.classList.remove("show"), 2600);
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
    if (state.players.some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      toast("Nama pemain sudah terdaftar.");
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
      toast("Tambahkan minimal 4 pemain terlebih dahulu.");
      return;
    }
    while (state.active.length < 4 && state.queue.length) state.active.push(state.queue.shift());
    if (state.active.length !== 4) {
      toast("Meja perlu tepat 4 pemain untuk memulai.");
      return;
    }
    state.started = true;
    state.sessionName = $("sessionName").value.trim();
    persist();
    render();
    toast("Sesi dimulai.");
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
        (state.started ? "" : " disabled") +
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
      matchPlayers.sort((a, b) =>
        (matchSource.points[b.id] || 0) - (matchSource.points[a.id] || 0) ||
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
      "</article>"
    ).join("");
    $("undoBtn").disabled = state.rounds.length === 0;
  }

  function render() {
    $("sessionName").value = state.sessionName || "";
    $("statPlayers").textContent = state.players.length;
    $("statRounds").textContent = state.rounds.length;
    $("statActive").textContent = state.active.length + "/4";
    $("tablePill").textContent = "Meja 1 · " + state.active.length + "/4 pemain";
    $("queuePill").textContent = state.queue.length + " menunggu";
    $("statusBadge").textContent = state.started ? "● SESI BERJALAN" : "● SIAP DIMULAI";
    $("roundInstructions").textContent = state.started
      ? "Match " + (state.matchNumber || 1) + " · ronde " + (state.matchRoundCount + 1) + "/2. " +
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
        '" title="Hapus dari sesi">×</button></div>';
    }).join("");
    renderPlayers();
    $("startBtn").disabled = state.started;
    $("startBtn").textContent = state.started ? "Sesi berjalan" : "Mulai sesi";
    $("submitResult").disabled = !state.started || !choicesAreComplete();
    renderStandings();
    renderHistory();
  }

  $("addPlayerForm").addEventListener("submit", event => {
    event.preventDefault();
    addPlayer($("playerName").value);
  });
  $("startBtn").addEventListener("click", startSession);
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
    if (!state.started || state.active.length !== 4) {
      toast("Mulai sesi dengan empat pemain aktif terlebih dahulu.");
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
      toast("Pilih juara 1, 2, 3, dan 4 masing-masing satu kali.");
      return;
    }

    undoSnapshot = JSON.stringify(state);
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
      const outgoing = [...state.active].sort((a, b) =>
        (state.matchPoints[a] ?? 0) - (state.matchPoints[b] ?? 0) ||
        (player(a)?.name || "").localeCompare(player(b)?.name || "")
      ).slice(0, replacementCount);

      outgoing.forEach(outgoingId => {
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
        number: state.matchNumber,
        players: matchParticipants,
        points: { ...state.matchPoints }
      };
      state.matchRoundCount = 0;
      state.matchNumber += 1;
      state.matchPoints = {};
    }

    state.rounds.push(round);
    persist();
    render();
    toast(round.matchRound === 1
      ? "Ronde pertama Match " + round.matchNumber + " tersimpan. Empat pemain yang sama lanjut ronde kedua."
      : round.rotations.length
        ? "Match " + round.matchNumber + " selesai. " + round.rotations.length + " pemain dengan poin terendah diganti."
        : "Match " + round.matchNumber + " selesai. Antrean kosong, belum ada pemain yang diganti.");
  });

  $("queueList").addEventListener("click", event => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    const id = Number(button.dataset.remove);
    const item = player(id);
    if (!item) return;
    if (!confirm("Hapus " + item.name + " dari antrean dan sesi? Poinnya akan dihapus juga.")) return;
    state.queue = state.queue.filter(queueId => queueId !== id);
    state.players = state.players.filter(current => current.id !== id);
    persist();
    render();
    toast("Pemain dihapus.");
  });

  $("undoBtn").addEventListener("click", () => {
    if (!state.rounds.length) return;
    if (!confirm("Batalkan ronde terakhir? Poin dan posisi pemain akan dikembalikan ke kondisi sebelum ronde tersebut.")) return;
    if (undoSnapshot) {
      state = JSON.parse(undoSnapshot);
      undoSnapshot = null;
      persist();
      render();
      toast("Ronde terakhir dibatalkan.");
    } else {
      toast("Pembatalan tersedia hanya sampai halaman dimuat ulang. Ekspor cadangan sebelum perubahan besar.");
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

  $("clearBtn").addEventListener("click", () => {
    if (!confirm("Yakin reset semua data Domino Match di browser ini? Tindakan ini tidak bisa dibatalkan.")) return;
    state = fresh();
    undoSnapshot = null;
    persist();
    render();
    toast("Semua data sesi direset.");
  });

  render();
})();
