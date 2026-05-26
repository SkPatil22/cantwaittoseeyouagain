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
assets/landscape-NN.mp4    # any count works (designed for ~30)
```

The server lists whatever's in `assets/` at runtime via `/api/media` —
no code edit needed when you add/remove/rename clips. If a slot has both
a video and an image (e.g. `landscape-03.mp4` + `landscape-03.jpg`), the
**video wins** so you can drop in real footage without first deleting
placeholders.

### Pull a 30-clip starter set

```sh
# One-time: free Pexels key (no card, no payment, ~30 sec to register)
#   https://www.pexels.com/api/
export PEXELS_API_KEY=<paste-the-key>

python3 tools/fetch_clips.py
```

Pulls a curated, themed 30-clip lineup into `assets/`:

| slot | source | theme |
|---|---|---|
| 1–3   | NASA      | Earth from ISS, aurora, Earth-at-night (public domain) |
| 4–6   | Pexels    | Arches/Milky Way / starry night |
| 7–10  | Pexels    | Calm ocean / beaches / reef |
| 11–14 | Pexels    | Mountains / alpine lakes |
| 15–17 | Pexels    | Birds / eagle / flamingos |
| 18–20 | Pexels    | Volcano eruption / lava |
| 21–25 | Pexels    | Forest / waterfall / meadow |
| 26–30 | Pexels    | Dunes / glacier / aurora / hills / storm |

Idempotent (skips slots already filled). Use `--force` to re-download or
`--only 4,12,18` to refresh specific slots.

If you skip the Pexels key, only the 3 NASA slots populate; the script
prints clear instructions for the rest. Free landscape footage also at
<https://pixabay.com/videos>, <https://mixkit.co>, <https://coverr.co>,
or your own phone — name them `landscape-NN.mp4`, drop them in, reload.

> The first-run server bootstrap (`python3 server.py --setup-only`) pulls
> 10 jpg **placeholders** so the page renders before you've added clips.
> They sit in slots 1–10 and get overridden the moment you drop in the
> matching `landscape-NN.mp4`.

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
