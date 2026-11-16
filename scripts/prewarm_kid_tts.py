#!/usr/bin/env python3
"""Pre-generates cached Kid Voice (en-US-AnaNeural) MP3 clips for Gabriel Daily Alarm."""
import asyncio
import hashlib
import json
import os
import re
from pathlib import Path
import edge_tts

ROOT = Path(__file__).resolve().parent.parent
STATE_FILE = ROOT / "data" / "alarm_state.json"
CACHE_DIR = ROOT / "data" / "tts_cache"

KID_EN_VOICE = "en-US-AnaNeural"
KID_EN_RATE = "-4%"
ID_VOICE = "id-ID-GadisNeural"
ID_RATE = "-2%"


def normalize_text(raw: str) -> str:
    return re.sub(r"\s+", " ", str(raw or "").strip())[:600]


def cache_path_for(text: str, voice: str = KID_EN_VOICE, rate: str = KID_EN_RATE) -> Path:
    clean = normalize_text(text)
    digest = hashlib.sha1(f"{voice}|{rate}|{clean}".encode("utf-8")).hexdigest()
    return CACHE_DIR / f"{digest}.mp3"


def collect_all_utterances() -> list[tuple[str, str, str]]:
    ordered: list[tuple[str, str, str]] = []
    seen: set[tuple[str, str, str]] = set()

    def add(txt: str, voice: str = KID_EN_VOICE, rate: str = KID_EN_RATE):
        clean = normalize_text(txt)
        key = (voice, rate, clean)
        if clean and key not in seen:
            seen.add(key)
            ordered.append(key)

    # Dynamic overlay phrases from app.js (EN)
    overlay_en = [
        "Hello Teacher!",
        "Can I answer, please?",
        "Thank you, see you next week!",
        "Good evening, Ms. Sarah!",
        "Look at my work!",
        "Goodnight everyone!",
        "Sweet dreams!",
        "I am ready!",
        "Look what I did, Mama!",
        "Can you help me, please?",
        "Look what I made!",
        "Let's play together!",
        "Hi Gabriel! It is 16:00. Time for ZOOM LIVE: AMBER 4 ENGLISH CLASS!. Smile, wave to your teacher, and speak proud English in Amber 4 Zoom!",
        "Hi Gabriel! It is 18:15. Time for ZOOM LIVE: LIVING ENGLISH (MS. SARAH)!. Evening English Zoom with Ms. Sarah! Cozy voice and feet on cushion!",
    ]
    for p in overlay_en:
        add(p, KID_EN_VOICE, KID_EN_RATE)

    # Dynamic overlay phrases from app.js (ID)
    overlay_id = [
        "Selamat sore Bu Nining!",
        "Terima kasih Bu Guru!",
        "Selamat pagi/sore Bapak/Ibu Guru!",
        "Terima kasih!",
        "Halo Gabriel! Sekarang jam 16:00. Waktunya ZOOM LIVE: DARING RUTIN 1B SORE (BU NINING).",
    ]
    for p in overlay_id:
        add(p, ID_VOICE, ID_RATE)

    if not STATE_FILE.exists():
        return ordered

    state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    weekly = state.get("weeklySchedule", {})

    # Starter phrases (both EN and ID depending on block mode, plus prewarm EN/ID cleanly)
    for day_blocks in weekly.values():
        for blk in day_blocks:
            use_en = bool(blk.get("englishMode", True))
            v = KID_EN_VOICE if use_en else ID_VOICE
            r = KID_EN_RATE if use_en else ID_RATE
            for p in blk.get("kidPhrases") or []:
                add(p, v, r)
                if not use_en:
                    add(p, KID_EN_VOICE, KID_EN_RATE)

    plan = state.get("englishPlan") or {}
    for cp in plan.get("customPhrases") or []:
        add(cp.get("phrase", ""), KID_EN_VOICE, KID_EN_RATE)
    for sc in plan.get("situationScripts") or []:
        add(sc.get("gabrielSays", ""), KID_EN_VOICE, KID_EN_RATE)
        add(sc.get("parentSays", ""), KID_EN_VOICE, KID_EN_RATE)

    # Alarm chime announcements across the week (both EN and ID in case parent toggles EN <-> ID!)
    for day_blocks in weekly.values():
        for blk in day_blocks:
            start = blk.get("start", "08:00")
            title_en = blk.get("titleEn") or blk.get("titleId") or ""
            title_id = blk.get("titleId") or blk.get("titleEn") or ""
            sub_en = blk.get("subtitleEn") or ""
            add(f"Hi Gabriel! It is {start}. Time for {title_en}. {sub_en}", KID_EN_VOICE, KID_EN_RATE)
            add(f"Halo Gabriel! Sekarang jam {start}. Waktunya {title_id}.", ID_VOICE, ID_RATE)

    return ordered


async def main():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    items = collect_all_utterances()
    missing = [(v, r, t) for (v, r, t) in items if not (cache_path_for(t, v, r).exists() and cache_path_for(t, v, r).stat().st_size > 256)]
    if not missing:
        print(f"All {len(items)} voice MP3 clips already cached.")
        return

    print(f"Pre-warming {len(missing)} / {len(items)} voice MP3 clips...")
    sem = asyncio.Semaphore(8)
    done = 0

    async def worker(voice: str, rate: str, txt: str):
        nonlocal done
        out = cache_path_for(txt, voice, rate)
        tmp = out.with_suffix(f".{os.getpid()}.tmp.mp3")
        async with sem:
            for attempt in range(2):
                try:
                    comm = edge_tts.Communicate(txt, voice, rate=rate)
                    await comm.save(str(tmp))
                    if tmp.exists() and tmp.stat().st_size > 256:
                        tmp.replace(out)
                        done += 1
                        break
                except Exception as exc:
                    if tmp.exists():
                        tmp.unlink(missing_ok=True)
                    if attempt == 1:
                        print(f"WARN failed '{txt[:40]}': {exc}")
                    else:
                        await asyncio.sleep(0.4)

    await asyncio.gather(*(worker(v, r, t) for (v, r, t) in missing))
    print(f"Finished caching {done}/{len(missing)} new voice MP3 clips (total ready: {len(list(CACHE_DIR.glob('*.mp3')))}).")


if __name__ == "__main__":
    asyncio.run(main())
