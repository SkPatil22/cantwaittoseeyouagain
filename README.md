# cantwaittoseeyouagain

A one-page invitation. A landscape photograph arrives as a jigsaw puzzle. Solve it, press
play, and the lines wipe away as the picture comes alive: hard-cut clips of landscapes, with
**again?**, the address, the date and the time fading in over each one in a new font and a
color taken from the footage.

## Make it (about five minutes)

```
1.  Put your videos in  assets/          (any filenames, .mp4 / .mov / .webm)
2.  python tools/build.py                (trims + compresses them into site/clips/)
3.  python server.py                     (preview; it prints an address for your phone too)
4.  Publish the  site  folder            (free, no server: see DEPLOY.md)
```

`python` is `py` on Windows if `python` isn't found, and `python3` on Mac/Linux. There is nothing to
install: the build step offers to fetch a private copy of ffmpeg for you the first time.

Want clips from a Pexels likes page? `python tools/fetch_clips.py --pexels-key <key>` downloads
them into `assets/`, then continue at step 2.

## What guests see

1. **A puzzle.** Around 36 to 66 pieces depending on the screen (phones get bigger pieces),
   scattered over the whole screen. Drag them into place. Progress is saved, so a reload
   picks up where they left off.
2. **A big glass play button** appears when it's finished.
3. **Press it** and every puzzle line is wiped away, each one from one end to the other, at
   its own moment, fading as it goes. The finished picture is the first frame of the first clip,
   so it simply starts to move.
4. **The reveal.** Hard cuts between clips, in a random order that never repeats until every
   clip has played. The text changes font and color on the same frame as each cut. A small
   pause button appears when they move the mouse or tap.

Testing shortcuts: type **again** anywhere (or open the page with `#again` on the end) to
auto-solve the puzzle. The small circular-arrow button in the corner starts over.

## Change the details

Open `site/index.html` and edit the three lines under `<h1>again?</h1>`:

```html
<p class="line address" id="address">2512 Farlow Gap Ln, Raleigh NC, 27603</p>
<p class="line date" id="date">oct 17th</p>
<p class="line time" id="time">6pm</p>
```

Everything else worth tuning is in `site/js/config.js` (how long each clip shows, the
auto-solve word, an optional analytics token).

**Text color for a clip looks wrong?** `python tools/build.py` picks colors from the footage and
stores them in `site/clips/media.json` (`ink` for the big word, `ink2` for the small lines).
Edit the hex value there. Rebuilding keeps your edit as long as that video didn't change.

## The folders

```
assets/        your original videos (never modified, never committed)
site/          the whole website: this is the folder you publish
  index.html   the page (and the event details)
  css/  js/    styling and code (no build tools, no dependencies)
  fonts/       ten self-hosted fonts (SIL Open Font License, licences included)
  clips/       made by tools/build.py: compressed clips, first-frame pictures, media.json
tools/         build.py (prepare clips), check_site.py (test a published site), fetch_clips.py
server.py      local preview server (serves only site/, supports video seeking)
DEPLOY.md      how to publish for free
```

## Visits

A free static host has no server of your own, so use its analytics: on Cloudflare Pages it's a
one-click switch (see DEPLOY.md). When you run `server.py` yourself it also appends one line per
page view to `data/visits.log` (time, IP, country if known, browser).

## Good to know

- **Cookies** hold the puzzle progress and the playlist order (about 300 bytes together).
  They're functional only; nothing is tracked.
- **Black screen or nothing plays on an iPhone?** The host must support HTTP Range requests.
  Every real host does; Python's built-in `http.server` does not (that's why this project has its
  own `server.py`). `python tools/check_site.py <your address>` tells you for certain.
- **A clip that can't be loaded is skipped** automatically. Vertical (portrait) clips are
  left out by the build because they'd be cropped to a thin strip on a landscape screen.
- Fonts: Playfair Display, Cormorant Garamond, EB Garamond, Fraunces, DM Serif Display, Lora,
  Bodoni Moda, Inter, Manrope, Josefin Sans (all SIL OFL, Latin subset, one weight each).
- The jigsaw piece shapes follow the public-domain curve construction from Draradech's
  jigsaw generator.
