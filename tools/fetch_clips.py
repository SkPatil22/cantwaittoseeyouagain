#!/usr/bin/env python3
"""
fetch_clips.py — pull a Pexels user's liked videos into assets/.

Defaults to scraping https://www.pexels.com/@sachet-patil-2161866708/likes/
— override with --likes-from <url>. For each Pexels video ID found on the
page, the script calls the Pexels REST API to get the best mp4 download URL
and saves the file at assets/landscape-NN.mp4 (sequential, in scrape order).

You need a free Pexels API key:
  1. https://www.pexels.com/api/  →  Get Started
  2. Provide it any of these ways (no need to fiddle with shell exports):

       python3 tools/fetch_clips.py --pexels-key abc123xyz
       echo 'PEXELS_API_KEY=abc123xyz' > .env  &&  python3 tools/fetch_clips.py
       PEXELS_API_KEY=abc123xyz python3 tools/fetch_clips.py     # one-off
       # or `export PEXELS_API_KEY=abc123xyz` if your shell supports it

Flags:
  --likes-from URL       Pexels likes page to scrape
                         (default: the URL above)
  --pexels-key KEY       API key (overrides env / .env)
  --force                re-download even if a slot is already filled
  --max N                stop after N clips (default: no limit)
  --skip N               skip the first N scraped clips
  --rename               also clear any existing landscape-*.mp4 in assets/
                         before downloading (so slot numbers align with the
                         freshly-scraped order)

Disk: budget ~10–15 MB per clip at 1080p.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

DEFAULT_LIKES_URL = "https://www.pexels.com/@sachet-patil-2161866708/likes/"

TIMEOUT = 60
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
VIDEO_EXTS = (".mp4", ".webm", ".mov")
VIDEO_ID_RE = re.compile(r"/video/[a-z0-9-]+-(\d+)/?", re.IGNORECASE)


# ---------- HTTP ---------------------------------------------------------

def _open(url: str, headers: dict | None = None):
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "*/*",
        **(headers or {}),
    })
    return urllib.request.urlopen(req, timeout=TIMEOUT)


def _json(url: str, headers: dict | None = None):
    with _open(url, headers) as resp:
        return json.loads(resp.read())


def _download(url: str, dest: Path) -> int:
    tmp = dest.with_suffix(dest.suffix + ".part")
    total = 0
    with _open(url) as resp, open(tmp, "wb") as fh:
        while True:
            chunk = resp.read(64 * 1024)
            if not chunk:
                break
            fh.write(chunk)
            total += len(chunk)
    tmp.replace(dest)
    return total


# ---------- Pexels likes scraping ---------------------------------------

def scrape_pexels_likes(base_url: str) -> list[int]:
    """Walk paginated likes pages, returning video IDs in display order.

    Pexels' likes pages are listings of `/video/<slug>-<id>/` links. The
    initial HTML usually contains the first batch; later batches load via
    AJAX but the public page also supports `?page=N` query params, which
    server-renders the same chunks (used for SEO crawlers). We follow them
    until a page yields no new IDs.
    """
    base = base_url.rstrip("/") + "/"
    ids: list[int] = []
    seen: set[int] = set()
    for page in range(1, 50):
        url = base if page == 1 else f"{base}?page={page}"
        try:
            with _open(url) as resp:
                html = resp.read().decode("utf-8", errors="ignore")
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                break
            raise
        new = 0
        for m in VIDEO_ID_RE.finditer(html):
            vid = int(m.group(1))
            if vid in seen:
                continue
            seen.add(vid)
            ids.append(vid)
            new += 1
        if new == 0:
            break
        # Be polite — Pexels' rate limits the scrape endpoint less aggressively
        # than the API, but no point hammering.
    return ids


# ---------- Pexels API --------------------------------------------------

PEXELS_VIDEO_API = "https://api.pexels.com/videos/videos/{vid}"


def fetch_pexels_video_url(video_id: int, key: str) -> str:
    """Return the best mp4 download URL for a Pexels video.

    Prefer 1920x1080 hd, fall back to the largest mp4 available.
    """
    data = _json(PEXELS_VIDEO_API.format(vid=video_id),
                 headers={"Authorization": key})
    files = data.get("video_files", [])
    for vf in files:
        if (vf.get("file_type") == "video/mp4"
                and vf.get("width") == 1920
                and vf.get("quality") == "hd"):
            return vf["link"]
    mp4s = [f for f in files if f.get("file_type") == "video/mp4"]
    if mp4s:
        mp4s.sort(key=lambda f: f.get("width") or 0, reverse=True)
        return mp4s[0]["link"]
    raise RuntimeError(f"no mp4 in response for video {video_id}")


# ---------- key resolution ----------------------------------------------

def _read_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip().strip('"').strip("'")
        if k.strip():
            out[k.strip()] = v
    return out


def resolve_key(cli_value: str) -> str:
    dotenv = _read_env_file(ROOT / ".env")
    return (
        cli_value.strip()
        or dotenv.get("PEXELS_API_KEY", "").strip()
        or os.environ.get("PEXELS_API_KEY", "").strip()
    )


# ---------- driver ------------------------------------------------------

def clear_existing_clips() -> int:
    n = 0
    if not ASSETS.exists():
        return 0
    for f in ASSETS.iterdir():
        if f.is_file() and f.suffix.lower() in VIDEO_EXTS and f.name.startswith("landscape-"):
            f.unlink()
            n += 1
    return n


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Pull a Pexels user's liked videos into assets/.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("--likes-from", default=DEFAULT_LIKES_URL,
                    help="Pexels profile likes URL")
    ap.add_argument("--pexels-key", default="",
                    help="Pexels API key (overrides env / .env)")
    ap.add_argument("--force", action="store_true",
                    help="re-download even if a slot is already filled")
    ap.add_argument("--max", type=int, default=0,
                    help="stop after N clips (0 = no limit)")
    ap.add_argument("--skip", type=int, default=0,
                    help="skip the first N scraped clips")
    ap.add_argument("--rename", action="store_true",
                    help="delete existing landscape-*.mp4 first so slot "
                         "numbers match the freshly-scraped order")
    args = ap.parse_args()

    key = resolve_key(args.pexels_key)
    if not key:
        print("error: no Pexels API key found.")
        print("       sign up free at https://www.pexels.com/api/, then:")
        print("         python3 tools/fetch_clips.py --pexels-key <key>")
        print("       or `echo PEXELS_API_KEY=<key> > .env`")
        return 2

    ASSETS.mkdir(exist_ok=True)

    if args.rename:
        wiped = clear_existing_clips()
        if wiped:
            print(f"wiped {wiped} existing landscape-*.mp4 file(s)")

    print(f"scraping {args.likes_from}")
    try:
        ids = scrape_pexels_likes(args.likes_from)
    except urllib.error.HTTPError as e:
        print(f"error: scrape failed ({e.code} {e.reason})")
        return 1
    except urllib.error.URLError as e:
        print(f"error: scrape failed ({e})")
        return 1
    if not ids:
        print("error: no video IDs found on that page.")
        print("       check the URL is public and contains liked videos.")
        return 1

    if args.skip:
        ids = ids[args.skip:]
    if args.max:
        ids = ids[: args.max]

    print(f"found {len(ids)} video(s); downloading to assets/")
    ok, skipped, failed = 0, 0, []
    for i, vid in enumerate(ids, start=1):
        slot = i
        dest = ASSETS / f"landscape-{slot:02d}.mp4"
        prefix = f"slot {slot:02d} (#{vid})"
        if dest.exists() and not args.force:
            print(f"{prefix}: present, skip")
            skipped += 1
            continue
        try:
            url = fetch_pexels_video_url(vid, key)
            short = url[:78] + ("..." if len(url) > 78 else "")
            print(f"{prefix}: {short}", flush=True)
            n = _download(url, dest)
            print(f"           wrote {dest.name} ({n / 1024 / 1024:.1f} MB)")
            ok += 1
        except (urllib.error.URLError, urllib.error.HTTPError,
                ssl.SSLError, json.JSONDecodeError, RuntimeError) as e:
            print(f"           FAILED: {e}")
            failed.append((slot, vid, str(e)))

    print()
    print(f"done. {ok} downloaded, {skipped} skipped, {len(failed)} failed.")
    if failed:
        print("misses:")
        for slot, vid, why in failed:
            print(f"  slot {slot:02d}  video #{vid}  {why}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
