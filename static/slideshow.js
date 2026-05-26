// Slideshow that cycles through landscape images (or videos) and re-themes
// the overlay text on each transition.

const LANDSCAPES = [
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

// Curated "normal" fonts — all loaded via Google Fonts in index.html.
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

// Colors that sit close to a landscape palette but stay legible with the
// vignette + text-shadow defined in CSS.
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
    constructor({ mediaEl, againEl, addressEl, timeEl, interval = 5000 }) {
        this.media = mediaEl;
        this.again = againEl;
        this.address = addressEl;
        this.time = timeEl;
        this.interval = interval;
        this.idx = -1;
        this.elements = [];
        this.timer = null;
        this.lastFont = null;
    }

    _build() {
        this.media.innerHTML = '';
        this.elements = [];
        for (const src of LANDSCAPES) {
            const isVideo = /\.(mp4|webm|mov)$/i.test(src);
            let el;
            if (isVideo) {
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
        this.timer = setInterval(() => this._advance(), this.interval);
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
        next.classList.add('active');
        if (next.tagName === 'VIDEO') {
            try { next.currentTime = 0; next.play(); } catch {}
        }
        if (prevEl && prevEl !== next) {
            // Slight delay before deactivating so cross-fade overlaps.
            setTimeout(() => {
                prevEl.classList.remove('active');
                if (prevEl.tagName === 'VIDEO') {
                    try { prevEl.pause(); } catch {}
                }
            }, 1400);
        }
        this._restyleText();
    }

    _restyleText() {
        // Pick a font that's different from the last shown.
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
