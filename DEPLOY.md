# Deploying cantwaittoseeyouagain (free path)

Goal: a stable HTTPS URL guests can hit, no domain purchase, no router
port forwarding, no public-facing home IP. The site runs on your Pi (or
any always-on Linux box) and **Tailscale Funnel** exposes it to the
public internet through Tailscale's edge.

End-state URL looks like:

```
https://<device>.<tailnet>.ts.net
```

e.g. `https://cantwait.raleigh.ts.net`. Not as pretty as a `.com` but
free, stable, and shareable.

The path is two pieces:

1. **Run the site as a systemd service** on the Pi.
2. **Run Tailscale Funnel** on the same Pi, pointed at `localhost:8000`.

---

## 1. Get the site running on the Pi

```sh
sudo apt update && sudo apt install -y python3 git

git clone https://github.com/SkPatil22/cantwaittoseeyouagain.git
cd cantwaittoseeyouagain
git checkout claude/happy-wright-0oKTJ      # or main once merged

# First run: populate assets/. Either:
python3 server.py --setup-only               # auto-downloads samples
# ...or drop your own files into assets/ matching landscape-01..10.jpg/mp4

# Sanity check (Ctrl+C when satisfied)
python3 server.py
# -> Serving on http://0.0.0.0:8000
```

Hit `http://<pi-ip>:8000` from another device on your LAN to confirm.

### Install the systemd unit

```sh
# Edit User= / paths in deploy/cantwait.service if your username isn't `pi`
# or your clone path differs from /home/pi/cantwaittoseeyouagain.
sudo cp deploy/cantwait.service /etc/systemd/system/cantwait.service
sudo systemctl daemon-reload
sudo systemctl enable --now cantwait
systemctl status cantwait                    # should be "active (running)"
journalctl -u cantwait -f                    # live logs
```

The unit binds to `127.0.0.1:8000` because Tailscale Funnel connects from
localhost. If you want LAN access too, change `--host 127.0.0.1` to
`--host 0.0.0.0` in the unit and `systemctl restart cantwait`.

## 2. Set up Tailscale Funnel

### Install Tailscale

```sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

The `tailscale up` step prints a URL — open it on any device, sign in
(GitHub / Google / Microsoft / email all free), and approve the Pi. The
Pi joins your tailnet.

### Pick nice names (one-time, optional but recommended)

The Funnel URL is `<device-name>.<tailnet-name>.ts.net`. Defaults are
auto-generated and ugly. Fix them once:

1. **Tailnet name** — <https://login.tailscale.com/admin/dns> →
   "Tailnet name" → Rename. Pick something short, e.g. `raleigh` or your
   first name. Globally unique on Tailscale.
2. **Device name** — <https://login.tailscale.com/admin/machines> → click
   the Pi → Edit machine name → set to `cantwait` (or whatever you want
   the URL prefix to be).

After both renames the URL becomes `https://cantwait.raleigh.ts.net` (or
whatever you chose).

### Turn on HTTPS for your tailnet

Once, in the admin panel:

<https://login.tailscale.com/admin/dns> → "HTTPS Certificates" → enable.
This lets Tailscale issue Let's Encrypt certs for your `.ts.net`
hostnames.

### Enable Funnel

On the Pi:

```sh
# Allow this device to use Funnel (one-time per device).
sudo tailscale set --advertise-tags=tag:funnel
```

Then in the admin panel → **Access Controls** (the policy editor),
ensure your policy lets that tag use funnel. Easiest baseline policy
addition:

```hujson
{
  "tagOwners": {
    "tag:funnel": ["autogroup:admin"],
  },
  "nodeAttrs": [
    { "target": ["tag:funnel"], "attr": ["funnel"] },
  ],
}
```

Save. Back on the Pi:

```sh
sudo tailscale funnel --bg 8000
```

`--bg` runs it in the background as a persistent serve config — survives
reboots. Tailscale prints the public URL it's listening on.

Confirm it's active:

```sh
tailscale funnel status
```

You should see something like:

```
https://cantwait.raleigh.ts.net (Funnel on)
|-- / proxy http://127.0.0.1:8000
```

## 3. Verify

From your phone on cellular (anywhere off your LAN):

```sh
curl -I https://cantwait.raleigh.ts.net
# -> HTTP/2 200, valid Let's Encrypt cert
```

Open it in a browser. On the Pi, `tail -f data/visits.log` should show
the visit — Tailscale forwards the visitor IP in `X-Forwarded-For`, which
the server picks up.

That's the whole loop.

---

## After it's live

- **Replace assets.** Drop new files in `assets/`, then `git pull` on the
  Pi (no restart needed — files are served per-request).
- **Push code changes.** `git pull` on the Pi; `sudo systemctl restart
  cantwait` to apply.
- **See visits.** `tail -n 50 data/visits.log` or
  `cat data/visits.log | jq -c '{ts, ip, ref}' | tail`.
- **Pause traffic.** `sudo tailscale funnel --bg off` takes the site off
  the public internet without touching the local server.
- **Take site down for everyone but you.** `sudo tailscale funnel off`
  but keep `tailscale up` — the site is still reachable from your other
  Tailscale-connected devices via `cantwait.raleigh.ts.net`.

---

## Caveats with the free path

- **URL is `.ts.net`, not `.com`.** If you want a real domain later, see
  the "Upgrading to a real domain" note below.
- **Tailscale's free tier** allows Funnel and up to 100 devices. Plenty
  for a personal invite site.
- **Bandwidth/traffic** — Tailscale Funnel is fine for a save-the-date
  with dozens of guests. If it goes viral and you start serving
  thousands of MB, you'll hit limits.
- **Cold starts.** First request after a long quiet period sometimes
  takes an extra second while the tunnel wakes — harmless.

## Upgrading to a real domain later

If you change your mind and want `cantwaittoseeyouagain.com` (about $10/yr
at Cloudflare Registrar), the swap is:

1. Buy the domain at <https://dash.cloudflare.com> → Domain Registration.
2. On the Pi: `curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb -o /tmp/c.deb && sudo dpkg -i /tmp/c.deb`
3. `cloudflared tunnel login`, `cloudflared tunnel create cantwait`.
4. Create `/etc/cloudflared/config.yml`:
   ```yaml
   tunnel: <UUID-from-create>
   credentials-file: /etc/cloudflared/<UUID>.json
   ingress:
     - hostname: cantwaittoseeyouagain.com
       service: http://localhost:8000
     - hostname: www.cantwaittoseeyouagain.com
       service: http://localhost:8000
     - service: http_status:404
   ```
5. `cloudflared tunnel route dns cantwait cantwaittoseeyouagain.com` (and `www.`).
6. `sudo cloudflared service install && sudo systemctl enable --now cloudflared`.
7. `sudo tailscale funnel off` (so only Cloudflare serves it).

The systemd unit for the Python server doesn't change.
