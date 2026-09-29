// Jigsaw geometry.
//
// Every internal cut between two pieces is ONE chain of three cubic Beziers
// (shoulder -> neck -> round head -> neck -> shoulder), generated once and
// shared: one piece traces it forwards, its neighbour traces it backwards, so
// they always interlock exactly. Knob size, position and lean vary per edge.
// The curve construction follows the well-known parametrisation used by
// Draradech's jigsaw generator (public domain).

import { mulberry32 } from './store.js';

const J = 0.05;                   // jitter of the control points
const f = (n) => Math.round(n * 100) / 100;

export function makeGeometry({ cols, rows, width, height, seed }) {
    const pw = width / cols;
    const ph = height / rows;
    const rng = mulberry32(seed);
    const uniform = (lo, hi) => lo + rng() * (hi - lo);

    // One grid line = a run of edges. `at(k, l, w)` maps (edge k, position l
    // along it 0..1, offset w across it) to board coordinates.
    function run(count, at) {
        const edges = [];
        let flip = rng() > 0.5;
        let e = uniform(-J, J);
        for (let k = 0; k < count; k++) {
            const flipOld = flip;
            flip = rng() > 0.5;
            const a = flip === flipOld ? -e : e;   // keeps the line smooth where edges meet
            const b = uniform(-J, J);
            const c = uniform(-J, J);
            const d = uniform(-J, J);
            e = uniform(-J, J);
            const t = uniform(0.085, 0.115);       // knob size
            const s = flip ? -1 : 1;               // which neighbour gets the knob
            const P = (l, w) => at(k, l, w * s);
            edges.push([
                P(0, 0), P(0.2, a), P(0.5 + b + d, -t + c), P(0.5 - t + b, t + c),
                P(0.5 - 2 * t + b - d, 3 * t + c), P(0.5 + 2 * t + b - d, 3 * t + c), P(0.5 + t + b, t + c),
                P(0.5 + b + d, -t + c), P(0.8, e), P(1, 0),
            ]);
        }
        return edges;
    }

    // hLines[r-1]: the cut between row r-1 and r, left -> right, one edge per column.
    const hLines = [];
    for (let r = 1; r < rows; r++) {
        hLines.push(run(cols, (k, l, w) => [(k + l) * pw, r * ph + w * ph]));
    }
    // vLines[c-1]: the cut between col c-1 and c, top -> bottom, one edge per row.
    const vLines = [];
    for (let c = 1; c < cols; c++) {
        vLines.push(run(rows, (k, l, w) => [c * pw + w * pw, (k + l) * ph]));
    }

    // Each piece lives in a box padded by M: room for the deepest knob plus its shadow.
    const M = Math.ceil(0.31 * Math.max(pw, ph)) + 26;

    const chain = (p, rev, ox, oy) => {
        const q = (i) => `${f(p[i][0] - ox)} ${f(p[i][1] - oy)}`;
        return rev
            ? `C ${q(8)} ${q(7)} ${q(6)} C ${q(5)} ${q(4)} ${q(3)} C ${q(2)} ${q(1)} ${q(0)} `
            : `C ${q(1)} ${q(2)} ${q(3)} C ${q(4)} ${q(5)} ${q(6)} C ${q(7)} ${q(8)} ${q(9)} `;
    };

    return {
        cols, rows, width, height, pw, ph, M,

        /** Centre of a piece's home cell. */
        home(r, c) { return { x: (c + 0.5) * pw, y: (r + 0.5) * ph }; },

        /** Closed outline of piece (r, c), in coordinates local to its padded box. */
        piecePath(r, c) {
            const ox = c * pw - M, oy = r * ph - M;
            const L = (x, y) => `L ${f(x - ox)} ${f(y - oy)} `;
            const x0 = c * pw, x1 = (c + 1) * pw, y0 = r * ph, y1 = (r + 1) * ph;
            let d = `M ${f(x0 - ox)} ${f(y0 - oy)} `;
            d += r === 0 ? L(x1, y0) : chain(hLines[r - 1][c], false, ox, oy);          // top,    left -> right
            d += c === cols - 1 ? L(x1, y1) : chain(vLines[c][r], false, ox, oy);       // right,  top -> bottom
            d += r === rows - 1 ? L(x0, y1) : chain(hLines[r][c], true, ox, oy);        // bottom, right -> left
            d += c === 0 ? L(x0, y0) : chain(vLines[c - 1][r], true, ox, oy);           // left,   bottom -> top
            return d + 'Z';
        },

        /** Every internal cut exactly once, in board coordinates (for the line-wipe). */
        cutPaths() {
            const out = [];
            const one = (p) => `M ${f(p[0][0])} ${f(p[0][1])} ` + chain(p, false, 0, 0);
            for (const line of hLines) for (const edge of line) out.push(one(edge));
            for (const line of vLines) for (const edge of line) out.push(one(edge));
            return out;
        },
    };
}
