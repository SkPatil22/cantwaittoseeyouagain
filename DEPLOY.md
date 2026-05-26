# Deploying cantwaittoseeyouagain.com

End state: guests type **<https://cantwaittoseeyouagain.com>**, the page
loads off a Pi/desktop in your house, with HTTPS, no port forwarding on
your router, no static IP, and the visit log captures real visitor IPs.

The path is three pieces:

1. **Buy the domain** at Cloudflare Registrar (one-time, ~$10).
2. **Run the site as a systemd service** on the Pi.
3. **Run a Cloudflare Tunnel** from the Pi to Cloudflare's edge. Cloudflare
   serves your domain, terminates HTTPS, and forwards every hit through the
   tunnel to your server on `localhost:8000`.

---

## 1. Buy the domain

1. Sign in (or create an account) at <https://dash.cloudflare.com>.
2. Go to **Domain Registration → Register Domains**.
3. Search `cantwaittoseeyouagain.com`. Buy it (~$10/yr, at-cost from Cloudflare).
4. After purchase the domain shows up under your account's Websites list
   with Cloudflare DNS already wired up. **Leave the proxy (orange cloud)
   enabled** — that's what gives you HTTPS and edge caching for free.

That's the whole "domain" part.

## 2. Get the site running on the Pi

```sh
# On the Pi
sudo apt update && sudo apt install -y python3 git

git clone https://github.com/SkPatil22/cantwaittoseeyouagain.git
cd cantwaittoseeyouagain
git checkout claude/happy-wright-0oKTJ      # or main once merged

# First run: populate assets/. Either:
python3 server.py --setup-only               # auto-downloads samples
# ...or drop your own files into assets/ matching landscape-01..10.jpg/mp4

# Quick sanity check (Ctrl+C when satisfied)
python3 server.py
# -> Serving on http://0.0.0.0:8000
```

If you can hit `http://<pi-ip>:8000` from another device on your LAN, the
site is fine. Now make it survive reboots.

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

The unit binds to `127.0.0.1:8000`, not `0.0.0.0`, because Cloudflare
Tunnel connects from localhost. If you want to keep LAN access too, change
`--host 127.0.0.1` to `--host 0.0.0.0` in the unit and `systemctl restart cantwait`.

## 3. Install Cloudflare Tunnel

### Install cloudflared

Pick the package matching your Pi's architecture (`uname -m`):
`aarch64` → arm64, `armv7l` → armhf, `x86_64` → amd64.

```sh
# Example for a 64-bit Pi (Pi 4/5 on the 64-bit OS):
ARCH=arm64
curl -L "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb" -o /tmp/cloudflared.deb
sudo dpkg -i /tmp/cloudflared.deb
cloudflared --version
```

### Authenticate cloudflared to your Cloudflare account

```sh
cloudflared tunnel login
```

This prints a URL. On a headless Pi, copy it into a browser on your
laptop/phone, sign in to Cloudflare, and pick `cantwaittoseeyouagain.com`
when prompted. cloudflared drops a cert at `~/.cloudflared/cert.pem`.

### Create the tunnel

```sh
cloudflared tunnel create cantwait
# -> "Created tunnel cantwait with id <UUID>"
# -> Credentials file written to /home/pi/.cloudflared/<UUID>.json
```

Note the UUID — you'll paste it into the config.

### Drop in the config

```sh
sudo mkdir -p /etc/cloudflared
sudo cp deploy/cloudflared-config.yml.example /etc/cloudflared/config.yml

# Move the credentials so root can read them (the service runs as root).
sudo cp ~/.cloudflared/<UUID>.json /etc/cloudflared/<UUID>.json

# Edit /etc/cloudflared/config.yml — replace REPLACE_WITH_TUNNEL_UUID with
# the actual UUID in both places (tunnel: and credentials-file:).
sudo nano /etc/cloudflared/config.yml
```

### Point the domain at the tunnel

```sh
cloudflared tunnel route dns cantwait cantwaittoseeyouagain.com
cloudflared tunnel route dns cantwait www.cantwaittoseeyouagain.com
```

This creates proxied CNAME records in your Cloudflare DNS. You can
verify in the dashboard under DNS → Records.

### Run the tunnel as a service

```sh
sudo cloudflared service install
sudo systemctl enable --now cloudflared
systemctl status cloudflared                 # should be "active (running)"
journalctl -u cloudflared -f                 # live tunnel logs
```

## 4. Verify

```sh
# From anywhere on the internet (your phone on cellular is a good test):
curl -I https://cantwaittoseeyouagain.com
# -> HTTP/2 200, with Cloudflare headers
```

Open it in a browser. Should load with a valid Cloudflare-issued cert. On
the Pi, `tail -f data/visits.log` will show the visit appear with the real
IP (in `ip`) and country code (in `country`) populated from Cloudflare's
forwarded headers.

That's it.

---

## After it's live

- **Replace assets.** Drop new files in `assets/`, commit if you want, then
  `git pull` on the Pi (no restart needed — the server reads files per
  request).
- **Push code changes.** `git pull` on the Pi; `sudo systemctl restart
  cantwait` to pick them up.
- **See visits.** `tail -n 50 data/visits.log` or
  `cat data/visits.log | jq -c '{ts, country, ip, ref}' | tail`.
- **Pause traffic.** `sudo systemctl stop cloudflared` takes the site
  offline at the edge without touching your server.

## Optional: keep it off Google

If you don't want this showing up in search results, in the Cloudflare
dashboard go to **Rules → Transform Rules → Modify Response Header** and
add `X-Robots-Tag: noindex, nofollow` for any URI. (Or just don't share
the link publicly — search engines won't find it.)
