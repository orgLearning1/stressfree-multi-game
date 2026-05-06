/** Default API port — keep in sync with Makefile `PORT`. Override with window.WORDLE_API_PORT. */
const API_PORT = String(window.WORDLE_API_PORT || "8010");
const PLAYER_STORAGE_PREFIX = "wordle_v1:player:";

function getConfiguredApiBase() {
  const explicit = window.WORDLE_API_BASE;
  if (explicit !== undefined && explicit !== null && String(explicit).trim() !== "") {
    return String(explicit).replace(/\/$/, "");
  }
  return null;
}

function isSplitUiPort() {
  const port = window.location.port;
  return port === "5173" || port === "5500";
}

function effectiveApiOrigin() {
  const configured = getConfiguredApiBase();
  if (configured) {
    return configured;
  }
  if (window.location.protocol === "file:") {
    return `http://127.0.0.1:${API_PORT}`;
  }
  if (isSplitUiPort()) {
    const host = window.location.hostname === "localhost" ? "127.0.0.1" : window.location.hostname;
    return `http://${host}:${API_PORT}`;
  }
  const host = window.location.hostname;
  const port = window.location.port;
  if (host === "0.0.0.0") {
    return `http://127.0.0.1${port ? `:${port}` : `:${API_PORT}`}`;
  }
  return window.location.origin;
}

function buildUrl(path) {
  const prefix = path.startsWith("/") ? path : `/${path}`;
  return `${effectiveApiOrigin()}${prefix}`;
}

function getWsUrl(roomId) {
  const origin = effectiveApiOrigin();
  const url = new URL(origin);
  const proto = url.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${url.host}/ws/${roomId}`;
}

/** Absolute URL to a frontend HTML file (same host as current page, or API origin if file://). */
function pageUrl(filename) {
  if (window.location.protocol === "file:") {
    return `http://127.0.0.1:${API_PORT}/${filename}`;
  }
  return `${window.location.origin}/${filename}`;
}

function shareJoinLink(roomId) {
  return `${pageUrl("join.html")}?room=${encodeURIComponent(roomId)}`;
}

function setPlayerId(roomId, playerId) {
  sessionStorage.setItem(PLAYER_STORAGE_PREFIX + roomId, playerId);
}

function getPlayerId(roomId) {
  return sessionStorage.getItem(PLAYER_STORAGE_PREFIX + roomId);
}

function getRoomIdFromQuery() {
  return new URLSearchParams(window.location.search).get("room");
}

async function api(path, method = "GET", body = null, fetchInit = {}) {
  const url = buildUrl(path);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      ...fetchInit,
    });
  } catch {
    const localHint =
      window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    throw new Error(
      localHint
        ? `Cannot reach the game API. Open http://127.0.0.1:${API_PORT}/ or run \`make backend\`.`
        : `Cannot reach the game API at ${buildUrl("")}.`,
    );
  }
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Unexpected response (${response.status}).`);
    }
  }
  if (!response.ok) {
    const detail = data.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((entry) => entry.msg || JSON.stringify(entry)).join(", ")
          : "Request failed";
    throw new Error(message);
  }
  return data;
}

function connectRoomWs(roomId, onRoomState) {
  if (window.__wordleWs) {
    window.__wordleWs.close();
  }
  const ws = new WebSocket(getWsUrl(roomId));
  window.__wordleWs = ws;
  ws.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "room_state") {
      onRoomState(payload.room);
    }
  };
  return ws;
}

async function pingBackend(statusEl) {
  if (!statusEl) return;
  try {
    const response = await fetch(buildUrl("/health"));
    const data = JSON.parse(await response.text());
    if (!response.ok || data.service !== "wordle-multiplayer") {
      throw new Error("wrong service");
    }
    statusEl.textContent = "";
    statusEl.hidden = true;
    statusEl.removeAttribute("data-tone");
  } catch {
    statusEl.textContent = `No server on port ${API_PORT} — run make backend`;
    statusEl.hidden = false;
    statusEl.setAttribute("data-tone", "error");
  }
}
