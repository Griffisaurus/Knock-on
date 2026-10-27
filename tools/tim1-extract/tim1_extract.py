"""Reference extractor for The Incredible Machine (1993, DOS) data files.

Reads RESOURCE.MAP / RESOURCE.00x and writes:
  <out>/raw/        every packed resource, unmodified
  <out>/sprites/    decoded SCN sprite sheets as PNG (all frames, 2x scale)
  <out>/levels.json title, goal text, bonus values, gravity and air pressure for L1..L87
  <out>/palette.json the 16-colour TIM.PAL palette

Output is for design reference only. None of it may ship in the game.

Usage: python -I tim1_extract.py <dir with RESOURCE.MAP> <out dir>
"""
import json
import os
import struct
import sys
import zlib


def read_resources(src):
    """RESOURCE.MAP: u16 ?, u16 ?, u16 file count, then per file: 13-byte name,
    u16 entry count, entries of (u32 hash, u32 offset). Each entry in the data file
    is a 13-byte name, u32 size, then the payload."""
    m = open(os.path.join(src, 'RESOURCE.MAP'), 'rb').read()
    pos, out = 6, {}
    while pos < len(m):
        fname = m[pos:pos + 13].split(b'\0')[0].decode(); pos += 13
        count = struct.unpack_from('<H', m, pos)[0]; pos += 2
        blob = open(os.path.join(src, fname), 'rb').read()
        for _ in range(count):
            _hash, off = struct.unpack_from('<II', m, pos); pos += 8
            name = blob[off:off + 13].split(b'\0')[0].decode('latin1')
            size = struct.unpack_from('<I', blob, off + 13)[0]
            out[name] = blob[off + 17:off + 17 + size]
    return out


def chunks(data):
    out, i = {}, 0
    while i + 8 <= len(data):
        tag = data[i:i + 4]
        size = struct.unpack_from('<I', data, i + 4)[0] & 0x7fffffff
        if tag in (b'BMP:', b'PAL:'):  # container chunks: descend
            i += 8
            continue
        out[tag] = data[i + 8:i + 8 + size]
        i += 8 + size
    return out


def decode_scn(s, w, h):
    """SCN sprite rows. First byte is a header. Each following byte: top 2 bits = op,
    low 6 bits = n.
      00: next row, x -= n      01: x += n (transparent skip)
      10: run of n pixels, colour in next byte    11: n literal 4-bit pixels, packed 2 per byte"""
    img = [[None] * w for _ in range(h)]
    i, x, y = 1, 0, 0

    def put(c):
        if 0 <= x < w and 0 <= y < h:
            img[y][x] = c

    while i < len(s) and y < h:
        b = s[i]; i += 1
        op, n = b >> 6, b & 0x3f
        if op == 0:
            y += 1; x -= n
        elif op == 1:
            x += n
        elif op == 2:
            c = s[i]; i += 1
            for _ in range(n):
                put(c); x += 1
        else:
            packed = s[i:i + (n + 1) // 2]; i += (n + 1) // 2
            for k in range(n):
                v = packed[k // 2]
                put(v >> 4 if k % 2 == 0 else v & 15); x += 1
    return img


def write_png(path, rows, pal, scale=2):
    h, w = len(rows), len(rows[0])
    raw = bytearray()
    for row in rows:
        line = bytearray()
        for p in row:
            line += bytes(pal[p]) + b'\xff' if p is not None else b'\0\0\0\0'
        line = bytes(b for px in range(w) for b in line[px * 4:px * 4 + 4] * scale)
        for _ in range(scale):
            raw += b'\0' + line

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data))

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', w * scale, h * scale, 8, 6, 0, 0, 0)))
        f.write(chunk(b'IDAT', zlib.compress(bytes(raw))))
        f.write(chunk(b'IEND', b''))


def sprite_sheet(data, wrap=640):
    c = chunks(data)
    inf = c[b'INF:']
    count = struct.unpack_from('<H', inf)[0]
    ws = struct.unpack_from('<%dH' % count, inf, 2)
    hs = struct.unpack_from('<%dH' % count, inf, 2 + 2 * count)
    offs = struct.unpack_from('<%dI' % count, c[b'OFF:']) if b'OFF:' in c else (0,)
    scn = c[b'SCN:']
    frames = [decode_scn(scn[offs[k]:offs[k + 1] if k + 1 < count else len(scn)], ws[k], hs[k])
              for k in range(count)]
    lines, cur, cw = [], [], 0
    for k in range(count):
        if cur and cw + ws[k] + 2 > wrap:
            lines.append(cur); cur, cw = [], 0
        cur.append(k); cw += ws[k] + 2
    lines.append(cur)
    sw = max(sum(ws[k] + 2 for k in ln) for ln in lines)
    sh = sum(max(hs[k] for k in ln) + 2 for ln in lines)
    sheet = [[None] * sw for _ in range(sh)]
    oy = 0
    for ln in lines:
        ox = 0
        for k in ln:
            for yy in range(hs[k]):
                sheet[oy + yy][ox:ox + ws[k]] = frames[k][yy]
            ox += ws[k] + 2
        oy += max(hs[k] for k in ln) + 2
    return sheet, list(zip(ws, hs))


def parse_level(data):
    p = 4  # magic ED AC 02 01
    title = data[p:data.index(b'\0', p)].decode('latin1'); p += len(title) + 1
    goal = data[p:data.index(b'\0', p)].decode('latin1'); p += len(goal) + 1
    bonus1, bonus2, gravity, air = struct.unpack_from('<4H', data, p)
    return {'title': title.strip(), 'goal': goal.strip(), 'bonus': [bonus1, bonus2],
            'gravity': gravity, 'airPressure': air}


def main(src, out):
    res = read_resources(src)
    for d in ('raw', 'sprites'):
        os.makedirs(os.path.join(out, d), exist_ok=True)
    for name, data in res.items():
        open(os.path.join(out, 'raw', name), 'wb').write(data)

    vga = chunks(res['TIM.PAL'])[b'VGA:']
    pal = [tuple(min(255, v * 4) for v in vga[i * 3:i * 3 + 3]) for i in range(256)]
    json.dump(['#%02X%02X%02X' % pal[i] for i in range(16)],
              open(os.path.join(out, 'palette.json'), 'w'), indent=1)

    index = {}
    for name in sorted(res):
        if name.endswith('.BMP') and b'SCN:' in res[name]:
            sheet, sizes = sprite_sheet(res[name])
            write_png(os.path.join(out, 'sprites', name.replace('.BMP', '.png')), sheet, pal)
            index[name] = sizes
    json.dump(index, open(os.path.join(out, 'sprites', 'frames.json'), 'w'), indent=1)

    levels = {}
    for n in range(1, 100):
        key = 'L%d.LEV' % n
        if key in res:
            levels[n] = parse_level(res[key])
    json.dump(levels, open(os.path.join(out, 'levels.json'), 'w'), indent=1)
    print('%d resources, %d sprite sheets, %d levels' % (len(res), len(index), len(levels)))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
