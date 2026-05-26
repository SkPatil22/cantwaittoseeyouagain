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

The slideshow is built for **video clips** — `.mp4`, `.webm`, or `.mov`.
The puzzle uses the first frame of clip #1 (extracted in the browser, so
no ffmpeg needed). Drop your files into `assets/` named:

```
assets/landscape-01.mp4    # slideshow #1 — first frame becomes the puzzle
assets/landscape-02.mp4
...
assets/landscape-10.mp4
```

The server lists whatever's in `assets/` at runtime — no code edit needed
when you add/remove/rename clips. Any number of clips works (not just 10).

If a slot has both an mp4 and a jpg (e.g. `landscape-03.mp4` +
`landscape-03.jpg`), the **video wins**. Free landscape footage:
pexels.com/videos, pixabay.com/videos, coverr.co, or your phone.

> The first-run bootstrap pulls jpg **placeholders** so the site isn't
> empty before you've added clips. Replace them with real mp4s when ready
> — you can delete the jpgs at the same time or leave them; videos take
> precedence per slot.

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
