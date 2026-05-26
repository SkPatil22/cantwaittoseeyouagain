#!/usr/bin/env python3
"""
cantwaittoseeyouagain — local server.

Serves the static site and logs visits to data/visits.log as JSONL.
On first run, downloads sample landscape images to assets/ so the site works
out of the box. Replace those files with your own anytime.

Usage:
    python3 server.py                  # listen on http://0.0.0.0:8000
    python3 server.py --port 80        # custom port (sudo on Linux for <1024)
    python3 server.py --no-download    # skip asset bootstrap
    python3 server.py --setup-only     # download assets and exit
"""

import argparse
import datetime
import http.server
import json
import re
import socketserver
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
DATA = ROOT / "data"
VISITS_LOG = DATA / "visits.log"

VIDEO_EXTS = {".mp4", ".webm", ".mov"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png"}
MEDIA_EXTS = VIDEO_EXTS | IMAGE_EXTS
LANDSCAPE_RE = re.compile(r"^landscape-\d+\.[a-z0-9]+$", re.IGNORECASE)

# Curated Picsum IDs that point at landscape-style photos. If any of these
# go missing upstream you can replace the files in assets/ by hand.
LANDSCAPE_IDS = [
    1015, 1019, 1036, 1039, 1043, 1058, 1067, 1073, 110, 1025,
]

WIDTH = 1920
HEIGHT = 1080


def _download(url: str, dest: Path) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "cwtsy/1.0"})
        with urllib.request.urlopen(req, timeout=20) as resp, open(dest, "wb") as f:
            f.write(resp.read())
        return True
    except (urllib.error.URLError, TimeoutError, ssl.SSLError, OSError) as e:
        print(f"  failed: {e}", file=sys.stderr)
        return False


def bootstrap_assets() -> None:
    """Pull jpg PLACEHOLDERS so the site renders on first run.

    The slideshow is intended for video clips (.mp4/.webm/.mov). These jpgs
    are just so the demo isn't an empty page — replace them with real video
    clips as `landscape-01.mp4` … `landscape-10.mp4` (delete the .jpg once
    the .mp4 is in place). The server serves whatever's in assets/ at
    runtime via /api/media; no code edits required to swap.

    Free landscape video sources to consider:
      - pexels.com/videos (CC0, requires sign-in for download)
      - pixabay.com/videos (CC0)
      - coverr.co (free with attribution sometimes)
      - your own phone footage
    """
    ASSETS.mkdir(exist_ok=True)
    # Only fill empty slots — never overwrite anything the user has put in.
    for i, pid in enumerate(LANDSCAPE_IDS, start=1):
        slot_has_media = any(
            (ASSETS / f"landscape-{i:02d}{ext}").exists() for ext in MEDIA_EXTS
        )
        if slot_has_media:
            continue
        f = ASSETS / f"landscape-{i:02d}.jpg"
        url = f"https://picsum.photos/id/{pid}/{WIDTH}/{HEIGHT}"
        print(f"Placeholder landscape {i:02d} -> {f.name} (replace with mp4 when ready)")
        if not _download(url, f):
            print(f"  drop your own jpg/mp4 at {f}", file=sys.stderr)


def list_media() -> list[str]:
    """Return URL paths for landscape-* media files, sorted by name.

    If both an mp4 and a jpg exist for the same slot (e.g. landscape-01.mp4
    + landscape-01.jpg) we prefer the video so the user can drop in real
    footage without first deleting the placeholder.
    """
    if not ASSETS.exists():
        return []
    by_slot: dict[str, tuple[int, str]] = {}
    for f in ASSETS.iterdir():
        if not f.is_file() or not LANDSCAPE_RE.match(f.name):
            continue
        ext = f.suffix.lower()
        if ext not in MEDIA_EXTS:
            continue
        slot = f.name.rsplit(".", 1)[0]
        # Score: videos (1) outrank images (0).
        score = 1 if ext in VIDEO_EXTS else 0
        current = by_slot.get(slot)
        if current is None or score > current[0]:
            by_slot[slot] = (score, f.name)
    out = []
    for slot in sorted(by_slot.keys()):
        out.append(f"/assets/{by_slot[slot][1]}")
    return out


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _log_visit(self) -> None:
        # Behind Cloudflare Tunnel the connection comes from localhost; the
        # real visitor IP rides in CF-Connecting-IP. Fall back to X-Forwarded-
        # For (any other proxy) and finally to the raw peer address.
        xff = self.headers.get("X-Forwarded-For", "")
        xff_first = xff.split(",")[0].strip() if xff else ""
        ip = (
            self.headers.get("CF-Connecting-IP")
            or xff_first
            or self.client_address[0]
        )
        entry = {
            "ts": datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "ip": ip,
            "country": self.headers.get("CF-IPCountry", "-"),
            "ua": self.headers.get("User-Agent", "-"),
            "ref": self.headers.get("Referer", "-"),
            "path": self.path,
        }
        DATA.mkdir(exist_ok=True)
        with open(VISITS_LOG, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry) + "\n")

    def do_GET(self) -> None:
        if self.path == "/api/media":
            self._serve_media_list()
            return
        if self.path in ("/", "/index.html"):
            self._log_visit()
        super().do_GET()

    def _serve_media_list(self) -> None:
        body = json.dumps({"media": list_media()}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args) -> None:
        sys.stderr.write(
            f"[{self.log_date_time_string()}] {fmt % args}\n"
        )


class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-download", action="store_true",
                        help="skip asset bootstrap")
    parser.add_argument("--setup-only", action="store_true",
                        help="download sample assets, then exit")
    args = parser.parse_args()

    if not args.no_download:
        bootstrap_assets()
    if args.setup_only:
        return

    with ThreadingServer((args.host, args.port), Handler) as httpd:
        print(f"Serving on http://{args.host}:{args.port}")
        print(f"Visit log: {VISITS_LOG}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down.")


if __name__ == "__main__":
    main()
