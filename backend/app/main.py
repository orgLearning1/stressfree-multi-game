from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response

from .game_engine import GameError, RoomService, SQLiteStore, WordRepository
from .models import (
    CreateRoomRequest,
    GuessRequest,
    HangmanLetterRequest,
    JoinRoomRequest,
    NextGameRequest,
    StartGameRequest,
)
from .ws_manager import WebSocketManager

# main.py lives at <project>/backend/app/main.py
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
WORDS_DIR = PROJECT_ROOT / "backend" / "words"
DB_PATH = PROJECT_ROOT / "backend" / "data" / "wordle.db"
FRONTEND_DIR = PROJECT_ROOT / "frontend"
FRONTEND_URL = "http://localhost:5173"

store = SQLiteStore(DB_PATH)
word_repo = WordRepository(WORDS_DIR / "answers.txt", WORDS_DIR / "allowed_guesses.txt")
rooms = RoomService(store, word_repo)
ws_manager = WebSocketManager()

app = FastAPI(title="Multiplayer Wordle API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_URL,
        "http://127.0.0.1:5173",
        "http://localhost:8010",
        "http://127.0.0.1:8010",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "*",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


def serialize_and_broadcast(room_id: str) -> dict:
    room = rooms.get_room(room_id)
    return rooms.serialize_room(room)


async def publish_room(room_id: str) -> None:
    payload = {"type": "room_state", "room": serialize_and_broadcast(room_id)}
    await ws_manager.broadcast(room_id, payload)


def handle_game_error(error: GameError) -> None:
    raise HTTPException(status_code=400, detail=str(error))


@app.on_event("startup")
async def startup_event() -> None:
    index_path = FRONTEND_DIR / "index.html"
    if not index_path.is_file():
        print(
            f"WARNING: Frontend not found at {index_path}. "
            f"GET / will 404 until frontend/ exists (PROJECT_ROOT={PROJECT_ROOT}).",
            flush=True,
        )
    else:
        print(f"Serving frontend from {FRONTEND_DIR}", flush=True)

    async def timer_loop() -> None:
        while True:
            await asyncio.sleep(1)
            changed_rooms: list[str] = []
            for room in rooms.all_rooms():
                if rooms.force_advance_timeout(room):
                    changed_rooms.append(room.id)
            for room_id in changed_rooms:
                await publish_room(room_id)

    asyncio.create_task(timer_loop())


@app.get("/health")
def health() -> dict:
    index_path = FRONTEND_DIR / "index.html"
    return {
        "ok": True,
        "service": "wordle-multiplayer",
        "projectRoot": str(PROJECT_ROOT),
        "frontendDir": str(FRONTEND_DIR),
        "frontendIndexExists": index_path.is_file(),
    }


@app.get("/api/wordle-ping")
def wordle_ping() -> dict:
    """Distinctive JSON so you can tell this app is bound (not some other server on the same port)."""
    return {"service": "wordle-multiplayer", "ok": True}


def _frontend_file(filename: str) -> FileResponse:
    path = FRONTEND_DIR / filename
    if not path.is_file():
        raise HTTPException(
            status_code=404,
            detail=f"Frontend file missing: {path} (PROJECT_ROOT={PROJECT_ROOT})",
        )
    return FileResponse(path)


@app.get("/")
def serve_index() -> FileResponse:
    return _frontend_file("index.html")


@app.get("/index.html")
def serve_index_explicit() -> FileResponse:
    return _frontend_file("index.html")


@app.get("/join.html")
def serve_join_html() -> FileResponse:
    return _frontend_file("join.html")


@app.get("/lobby.html")
def serve_lobby_html() -> FileResponse:
    return _frontend_file("lobby.html")


@app.get("/game.html")
def serve_game_html() -> FileResponse:
    return _frontend_file("game.html")


@app.get("/common.js")
def serve_common_js() -> FileResponse:
    return _frontend_file("common.js")


@app.get("/create.js")
def serve_create_js() -> FileResponse:
    return _frontend_file("create.js")


@app.get("/leaderboard.js")
def serve_leaderboard_js() -> FileResponse:
    return _frontend_file("leaderboard.js")


@app.get("/join.js")
def serve_join_js() -> FileResponse:
    return _frontend_file("join.js")


@app.get("/lobby.js")
def serve_lobby_js() -> FileResponse:
    return _frontend_file("lobby.js")


@app.get("/game.js")
def serve_game_js() -> FileResponse:
    return _frontend_file("game.js")


@app.get("/style.css")
def serve_style_css() -> FileResponse:
    return _frontend_file("style.css")


@app.get("/favicon.ico")
def favicon() -> Response:
    return Response(status_code=204)


@app.get("/api/leaderboard")
def leaderboard() -> dict:
    return rooms.leaderboard_snapshot()


@app.post("/api/create-room")
async def create_room(request: CreateRoomRequest) -> dict:
    try:
        room, host = rooms.create_room(
            name=request.name,
            max_players=request.max_players,
            turn_seconds=request.turn_seconds,
            game_mode=request.game_mode,
        )
    except GameError as error:
        handle_game_error(error)
    return {
        "roomId": room.id,
        "playerId": host.id,
        "shareUrl": f"/join.html?room={room.id}",
        "room": rooms.serialize_room(room, host.id),
    }


@app.post("/api/join-room")
async def join_room(request: JoinRoomRequest) -> dict:
    try:
        player = rooms.join_room(request.room_id, request.name)
        room = rooms.get_room(request.room_id)
    except GameError as error:
        handle_game_error(error)
    await publish_room(request.room_id)
    return {"roomId": request.room_id, "playerId": player.id, "room": rooms.serialize_room(room, player.id)}


@app.get("/api/room/{room_id}")
def room_state(room_id: str, player_id: Optional[str] = Query(default=None)) -> dict:
    try:
        room = rooms.get_room(room_id)
    except GameError as error:
        handle_game_error(error)
    return {"room": rooms.serialize_room(room, player_id)}


@app.post("/api/start-game")
async def start_game(request: StartGameRequest) -> dict:
    try:
        rooms.start_game(request.room_id, request.player_id)
    except GameError as error:
        handle_game_error(error)
    await publish_room(request.room_id)
    return {"ok": True}


@app.post("/api/start-next-round")
async def start_next_round(request: StartGameRequest) -> dict:
    try:
        rooms.start_next_round(request.room_id, request.player_id)
    except GameError as error:
        handle_game_error(error)
    await publish_room(request.room_id)
    return {"ok": True}


@app.post("/api/guess")
async def submit_guess(request: GuessRequest) -> dict:
    try:
        result = rooms.submit_guess(request.room_id, request.player_id, request.guess)
    except GameError as error:
        handle_game_error(error)
    await publish_room(request.room_id)
    return {"ok": True, "feedback": result.feedback}


@app.post("/api/hangman-letter")
async def hangman_letter(request: HangmanLetterRequest) -> dict:
    try:
        rooms.submit_hangman_letter(request.room_id, request.player_id, request.letter)
    except GameError as error:
        handle_game_error(error)
    await publish_room(request.room_id)
    return {"ok": True}


@app.post("/api/next-game")
async def next_game(request: NextGameRequest) -> dict:
    try:
        rooms.reveal_and_wait_next(request.room_id, request.player_id)
    except GameError as error:
        handle_game_error(error)
    await publish_room(request.room_id)
    return {"ok": True}


@app.websocket("/ws/{room_id}")
async def room_ws(websocket: WebSocket, room_id: str) -> None:
    await ws_manager.connect(room_id, websocket)
    try:
        await publish_room(room_id)
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await ws_manager.disconnect(room_id, websocket)
