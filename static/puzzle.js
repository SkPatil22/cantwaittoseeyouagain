// Full-screen jigsaw puzzle with cookie-persisted progress.
//
// Pieces are drawn as SVG paths (interior cell + four jigsaw edges) with a
// subtle outline stroke. Edges are deterministic per seed so a reload
// reproduces the same layout. Placement + seed live in a single cookie.

const COLS = 6;
const ROWS = 4;
const TAB_RATIO = 0.22;           // tab depth as fraction of min(pieceW, pieceH)
const SNAP_RATIO = 0.35;          // snap radius as fraction of min(pieceW, pieceH)
const COOKIE_NAME = 'puzzle_state';
const COOKIE_DAYS = 60;

// -- tiny seeded PRNG (mulberry32) ----------------------------------------

function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// -- cookies --------------------------------------------------------------

function readCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
}

function writeCookie(name, value, days = COOKIE_DAYS) {
    const v = encodeURIComponent(value);
    const maxAge = days * 86400;
    document.cookie = `${name}=${v}; max-age=${maxAge}; path=/; samesite=lax`;
}

function clearCookie(name) {
    document.cookie = `${name}=; max-age=0; path=/`;
}

function loadState() {
    try {
        const raw = readCookie(COOKIE_NAME);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function saveState(state) {
    try {
        writeCookie(COOKIE_NAME, JSON.stringify(state));
    } catch {
        // Cookie write can fail in private mode; ignore silently.
    }
}

// -- jigsaw path generator -----------------------------------------------

// edge values: +1 = tab pointing outward, -1 = blank cut inward, 0 = flat edge
function edgeSegment(from, to, edgeVal, r) {
    if (edgeVal === 0) {
        return `L ${to[0]} ${to[1]} `;
    }
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const L = Math.hypot(dx, dy);
    const ux = dx / L, uy = dy / L;
    const midX = (from[0] + to[0]) / 2;
    const midY = (from[1] + to[1]) / 2;
    const n1 = [midX - ux * r, midY - uy * r];
    const n2 = [midX + ux * r, midY + uy * r];
    const sweep = edgeVal > 0 ? 1 : 0;
    return `L ${n1[0].toFixed(2)} ${n1[1].toFixed(2)} ` +
           `A ${r} ${r} 0 0 ${sweep} ${n2[0].toFixed(2)} ${n2[1].toFixed(2)} ` +
           `L ${to[0]} ${to[1]} `;
}

function buildPiecePath(W, H, T, edges) {
    const r = T;
    const TL = [T, T];
    const TR = [T + W, T];
    const BR = [T + W, T + H];
    const BL = [T, T + H];
    let d = `M ${TL[0]} ${TL[1]} `;
    d += edgeSegment(TL, TR, edges.top, r);
    d += edgeSegment(TR, BR, edges.right, r);
    d += edgeSegment(BR, BL, edges.bottom, r);
    d += edgeSegment(BL, TL, edges.left, r);
    d += 'Z';
    return d;
}

// -- main class -----------------------------------------------------------

export class JigsawPuzzle extends EventTarget {
    constructor({ boardEl, piecesEl, resetBtn, puzzleImg }) {
        super();
        this.board = boardEl;
        this.pieces = piecesEl;
        this.resetBtn = resetBtn;
        this.puzzleImg = puzzleImg || '/assets/landscape-01.jpg';
        this.state = null;
        this.placedCount = 0;
        this.pieceEls = [];

        if (this.resetBtn) {
            this.resetBtn.addEventListener('click', () => this.reset());
        }
        window.addEventListener('resize', () => this._handleResize());
    }

    async init() {
        await this._waitForImage(this.puzzleImg);
        this._loadOrCreateState();
        this._layout();
        this._createPieces();
        this._placeFromState();
        if (this.state.complete) {
            // Reload of a solved puzzle: surface the play button right away.
            this.dispatchEvent(new Event('complete'));
        }
    }

    _waitForImage(src) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve(); // continue even if missing
            img.src = src;
        });
    }

    _loadOrCreateState() {
        const existing = loadState();
        if (existing && existing.cols === COLS && existing.rows === ROWS) {
            this.state = existing;
            return;
        }
        this.state = this._freshState();
        saveState(this.state);
    }

    _freshState() {
        const seed = (Math.random() * 0xffffffff) >>> 0;
        const rng = mulberry32(seed);
        const hEdges = [];
        for (let r = 0; r < ROWS - 1; r++) {
            const row = [];
            for (let c = 0; c < COLS; c++) row.push(rng() < 0.5 ? 1 : -1);
            hEdges.push(row);
        }
        const vEdges = [];
        for (let r = 0; r < ROWS; r++) {
            const row = [];
            for (let c = 0; c < COLS - 1; c++) row.push(rng() < 0.5 ? 1 : -1);
            vEdges.push(row);
        }
        const scatter = [];
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                scatter.push({
                    row: r, col: c,
                    xFrac: rng(), yFrac: rng(),
                    placed: false,
                });
            }
        }
        for (let i = scatter.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [scatter[i], scatter[j]] = [scatter[j], scatter[i]];
        }
        return {
            cols: COLS, rows: ROWS, seed,
            hEdges, vEdges,
            pieces: scatter,
            complete: false,
        };
    }

    _edgesForPiece(r, c) {
        const s = this.state;
        return {
            top:    r === 0          ? 0 : -s.hEdges[r - 1][c],
            bottom: r === ROWS - 1   ? 0 :  s.hEdges[r][c],
            left:   c === 0          ? 0 : -s.vEdges[r][c - 1],
            right:  c === COLS - 1   ? 0 :  s.vEdges[r][c],
        };
    }

    _layout() {
        // Puzzle fills the viewport edge-to-edge — the same surface the
        // slideshow will later occupy.
        this.boardW = window.innerWidth;
        this.boardH = window.innerHeight;
        this.pieceW = this.boardW / COLS;
        this.pieceH = this.boardH / ROWS;
        this.tab = Math.min(this.pieceW, this.pieceH) * TAB_RATIO;
        this.board.style.width = this.boardW + 'px';
        this.board.style.height = this.boardH + 'px';
        this.board.style.left = '0';
        this.board.style.top = '0';
        this.board.style.transform = 'none';
    }

    _createPieces() {
        this.pieces.innerHTML = '';
        this.pieceEls = [];
        for (const p of this.state.pieces) {
            const el = this._buildPieceEl(p.row, p.col);
            this.pieces.appendChild(el);
            this.pieceEls.push(el);
        }
    }

    _buildPieceEl(row, col) {
        const W = this.pieceW;
        const H = this.pieceH;
        const T = this.tab;
        const ed = this._edgesForPiece(row, col);
        const d = buildPiecePath(W, H, T, ed);

        const canvasW = W + 2 * T;
        const canvasH = H + 2 * T;

        const div = document.createElement('div');
        div.className = 'piece';
        div.style.width = canvasW + 'px';
        div.style.height = canvasH + 'px';
        div.dataset.row = row;
        div.dataset.col = col;

        const clipId = `clip-${row}-${col}`;
        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', canvasW);
        svg.setAttribute('height', canvasH);
        svg.setAttribute('viewBox', `0 0 ${canvasW} ${canvasH}`);

        const defs = document.createElementNS(svgNS, 'defs');
        const clip = document.createElementNS(svgNS, 'clipPath');
        clip.setAttribute('id', clipId);
        const cpath = document.createElementNS(svgNS, 'path');
        cpath.setAttribute('d', d);
        clip.appendChild(cpath);
        defs.appendChild(clip);
        svg.appendChild(defs);

        const img = document.createElementNS(svgNS, 'image');
        img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', this.puzzleImg);
        img.setAttribute('href', this.puzzleImg);
        img.setAttribute('width', this.boardW);
        img.setAttribute('height', this.boardH);
        img.setAttribute('x', T - col * W);
        img.setAttribute('y', T - row * H);
        img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
        img.setAttribute('clip-path', `url(#${clipId})`);
        svg.appendChild(img);

        // Outline stroke — this is the only "line" visible between pieces and
        // the one we wipe away in the play-button animation.
        const stroke = document.createElementNS(svgNS, 'path');
        stroke.setAttribute('d', d);
        stroke.setAttribute('fill', 'none');
        stroke.setAttribute('stroke', 'rgba(255,255,255,0.22)');
        stroke.setAttribute('stroke-width', '1');
        stroke.setAttribute('vector-effect', 'non-scaling-stroke');
        stroke.classList.add('piece-stroke');
        svg.appendChild(stroke);

        div.appendChild(svg);
        this._attachDragHandlers(div, row, col);
        return div;
    }

    _placeFromState() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const boardRect = this.board.getBoundingClientRect();
        this.placedCount = 0;
        for (const el of this.pieceEls) {
            const row = +el.dataset.row;
            const col = +el.dataset.col;
            const meta = this._stateFor(row, col);
            if (meta.placed) {
                this._snapToTarget(el, row, col, boardRect);
                this.placedCount++;
            } else {
                const canvasW = this.pieceW + 2 * this.tab;
                const canvasH = this.pieceH + 2 * this.tab;
                const x = meta.xFrac * Math.max(1, vw - canvasW);
                const y = meta.yFrac * Math.max(1, vh - canvasH);
                el.style.left = x + 'px';
                el.style.top = y + 'px';
            }
        }
    }

    _stateFor(row, col) {
        return this.state.pieces.find(p => p.row === row && p.col === col);
    }

    _targetFor(row, col, boardRect) {
        return {
            x: boardRect.left + col * this.pieceW - this.tab,
            y: boardRect.top + row * this.pieceH - this.tab,
        };
    }

    _snapToTarget(el, row, col, boardRect) {
        const t = this._targetFor(row, col, boardRect);
        el.style.left = t.x + 'px';
        el.style.top = t.y + 'px';
        el.classList.add('placed');
    }

    _attachDragHandlers(el, row, col) {
        let pointerId = null;
        let startX = 0, startY = 0;
        let origX = 0, origY = 0;

        const onDown = (e) => {
            if (el.classList.contains('placed')) return;
            e.preventDefault();
            pointerId = e.pointerId;
            try { el.setPointerCapture(pointerId); } catch {}
            el.classList.add('dragging');
            el.style.transition = 'none';
            this.pieces.appendChild(el);
            const rect = el.getBoundingClientRect();
            origX = rect.left;
            origY = rect.top;
            startX = e.clientX;
            startY = e.clientY;
            el.style.left = origX + 'px';
            el.style.top = origY + 'px';
        };

        const onMove = (e) => {
            if (pointerId === null || pointerId !== e.pointerId) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            el.style.left = (origX + dx) + 'px';
            el.style.top = (origY + dy) + 'px';
        };

        const onUp = (e) => {
            if (pointerId === null) return;
            try { el.releasePointerCapture(pointerId); } catch {}
            pointerId = null;
            el.classList.remove('dragging');
            this._tryDrop(el, row, col);
        };

        el.addEventListener('pointerdown', onDown);
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp);
        el.addEventListener('pointercancel', onUp);
    }

    _tryDrop(el, row, col) {
        const boardRect = this.board.getBoundingClientRect();
        const target = this._targetFor(row, col, boardRect);
        const cx = parseFloat(el.style.left);
        const cy = parseFloat(el.style.top);
        const dist = Math.hypot(cx - target.x, cy - target.y);
        const snap = Math.min(this.pieceW, this.pieceH) * SNAP_RATIO;
        const meta = this._stateFor(row, col);
        if (dist <= snap) {
            el.style.transition = 'left 0.28s cubic-bezier(0.3, 1.5, 0.6, 1), top 0.28s cubic-bezier(0.3, 1.5, 0.6, 1)';
            el.style.left = target.x + 'px';
            el.style.top = target.y + 'px';
            el.classList.add('placed');
            if (!meta.placed) {
                meta.placed = true;
                this.placedCount++;
                this._saveScatterFractions();
                if (this.placedCount >= ROWS * COLS) {
                    this.state.complete = true;
                    saveState(this.state);
                    setTimeout(() => this.dispatchEvent(new Event('complete')), 480);
                } else {
                    saveState(this.state);
                }
            }
        } else {
            const vw = window.innerWidth, vh = window.innerHeight;
            const canvasW = this.pieceW + 2 * this.tab;
            const canvasH = this.pieceH + 2 * this.tab;
            meta.xFrac = Math.max(0, Math.min(1, cx / Math.max(1, vw - canvasW)));
            meta.yFrac = Math.max(0, Math.min(1, cy / Math.max(1, vh - canvasH)));
            saveState(this.state);
        }
    }

    _saveScatterFractions() {
        const vw = window.innerWidth, vh = window.innerHeight;
        const canvasW = this.pieceW + 2 * this.tab;
        const canvasH = this.pieceH + 2 * this.tab;
        for (const el of this.pieceEls) {
            if (el.classList.contains('placed')) continue;
            const meta = this._stateFor(+el.dataset.row, +el.dataset.col);
            const x = parseFloat(el.style.left);
            const y = parseFloat(el.style.top);
            meta.xFrac = Math.max(0, Math.min(1, x / Math.max(1, vw - canvasW)));
            meta.yFrac = Math.max(0, Math.min(1, y / Math.max(1, vh - canvasH)));
        }
    }

    _handleResize() {
        this._layout();
        this._createPieces();
        this._placeFromState();
    }

    // Cheat code: snap every remaining piece into place with a quick stagger
    // so the "complete" event fires the same way as a real solve.
    autocomplete() {
        if (this.state.complete) return;
        const boardRect = this.board.getBoundingClientRect();
        const remaining = this.pieceEls.filter(el => !el.classList.contains('placed'));
        if (!remaining.length) {
            this.state.complete = true;
            saveState(this.state);
            this.dispatchEvent(new Event('complete'));
            return;
        }
        const stepMs = 70;
        remaining.forEach((el, i) => {
            const row = +el.dataset.row, col = +el.dataset.col;
            const target = this._targetFor(row, col, boardRect);
            setTimeout(() => {
                el.style.transition = 'left 0.55s cubic-bezier(0.3, 1.4, 0.5, 1), top 0.55s cubic-bezier(0.3, 1.4, 0.5, 1)';
                el.style.left = target.x + 'px';
                el.style.top = target.y + 'px';
                el.classList.add('placed');
                const meta = this._stateFor(row, col);
                if (meta) meta.placed = true;
                this.placedCount++;
            }, i * stepMs);
        });
        const totalMs = remaining.length * stepMs + 650;
        setTimeout(() => {
            this.state.complete = true;
            saveState(this.state);
            this.dispatchEvent(new Event('complete'));
        }, totalMs);
    }

    reset() {
        if (!confirm('Clear puzzle progress and start over?')) return;
        clearCookie(COOKIE_NAME);
        this.state = this._freshState();
        saveState(this.state);
        this.placedCount = 0;
        this._createPieces();
        this._placeFromState();
        this.dispatchEvent(new Event('reset'));
    }

    // Pieces' outline strokes — what we erase when play is pressed.
    gridLineEls() {
        const out = [];
        for (const el of this.pieceEls) {
            const stroke = el.querySelector('.piece-stroke');
            if (stroke) out.push(stroke);
        }
        return out;
    }
}
