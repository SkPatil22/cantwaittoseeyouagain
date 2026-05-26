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

## Replacing the assets

The puzzle uses one image; the slideshow uses ten. Drop your own files in
with these exact names:

```
assets/puzzle.jpg          # the photo that becomes the puzzle (1920×1080+)
assets/landscape-01.jpg    # slideshow #1
assets/landscape-02.jpg    # ... through landscape-10
...
assets/landscape-10.jpg
```

The slideshow also accepts video — name them `.mp4`/`.webm`/`.mov` and edit
the list in `static/slideshow.js` to point at the new extensions.

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

1. `git clone` this repo onto the Pi.
2. `python3 server.py --port 8000 &` (or use systemd / `screen` / `tmux`).
3. Point your router or `/etc/hosts` at the Pi's IP. No real domain needed —
   bookmark `http://<pi-ip>:8000`.

For LAN-only access just leave `--host 0.0.0.0`. For a public address, expose
through a reverse proxy or a tunnel of your choice.

## Progress is sticky

Puzzle progress is saved to a `puzzle_state` cookie (60 days). Reloads pick
up where you left off — the layout is regenerated from a seed stored in the
same cookie so piece edges stay consistent. Hit the small "reset" button to
clear and re-scatter.
