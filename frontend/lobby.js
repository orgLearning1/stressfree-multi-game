const els = {
  modeHint: document.getElementById("modeHint"),
  status: document.getElementById("statusMessage"),
  shareSection: document.getElementById("shareSection"),
  shareLink: document.getElementById("shareLink"),
  copyBtn: document.getElementById("copyBtn"),
  waBtn: document.getElementById("waBtn"),
  lobbyChatLog: document.getElementById("lobbyChatLog"),
  lobbyChatInput: document.getElementById("lobbyChatInput"),
  lobbyChatSend: document.getElementById("lobbyChatSend"),
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

  function renderChat() {
    const log = els.lobbyChatLog;
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
    renderChat();
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
      try {
        room = await fetchRoom(roomId, playerId);
        renderLobby();
      } catch (_) {
        /* WS / redirect will follow */
      }
    } catch (error) {
      showFlash(error.message, true);
    }
  });

  async function sendLobbyChat() {
    const text = (els.lobbyChatInput?.value || "").trim();
    if (!text) return;
    try {
      await api("/api/lobby-chat", "POST", {
        room_id: roomId,
        player_id: playerId,
        text,
      });
      els.lobbyChatInput.value = "";
      clearFlash();
      room = await fetchRoom(roomId, playerId);
      renderLobby();
    } catch (error) {
      showFlash(error.message, true);
    }
  }

  els.lobbyChatSend?.addEventListener("click", sendLobbyChat);
  els.lobbyChatInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void sendLobbyChat();
    }
  });
}
