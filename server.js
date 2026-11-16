import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { createInitialState, AGAMA_OPTIONS, ZOOM_DIRECTORY } from "./data/defaultState.js";
import { handleKidTtsRequest, prewarmStateTtsAsync } from "./ttsKidVoice.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8098);
const PUBLIC_DIR = path.join(__dirname, "public");
const STATE_FILE = path.join(__dirname, "data", "alarm_state.json");

function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      parsed.zoomDirectory = ZOOM_DIRECTORY;
      parsed.agamaOptions = AGAMA_OPTIONS;
      return parsed;
    }
  } catch (err) {
    console.error("Failed reading alarm_state.json, regenerating:", err.message);
  }
  const initial = createInitialState();
  saveState(initial);
  return initial;
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

let appState = loadState();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg"
};

function sendJson(res, code, payload) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) reject(new Error("Payload too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = urlObj.pathname;

  if (pathname === "/api/tts" && (req.method === "GET" || req.method === "HEAD")) {
    return handleKidTtsRequest(req, urlObj, res);
  }

  if (pathname === "/api/state" && req.method === "GET") {
    const lanIp = getLanIp();
    return sendJson(res, 200, {
      ...appState,
      serverNowIso: new Date().toISOString(),
      tabletLanUrl: `http://${lanIp}:${PORT}`
    });
  }

  if (pathname === "/api/state" && req.method === "POST") {
    try {
      const body = await readBody(req);
      if (body.config) appState.config = { ...appState.config, ...body.config };
      if (body.weeklySchedule) appState.weeklySchedule = body.weeklySchedule;
      if (body.englishPlan) appState.englishPlan = { ...appState.englishPlan, ...body.englishPlan };
      if (body.pin) appState.pin = String(body.pin);
      saveState(appState);
      prewarmStateTtsAsync();
      return sendJson(res, 200, { ok: true, state: appState });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  }

  if (pathname === "/api/reset" && req.method === "POST") {
    appState = createInitialState();
    saveState(appState);
    return sendJson(res, 200, { ok: true, state: appState });
  }

  // Serve static files from public/
  let relPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const safePath = path.normalize(path.join(PUBLIC_DIR, relPath));
  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
    const ext = path.extname(safePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".jpg" || ext === ".png" ? "public, max-age=3600" : "no-cache"
    });
    return fs.createReadStream(safePath).pipe(res);
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Gabriel Daily Alarm Beta running at http://localhost:${PORT} (Tablet Wi-Fi: http://${getLanIp()}:${PORT})`);
});
