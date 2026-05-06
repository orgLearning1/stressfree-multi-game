from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


GameMode = Literal["wordle", "hangman"]


class CreateRoomRequest(BaseModel):
    name: str = Field(min_length=1, max_length=24)
    max_players: int = Field(ge=1, le=8)
    turn_seconds: Optional[int] = Field(default=None, ge=10, le=300)
    game_mode: GameMode = "wordle"


class JoinRoomRequest(BaseModel):
    room_id: str = Field(min_length=6, max_length=12)
    name: str = Field(min_length=1, max_length=24)


class StartGameRequest(BaseModel):
    room_id: str
    player_id: str


class GuessRequest(BaseModel):
    room_id: str
    player_id: str
    guess: str = Field(min_length=5, max_length=5)


class HangmanLetterRequest(BaseModel):
    room_id: str
    player_id: str
    letter: str = Field(min_length=1, max_length=1)


class NextGameRequest(BaseModel):
    room_id: str
    player_id: str


class LobbyChatRequest(BaseModel):
    room_id: str
    player_id: str
    text: str = Field(min_length=1, max_length=280)


@dataclass
class LobbyChatMessage:
    id: str
    player_id: str
    name: str
    text: str
    created_at: datetime = field(default_factory=utc_now)


@dataclass
class PlayerState:
    id: str
    name: str
    is_host: bool
    joined_at: datetime = field(default_factory=utc_now)


@dataclass
class GuessState:
    player_id: str
    guess: str
    feedback: list[str]
    created_at: datetime = field(default_factory=utc_now)


@dataclass
class RoundState:
    answer: str
    round_number: int
    current_turn_idx: int
    turn_started_at: datetime = field(default_factory=utc_now)
    winner_id: Optional[str] = None
    revealed: bool = False
    guesses: list[GuessState] = field(default_factory=list)


@dataclass
class HangmanRoundState:
    answer: str
    round_number: int
    guessed_letters: list[str] = field(default_factory=list)
    wrong_letters: list[str] = field(default_factory=list)
    wrong_count: int = 0
    max_wrong: int = 6
    current_turn_idx: int = 0
    turn_started_at: datetime = field(default_factory=utc_now)
    revealed: bool = False


@dataclass
class RoomState:
    id: str
    host_id: str
    max_players: int
    turn_seconds: Optional[int]
    game_mode: str = "wordle"
    players: list[PlayerState] = field(default_factory=list)
    status: str = "lobby"
    active_round: Optional[RoundState] = None
    hangman: Optional[HangmanRoundState] = None
    lobby_chat: list[LobbyChatMessage] = field(default_factory=list)
    created_at: datetime = field(default_factory=utc_now)
