from __future__ import annotations

import random
import sqlite3
import string
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from uuid import uuid4

from .models import GuessState, HangmanRoundState, PlayerState, RoomState, RoundState


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class GameError(Exception):
    pass


def evaluate_guess(guess: str, answer: str) -> list[str]:
    feedback = ["absent"] * 5
    unmatched_answer_chars: dict[str, int] = {}
    for idx, char in enumerate(answer):
        if guess[idx] == char:
            feedback[idx] = "correct"
        else:
            unmatched_answer_chars[char] = unmatched_answer_chars.get(char, 0) + 1
    for idx, char in enumerate(guess):
        if feedback[idx] == "correct":
            continue
        if unmatched_answer_chars.get(char, 0) > 0:
            feedback[idx] = "present"
            unmatched_answer_chars[char] -= 1
    return feedback


class SQLiteStore:
    def __init__(self, db_path: Path) -> None:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._db_path = db_path
        self._lock = threading.Lock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _initialize(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS rooms (
                    id TEXT PRIMARY KEY,
                    host_id TEXT NOT NULL,
                    max_players INTEGER NOT NULL,
                    turn_seconds INTEGER,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS players (
                    id TEXT PRIMARY KEY,
                    room_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    is_host INTEGER NOT NULL,
                    joined_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS games (
                    id TEXT PRIMARY KEY,
                    room_id TEXT NOT NULL,
                    answer TEXT NOT NULL,
                    round_number INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    winner_id TEXT,
                    started_at TEXT NOT NULL,
                    ended_at TEXT
                );
                CREATE TABLE IF NOT EXISTS guesses (
                    id TEXT PRIMARY KEY,
                    game_id TEXT NOT NULL,
                    room_id TEXT NOT NULL,
                    player_id TEXT NOT NULL,
                    guess TEXT NOT NULL,
                    feedback TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS leaderboard (
                    player_key TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    game_mode TEXT NOT NULL,
                    wins INTEGER NOT NULL DEFAULT 0,
                    losses INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (player_key, game_mode)
                );
                """
            )

    def save_room(self, room: RoomState) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO rooms(id, host_id, max_players, turn_seconds, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    room.id,
                    room.host_id,
                    room.max_players,
                    room.turn_seconds,
                    room.status,
                    room.created_at.isoformat(),
                ),
            )

    def save_player(self, room_id: str, player: PlayerState) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO players(id, room_id, name, is_host, joined_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (player.id, room_id, player.name, int(player.is_host), player.joined_at.isoformat()),
            )

    def save_round(self, room_id: str, round_state: RoundState, status: str) -> str:
        game_id = f"{room_id}-{round_state.round_number}"
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO games(id, room_id, answer, round_number, status, winner_id, started_at, ended_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    game_id,
                    room_id,
                    round_state.answer,
                    round_state.round_number,
                    status,
                    round_state.winner_id,
                    round_state.turn_started_at.isoformat(),
                    None,
                ),
            )
        return game_id

    def finish_round(self, room_id: str, round_state: RoundState, status: str) -> None:
        game_id = f"{room_id}-{round_state.round_number}"
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                UPDATE games
                SET status = ?, winner_id = ?, ended_at = ?
                WHERE id = ?
                """,
                (status, round_state.winner_id, utc_now().isoformat(), game_id),
            )

    def save_guess(self, room_id: str, round_number: int, guess: GuessState) -> None:
        game_id = f"{room_id}-{round_number}"
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO guesses(id, game_id, room_id, player_id, guess, feedback, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid4()),
                    game_id,
                    room_id,
                    guess.player_id,
                    guess.guess,
                    ",".join(guess.feedback),
                    guess.created_at.isoformat(),
                ),
            )

    def leaderboard_increment(self, display_name: str, game_mode: str, *, wins: int = 0, losses: int = 0) -> None:
        if wins <= 0 and losses <= 0:
            return
        key = (display_name or "").strip().lower()[:64]
        if not key:
            return
        disp = ((display_name or "").strip()[:24] or key)[:24]
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO leaderboard(player_key, display_name, game_mode, wins, losses)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(player_key, game_mode) DO UPDATE SET
                  wins = wins + excluded.wins,
                  losses = losses + excluded.losses,
                  display_name = excluded.display_name
                """,
                (key, disp, game_mode, wins, losses),
            )

    def leaderboard_for_mode(self, game_mode: str, limit: int = 8) -> list[dict]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT display_name, wins, losses
                FROM leaderboard
                WHERE game_mode = ? AND (wins > 0 OR losses > 0)
                ORDER BY wins DESC, losses ASC, display_name COLLATE NOCASE
                LIMIT ?
                """,
                (game_mode, limit),
            ).fetchall()
        return [{"name": r["display_name"], "wins": r["wins"], "losses": r["losses"]} for r in rows]


class WordRepository:
    def __init__(self, answers_path: Path, allowed_path: Path) -> None:
        self.answers = self._read_words(answers_path)
        allowed_words = self._read_words(allowed_path)
        if not self.answers:
            raise RuntimeError("answers.txt cannot be empty")
        self.allowed = set(allowed_words) | set(self.answers)

    @staticmethod
    def _read_words(path: Path) -> list[str]:
        if not path.exists():
            return []
        words = []
        text = path.read_text(encoding="utf-8")
        for raw in text.splitlines():
            word = raw.strip().lower()
            if len(word) == 5 and all("a" <= c <= "z" for c in word):
                words.append(word)
        return words

    def random_answer(self) -> str:
        return random.choice(self.answers)

    def is_allowed_guess(self, guess: str) -> bool:
        return guess in self.allowed


class RoomService:
    def __init__(self, store: SQLiteStore, words: WordRepository) -> None:
        self._store = store
        self._words = words
        self._rooms: dict[str, RoomState] = {}
        self._lock = threading.Lock()

    def _new_room_id(self) -> str:
        alphabet = string.ascii_lowercase + string.digits
        while True:
            value = "".join(random.choice(alphabet) for _ in range(6))
            if value not in self._rooms:
                return value

    @staticmethod
    def _new_player_id() -> str:
        return uuid4().hex[:10]

    def create_room(
        self,
        name: str,
        max_players: int,
        turn_seconds: Optional[int],
        game_mode: str = "wordle",
    ) -> tuple[RoomState, PlayerState]:
        with self._lock:
            room_id = self._new_room_id()
            host = PlayerState(id=self._new_player_id(), name=name.strip(), is_host=True)
            room = RoomState(
                id=room_id,
                host_id=host.id,
                max_players=max_players,
                turn_seconds=turn_seconds,
                game_mode=game_mode,
                players=[host],
            )
            self._rooms[room_id] = room
            self._store.save_room(room)
            self._store.save_player(room_id, host)
            return room, host

    def get_room(self, room_id: str) -> RoomState:
        room = self._rooms.get(room_id)
        if room is None:
            raise GameError("Room not found")
        return room

    def join_room(self, room_id: str, name: str) -> PlayerState:
        with self._lock:
            room = self.get_room(room_id)
            if room.status != "lobby":
                raise GameError("Game already started")
            if len(room.players) >= room.max_players:
                raise GameError("Lobby is full")
            player = PlayerState(id=self._new_player_id(), name=name.strip(), is_host=False)
            room.players.append(player)
            self._store.save_player(room_id, player)
            return player

    def _find_player(self, room: RoomState, player_id: str) -> PlayerState:
        for player in room.players:
            if player.id == player_id:
                return player
        raise GameError("Player not found in this room")

    def _next_round_number(self, room: RoomState) -> int:
        n = 0
        if room.active_round is not None:
            n = max(n, room.active_round.round_number)
        if room.hangman is not None:
            n = max(n, room.hangman.round_number)
        return n + 1

    def _new_round(self, room: RoomState) -> RoundState:
        round_number = self._next_round_number(room)
        turn_idx = random.randrange(len(room.players))
        round_state = RoundState(
            answer=self._words.random_answer(),
            round_number=round_number,
            current_turn_idx=turn_idx,
            turn_started_at=utc_now(),
        )
        room.active_round = round_state
        room.hangman = None
        room.status = "in_game"
        self._store.save_room(room)
        self._store.save_round(room.id, round_state, "in_game")
        return round_state

    def _new_hangman_round(self, room: RoomState) -> HangmanRoundState:
        round_number = self._next_round_number(room)
        turn_idx = random.randrange(len(room.players))
        hm = HangmanRoundState(
            answer=self._words.random_answer(),
            round_number=round_number,
            current_turn_idx=turn_idx,
            turn_started_at=utc_now(),
        )
        room.hangman = hm
        room.active_round = None
        room.status = "in_game"
        self._store.save_room(room)
        return hm

    def start_game(self, room_id: str, player_id: str) -> None:
        with self._lock:
            room = self.get_room(room_id)
            actor = self._find_player(room, player_id)
            if not actor.is_host:
                raise GameError("Only host can start")
            if room.status == "in_game":
                raise GameError("Round already running")
            if room.game_mode == "hangman":
                self._new_hangman_round(room)
            else:
                self._new_round(room)

    def start_next_round(self, room_id: str, player_id: str) -> None:
        with self._lock:
            room = self.get_room(room_id)
            actor = self._find_player(room, player_id)
            if not actor.is_host:
                raise GameError("Only host can start next round")
            if room.status != "round_revealed":
                raise GameError("Reveal current round first")
            if room.game_mode == "hangman":
                self._new_hangman_round(room)
            else:
                self._new_round(room)

    def _advance_turn(self, room: RoomState) -> None:
        round_state = room.active_round
        if round_state is None:
            return
        round_state.current_turn_idx = (round_state.current_turn_idx + 1) % len(room.players)
        round_state.turn_started_at = utc_now()

    def force_advance_timeout(self, room: RoomState) -> bool:
        if room.status != "in_game" or room.turn_seconds is None:
            return False
        if room.game_mode == "wordle":
            round_state = room.active_round
            if round_state is None:
                return False
            elapsed = (utc_now() - round_state.turn_started_at).total_seconds()
            if elapsed < room.turn_seconds:
                return False
            self._advance_turn(room)
            self._store.save_room(room)
            return True
        hm = room.hangman
        if hm is None:
            return False
        elapsed = (utc_now() - hm.turn_started_at).total_seconds()
        if elapsed < room.turn_seconds:
            return False
        hm.current_turn_idx = (hm.current_turn_idx + 1) % len(room.players)
        hm.turn_started_at = utc_now()
        self._store.save_room(room)
        return True

    def submit_guess(self, room_id: str, player_id: str, guess: str) -> GuessState:
        with self._lock:
            room = self.get_room(room_id)
            if room.game_mode != "wordle":
                raise GameError("This room is playing Hangman")
            if room.status != "in_game" or room.active_round is None:
                raise GameError("No active round")
            round_state = room.active_round
            guess = guess.lower().strip()
            if len(guess) != 5 or not all("a" <= c <= "z" for c in guess):
                raise GameError("Use exactly five letters A–Z")
            if not self._words.is_allowed_guess(guess):
                raise GameError("Not in word list")
            current_player = room.players[round_state.current_turn_idx]
            if current_player.id != player_id:
                raise GameError("Not your turn")
            feedback = evaluate_guess(guess, round_state.answer)
            result = GuessState(player_id=player_id, guess=guess, feedback=feedback)
            round_state.guesses.append(result)
            self._store.save_guess(room_id, round_state.round_number, result)
            if guess == round_state.answer:
                round_state.winner_id = player_id
                room.status = "round_complete"
                self._store.finish_round(room.id, round_state, "round_complete")
                winner = self._find_player(room, player_id)
                self._store.leaderboard_increment(winner.name, "wordle", wins=1)
                self._store.save_room(room)
                return result
            self._advance_turn(room)
            self._store.save_room(room)
            return result

    def reveal_and_wait_next(self, room_id: str, player_id: str) -> None:
        with self._lock:
            room = self.get_room(room_id)
            actor = self._find_player(room, player_id)
            if not actor.is_host:
                raise GameError("Only host can reveal next game")
            if room.game_mode == "hangman":
                if room.hangman is None or room.status != "round_complete":
                    raise GameError("No finished round to advance")
                room.hangman.revealed = True
                room.status = "round_revealed"
                self._store.save_room(room)
                return
            if room.active_round is None:
                raise GameError("No active round")
            room.active_round.revealed = True
            room.status = "round_revealed"
            self._store.finish_round(room.id, room.active_round, "round_revealed")
            self._store.save_room(room)

    def submit_hangman_letter(self, room_id: str, player_id: str, letter: str) -> None:
        with self._lock:
            room = self.get_room(room_id)
            if room.game_mode != "hangman":
                raise GameError("This room is playing Wordle")
            if room.status != "in_game" or room.hangman is None:
                raise GameError("No active round")
            hm = room.hangman
            current = room.players[hm.current_turn_idx]
            if current.id != player_id:
                raise GameError("Not your turn")
            letter = letter.lower().strip()
            if len(letter) != 1 or not ("a" <= letter <= "z"):
                raise GameError("Guess one letter A–Z")
            if letter in hm.guessed_letters:
                raise GameError("Letter already guessed")
            hm.guessed_letters.append(letter)
            guessed_set = set(hm.guessed_letters)
            if letter in hm.answer:
                if all(c in guessed_set for c in hm.answer):
                    room.status = "round_complete"
                    for p in room.players:
                        self._store.leaderboard_increment(p.name, "hangman", wins=1)
                    self._store.save_room(room)
                    return
            else:
                hm.wrong_letters.append(letter)
                hm.wrong_count += 1
                if hm.wrong_count >= hm.max_wrong:
                    room.status = "round_complete"
                    for p in room.players:
                        self._store.leaderboard_increment(p.name, "hangman", losses=1)
                    self._store.save_room(room)
                    return
            hm.current_turn_idx = (hm.current_turn_idx + 1) % len(room.players)
            hm.turn_started_at = utc_now()
            self._store.save_room(room)

    def all_rooms(self) -> list[RoomState]:
        with self._lock:
            return list(self._rooms.values())

    def leaderboard_snapshot(self) -> dict:
        return {
            "wordle": self._store.leaderboard_for_mode("wordle"),
            "hangman": self._store.leaderboard_for_mode("hangman"),
        }

    def serialize_room(self, room: RoomState, viewer_player_id: Optional[str] = None) -> dict:
        current_turn_player_id: Optional[str] = None
        seconds_remaining: Optional[int] = None
        active_round_payload: Optional[dict] = None
        hangman_payload: Optional[dict] = None

        if room.game_mode == "wordle":
            round_state = room.active_round
            if round_state is not None:
                current_turn_player_id = room.players[round_state.current_turn_idx].id
                if room.turn_seconds is not None and room.status == "in_game":
                    elapsed = int((utc_now() - round_state.turn_started_at).total_seconds())
                    seconds_remaining = max(room.turn_seconds - elapsed, 0)
                answer: Optional[str] = None
                if room.status == "round_revealed" or round_state.winner_id is not None:
                    answer = round_state.answer
                active_round_payload = {
                    "roundNumber": round_state.round_number,
                    "winnerId": round_state.winner_id,
                    "revealed": round_state.revealed,
                    "answer": answer,
                    "guesses": [
                        {
                            "playerId": guess.player_id,
                            "guess": guess.guess,
                            "feedback": guess.feedback,
                        }
                        for guess in round_state.guesses
                    ],
                }
        else:
            hm = room.hangman
            if hm is not None:
                current_turn_player_id = room.players[hm.current_turn_idx].id
                if room.turn_seconds is not None and room.status == "in_game":
                    elapsed = int((utc_now() - hm.turn_started_at).total_seconds())
                    seconds_remaining = max(room.turn_seconds - elapsed, 0)
                guessed_set = set(hm.guessed_letters)
                masked = " ".join(c.upper() if c in guessed_set else "_" for c in hm.answer)
                outcome: Optional[str] = None
                if room.status == "round_complete":
                    won = all(c in guessed_set for c in hm.answer)
                    outcome = "won" if won else "lost"
                show_answer = room.status in ("round_complete", "round_revealed")
                hangman_payload = {
                    "roundNumber": hm.round_number,
                    "masked": masked,
                    "guessedLetters": list(hm.guessed_letters),
                    "wrongLetters": list(hm.wrong_letters),
                    "wrongCount": hm.wrong_count,
                    "maxWrong": hm.max_wrong,
                    "outcome": outcome,
                    "answer": hm.answer.upper() if show_answer else None,
                }

        return {
            "id": room.id,
            "gameMode": room.game_mode,
            "status": room.status,
            "maxPlayers": room.max_players,
            "turnSeconds": room.turn_seconds,
            "currentTurnPlayerId": current_turn_player_id,
            "secondsRemaining": seconds_remaining,
            "players": [
                {
                    "id": player.id,
                    "name": player.name,
                    "isHost": player.is_host,
                }
                for player in room.players
            ],
            "activeRound": active_round_payload,
            "hangman": hangman_payload,
            "viewerPlayerId": viewer_player_id,
        }
