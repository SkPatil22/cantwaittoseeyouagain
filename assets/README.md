# Your videos go here

Drop landscape clips in this folder - **any filename** (`.mp4`, `.mov`, `.webm`, ...).
Horizontal footage, 1080p or better, is ideal.

Then, from the project root:

```
python tools/build.py
```

That trims and compresses them into `site/clips/` (the folder you publish).
The originals here are never modified and are not committed to git.

Want to pull clips from a Pexels likes page instead? `python tools/fetch_clips.py --pexels-key <key>`
