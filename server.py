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

# Curated Picsum IDs that point at landscape-style photos. If any of these
# go missing upstream you can replace the files in assets/ by hand.
PUZZLE_ID = 1018  # the photo that becomes the puzzle
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
    """Download sample images if assets are missing. Idempotent."""
    ASSETS.mkdir(exist_ok=True)
    puzzle = ASSETS / "puzzle.jpg"
    if not puzzle.exists():
        url = f"https://picsum.photos/id/{PUZZLE_ID}/{WIDTH}/{HEIGHT}"
        print(f"Downloading puzzle image -> {puzzle.name}")
        if not _download(url, puzzle):
            print(f"  drop your own {WIDTH}x{HEIGHT} jpg at {puzzle}",
                  file=sys.stderr)
    for i, pid in enumerate(LANDSCAPE_IDS, start=1):
        f = ASSETS / f"landscape-{i:02d}.jpg"
        if f.exists():
            continue
        url = f"https://picsum.photos/id/{pid}/{WIDTH}/{HEIGHT}"
        print(f"Downloading landscape {i:02d} -> {f.name}")
        if not _download(url, f):
            print(f"  drop your own jpg/mp4 at {f}", file=sys.stderr)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _log_visit(self) -> None:
        entry = {
            "ts": datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "ip": self.headers.get("X-Forwarded-For", self.client_address[0]),
            "ua": self.headers.get("User-Agent", "-"),
            "ref": self.headers.get("Referer", "-"),
            "path": self.path,
        }
        DATA.mkdir(exist_ok=True)
        with open(VISITS_LOG, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry) + "\n")

    def do_GET(self) -> None:
        if self.path in ("/", "/index.html"):
            self._log_visit()
        super().do_GET()

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
