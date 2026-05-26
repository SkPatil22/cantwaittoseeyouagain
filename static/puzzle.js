// Jigsaw puzzle with cookie-persisted progress.
//
// Pieces are drawn as SVG paths (interior rectangle + four jigsaw edges).
// Edges are deterministic per seed so a reload reproduces the same layout.
// Placement and seed live in a single cookie (`puzzle_state`).

const COLS = 6;
const ROWS = 4;
const TAB_RATIO = 0.22;           // tab depth as fraction of min(pieceW, pieceH)
const SNAP_RATIO = 0.35;          // snap radius as fraction of min(pieceW, pieceH)
const COOKIE_NAME = 'puzzle_state';
const COOKIE_DAYS = 60;
const PUZZLE_IMG = '/assets/puzzle.jpg';

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
    // Neck points along the edge, r either side of midpoint.
    const n1 = [midX - ux * r, midY - uy * r];
    const n2 = [midX + ux * r, midY + uy * r];
    // sweep-flag: 1 for outward bulge (path going CW around piece), 0 for inward.
    const sweep = edgeVal > 0 ? 1 : 0;
    return `L ${n1[0].toFixed(2)} ${n1[1].toFixed(2)} ` +
           `A ${r} ${r} 0 0 ${sweep} ${n2[0].toFixed(2)} ${n2[1].toFixed(2)} ` +
           `L ${to[0]} ${to[1]} `;
}

function buildPiecePath(W, H, T, edges) {
    const r = T;
    // interior corners
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
    constructor({ boardEl, piecesEl, resetBtn }) {
        super();
        this.board = boardEl;
        this.pieces = piecesEl;
        this.resetBtn = resetBtn;
        this.state = null;
        this.placedCount = 0;
        this.pieceEls = [];
        this._suspendSave = false;

        if (this.resetBtn) {
            this.resetBtn.addEventListener('click', () => this.reset());
        }
        window.addEventListener('resize', () => this._handleResize());
    }

    async init() {
        await this._waitForImage(PUZZLE_IMG);
        this._loadOrCreateState();
        this._layout();
        this._renderBoard();
        this._createPieces();
        this._placeFromState();
        if (this.state.complete) {
            // Reload of a solved puzzle: surface the play button right away.
            this.board.classList.add('solved');
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
        // Interior edges. hEdges[r][c] is the edge between piece(r,c)'s bottom
        // and piece(r+1,c)'s top, expressed from piece(r,c)'s perspective.
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
        // Scatter positions are stored as fractions of viewport so they
        // survive resize gracefully.
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
        // Shuffle stacking order so pieces overlap unpredictably.
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
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // Leave headroom around the puzzle so pieces can sit beside it.
        const margin = Math.min(vw, vh) * 0.04;
        const availW = vw - margin * 2;
        const availH = vh * 0.78 - margin * 2;
        const targetRatio = 16 / 9;
        let boardW = availW;
        let boardH = boardW / targetRatio;
        if (boardH > availH) {
            boardH = availH;
            boardW = boardH * targetRatio;
        }
        // Cap so big monitors don't blow up piece sizes.
        const maxW = 1280;
        if (boardW > maxW) { boardW = maxW; boardH = boardW / targetRatio; }
        this.boardW = Math.floor(boardW);
        this.boardH = Math.floor(boardH);
        this.pieceW = this.boardW / COLS;
        this.pieceH = this.boardH / ROWS;
        this.tab = Math.min(this.pieceW, this.pieceH) * TAB_RATIO;
        this.board.style.width = this.boardW + 'px';
        this.board.style.height = this.boardH + 'px';
    }

    _renderBoard() {
        // Interior cuts: ROWS-1 horizontal jigsaw lines + COLS-1 vertical jigsaw
        // lines, each one a single open path with clear endpoints so the play-
        // button erase animation can wipe them off "from one end to the other".
        let svg = this.board.querySelector('#grid-lines');
        if (!svg) {
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('id', 'grid-lines');
            svg.style.position = 'absolute';
            svg.style.inset = '0';
            this.board.appendChild(svg);
        }
        svg.setAttribute('width', this.boardW);
        svg.setAttribute('height', this.boardH);
        svg.setAttribute('viewBox', `0 0 ${this.boardW} ${this.boardH}`);
        svg.innerHTML = '';

        const T = this.tab;
        // Horizontal cuts: between row r and row r+1.
        // Note: edgeSegment's bulge sign is calibrated for the piece-outline
        // traversal (which walks the bottom edge right-to-left). When we walk
        // a horizontal cut left-to-right we invert the edge value so the cut
        // bulges in the same on-screen direction as the matching piece edges.
        for (let r = 0; r < ROWS - 1; r++) {
            const y = (r + 1) * this.pieceH;
            let d = `M 0 ${y} `;
            for (let c = 0; c < COLS; c++) {
                const from = [c * this.pieceW, y];
                const to   = [(c + 1) * this.pieceW, y];
                d += edgeSegment(from, to, -this.state.hEdges[r][c], T);
            }
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d);
            path.dataset.kind = 'h';
            path.dataset.r = r;
            svg.appendChild(path);
        }
        // Vertical cuts: between col c and col c+1.
        for (let c = 0; c < COLS - 1; c++) {
            const x = (c + 1) * this.pieceW;
            let d = `M ${x} 0 `;
            for (let r = 0; r < ROWS; r++) {
                const from = [x, r * this.pieceH];
                const to   = [x, (r + 1) * this.pieceH];
                d += edgeSegment(from, to, this.state.vEdges[r][c], T);
            }
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d);
            path.dataset.kind = 'v';
            path.dataset.c = c;
            svg.appendChild(path);
        }
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

        // The image is sized to the full puzzle, positioned so the piece's
        // interior cell shows the correct slice. The +/-T offset keeps the
        // tab area filled with the neighbour's pixels (the jigsaw look).
        const img = document.createElementNS(svgNS, 'image');
        img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', PUZZLE_IMG);
        img.setAttribute('href', PUZZLE_IMG);
        img.setAttribute('width', this.boardW);
        img.setAttribute('height', this.boardH);
        img.setAttribute('x', T - col * W);
        img.setAttribute('y', T - row * H);
        img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
        img.setAttribute('clip-path', `url(#${clipId})`);
        svg.appendChild(img);

        // Subtle white edge stroke on the outline so pieces read against bg.
        const stroke = document.createElementNS(svgNS, 'path');
        stroke.setAttribute('d', d);
        stroke.setAttribute('fill', 'none');
        stroke.setAttribute('stroke', 'rgba(255,255,255,0.18)');
        stroke.setAttribute('stroke-width', '1');
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
                // Convert frac → pixel, clamp so piece stays mostly on screen.
                const canvasW = this.pieceW + 2 * this.tab;
                const canvasH = this.pieceH + 2 * this.tab;
                const x = meta.xFrac * (vw - canvasW);
                const y = meta.yFrac * (vh - canvasH);
                el.style.left = x + 'px';
                el.style.top = y + 'px';
            }
        }
    }

    _stateFor(row, col) {
        return this.state.pieces.find(p => p.row === row && p.col === col);
    }

    _targetFor(row, col, boardRect) {
        // Where the piece's HTML element's top-left should land so its
        // interior cell aligns with the grid cell.
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
            // Disable any inherited transition so dragging stays 1:1 with the
            // pointer (snap-back animation gets re-enabled on release).
            el.style.transition = 'none';
            // Bring to front
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
            // Smooth snap to slot.
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
                    this.board.classList.add('solved');
                    // small delay so the snap animation reads
                    setTimeout(() => this.dispatchEvent(new Event('complete')), 480);
                } else {
                    saveState(this.state);
                }
            }
        } else {
            // store new scatter position as fractions
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
        // Recompute layout and reposition. Scatter positions follow fractions.
        this._layout();
        this._renderBoard();
        // Rebuild pieces so their geometry matches the new piece size.
        const placedSet = new Set(
            this.state.pieces.filter(p => p.placed).map(p => `${p.row},${p.col}`)
        );
        this._createPieces();
        // Restore placed/scatter from state
        for (const el of this.pieceEls) {
            const row = +el.dataset.row, col = +el.dataset.col;
            if (placedSet.has(`${row},${col}`)) {
                el.classList.add('placed');
            }
        }
        this._placeFromState();
    }

    reset() {
        if (!confirm('Clear puzzle progress and start over?')) return;
        clearCookie(COOKIE_NAME);
        this.state = this._freshState();
        saveState(this.state);
        this.placedCount = 0;
        this.board.classList.remove('solved');
        this._renderBoard();
        this._createPieces();
        this._placeFromState();
        // Hide any visible play overlay if shown
        this.dispatchEvent(new Event('reset'));
    }

    // Used by app.js for the line-erase animation.
    gridLineEls() {
        const svg = this.board.querySelector('#grid-lines');
        return svg ? Array.from(svg.querySelectorAll('path')) : [];
    }
}
