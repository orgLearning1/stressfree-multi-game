const state = { selectedSeconds: 30 };

const els = {
  status: document.getElementById("statusMessage"),
  createName: document.getElementById("createName"),
  maxPlayers: document.getElementById("maxPlayers"),
  createGameBtn: document.getElementById("createGameBtn"),
  timeButtons: document.getElementById("timeButtons"),
  modeDesc: document.getElementById("modeDesc"),
};

function showFlash(message, isError = false) {
  els.status.textContent = message;
  els.status.hidden = !message;
  els.status.setAttribute("data-tone", isError ? "error" : "info");
}

function selectedGameMode() {
  const r = document.querySelector('input[name="gameMode"]:checked');
  return r ? r.value : "wordle";
}

function updateModeDesc() {
  if (!els.modeDesc) return;
  els.modeDesc.textContent =
    selectedGameMode() === "hangman"
      ? "Co-op: take turns guessing letters; save the hangman before too many wrong guesses."
      : "Take turns guessing five-letter words (Wordle rules).";
}

document.querySelectorAll('input[name="gameMode"]').forEach((input) => {
  input.addEventListener("change", updateModeDesc);
});
updateModeDesc();

els.timeButtons.querySelectorAll(".timeBtn").forEach((btn) => {
  btn.addEventListener("click", () => {
    els.timeButtons.querySelectorAll(".timeBtn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.selectedSeconds = btn.dataset.seconds;
  });
});

els.createGameBtn.addEventListener("click", async () => {
  try {
    const maxPlayers = Number(els.maxPlayers.value);
    const turnSeconds = state.selectedSeconds === "infinite" ? null : Number(state.selectedSeconds);
    const data = await api("/api/create-room", "POST", {
      name: els.createName.value.trim(),
      max_players: maxPlayers,
      turn_seconds: turnSeconds,
      game_mode: selectedGameMode(),
    });
    setPlayerId(data.roomId, data.playerId);
    window.location.href = `${pageUrl("lobby.html")}?room=${encodeURIComponent(data.roomId)}`;
  } catch (error) {
    showFlash(error.message, true);
  }
});

void pingBackend(els.status);
