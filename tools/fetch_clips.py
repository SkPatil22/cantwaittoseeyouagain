#!/usr/bin/env python3
"""
fetch_clips.py — populate assets/ with 30 free-licensed landscape clips.

Sources (all free, all license-clear):
  - NASA Image & Video Library (no key required) — public domain
  - Pexels Videos (free API key required)

The Pexels key is the only setup step:
  1. Go to https://www.pexels.com/api/ and click "Get Started"
     (email/Google/etc — no payment, no card)
  2. They show you a key on the dashboard. Copy it.
  3. Export it before running:
         export PEXELS_API_KEY=<paste-the-key>
     Or put it in a .env-style file and source it.

Then:
    python3 tools/fetch_clips.py            # fill any empty slots
    python3 tools/fetch_clips.py --force    # re-download even if present
    python3 tools/fetch_clips.py --only 5,12,18

Behaviour:
  - Idempotent: skips slots already filled with any supported media file.
  - NASA queries always run (no key needed). If a NASA query returns
    nothing, the script reports it and moves on.
  - Pexels queries are skipped with a clear message if no key is set.
  - Files land at assets/landscape-NN.mp4.

Disk: budget ~200–400 MB for the full set at 1080p.
"""

from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
TIMEOUT = 60
USER_AGENT = "cwtsy-fetcher/1.0"
MEDIA_EXTS = (".mp4", ".webm", ".mov", ".jpg", ".jpeg", ".png")

# (slot, source, query) — keep the lineup matched to the spec the user gave:
# a couple NASA shots, stars (Arches-flavoured), calm ocean, mountains,
# birds, a volcano, plus a varied "you get the gist" tail.
LINEUP: list[tuple[int, str, str]] = [
    # --- NASA, public domain ---------------------------------------------
    (1,  "nasa",   "earth from space iss timelapse"),
    (2,  "nasa",   "aurora iss"),
    (3,  "nasa",   "earth at night iss"),

    # --- Night sky / stars ------------------------------------------------
    (4,  "pexels", "arches national park night sky"),
    (5,  "pexels", "milky way time lapse desert"),
    (6,  "pexels", "starry night mountain silhouette"),

    # --- Calm ocean -------------------------------------------------------
    (7,  "pexels", "calm ocean aerial drone"),
    (8,  "pexels", "tropical beach gentle waves"),
    (9,  "pexels", "ocean sunset slow motion"),
    (10, "pexels", "underwater coral reef"),

    # --- Mountains --------------------------------------------------------
    (11, "pexels", "mountain peak sunrise drone"),
    (12, "pexels", "alpine lake reflection still"),
    (13, "pexels", "snowy mountain range aerial"),
    (14, "pexels", "fog mountain valley morning"),

    # --- Birds ------------------------------------------------------------
    (15, "pexels", "flock of birds flying sky"),
    (16, "pexels", "eagle soaring slow motion"),
    (17, "pexels", "flamingos taking flight"),

    # --- Volcano ----------------------------------------------------------
    (18, "pexels", "volcano eruption lava night"),
    (19, "pexels", "lava flow close up"),
    (20, "pexels", "volcano crater smoke aerial"),

    # --- Forest / nature --------------------------------------------------
    (21, "pexels", "forest aerial fog morning"),
    (22, "pexels", "waterfall slow motion"),
    (23, "pexels", "autumn forest drone"),
    (24, "pexels", "redwood forest sunbeams"),
    (25, "pexels", "meadow wildflowers wind"),

    # --- Misc landscape ---------------------------------------------------
    (26, "pexels", "desert sand dunes wind"),
    (27, "pexels", "glacier ice calving"),
    (28, "pexels", "northern lights aurora borealis time lapse"),
    (29, "pexels", "rolling green hills countryside"),
    (30, "pexels", "thunderstorm clouds time lapse"),
]


# ---------- transport ----------------------------------------------------

def _open(url: str, headers: dict | None = None):
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        **(headers or {}),
    })
    return urllib.request.urlopen(req, timeout=TIMEOUT)


def _json(url: str, headers: dict | None = None):
    with _open(url, headers) as resp:
        return json.loads(resp.read())


def _download(url: str, dest: Path, headers: dict | None = None) -> int:
    """Stream a URL to disk, returning bytes written."""
    tmp = dest.with_suffix(dest.suffix + ".part")
    total = 0
    with _open(url, headers) as resp, open(tmp, "wb") as fh:
        while True:
            chunk = resp.read(64 * 1024)
            if not chunk:
                break
            fh.write(chunk)
            total += len(chunk)
    tmp.replace(dest)
    return total


# ---------- NASA ---------------------------------------------------------

NASA_SEARCH = "https://images-api.nasa.gov/search"
NASA_VIDEO_TAG_PREF = ("~large.mp4", "~orig.mp4", "~mobile.mp4", ".mp4")


def fetch_nasa_url(query: str) -> str:
    """Return a downloadable mp4 URL for the top relevant NASA video."""
    params = urllib.parse.urlencode({
        "q": query, "media_type": "video", "page_size": 10,
    })
    meta = _json(f"{NASA_SEARCH}?{params}")
    items = meta.get("collection", {}).get("items", [])
    if not items:
        raise RuntimeError(f"no NASA video results for '{query}'")
    last_err: Exception | None = None
    for item in items:
        href = item.get("href")
        if not href:
            continue
        try:
            files = _json(href)
        except Exception as e:
            last_err = e
            continue
        if not isinstance(files, list):
            continue
        mp4s = [u for u in files if isinstance(u, str) and u.endswith(".mp4")]
        for tag in NASA_VIDEO_TAG_PREF:
            for u in mp4s:
                if u.endswith(tag):
                    return u
    raise RuntimeError(
        f"no mp4 found in NASA results for '{query}'"
        + (f" (last error: {last_err})" if last_err else "")
    )


# ---------- Pexels -------------------------------------------------------

PEXELS_SEARCH = "https://api.pexels.com/videos/search"


def fetch_pexels_url(query: str, key: str) -> str:
    """Return a 1080p mp4 URL for the top relevant Pexels landscape video."""
    params = urllib.parse.urlencode({
        "query": query,
        "per_page": 5,
        "orientation": "landscape",
        "size": "medium",
    })
    data = _json(f"{PEXELS_SEARCH}?{params}", headers={"Authorization": key})
    videos = data.get("videos", [])
    if not videos:
        raise RuntimeError(f"no Pexels results for '{query}'")
    # First video; prefer the 1920×1080 hd mp4. Fall back to largest mp4
    # we can find.
    for vid in videos:
        files = vid.get("video_files", [])
        for vf in files:
            if (vf.get("file_type") == "video/mp4"
                    and vf.get("width") == 1920
                    and vf.get("quality") == "hd"):
                return vf["link"]
    # Fallback: largest mp4 of any size
    for vid in videos:
        mp4s = [f for f in vid.get("video_files", [])
                if f.get("file_type") == "video/mp4"]
        if not mp4s:
            continue
        mp4s.sort(key=lambda f: f.get("width") or 0, reverse=True)
        return mp4s[0]["link"]
    raise RuntimeError(f"no Pexels mp4 found for '{query}'")


# ---------- driver -------------------------------------------------------

def existing_for_slot(slot: int) -> Path | None:
    for ext in MEDIA_EXTS:
        f = ASSETS / f"landscape-{slot:02d}{ext}"
        if f.exists():
            return f
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--force", action="store_true",
                    help="re-download even if a slot is already filled")
    ap.add_argument("--only", default="",
                    help="comma-separated slot numbers to fetch (e.g. 4,7,18)")
    args = ap.parse_args()

    pexels_key = os.environ.get("PEXELS_API_KEY", "").strip()
    if not pexels_key:
        print("note: PEXELS_API_KEY not set — Pexels slots will be skipped.")
        print("      sign up at https://www.pexels.com/api/ (free, 30 sec)")
        print("      then `export PEXELS_API_KEY=<key>` and rerun.\n")

    only_set: set[int] = set()
    if args.only:
        try:
            only_set = {int(x) for x in args.only.split(",") if x.strip()}
        except ValueError:
            print("--only must be a comma-separated list of integers", file=sys.stderr)
            return 2

    ASSETS.mkdir(exist_ok=True)
    ok: list[int] = []
    skipped: list[int] = []
    failed: list[tuple[int, str]] = []

    for slot, source, query in LINEUP:
        if only_set and slot not in only_set:
            continue
        prefix = f"slot {slot:02d}"
        existing = existing_for_slot(slot)
        if existing and not args.force:
            print(f"{prefix}: present ({existing.name}), skip")
            skipped.append(slot)
            continue
        if source == "pexels" and not pexels_key:
            print(f"{prefix}: pexels '{query}' — no key, skip")
            failed.append((slot, "no PEXELS_API_KEY"))
            continue
        try:
            print(f"{prefix}: searching {source} for '{query}'...", flush=True)
            url = (fetch_nasa_url(query) if source == "nasa"
                   else fetch_pexels_url(query, pexels_key))
            dest = ASSETS / f"landscape-{slot:02d}.mp4"
            short = url[:78] + ("..." if len(url) > 78 else "")
            print(f"          downloading {short}", flush=True)
            n = _download(url, dest)
            print(f"          wrote {dest.name} ({n / 1024 / 1024:.1f} MB)")
            ok.append(slot)
        except (urllib.error.URLError, urllib.error.HTTPError,
                ssl.SSLError, json.JSONDecodeError, RuntimeError) as e:
            print(f"          FAILED: {e}")
            failed.append((slot, str(e)))

    print()
    print(f"done. {len(ok)} fetched, {len(skipped)} skipped, {len(failed)} failed.")
    if failed:
        print("missing:")
        for slot, why in failed:
            print(f"  {slot:02d}  {why}")
        print()
        print("drop your own mp4s at assets/landscape-NN.mp4 for the misses,")
        print("or re-run after setting/fixing PEXELS_API_KEY.")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
