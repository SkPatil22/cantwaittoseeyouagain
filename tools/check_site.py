#!/usr/bin/env python3
"""
check_site.py - is my published site healthy? Run it after every deploy.

    python tools/check_site.py https://cantwaittoseeyouagain.pages.dev
    python tools/check_site.py http://localhost:8000          # also works locally

It checks the things that silently break video sites:

  * the page and every script / stylesheet / font it needs actually load
  * the playlist (clips/media.json) is valid and EVERY clip and poster is reachable
  * video is served with HTTP Range support (206 Partial Content). iPhones and
    Safari refuse to play video from a host that doesn't do this.
  * correct content types, and no file over Cloudflare Pages' 25 MiB limit
  * the link-preview image (og:image) points at this site

Exit code is 0 when everything passes, 1 otherwise. Uses only the standard library.
"""

import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

LIMIT = 25 * 1024 * 1024
UA = "Mozilla/5.0 (compatible; cwtsy-check/1.0)"
fails = 0
warns = 0


def ok(msg):
    print(f"  ok    {msg}")


def bad(msg):
    global fails
    fails += 1
    print(f"  FAIL  {msg}")


def warn(msg):
    global warns
    warns += 1
    print(f"  warn  {msg}")


def fetch(url, headers=None, limit=2_000_000):
    """(status, headers, body) - never raises for HTTP errors."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.headers, r.read(limit)
    except urllib.error.HTTPError as e:
        return e.code, e.headers, b""
    except Exception as e:  # DNS, TLS, refused...
        return 0, {}, str(e).encode()


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    base = sys.argv[1].rstrip("/") + "/"
    print(f"\nChecking {base}\n")

    # 1. the page
    print("page")
    st, h, body = fetch(base)
    if st != 200:
        bad(f"can't connect to {base}: {body.decode('utf-8', 'replace')[:120]}" if st == 0 else f"{base} -> HTTP {st}")
        print("\nCan't load the site - nothing else to check.")
        return 1
    html = body.decode("utf-8", "replace")
    (ok if "text/html" in h.get("Content-Type", "") else bad)(f"index.html served as {h.get('Content-Type')}")
    if "js/app.js" not in html:
        bad("index.html doesn't reference js/app.js - is this the right folder?")

    # 2. code, styles, fonts
    print("\ncode and fonts")
    need = ["css/style.css", "fonts/fonts.css", "favicon.svg", "robots.txt"] + \
           [f"js/{n}.js" for n in ("app", "puzzle", "jigsaw", "slideshow", "deck", "look", "store", "config")]
    css = fetch(base + "fonts/fonts.css")[2].decode("utf-8", "replace")
    need += ["fonts/" + f for f in re.findall(r'url\("([^"]+\.woff2)"\)', css)]
    missing = [p for p in need if fetch(base + p, {"Range": "bytes=0-0"})[0] not in (200, 206)]
    (bad if missing else ok)(f"{len(need) - len(missing)}/{len(need)} files load" + (f"   missing: {', '.join(missing)}" if missing else ""))

    # 3. playlist + clips
    print("\nclips")
    st, h, body = fetch(base + "clips/media.json")
    if st != 200:
        bad(f"clips/media.json -> HTTP {st}   (did you upload site/clips? run tools/build.py first)")
        return finish()
    try:
        clips = json.loads(body)["clips"]
        ok(f"playlist has {len(clips)} clips")
    except Exception:
        bad("clips/media.json isn't valid")
        return finish()

    total = biggest = 0
    no_range, wrong_type, too_big, unreachable = [], [], [], []
    for c in clips:
        st, h, _ = fetch(base + c["src"], {"Range": "bytes=0-1"})
        if st not in (200, 206):
            unreachable.append(c["src"])
            continue
        if st != 206:
            no_range.append(c["src"])
        if not h.get("Content-Type", "").startswith("video/"):
            wrong_type.append(f"{c['src']} ({h.get('Content-Type')})")
        m = re.search(r"/(\d+)$", h.get("Content-Range", ""))
        size = int(m.group(1)) if m else int(h.get("Content-Length") or 0)
        total += size
        biggest = max(biggest, size)
        if size > LIMIT:
            too_big.append(c["src"])
        if fetch(base + c["poster"], {"Range": "bytes=0-0"})[0] not in (200, 206):
            unreachable.append(c["poster"])
    (bad if unreachable else ok)(f"every clip and poster is reachable" if not unreachable else f"unreachable: {', '.join(unreachable)}")
    if not no_range:
        ok("video is served with Range support (206 Partial Content)")
    else:
        bad(f"no Range support ({len(no_range)} clips answered 200 instead of 206) - iPhones/Safari won't play these")
    if wrong_type:
        bad("wrong content type: " + ", ".join(wrong_type))
    elif clips:
        ok("video content types are right")
    if too_big:
        bad("over Cloudflare's 25 MiB limit: " + ", ".join(too_big))
    else:
        ok(f"largest clip is {biggest / 1048576:.1f} MB (limit 25 MiB); whole playlist {total / 1048576:.0f} MB")

    # 4. link preview
    print("\nlink preview")
    m = re.search(r'property="og:image"\s+content="([^"]+)"', html)
    if not m:
        warn("no og:image tag - chat apps will show a blank preview")
    else:
        img = m.group(1)
        host = urllib.parse.urlparse(img).netloc
        if host != urllib.parse.urlparse(base).netloc:
            warn(f"og:image points at {host}. Fine if that will be your final address; otherwise edit the og:image line in site/index.html")
        else:
            st, h, _ = fetch(img, {"Range": "bytes=0-0"})
            (ok if st in (200, 206) else bad)(f"og:image {'loads' if st in (200, 206) else 'is missing'} ({img})" + ("" if st in (200, 206) else f" -> HTTP {st}"))

    return finish()


def finish():
    print()
    if fails:
        print(f"{fails} problem(s) found." + (f" ({warns} warning(s))" if warns else ""))
        return 1
    print("All good." + (f" ({warns} warning(s) above)" if warns else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
