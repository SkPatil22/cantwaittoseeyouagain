#!/usr/bin/env python3
"""
build.py - turn your raw videos into a web-ready, deployable site/clips folder.

    python tools/build.py

Reads every video in assets/ (any filename) and writes to site/clips/:

  <name>.mp4   trimmed, 1080p max, H.264, no audio, "faststart" so it plays
               while it downloads. Small enough (a few MB) for free hosts.
  <name>.jpg   poster = the clip's first frame. The puzzle is made from this.
  media.json   the playlist the page reads (order, colors, sizes).

...plus site/og.jpg, the picture chat apps show when you text the link.

Why this step exists
  Raw stock clips are 20-40 MB each. Free hosts cap single files (Cloudflare
  Pages: 25 MiB) and phones on cellular can't stream 30 of them. Each clip is
  only shown for ~6 seconds, so trimming + re-encoding loses nothing visible.

  It also picks a text color for every clip (from the picture itself) so the
  "again?" text always matches the footage but stays readable.

Needs ffmpeg. If it isn't installed the script offers to pip-install a private
copy (imageio-ffmpeg) - no admin rights, nothing else on your machine changes.

Re-running is cheap: clips that haven't changed are skipped.
"""

from __future__ import annotations

import argparse
import colorsys
import datetime
import hashlib
import importlib
import json
import math
import re
import shutil
import site
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}
CF_LIMIT = 25 * 1024 * 1024  # Cloudflare Pages: max size of a single file

# Windows consoles choke on odd characters; never crash on output.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(errors="replace")
    except Exception:
        pass


def say(msg: str = "") -> None:
    print(msg, flush=True)


# ---------------------------------------------------------------- ffmpeg ----

def _imageio_exe() -> str | None:
    try:
        import imageio_ffmpeg  # type: ignore
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def find_ffmpeg(auto_yes: bool) -> str:
    exe = shutil.which("ffmpeg") or _imageio_exe()
    if exe:
        return exe

    say("ffmpeg isn't installed on this machine.")
    say("I can install a private copy for this Python with pip (imageio-ffmpeg,")
    say("about 30 MB). No admin rights needed; nothing else changes.")
    if not auto_yes and sys.stdin.isatty():
        if input("Install it now? [Y/n] ").strip().lower() in ("n", "no"):
            say("\nOkay. Install ffmpeg yourself, then run this again:")
            say("  Windows: winget install Gyan.FFmpeg     (then open a new terminal)")
            say("  Mac:     brew install ffmpeg")
            say("  Linux:   sudo apt install ffmpeg")
            sys.exit(1)

    in_venv = sys.prefix != getattr(sys, "base_prefix", sys.prefix)
    cmd = [sys.executable, "-m", "pip", "install", "--quiet", "imageio-ffmpeg"]
    if not in_venv:
        cmd.insert(4, "--user")
    say("Installing imageio-ffmpeg ...")
    if subprocess.run(cmd).returncode != 0:
        say("pip install failed. Install ffmpeg manually (see above) and re-run.")
        sys.exit(1)
    importlib.invalidate_caches()
    try:  # a freshly created user-site dir isn't on sys.path yet
        usp = site.getusersitepackages()
        if usp not in sys.path:
            sys.path.append(usp)
    except Exception:
        pass
    exe = _imageio_exe()
    if not exe:
        say("Installed, but ffmpeg still can't be found. Re-run this command once.")
        sys.exit(1)
    return exe


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, **kw)


# ----------------------------------------------------------------- probing --

def probe(ffmpeg: str, src: Path) -> dict | None:
    """Duration / size / fps / rotation, parsed from `ffmpeg -i` (no ffprobe needed)."""
    r = run([ffmpeg, "-hide_banner", "-i", str(src)])
    text = r.stderr.decode("utf-8", "replace")
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
    v = re.search(r"Video:.*?,\s*(\d{2,5})x(\d{2,5})[\s,\[]", text)
    if not v:
        return None
    dur = (int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))) if m else 0.0
    w, h = int(v.group(1)), int(v.group(2))
    rot = re.search(r"rotation of (-?\d+(?:\.\d+)?) degrees", text)
    if rot and abs(round(float(rot.group(1)))) % 180 == 90:
        w, h = h, w  # phone footage: stored landscape, displayed portrait
    fps = re.search(r"(\d+(?:\.\d+)?) fps", text)
    return {"dur": dur, "w": w, "h": h, "fps": float(fps.group(1)) if fps else 30.0}


# ---------------------------------------------------------------- encoding --

def encode(ffmpeg: str, src: Path, dest: Path, info: dict, a: argparse.Namespace) -> str | None:
    """Returns an error string, or None on success."""
    vf = f"scale=-2:'min({a.height},ih)':flags=lanczos"
    if info["fps"] > 32:
        vf += ",fps=30"
    seconds = min(a.seconds, max(1.0, info["dur"] - a.start)) if info["dur"] else a.seconds
    cmd = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
           "-ss", str(a.start), "-i", str(src), "-t", f"{seconds:.3f}",
           "-map", "0:v:0", "-an", "-sn", "-dn", "-vf", vf]
    if a.format == "webm":  # only for browsers/tests without H.264
        cmd += ["-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0", "-row-mt", "1",
                "-deadline", "good", "-cpu-used", "5", "-pix_fmt", "yuv420p"]
    else:
        cmd += ["-c:v", "libx264", "-preset", a.preset, "-crf", str(a.crf),
                "-maxrate", f"{a.maxrate}M", "-bufsize", f"{a.maxrate * 2}M",
                "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p",
                "-g", "60", "-movflags", "+faststart",
                "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"]
    cmd.append(str(dest))
    r = run(cmd)
    if r.returncode != 0 or not dest.exists():
        lines = r.stderr.decode("utf-8", "replace").strip().splitlines()
        return lines[-1] if lines else "ffmpeg failed"
    return None


def make_poster(ffmpeg: str, video: Path, dest: Path, height: int) -> bool:
    r = run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(video),
             "-frames:v", "1", "-vf", f"scale=-2:'min({height},ih)':flags=lanczos",
             "-q:v", "3", "-update", "1", str(dest)])
    return r.returncode == 0 and dest.exists()


def grab_thumb(ffmpeg: str, video: Path, t: float, w: int = 64, h: int = 36) -> bytes | None:
    r = run([ffmpeg, "-hide_banner", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", str(video),
             "-frames:v", "1", "-vf", f"scale={w}:{h}:flags=area", "-f", "rawvideo",
             "-pix_fmt", "rgb24", "pipe:1"])
    return r.stdout if r.returncode == 0 and len(r.stdout) == w * h * 3 else None


# ------------------------------------------------------------------ colors --

_LIN = [(c / 255 / 12.92) if c / 255 <= 0.04045 else (((c / 255 + 0.055) / 1.055) ** 2.4)
        for c in range(256)]


def _lum(rgb: tuple[float, float, float]) -> float:
    r, g, b = (_LIN[max(0, min(255, round(c * 255)))] for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(y1: float, y2: float) -> float:
    hi, lo = max(y1, y2), min(y1, y2)
    return (hi + 0.05) / (lo + 0.05)


# Where the words land on screen, as fractions of the frame (x0, x1, y0, y1):
# the big "again?" sits higher, the small lines below it.
TITLE_ZONE = (0.25, 0.75, 0.28, 0.56)
DETAIL_ZONE = (0.25, 0.75, 0.57, 0.74)


def _zone_lums(frames: list[bytes], box, w: int, h: int) -> list[float]:
    """Luminance of every pixel in a zone (all sampled frames)."""
    x0, x1, y0, y1 = int(w * box[0]), int(w * box[1]), int(h * box[2]), int(h * box[3])
    out = []
    for fr in frames:
        for y in range(y0, y1):
            for x in range(x0, x1):
                i = (y * w + x) * 3
                out.append(_lum((fr[i] / 255, fr[i + 1] / 255, fr[i + 2] / 255)))
    return out


def _dominant_hue(frames: list[bytes], w: int, h: int) -> tuple[float, float]:
    """(hue 0..1, saturation to use). Weighted toward saturated, bright pixels."""
    hx = hy = wsum = sat_sum = 0.0
    sat_n = 0
    for box in (TITLE_ZONE, DETAIL_ZONE):
        x0, x1, y0, y1 = int(w * box[0]), int(w * box[1]), int(h * box[2]), int(h * box[3])
        for fr in frames:
            for y in range(y0, y1):
                for x in range(x0, x1):
                    i = (y * w + x) * 3
                    hh, ss, vv = colorsys.rgb_to_hsv(fr[i] / 255, fr[i + 1] / 255, fr[i + 2] / 255)
                    if ss >= 0.12 and vv >= 0.15:
                        wt = ss * (0.3 + vv)
                        hx += math.cos(hh * 2 * math.pi) * wt
                        hy += math.sin(hh * 2 * math.pi) * wt
                        wsum += wt
                        sat_sum += ss
                        sat_n += 1
    chroma = sat_sum / sat_n if sat_n else 0.0
    if wsum > 0 and chroma >= 0.08:
        return (math.degrees(math.atan2(hy, hx)) % 360) / 360, min(0.85, max(0.32, 0.30 + 0.75 * chroma))
    return 42 / 360, 0.10          # near-greyscale footage: warm off-white / soft charcoal


def _ink_for(hue: float, sat: float, lums: list[float], target: float) -> tuple[str, str]:
    """Light or dark ink (in the given hue) that stays readable over most of a zone.

    A zone can straddle bright sky and dark ground, so an average is misleading.
    Instead, for each polarity find the least-extreme lightness that reaches the
    contrast target on >= 90% of the zone's pixels (keeping as much tint as
    possible), then keep whichever polarity covers more. Light gets a head start
    (it is the cinematic default); dark must be clearly better to win.
    """
    def coverage(rgb) -> float:
        y = _lum(rgb)
        return sum(1 for v in lums if _contrast(y, v) >= target) / max(1, len(lums))

    best = None
    for tone, candidates in (("light", [0.90 + 0.01 * k for k in range(8)]),     # 0.90 .. 0.97
                             ("dark", [0.17 - 0.01 * k for k in range(9)])):     # 0.17 .. 0.09
        for lt in candidates:
            rgb = colorsys.hls_to_rgb(hue, lt, sat)
            cov = coverage(rgb)
            if cov >= 0.9:
                break
        score = cov + (0.12 if tone == "light" else 0.0)
        if best is None or score > best[0]:
            best = (score, tone, rgb)
    _, tone, rgb = best
    return "#%02x%02x%02x" % tuple(round(c * 255) for c in rgb), tone


def pick_inks(frames: list[bytes], w: int = 64, h: int = 36) -> dict:
    """Text colors for a clip: one for the big word, one for the small lines.

    Both share the clip's dominant hue (so it reads as one design) but each is
    light-or-dark and nudged to whatever is actually behind it - a bright sky
    above dark hills gets dark title ink and pale detail ink.
    """
    hue, sat = _dominant_hue(frames, w, h)
    ink, tone = _ink_for(hue, sat, _zone_lums(frames, TITLE_ZONE, w, h), 3.0)      # big text needs less contrast
    ink2, tone2 = _ink_for(hue, sat, _zone_lums(frames, DETAIL_ZONE, w, h), 4.2)
    return {"ink": ink, "tone": tone, "ink2": ink2, "tone2": tone2}


# ------------------------------------------------------------------- main ---

def slugify(stem: str, taken: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-") or "clip"
    name, k = base, 2
    while name in taken:
        name, k = f"{base}-{k}", k + 1
    taken.add(name)
    return name


def human(n: float) -> str:
    return f"{n / 1024 / 1024:.1f} MB"


def main() -> int:
    ap = argparse.ArgumentParser(description="Prepare videos for the site.",
                                 formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    ap.add_argument("--src", default="assets", help="folder with your raw videos")
    ap.add_argument("--out", default="site/clips", help="output folder")
    ap.add_argument("--seconds", type=float, default=7.0, help="keep this many seconds of each clip")
    ap.add_argument("--start", type=float, default=0.0, help="start this many seconds in")
    ap.add_argument("--height", type=int, default=1080, help="max output height")
    ap.add_argument("--crf", type=int, default=23, help="quality: lower = better + bigger (18-28)")
    ap.add_argument("--maxrate", type=int, default=6, help="bitrate cap in Mbps")
    ap.add_argument("--preset", default="medium", help="x264 speed/size trade-off")
    ap.add_argument("--format", choices=["mp4", "webm"], default="mp4",
                    help="webm is only for browsers without H.264 (e.g. some test Chromiums)")
    ap.add_argument("--limit", type=int, default=0, help="only process the first N clips")
    ap.add_argument("--keep-portrait", action="store_true", help="don't skip vertical videos")
    ap.add_argument("--force", action="store_true", help="re-encode everything")
    ap.add_argument("--yes", action="store_true", help="install ffmpeg helper without asking")
    a = ap.parse_args()

    src_dir = (ROOT / a.src) if not Path(a.src).is_absolute() else Path(a.src)
    out_dir = (ROOT / a.out) if not Path(a.out).is_absolute() else Path(a.out)
    sources = sorted(p for p in src_dir.glob("*")
                     if p.is_file() and not p.name.startswith(".") and p.suffix.lower() in VIDEO_EXTS) \
        if src_dir.is_dir() else []
    if not sources:
        say(f"No videos found in {src_dir}")
        say("Put your .mp4/.mov files there (any filenames), or run:")
        say("  python tools/fetch_clips.py --pexels-key <key>")
        return 1
    if a.limit:
        sources = sources[: a.limit]

    ffmpeg = find_ffmpeg(a.yes)
    out_dir.mkdir(parents=True, exist_ok=True)
    ext = ".webm" if a.format == "webm" else ".mp4"

    manifest_path = out_dir / "media.json"
    cache: dict[str, dict] = {}
    if manifest_path.exists() and not a.force:
        try:
            cache = {c["id"]: c for c in json.loads(manifest_path.read_text("utf-8")).get("clips", [])}
        except Exception:
            cache = {}

    params = f"{a.seconds}|{a.start}|{a.height}|{a.crf}|{a.maxrate}|{a.format}|ink7"
    taken: set[str] = set()
    clips: list[dict] = []
    skipped: list[str] = []
    say(f"Building {len(sources)} clip(s) from {src_dir} ...\n")

    for i, src in enumerate(sources, 1):
        cid = slugify(src.stem, taken)
        tag = f"[{i}/{len(sources)}] {src.name}"
        st = src.stat()
        sig = hashlib.sha1(f"{st.st_size}|{int(st.st_mtime)}|{params}".encode()).hexdigest()[:12]
        mp4, jpg = out_dir / f"{cid}{ext}", out_dir / f"{cid}.jpg"

        old = cache.get(cid)
        if old and old.get("sig") == sig and mp4.exists() and jpg.exists():
            clips.append(old)
            say(f"{tag}\n    unchanged, skipped")
            continue

        info = probe(ffmpeg, src)
        if not info:
            say(f"{tag}\n    SKIPPED: couldn't read this file as video")
            skipped.append(src.name)
            continue
        if info["h"] > info["w"] and not a.keep_portrait:
            say(f"{tag}\n    SKIPPED: vertical video ({info['w']}x{info['h']}) would be cropped to a"
                f" thin strip on a landscape screen. Use --keep-portrait to include it.")
            skipped.append(src.name)
            continue
        if info["h"] < 720:
            say(f"    note: only {info['w']}x{info['h']} - will look soft full-screen")

        err = encode(ffmpeg, src, mp4, info, a)
        if err:
            say(f"{tag}\n    FAILED: {err}")
            mp4.unlink(missing_ok=True)
            skipped.append(src.name)
            continue
        if not make_poster(ffmpeg, mp4, jpg, a.height):
            say(f"{tag}\n    FAILED: couldn't make the poster frame")
            skipped.append(src.name)
            continue

        real = probe(ffmpeg, mp4) or info
        dur = real["dur"] or a.seconds
        ts = [0.5, min(3.0, dur / 2), max(0.5, dur - 1.0)]
        frames = [f for f in (grab_thumb(ffmpeg, mp4, t) for t in ts) if f]
        inks = pick_inks(frames) if frames else {"ink": "#f4e9d0", "tone": "light", "ink2": "#f4e9d0", "tone2": "light"}

        size = mp4.stat().st_size
        flag = "  <-- over Cloudflare's 25 MiB limit!" if size > CF_LIMIT else ""
        say(f"{tag}\n    {real['w']}x{real['h']}  {dur:.1f}s  {human(size)}  "
            f"title {inks['ink']} ({inks['tone']})  details {inks['ink2']} ({inks['tone2']}){flag}")
        clips.append({
            "id": cid,
            "src": f"clips/{mp4.name}",
            "poster": f"clips/{jpg.name}",
            "w": real["w"], "h": real["h"], "dur": round(dur, 2),
            **inks, "sig": sig,
        })

    if not clips:
        say("\nNothing usable was produced.")
        return 1

    clips.sort(key=lambda c: c["id"])
    manifest = {"version": 1,
                "built": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                "clips": clips}
    manifest_path.write_text(json.dumps(manifest, indent=1) + "\n", "utf-8")

    # Link-preview image (1200x630) from the first clip's poster.
    og = out_dir.parent / "og.jpg"
    run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(out_dir / f"{clips[0]['id']}.jpg"),
         "-vf", "scale=1200:630:force_original_aspect_ratio=increase,crop=1200:630",
         "-q:v", "4", "-update", "1", str(og)])

    # Drop files from clips that no longer exist in assets/.
    keep = {"media.json"} | {Path(c["src"]).name for c in clips} | {Path(c["poster"]).name for c in clips}
    for f in out_dir.iterdir():
        if f.is_file() and f.name not in keep:
            f.unlink()

    total = sum((out_dir / Path(c["src"]).name).stat().st_size for c in clips)
    biggest = max((out_dir / Path(c["src"]).name).stat().st_size for c in clips)
    say(f"\nDone: {len(clips)} clip(s), {human(total)} total, largest {human(biggest)}.")
    if skipped:
        say(f"Skipped {len(skipped)}: " + ", ".join(skipped))
    if biggest > CF_LIMIT:
        say("Some files are over 25 MiB - lower --maxrate or --seconds before uploading to Cloudflare Pages.")
    say("\nNext:  python server.py      (preview at http://localhost:8000)")
    say("Then:  upload the  site  folder  (see DEPLOY.md)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
