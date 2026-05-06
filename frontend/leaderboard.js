async function loadLeaderboard() {
  const wordleEl = document.getElementById("leaderboardWordle");
  const hangmanEl = document.getElementById("leaderboardHangman");
  if (!wordleEl || !hangmanEl) return;
  try {
    const data = await api("/api/leaderboard");
    wordleEl.innerHTML = renderBoard(data.wordle || []);
    hangmanEl.innerHTML = renderBoard(data.hangman || []);
  } catch {
    wordleEl.innerHTML = "<tr><td colspan=\"3\">—</td></tr>";
    hangmanEl.innerHTML = "<tr><td colspan=\"3\">—</td></tr>";
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

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

void loadLeaderboard();
