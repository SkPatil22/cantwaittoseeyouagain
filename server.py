#!/usr/bin/env python3
"""
server.py - preview the site on your own machine (or host it yourself).

    python server.py                 # http://localhost:8000
    python server.py --port 8080

It serves ONLY the  site/  folder - nothing else in this repo is reachable -
and, unlike Python's built-in http.server, it supports HTTP Range requests,
which browsers (Safari/iPhone especially) need to play video.

It also prints an address you can open on your phone (same Wi-Fi), and appends
one line per page view to data/visits.log. (Free hosts like Cloudflare Pages
have no server, so use their built-in analytics there - see DEPLOY.md.)

Publishing is a different job: you don't need this server for that.
"""

import argparse
import datetime
import http.server
import json
import mimetypes
import os
import re
import socket
import socketserver
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITE = ROOT / "site"
DATA = ROOT / "data"
VISITS_LOG = DATA / "visits.log"

for ext, mime in {".webm": "video/webm", ".mp4": "video/mp4", ".woff2": "font/woff2",
                  ".svg": "image/svg+xml", ".json": "application/json",
                  ".js": "text/javascript", ".mjs": "text/javascript"}.items():
    mimetypes.add_type(mime, ext)

CACHE_CONTROL = "no-cache"           # local preview: always revalidate (see --cache)


class Handler(http.server.SimpleHTTPRequestHandler):
    _range = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE), **kwargs)

    # -- headers ---------------------------------------------------------
    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", CACHE_CONTROL)
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    # -- Range support (206 Partial Content) ---------------------------------
    def send_head(self):
        self._range = None
        header = self.headers.get("Range")
        path = self.translate_path(self.path)
        m = re.fullmatch(r"bytes=(\d*)-(\d*)", header.strip()) if header else None
        if not m or (not m.group(1) and not m.group(2)) or not os.path.isfile(path):
            return super().send_head()

        size = os.path.getsize(path)
        first, last = m.group(1), m.group(2)
        if first == "":                                   # "the last N bytes"
            start, end = max(0, size - int(last)), size - 1
        else:
            start, end = int(first), (int(last) if last else size - 1)
        if start >= size or start > end:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        end = min(end, size - 1)

        f = open(path, "rb")
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Last-Modified", self.date_time_string(os.fstat(f.fileno()).st_mtime))
        self.end_headers()
        self._range = (start, end)
        f.seek(start)
        return f

    def copyfile(self, source, outputfile):
        try:
            if self._range:
                remaining = self._range[1] - self._range[0] + 1
                while remaining > 0:
                    chunk = source.read(min(64 * 1024, remaining))
                    if not chunk:
                        break
                    outputfile.write(chunk)
                    remaining -= len(chunk)
            else:
                super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionResetError):   # browsers abort video requests constantly
            pass

    # -- visit log --------------------------------------------------------
    def do_GET(self):
        if self.path.split("?")[0] in ("/", "/index.html"):
            self._log_visit()
        super().do_GET()

    def _log_visit(self):
        xff = self.headers.get("X-Forwarded-For", "")
        ip = (self.headers.get("CF-Connecting-IP")
              or (xff.split(",")[0].strip() if xff else "")
              or self.client_address[0])
        entry = {
            "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "ip": ip,
            "country": self.headers.get("CF-IPCountry", "-"),
            "ua": self.headers.get("User-Agent", "-"),
            "ref": self.headers.get("Referer", "-"),
        }
        DATA.mkdir(exist_ok=True)
        with open(VISITS_LOG, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry) + "\n")

    def log_request(self, code="-", size="-"):
        # Quiet: a page load is dozens of requests and video makes many more.
        if str(code).startswith(("4", "5")) or self.path.split("?")[0] in ("/", "/index.html"):
            super().log_request(code, size)

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[{self.log_date_time_string()}] {fmt % args}\n")


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def main():
    global CACHE_CONTROL
    ap = argparse.ArgumentParser(description="Preview / self-host the site.")
    ap.add_argument("--host", default="0.0.0.0", help="0.0.0.0 = reachable from other devices")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--cache", action="store_true", help="allow browsers to cache for an hour (self-hosting)")
    a = ap.parse_args()
    if a.cache:
        CACHE_CONTROL = "public, max-age=3600"

    manifest = SITE / "clips" / "media.json"
    try:
        n = len(json.loads(manifest.read_text("utf-8")).get("clips", []))
    except Exception:
        n = 0

    try:
        httpd = Server((a.host, a.port), Handler)
    except OSError as e:
        sys.exit(f"Can't listen on port {a.port}: {e}\nTry:  python server.py --port {a.port + 1}")

    print()
    print("  cantwaittoseeyouagain")
    print("  " + "-" * 44)
    print(f"  this computer   http://localhost:{a.port}")
    ip = lan_ip()
    if ip and a.host in ("0.0.0.0", ""):
        print(f"  your phone      http://{ip}:{a.port}   (same Wi-Fi)")
    print()
    if n:
        print(f"  {n} clip{'s' if n != 1 else ''} ready  |  visits are logged to data/visits.log")
    else:
        print("  No clips built yet. Put your videos in assets/ and run:  python tools/build.py")
    print("  Ctrl+C to stop.\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
