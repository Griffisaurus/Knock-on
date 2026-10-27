"""In-house BC7 encoder and reference decoder (D94, ASSET_PIPELINE §5.3; M4 stream V4).

Pure numpy, no Blender needed (`bpy` is never imported), so it runs in Blender's bundled Python and in a
system Python alike.

Modes, chosen per 4x4 block by measured (weighted squared) error:
  6  one subset, RGBA 7.7.7.7 + a p-bit per endpoint, 4-bit indices      (smooth blocks)
  1  two subsets, RGB 6.6.6 + a shared p-bit per subset, 3-bit indices    (edges, two colours)
  3  two subsets, RGB 7.7.7 + a p-bit per endpoint, 2-bit indices         (edges, precise endpoints)
  5  one subset, RGB 7.7.7 + A 8 with 2-bit indices each and a channel rotation, so one channel
     (any of R, G, B) gets its own endpoints and indices: maps whose channels don't share a line (ORM)
The two-subset modes try the K partitions (of the 64) whose least-squares line fit leaves the least
residual (exact integer statistics), each fully quantised and scored.

Deterministic: same pixels in, same bytes out, on any machine and numpy version. Block statistics are
integer sums (exact); the floating-point part (the principal axis, least-squares endpoint refits) uses
only element-wise IEEE operations in a fixed order (no BLAS, no matmul, no unordered reductions), and
every decision compares integer errors with a fixed tie order (lower mode table position, lower
partition rank, first index).
"""

import numpy as np

# ---------------------------------------------------------------- tables (BC7 specification)

WEIGHTS = {
    2: np.array([0, 21, 43, 64], np.int32),
    3: np.array([0, 9, 18, 27, 37, 46, 55, 64], np.int32),
    4: np.array([0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64], np.int32),
}

# Two-subset partitions: subset of each pixel (row-major within the block), 64 shapes.
_P2 = (
    '0011001100110011 0001000100010001 0111011101110111 0001001100110111 '
    '0000000100010011 0011011101111111 0001001101111111 0000000100110111 '
    '0000000000010011 0011011111111111 0000000101111111 0000000000010111 '
    '0001011111111111 0000000011111111 0000111111111111 0000000000001111 '
    '0000100011101111 0111000100000000 0000000010001110 0111001100010000 '
    '0011000100000000 0000100011001110 0000000010001100 0111001100110001 '
    '0011000100010000 0000100010001100 0110011001100110 0011011001101100 '
    '0001011111101000 0000111111110000 0111000110001110 0011100110011100 '
    '0101010101010101 0000111100001111 0101101001011010 0011001111001100 '
    '0011110000111100 0101010110101010 0110100101101001 0101101010100101 '
    '0111001111001110 0001001111001000 0011001001001100 0011101111011100 '
    '0110100110010110 0011110011000011 0110011010011001 0000011001100000 '
    '0100111001000000 0010011100100000 0000001001110010 0000010011100100 '
    '0110110010010011 0011011011001001 0110001110011100 0011100111000110 '
    '0110110011001001 0110001100111001 0111111010000001 0001100011100111 '
    '0000111100110011 0011001111110000 0010001011101110 0100010001110111'
)
PART2 = np.array([[int(c) for c in row] for row in _P2.split()], np.int32)
# Anchor (fix-up) pixel of subset 1 for each two-subset partition; subset 0's anchor is pixel 0.
ANCHOR2 = np.array([
    15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15,
    15, 2, 8, 2, 2, 8, 8, 15, 2, 8, 2, 2, 8, 8, 2, 2,
    15, 15, 6, 8, 2, 8, 15, 15, 2, 8, 2, 2, 2, 15, 15, 6,
    6, 2, 6, 8, 15, 15, 2, 2, 15, 15, 15, 15, 15, 2, 2, 15], np.int32)

assert PART2.shape == (64, 16) and (PART2[:, 0] == 0).all()
assert (PART2[np.arange(64), ANCHOR2] == 1).all()

# mode: (subsets, partition bits, rotation bits, colour bits, alpha bits, p-bits, index bits, 2nd index bits)
MODES = {
    1: (2, 6, 0, 6, 0, 'shared', 3, 0),
    3: (2, 6, 0, 7, 0, 'unique', 2, 0),
    5: (1, 0, 2, 7, 8, None, 2, 2),
    6: (1, 0, 0, 7, 7, 'unique', 4, 0),
}


def _expand(v, nb):
    v = np.asarray(v, np.int32)
    return v if nb >= 8 else (v << (8 - nb)) | (v >> (2 * nb - 8))


def _qtable(bits, p):
    """Decoded 8-bit value of every code (with p-bit `p`, or None)."""
    q = np.arange(1 << bits, dtype=np.int32)
    return _expand(q, bits) if p is None else _expand((q << 1) | p, bits + 1)


_QT = {}


def _table(bits, p):
    k = (bits, p)
    if k not in _QT:
        t = _qtable(bits, p)
        assert (np.diff(t) > 0).all()
        _QT[k] = t
    return _QT[k]


def _nearest(e, table):
    """Code whose decoded value is nearest to float `e` (ties: the lower code)."""
    i = np.clip(np.searchsorted(table, e), 1, len(table) - 1)
    lo, hi = table[i - 1], table[i]
    up = (hi - e) < (e - lo)
    q = np.where(up, i, i - 1).astype(np.int32)
    return q, table[q]


# ---------------------------------------------------------------- blocks

def to_blocks(img):
    """H x W x 4 uint8 (H, W multiples of 4) -> (N, 16, 4) int32, blocks in raster order."""
    h, w, c = img.shape
    b = img.reshape(h // 4, 4, w // 4, 4, c).transpose(0, 2, 1, 3, 4).reshape(-1, 16, c)
    return b.astype(np.int32)


def from_blocks(b, h, w):
    c = b.shape[-1]
    return b.reshape(h // 4, w // 4, 4, 4, c).transpose(0, 2, 1, 3, 4).reshape(h, w, c)


def pad_to_blocks(img):
    """Pads (edge-replicates) an image whose sides aren't multiples of 4 (mips 2x2, 1x1)."""
    h, w = img.shape[:2]
    H, W = max(4, (h + 3) // 4 * 4), max(4, (w + 3) // 4 * 4)
    if (H, W) == (h, w):
        return img
    yy = np.minimum(np.arange(H), h - 1)
    xx = np.minimum(np.arange(W), w - 1)
    return img[yy][:, xx]


def _sum16(a):
    """Fixed-order sum over axis 1 (pixels) of a float array."""
    s = a[:, 0].copy()
    for k in range(1, a.shape[1]):
        s += a[:, k]
    return s


# ---------------------------------------------------------------- one subset: fit + quantise

def _palette(v0, v1, ib):
    wt = WEIGHTS[ib]
    return ((64 - wt)[None, :, None] * v0[:, None, :] + wt[None, :, None] * v1[:, None, :] + 32) >> 6


def _assign(X, M, w, v0, v1, ib):
    """Best index per pixel and the subset's error. X (N,16,C), M (N,16) bool, v0/v1 (N,C) decoded."""
    pal = _palette(v0, v1, ib)                                  # (N, I, C)
    d = X[:, :, None, :] - pal[:, None, :, :]                   # (N, 16, I, C)
    e = (d * d * w).sum(-1)                                     # (N, 16, I) int, exact
    idx = e.argmin(-1).astype(np.int32)
    emin = np.take_along_axis(e, idx[..., None], -1)[..., 0]
    return idx, (emin * M).sum(1, dtype=np.int64)


def _quantise_eval(X, M, w, E0, E1, bits, pmode, ib):
    """Tries the p-bit choices for float endpoints E0/E1; returns the best (err, q0, q1, p0, p1, idx)."""
    combos = {'unique': [(0, 0), (0, 1), (1, 0), (1, 1)], 'shared': [(0, 0), (1, 1)], None: [(None, None)]}[pmode]
    best = None
    for pa, pb in combos:
        q0, v0 = _nearest(E0, _table(bits, pa))
        q1, v1 = _nearest(E1, _table(bits, pb))
        idx, err = _assign(X, M, w, v0, v1, ib)
        n = X.shape[0]
        cand = (err, q0, q1, np.full(n, pa or 0, np.int32), np.full(n, pb or 0, np.int32), idx)
        if best is None:
            best = cand
        else:
            better = cand[0] < best[0]
            best = tuple(np.where(better.reshape((-1,) + (1,) * (a.ndim - 1)), a, b) for a, b in zip(cand, best))
    return best


def _pca_endpoints(X, M, w):
    """Float endpoints along the weighted principal axis of the member pixels."""
    n = M.sum(1).astype(np.int64)
    nn = np.maximum(n, 1)
    Xm = X * M[..., None]
    C = X.shape[2]
    S1 = Xm.sum(1, dtype=np.int64)                               # (N, C)
    sw = np.sqrt(w.astype(np.float64))
    mean = S1 / nn[:, None]
    cov = np.empty((X.shape[0], C, C))
    for c in range(C):
        for d in range(c, C):
            s2 = (Xm[:, :, c].astype(np.int64) * X[:, :, d]).sum(1)
            v = (s2 * nn - S1[:, c] * S1[:, d]) / (nn * nn) * (sw[c] * sw[d])
            cov[:, c, d] = v
            cov[:, d, c] = v
    # start from the column of the largest variance, then power-iterate (element-wise, fixed order)
    diag = np.stack([cov[:, c, c] for c in range(C)], 1)
    k = diag.argmax(1)
    v = np.take_along_axis(cov, k[:, None, None], 2)[:, :, 0].copy()
    for _ in range(8):
        nv = cov[:, :, 0] * v[:, 0:1]
        for c in range(1, C):
            nv = nv + cov[:, :, c] * v[:, c:c + 1]
        m = np.abs(nv).max(1, keepdims=True)
        v = np.where(m > 1e-12, nv / np.where(m > 1e-12, m, 1.0), v)
    norm = np.sqrt(sum(v[:, c] * v[:, c] for c in range(C)))
    flat = norm < 1e-12
    v = np.where(flat[:, None], 1.0 / np.sqrt(C), v / np.where(flat, 1.0, norm)[:, None])
    t = (X[:, :, 0] - mean[:, 0:1]) * (sw[0] * v[:, 0:1])
    for c in range(1, C):
        t = t + (X[:, :, c] - mean[:, c:c + 1]) * (sw[c] * v[:, c:c + 1])
    tmin = np.where(M, t, np.inf).min(1)
    tmax = np.where(M, t, -np.inf).max(1)
    tmin = np.where(np.isfinite(tmin), tmin, 0.0)
    tmax = np.where(np.isfinite(tmax), tmax, 0.0)
    ax = v / sw[None, :]
    E0 = np.clip(mean + tmin[:, None] * ax, 0, 255)
    E1 = np.clip(mean + tmax[:, None] * ax, 0, 255)
    return E0, E1


def _refit(X, M, idx, ib):
    """Least-squares endpoints for fixed indices; None where the system is singular."""
    a = WEIGHTS[ib][idx] / 64.0                                   # (N, 16)
    m = M.astype(np.float64)
    b = 1.0 - a
    A00 = _sum16(m * b * b)
    A01 = _sum16(m * b * a)
    A11 = _sum16(m * a * a)
    det = A00 * A11 - A01 * A01
    ok = det > 1e-6
    dd = np.where(ok, det, 1.0)
    E0 = np.empty(X.shape[0:1] + X.shape[2:])
    E1 = np.empty_like(E0)
    for c in range(X.shape[2]):
        x = X[:, :, c].astype(np.float64)
        b0 = _sum16(m * b * x)
        b1 = _sum16(m * a * x)
        E0[:, c] = (A11 * b0 - A01 * b1) / dd
        E1[:, c] = (A00 * b1 - A01 * b0) / dd
    return np.clip(E0, 0, 255), np.clip(E1, 0, 255), ok


def fit_subset(X, M, w, bits, pmode, ib, refine=2):
    """Encodes the member pixels of one subset: (err, q0, q1, p0, p1, idx)."""
    E0, E1 = _pca_endpoints(X, M, w)
    best = _quantise_eval(X, M, w, E0, E1, bits, pmode, ib)
    for _ in range(refine):
        R0, R1, ok = _refit(X, M, best[5], ib)
        cand = _quantise_eval(X, M, w, R0, R1, bits, pmode, ib)
        better = ok & (cand[0] < best[0])
        best = tuple(np.where(better.reshape((-1,) + (1,) * (a.ndim - 1)), a, b) for a, b in zip(cand, best))
    return best


# ---------------------------------------------------------------- partition ranking

_OUTER = [(c, d) for c in range(3) for d in range(c, 3)]


def rank_partitions(X3, w3, k):
    """The k two-subset partitions with the least line-fit residual per block (exact integer sums)."""
    N = X3.shape[0]
    M1 = PART2.astype(np.int64)                                    # (64, 16)
    X = X3.astype(np.int64)
    S1_1 = np.einsum('pk,nkc->npc', M1, X)                         # (N, 64, 3)
    S1_a = X.sum(1)[:, None, :]
    n1 = M1.sum(1)[None, :]                                        # (1, 64)
    n0 = 16 - n1
    O = np.stack([X[:, :, c] * X[:, :, d] for c, d in _OUTER], 2)  # (N, 16, 6)
    S2_1 = np.einsum('pk,nkj->npj', M1, O)
    S2_a = O.sum(1)[:, None, :]
    sw = np.sqrt(w3.astype(np.float64))
    resid = np.zeros((N, 64))
    for S1, S2, n in ((S1_1, S2_1, n1), (S1_a - S1_1, S2_a - S2_1, n0)):
        cov = np.empty((N, 64, 3, 3))
        for j, (c, d) in enumerate(_OUTER):
            v = (S2[..., j] * n - S1[..., c] * S1[..., d]) / n * (sw[c] * sw[d])   # n x covariance (SSE form)
            cov[..., c, d] = v
            cov[..., d, c] = v
        tr = cov[..., 0, 0] + cov[..., 1, 1] + cov[..., 2, 2]
        v = np.ones((N, 64, 3))
        for _ in range(6):
            nv = cov[..., :, 0] * v[..., 0:1] + cov[..., :, 1] * v[..., 1:2] + cov[..., :, 2] * v[..., 2:3]
            m = np.abs(nv).max(-1, keepdims=True)
            v = np.where(m > 1e-12, nv / np.where(m > 1e-12, m, 1.0), v)
        nrm2 = v[..., 0] * v[..., 0] + v[..., 1] * v[..., 1] + v[..., 2] * v[..., 2]
        Cv = cov[..., :, 0] * v[..., 0:1] + cov[..., :, 1] * v[..., 1:2] + cov[..., :, 2] * v[..., 2:3]
        lam = (Cv[..., 0] * v[..., 0] + Cv[..., 1] * v[..., 1] + Cv[..., 2] * v[..., 2]) / np.maximum(nrm2, 1e-30)
        resid += np.maximum(tr - lam, 0.0)
    # stable sort: equal residuals keep partition order
    return np.argsort(resid, axis=1, kind='stable')[:, :k].astype(np.int32)


# ---------------------------------------------------------------- modes

def _alpha_err(X, M, w):
    a = 255 - X[:, :, 3]
    return (a * a * w[3] * M).sum(1, dtype=np.int64)


def encode_mode6(X, w):
    M = np.ones(X.shape[:2], bool)
    err, q0, q1, p0, p1, idx = fit_subset(X, M, w, 7, 'unique', 4)
    return err, {'q0': q0, 'q1': q1, 'p0': p0, 'p1': p1, 'idx': idx}


def encode_two(X, w, parts, mode):
    """Modes 1 / 3 over the candidate partitions `parts` (N, K); the best candidate per block."""
    bits, pmode, ib = (6, 'shared', 3) if mode == 1 else (7, 'unique', 2)
    X3, w3 = X[:, :, :3], w[:3]
    best = None
    for j in range(parts.shape[1]):
        p = parts[:, j]
        sub = PART2[p]                                            # (N, 16)
        res = [fit_subset(X3, sub == s, w3, bits, pmode, ib) for s in (0, 1)]
        err = res[0][0] + res[1][0] + _alpha_err(X, np.ones_like(sub, bool), w)
        idx = np.where(sub == 0, res[0][5], res[1][5])
        cand = (err, p, res[0][1], res[0][2], res[1][1], res[1][2], res[0][3], res[0][4], res[1][3], res[1][4], idx)
        if best is None:
            best = cand
        else:
            better = cand[0] < best[0]
            best = tuple(np.where(better.reshape((-1,) + (1,) * (a.ndim - 1)), a, b) for a, b in zip(cand, best))
    err, p, a0, a1, b0, b1, pa0, pa1, pb0, pb1, idx = best
    return err, {'part': p, 'q': [a0, a1, b0, b1], 'p': [pa0, pa1, pb0, pb1], 'idx': idx}


def encode_mode5(X, w):
    """Mode 5 with each rotation (1: R, 2: G, 3: B coded as the separate 'alpha'); opaque alpha only."""
    best = None
    M = np.ones(X.shape[:2], bool)
    for rot in (1, 2, 3):
        c = rot - 1
        Xr = X.copy()
        Xr[:, :, [c, 3]] = X[:, :, [3, c]]                         # the decoder swaps them back
        wr = w.copy()
        wr[[c, 3]] = w[[3, c]]
        col = fit_subset(Xr[:, :, :3], M, wr[:3], 7, None, 2)
        al = fit_subset(Xr[:, :, 3:4], M, wr[3:4], 8, None, 2)
        err = col[0] + al[0]
        cand = (err, np.full(X.shape[0], rot, np.int32), col[1], col[2], col[5], al[1], al[2], al[5])
        if best is None:
            best = cand
        else:
            better = cand[0] < best[0]
            best = tuple(np.where(better.reshape((-1,) + (1,) * (a.ndim - 1)), a, b) for a, b in zip(cand, best))
    err, rot, c0, c1, ci, a0, a1, ai = best
    return err, {'rot': rot, 'c0': c0, 'c1': c1, 'ci': ci, 'a0': a0[:, 0], 'a1': a1[:, 0], 'ai': ai}


# ---------------------------------------------------------------- bit packing

def _pack(fields, n):
    lo = np.zeros(n, np.uint64)
    hi = np.zeros(n, np.uint64)
    off = np.zeros(n, np.int64)
    for v, wd in fields:
        v = np.broadcast_to(np.asarray(v), (n,)).astype(np.uint64)
        wd = np.broadcast_to(np.asarray(wd, np.int64), (n,))
        assert (v < (np.uint64(1) << wd.astype(np.uint64))).all(), 'field overflow'
        in_lo = off < 64
        lo |= np.where(in_lo, v << np.where(in_lo, off, 0).astype(np.uint64), np.uint64(0))
        spill = in_lo & (off + wd > 64)
        hi |= np.where(spill, v >> np.where(spill, 64 - off, 0).astype(np.uint64), np.uint64(0))
        in_hi = ~in_lo
        hi |= np.where(in_hi, v << np.where(in_hi, off - 64, 0).astype(np.uint64), np.uint64(0))
        off = off + wd
    assert (off == 128).all(), 'block is not 128 bits'
    return np.stack([lo, hi], 1).astype('<u8').view(np.uint8).reshape(n, 16)


def _fixup(q0, q1, p0, p1, idx, members, anchor, ib):
    """Swaps a subset's endpoints so its anchor index has a 0 MSB (the bit the format drops)."""
    n = idx.shape[0]
    top = 1 << (ib - 1)
    flip = idx[np.arange(n), anchor] >= top
    q0n = np.where(flip[:, None], q1, q0)
    q1n = np.where(flip[:, None], q0, q1)
    p0n = np.where(flip, p1, p0)
    p1n = np.where(flip, p0, p1)
    idx = np.where(flip[:, None] & members, (2 * top - 1) - idx, idx)
    return q0n, q1n, p0n, p1n, idx


def pack_mode6(e):
    n = e['idx'].shape[0]
    q0, q1, p0, p1, idx = _fixup(e['q0'], e['q1'], e['p0'], e['p1'], e['idx'], np.ones((n, 16), bool), np.zeros(n, np.int64), 4)
    f = [(1 << 6, 7)]
    for c in range(4):
        f += [(q0[:, c], 7), (q1[:, c], 7)]
    f += [(p0, 1), (p1, 1)]
    f += [(idx[:, k], 3 if k == 0 else 4) for k in range(16)]
    return _pack(f, n)


def pack_two(e, mode):
    n = e['idx'].shape[0]
    bits, ib = (6, 3) if mode == 1 else (7, 2)
    part = e['part']
    sub = PART2[part]
    a1 = ANCHOR2[part]
    q, p, idx = list(e['q']), list(e['p']), e['idx']
    q[0], q[1], p[0], p[1], idx = _fixup(q[0], q[1], p[0], p[1], idx, sub == 0, np.zeros(n, np.int64), ib)
    q[2], q[3], p[2], p[3], idx = _fixup(q[2], q[3], p[2], p[3], idx, sub == 1, a1, ib)
    f = [(1 << mode, mode + 1), (part, 6)]
    for c in range(3):
        f += [(q[k][:, c], bits) for k in range(4)]
    if mode == 1:
        f += [(p[0], 1), (p[2], 1)]                                # shared: one per subset (p0 == p1)
    else:
        f += [(p[k], 1) for k in range(4)]
    for k in range(16):
        anchor = (k == 0) | (a1 == k)
        f.append((idx[:, k], np.where(anchor, ib - 1, ib)))
    return _pack(f, n)


def pack_mode5(e):
    n = e['ci'].shape[0]
    z = np.zeros(n, np.int32)
    allm = np.ones((n, 16), bool)
    a0 = np.zeros(n, np.int64)
    c0, c1, _, _, ci = _fixup(e['c0'], e['c1'], z, z, e['ci'], allm, a0, 2)
    A0, A1, _, _, ai = _fixup(e['a0'][:, None], e['a1'][:, None], z, z, e['ai'], allm, a0, 2)
    f = [(1 << 5, 6), (e['rot'], 2)]
    for c in range(3):
        f += [(c0[:, c], 7), (c1[:, c], 7)]
    f += [(A0[:, 0], 8), (A1[:, 0], 8)]
    f += [(ci[:, k], 1 if k == 0 else 2) for k in range(16)]
    f += [(ai[:, k], 1 if k == 0 else 2) for k in range(16)]
    return _pack(f, n)


# ---------------------------------------------------------------- reference decoder

def _getbits(lo, hi, off, nb):
    off = np.broadcast_to(np.asarray(off, np.int64), lo.shape)
    nb = np.broadcast_to(np.asarray(nb, np.int64), lo.shape)
    in_lo = off < 64
    r = np.where(in_lo, lo >> np.where(in_lo, off, 0).astype(np.uint64), np.uint64(0))
    spill = in_lo & (off + nb > 64) & (off > 0)
    r |= np.where(spill, hi << np.where(spill, 64 - off, 0).astype(np.uint64), np.uint64(0))
    r = np.where(in_lo, r, hi >> np.where(in_lo, 0, off - 64).astype(np.uint64))
    return (r & ((np.uint64(1) << nb.astype(np.uint64)) - np.uint64(1))).astype(np.int64)


def decode(blocks):
    """(N, 16) uint8 BC7 blocks -> (N, 16, 4) uint8 texels (modes 1, 3, 5, 6)."""
    blocks = np.ascontiguousarray(blocks, np.uint8).reshape(-1, 16)
    n = blocks.shape[0]
    q = blocks.view('<u8').reshape(n, 2)
    lo, hi = q[:, 0].copy(), q[:, 1].copy()
    b0 = blocks[:, 0].astype(np.int64)
    mode = np.full(n, -1, np.int64)
    for m in range(7, -1, -1):
        mode = np.where((b0 >> m) & 1 == 1, m, mode)
    out = np.zeros((n, 16, 4), np.uint8)
    for m in np.unique(mode):
        if int(m) not in MODES:
            raise ValueError('BC7 mode %d not supported by the reference decoder' % m)
        sel = np.nonzero(mode == m)[0]
        out[sel] = _decode_mode(int(m), lo[sel], hi[sel])
    return out


def _decode_mode(m, lo, hi):
    ns, pb, rb, cb, ab, pm, ib, ib2 = MODES[m]
    n = lo.shape[0]
    off = m + 1
    part = _getbits(lo, hi, off, pb) if pb else np.zeros(n, np.int64)
    off += pb
    rot = _getbits(lo, hi, off, rb) if rb else np.zeros(n, np.int64)
    off += rb
    ne = 2 * ns
    E = np.zeros((n, ne, 4), np.int64)
    for c in range(3):
        for e in range(ne):
            E[:, e, c] = _getbits(lo, hi, off, cb)
            off += cb
    if ab:
        for e in range(ne):
            E[:, e, 3] = _getbits(lo, hi, off, ab)
            off += ab
    nbits = [cb, cb, cb, ab]
    if pm == 'unique':
        P = np.stack([_getbits(lo, hi, off + e, 1) for e in range(ne)], 1)
        off += ne
    elif pm == 'shared':
        Ps = np.stack([_getbits(lo, hi, off + s, 1) for s in range(ns)], 1)
        P = np.repeat(Ps, 2, axis=1)
        off += ns
    else:
        P = None
    V = np.zeros_like(E)
    for c in range(4):
        if nbits[c] == 0:
            V[:, :, c] = 255
            continue
        if P is not None:
            V[:, :, c] = _expand(((E[:, :, c] << 1) | P).astype(np.int32), nbits[c] + 1)
        else:
            V[:, :, c] = _expand(E[:, :, c].astype(np.int32), nbits[c])
    sub = PART2[part] if ns == 2 else np.zeros((n, 16), np.int32)
    a1 = ANCHOR2[part] if ns == 2 else np.full(n, -1)
    idx = np.zeros((n, 16), np.int64)
    offv = np.full(n, off, np.int64)
    for k in range(16):
        w = np.where((k == 0) | (a1 == k), ib - 1, ib)
        idx[:, k] = _getbits(lo, hi, offv, w)
        offv = offv + w
    idx2 = None
    if ib2:
        idx2 = np.zeros((n, 16), np.int64)
        for k in range(16):
            w = ib2 - 1 if k == 0 else ib2
            idx2[:, k] = _getbits(lo, hi, offv, w)
            offv = offv + w
    assert (offv == 128).all()
    e0 = np.take_along_axis(V, (2 * sub)[:, :, None], 1)       # (n, 16, 4) endpoint 0 of each pixel's subset
    e1 = np.take_along_axis(V, (2 * sub + 1)[:, :, None], 1)
    wc = WEIGHTS[ib][idx][:, :, None]
    out = ((64 - wc) * e0 + wc * e1 + 32) >> 6
    if idx2 is not None:
        wa = WEIGHTS[ib2][idx2]
        out[:, :, 3] = ((64 - wa) * e0[:, :, 3] + wa * e1[:, :, 3] + 32) >> 6
    if rb:
        for r in (1, 2, 3):
            s = rot == r
            if s.any():
                t = out[s, :, r - 1].copy()
                out[s, :, r - 1] = out[s, :, 3]
                out[s, :, 3] = t
    return out.astype(np.uint8)


# ---------------------------------------------------------------- image encode

DEFAULT_MODES = (6, 1, 3)


def _best(cands):
    errs = np.stack([c[1] for c in cands], 1)
    return errs, errs.argmin(1)                                   # first minimum: modes in the given order


def encode_blocks(X, w, modes=DEFAULT_MODES, k=4, chunk=4096, skip=16):
    """(N, 16, 4) int32 texels -> (N, 16) uint8 BC7 blocks, plus per-mode block counts and total error.

    Identical blocks are encoded once (flat atlas padding). The one-subset modes (6, 5) run on every block;
    the two-subset modes (1, 3) only where the best one-subset error is above `skip` (sum of squared
    8-bit errors over the block: 16 = every texel off by one in one channel)."""
    w = np.asarray(w, np.int32)
    flat = X.reshape(X.shape[0], -1)
    uniq, inv = np.unique(flat, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    U = uniq.reshape(-1, 16, X.shape[2]).astype(np.int32)
    n = U.shape[0]
    out = np.zeros((n, 16), np.uint8)
    counts = {m: 0 for m in modes}
    uerr = np.zeros(n, np.int64)
    one = [m for m in modes if m in (6, 5)]
    two = [m for m in modes if m in (1, 3)]
    for s in range(0, n, chunk):
        Xc = U[s:s + chunk]
        cands = []
        for m in one:
            err, e = encode_mode6(Xc, w) if m == 6 else encode_mode5(Xc, w)
            cands.append((m, err, e))
        if cands:
            errs, pick = _best(cands)
            best = errs[np.arange(len(pick)), pick]
        else:
            best = np.full(Xc.shape[0], np.iinfo(np.int64).max)
            pick = np.full(Xc.shape[0], -1)
        hard = np.nonzero(best > skip)[0]
        if two and len(hard):
            Xh = Xc[hard]
            parts = rank_partitions(Xh[:, :, :3], w[:3], k)
            for m in two:
                err, e = encode_two(Xh, w, parts, m)
                full = np.full(Xc.shape[0], np.iinfo(np.int64).max)
                full[hard] = err
                cands.append((m, full, (hard, e)))
            errs, pick = _best(cands)
            best = errs[np.arange(len(pick)), pick]
        blk = np.zeros((Xc.shape[0], 16), np.uint8)
        for j, (m, err, e) in enumerate(cands):
            sel = pick == j
            if not sel.any():
                continue
            if m == 6:
                blk[sel] = pack_mode6(e)[sel]
            elif m == 5:
                blk[sel] = pack_mode5(e)[sel]
            else:
                hard_idx, eh = e
                packed = pack_two(eh, m)
                pos = np.full(Xc.shape[0], -1)
                pos[hard_idx] = np.arange(len(hard_idx))
                blk[sel] = packed[pos[sel]]
        out[s:s + chunk] = blk
        uerr[s:s + chunk] = best
        for j, (m, _, _) in enumerate(cands):
            counts[m] += int(np.bincount(inv, minlength=n)[s:s + chunk][pick == j].sum())
    return out[inv], counts, int(uerr[inv].sum())


def encode_image(img, w=(1, 1, 1, 1), modes=DEFAULT_MODES, k=4):
    """H x W x 3|4 uint8 -> BC7 bytes (blocks in raster order), a summary dict."""
    if img.shape[2] == 3:
        img = np.concatenate([img, np.full(img.shape[:2] + (1,), 255, np.uint8)], 2)
    img = pad_to_blocks(img)
    X = to_blocks(img)
    blocks, counts, err = encode_blocks(X, w, modes, k)
    return blocks.tobytes(), {'modes': counts, 'sse': err, 'blocks': X.shape[0]}


def decode_image(data, h, w):
    """BC7 bytes of an image of h x w (padded to blocks) -> h x w x 4 uint8."""
    H, W = max(4, (h + 3) // 4 * 4), max(4, (w + 3) // 4 * 4)
    px = decode(np.frombuffer(data, np.uint8).reshape(-1, 16))
    return from_blocks(px, H, W)[:h, :w]
