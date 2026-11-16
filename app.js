const DAYS = [
  { key: "mon", short: "Mon", idName: "Senin", enName: "Monday" },
  { key: "tue", short: "Tue", idName: "Selasa", enName: "Tuesday" },
  { key: "wed", short: "Wed", idName: "Rabu", enName: "Wednesday" },
  { key: "thu", short: "Thu", idName: "Kamis", enName: "Thursday" },
  { key: "fri", short: "Fri", idName: "Jumat", enName: "Friday" },
  { key: "sat", short: "Sat", idName: "Sabtu", enName: "Saturday" },
  { key: "sun", short: "Sun", idName: "Minggu", enName: "Sunday" }
];

const CAT_BADGES = {
  ZOOM:    { label: "💻 LIVE ZOOM CLASS", bg: "bg-blue-600 text-white" },
  OFFLINE: { label: "🏫 LIVING ENGLISH TEBET", bg: "bg-emerald-600 text-white" },
  ENGLISH: { label: "🗣️ ENGLISH PRACTICE", bg: "bg-teal-600 text-white" },
  SMM:     { label: "📘 SMM HOMESCHOOL", bg: "bg-indigo-600 text-white" },
  TOY:     { label: "🧱 TOY & LEGO PLAY", bg: "bg-rose-500 text-white" },
  BOOK:    { label: "📚 STORYBOOK TIME", bg: "bg-amber-500 text-slate-950" },
  MOVE:    { label: "🎨 GENTLE MOVE & ART", bg: "bg-orange-500 text-white" },
  MEAL:    { label: "🍳 YUMMY MEAL TIME", bg: "bg-pink-600 text-white" },
  REST:    { label: "☁️ PILLOW LEG REST", bg: "bg-sky-600 text-white" },
  SLEEP:   { label: "🌙 SWEET DREAMS", bg: "bg-slate-800 text-amber-200" }
};

let state = null;
let hasLocalApi = false;
const LOCAL_STORAGE_KEY = "gabriel_daily_reminder_state_v1";
let deferredInstallPrompt = null;
let toastTimer = null;

function isStandalonePwa() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.navigator.standalone === true
  );
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    syncPwaInstallUi();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    syncPwaInstallUi();
    showPwaToast("✅", "Aplikasi Gabriel Daily Reminder berhasil di-install!");
  });
}
let isLocked = true;
let activeParentTab = "schedule";
let selectedDayKey = getTodayKey();
let previewOverride = null; // { dayKey, block }
let virtualClock = null; // { anchorSimMs, anchorRealMs }
let lastRungSlotSignature = null;
let ringRepeatTimer = null;
let audioCtx = null;
let wakeLockRef = null;
let editingContext = null; // { dayKey, index } or { dayKey, index: -1 }

function getTodayKey(date = new Date()) {
  const jsDay = date.getDay(); // 0=Sun..6=Sat
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][jsDay];
}

function buildDateForDayAndTime(dayKey, hhmm = "08:00", seconds = 0) {
  const realNow = new Date();
  const [h, m] = (hhmm || "08:00").split(":").map(Number);
  const targetJsDay = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(dayKey);
  if (targetJsDay === -1) {
    return new Date(realNow.getFullYear(), realNow.getMonth(), realNow.getDate(), h || 0, m || 0, seconds || 0, 0);
  }
  const curMonIdx = (realNow.getDay() + 6) % 7;
  const targetMonIdx = (targetJsDay + 6) % 7;
  const diffDays = targetMonIdx - curMonIdx;
  return new Date(realNow.getFullYear(), realNow.getMonth(), realNow.getDate() + diffDays, h || 0, m || 0, seconds || 0, 0);
}

function getEffectiveClock() {
  if (virtualClock) {
    const elapsed = Date.now() - virtualClock.anchorRealMs;
    return { now: new Date(virtualClock.anchorSimMs + elapsed), isSimulated: true };
  }
  return { now: new Date(), isSimulated: false };
}

function toMins(hhmm) {
  const [h, m] = (hhmm || "00:00").split(":").map(Number);
  return h * 60 + (m || 0);
}

function todayIsoStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------------- Web Audio Marimba Chime & Kid Voice TTS ----------------
let kidVoiceAudio = null;
let kidVoicePrimed = false;
let speechSeqId = 0;
let ringVoiceDelayTimer = null;

const SILENT_WAV_URI = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

function getKidVoiceAudio() {
  if (!kidVoiceAudio && typeof Audio !== "undefined") {
    kidVoiceAudio = new Audio();
    kidVoiceAudio.preload = "auto";
  }
  return kidVoiceAudio;
}

function ensureAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  if (!kidVoicePrimed) {
    const el = getKidVoiceAudio();
    if (el && el.paused) {
      kidVoicePrimed = true;
      const prevSrc = el.src;
      if (!prevSrc) {
        el.src = SILENT_WAV_URI;
        el.play().then(() => { el.pause(); }).catch(() => { kidVoicePrimed = false; });
      }
    }
  }
}

if (typeof window !== "undefined") {
  ["pointerdown", "touchstart", "keydown"].forEach((ev) => {
    window.addEventListener(ev, () => ensureAudio(), { once: true, passive: true });
  });
}

function playKidSparkleCue() {
  try {
    ensureAudio();
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    [783.99, 1046.5].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now + i * 0.055);
      gain.gain.setValueAtTime(0.001, now + i * 0.055);
      gain.gain.exponentialRampToValueAtTime(0.14, now + i * 0.055 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + i * 0.055 + 0.18);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + i * 0.055);
      osc.stop(now + i * 0.055 + 0.2);
    });
  } catch (_) {}
}

function playMarimbaMelody() {
  try {
    ensureAudio();
    if (!audioCtx) return;
    // Warm cheerful C-major pentatonic chime: C5, E5, G5, A5, C6
    const notes = [523.25, 659.25, 783.99, 880.0, 1046.5];
    const now = audioCtx.currentTime;
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + i * 0.16);
      gain.gain.setValueAtTime(0.001, now + i * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.28, now + i * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + i * 0.16 + 0.65);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + i * 0.16);
      osc.stop(now + i * 0.16 + 0.7);
    });
  } catch (e) {
    console.warn("Audio chime skipped:", e);
  }
}

function stopActiveSpeech() {
  speechSeqId += 1;
  try {
    if (kidVoiceAudio) {
      kidVoiceAudio.onended = null;
      kidVoiceAudio.onerror = null;
      kidVoiceAudio.pause();
    }
  } catch (_) {}
  try {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  } catch (_) {}
}

function fallbackBrowserSpeech(text, lang = "en-US") {
  try {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const isEn = lang.toLowerCase().startsWith("en");
    u.rate = isEn ? 1.0 : 0.95;
    u.pitch = isEn ? 1.48 : 1.08;
    const voices = window.speechSynthesis.getVoices();
    if (isEn) {
      const kidOrYouthVoice =
        voices.find((v) => /Junior|Ana|Maisie|Child|Kid/i.test(v.name)) ||
        voices.find((v) => /Flo|Samantha|Karen|Google US English/i.test(v.name));
      if (kidOrYouthVoice) u.voice = kidOrYouthVoice;
    } else {
      const idVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("id"));
      if (idVoice) u.voice = idVoice;
    }
    window.speechSynthesis.speak(u);
  } catch (e) {
    console.warn("Speech fallback skipped:", e);
  }
}

function sha1Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  const ml = bytes.length * 8;
  const withOne = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  withOne.set(bytes);
  withOne[bytes.length] = 0x80;
  const view = new DataView(withOne.buffer);
  view.setUint32(withOne.length - 8, Math.floor(ml / 0x100000000), false);
  view.setUint32(withOne.length - 4, ml >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Int32Array(80);

  for (let i = 0; i < withOne.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = view.getInt32(i + j * 4, false);
    for (let j = 16; j < 80; j++) {
      const n = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16];
      w[j] = (n << 1) | (n >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let j = 0; j < 80; j++) {
      let f, k;
      if (j < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (j < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[j]) | 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = temp;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  return [h0, h1, h2, h3, h4]
    .map((v) => (v >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

function getStaticTtsClipUrl(cleanText, lang = "en-US") {
  const isId = String(lang || "").toLowerCase().startsWith("id");
  const voice = isId ? "id-ID-GadisNeural" : "en-US-AnaNeural";
  const rate = isId ? "-2%" : "-4%";
  const hash = sha1Utf8(`${voice}|${rate}|${cleanText}`);
  return `./tts_cache/${hash}.mp3`;
}

function speakText(text, lang = "en-US", opts = {}) {
  const clean = String(text || "").trim().replace(/\s+/g, " ").slice(0, 600);
  if (!clean) return;

  stopActiveSpeech();
  const mySeq = speechSeqId;
  const isEn = String(lang || "en-US").toLowerCase().startsWith("en");

  if (isEn && !opts.skipSparkle) {
    playKidSparkleCue();
  } else {
    ensureAudio();
  }

  // Primary: Neural Kid Voice (en-US-AnaNeural / id-ID-GadisNeural) via local server OR pre-cached static MP3
  const audio = getKidVoiceAudio();
  if (!audio) {
    fallbackBrowserSpeech(clean, lang);
    return;
  }

  kidVoicePrimed = true;
  audio.onerror = () => {
    if (mySeq !== speechSeqId) return;
    fallbackBrowserSpeech(clean, lang);
  };
  audio.src = hasLocalApi
    ? `/api/tts?lang=${encodeURIComponent(lang)}&text=${encodeURIComponent(clean)}`
    : getStaticTtsClipUrl(clean, lang);
  const playPromise = audio.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {
      if (mySeq !== speechSeqId) return;
      fallbackBrowserSpeech(clean, lang);
    });
  }
}

// ---------------- Dynamic Class Overlay Engine ----------------
function getEffectiveDaySchedule(dayKey) {
  if (!state || !state.weeklySchedule) return [];
  let list = JSON.parse(JSON.stringify(state.weeklySchedule[dayKey] || []));
  const cfg = state.config || {};

  // 1. Daring Rutin 1B Afternoon Swap (Tue & Thu) if parent picks afternoon 16:00-17:10
  if (cfg.daringRutinSlot === "afternoon" && (dayKey === "tue" || dayKey === "thu")) {
    list = list.map((blk) => {
      if (blk.zoomKey === "daringRutin1B") {
        return {
          ...blk,
          titleId: "BELAJAR MANDIRI PAGI & BUKU CERITA",
          titleEn: "CALM MORNING STORY & PLAY",
          subtitleId: "Daring Rutin 1B pindah ke sesi sore jam 16:00 WIB",
          subtitleEn: "Morning story & Lego time (Bu Nining's Zoom is at 4:00 PM today!)",
          category: "BOOK",
          illustration: "book-reading.jpg",
          englishMode: true,
          zoomKey: null
        };
      }
      return blk;
    });
    list = list.filter((blk) => !(toMins(blk.start) >= 960 && toMins(blk.start) < 1030));
    list.push({
      id: `${dayKey}-dr-sore`,
      start: "16:00",
      end: "17:10",
      titleId: "ZOOM LIVE: DARING RUTIN 1B SORE (BU NINING)",
      titleEn: "ZOOM LIVE: DARING RUTIN 1B (BU NINING)",
      subtitleId: "Panggil Mama/Papa buka Zoom Kelas 1 Bonsai Bu Nining! Kaki disangga bantal ya",
      subtitleEn: "Call Mama/Papa for Bu Nining's 1B Bonsai Zoom! Keep feet on your cushion.",
      category: "ZOOM",
      illustration: "zoom-class.jpg",
      englishMode: false,
      legNoteId: "Sangga kaki dengan bantal empuk di bawah meja selama Zoom!",
      legNoteEn: "Keep your feet propped on your soft cushion!",
      kidPhrases: ["Selamat sore Bu Nining!", "Terima kasih Bu Guru!"],
      zoomKey: "daringRutin1B"
    });
  }

  // 2. Amber 4 Online Zoom (16:00-17:15) Day Placement
  const amberDays = Array.isArray(cfg.amber4Days) ? cfg.amber4Days : String(cfg.amber4Days || "tue").split(",");
  if (!amberDays.includes(dayKey)) {
    // Convert default Tuesday Amber 4 block into Warm Bath & Family Relax if Tuesday isn't selected
    list = list.map((blk) => {
      if (blk.zoomKey === "amber4Online") {
        if (toMins(blk.end) - toMins(blk.start) <= 15) return null;
        return {
          ...blk,
          titleId: "MANDI AIR HANGAT & SANTAI SORE",
          titleEn: "WARM BATH & COZY FAMILY TIME",
          subtitleId: "Mandi air hangat yang nyaman untuk kaki & santai sore",
          subtitleEn: "Enjoy a soothing warm bath and cozy afternoon chat!",
          category: "REST",
          illustration: "rest-recharge.jpg",
          englishMode: true,
          zoomKey: null
        };
      }
      return blk;
    }).filter(Boolean);
  } else if (!list.some((blk) => blk.zoomKey === "amber4Online" && toMins(blk.end) - toMins(blk.start) > 20)) {
    // Inject Amber 4 on selected day (e.g. Thu or Fri)
    list = list.filter((blk) => !(toMins(blk.start) >= 955 && toMins(blk.start) < 1035));
    list.push({
      id: `${dayKey}-amber4`,
      start: "16:00",
      end: "17:15",
      titleId: "ZOOM LIVE: KELAS AMBER 4 (ENGLISH)",
      titleEn: "ZOOM LIVE: AMBER 4 ENGLISH CLASS!",
      subtitleId: "Waktunya kelas online Amber 4! Panggil Mama/Papa bukakan Zoom ya",
      subtitleEn: "Smile, wave to your teacher, and speak proud English in Amber 4 Zoom!",
      category: "ZOOM",
      illustration: "zoom-class.jpg",
      englishMode: true,
      legNoteEn: "Keep your feet resting comfortably on your desk cushion!",
      kidPhrases: ["Hello Teacher!", "Can I answer, please?", "Thank you, see you next week!"],
      zoomKey: "amber4Online"
    });
  }

  // 3. Waydivers 5 Backup Online (18:15-19:00 Ms. Sarah)
  if (cfg.waydivers5Day && cfg.waydivers5Day === dayKey) {
    list = list.filter((blk) => !(toMins(blk.start) >= 1095 && toMins(blk.start) < 1140));
    list.push({
      id: `${dayKey}-wd5`,
      start: "18:15",
      end: "19:00",
      titleId: "ZOOM LIVE: LIVING ENGLISH (MS. SARAH)",
      titleEn: "ZOOM LIVE: LIVING ENGLISH (MS. SARAH)!",
      subtitleId: "Sesi sinkronus online Waydivers bersama Ms. Sarah (18:15-19:00 WIB)",
      subtitleEn: "Evening English Zoom with Ms. Sarah! Cozy voice and feet on cushion!",
      category: "ZOOM",
      illustration: "zoom-class.jpg",
      englishMode: true,
      legNoteEn: "Sit comfy with your foot pillow before bedtime wind-down!",
      kidPhrases: ["Good evening, Ms. Sarah!", "Look at my work!", "Goodnight everyone!"],
      zoomKey: "waydivers5Backup"
    });
  }

  // 4. Agama Kelas 1B Overlay
  const agama = state.agamaOptions?.[cfg.agamaChoice];
  if (agama && agama.day === dayKey) {
    const aStart = toMins(agama.start);
    list = list.filter((blk) => toMins(blk.start) !== aStart);
    list.push({
      id: `${dayKey}-agama-${cfg.agamaChoice}`,
      start: agama.start,
      end: agama.end,
      titleId: `ZOOM LIVE: ${agama.label.split("(")[0].trim().toUpperCase()}`,
      titleEn: `ZOOM LIVE: ${agama.label.split("(")[0].trim().toUpperCase()}`,
      subtitleId: "Panggil Mama/Papa untuk bukakan Zoom Kelas Agama 1B ya!",
      subtitleEn: "Call Mama/Papa to open your Class 1B Religion Zoom!",
      category: "ZOOM",
      illustration: "zoom-class.jpg",
      englishMode: false,
      legNoteId: "Duduk nyaman dengan bantal kaki selama kelas Zoom",
      kidPhrases: ["Selamat pagi/sore Bapak/Ibu Guru!", "Terima kasih!"],
      customZoomUrl: agama.url,
      customMeetingMeta: `ID: ${agama.meetingId} | Passcode: ${agama.passcode}`
    });
  }

  list.sort((a, b) => toMins(a.start) - toMins(b.start));
  return list;
}

function findActiveAndNext(dayKey, nowMinutes) {
  const list = getEffectiveDaySchedule(dayKey);
  if (!list.length) return { current: null, next: null, progressPct: 0, minsLeft: 0 };

  let currentIdx = list.findIndex((b) => nowMinutes >= toMins(b.start) && nowMinutes < toMins(b.end));
  if (currentIdx === -1) {
    // Before first morning block -> sleeping
    if (nowMinutes < toMins(list[0].start)) {
      return {
        current: {
          id: "early-sleep",
          start: "00:00",
          end: list[0].start,
          titleId: `TIDUR NYENYAK SAMPAI ${list[0].start}`,
          titleEn: `SLEEPING PEACEFULLY UNTIL ${list[0].start}`,
          subtitleId: "Masih waktunya istirahat malam sampai pagi",
          subtitleEn: "Shhh... still cozy sleep time until morning!",
          category: "SLEEP",
          illustration: "bedtime-sleep.jpg",
          englishMode: true,
          legNoteEn: "Rest well so your legs grow super strong!",
          kidPhrases: ["Sweet dreams!"]
        },
        next: list[0],
        progressPct: Math.min(100, Math.round((nowMinutes / Math.max(1, toMins(list[0].start))) * 100)),
        minsLeft: Math.max(0, toMins(list[0].start) - nowMinutes)
      };
    }
    currentIdx = list.length - 1;
  }

  const current = list[currentIdx];
  const next = list[currentIdx + 1] || getEffectiveDaySchedule(DAYS[(DAYS.findIndex((d) => d.key === dayKey) + 1) % 7].key)[0];
  const dur = Math.max(1, toMins(current.end) - toMins(current.start));
  const elapsed = Math.max(0, nowMinutes - toMins(current.start));
  const progressPct = Math.min(100, Math.round((elapsed / dur) * 100));
  const minsLeft = Math.max(0, toMins(current.end) - nowMinutes);
  return { current, next, progressPct, minsLeft };
}

// ---------------- Kiosk Sky & Display Renderer ----------------
function applySkyTheme(mins, category) {
  const el = document.getElementById("kiosk-view");
  el.classList.remove("sky-morning", "sky-day", "sky-sunset", "sky-evening", "sky-sleep");
  if (category === "SLEEP" || mins >= 20 * 60 || mins < 6 * 60 + 25) {
    el.classList.add("sky-sleep");
  } else if (mins >= 18 * 60 + 30) {
    el.classList.add("sky-evening");
  } else if (mins >= 15 * 60 + 30) {
    el.classList.add("sky-sunset");
  } else if (mins < 11 * 60) {
    el.classList.add("sky-morning");
  } else {
    el.classList.add("sky-day");
  }
}

function renderKioskTick() {
  if (!state) return;
  const { now, isSimulated } = getEffectiveClock();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  document.getElementById("kiosk-clock").textContent = previewOverride ? previewOverride.block.start : `${hh}:${mm}`;

  const dayObj = DAYS.find((d) => d.key === (previewOverride ? previewOverride.dayKey : getTodayKey(now))) || DAYS[0];
  const dateFmt = now.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  document.getElementById("kiosk-date-label").textContent = `${dayObj.enName} (${dayObj.idName}) • ${dateFmt}`;

  const simBanner = document.getElementById("kiosk-sim-banner");
  const showInternalSimBanner = (previewOverride || isSimulated) && !document.body.classList.contains("tablet-beta-active");
  if (showInternalSimBanner) {
    simBanner.classList.remove("hidden");
    simBanner.classList.add("flex");
  } else {
    simBanner.classList.add("hidden");
    simBanner.classList.remove("flex");
  }

  const nowMins = previewOverride ? toMins(previewOverride.block.start) + 5 : now.getHours() * 60 + now.getMinutes();
  const activeData = previewOverride
    ? { current: previewOverride.block, next: null, progressPct: 25, minsLeft: Math.max(5, toMins(previewOverride.block.end) - toMins(previewOverride.block.start)) }
    : findActiveAndNext(getTodayKey(now), nowMins);

  const cur = activeData.current;
  if (!cur) return;

  applySkyTheme(nowMins, cur.category);

  // Illustration
  const imgEl = document.getElementById("kiosk-illustration");
  const targetSrc = `illustrations/${cur.illustration || "morning-breakfast.jpg"}`;
  if (imgEl.getAttribute("src") !== targetSrc) imgEl.setAttribute("src", targetSrc);

  // Category & English Badges
  const badgeMeta = CAT_BADGES[cur.category] || CAT_BADGES.TOY;
  const catBadge = document.getElementById("kiosk-category-badge");
  catBadge.className = `absolute top-4 left-4 px-4 py-1.5 rounded-full font-kid font-bold text-sm md:text-base shadow-lg ${badgeMeta.bg}`;
  catBadge.textContent = badgeMeta.label;

  const engPill = document.getElementById("kiosk-english-pill");
  if (cur.englishMode && cur.category !== "SLEEP") {
    engPill.classList.remove("hidden");
  } else {
    engPill.classList.add("hidden");
  }

  document.getElementById("kiosk-slot-window").textContent = `${cur.start} - ${cur.end} WIB`;

  // Title & Subtitle in chosen language
  const useEn = Boolean(cur.englishMode);
  document.getElementById("kiosk-now-label").textContent = useEn ? "RIGHT NOW • ENGLISH TIME" : "KEGIATAN SEKARANG";
  document.getElementById("kiosk-title").textContent = useEn ? (cur.titleEn || cur.titleId) : (cur.titleId || cur.titleEn);
  document.getElementById("kiosk-subtitle").textContent = useEn ? (cur.subtitleEn || cur.subtitleId) : (cur.subtitleId || cur.subtitleEn);
  document.getElementById("kiosk-leg-note").textContent = useEn
    ? (cur.legNoteEn || cur.legNoteId || "Sit comfy and rest your legs nicely!")
    : (cur.legNoteId || cur.legNoteEn || "Duduk nyaman & jaga kaki tetap rileks ya!");

  // Zoom Kid Notice (No clickable external URL!)
  const zoomBanner = document.getElementById("kiosk-zoom-kid-banner");
  if (cur.category === "ZOOM") {
    zoomBanner.classList.remove("hidden");
  } else {
    zoomBanner.classList.add("hidden");
  }

  // Kid Starter Phrases (Tap to Hear!)
  const phrasesBox = document.getElementById("kiosk-phrases-box");
  const phrasesList = document.getElementById("kiosk-phrases-list");
  const phrases = cur.kidPhrases || [];
  if (state.config?.autoShowEnglishPhrases && phrases.length && cur.category !== "SLEEP") {
    phrasesBox.classList.remove("hidden");
    const sig = phrases.join("||") + "::" + useEn;
    if (phrasesList.dataset.sig !== sig) {
      phrasesList.dataset.sig = sig;
      phrasesList.innerHTML = "";
      phrases.forEach((p) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "px-3.5 py-2 rounded-2xl bg-emerald-50 hover:bg-emerald-100 active:scale-95 border border-emerald-300 text-emerald-950 text-sm md:text-base font-extrabold flex items-center gap-2 shadow-sm transition";
        btn.innerHTML = `<span>🔊</span><span>"${p}"</span>`;
        btn.addEventListener("click", () => speakText(p, useEn ? "en-US" : "id-ID"));
        phrasesList.appendChild(btn);
      });
    }
  } else {
    phrasesBox.classList.add("hidden");
  }

  // Progress & Next Up
  document.getElementById("kiosk-mins-left").textContent = useEn
    ? `${activeData.minsLeft} min left`
    : `${activeData.minsLeft} menit lagi`;
  document.getElementById("kiosk-progress-fill").style.width = `${activeData.progressPct}%`;

  const next = activeData.next;
  document.getElementById("kiosk-next-label").textContent = next
    ? `${next.start} - ${next.englishMode ? (next.titleEn || next.titleId) : (next.titleId || next.titleEn)}`
    : "Tomorrow Morning!";

  // Automatic Alarm Trigger on Exact Slot Transition
  if (!previewOverride) {
    const slotSig = `${getTodayKey(now)}:${cur.id}:${cur.start}`;
    if (lastRungSlotSignature === null) {
      // Initial page load: record current slot without startling unless right on the exact minute
      lastRungSlotSignature = slotSig;
      if (now.getHours() * 60 + now.getMinutes() === toMins(cur.start) && now.getSeconds() < 12 && cur.category !== "SLEEP") {
        triggerAlarmRing(cur);
      }
    } else if (lastRungSlotSignature !== slotSig) {
      lastRungSlotSignature = slotSig;
      if (cur.category !== "SLEEP") {
        triggerAlarmRing(cur);
      }
    }
  }
}

function triggerAlarmRing(block) {
  const modal = document.getElementById("alarm-ring-modal");
  const useEn = Boolean(block.englishMode);
  document.getElementById("ring-illustration").setAttribute("src", `illustrations/${block.illustration || "morning-breakfast.jpg"}`);
  document.getElementById("ring-time").textContent = `${block.start} - ${block.end} WIB`;
  document.getElementById("ring-title").textContent = useEn ? (block.titleEn || block.titleId) : (block.titleId || block.titleEn);
  document.getElementById("ring-subtitle").textContent = useEn ? (block.subtitleEn || block.subtitleId) : (block.subtitleId || block.subtitleEn);
  modal.classList.remove("hidden");

  const chimeOnce = () => {
    playMarimbaMelody();
    if (state.config?.voiceChimeEnabled) {
      clearTimeout(ringVoiceDelayTimer);
      ringVoiceDelayTimer = setTimeout(() => {
        if (useEn) {
          speakText(`Hi Gabriel! It is ${block.start}. Time for ${block.titleEn || block.titleId}. ${block.subtitleEn || ""}`, "en-US", { skipSparkle: true });
        } else {
          speakText(`Halo Gabriel! Sekarang jam ${block.start}. Waktunya ${block.titleId || block.titleEn}.`, "id-ID", { skipSparkle: true });
        }
      }, 950);
    }
  };

  chimeOnce();
  clearInterval(ringRepeatTimer);
  ringRepeatTimer = setInterval(chimeOnce, 18000);
}

function dismissAlarmRing() {
  clearInterval(ringRepeatTimer);
  ringRepeatTimer = null;
  clearTimeout(ringVoiceDelayTimer);
  ringVoiceDelayTimer = null;
  stopActiveSpeech();
  document.getElementById("alarm-ring-modal").classList.add("hidden");
}

// ---------------- Kiosk Lock & Parent Gate ----------------
async function requestScreenWakeLock() {
  try {
    if ("wakeLock" in navigator && !wakeLockRef) {
      wakeLockRef = await navigator.wakeLock.request("screen");
      wakeLockRef.addEventListener("release", () => { wakeLockRef = null; });
    }
  } catch (_) {}
}

function enterKioskLock(goFullscreen = false) {
  isLocked = true;
  document.getElementById("parent-view").classList.add("hidden");
  document.getElementById("kiosk-view").classList.remove("hidden");
  requestScreenWakeLock();
  if (goFullscreen && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
  renderKioskTick();
}

function unlockParentDashboard() {
  isLocked = false;
  document.getElementById("pin-modal").classList.add("hidden");
  document.getElementById("kiosk-view").classList.add("hidden");
  document.getElementById("parent-view").classList.remove("hidden");
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
  renderParentAll();
}

function setupHoldToUnlock() {
  const btn = document.getElementById("btn-parent-hold");
  const bar = document.getElementById("hold-progress-bar");
  let holdStart = 0;
  let rafId = null;
  const HOLD_MS = 1600;

  const cancelHold = () => {
    holdStart = 0;
    if (rafId) cancelAnimationFrame(rafId);
    bar.style.width = "0%";
  };

  const step = () => {
    if (!holdStart) return;
    const pct = Math.min(100, (( performance.now() - holdStart ) / HOLD_MS) * 100);
    bar.style.width = `${pct}%`;
    if (pct >= 100) {
      cancelHold();
      openPinModal();
    } else {
      rafId = requestAnimationFrame(step);
    }
  };

  const startHold = (e) => {
    e.preventDefault();
    ensureAudio();
    holdStart = performance.now();
    rafId = requestAnimationFrame(step);
  };

  btn.addEventListener("mousedown", startHold);
  btn.addEventListener("touchstart", startHold, { passive: false });
  ["mouseup", "mouseleave", "touchend", "touchcancel"].forEach((ev) => btn.addEventListener(ev, cancelHold));

  // Allow right-click -> Inspect on PC / localhost / Beta Studio; only suppress long-press context menu on standalone touch kiosk
  const isLocalPcHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  document.getElementById("kiosk-view").addEventListener("contextmenu", (e) => {
    const isTouchKiosk = !isLocalPcHost && !document.body.classList.contains("tablet-beta-active") && (navigator.maxTouchPoints || 0) > 0;
    if (isTouchKiosk) e.preventDefault();
  });
}

function openPinModal() {
  const modal = document.getElementById("pin-modal");
  const inp = document.getElementById("pin-input");
  document.getElementById("pin-error").classList.add("hidden");
  inp.value = "";
  modal.classList.remove("hidden");
  setTimeout(() => inp.focus(), 60);
}

// ---------------- Persistence Helper ----------------
function saveLocalSnapshot() {
  if (!state) return;
  try {
    localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify({
        pin: state.pin,
        config: state.config,
        weeklySchedule: state.weeklySchedule,
        englishPlan: state.englishPlan,
        savedAt: new Date().toISOString()
      })
    );
  } catch (_) {}
}

async function persistState() {
  const pill = document.getElementById("save-status-pill");
  if (pill) pill.textContent = "Saving...";
  saveLocalSnapshot();

  if (!hasLocalApi) {
    if (pill) pill.textContent = "✓ Saved on this device";
    return;
  }

  try {
    const res = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: state.config,
        weeklySchedule: state.weeklySchedule,
        englishPlan: state.englishPlan
      })
    });
    if (!res.ok) throw new Error("Non-200");
    if (pill) pill.textContent = "✓ Saved to localhost";
  } catch (e) {
    if (pill) pill.textContent = "✓ Saved on this device";
  }
}

// ---------------- Parent Dashboard Renderers ----------------
function renderParentAll() {
  if (!state) return;
  // Sync top controls
  document.getElementById("cfg-daring-slot").value = state.config.daringRutinSlot || "morning";
  const a4Val = Array.isArray(state.config.amber4Days) ? state.config.amber4Days.join(",") : (state.config.amber4Days || "tue");
  document.getElementById("cfg-amber4-days").value = a4Val || "off";
  document.getElementById("cfg-waydivers5-day").value = state.config.waydivers5Day || "off";
  document.getElementById("cfg-agama").value = state.config.agamaChoice || "none";
  document.getElementById("cfg-voice-chime").checked = Boolean(state.config.voiceChimeEnabled);
  document.getElementById("cfg-show-phrases").checked = Boolean(state.config.autoShowEnglishPhrases);

  const agamaMeta = state.agamaOptions?.[state.config.agamaChoice];
  document.getElementById("agama-conflict-note").textContent = agamaMeta?.note || "";
  document.getElementById("tablet-lan-url").textContent = state.tabletLanUrl || window.location.origin;

  renderDaySelector();
  renderScheduleTimeline();
  renderZoomDirectory();
  renderEnglishPlanTab();
}

function renderDaySelector() {
  const wrap = document.getElementById("day-selector");
  wrap.innerHTML = "";
  const todayK = getTodayKey();
  DAYS.forEach((d) => {
    const active = d.key === selectedDayKey;
    const btn = document.createElement("button");
    btn.className = `px-3.5 py-2 rounded-xl text-sm font-extrabold transition ${
      active ? "bg-sky-600 text-white shadow" : "text-slate-600 hover:bg-slate-100"
    }`;
    btn.textContent = `${d.idName}${d.key === todayK ? " (Today)" : ""}`;
    btn.addEventListener("click", () => {
      selectedDayKey = d.key;
      renderDaySelector();
      renderScheduleTimeline();
    });
    wrap.appendChild(btn);
  });
}

function renderScheduleTimeline() {
  const wrap = document.getElementById("schedule-list");
  wrap.innerHTML = "";
  const effectiveList = getEffectiveDaySchedule(selectedDayKey);
  const rawList = state.weeklySchedule[selectedDayKey] || [];

  effectiveList.forEach((blk) => {
    const rawIdx = rawList.findIndex((r) => r.id === blk.id);
    const zoomInfo = blk.zoomKey ? state.zoomDirectory?.[blk.zoomKey] : null;
    const zoomUrl = blk.customZoomUrl || zoomInfo?.url || "";
    const catMeta = CAT_BADGES[blk.category] || CAT_BADGES.TOY;

    const card = document.createElement("div");
    card.className = "bg-white rounded-2xl p-4 border border-slate-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4";
    card.innerHTML = `
      <div class="flex items-start gap-4 flex-1">
        <img src="illustrations/${blk.illustration || "morning-breakfast.jpg"}" alt="" class="w-24 h-16 rounded-xl object-cover border border-slate-200 shrink-0 hidden sm:block" />
        <div class="space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono font-black text-sm px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-800">${blk.start} - ${blk.end}</span>
            <span class="text-xs font-extrabold px-2.5 py-0.5 rounded-full ${catMeta.bg}">${catMeta.label}</span>
            ${blk.englishMode ? '<span class="text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">🗣️ Full English ON</span>' : '<span class="text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600">🇮🇩 Bahasa Indonesia</span>'}
          </div>
          <div class="font-kid font-bold text-lg text-slate-900">${blk.englishMode ? (blk.titleEn || blk.titleId) : (blk.titleId || blk.titleEn)}</div>
          <div class="text-xs sm:text-sm font-semibold text-slate-600">${blk.englishMode ? (blk.subtitleEn || blk.subtitleId) : (blk.subtitleId || blk.subtitleEn)}</div>
          ${zoomInfo ? `<div class="text-xs font-extrabold text-blue-700">📌 ${zoomInfo.name} • ${zoomInfo.meetingId} (Pass: ${zoomInfo.passcode})</div>` : ""}
          ${blk.customMeetingMeta ? `<div class="text-xs font-extrabold text-blue-700">📌 ${blk.customMeetingMeta}</div>` : ""}
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2 shrink-0">
        ${zoomUrl ? `<a href="${zoomUrl}" target="_blank" rel="noopener" class="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-sm">🚀 Open Link</a>` : ""}
        <button data-act="toggle-en" class="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-extrabold">
          ${blk.englishMode ? "EN → ID" : "ID → EN"}
        </button>
        <button data-act="preview" class="px-3 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 text-xs font-extrabold">
          👁️ Kid View
        </button>
        <button data-act="ring" class="px-3 py-1.5 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-extrabold">
          🔔 Ring
        </button>
        ${rawIdx !== -1 ? `<button data-act="edit" class="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-extrabold">✏️ Edit</button>` : ""}
      </div>
    `;

    card.querySelector('[data-act="toggle-en"]').addEventListener("click", () => {
      if (rawIdx !== -1) {
        rawList[rawIdx].englishMode = !rawList[rawIdx].englishMode;
        persistState();
        renderParentAll();
      }
    });
    card.querySelector('[data-act="preview"]').addEventListener("click", () => {
      const startM = toMins(blk.start);
      const dur = Math.max(1, toMins(blk.end) - startM);
      const offset = Math.min(5, Math.max(1, Math.floor(dur * 0.15)));
      const targetM = startM + offset;
      const hhmm = `${String(Math.floor(targetM / 60) % 24).padStart(2, "0")}:${String(targetM % 60).padStart(2, "0")}`;
      setVirtualLiveClock(selectedDayKey, hhmm, 0, { ringAlarm: false });
      enterKioskLock(false);
    });
    card.querySelector('[data-act="ring"]').addEventListener("click", () => {
      ensureAudio();
      enterKioskLock(false);
      setVirtualLiveClock(selectedDayKey, blk.start, 0, { ringAlarm: true });
    });
    const editBtn = card.querySelector('[data-act="edit"]');
    if (editBtn) {
      editBtn.addEventListener("click", () => openEditModal(selectedDayKey, rawIdx));
    }
    wrap.appendChild(card);
  });
}

function renderZoomDirectory() {
  const grid = document.getElementById("zoom-directory-grid");
  grid.innerHTML = "";
  Object.values(state.zoomDirectory || {}).forEach((z) => {
    const div = document.createElement("div");
    div.className = "p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col justify-between gap-2";
    div.innerHTML = `
      <div>
        <div class="font-kid font-bold text-base text-slate-900">${z.name}</div>
        <div class="text-xs font-bold text-sky-700 mt-0.5">${z.scheduleNote}</div>
        <div class="text-xs font-semibold text-slate-600 mt-1">${z.teacher} • <strong>${z.meetingId}</strong> ${z.passcode !== "-" ? `• Passcode: <strong>${z.passcode}</strong>` : ""}</div>
      </div>
      <div class="flex flex-wrap gap-2 pt-1">
        <a href="${z.url}" target="_blank" rel="noopener" class="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold">Open Zoom / Portal</a>
        ${z.telegram ? `<a href="${z.telegram}" target="_blank" rel="noopener" class="px-3 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-extrabold">Group Chat</a>` : ""}
      </div>
    `;
    grid.appendChild(div);
  });
}

// ---------------- Full English Speaking Plan Tab ----------------
function renderEnglishPlanTab() {
  const plan = state.englishPlan;
  if (!plan) return;

  // Coverage stat for today's waking non-sleep blocks
  const todayBlocks = getEffectiveDaySchedule(getTodayKey()).filter((b) => b.category !== "SLEEP");
  const enBlocks = todayBlocks.filter((b) => b.englishMode);
  const pct = todayBlocks.length ? Math.round((enBlocks.length / todayBlocks.length) * 100) : 0;
  document.getElementById("english-coverage-stat").textContent = `${pct}% (${enBlocks.length}/${todayBlocks.length})`;

  // 4 Phases Grid
  const phasesGrid = document.getElementById("english-phases-grid");
  phasesGrid.innerHTML = "";
  plan.phases.forEach((p) => {
    const isCurrent = plan.activePhase === p.id;
    const card = document.createElement("div");
    card.className = `rounded-2xl p-4 border transition flex flex-col justify-between gap-3 ${
      isCurrent ? "bg-white text-slate-900 border-white shadow-xl" : "bg-white/10 text-white border-white/25 hover:bg-white/20"
    }`;
    card.innerHTML = `
      <div class="space-y-1.5">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-black uppercase px-2.5 py-0.5 rounded-full ${isCurrent ? "bg-emerald-100 text-emerald-800" : "bg-white/20 text-white"}">${p.hoursPerDay}</span>
          ${isCurrent ? '<span class="text-xs font-black text-emerald-600">✓ ACTIVE</span>' : ""}
        </div>
        <div class="font-kid font-bold text-base leading-snug">${p.name}</div>
        <p class="text-xs font-semibold ${isCurrent ? "text-slate-600" : "text-emerald-50"}">${p.summary}</p>
      </div>
      <button class="w-full py-2 rounded-xl text-xs font-extrabold ${
        isCurrent ? "bg-emerald-600 text-white" : "bg-white text-emerald-900 hover:bg-emerald-50"
      }">
        ${isCurrent ? "Re-Apply Phase to Alarms" : "Apply This Phase"}
      </button>
    `;
    card.querySelector("button").addEventListener("click", () => applyImmersionPhase(p));
    phasesGrid.appendChild(card);
  });

  // Habits Checklist
  const todayStr = todayIsoStr();
  document.getElementById("habit-today-date").textContent = todayStr;
  const habitsWrap = document.getElementById("english-habits-list");
  habitsWrap.innerHTML = "";
  (plan.dailyHabits || []).forEach((h) => {
    const checked = (h.doneDates || []).includes(todayStr);
    const row = document.createElement("label");
    row.className = `flex items-center gap-3 p-3 rounded-2xl border cursor-pointer transition ${
      checked ? "bg-emerald-50 border-emerald-300 text-emerald-950" : "bg-slate-50 border-slate-200 text-slate-700"
    }`;
    row.innerHTML = `
      <input type="checkbox" class="w-5 h-5 accent-emerald-600" ${checked ? "checked" : ""} />
      <span class="text-sm font-bold ${checked ? "line-through opacity-80" : ""}">${h.label}</span>
    `;
    row.querySelector("input").addEventListener("change", (e) => {
      h.doneDates = h.doneDates || [];
      if (e.target.checked && !h.doneDates.includes(todayStr)) h.doneDates.push(todayStr);
      if (!e.target.checked) h.doneDates = h.doneDates.filter((d) => d !== todayStr);
      persistState();
      renderEnglishPlanTab();
    });
    habitsWrap.appendChild(row);
  });

  // Custom Bridge Phrases
  const cpWrap = document.getElementById("custom-phrases-list");
  cpWrap.innerHTML = "";
  (plan.customPhrases || []).forEach((cp, idx) => {
    const el = document.createElement("div");
    el.className = "flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2";
    el.innerHTML = `
      <div>
        <div class="text-sm font-extrabold text-slate-900">"${cp.phrase}"</div>
        ${cp.note ? `<div class="text-[11px] font-semibold text-slate-500">${cp.note}</div>` : ""}
      </div>
      <div class="flex items-center gap-1.5">
        <button data-speak class="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 text-xs font-black">🔊</button>
        <button data-del class="px-2 py-1 rounded-lg bg-rose-50 text-rose-600 text-xs font-black">✕</button>
      </div>
    `;
    el.querySelector("[data-speak]").addEventListener("click", () => speakText(cp.phrase, "en-US"));
    el.querySelector("[data-del]").addEventListener("click", () => {
      plan.customPhrases.splice(idx, 1);
      persistState();
      renderEnglishPlanTab();
    });
    cpWrap.appendChild(el);
  });

  // Situation Scripts Grid
  const scriptsGrid = document.getElementById("situation-scripts-grid");
  scriptsGrid.innerHTML = "";
  (plan.situationScripts || []).forEach((s) => {
    const card = document.createElement("div");
    card.className = "p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col justify-between gap-3";
    card.innerHTML = `
      <div class="space-y-2.5">
        <div class="flex items-center justify-between gap-2">
          <div class="font-kid font-bold text-base text-slate-900">${s.title}</div>
          <span class="text-[11px] font-black px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 whitespace-nowrap">${s.time}</span>
        </div>
        <div class="p-2.5 rounded-xl bg-white border border-slate-200 text-xs space-y-1">
          <div class="flex items-center justify-between font-black text-sky-700">
            <span>👩 Mama Models:</span>
            <button data-mama class="px-2 py-0.5 rounded bg-sky-50 hover:bg-sky-100">🔊 Hear</button>
          </div>
          <div class="font-semibold text-slate-700">"${s.parentSays}"</div>
        </div>
        <div class="p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs space-y-1">
          <div class="flex items-center justify-between font-black text-emerald-800">
            <span>👦 Gabriel Practises:</span>
            <button data-gaby class="px-2 py-0.5 rounded bg-emerald-100 hover:bg-emerald-200">🔊 Hear</button>
          </div>
          <div class="font-bold text-emerald-950">"${s.gabrielSays}"</div>
        </div>
      </div>
      <div class="text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
        🎲 <strong>2-Min Fun Game:</strong> ${s.microGame}
      </div>
    `;
    card.querySelector("[data-mama]").addEventListener("click", () => speakText(s.parentSays, "en-US"));
    card.querySelector("[data-gaby]").addEventListener("click", () => speakText(s.gabrielSays, "en-US"));
    scriptsGrid.appendChild(card);
  });

  // Notes
  const notesEl = document.getElementById("english-parent-notes");
  if (document.activeElement !== notesEl) {
    notesEl.value = plan.parentNotes || "";
  }
}

function applyImmersionPhase(phaseObj) {
  state.englishPlan.activePhase = phaseObj.id;
  const enabledSet = new Set(phaseObj.categoriesEnabled || []);
  Object.keys(state.weeklySchedule).forEach((dayK) => {
    state.weeklySchedule[dayK].forEach((blk) => {
      // Keep Indonesian Zoom classes in Indonesian unless it's SMM English / Amber 4 / Waydivers
      if (blk.category === "ZOOM") {
        blk.englishMode = ["english1B", "amber4Online", "waydivers5Backup"].includes(blk.zoomKey);
      } else if (phaseObj.id === 1) {
        // Warm-up anchors: breakfast (07:30/08:00), morning play/book (10:00-12:15), Tebet/offline
        const m = toMins(blk.start);
        blk.englishMode = blk.category === "OFFLINE" || m <= 520 || (m >= 600 && m <= 735);
      } else {
        blk.englishMode = enabledSet.has(blk.category);
      }
    });
  });
  persistState();
  renderParentAll();
}

// ---------------- Add / Edit Block Modal ----------------
function openEditModal(dayKey, index) {
  editingContext = { dayKey, index };
  const list = state.weeklySchedule[dayKey] || [];
  const blk = index >= 0 ? list[index] : {
    start: "15:00",
    end: "15:45",
    titleEn: "ENGLISH PLAY & STORY TIME!",
    titleId: "MAIN & CERITA BAHASA INGGRIS",
    subtitleEn: "Sit comfy on your cushion and speak full English!",
    category: "TOY",
    illustration: "toy-play.jpg",
    kidPhrases: ["Look what I made!", "Let's play together!"],
    englishMode: true
  };

  document.getElementById("edit-modal-heading").textContent = index >= 0 ? "Edit Alarm Block" : "Add New Alarm Block";
  document.getElementById("ed-start").value = blk.start;
  document.getElementById("ed-end").value = blk.end;
  document.getElementById("ed-title-en").value = blk.titleEn || blk.titleId || "";
  document.getElementById("ed-title-id").value = blk.titleId || blk.titleEn || "";
  document.getElementById("ed-sub").value = blk.subtitleEn || blk.subtitleId || "";
  document.getElementById("ed-cat").value = blk.category || "TOY";
  document.getElementById("ed-illust").value = blk.illustration || "toy-play.jpg";
  document.getElementById("ed-phrases").value = (blk.kidPhrases || []).join(", ");
  document.getElementById("ed-eng-mode").checked = Boolean(blk.englishMode);
  document.getElementById("btn-ed-delete").style.display = index >= 0 ? "inline-block" : "none";
  document.getElementById("edit-modal").classList.remove("hidden");
}

function saveEditModal() {
  if (!editingContext) return;
  const { dayKey, index } = editingContext;
  const list = state.weeklySchedule[dayKey] || [];
  const existing = index >= 0 ? list[index] : { id: `${dayKey}-${Date.now()}` };

  const updated = {
    ...existing,
    start: document.getElementById("ed-start").value || "09:00",
    end: document.getElementById("ed-end").value || "09:30",
    titleEn: document.getElementById("ed-title-en").value.trim() || "ACTIVITY TIME!",
    titleId: document.getElementById("ed-title-id").value.trim() || "WAKTU KEGIATAN",
    subtitleEn: document.getElementById("ed-sub").value.trim(),
    subtitleId: document.getElementById("ed-sub").value.trim(),
    category: document.getElementById("ed-cat").value,
    illustration: document.getElementById("ed-illust").value,
    kidPhrases: document.getElementById("ed-phrases").value.split(",").map((s) => s.trim()).filter(Boolean),
    englishMode: document.getElementById("ed-eng-mode").checked
  };

  if (index >= 0) list[index] = updated;
  else list.push(updated);
  list.sort((a, b) => toMins(a.start) - toMins(b.start));
  state.weeklySchedule[dayKey] = list;

  document.getElementById("edit-modal").classList.add("hidden");
  persistState();
  renderParentAll();
}

// ---------------- Event Wiring & Boot ----------------
function wireEvents() {
  setupHoldToUnlock();

  document.getElementById("btn-dismiss-alarm").addEventListener("click", dismissAlarmRing);
  document.getElementById("btn-exit-sim").addEventListener("click", () => {
    resetVirtualLiveClock();
  });

  // PIN Modal
  document.getElementById("btn-pin-cancel").addEventListener("click", () => {
    document.getElementById("pin-modal").classList.add("hidden");
  });
  const submitPin = () => {
    const val = document.getElementById("pin-input").value.trim();
    if (val === String(state?.pin || "1996")) {
      unlockParentDashboard();
    } else {
      document.getElementById("pin-error").classList.remove("hidden");
    }
  };
  document.getElementById("btn-pin-submit").addEventListener("click", submitPin);
  document.getElementById("pin-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitPin();
  });

  // Parent Navigation Tabs
  document.querySelectorAll(".parent-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeParentTab = btn.dataset.tab;
      document.querySelectorAll(".parent-tab-btn").forEach((b) => {
        const on = b.dataset.tab === activeParentTab;
        b.className = `parent-tab-btn px-4 py-2 rounded-xl text-sm font-extrabold transition ${
          on ? "bg-white text-sky-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
        }`;
      });
      document.getElementById("tab-schedule").classList.toggle("hidden", activeParentTab !== "schedule");
      document.getElementById("tab-english").classList.toggle("hidden", activeParentTab !== "english");
      document.getElementById("tab-kiosk-setup").classList.toggle("hidden", activeParentTab !== "kiosk-setup");
    });
  });

  document.getElementById("btn-relock-kiosk").addEventListener("click", () => {
    previewOverride = null;
    enterKioskLock(false);
  });
  document.getElementById("btn-enter-fullscreen-kiosk").addEventListener("click", () => {
    previewOverride = null;
    enterKioskLock(true);
  });
  document.getElementById("btn-test-current-alarm").addEventListener("click", () => {
    ensureAudio();
    const { now } = getEffectiveClock();
    const { current } = findActiveAndNext(getTodayKey(now), now.getHours() * 60 + now.getMinutes());
    if (current) {
      enterKioskLock(false);
      triggerAlarmRing(current);
    }
  });

  // Quick Config Selectors
  document.getElementById("cfg-daring-slot").addEventListener("change", (e) => {
    state.config.daringRutinSlot = e.target.value;
    persistState();
    renderParentAll();
  });
  document.getElementById("cfg-amber4-days").addEventListener("change", (e) => {
    state.config.amber4Days = e.target.value === "off" ? [] : e.target.value.split(",");
    persistState();
    renderParentAll();
  });
  document.getElementById("cfg-waydivers5-day").addEventListener("change", (e) => {
    state.config.waydivers5Day = e.target.value;
    persistState();
    renderParentAll();
  });
  document.getElementById("cfg-agama").addEventListener("change", (e) => {
    state.config.agamaChoice = e.target.value;
    persistState();
    renderParentAll();
  });
  document.getElementById("cfg-voice-chime").addEventListener("change", (e) => {
    state.config.voiceChimeEnabled = e.target.checked;
    persistState();
  });
  document.getElementById("cfg-show-phrases").addEventListener("change", (e) => {
    state.config.autoShowEnglishPhrases = e.target.checked;
    persistState();
  });

  // Add/Edit Block Modal
  document.getElementById("btn-add-block").addEventListener("click", () => openEditModal(selectedDayKey, -1));
  document.getElementById("btn-ed-cancel").addEventListener("click", () => document.getElementById("edit-modal").classList.add("hidden"));
  document.getElementById("btn-ed-save").addEventListener("click", saveEditModal);
  document.getElementById("btn-ed-delete").addEventListener("click", () => {
    if (editingContext && editingContext.index >= 0) {
      state.weeklySchedule[editingContext.dayKey].splice(editingContext.index, 1);
      document.getElementById("edit-modal").classList.add("hidden");
      persistState();
      renderParentAll();
    }
  });

  // Custom Phrase Add + Notes Save
  document.getElementById("btn-add-phrase").addEventListener("click", () => {
    const inp = document.getElementById("new-phrase-input");
    const val = inp.value.trim();
    if (!val) return;
    state.englishPlan.customPhrases = state.englishPlan.customPhrases || [];
    state.englishPlan.customPhrases.push({ phrase: val, note: "Added by Mama" });
    inp.value = "";
    persistState();
    renderEnglishPlanTab();
  });
  document.getElementById("english-parent-notes").addEventListener("blur", (e) => {
    state.englishPlan.parentNotes = e.target.value;
    persistState();
  });

  // Copy App / LAN URL
  document.getElementById("btn-copy-lan").addEventListener("click", async () => {
    const txt = document.getElementById("tablet-lan-url").textContent;
    try {
      await navigator.clipboard.writeText(txt);
      const btn = document.getElementById("btn-copy-lan");
      btn.textContent = "✓ Copied!";
      setTimeout(() => { btn.textContent = "Copy App URL"; }, 1500);
    } catch (_) {}
  });

  // PWA Install Triggers & Modal Close
  document.querySelectorAll(".pwa-install-trigger").forEach((btn) => {
    btn.addEventListener("click", () => triggerPwaInstall());
  });
  const tabInstallBtn = document.getElementById("btn-tab-install-pwa");
  if (tabInstallBtn) {
    tabInstallBtn.addEventListener("click", () => triggerPwaInstall());
  }
  const closePwaModalBtn = document.getElementById("btn-pwa-modal-close");
  if (closePwaModalBtn) {
    closePwaModalBtn.addEventListener("click", () => {
      document.getElementById("pwa-install-modal")?.classList.add("hidden");
    });
  }
  syncPwaInstallUi();

  // Support URL query ?parent=1 for instant parent preview on localhost if desired
  if (new URLSearchParams(window.location.search).get("parent") === "1") {
    unlockParentDashboard();
  }
}

function showPwaToast(icon, text) {
  const toast = document.getElementById("pwa-toast");
  if (!toast) return;
  document.getElementById("pwa-toast-icon").textContent = icon;
  document.getElementById("pwa-toast-text").textContent = text;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 4500);
}

function syncPwaInstallUi() {
  const standalone = isStandalonePwa();
  document.querySelectorAll(".pwa-install-trigger").forEach((btn) => {
    if (standalone) {
      btn.classList.add("hidden");
      btn.classList.remove("flex");
    } else {
      btn.classList.remove("hidden");
      btn.classList.add("flex");
    }
  });

  const badge = document.getElementById("pwa-status-badge");
  const tabBtn = document.getElementById("btn-tab-install-pwa");
  if (badge) {
    badge.textContent = standalone
      ? "✓ Aplikasi Sudah Terinstall (Standalone Mode)"
      : deferredInstallPrompt
        ? "📲 Siap Di-install 1-Klik di Perangkat Ini"
        : "📲 Progressive Web App (Offline-Ready)";
  }
  if (tabBtn) {
    if (standalone) {
      tabBtn.innerHTML = "<span>✅</span><span>Sudah Terinstall</span>";
      tabBtn.disabled = true;
      tabBtn.classList.add("opacity-75", "cursor-default");
    } else {
      tabBtn.innerHTML = "<span>📲</span><span>Install Aplikasi Sekarang</span>";
      tabBtn.disabled = false;
      tabBtn.classList.remove("opacity-75", "cursor-default");
    }
  }
}

function openPwaInstallGuideModal() {
  const modal = document.getElementById("pwa-install-modal");
  const body = document.getElementById("pwa-guide-body");
  if (!modal || !body) return;

  const ua = navigator.userAgent || "";
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  if (isStandalonePwa()) {
    body.innerHTML = `
      <div class="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900">
        ✅ <strong>Aplikasi sudah terinstall!</strong> Anda sedang membuka Gabriel Daily Reminder langsung sebagai aplikasi mandiri.
      </div>
    `;
  } else if (isIos) {
    body.innerHTML = `
      <div class="p-3.5 rounded-2xl bg-sky-50 border border-sky-200 text-sky-950 space-y-2">
        <div class="font-extrabold text-sky-900">🍎 Cara Install di iPad / iPhone (Safari):</div>
        <ol class="list-decimal list-inside space-y-1.5 text-xs sm:text-sm">
          <li>Pastikan halaman ini dibuka di <strong>Safari</strong>.</li>
          <li>Ketuk ikon <strong>Share / Bagikan (⬆️ kotak dengan panah ke atas)</strong> di bagian atas/bawah layar Safari.</li>
          <li>Geser ke bawah lalu pilih <strong>Add to Home Screen / Tambahkan ke Layar Utama</strong>.</li>
          <li>Ketuk <strong>Add / Tambah</strong> di pojok kanan atas — ikon <strong>Gabriel Alarm</strong> langsung muncul di Home Screen seperti aplikasi asli!</li>
        </ol>
      </div>
    `;
  } else {
    body.innerHTML = `
      <div class="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 space-y-2">
        <div class="font-extrabold text-amber-900">📲 Cara Install di Android / Chrome / Laptop:</div>
        <ol class="list-decimal list-inside space-y-1.5 text-xs sm:text-sm">
          <li>Ketuk ikon menu <strong>⋮</strong> (tiga titik di pojok kanan atas Chrome/Edge) atau ikon <strong>Install (⊕)</strong> di kolom alamat URL.</li>
          <li>Pilih <strong>Install app / Instal aplikasi</strong> atau <strong>Tambahkan ke Layar utama</strong>.</li>
          <li>Konfirmasi <strong>Install</strong> — aplikasi langsung terpasang di perangkat dan siap dibuka penuh tanpa browser!</li>
        </ol>
      </div>
    `;
  }
  modal.classList.remove("hidden");
}

async function triggerPwaInstall() {
  if (isStandalonePwa()) {
    showPwaToast("✅", "Aplikasi sudah terinstall di perangkat ini!");
    return;
  }
  if (deferredInstallPrompt) {
    try {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === "accepted") {
        deferredInstallPrompt = null;
        syncPwaInstallUi();
        showPwaToast("✅", "Gabriel Daily Reminder berhasil di-install!");
      }
      return;
    } catch (_) {}
  }
  openPwaInstallGuideModal();
}

function setVirtualLiveClock(dayKey, hhmm = "08:00", seconds = 0, opts = {}) {
  previewOverride = null;
  const simDate = buildDateForDayAndTime(dayKey, hhmm, seconds);
  virtualClock = {
    anchorSimMs: simDate.getTime(),
    anchorRealMs: Date.now()
  };
  const nowMins = simDate.getHours() * 60 + simDate.getMinutes();
  const { current } = findActiveAndNext(getTodayKey(simDate), nowMins);
  lastRungSlotSignature = current ? `${getTodayKey(simDate)}:${current.id}:${current.start}` : null;
  renderKioskTick();
  if (opts.ringAlarm && current) {
    ensureAudio();
    triggerAlarmRing(current);
  }
}

function resetVirtualLiveClock() {
  previewOverride = null;
  virtualClock = null;
  lastRungSlotSignature = null;
  renderKioskTick();
}

window.__gabrielAlarmApi = {
  isReady: () => Boolean(state),
  isLocked: () => isLocked,
  getState: () => state,
  getEffectiveDaySchedule,
  getLiveStatus: () => {
    const { now, isSimulated } = getEffectiveClock();
    const dayKey = getTodayKey(now);
    const active = findActiveAndNext(dayKey, now.getHours() * 60 + now.getMinutes());
    return {
      now,
      dayKey,
      isSimulated: Boolean(isSimulated || previewOverride),
      isLocked,
      ...active
    };
  },
  setVirtualClock: setVirtualLiveClock,
  resetToRealClock: resetVirtualLiveClock,
  triggerRingForCurrent: () => {
    ensureAudio();
    const { now } = getEffectiveClock();
    const { current } = findActiveAndNext(getTodayKey(now), now.getHours() * 60 + now.getMinutes());
    if (current) triggerAlarmRing(current);
  },
  dismissAlarmRing,
  lockKiosk: () => enterKioskLock(false),
  unlockParent: () => unlockParentDashboard(),
  toggleParentView: () => {
    if (isLocked) unlockParentDashboard();
    else enterKioskLock(false);
  },
  isStandalonePwa,
  canDirectPromptInstall: () => Boolean(deferredInstallPrompt),
  triggerInstallPwa: triggerPwaInstall
};

async function loadInitialStateDualMode() {
  const isGithubPages = window.location.hostname.endsWith("github.io");
  if (!isGithubPages) {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      const ct = res.headers.get("content-type") || "";
      if (res.ok && ct.includes("application/json")) {
        hasLocalApi = true;
        return await res.json();
      }
    } catch (_) {}
  }

  hasLocalApi = false;
  const fallbackRes = await fetch("./initial-state.json", { cache: "no-cache" });
  const baseState = await fallbackRes.json();

  try {
    const rawSaved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (rawSaved) {
      const parsed = JSON.parse(rawSaved);
      if (parsed.pin) baseState.pin = String(parsed.pin);
      if (parsed.config) baseState.config = { ...baseState.config, ...parsed.config };
      if (parsed.weeklySchedule) baseState.weeklySchedule = parsed.weeklySchedule;
      if (parsed.englishPlan) baseState.englishPlan = { ...baseState.englishPlan, ...parsed.englishPlan };
    }
  } catch (_) {}

  baseState.tabletLanUrl = window.location.origin + window.location.pathname.replace(/index\.html$/, "");
  return baseState;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const isLocalDev = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  if (isLocalDev) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js?v=2")
      .then((reg) => reg.update().catch(() => {}))
      .catch(() => {});
  });
}

async function init() {
  state = await loadInitialStateDualMode();
  const pill = document.getElementById("save-status-pill");
  if (pill && !hasLocalApi) {
    pill.textContent = "✓ Saved on this device";
  }
  wireEvents();
  registerServiceWorker();
  renderKioskTick();
  setInterval(renderKioskTick, 1000);
}

init();
