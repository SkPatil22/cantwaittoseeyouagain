// Video-only slideshow:
//  - hard cuts between clips
//  - random permutation persisted in a cookie (resumed across reloads;
//    a fresh shuffle is generated each time we exhaust the deck)
//  - per-clip text color sampled from the video's current frame, then
//    pushed toward a light, vivid value that reads against any background
//
// No image fallback. Drop landscape-NN.mp4 (.webm/.mov) into assets/ and
// the server lists them via /api/media.

// ---------- helpers ------------------------------------------------------

export async function fetchMedia() {
    try {
        const res = await fetch('/api/media', { cache: 'no-store' });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = await res.json();
        return Array.isArray(data.media) ? data.media : [];
    } catch (err) {
        console.warn('fetchMedia failed', err);
        return [];
    }
}

// Pull the first frame of a video and return a jpeg data URL.
// Used to give the puzzle a still that exactly matches the slideshow's
// opening clip.
export function extractFirstFrame(src) {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.src = src;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        let done = false;
        const cleanup = () => {
            video.removeAttribute('src');
            try { video.load(); } catch {}
        };
        const grab = () => {
            if (done) return;
            done = true;
            try {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth || 1920;
                canvas.height = video.videoHeight || 1080;
                canvas.getContext('2d').drawImage(video, 0, 0);
                const url = canvas.toDataURL('image/jpeg', 0.92);
                cleanup();
                resolve(url);
            } catch (e) {
                cleanup();
                reject(e);
            }
        };
        video.addEventListener('loadeddata', () => {
            try { video.currentTime = Math.min(0.01, (video.duration || 1) - 0.001); }
            catch { grab(); }
        });
        video.addEventListener('seeked', grab);
        video.addEventListener('error', () => {
            cleanup();
            reject(new Error(`video load failed: ${src}`));
        });
        setTimeout(() => {
            if (!done) { cleanup(); reject(new Error('first-frame timeout')); }
        }, 8000);
    });
}

// ---------- cookie order state ------------------------------------------

const ORDER_COOKIE = 'slideshow_order';
const COOKIE_DAYS = 60;

function readCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
}

function writeCookie(name, value, days = COOKIE_DAYS) {
    document.cookie =
        `${name}=${encodeURIComponent(value)}; max-age=${days * 86400};` +
        ` path=/; samesite=lax`;
}

function shuffleIndices(n) {
    const a = [];
    for (let i = 0; i < n; i++) a.push(i);
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function loadOrder(expectedLen) {
    try {
        const raw = readCookie(ORDER_COOKIE);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (!Array.isArray(s.order) || s.order.length !== expectedLen) return null;
        if (typeof s.pos !== 'number' || s.pos < 0 || s.pos >= expectedLen) return null;
        // Sanity: order is a permutation of 0..N-1.
        const seen = new Set(s.order);
        if (seen.size !== expectedLen) return null;
        for (let i = 0; i < expectedLen; i++) if (!seen.has(i)) return null;
        return s;
    } catch { return null; }
}

function saveOrder(state) {
    try { writeCookie(ORDER_COOKIE, JSON.stringify(state)); } catch {}
}

// ---------- color sampling -----------------------------------------------

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s; const l = (max + min) / 2;
    if (max === min) { h = 0; s = 0; }
    else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            default: h = (r - g) / d + 4;
        }
        h *= 60;
    }
    return [h, s, l];
}

function hslCss(h, s, l) {
    return `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`;
}

// Sample the visible video element, return a CSS color that reads on top of
// it: same hue family ("similar to background"), high lightness + decent
// saturation ("sticks out"), with the vignette + text-shadow as a safety net.
function pickTextColor(videoEl) {
    try {
        const w = 32, h = 18;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(videoEl, 0, 0, w, h);
        const px = ctx.getImageData(0, 0, w, h).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < px.length; i += 4) {
            r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
        }
        r /= n; g /= n; b /= n;
        const [h0, s0, l0] = rgbToHsl(r, g, b);
        // Push toward warm, light, lightly saturated — readable on most clips.
        const tH = h0;
        const tS = Math.min(0.55, Math.max(0.28, s0 * 0.9 + 0.15));
        const tL = l0 < 0.55 ? 0.88 : 0.18;   // light on dark, dark on light
        return hslCss(tH, tS, tL);
    } catch {
        return '#f4ddb2';   // honey fallback
    }
}

// ---------- main class ---------------------------------------------------

const FONTS = [
    "'Playfair Display', serif",
    "'Cormorant Garamond', serif",
    "'EB Garamond', serif",
    "'Crimson Text', serif",
    "'Lora', serif",
    "'Fraunces', serif",
    "'DM Serif Display', serif",
    "'Inter', sans-serif",
    "'Manrope', sans-serif",
];

export class Slideshow {
    constructor({ mediaEl, againEl, addressEl, timeEl, mediaList, interval = 5500 }) {
        this.media = mediaEl;
        this.again = againEl;
        this.address = addressEl;
        this.time = timeEl;
        this.mediaList = mediaList || [];
        this.interval = interval;
        this.elements = [];
        this.timer = null;
        this.lastFont = null;
        this.paused = false;
        // Restore the previous random ordering if one matches our list length,
        // otherwise mint a fresh permutation.
        const existing = loadOrder(this.mediaList.length);
        if (existing) {
            this.order = existing.order;
            this.pos = existing.pos;
            this._resuming = true;
        } else {
            this.order = shuffleIndices(this.mediaList.length);
            this.pos = -1;
            this._resuming = false;
            this._persist();
        }
    }

    _persist() {
        saveOrder({ order: this.order, pos: this.pos });
    }

    _build() {
        this.media.innerHTML = '';
        this.elements = [];
        for (const src of this.mediaList) {
            // Video-only. If somebody slips a non-video URL into the list it
            // simply won't render — clearer than silently falling back.
            const el = document.createElement('video');
            el.src = src;
            el.muted = true;
            el.loop = false;
            el.playsInline = true;
            el.preload = 'auto';
            this.elements.push(el);
            this.media.appendChild(el);
        }
    }

    start() {
        this._build();
        this._advance();
        this._scheduleNext();
    }

    _scheduleNext() {
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(() => {
            if (!this.paused) this._advance();
        }, this.interval);
    }

    pause() {
        this.paused = true;
        const cur = this.elements[this.order[this.pos]];
        if (cur) try { cur.pause(); } catch {}
    }

    resume() {
        this.paused = false;
        const cur = this.elements[this.order[this.pos]];
        if (cur) try { cur.play(); } catch {}
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    revealText() {
        this.again.classList.add('visible');
        this.address.classList.add('visible');
        this.time.classList.add('visible');
    }

    _advance() {
        const prevSlot = this.pos;
        let nextPos = this.pos + 1;
        if (nextPos >= this.order.length) {
            // Deck exhausted — shuffle a fresh ordering and restart.
            this.order = shuffleIndices(this.mediaList.length);
            nextPos = 0;
        }
        this.pos = nextPos;
        this._persist();

        const prevEl = prevSlot >= 0 ? this.elements[this.order[prevSlot]] : null;
        const next   = this.elements[this.order[this.pos]];
        if (prevEl && prevEl !== next) {
            prevEl.classList.remove('active');
            try { prevEl.pause(); prevEl.currentTime = 0; } catch {}
        }
        next.classList.add('active');
        try { next.currentTime = 0; next.play(); } catch {}

        // Color sample once the frame is on screen.
        const sample = () => {
            const color = pickTextColor(next);
            this._restyleText(color);
        };
        // `loadeddata` may already have fired during preload; either way wait
        // a beat so the GPU has the frame.
        if (next.readyState >= 2) {
            requestAnimationFrame(sample);
        } else {
            next.addEventListener('loadeddata', () => requestAnimationFrame(sample),
                { once: true });
        }
    }

    _restyleText(color) {
        let font;
        do {
            font = FONTS[Math.floor(Math.random() * FONTS.length)];
        } while (FONTS.length > 1 && font === this.lastFont);
        this.lastFont = font;
        for (const el of [this.again, this.address, this.time]) {
            el.style.fontFamily = font;
            el.style.color = color;
        }
    }
}
