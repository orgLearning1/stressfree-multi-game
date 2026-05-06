async function loadLeaderboard() {
  const wordleEl = document.getElementById("leaderboardWordle");
  const hangmanEl = document.getElementById("leaderboardHangman");
  if (!wordleEl || !hangmanEl) return;
  try {
    const data = await api("/api/leaderboard", "GET", null, { cache: "no-store" });
    wordleEl.innerHTML = renderBoard(data.wordle || []);
    hangmanEl.innerHTML = renderBoard(data.hangman || []);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not load leaderboard";
    const row = `<tr><td colspan="3" class="lb-empty">${escapeHtml(msg)}</td></tr>`;
    wordleEl.innerHTML = row;
    hangmanEl.innerHTML = row;
  }
}

function renderBoard(rows) {
  if (!rows.length) {
    return "<tr><td colspan=\"3\" class=\"lb-empty\">No games yet</td></tr>";
  }
  return rows
    .map(
      (r, i) =>
        `<tr><td class="lb-rank">${i + 1}</td><td>${escapeHtml(r.name)}</td><td class="lb-num">${r.wins}W / ${r.losses}L</td></tr>`,
    )
    .join("");
}

window.addEventListener("pageshow", () => {
  void loadLeaderboard();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void loadLeaderboard();
  }
});
