// Video-only slideshow:
//  - hard cuts between clips
//  - random permutation persisted in a cookie (resumed across reloads;
//    a fresh shuffle is generated each time we exhaust the deck)
//  - per-clip text color sampled from the video's current frame, then
//    pushed toward a light, vivid value that reads against any background
//
// Implementation uses exactly two <video> elements as a front/back double
// buffer. The browser only decodes ~4-6 videos concurrently — instantiating
// one element per clip (as the original code did) silently leaves most at
// readyState 0, which paints as a black screen and makes the color sampler
// read pure black. Two elements keeps us well under any decoder cap and
// lets us preload the upcoming clip while the current one plays.
//
// No image fallback. Drop any .mp4/.webm/.mov file into assets/ — filenames
// don't matter; the server lists them via /api/media.

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
//
// Returns null if the canvas read came back fully black — in that case the
// video frame hadn't actually been presented yet and we'd just produce the
// "black → pink" fallback every time. Caller can retry on a later frame.
function pickTextColor(videoEl) {
    try {
        const w = 32, h = 18;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(videoEl, 0, 0, w, h);
        const px = ctx.getImageData(0, 0, w, h).data;
        let r = 0, g = 0, b = 0, n = 0, maxCh = 0;
        for (let i = 0; i < px.length; i += 4) {
            r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
            if (px[i] > maxCh) maxCh = px[i];
            if (px[i + 1] > maxCh) maxCh = px[i + 1];
            if (px[i + 2] > maxCh) maxCh = px[i + 2];
        }
        if (maxCh < 8) return null;   // canvas read was effectively black
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
    constructor({ mediaEl, againEl, addressEl, dateEl, timeEl, mediaList, interval = 5500 }) {
        this.media = mediaEl;
        this.again = againEl;
        this.address = addressEl;
        this.date = dateEl;
        this.time = timeEl;
        this.textEls = [againEl, addressEl, dateEl, timeEl].filter(Boolean);
        this.mediaList = mediaList || [];
        this.interval = interval;
        this.timer = null;
        this.lastFont = null;
        this.paused = false;
        this.front = null;   // currently visible buffer
        this.back  = null;   // preloads the upcoming clip
        // Restore the previous random ordering if one matches our list length,
        // otherwise mint a fresh permutation.
        const existing = loadOrder(this.mediaList.length);
        if (existing) {
            this.order = existing.order;
            this.pos = existing.pos;
        } else {
            this.order = shuffleIndices(this.mediaList.length);
            this.pos = -1;
            this._persist();
        }
        // Build the two buffers immediately and start warming them. The user
        // still has to solve the puzzle before the slideshow becomes visible,
        // which gives the first clip plenty of time to fully load.
        this._buildBuffers();
    }

    _persist() {
        saveOrder({ order: this.order, pos: this.pos });
    }

    _mkVideo() {
        const v = document.createElement('video');
        v.muted = true;
        v.loop = false;
        v.playsInline = true;
        v.preload = 'auto';
        return v;
    }

    _buildBuffers() {
        if (!this.media) return;
        this.media.innerHTML = '';
        this.front = this._mkVideo();
        this.back  = this._mkVideo();
        this.media.appendChild(this.front);
        this.media.appendChild(this.back);
        // Preload the next two clips into front + back so by the time the
        // slideshow becomes visible, the first frame is ready to paint.
        const firstSrc = this._upcomingSrc(0);
        const secondSrc = this._upcomingSrc(1);
        this._loadInto(this.front, firstSrc);
        if (secondSrc && secondSrc !== firstSrc) this._loadInto(this.back, secondSrc);
    }

    // What URL will be shown `offset` advances from now? offset=0 means the
    // very next call to _advance, offset=1 the one after that.
    _upcomingSrc(offset) {
        if (!this.mediaList.length) return null;
        let p = this.pos + 1 + offset;
        if (p >= this.order.length) {
            // We don't know what the post-reshuffle order will be; the actual
            // wrap will fix this up. Returning anything valid is fine — the
            // miss is detected on _advance and we just load on demand.
            p = p % this.order.length;
        }
        return this.mediaList[this.order[p]];
    }

    _loadInto(videoEl, src) {
        if (!videoEl || !src) return;
        if (videoEl.dataset.src === src) return;   // already loading / loaded
        videoEl.dataset.src = src;
        videoEl.src = src;
        try { videoEl.load(); } catch {}
    }

    start() {
        // _buildBuffers ran in the constructor; the front buffer is already
        // primed with the first clip. Just kick off playback.
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
        if (this.front) try { this.front.pause(); } catch {}
    }

    resume() {
        this.paused = false;
        if (this.front) try { this.front.play(); } catch {}
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    revealText() {
        for (const el of this.textEls) el.classList.add('visible');
    }

    _advance() {
        const isFirst = this.pos < 0;
        let nextPos = this.pos + 1;
        if (nextPos >= this.order.length) {
            // Deck exhausted — shuffle a fresh ordering and restart.
            this.order = shuffleIndices(this.mediaList.length);
            nextPos = 0;
        }
        this.pos = nextPos;
        this._persist();

        const nextSrc = this.mediaList[this.order[this.pos]];

        // Pick which buffer will become the front. Three cases:
        //   1. Very first call — front already loaded in the constructor.
        //   2. Back buffer is already preloading the right clip — swap.
        //   3. Deck just wrapped (or any other mismatch) — load on demand
        //      into whichever buffer isn't currently front.
        let nextEl;
        if (isFirst) {
            // Make sure the front actually has the first clip (it should,
            // from _buildBuffers, but a deck reshuffle on the very first
            // advance could move things).
            this._loadInto(this.front, nextSrc);
            nextEl = this.front;
        } else if (this.back.dataset.src === nextSrc) {
            // Swap front <-> back. The new front already has the upcoming
            // clip preloaded; the old front becomes the new back.
            const oldFront = this.front;
            this.front = this.back;
            this.back  = oldFront;
            oldFront.classList.remove('active');
            try { oldFront.pause(); oldFront.currentTime = 0; } catch {}
            nextEl = this.front;
        } else {
            // Mismatch (deck wrapped, or back failed to preload). Load on
            // demand into the back, then promote it.
            this._loadInto(this.back, nextSrc);
            const oldFront = this.front;
            this.front = this.back;
            this.back  = oldFront;
            oldFront.classList.remove('active');
            try { oldFront.pause(); oldFront.currentTime = 0; } catch {}
            nextEl = this.front;
        }

        nextEl.classList.add('active');
        try { nextEl.currentTime = 0; } catch {}
        const playPromise = nextEl.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {});   // muted autoplay can still reject on some browsers
        }

        // Sample text color only after an actual frame is presented to the
        // compositor. requestVideoFrameCallback is the only signal that
        // guarantees the canvas read will return real pixels; `canplay` /
        // `playing` can fire before the first paint, especially after a seek.
        this._sampleOnPaint(nextEl);

        // Warm up the *next* upcoming clip in the now-back buffer.
        const upcomingSrc = this._upcomingSrc(0);
        if (upcomingSrc && upcomingSrc !== nextSrc) {
            this._loadInto(this.back, upcomingSrc);
        }
    }

    _sampleOnPaint(videoEl) {
        let attempts = 0;
        const trySample = () => {
            attempts++;
            const color = pickTextColor(videoEl);
            if (color) {
                this._restyleText(color);
                return;
            }
            // Canvas read came back black — frame not actually painted yet.
            // Retry on the next presented frame (up to a few times).
            if (attempts < 6) scheduleFrame();
        };
        const scheduleFrame = () => {
            if (typeof videoEl.requestVideoFrameCallback === 'function') {
                videoEl.requestVideoFrameCallback(() => trySample());
            } else {
                // Fallback path: double-rAF after readiness so the compositor
                // has had at least one frame budget to present the new src.
                const queued = () => requestAnimationFrame(() => requestAnimationFrame(trySample));
                if (videoEl.readyState >= 3) queued();
                else {
                    videoEl.addEventListener('canplay', queued, { once: true });
                    videoEl.addEventListener('playing', queued, { once: true });
                    setTimeout(queued, 1500);
                }
            }
        };
        scheduleFrame();
    }

    _restyleText(color) {
        let font;
        do {
            font = FONTS[Math.floor(Math.random() * FONTS.length)];
        } while (FONTS.length > 1 && font === this.lastFont);
        this.lastFont = font;
        for (const el of this.textEls) {
            el.style.fontFamily = font;
            el.style.color = color;
        }
    }
}
