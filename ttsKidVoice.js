import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "data", "tts_cache");
const EDGE_TTS_BIN = path.join(__dirname, ".venv", "bin", "edge-tts");
const PREWARM_SCRIPT = path.join(__dirname, "scripts", "prewarm_kid_tts.py");
const PYTHON_BIN = path.join(__dirname, ".venv", "bin", "python3");

export const KID_EN_VOICE = "en-US-AnaNeural";
export const KID_EN_RATE = "-4%";
export const ID_VOICE = "id-ID-GadisNeural";
export const ID_RATE = "-2%";

const inFlight = new Map();

export function normalizeTtsText(raw) {
  return String(raw || "").trim().replace(/\s+/g, " ").slice(0, 600);
}

export function getVoiceSpec(lang = "en-US") {
  const isId = String(lang || "").toLowerCase().startsWith("id");
  if (isId) {
    return { voice: ID_VOICE, rate: ID_RATE };
  }
  return { voice: KID_EN_VOICE, rate: KID_EN_RATE };
}

export function getCacheFilePath(text, lang = "en-US") {
  const clean = normalizeTtsText(text);
  const { voice, rate } = getVoiceSpec(lang);
  const hash = crypto
    .createHash("sha1")
    .update(`${voice}|${rate}|${clean}`, "utf8")
    .digest("hex");
  return path.join(CACHE_DIR, `${hash}.mp3`);
}

export function synthesizeToCache(text, lang = "en-US") {
  const clean = normalizeTtsText(text);
  if (!clean) return Promise.reject(new Error("Empty text"));

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const targetPath = getCacheFilePath(clean, lang);

  if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 256) {
    return Promise.resolve(targetPath);
  }

  if (inFlight.has(targetPath)) {
    return inFlight.get(targetPath);
  }

  const { voice, rate } = getVoiceSpec(lang);
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp.mp3`;

  const job = new Promise((resolve, reject) => {
    execFile(
      EDGE_TTS_BIN,
      [
        "--voice",
        voice,
        `--rate=${rate}`,
        "--text",
        clean,
        "--write-media",
        tmpPath
      ],
      { timeout: 15000 },
      (err) => {
        if (err) {
          try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
          return reject(err);
        }
        try {
          const stat = fs.statSync(tmpPath);
          if (!stat.size) throw new Error("Empty MP3 output");
          fs.renameSync(tmpPath, targetPath);
          resolve(targetPath);
        } catch (moveErr) {
          try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
          reject(moveErr);
        }
      }
    );
  }).finally(() => {
    inFlight.delete(targetPath);
  });

  inFlight.set(targetPath, job);
  return job;
}

function streamMp3WithRange(req, res, filePath) {
  const stat = fs.statSync(filePath);
  const total = stat.size;
  const rangeHeader = req.headers.range;

  if (rangeHeader) {
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? Math.min(total - 1, parseInt(match[2], 10)) : total - 1;
      if (start >= total || start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${total}` });
        return res.end();
      }
      res.writeHead(206, {
        "Content-Type": "audio/mpeg",
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=86400"
      });
      if (req.method === "HEAD") return res.end();
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }
  }

  res.writeHead(200, {
    "Content-Type": "audio/mpeg",
    "Content-Length": total,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=86400"
  });
  if (req.method === "HEAD") return res.end();
  return fs.createReadStream(filePath).pipe(res);
}

export async function handleKidTtsRequest(req, urlObj, res) {
  const text = normalizeTtsText(urlObj.searchParams.get("text") || "");
  const lang = urlObj.searchParams.get("lang") || "en-US";
  if (!text) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: false, error: "Missing text parameter" }));
  }

  try {
    const mp3Path = await synthesizeToCache(text, lang);
    return streamMp3WithRange(req, res, mp3Path);
  } catch (err) {
    console.error("Kid TTS error:", err.message);
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

let prewarmRunning = false;
export function prewarmStateTtsAsync() {
  if (prewarmRunning || !fs.existsSync(PYTHON_BIN) || !fs.existsSync(PREWARM_SCRIPT)) return;
  prewarmRunning = true;
  execFile(PYTHON_BIN, [PREWARM_SCRIPT], { timeout: 180000 }, () => {
    prewarmRunning = false;
  });
}
