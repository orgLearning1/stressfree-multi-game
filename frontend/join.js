const els = {
  status: document.getElementById("statusMessage"),
  joinName: document.getElementById("joinName"),
  joinBtn: document.getElementById("joinBtn"),
  roomLabel: document.getElementById("roomLabel"),
};

function showFlash(message, isError = false) {
  els.status.textContent = message;
  els.status.hidden = !message;
  els.status.setAttribute("data-tone", isError ? "error" : "info");
}

const roomId = getRoomIdFromQuery();
if (!roomId) {
  showFlash("Invalid invite link.", true);
  els.joinBtn.disabled = true;
} else {
  els.roomLabel.textContent = roomId;
}

els.joinBtn.addEventListener("click", async () => {
  if (!roomId) return;
  try {
    const data = await api("/api/join-room", "POST", {
      room_id: roomId,
      name: els.joinName.value.trim(),
    });
    setPlayerId(data.roomId, data.playerId);
    window.location.href = `${pageUrl("lobby.html")}?room=${encodeURIComponent(data.roomId)}`;
  } catch (error) {
    showFlash(error.message, true);
  }
});

void pingBackend(els.status);
