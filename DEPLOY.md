# Publishing it (free, no server, about ten minutes)

The site is just files, so it doesn't need a computer of yours running. Put the `site` folder on
**Cloudflare Pages** and you get a permanent link like

    https://cantwaittoseeyouagain.pages.dev

with HTTPS, worldwide delivery, unlimited bandwidth, and visit stats, for $0 and no credit card.
Your Pi, your desktop, Tailscale, tunnels and port-forwarding are all out of the picture.

## Steps

**1. Prepare the clips** (once, and again whenever the videos change)

```
python tools/build.py
```

That's what makes the site light enough to host free: each clip becomes a few MB instead of 20-40 MB
(Cloudflare Pages refuses any single file over 25 MiB).

**2. Look at it locally** (optional but worth 60 seconds)

```
python server.py
```

Open the address it prints. It also prints one for your phone (same Wi-Fi). Type `again` to skip the puzzle.

**3. Upload**

1. Make a free account at <https://dash.cloudflare.com/sign-up> (email + password, no card).
2. **Workers & Pages** -> **Create application** -> **Pages** -> **Drag and drop your files**
   (Cloudflare shuffles the buttons around now and then; that's the one you want).
3. Project name: `cantwaittoseeyouagain` (this becomes the link).
4. Drag the **`site`** folder onto the page (the folder itself, or zip it first) -> **Deploy site**.

**4. Check it**

```
python tools/check_site.py https://cantwaittoseeyouagain.pages.dev
```

It confirms every file loads, every clip and picture is reachable, video is served with Range support
(iPhones refuse to play video without it) and nothing is over the size limit. Fix anything it flags before
you send the link.

**5. Turn on the visit log**

In the Cloudflare dashboard open your project -> **Metrics** -> **Web Analytics** -> **Enable**. Cloudflare adds
its counter on your next deployment; after that the same place shows visits, countries, devices and where
people came from. No cookies, nothing for guests to accept.

*If the switch isn't there or doesn't stick:* dashboard -> **Web Analytics** -> **Add a site**, copy the token, and
paste it into `site/js/config.js` as `analyticsToken`, then re-upload.

**6. Fix the link preview** (one line, optional)

When you text the link, chat apps show a preview image. In `site/index.html` the `og:image` line assumes your
address is `cantwaittoseeyouagain.pages.dev`. If Cloudflare gave you a different one (project names are shared
by everyone, so a taken name gets a suffix), change that line to match and re-upload.

## Updating later

Change the text or rebuild the clips, then open your project -> **Create deployment** and drag the `site`
folder in again. Files that didn't change aren't re-uploaded. Visitors get the new version on their next load
(clips and pictures are cached for up to a day; `media.json` is always re-checked).

## If something goes wrong

| Problem | Fix |
|---|---|
| Page loads but 404s on everything | Known dashboard hiccup with drag-and-drop. Use the command line instead: `npx wrangler login`, then `npx wrangler pages deploy site --project-name cantwaittoseeyouagain` (needs Node.js). |
| `check_site.py` says a clip is over 25 MiB | `python tools/build.py --maxrate 4 --force` |
| Videos don't play on iPhone | `check_site.py` will say "no Range support". Every real host has it; this only happens when self-hosting with the wrong server. |
| Name already taken | Pick another; then update the `og:image` line (step 6). |
| Want your own domain | Project -> **Custom domains**. Needs a domain you buy (about $10/year for .com). Optional. |

## Why this and not the Pi + Tailscale plan?

| | **Cloudflare Pages** | Netlify | GitHub Pages | Pi + Tailscale Funnel |
|---|---|---|---|---|
| Cost | free | free | free | free |
| Your computer must stay on | no | no | no | **yes** |
| Traffic allowance | unlimited (static files) | about 15 GB/month, then the site is paused | 100 GB/month (soft) | your home upload speed |
| Single-file limit | 25 MiB | none we could confirm | 100 MB | none |
| Keeps your address private | yes (upload, no repo) | yes | **no**: needs a public repo on the free plan | yes |
| Link | `name.pages.dev` | `name.netlify.app` | `you.github.io/repo` | `name.tailnet.ts.net` |
| Visit stats | one click, free | paid add-on | none | your own log |
| Things to set up | account + one upload | account + one upload | repo settings + a build workflow | 15+ steps (install, auth, ACL policy, HTTPS certs, funnel, systemd) |

Video is what decides it: a guest downloads tens of MB, so the traffic allowance matters more than for a normal
page. Cloudflare doesn't meter it; Netlify's newer free plan does (about 15 GB, then everything on your account
pauses until next month).

**Cloudflare Drop** (launched July 2026: drag a folder at cloudflare.com/drop and get a link with no account)
is tempting, but its published limits are 25 MiB per file and "HTML, CSS, JavaScript, images and fonts", and the
link expires after 60 minutes unless you sign in to claim it. I haven't tested whether it accepts video, so
treat it as a way to preview the page layout at most.

*How this was checked:* the limits and the upload flow above come from Cloudflare's, GitHub's and Netlify's
current documentation and write-ups (linked below). They were not run against a live account (the environment
this was built in has no route to Cloudflare), which is exactly why `tools/check_site.py` exists: run it after
your first upload and it tells you whether the real thing behaves.

Sources:
[Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/) |
[Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) |
[Web Analytics for Pages](https://developers.cloudflare.com/pages/how-to/web-analytics/) |
[Cloudflare Drop](https://developers.cloudflare.com/changelog/post/2026-07-08-cloudflare-drag-and-drop/) |
[Netlify free plan (2026)](https://netli.fyi/blog/netlify-free-plan-limits-2026) |
[GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

## Hosting it yourself (optional)

Only if you'd rather run it on your own always-on machine. `python server.py --cache` serves the `site`
folder (and only that folder) with video seeking, and writes `data/visits.log`. `deploy/cantwait.service` is a
systemd unit for a Raspberry Pi. To reach it from outside your home you also need a tunnel or a forwarded
port, which is the part this guide was written to avoid. The earlier Tailscale Funnel walkthrough is in git
history (commit `a078775`).
