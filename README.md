# Multiplayer Wordle (Python)

Local-first multiplayer Wordle with a Python backend and static frontend.

## Quick start

1. Install dependencies:
   - `make setup`
2. Start the app (serves the UI and API together):
   - `make backend`
3. Open:
   - `http://127.0.0.1:8010/` (avoid `http://0.0.0.0:8010/` in the browser; that host often breaks API calls)

Default API port is **8010** (`PORT` in the Makefile, and `API_PORT` in `frontend/common.js`). Override the server with `make backend PORT=9000` — if you use split UI on 5173, set `window.WORDLE_API_PORT = "9000"` before loading scripts, or edit `API_PORT` in `frontend/common.js` to match.

### Troubleshooting

- **`curl http://127.0.0.1:8010/health` returns plain `Not Found`:** something else is already listening on that port (not this app). Run `lsof -nP -iTCP:8010 -sTCP:LISTEN`, stop that process, then `make backend` again.
- **Sanity check:** `curl http://127.0.0.1:8010/api/wordle-ping` should return JSON: `{"service":"wordle-multiplayer","ok":true}`.
- **`make doctor`** hits `/health` and `/api/wordle-ping` for you (uses `PORT` from the Makefile).

Optional split mode (static server on 5173 + API on 8010):

1. Terminal 1: `make backend`
2. Terminal 2: `make frontend`
3. Open `http://127.0.0.1:5173/`

## Features

- Create room with name, player count, and per-turn timer.
- Share lobby link (`?room=<roomId>`) for multiplayer.
- Timed round-robin turns enforced by backend.
- Host can reveal answer using `Next Game`, then start next round.
- Single-player mode works locally without sharing.

## Word list behavior

- `backend/words/answers.txt`: possible secret words (~2.3k Wordle-style solutions; source: public Wordle-derived list via [cfreshman gist](https://gist.github.com/cfreshman/a03ef2cba789d8cf00c08f767e0fad7b)).
- `backend/words/allowed_guesses.txt`: valid guess dictionary (~14.8k words from [tabatkins/wordle-list](https://github.com/tabatkins/wordle-list), MIT). A guess is accepted only if it appears here (after normalizing to five lowercase letters). Words like **hello** are included in this file; the old tiny sample list did not include it, which is why you saw “not in allowed guesses.”
- Backend loads both at startup; replace these files if you want a different lexicon.

## Frontend pages

- **`/`** — choose **Wordle** or **Hangman**, create a room, then go to the lobby. Leaderboard (local SQLite) is shown here.
- **`/join.html?room=…`** — invite link for other players (name + join).
- **`/lobby.html?room=…`** — player list, invite (multiplayer), host starts the game.
- **`/game.html?room=…`** — play (opened automatically when the round starts).

### Modes

- **Wordle** — turn-based five-letter guesses; round winner recorded on the Wordle leaderboard.
- **Hangman** — cooperative: players take turns guessing **one letter**; shared progress toward the word; **6 wrong letters** loses the round. Win/loss is recorded for **every** player in the room on the Hangman leaderboard.

### Leaderboard

- Stored in the same SQLite DB as rooms (`backend/data/wordle.db`), table `leaderboard`.
- **`GET /api/leaderboard`** returns `{ "wordle": [...], "hangman": [...] }` with `name`, `wins`, `losses`.

## Free hosting approach

- Frontend: GitHub Pages
- Backend: Render free web service (or Railway free tier)
- Persistence: local SQLite file (`backend/data/wordle.db`)
