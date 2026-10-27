"""Texture sets -> KTX2 / BC7 next to the build PNGs (D94; M4 stream V4).

    python tools/blender/encode_ktx2.py [type ...] [--jobs N] [--k 4] [--modes 6,1,3,5] [--no-zlib]
                                        [--report out.json] [--no-art] [--check] [--out DIR]

For every built part with a texture set (assets/build/parts/<type>/<type>.tex.{albedo,normal,orm}.png;
default: all of them) writes <type>.tex.<map>.ktx2: BC7 (albedo sRGB, normal and ORM linear), the full
mip chain built here from the PNG (albedo averaged in linear light, normals renormalised, ORM averaged),
ZLIB supercompressed. Then records them in `.art.json -> textures.ktx2` (unless --no-art), which is what
the engine looks for; a re-export rewrites the art.json without it, so stale KTX2s are never used.

--report writes per-map quality (PSNR, SSIM, normal angular error, ORM per channel) and sizes.
--out DIR writes the KTX2s there instead (measurements; the art.json is left alone).
--selftest runs the encoder checks on synthetic images (no build files needed).
--check re-reads each KTX2 and verifies every level decodes to the encoder's own result.

Runs in any Python 3 with numpy (Blender's bundled one: tools/assets.mjs --ktx2); PIL is used to read
PNGs when present, else a built-in reader. Deterministic: same PNGs, same bytes.
"""

import json
import os
import struct
import sys
import time
import zlib
from multiprocessing import Pool

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'kn_tools'))
import bc7  # noqa: E402
import ktx2  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
PARTS = os.path.join(ROOT, 'assets', 'build', 'parts')
MAPS = ('albedo', 'normal', 'orm')
VERSION = 1


# ---------------------------------------------------------------- PNG in

def read_png(path):
    """H x W x 3 uint8 (RGB; alpha dropped, grey expanded)."""
    try:
        from PIL import Image
        with Image.open(path) as im:
            return np.asarray(im.convert('RGB')).copy()
    except ImportError:
        return _read_png_builtin(path)


def _read_png_builtin(path):
    with open(path, 'rb') as f:
        d = f.read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n', path
    i, idat = 8, []
    while i < len(d):
        (n,) = struct.unpack('>I', d[i:i + 4])
        t = d[i + 4:i + 8]
        if t == b'IHDR':
            w, h, depth, ctype, _, _, inter = struct.unpack('>IIBBBBB', d[i + 8:i + 21])
        elif t == b'IDAT':
            idat.append(d[i + 8:i + 8 + n])
        i += 12 + n
    assert depth in (8, 16) and inter == 0 and ctype in (0, 2, 4, 6), path
    ch = {0: 1, 2: 3, 4: 2, 6: 4}[ctype]
    bpp = ch * depth // 8
    raw = zlib.decompress(b''.join(idat))
    stride = w * bpp
    out = bytearray(h * stride)
    prev = bytearray(stride)
    for y in range(h):
        ft = raw[y * (stride + 1)]
        cur = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        if ft == 1:
            for x in range(bpp, stride):
                cur[x] = (cur[x] + cur[x - bpp]) & 255
        elif ft == 2:
            for x in range(stride):
                cur[x] = (cur[x] + prev[x]) & 255
        elif ft == 3:
            for x in range(stride):
                a = cur[x - bpp] if x >= bpp else 0
                cur[x] = (cur[x] + ((a + prev[x]) >> 1)) & 255
        elif ft == 4:
            for x in range(stride):
                a = cur[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                cur[x] = (cur[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        out[y * stride:(y + 1) * stride] = cur
        prev = cur
    a = np.frombuffer(bytes(out), np.uint8)
    if depth == 16:
        a = (a.reshape(-1, 2)[:, 0])                     # high byte
    a = a.reshape(h, w, ch)
    if ch == 1:
        a = np.repeat(a, 3, 2)
    elif ch == 2:
        a = np.repeat(a[:, :, :1], 3, 2)
    return np.ascontiguousarray(a[:, :, :3])


# ---------------------------------------------------------------- mips (integer tables, deterministic)

def _srgb_tables():
    def dec(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    lin16 = np.array([int(round(dec(k / 255.0) * 65535)) for k in range(256)], np.int64)
    # sum of 4 lin16 values >= T[k] <=> the average encodes to code >= k (round to nearest sRGB code)
    thr = np.array([int(np.ceil(4 * 65535 * dec((k - 0.5) / 255.0))) for k in range(1, 256)], np.int64)
    return lin16, thr


LIN16, THR = _srgb_tables()
assert zlib.crc32(LIN16.tobytes() + THR.tobytes()) == zlib.crc32(_srgb_tables()[0].tobytes() + _srgb_tables()[1].tobytes())


def _box4(a):
    return a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2]


def next_mip(img, kind):
    h, w = img.shape[:2]
    if h == 1 and w == 1:
        return None
    if h == 1 or w == 1:                                   # never for square power-of-two sets
        raise ValueError('non-square mip chain')
    if kind == 'albedo':
        s = _box4(LIN16[img])
        return np.searchsorted(THR, s, side='right').astype(np.uint8)
    if kind == 'normal':
        n = img.astype(np.float64) / 255.0 * 2.0 - 1.0
        n = _box4(n)
        ln = np.sqrt(n[..., 0] * n[..., 0] + n[..., 1] * n[..., 1] + n[..., 2] * n[..., 2])
        n = n / np.where(ln > 1e-12, ln, 1.0)[..., None]
        return np.clip(np.rint((n * 0.5 + 0.5) * 255.0), 0, 255).astype(np.uint8)
    s = _box4(img.astype(np.int64))
    return ((s + 2) >> 2).astype(np.uint8)


def mip_chain(img, kind):
    out = [img]
    while True:
        m = next_mip(out[-1], kind)
        if m is None:
            return out
        out.append(m)


# ---------------------------------------------------------------- metrics

def psnr(a, b):
    mse = np.mean((a.astype(np.float64) - b.astype(np.float64)) ** 2)
    return float('inf') if mse == 0 else float(10 * np.log10(255.0 ** 2 / mse))


def _gauss(x, sigma=1.5, r=5):
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    for ax in (0, 1):
        p = np.pad(x, [(r, r) if a == ax else (0, 0) for a in range(x.ndim)], mode='reflect')
        acc = np.zeros_like(x)
        for j, kj in enumerate(k):
            sl = [slice(None)] * x.ndim
            sl[ax] = slice(j, j + x.shape[ax])
            acc += kj * p[tuple(sl)]
        x = acc
    return x


def ssim(a, b):
    """Mean SSIM (Wang et al. 2004, 11-tap Gaussian, sigma 1.5) of one channel, 8-bit."""
    a = a.astype(np.float64)
    b = b.astype(np.float64)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    ma, mb = _gauss(a), _gauss(b)
    va = _gauss(a * a) - ma * ma
    vb = _gauss(b * b) - mb * mb
    cv = _gauss(a * b) - ma * mb
    s = ((2 * ma * mb + c1) * (2 * cv + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2))
    return float(s.mean())


def normal_angles(a, b):
    def dec(x):
        n = x.astype(np.float64) / 255.0 * 2.0 - 1.0
        return n / np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-12)
    d = np.clip((dec(a) * dec(b)).sum(-1), -1, 1)
    return np.degrees(np.arccos(d))


def busy_mask(src, thresh=2):
    """Texels of 4x4 blocks whose source varies by more than `thresh` in some channel (not flat padding)."""
    h, w = src.shape[:2]
    b = src.reshape(h // 4, 4, w // 4, 4, 3).astype(np.int16)
    rng = (b.max((1, 3)) - b.min((1, 3))).max(-1) > thresh
    return np.repeat(np.repeat(rng, 4, 0), 4, 1)


def metrics(kind, src, dec):
    rgb = dec[..., :3]
    busy = busy_mask(src) if src.shape[0] >= 4 else np.ones(src.shape[:2], bool)
    m = {'psnr': round(psnr(src, rgb), 2), 'busy': round(float(busy.mean()), 4),
         'psnr_busy': round(psnr(src[busy], rgb[busy]), 2) if busy.any() else None}
    if kind == 'albedo':
        m['psnr_ch'] = [round(psnr(src[..., c], rgb[..., c]), 2) for c in range(3)]
        m['ssim'] = round(float(np.mean([ssim(src[..., c], rgb[..., c]) for c in range(3)])), 4)
    elif kind == 'normal':
        ang = normal_angles(src, rgb)
        m.update({'ang_mean_busy': round(float(ang[busy].mean()), 3) if busy.any() else 0,
                  'ang_p99_busy': round(float(np.percentile(ang[busy], 99)), 3) if busy.any() else 0,
                  'ang_mean': round(float(ang.mean()), 3), 'ang_p99': round(float(np.percentile(ang, 99)), 3),
                  'ang_max': round(float(ang.max()), 2), 'ssim': round(float(np.mean([ssim(src[..., c], rgb[..., c]) for c in range(3)])), 4)})
    else:
        m['psnr_ch'] = [round(psnr(src[..., c], rgb[..., c]), 2) for c in range(3)]
        m['psnr_ch_busy'] = [round(psnr(src[..., c][busy], rgb[..., c][busy]), 2) for c in range(3)] if busy.any() else None
        m['ssim_ch'] = [round(ssim(src[..., c], rgb[..., c]), 4) for c in range(3)]
        met_s, met_d = src[..., 2], rgb[..., 2]
        binary = (met_s == 0) | (met_s == 255)
        m['metal_flip'] = round(float(np.mean(binary & (np.abs(met_s.astype(int) - met_d) > 127))), 6)
        m['metal_maxerr_binary'] = int(np.abs(met_s.astype(int) - met_d)[binary].max()) if binary.any() else 0
    return m


# ---------------------------------------------------------------- encode

def ktx_name(ptype, m):
    return '%s.tex.%s.ktx2' % (ptype, m)


def encode_map(job):
    ptype, m, png, out, modes, k, zl, check = job
    t0 = time.time()
    st = os.stat(png)
    img = read_png(png)
    chain = mip_chain(img, m)
    levels, info0, counts = [], None, {}
    for lv, im in enumerate(chain):
        data, info = bc7.encode_image(im, (1, 1, 1, 1), modes, k)
        levels.append(data)
        if lv == 0:
            info0 = info
        for mm, c in info['modes'].items():
            counts[mm] = counts.get(mm, 0) + c
    t_enc = time.time() - t0
    size = ktx2.write(out, levels, img.shape[1], img.shape[0], m == 'albedo', zl,
                      extra_kv=[('KNmap', m), ('KNsource', os.path.basename(png))])
    dec0 = bc7.decode_image(levels[0], img.shape[0], img.shape[1])
    res = {'type': ptype, 'map': m, 'size': img.shape[0], 'levels': len(levels), 'file': os.path.basename(out),
           'bytes': size, 'png_bytes': os.path.getsize(png), 'gpu_bytes': sum(len(x) for x in levels),
           'rgba8_bytes': sum(x.shape[0] * x.shape[1] * 4 for x in chain), 'modes': counts,
           'enc_s': round(t_enc, 2), 'src_stat': [st.st_mtime_ns, st.st_size], **metrics(m, img, dec0)}
    if check:
        r = ktx2.read(out)
        assert r['levels'] == levels and r['srgb'] == (m == 'albedo') and r['width'] == img.shape[1]
        for lv, im in enumerate(chain):
            d = bc7.decode_image(r['levels'][lv], im.shape[0], im.shape[1])
            assert d.shape[:2] == im.shape[:2]
        res['checked'] = True
    return res


def dumps(obj):
    """export.py's JSON layout (short numeric arrays on one line), so art.json diffs stay small."""
    def enc(o, ind):
        pad = '  ' * ind
        if isinstance(o, dict):
            if not o:
                return '{}'
            items = ['%s  %s: %s' % (pad, json.dumps(k), enc(v, ind + 1)) for k, v in o.items()]
            return '{\n' + ',\n'.join(items) + '\n' + pad + '}'
        if isinstance(o, list):
            if not o:
                return '[]'
            if all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in o):
                return '[' + ', '.join(json.dumps(x) for x in o) + ']'
            return '[\n' + ',\n'.join(pad + '  ' + enc(x, ind + 1) for x in o) + '\n' + pad + ']'
        return json.dumps(o)
    return enc(obj, 0) + '\n'


def sets(types):
    out = []
    for t in sorted(os.listdir(PARTS)) if not types else types:
        d = os.path.join(PARTS, t)
        pngs = [os.path.join(d, '%s.tex.%s.png' % (t, m)) for m in MAPS]
        if all(os.path.exists(p) for p in pngs):
            out.append((t, d, pngs))
        elif types:
            print('  %s: no texture set PNGs, skipped' % t)
    return out


def selftest():
    """Encoder checks without the build: every mode alone and combined on synthetic blocks (noise, gradients,
    two-colour edges, flat), the encoder's error equal to the reference decoder's, every block 128 bits,
    the KTX2 round trip, and a fixed digest (determinism across machines and numpy versions)."""
    import hashlib
    rng = np.random.RandomState(7)
    h = w = 64
    yy, xx = np.mgrid[0:h, 0:w]
    tiles = [
        rng.randint(0, 256, (h, w, 3)),
        np.stack([xx * 4, yy * 4, (xx + yy) * 2], -1),
        np.where(((xx // 3 + yy // 5) % 2)[..., None] == 1, [200, 40, 30], [20, 90, 220]),
        np.full((h, w, 3), [37, 151, 99]),
    ]
    img = np.concatenate([np.concatenate(tiles[:2], 1), np.concatenate(tiles[2:], 1)], 0).astype(np.uint8)
    rgba = np.concatenate([img, np.full(img.shape[:2] + (1,), 255, np.uint8)], 2).astype(np.int64)
    fails = 0
    digest = hashlib.sha256()
    for modes in [(6,), (5,), (1,), (3,), (6, 1, 3, 5)]:
        data, info = bc7.encode_image(img, (1, 1, 1, 1), modes, 4)
        dec = bc7.decode_image(data, img.shape[0], img.shape[1]).astype(np.int64)
        sse = int(((dec - rgba) ** 2).sum())
        ok = sse == info['sse'] and len(data) == (img.shape[0] // 4) * (img.shape[1] // 4) * 16
        fails += not ok
        digest.update(data)
        print('  modes %-12s psnr %6.2f  sse %d (encoder %d)  %s' % (modes, psnr(img, dec[..., :3]), sse, info['sse'], 'ok' if ok else 'FAIL'))
    import tempfile
    p = os.path.join(tempfile.mkdtemp(), 't.ktx2')
    levels = [bc7.encode_image(im, (1, 1, 1, 1), (6,), 1)[0] for im in mip_chain(img, 'albedo')]
    ktx2.write(p, levels, img.shape[1], img.shape[0], True)
    r = ktx2.read(p)
    ok = r['levels'] == levels and r['srgb'] and r['vkFormat'] == ktx2.VK_FORMAT_BC7_SRGB_BLOCK and len(levels) == 8
    fails += not ok
    print('  ktx2 round trip (%d levels) %s' % (len(levels), 'ok' if ok else 'FAIL'))
    print('  digest %s' % digest.hexdigest()[:16])
    print('selftest: %d failure(s)' % fails)
    return 1 if fails else 0


def main(argv):
    if '--selftest' in argv:
        return selftest()
    args = [a for a in argv if not a.startswith('--')]
    opt = {}
    flags = set()
    it = iter(argv)
    for a in it:
        if a in ('--jobs', '--k', '--modes', '--report', '--out'):
            opt[a] = next(it)
            args.remove(opt[a]) if opt[a] in args else None
        elif a.startswith('--'):
            flags.add(a)
    jobs_n = int(opt.get('--jobs', max(1, (os.cpu_count() or 2) - 4)))
    k = int(opt.get('--k', 4))
    modes = tuple(int(x) for x in opt.get('--modes', '6,1,3,5').split(','))
    zl = 0 if '--no-zlib' in flags else 9
    todo = sets(args)
    jobs = []
    for t, d, pngs in todo:
        for m, png in zip(MAPS, pngs):
            od = opt.get('--out', d)
            os.makedirs(od, exist_ok=True)
            jobs.append((t, m, png, os.path.join(od, ktx_name(t, m)), modes, k, zl, '--check' in flags))
    # biggest first so the pool drains evenly
    jobs.sort(key=lambda j: -os.path.getsize(j[2]))
    t0 = time.time()
    print('encode_ktx2: %d set(s), %d map(s), %d job(s) at once, modes %s, k %d' % (len(todo), len(jobs), jobs_n, modes, k))
    results = []
    with Pool(max(1, min(jobs_n, len(jobs)))) as pool:
        for r in pool.imap_unordered(encode_map, jobs):
            results.append(r)
            if r['map'] == 'normal':
                extra = 'ang %.2f/%.2f deg (busy %.2f/%.2f)' % (r['ang_mean'], r['ang_p99'], r['ang_mean_busy'], r['ang_p99_busy'])
            elif r['map'] == 'albedo':
                extra = 'ssim %.4f' % r['ssim']
            else:
                extra = 'ch %s busy %s' % (r['psnr_ch'], r['psnr_ch_busy'])
            print('  %-18s %-6s %4d  psnr %5.2f busy %s (%2.0f%%)  %s  ktx2 %7d B (png %7d)  %5.1fs' % (
                r['type'], r['map'], r['size'], r['psnr'], r['psnr_busy'], 100 * r['busy'], extra, r['bytes'],
                r['png_bytes'], r['enc_s']), flush=True)
    if '--no-art' not in flags and '--out' not in opt:
        by = {}
        for r in results:
            by.setdefault(r['type'], {})[r['map']] = r
        for t, d, _ in todo:
            art_p = os.path.join(d, '%s.art.json' % t)
            if not os.path.exists(art_p) or len(by.get(t, {})) != 3:
                continue
            with open(art_p, encoding='utf8') as f:
                art = json.load(f)
            if not isinstance(art.get('textures'), dict):
                continue
            rs = by[t]
            # a re-bake can land while we encode (other art streams): only list KTX2s made from today's PNGs
            stale = [m for m in MAPS if list(rs[m]['src_stat']) != [os.stat(os.path.join(d, '%s.tex.%s.png' % (t, m))).st_mtime_ns,
                                                                  os.path.getsize(os.path.join(d, '%s.tex.%s.png' % (t, m)))]]
            if stale:
                print('  %s: %s PNG changed while encoding; art.json left without ktx2 (re-run)' % (t, '/'.join(stale)))
                continue
            art['textures']['ktx2'] = {
                'albedo': rs['albedo']['file'], 'normal': rs['normal']['file'], 'orm': rs['orm']['file'],
                'format': 'bc7', 'levels': rs['albedo']['levels'], 'supercompression': 'zlib' if zl else 'none',
                'encoder': 'kn_tools/bc7.py %d' % VERSION,
                'bytes': {m: rs[m]['bytes'] for m in MAPS}, 'gpuBytes': {m: rs[m]['gpu_bytes'] for m in MAPS},
            }
            with open(art_p, 'w', encoding='utf8', newline='\n') as f:
                f.write(dumps(art))
    if '--report' in opt:
        with open(opt['--report'], 'w') as f:
            json.dump(sorted(results, key=lambda r: (r['type'], r['map'])), f, indent=1)
    print('encode_ktx2: %d map(s) in %.1fs' % (len(results), time.time() - t0))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
