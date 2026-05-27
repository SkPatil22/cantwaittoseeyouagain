# cantwaittoseeyouagain

A one-page interactive invitation. Solve a jigsaw of a landscape photo, hit
play, and watch the landscapes cycle behind a softly fading "again?" with the
when/where below.

## Run it

```sh
python3 server.py
```

That's it — stdlib only, no dependencies. On first run the server downloads
ten sample landscape photos into `assets/` so the site has something to
render. Replace any of those files with your own and reload.

Open <http://localhost:8000>.

### Flags

- `--port 80` — different port (use `sudo` for ports below 1024)
- `--host 127.0.0.1` — bind to localhost only
- `--no-download` — skip asset bootstrap
- `--setup-only` — download assets and exit

## The clips

The slideshow is **video-only** (`.mp4`, `.webm`, `.mov`). Images are
ignored. The puzzle uses the first frame of the first clip the slideshow
will play (extracted in the browser via canvas — no ffmpeg needed), so
the puzzle ↔ slideshow handoff is a seamless still-to-motion fade.

```
assets/anything-you-want.mp4
assets/IMG_1234.mov
assets/pexels-12345.mp4
...
```

**Filenames don't matter.** Drop any video into `assets/` and it gets
played. The server lists whatever's there at runtime via `/api/media`,
sorted alphabetically. Hidden files (`.DS_Store` etc.) and non-video
extensions are skipped.

### Pull from a Pexels likes page

`tools/fetch_clips.py` scrapes any public Pexels likes page (default:
the maintainer's), then API-fetches each video's best mp4 and saves it
as `assets/pexels-<id>.mp4`.

```sh
# 1. Get a free Pexels API key at https://www.pexels.com/api/ (no card)
# 2. Pick whichever input style your shell likes:

python3 tools/fetch_clips.py --pexels-key abc123xyz
# or:
echo 'PEXELS_API_KEY=abc123xyz' > .env
python3 tools/fetch_clips.py

# Point at a different likes page:
python3 tools/fetch_clips.py --likes-from https://www.pexels.com/@someone/likes/

# Useful flags:
#   --reset    delete every existing pexels-*.mp4 first (leaves your own files alone)
#   --max 30   stop after 30 clips
#   --force    re-download even if the file already exists
```

The fetcher names files by Pexels video ID (`pexels-12345.mp4`), so
re-running it just adds new likes and skips ones already on disk. Your
own files dropped into `assets/` with any name are untouched.

### Play order

The slideshow plays clips in a **random order** stored in a cookie
(`slideshow_order`). Each clip plays exactly once before any repeats; at
the end of a cycle a fresh shuffle is generated. The order survives
reloads — refreshing in the middle of the slideshow picks up where it
left off. Add or remove clips from `assets/` and the cookie self-
invalidates (length mismatch), so the next visit shuffles afresh.

### Per-clip text color

The "again?" / address / time text re-samples the dominant color from
each clip's first frame and re-themes itself (light, vivid, same hue
family as the video) so it always sits in the picture but stays
readable. Font also cycles per clip.

## Controls

- **`reset`** chip (bottom-right while solving) — clear progress and
  re-scatter.
- **type `again`** — autocomplete the puzzle (handy for testing the play
  → slideshow transition).
- **pause/play chip** (bottom-right during the slideshow) — freeze on the
  current clip; click again to resume.

## Visit log

Every hit on `/` is recorded as a JSON line in `data/visits.log`:

```
{"ts": "...", "ip": "...", "ua": "...", "ref": "...", "path": "/"}
```

Tail it:

```sh
tail -f data/visits.log
```

## Hosting on a Raspberry Pi

For the free, no-domain-needed public setup using **Tailscale Funnel**
(URL like `https://cantwait.<yourname>.ts.net`), see **[DEPLOY.md](DEPLOY.md)**.

Quick local-network test:

1. `git clone` this repo onto the Pi.
2. `python3 server.py --port 8000 &` (or use systemd / `screen` / `tmux`).
3. Bookmark `http://<pi-ip>:8000` from another device on your LAN.

## Progress is sticky

Puzzle progress is saved to a `puzzle_state` cookie (60 days). Reloads pick
up where you left off — the layout is regenerated from a seed stored in the
same cookie so piece edges stay consistent. Hit the small "reset" button to
clear and re-scatter.
