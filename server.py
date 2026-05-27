#!/usr/bin/env python3
"""
cantwaittoseeyouagain — local server.

Serves the static site and logs visits to data/visits.log as JSONL.
The slideshow is video-only — drop landscape-NN.mp4/.webm/.mov files
into assets/ (use tools/fetch_clips.py to pull from your Pexels likes).

Usage:
    python3 server.py                  # listen on http://0.0.0.0:8000
    python3 server.py --port 80        # custom port (sudo on Linux for <1024)
    python3 server.py --host 127.0.0.1 # bind to loopback (for tunnels)
"""

import argparse
import datetime
import http.server
import json
import socketserver
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
DATA = ROOT / "data"
VISITS_LOG = DATA / "visits.log"

# Video-only. Drop images and the page just has nothing for that slot.
VIDEO_EXTS = {".mp4", ".webm", ".mov"}

def list_media() -> list[str]:
    """Return URL paths for every video file in assets/, sorted by name.

    Any filename works — names don't have to match a special pattern.
    Hidden files (.DS_Store etc.) and non-video extensions are skipped.
    """
    if not ASSETS.exists():
        return []
    out: list[str] = []
    for f in sorted(ASSETS.iterdir()):
        if not f.is_file() or f.name.startswith("."):
            continue
        if f.suffix.lower() not in VIDEO_EXTS:
            continue
        # Percent-encode so filenames with spaces / special chars work
        # whether the client decides to encode on its own or not.
        out.append(f"/assets/{urllib.parse.quote(f.name)}")
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
    args = parser.parse_args()

    with ThreadingServer((args.host, args.port), Handler) as httpd:
        n = len(list_media())
        print(f"Serving on http://{args.host}:{args.port}  ({n} clip{'s' if n != 1 else ''} in assets/)")
        if n == 0:
            print("  (no clips yet — run `python3 tools/fetch_clips.py --pexels-key <key>`)")
        print(f"Visit log: {VISITS_LOG}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down.")


if __name__ == "__main__":
    main()
