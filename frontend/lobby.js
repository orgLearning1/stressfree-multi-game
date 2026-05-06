const els = {
  modeHint: document.getElementById("modeHint"),
  status: document.getElementById("statusMessage"),
  shareSection: document.getElementById("shareSection"),
  shareLink: document.getElementById("shareLink"),
  copyBtn: document.getElementById("copyBtn"),
  waBtn: document.getElementById("waBtn"),
  lobbyCount: document.getElementById("lobbyCount"),
  playerList: document.getElementById("playerList"),
  startGameBtn: document.getElementById("startGameBtn"),
};

function clearFlash() {
  els.status.textContent = "";
  els.status.hidden = true;
  els.status.removeAttribute("data-tone");
}

function showFlash(message, isError = false) {
  els.status.textContent = message;
  els.status.hidden = !message;
  els.status.setAttribute("data-tone", isError ? "error" : "info");
}

const roomId = getRoomIdFromQuery();
const playerId = roomId ? getPlayerId(roomId) : null;

if (!roomId || !playerId) {
  showFlash("Open this page from Create or an invite link.", true);
  els.startGameBtn.disabled = true;
} else {
  let room = null;

  function isHost() {
    const me = room?.players?.find((p) => p.id === playerId);
    return Boolean(me?.isHost);
  }

  function renderLobby() {
    if (!room) return;
    if (room.status !== "lobby") {
      window.location.href = `${pageUrl("game.html")}?room=${encodeURIComponent(roomId)}`;
      return;
    }
    clearFlash();
    if (els.modeHint) {
      els.modeHint.textContent =
        room.gameMode === "hangman"
          ? "Hangman — cooperate to guess the word before the hangman is lost."
          : "Wordle — take turns guessing five-letter words.";
    }
    els.shareSection.classList.toggle("hidden", room.maxPlayers === 1);
    els.lobbyCount.textContent = `${room.players.length} / ${room.maxPlayers}`;
    els.playerList.innerHTML = "";
    room.players.forEach((player) => {
      const li = document.createElement("li");
      li.textContent = `${player.name}${player.isHost ? " · host" : ""}`;
      els.playerList.appendChild(li);
    });
    const canStart = isHost() && room.status === "lobby";
    els.startGameBtn.classList.toggle("hidden", !canStart);
    if (room.maxPlayers > 1) {
      els.shareLink.value = shareJoinLink(roomId);
    }
  }

  connectRoomWs(roomId, (r) => {
    room = r;
    renderLobby();
  });

  api(`/api/room/${roomId}?player_id=${encodeURIComponent(playerId)}`)
    .then((data) => {
      room = data.room;
      renderLobby();
    })
    .catch((e) => showFlash(e.message, true));

  els.copyBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(els.shareLink.value);
    showFlash("Link copied.", false);
  });
  els.waBtn.addEventListener("click", () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(els.shareLink.value)}`, "_blank");
  });
  els.startGameBtn.addEventListener("click", async () => {
    try {
      await api("/api/start-game", "POST", { room_id: roomId, player_id: playerId });
    } catch (error) {
      showFlash(error.message, true);
    }
  });
}
