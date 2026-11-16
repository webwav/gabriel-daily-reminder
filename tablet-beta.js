// ==================== GABRIEL DAILY ALARM - LIVE TABLET BETA STUDIO ====================
// Provides:
// 1. Real hardware-proportioned Tablet Viewport on PC (iPad 1024x768, Wide 1180x820, Portrait 768x1024, Full Window)
// 2. Prev / Next Visual buttons + Day & Slot jumper + 11-Scene Complete Visual Tour
// 3. Real ticking virtual tablet clock + 5-second live slot changeover + Ring Alarm tester

const PRESETS = {
  "ipad-landscape": { label: "📱 Tablet 1024×768", w: 1024, h: 768, orient: "landscape", framed: true },
  "wide-landscape": { label: "📱 Wide 1180×820",  w: 1180, h: 820, orient: "landscape", framed: true },
  "ipad-portrait":  { label: "📱 Portrait 768×1024", w: 768, h: 1024, orient: "portrait", framed: true },
  "full-window":    { label: "🖥️ Full Screen",    w: 0,    h: 0,    orient: "full",      framed: false }
};

const DAYS_META = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" }
];

// Curated showcase covering ALL 8 illustrations, ALL 10 categories, ALL 5 sky themes, EN & ID modes
const SHOWCASE_SCENES = [
  { dayKey: "mon", hhmm: "08:05", tag: "1. Morning Breakfast (EN)",       sky: "Morning" },
  { dayKey: "tue", hhmm: "08:08", tag: "2. Zoom Live Bu Nining (ID)",     sky: "Morning" },
  { dayKey: "wed", hhmm: "07:08", tag: "3. Zoom Live Ms. Aan (Kid EN)",   sky: "Morning" },
  { dayKey: "mon", hhmm: "08:40", tag: "4. Seated Hero Stretch (Leg-Safe)", sky: "Morning" },
  { dayKey: "mon", hhmm: "09:12", tag: "5. SMM Homeschool Focus (ID)",    sky: "Morning" },
  { dayKey: "mon", hhmm: "10:15", tag: "6. Toy & Lego Story Play (EN)",   sky: "Day" },
  { dayKey: "mon", hhmm: "11:25", tag: "7. Sofa Storybook Time (EN)",     sky: "Day" },
  { dayKey: "mon", hhmm: "13:05", tag: "8. Cloud Pillow Leg Rest",        sky: "Day" },
  { dayKey: "mon", hhmm: "14:42", tag: "9. Living English Home LMS (Offline -> Dec)", sky: "Day" },
  { dayKey: "tue", hhmm: "16:12", tag: "10. Sunset Sky • Amber 4 Zoom",   sky: "Sunset" },
  { dayKey: "mon", hhmm: "18:52", tag: "11. Evening Sky • Bedtime Story", sky: "Evening" },
  { dayKey: "mon", hhmm: "20:08", tag: "12. Night Sky • Sweet Dreams",    sky: "Sleep" }
];

function shouldEnableBetaStudio() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("kiosk") === "1") return false;
  if (params.get("beta") === "1") return true;
  const isInstalledStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.navigator.standalone === true;
  if (isInstalledStandalone) return false;
  const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const isDesktopPointer = window.matchMedia("(pointer: fine)").matches && (navigator.maxTouchPoints || 0) === 0;
  return isLocalHost || isDesktopPointer;
}

function waitForAlarmApi() {
  return new Promise((resolve) => {
    const check = () => {
      if (window.__gabrielAlarmApi && window.__gabrielAlarmApi.isReady()) {
        resolve(window.__gabrielAlarmApi);
      } else {
        setTimeout(check, 40);
      }
    };
    check();
  });
}

function toMins(hhmm) {
  const [h, m] = (hhmm || "00:00").split(":").map(Number);
  return h * 60 + (m || 0);
}

function minsToHhmm(totalMins) {
  const clamped = ((totalMins % 1440) + 1440) % 1440;
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

async function bootTabletBetaStudio() {
  if (!shouldEnableBetaStudio()) return;
  const api = await waitForAlarmApi();

  const params = new URLSearchParams(window.location.search);
  const isTouchDevice = (navigator.maxTouchPoints || 0) > 0 && !["localhost", "127.0.0.1"].includes(window.location.hostname);
  let activePreset = params.get("preset") && PRESETS[params.get("preset")]
    ? params.get("preset")
    : (isTouchDevice ? "full-window" : "ipad-landscape");

  let tourMode = false; // false = Full Day/Week Schedule, true = 12-Scene Complete Visual Showcase
  let tourIndex = 0;
  let autoRingOnNext = false;

  // Tag internal kiosk layout nodes for clean responsive fidelity rules
  const kioskView = document.getElementById("kiosk-view");
  if (kioskView) {
    const grid = kioskView.querySelector(".grid");
    if (grid) grid.id = "kiosk-center-grid";
    const illustBox = kioskView.querySelector(".aspect-video");
    if (illustBox) illustBox.id = "kiosk-illust-frame";
  }

  // Wrap Kiosk, Parent & Modals inside #tablet-stage-area -> #tablet-hardware-bezel -> #tablet-screen-viewport
  const stageArea = document.createElement("div");
  stageArea.id = "tablet-stage-area";
  const bezel = document.createElement("div");
  bezel.id = "tablet-hardware-bezel";
  const viewport = document.createElement("div");
  viewport.id = "tablet-screen-viewport";

  ["kiosk-view", "parent-view", "alarm-ring-modal", "pin-modal", "edit-modal", "pwa-install-modal", "pwa-toast"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) viewport.appendChild(el);
  });
  bezel.appendChild(viewport);
  stageArea.appendChild(bezel);
  document.body.appendChild(stageArea);

  // Build Top Beta Studio Bar
  const bar = document.createElement("div");
  bar.id = "beta-studio-bar";
  bar.innerHTML = `
    <div class="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-2 text-xs">
      <!-- Left: Live Status + Tablet Hardware Frame Selector -->
      <div class="flex flex-wrap items-center gap-1.5">
        <div id="beta-live-badge" class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 font-extrabold whitespace-nowrap">
          <span id="beta-live-dot" class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span id="beta-live-clock-text">LIVE TABLET</span>
        </div>

        <div id="beta-preset-group" class="flex items-center bg-slate-800/90 p-0.5 rounded-xl border border-slate-700">
          <button data-preset="ipad-landscape" class="beta-preset-btn px-2.5 py-1 rounded-lg font-bold transition" title="Standard iPad Landscape (1024×768)">📱 Tablet 1024×768</button>
          <button data-preset="wide-landscape" class="beta-preset-btn px-2.5 py-1 rounded-lg font-bold transition" title="11-inch Wide Tablet Landscape (1180×820)">Wide 1180×820</button>
          <button data-preset="ipad-portrait" class="beta-preset-btn px-2.5 py-1 rounded-lg font-bold transition" title="Tablet Portrait (768×1024)">Portrait</button>
          <button data-preset="full-window" class="beta-preset-btn px-2.5 py-1 rounded-lg font-bold transition" title="Full Browser Window">Full</button>
        </div>

        <span id="beta-scale-readout" class="hidden xl:inline-block text-[11px] font-mono text-slate-400 px-1">1024×768</span>
      </div>

      <!-- Center Hero: Day Switcher + Prev / Slot Dropdown / NEXT VISUAL Button -->
      <div class="flex flex-wrap items-center gap-1.5">
        <button id="btn-beta-mode-toggle" class="px-2.5 py-1.5 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-400/40 text-indigo-200 font-extrabold transition" title="Switch between Full Daily Schedule and 12-Scene All Visuals Tour">
          🎨 12 Scenes Tour
        </button>

        <div id="beta-days-strip" class="hidden lg:flex items-center bg-slate-800/90 p-0.5 rounded-xl border border-slate-700"></div>

        <button id="btn-beta-prev-visual" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-600 text-white font-extrabold transition flex items-center gap-1" title="Previous Visual (Left Arrow)">
          <span>◀</span><span>Prev</span>
        </button>

        <select id="beta-slot-select" class="max-w-[230px] sm:max-w-[270px] px-2.5 py-1.5 rounded-xl bg-slate-800 border border-slate-600 text-white font-bold text-xs focus:outline-none focus:border-sky-400 cursor-pointer"></select>

        <button id="btn-beta-next-visual" class="px-4 py-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-emerald-500 hover:from-sky-400 hover:to-emerald-400 active:scale-95 text-slate-950 font-black shadow-lg shadow-emerald-500/20 transition flex items-center gap-1.5 text-xs sm:text-sm" title="Check Next Visual on Gabriel's Tablet (Right Arrow)">
          <span>Next Visual</span><span>▶</span>
        </button>
      </div>

      <!-- Right: Real Live Alarm & Clock Simulation Controls -->
      <div class="flex flex-wrap items-center gap-1.5">
        <button id="btn-beta-ring-now" class="px-2.5 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 font-extrabold transition" title="Trigger the real full-screen Alarm Chime & Kid Voice for this visual">
          🔔 Ring Alarm
        </button>

        <button id="btn-beta-5s-live" class="px-2.5 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/40 text-sky-200 font-extrabold transition" title="Set clock 5 seconds before the next slot so you watch it transition & ring live!">
          ⚡ 5s Live Rollover
        </button>

        <label class="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300 font-bold cursor-pointer" title="Automatically pop the Alarm Ring card whenever clicking Next Visual">
          <input id="chk-beta-autoring" type="checkbox" class="accent-amber-400 w-3.5 h-3.5" />
          <span>Auto-Ring</span>
        </label>

        <button id="btn-beta-live-reset" class="hidden px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold transition" title="Return to real current WIB clock">
          🔄 Real Time
        </button>

        <button id="btn-beta-install-pwa" class="px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black shadow transition flex items-center gap-1" title="Install Gabriel Daily Reminder sebagai Aplikasi di Perangkat Ini">
          <span>📲</span><span>Install App</span>
        </button>

        <button id="btn-beta-parent-toggle" class="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-bold transition" title="Quickly open/close Parent Control Dashboard during PC beta testing">
          ⚙️ Parent
        </button>

        <button id="btn-beta-minimize" class="px-2 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white font-black transition" title="Minimize Beta Bar">
          ▾
        </button>
      </div>
    </div>
  `;
  document.body.prepend(bar);

  // Floating Pill when bar is minimized
  const pill = document.createElement("div");
  pill.id = "beta-floating-pill";
  pill.innerHTML = `
    <span class="text-xs font-extrabold text-sky-300">🧪 Tablet Beta</span>
    <button id="pill-prev-btn" class="px-2 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-xs font-bold">◀</button>
    <button id="pill-next-btn" class="px-3 py-1 rounded-full bg-gradient-to-r from-sky-500 to-emerald-500 text-slate-950 text-xs font-black">Next Visual ▶</button>
    <button id="pill-expand-btn" class="px-2 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-xs font-bold" title="Show Full Beta Studio Bar">▴ Bar</button>
  `;
  document.body.appendChild(pill);

  document.body.classList.add("tablet-beta-active");

  // Render Day Pills
  const daysStrip = document.getElementById("beta-days-strip");
  DAYS_META.forEach((d) => {
    const b = document.createElement("button");
    b.dataset.day = d.key;
    b.className = "beta-day-pill px-2 py-1 rounded-lg font-extrabold text-[11px] transition text-slate-400 hover:text-white";
    b.textContent = d.label;
    b.addEventListener("click", () => {
      tourMode = false;
      const sched = api.getEffectiveDaySchedule(d.key);
      // Jump to first waking activity (skip 00:00 sleep block if there is a morning block)
      const firstWaking = sched.find((blk) => blk.category !== "SLEEP") || sched[0];
      if (firstWaking) {
        jumpToBlock(d.key, firstWaking, autoRingOnNext);
      }
    });
    daysStrip.appendChild(b);
  });

  function applyPreset(presetKey) {
    activePreset = PRESETS[presetKey] ? presetKey : "ipad-landscape";
    const p = PRESETS[activePreset];

    document.body.classList.remove(
      "tablet-beta-framed",
      "tablet-beta-fullwindow",
      "sim-orient-landscape",
      "sim-orient-portrait"
    );

    if (p.framed) {
      document.body.classList.add("tablet-beta-framed", `sim-orient-${p.orient}`);
      document.documentElement.style.setProperty("--sim-w", `${p.w}px`);
      document.documentElement.style.setProperty("--sim-h", `${p.h}px`);
    } else {
      document.body.classList.add("tablet-beta-fullwindow");
      document.documentElement.style.removeProperty("--sim-w");
      document.documentElement.style.removeProperty("--sim-h");
      document.documentElement.style.setProperty("--tablet-scale", "1");
    }

    document.querySelectorAll(".beta-preset-btn").forEach((btn) => {
      const on = btn.dataset.preset === activePreset;
      btn.className = `beta-preset-btn px-2.5 py-1 rounded-lg font-bold transition ${
        on ? "bg-sky-500 text-slate-950 shadow" : "text-slate-300 hover:text-white"
      }`;
    });

    recalcScale();
  }

  function recalcScale() {
    const p = PRESETS[activePreset];
    const readout = document.getElementById("beta-scale-readout");
    if (!p || !p.framed) {
      if (readout) readout.textContent = `${window.innerWidth}×${window.innerHeight}`;
      return;
    }
    const stageRect = stageArea.getBoundingClientRect();
    const availW = Math.max(320, (stageRect.width || window.innerWidth) - 36);
    const availH = Math.max(260, (stageRect.height || (window.innerHeight - 80)) - 28);

    // Outer bezel adds 48px width and 42px height around screen viewport
    const totalBezelW = p.w + 48;
    const totalBezelH = p.h + 42;
    const scale = Math.min(1, availW / totalBezelW, availH / totalBezelH);
    const roundedScale = Math.max(0.35, Math.floor(scale * 1000) / 1000);

    document.documentElement.style.setProperty("--tablet-scale", String(roundedScale));
    if (readout) {
      readout.textContent = `${p.w}×${p.h} (${Math.round(roundedScale * 100)}%)`;
    }
  }

  function jumpToBlock(dayKey, block, ringAlarm = false) {
    if (!api.isLocked()) {
      api.lockKiosk();
    }
    api.dismissAlarmRing();
    const startM = toMins(block.start);
    const endM = toMins(block.end);
    const dur = Math.max(1, endM - startM);
    // If ringing alarm, jump to exact start minute (00s); otherwise 5 mins into block so progress bar & live clock look natural
    const offsetMins = ringAlarm ? 0 : Math.min(5, Math.max(1, Math.floor(dur * 0.15)));
    const targetHhmm = minsToHhmm(startM + offsetMins);
    api.setVirtualClock(dayKey, targetHhmm, 0, { ringAlarm, block });
    syncBarUi();
  }

  function stepVisual(delta) {
    if (!api.isLocked()) {
      api.lockKiosk();
    }

    if (tourMode) {
      tourIndex = (tourIndex + delta + SHOWCASE_SCENES.length) % SHOWCASE_SCENES.length;
      const sc = SHOWCASE_SCENES[tourIndex];
      api.dismissAlarmRing();
      api.setVirtualClock(sc.dayKey, sc.hhmm, 0, { ringAlarm: autoRingOnNext });
      syncBarUi();
      return;
    }

    const status = api.getLiveStatus();
    const curDayKey = status.dayKey;
    const dayIdx = Math.max(0, DAYS_META.findIndex((d) => d.key === curDayKey));
    const list = api.getEffectiveDaySchedule(curDayKey);
    if (!list.length) return;

    let curSlotIdx = list.findIndex((b) => b.id === status.current?.id);
    if (curSlotIdx === -1) {
      curSlotIdx = delta > 0 ? -1 : 0;
    }

    let nextSlotIdx = curSlotIdx + delta;
    let targetDayIdx = dayIdx;
    let targetList = list;

    if (nextSlotIdx >= targetList.length) {
      targetDayIdx = (dayIdx + 1) % DAYS_META.length;
      targetList = api.getEffectiveDaySchedule(DAYS_META[targetDayIdx].key);
      // Skip 00:00 sleep stub when rolling from previous night's 20:00 sleep so we don't show two sleep screens in a row
      nextSlotIdx = targetList.length > 1 && targetList[0].category === "SLEEP" ? 1 : 0;
    } else if (nextSlotIdx < 0) {
      targetDayIdx = (dayIdx - 1 + DAYS_META.length) % DAYS_META.length;
      targetList = api.getEffectiveDaySchedule(DAYS_META[targetDayIdx].key);
      nextSlotIdx = Math.max(0, targetList.length - 1);
    }

    const targetBlock = targetList[nextSlotIdx];
    if (targetBlock) {
      jumpToBlock(DAYS_META[targetDayIdx].key, targetBlock, autoRingOnNext);
    }
  }

  function triggerFiveSecondLiveRollover() {
    if (!api.isLocked()) {
      api.lockKiosk();
    }
    api.dismissAlarmRing();
    const status = api.getLiveStatus();
    const curDayKey = status.dayKey;
    const list = api.getEffectiveDaySchedule(curDayKey);
    const curIdx = list.findIndex((b) => b.id === status.current?.id);

    // Pick next non-sleep block on today (or first waking block) so the live alarm chime triggers naturally after 5 seconds!
    let nextBlk = list.slice(Math.max(0, curIdx + 1)).find((b) => b.category !== "SLEEP");
    let targetDayKey = curDayKey;
    if (!nextBlk) {
      const nextDayIdx = (DAYS_META.findIndex((d) => d.key === curDayKey) + 1) % DAYS_META.length;
      targetDayKey = DAYS_META[nextDayIdx].key;
      nextBlk = api.getEffectiveDaySchedule(targetDayKey).find((b) => b.category !== "SLEEP");
    }
    if (!nextBlk) return;

    const oneMinBefore = toMins(nextBlk.start) - 1;
    api.setVirtualClock(targetDayKey, minsToHhmm(oneMinBefore), 55, { ringAlarm: false, armLiveTransition: true });
    syncBarUi();
  }

  let lastDropdownSig = "";

  function syncBarUi() {
    const status = api.getLiveStatus();
    document.body.classList.toggle("parent-unlocked-mode", !status.isLocked);

    // Live vs Simulated Clock Badge
    const badge = document.getElementById("beta-live-badge");
    const dot = document.getElementById("beta-live-dot");
    const clockTxt = document.getElementById("beta-live-clock-text");
    const resetBtn = document.getElementById("btn-beta-live-reset");
    const hh = String(status.now.getHours()).padStart(2, "0");
    const mm = String(status.now.getMinutes()).padStart(2, "0");
    const ss = String(status.now.getSeconds()).padStart(2, "0");
    const dayShort = (DAYS_META.find((d) => d.key === status.dayKey)?.label || "Today").toUpperCase();

    if (status.isSimulated) {
      badge.className = "flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-400/50 text-amber-200 font-extrabold whitespace-nowrap";
      dot.className = "w-2 h-2 rounded-full bg-amber-400 animate-pulse";
      clockTxt.textContent = `SIM LIVE • ${dayShort} ${hh}:${mm}:${ss}`;
      resetBtn.classList.remove("hidden");
    } else {
      badge.className = "flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 font-extrabold whitespace-nowrap";
      dot.className = "w-2 h-2 rounded-full bg-emerald-400 animate-pulse";
      clockTxt.textContent = `LIVE • ${dayShort} ${hh}:${mm}:${ss}`;
      resetBtn.classList.add("hidden");
    }

    // Tour Mode Button & Day Pills
    const modeBtn = document.getElementById("btn-beta-mode-toggle");
    if (tourMode) {
      modeBtn.className = "px-2.5 py-1.5 rounded-xl bg-indigo-500 text-white font-extrabold shadow transition";
      modeBtn.textContent = "🎨 12 Scenes ON";
      daysStrip.classList.add("opacity-40");
    } else {
      modeBtn.className = "px-2.5 py-1.5 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-400/40 text-indigo-200 font-extrabold transition";
      modeBtn.textContent = "🎨 12 Scenes Tour";
      daysStrip.classList.remove("opacity-40");
    }

    document.querySelectorAll(".beta-day-pill").forEach((pillBtn) => {
      const on = !tourMode && pillBtn.dataset.day === status.dayKey;
      pillBtn.className = `beta-day-pill px-2 py-1 rounded-lg font-extrabold text-[11px] transition ${
        on ? "bg-sky-500 text-slate-950 shadow" : "text-slate-400 hover:text-white"
      }`;
    });

    // Slot Dropdown Populate & Sync
    const selectEl = document.getElementById("beta-slot-select");
    if (tourMode) {
      const sig = "TOUR_MODE";
      if (lastDropdownSig !== sig) {
        lastDropdownSig = sig;
        selectEl.innerHTML = "";
        SHOWCASE_SCENES.forEach((sc, idx) => {
          const opt = document.createElement("option");
          opt.value = String(idx);
          opt.textContent = `Scene ${idx + 1}/${SHOWCASE_SCENES.length}: ${sc.tag}`;
          selectEl.appendChild(opt);
        });
      }
      selectEl.value = String(tourIndex);
    } else {
      const list = api.getEffectiveDaySchedule(status.dayKey);
      const sig = `${status.dayKey}::${list.map((b) => `${b.id}:${b.start}:${b.englishMode}`).join("|")}`;
      if (lastDropdownSig !== sig) {
        lastDropdownSig = sig;
        selectEl.innerHTML = "";
        list.forEach((blk, idx) => {
          const opt = document.createElement("option");
          opt.value = String(idx);
          const title = blk.englishMode ? (blk.titleEn || blk.titleId) : (blk.titleId || blk.titleEn);
          opt.textContent = `[${idx + 1}/${list.length}] ${blk.start} ${title}`;
          selectEl.appendChild(opt);
        });
      }
      const curIdx = list.findIndex((b) => b.id === status.current?.id);
      if (curIdx >= 0) selectEl.value = String(curIdx);
    }

    // Parent Button Label
    const parentBtn = document.getElementById("btn-beta-parent-toggle");
    parentBtn.textContent = status.isLocked ? "⚙️ Parent" : "🔒 Kid Screen";
  }

  // Wire Controls
  document.querySelectorAll(".beta-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
  });

  document.getElementById("btn-beta-prev-visual").addEventListener("click", () => stepVisual(-1));
  document.getElementById("btn-beta-next-visual").addEventListener("click", () => stepVisual(1));
  document.getElementById("pill-prev-btn").addEventListener("click", () => stepVisual(-1));
  document.getElementById("pill-next-btn").addEventListener("click", () => stepVisual(1));

  document.getElementById("btn-beta-mode-toggle").addEventListener("click", () => {
    tourMode = !tourMode;
    if (tourMode) {
      tourIndex = 0;
      const sc = SHOWCASE_SCENES[0];
      if (!api.isLocked()) api.lockKiosk();
      api.dismissAlarmRing();
      api.setVirtualClock(sc.dayKey, sc.hhmm, 0, { ringAlarm: autoRingOnNext });
    }
    syncBarUi();
  });

  document.getElementById("beta-slot-select").addEventListener("change", (e) => {
    const idx = Number(e.target.value);
    if (tourMode) {
      tourIndex = idx;
      const sc = SHOWCASE_SCENES[tourIndex];
      if (sc) {
        if (!api.isLocked()) api.lockKiosk();
        api.dismissAlarmRing();
        api.setVirtualClock(sc.dayKey, sc.hhmm, 0, { ringAlarm: autoRingOnNext });
      }
    } else {
      const status = api.getLiveStatus();
      const list = api.getEffectiveDaySchedule(status.dayKey);
      if (list[idx]) {
        jumpToBlock(status.dayKey, list[idx], autoRingOnNext);
      }
    }
    syncBarUi();
  });

  document.getElementById("btn-beta-ring-now").addEventListener("click", () => {
    if (!api.isLocked()) api.lockKiosk();
    api.triggerRingForCurrent();
  });

  document.getElementById("btn-beta-5s-live").addEventListener("click", triggerFiveSecondLiveRollover);

  document.getElementById("chk-beta-autoring").addEventListener("change", (e) => {
    autoRingOnNext = e.target.checked;
  });

  document.getElementById("btn-beta-live-reset").addEventListener("click", () => {
    tourMode = false;
    api.dismissAlarmRing();
    api.resetToRealClock();
    syncBarUi();
  });

  document.getElementById("btn-beta-install-pwa").addEventListener("click", () => {
    if (api.triggerInstallPwa) api.triggerInstallPwa();
  });

  document.getElementById("btn-beta-parent-toggle").addEventListener("click", () => {
    api.toggleParentView();
    syncBarUi();
  });

  document.getElementById("btn-beta-minimize").addEventListener("click", () => {
    document.body.classList.add("beta-bar-minimized");
    recalcScale();
  });

  document.getElementById("pill-expand-btn").addEventListener("click", () => {
    document.body.classList.remove("beta-bar-minimized");
    recalcScale();
  });

  // Keyboard ArrowLeft / ArrowRight convenience on PC Beta Studio
  window.addEventListener("keydown", (e) => {
    const tag = (document.activeElement?.tagName || "").toUpperCase();
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
    if (!api.isLocked()) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      stepVisual(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      stepVisual(-1);
    }
  });

  window.addEventListener("resize", recalcScale);
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => recalcScale());
    ro.observe(stageArea);
    ro.observe(bar);
  }
  applyPreset(activePreset);
  syncBarUi();
  setTimeout(recalcScale, 250);
  setInterval(syncBarUi, 400);
}

bootTabletBetaStudio();
