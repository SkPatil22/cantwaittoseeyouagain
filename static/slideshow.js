// Slideshow with hard cuts between clips, pause/resume, and a helper for
// pulling the first frame of a video as a still image (used by the puzzle).

export const LANDSCAPES = [
    '/assets/landscape-01.jpg',
    '/assets/landscape-02.jpg',
    '/assets/landscape-03.jpg',
    '/assets/landscape-04.jpg',
    '/assets/landscape-05.jpg',
    '/assets/landscape-06.jpg',
    '/assets/landscape-07.jpg',
    '/assets/landscape-08.jpg',
    '/assets/landscape-09.jpg',
    '/assets/landscape-10.jpg',
];

export function isVideoSrc(src) {
    return /\.(mp4|webm|mov)(\?|$)/i.test(src);
}

// Decode the first frame of a video and return a jpeg data URL. Used to give
// the puzzle a still that exactly matches the slideshow's opening clip.
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
            // Force a seek so `seeked` fires and the frame is committed.
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

const COLORS = [
    '#f6e7c8',  // warm cream
    '#dfeae0',  // soft sage
    '#fbd8b6',  // peach blossom
    '#cce0e2',  // ice blue
    '#f0d2d4',  // dusty rose
    '#e9e2c3',  // pale wheat
    '#cdd6c0',  // moss
    '#f4ddb2',  // honey
    '#d6c3df',  // lavender mist
    '#ecd8c1',  // sand
];

export class Slideshow {
    constructor({ mediaEl, againEl, addressEl, timeEl, interval = 5500 }) {
        this.media = mediaEl;
        this.again = againEl;
        this.address = addressEl;
        this.time = timeEl;
        this.interval = interval;
        this.idx = -1;
        this.elements = [];
        this.timer = null;
        this.lastFont = null;
        this.paused = false;
    }

    _build() {
        this.media.innerHTML = '';
        this.elements = [];
        for (const src of LANDSCAPES) {
            let el;
            if (isVideoSrc(src)) {
                el = document.createElement('video');
                el.src = src;
                el.muted = true;
                el.loop = false;
                el.playsInline = true;
                el.preload = 'auto';
            } else {
                el = document.createElement('img');
                el.src = src;
                el.alt = '';
                el.decoding = 'async';
                el.loading = 'eager';
            }
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
        const cur = this.elements[this.idx];
        if (cur && cur.tagName === 'VIDEO') {
            try { cur.pause(); } catch {}
        }
    }

    resume() {
        this.paused = false;
        const cur = this.elements[this.idx];
        if (cur && cur.tagName === 'VIDEO') {
            try { cur.play(); } catch {}
        }
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
        const prev = this.idx;
        this.idx = (this.idx + 1) % this.elements.length;
        const next = this.elements[this.idx];
        const prevEl = prev >= 0 ? this.elements[prev] : null;
        // Hard cut: hide previous instantly, show next instantly.
        if (prevEl && prevEl !== next) {
            prevEl.classList.remove('active');
            if (prevEl.tagName === 'VIDEO') {
                try { prevEl.pause(); prevEl.currentTime = 0; } catch {}
            }
        }
        next.classList.add('active');
        if (next.tagName === 'VIDEO') {
            try { next.currentTime = 0; next.play(); } catch {}
        }
        this._restyleText();
    }

    _restyleText() {
        let font;
        do {
            font = FONTS[Math.floor(Math.random() * FONTS.length)];
        } while (FONTS.length > 1 && font === this.lastFont);
        this.lastFont = font;
        const color = COLORS[this.idx % COLORS.length];
        for (const el of [this.again, this.address, this.time]) {
            el.style.fontFamily = font;
            el.style.color = color;
        }
    }
}
