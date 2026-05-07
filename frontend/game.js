const els = {
  pageTitle: document.getElementById("pageTitle"),
  status: document.getElementById("statusMessage"),
  metaLine: document.getElementById("metaLine"),
  wordlePanel: document.getElementById("wordlePanel"),
  hangmanPanel: document.getElementById("hangmanPanel"),
  winnerBanner: document.getElementById("winnerBanner"),
  wordleComposer: document.getElementById("wordleComposer"),
  wordleDraft: document.getElementById("wordleDraft"),
  wordleKeyboard: document.getElementById("wordleKeyboard"),
  hangmanFigure: document.getElementById("hangmanFigure"),
  hangmanSvg: document.getElementById("hangmanSvg"),
  hangmanMask: document.getElementById("hangmanMask"),
  hangmanStrikes: document.getElementById("hangmanStrikes"),
  hangmanLetters: document.getElementById("hangmanLetters"),
  hangmanLetter: document.getElementById("hangmanLetter"),
  hangmanBtn: document.getElementById("hangmanBtn"),
  hangmanBanner: document.getElementById("hangmanBanner"),
  nextGameBtn: document.getElementById("nextGameBtn"),
  startNextRoundBtn: document.getElementById("startNextRoundBtn"),
  answerReveal: document.getElementById("answerReveal"),
  guesses: document.getElementById("guesses"),
  gameChatLog: document.getElementById("gameChatLog"),
  gameChatInput: document.getElementById("gameChatInput"),
  gameChatSend: document.getElementById("gameChatSend"),
};

/** Keeps the guess row above the keyboard on mobile (visualViewport + scroll). */
function installMobileKeyboardAssist() {
  const hangmanLetter = document.getElementById("hangmanLetter");
  const gameChatInput = document.getElementById("gameChatInput");
  const inputs = [hangmanLetter, gameChatInput].filter(Boolean);
  if (!inputs.length) return;

  function scrollActiveFieldIntoView() {
    const el = document.activeElement;
    if (!el || !inputs.includes(el)) return;
    const row = el.closest(".guess-entry");
    const anchor = row || el;
    anchor.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });

    const vv = window.visualViewport;
    if (!vv) return;
    const rect = anchor.getBoundingClientRect();
    const margin = 20;
    const visibleBottom = vv.offsetTop + vv.height;
    if (rect.bottom > visibleBottom - margin) {
      const delta = rect.bottom - (visibleBottom - margin);
      window.scrollBy({ top: delta, behavior: "smooth" });
    }
    if (rect.top < vv.offsetTop + margin) {
      const delta = rect.top - (vv.offsetTop + margin);
      window.scrollBy({ top: delta, behavior: "smooth" });
    }
  }

  inputs.forEach((input) => {
    input.addEventListener("focus", () => {
      requestAnimationFrame(() => {
        scrollActiveFieldIntoView();
        setTimeout(scrollActiveFieldIntoView, 100);
        setTimeout(scrollActiveFieldIntoView, 320);
      });
    });
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      if (inputs.includes(document.activeElement)) {
        requestAnimationFrame(scrollActiveFieldIntoView);
      }
    });
  }
}

function clearFlash() {
  if (!els.status) return;
  els.status.textContent = "";
  els.status.hidden = true;
  els.status.removeAttribute("data-tone");
}

function showFlash(message, isError = false) {
  if (!els.status) return;
  els.status.textContent = message;
  els.status.hidden = false;
  els.status.setAttribute("data-tone", isError ? "error" : "info");
}

const roomId = getRoomIdFromQuery();
const playerId = roomId ? getPlayerId(roomId) : null;

if (!roomId || !playerId) {
  showFlash("Start from Create or Join.", true);
  els.wordleKeyboard?.querySelectorAll(".wordle-key").forEach((btn) => {
    btn.disabled = true;
  });
  if (els.hangmanBtn) els.hangmanBtn.disabled = true;
} else {
  let room = null;
  let draftGuess = "";
  /** Tracks prior "my turn" while in_game so we only cue on transitions (not first paint). */
  let lastMyTurnSignal = null;

  function renderWordleDraft() {
    if (!els.wordleDraft) return;
    const padded = draftGuess.padEnd(5, " ");
    els.wordleDraft.innerHTML = "";
    for (let i = 0; i < 5; i += 1) {
      const cell = document.createElement("div");
      cell.className = "wordle-draft-cell";
      const ch = padded[i];
      if (ch !== " ") {
        cell.classList.add("filled");
        cell.textContent = ch.toUpperCase();
      }
      els.wordleDraft.appendChild(cell);
    }
  }

  function keyboardRank(mark) {
    if (mark === "correct") return 3;
    if (mark === "present") return 2;
    return 1;
  }

  function renderWordleKeyboard(roundState, enabled) {
    if (!els.wordleKeyboard) return;
    const seen = {};
    const guesses = roundState?.guesses || [];
    guesses.forEach((entry) => {
      entry.feedback.forEach((mark, idx) => {
        const letter = entry.guess[idx];
        if (!letter) return;
        const rank = keyboardRank(mark);
        seen[letter] = Math.max(seen[letter] || 0, rank);
      });
    });
    els.wordleKeyboard
      .querySelectorAll(".wordle-key")
      .forEach((btn) => {
        const key = btn.getAttribute("data-key");
        if (!key) return;
        btn.disabled = !enabled;
        btn.classList.remove("wordle-key--absent", "wordle-key--present", "wordle-key--correct");
        const rank = seen[key];
        if (rank === 1) btn.classList.add("wordle-key--absent");
        if (rank === 2) btn.classList.add("wordle-key--present");
        if (rank === 3) btn.classList.add("wordle-key--correct");
      });
    els.wordleKeyboard.classList.toggle("wordle-keyboard--disabled", !enabled);
  }

  function isHost() {
    const me = room?.players?.find((p) => p.id === playerId);
    return Boolean(me?.isHost);
  }

  function isHangman() {
    return room?.gameMode === "hangman";
  }

  function playTurnPing() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = 880;
      o.type = "sine";
      g.gain.setValueAtTime(0.07, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      o.start(ctx.currentTime);
      o.stop(ctx.currentTime + 0.15);
      setTimeout(() => ctx.close(), 400);
    } catch (_) {
      /* autoplay policy or unsupported */
    }
  }

  function pulseTurnSpotlight() {
    const wrap = isHangman()
      ? document.getElementById("hangmanGuessEntry")
      : document.getElementById("wordleComposer");
    if (!wrap) return;
    wrap.classList.remove("turn-spotlight");
    void wrap.offsetWidth;
    wrap.classList.add("turn-spotlight");
    wrap.addEventListener(
      "animationend",
      () => {
        wrap.classList.remove("turn-spotlight");
      },
      { once: true },
    );
  }

  function updateTurnCue(itsMyTurn) {
    if (room.status !== "in_game") {
      lastMyTurnSignal = null;
      document.getElementById("wordleComposer")?.classList.remove("turn-spotlight");
      document.getElementById("hangmanGuessEntry")?.classList.remove("turn-spotlight");
      return;
    }
    if (lastMyTurnSignal === null) {
      lastMyTurnSignal = itsMyTurn;
      return;
    }
    if (itsMyTurn && !lastMyTurnSignal) {
      playTurnPing();
      pulseTurnSpotlight();
    }
    lastMyTurnSignal = itsMyTurn;
  }

  async function syncRoomFromApi() {
    try {
      room = await fetchRoom(roomId, playerId);
      renderGame();
    } catch (e) {
      showFlash(e.message, true);
    }
  }

  /**
   * Map wrong guesses to drawing steps. With maxWrong=6 each wrong reveals one limb.
   * If maxWrong differs, scale so the figure completes on the last allowed wrong.
   */
  function hangmanLimbsToShow(wrongCount, maxWrong) {
    const max = Math.max(1, maxWrong || 6);
    const cap = 6;
    const ratio = Math.min(wrongCount / max, 1);
    return Math.min(Math.ceil(ratio * cap), cap);
  }

  function resetHangmanVisual() {
    if (!els.hangmanSvg || !els.hangmanFigure) return;
    els.hangmanSvg.querySelectorAll(".hangman-limb").forEach((n) => n.classList.remove("is-drawn"));
    els.hangmanFigure.classList.remove("hangman-figure--lost", "hangman-figure--saved", "hangman-figure--peril");
  }

  function renderGameChat() {
    const log = els.gameChatLog;
    if (!log) return;
    const messages = room.lobbyChat || [];
    if (!messages.length) {
      log.innerHTML = '<p class="lobby-chat-empty subtle">No messages yet.</p>';
      return;
    }
    log.innerHTML = messages
      .map(
        (m) =>
          `<div class="lobby-chat-line"><span class="lobby-chat-name">${escapeHtml(m.name)}</span><span class="lobby-chat-text">${escapeHtml(m.text)}</span></div>`,
      )
      .join("");
    log.scrollTop = log.scrollHeight;
  }

  function updateHangmanAnimation(hm, status) {
    if (!els.hangmanSvg || !els.hangmanFigure || !hm) return;
    const maxW = hm.maxWrong ?? 6;
    const outcome = hm.outcome;
    let limbs = hangmanLimbsToShow(hm.wrongCount, maxW);
    if (status === "round_complete" && outcome === "lost") {
      limbs = 6;
    }
    els.hangmanSvg.querySelectorAll(".hangman-limb").forEach((node) => {
      const step = Number(node.getAttribute("data-limb"));
      node.classList.toggle("is-drawn", step <= limbs);
    });
    els.hangmanFigure.classList.toggle("hangman-figure--lost", status === "round_complete" && outcome === "lost");
    els.hangmanFigure.classList.toggle("hangman-figure--saved", status === "round_complete" && outcome === "won");
    els.hangmanFigure.classList.toggle("hangman-figure--peril", status === "in_game" && hm.wrongCount === maxW - 1 && maxW > 0);
  }

  function renderGame() {
    if (!room) return;
    if (room.status === "lobby") {
      window.location.href = `${pageUrl("lobby.html")}?room=${encodeURIComponent(roomId)}`;
      return;
    }

    clearFlash();

    const hangman = isHangman();
    if (els.pageTitle) els.pageTitle.textContent = hangman ? "Hangman" : "Wordle";
    els.wordlePanel?.classList.toggle("hidden", hangman);
    els.hangmanPanel?.classList.toggle("hidden", !hangman);
    if (!hangman) {
      resetHangmanVisual();
    }

    const turnPlayer = room.players.find((p) => p.id === room.currentTurnPlayerId);
    const timerPart =
      room.turnSeconds == null ? null : `${room.secondsRemaining ?? room.turnSeconds}s left`;
    const itsMyTurn = room.status === "in_game" && room.currentTurnPlayerId === playerId;

    if (hangman) {
      const hm = room.hangman;
      if (!hm) {
        resetHangmanVisual();
      }
      if (hm) {
        if (els.hangmanMask) els.hangmanMask.textContent = hm.masked || "";
        if (els.hangmanStrikes) els.hangmanStrikes.textContent = `Wrong: ${hm.wrongCount} / ${hm.maxWrong}`;
        if (els.hangmanLetters)
          els.hangmanLetters.textContent =
            hm.guessedLetters?.length > 0 ? `Guessed: ${hm.guessedLetters.join(", ").toUpperCase()}` : "";
        if (room.status === "in_game") {
          if (els.metaLine)
            els.metaLine.textContent = [turnPlayer ? `${turnPlayer.name}'s turn` : null, "Save the hangman", timerPart]
              .filter(Boolean)
              .join(" · ");
        } else {
          if (els.metaLine) els.metaLine.textContent = "";
        }
        if (room.status === "round_complete" && hm.outcome === "won") {
          if (els.hangmanBanner) els.hangmanBanner.textContent = "You saved the hangman.";
        } else if (room.status === "round_complete" && hm.outcome === "lost") {
          if (els.hangmanBanner) els.hangmanBanner.textContent = "The hangman was lost.";
        } else {
          if (els.hangmanBanner) els.hangmanBanner.textContent = "";
        }
        if (els.answerReveal)
          els.answerReveal.textContent =
            hm.answer && (room.status === "round_complete" || room.status === "round_revealed")
              ? `Word was: ${hm.answer}`
              : "";
        updateHangmanAnimation(hm, room.status);
      }
      if (els.hangmanBtn) els.hangmanBtn.disabled = !itsMyTurn;
      if (els.hangmanLetter) els.hangmanLetter.disabled = !itsMyTurn;
    } else {
      if (els.metaLine)
        els.metaLine.textContent = [turnPlayer ? `${turnPlayer.name}'s turn` : null, timerPart]
          .filter(Boolean)
          .join(" · ");
      const winner = room.activeRound?.winnerId
        ? room.players.find((p) => p.id === room.activeRound.winnerId)
        : null;
      if (els.winnerBanner) els.winnerBanner.textContent = winner ? `${winner.name} got it` : "";
      if (els.answerReveal)
        els.answerReveal.textContent =
          room.activeRound?.answer && (room.status === "round_revealed" || room.status === "round_complete")
            ? `Answer: ${room.activeRound.answer}`
            : "";

      if (els.guesses) {
        els.guesses.innerHTML = "";
        (room.activeRound?.guesses || []).forEach((entry) => {
          const player = room.players.find((p) => p.id === entry.playerId);
          const row = document.createElement("div");
          row.className = "guessRow";
          const label = document.createElement("div");
          label.className = "player-label";
          label.textContent = player?.name || "Player";
          row.appendChild(label);
          entry.feedback.forEach((mark, idx) => {
            const tile = document.createElement("div");
            tile.className = `tile ${mark}`;
            tile.textContent = entry.guess[idx];
            row.appendChild(tile);
          });
          els.guesses.appendChild(row);
        });
        els.guesses.scrollTop = els.guesses.scrollHeight;
      }
    }

    renderWordleDraft();
    renderWordleKeyboard(room.activeRound, !hangman && itsMyTurn);

    if (els.nextGameBtn) els.nextGameBtn.disabled = !isHost();
    const shouldShowStartNext = isHost() && room.status === "round_revealed";
    els.startNextRoundBtn?.classList.toggle("hidden", !shouldShowStartNext);

    const wEl = document.getElementById("wordleComposer");
    const hEl = document.getElementById("hangmanGuessEntry");
    if (wEl) wEl.classList.toggle("your-turn-active", !hangman && itsMyTurn);
    if (hEl) hEl.classList.toggle("your-turn-active", hangman && itsMyTurn);

    updateTurnCue(itsMyTurn);
    renderGameChat();
  }

  connectRoomWs(roomId, (r) => {
    room = r;
    renderGame();
  });

  api(`/api/room/${roomId}?player_id=${encodeURIComponent(playerId)}`)
    .then((data) => {
      room = data.room;
      renderGame();
    })
    .catch((e) => showFlash(e.message, true));

  async function submitWordle() {
    const raw = draftGuess.trim().toLowerCase();
    if (raw.length !== 5) {
      showFlash("Enter five letters.", true);
      return;
    }
    try {
      await api("/api/guess", "POST", {
        room_id: roomId,
        player_id: playerId,
        guess: raw,
      });
      draftGuess = "";
      clearFlash();
      renderWordleDraft();
      void syncRoomFromApi();
    } catch (error) {
      showFlash(error.message, true);
    }
  }

  function pushWordleLetter(letter) {
    if (draftGuess.length >= 5) return;
    draftGuess += letter;
    renderWordleDraft();
  }

  function popWordleLetter() {
    if (!draftGuess) return;
    draftGuess = draftGuess.slice(0, -1);
    renderWordleDraft();
  }

  async function handleWordleKey(key) {
    if (!room || isHangman()) return;
    const itsMyTurn = room.status === "in_game" && room.currentTurnPlayerId === playerId;
    if (!itsMyTurn) return;
    if (key === "enter") {
      await submitWordle();
      return;
    }
    if (key === "backspace") {
      popWordleLetter();
      return;
    }
    if (/^[a-z]$/.test(key)) {
      pushWordleLetter(key);
    }
    if (els.status?.getAttribute("data-tone") === "error") {
      clearFlash();
    }
  }

  els.wordleKeyboard?.addEventListener(
    "pointerup",
    (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const btn = event.target.closest(".wordle-key");
      if (!btn || btn.disabled) return;
      event.preventDefault();
      const key = btn.getAttribute("data-key");
      if (!key) return;
      void handleWordleKey(key);
    },
    { passive: false },
  );

  window.addEventListener("keydown", (e) => {
    if (isHangman()) return;
    if (document.activeElement === els.gameChatInput || document.activeElement === els.hangmanLetter) {
      return;
    }
    const key = e.key.toLowerCase();
    if (key === "enter" || key === "backspace" || /^[a-z]$/.test(key)) {
      e.preventDefault();
      void handleWordleKey(key);
    }
  });

  async function submitHangmanLetter() {
    if (!els.hangmanLetter) return;
    const raw = els.hangmanLetter.value.trim().toLowerCase();
    if (raw.length !== 1 || !/[a-z]/.test(raw)) {
      showFlash("One letter A–Z.", true);
      return;
    }
    try {
      await api("/api/hangman-letter", "POST", {
        room_id: roomId,
        player_id: playerId,
        letter: raw,
      });
      els.hangmanLetter.value = "";
      clearFlash();
      void syncRoomFromApi();
    } catch (error) {
      showFlash(error.message, true);
    }
  }

  els.hangmanBtn?.addEventListener("click", submitHangmanLetter);
  els.hangmanLetter?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitHangmanLetter();
    }
  });
  els.hangmanLetter?.addEventListener("input", () => {
    if (els.status?.getAttribute("data-tone") === "error") {
      clearFlash();
    }
  });

  els.nextGameBtn?.addEventListener("click", async () => {
    try {
      await api("/api/next-game", "POST", { room_id: roomId, player_id: playerId });
      clearFlash();
      void syncRoomFromApi();
    } catch (error) {
      showFlash(error.message, true);
    }
  });
  els.startNextRoundBtn?.addEventListener("click", async () => {
    try {
      await api("/api/start-next-round", "POST", { room_id: roomId, player_id: playerId });
      clearFlash();
      void syncRoomFromApi();
    } catch (error) {
      showFlash(error.message, true);
    }
  });

  async function sendGameChat() {
    const text = (els.gameChatInput?.value || "").trim();
    if (!text) return;
    try {
      await api("/api/lobby-chat", "POST", {
        room_id: roomId,
        player_id: playerId,
        text,
      });
      if (els.gameChatInput) els.gameChatInput.value = "";
      clearFlash();
      room = await fetchRoom(roomId, playerId);
      renderGame();
    } catch (error) {
      showFlash(error.message, true);
    }
  }

  els.gameChatSend?.addEventListener("click", () => {
    void sendGameChat();
  });
  els.gameChatInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void sendGameChat();
    }
  });

  installMobileKeyboardAssist();
}
