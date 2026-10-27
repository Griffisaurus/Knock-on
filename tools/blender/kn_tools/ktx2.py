"""KTX 2.0 writer and reader for BC7 texture sets (D94; M4 stream V4). No Blender, no third-party code.

Writes one 2D texture with a full mip chain: vkFormat BC7_SRGB_BLOCK (146) or BC7_UNORM_BLOCK (145), a
Basic Data Format Descriptor (colour model BC7, transfer sRGB or linear), a key/value block
(KTXwriter, KTXorientation and our own `KNknown` map tag), and optional ZLIB supercompression
(scheme 3, one zlib stream per level), which the engine inflates with the browser's DecompressionStream.
Levels are stored smallest first, as the specification requires; the level index lists level 0 first.

Specification: https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html (not fetched here; written
from the published layout).
"""

import struct
import zlib

IDENTIFIER = b'\xabKTX 20\xbb\r\n\x1a\n'
VK_FORMAT_BC7_UNORM_BLOCK = 145
VK_FORMAT_BC7_SRGB_BLOCK = 146
SUPERCOMPRESSION_NONE = 0
SUPERCOMPRESSION_ZLIB = 3
KHR_DF_MODEL_BC7 = 136
KHR_DF_PRIMARIES_BT709 = 1
KHR_DF_TRANSFER_LINEAR = 1
KHR_DF_TRANSFER_SRGB = 2


def _dfd_bc7(srgb):
    """Basic DFD for BC7: one 128-bit sample, 4x4 texel blocks of 16 bytes."""
    block = struct.pack(
        '<IHHBBBBBBBBBBBBBBBB',
        0,                      # vendorId (17 bits) = 0 Khronos, descriptorType (15 bits) = 0 basic
        2,                      # versionNumber (KDF 1.3)
        24 + 16,                # descriptorBlockSize: header + one sample
        KHR_DF_MODEL_BC7, KHR_DF_PRIMARIES_BT709,
        KHR_DF_TRANSFER_SRGB if srgb else KHR_DF_TRANSFER_LINEAR,
        0,                      # flags: straight alpha
        3, 3, 0, 0,             # texelBlockDimension0..3 (dimension - 1)
        16, 0, 0, 0, 0, 0, 0, 0,  # bytesPlane0..7
    )
    sample = struct.pack('<HBBBBBBII', 0, 127, 0, 0, 0, 0, 0, 0, 0xFFFFFFFF)  # bitOffset, bitLength-1, BC7 colour
    body = block + sample
    return struct.pack('<I', 4 + len(body)) + body


def _kvd(pairs):
    out = b''
    for k, v in pairs:
        kv = k.encode('utf8') + b'\0' + (v if isinstance(v, bytes) else v.encode('utf8') + b'\0')
        out += struct.pack('<I', len(kv)) + kv
        out += b'\0' * (-len(out) % 4)
    return out


def write(path, levels, width, height, srgb, zlib_level=9, extra_kv=()):
    """levels: BC7 bytes per mip level, level 0 (width x height) first. Returns the file size."""
    n = len(levels)
    scheme = SUPERCOMPRESSION_ZLIB if zlib_level else SUPERCOMPRESSION_NONE
    payloads = [zlib.compress(lv, zlib_level) if scheme else lv for lv in levels]
    dfd = _dfd_bc7(srgb)
    kvd = _kvd([('KTXorientation', 'rd'), ('KTXwriter', 'KNOCK-ON kn_tools/bc7.py 1')] + list(extra_kv))
    header_len = 12 + 4 * 9 + 4 * 4 + 8 * 2                 # identifier + header + index (dfd, kvd, sgd)
    index_len = 24 * n
    dfd_off = header_len + index_len
    kvd_off = dfd_off + len(dfd)
    data_off = kvd_off + len(kvd)
    align = 1 if scheme else 16                             # lcm(texel block 16, 4) without supercompression
    # levels stored smallest first
    offsets = [0] * n
    blob = b''
    pos = data_off
    for lv in range(n - 1, -1, -1):
        pad = (-pos) % align
        blob += b'\0' * pad
        pos += pad
        offsets[lv] = pos
        blob += payloads[lv]
        pos += len(payloads[lv])
    head = IDENTIFIER + struct.pack('<IIIIIIIII', VK_FORMAT_BC7_SRGB_BLOCK if srgb else VK_FORMAT_BC7_UNORM_BLOCK,
                                    1, width, height, 0, 0, 1, n, scheme)
    head += struct.pack('<IIIIQQ', dfd_off, len(dfd), kvd_off, len(kvd), 0, 0)
    for lv in range(n):
        head += struct.pack('<QQQ', offsets[lv], len(payloads[lv]), len(levels[lv]))
    assert len(head) == dfd_off
    out = head + dfd + kvd + blob
    with open(path, 'wb') as f:
        f.write(out)
    return len(out)


def read(path):
    """-> dict(vkFormat, width, height, levels=[bytes, level 0 first], kv={})."""
    with open(path, 'rb') as f:
        d = f.read()
    if d[:12] != IDENTIFIER:
        raise ValueError('%s: not KTX2' % path)
    vk, ts, w, h, dep, layers, faces, nlev, scheme = struct.unpack_from('<IIIIIIIII', d, 12)
    dfd_off, dfd_len, kvd_off, kvd_len, sgd_off, sgd_len = struct.unpack_from('<IIIIQQ', d, 48)
    levels = []
    for lv in range(nlev):
        off, ln, raw = struct.unpack_from('<QQQ', d, 80 + 24 * lv)
        b = d[off:off + ln]
        if scheme == SUPERCOMPRESSION_ZLIB:
            b = zlib.decompress(b)
        elif scheme != SUPERCOMPRESSION_NONE:
            raise ValueError('unsupported supercompression %d' % scheme)
        assert len(b) == raw
        levels.append(b)
    kv = {}
    p = kvd_off
    while p < kvd_off + kvd_len:
        (ln,) = struct.unpack_from('<I', d, p)
        k, _, v = d[p + 4:p + 4 + ln].partition(b'\0')
        kv[k.decode()] = v.rstrip(b'\0').decode('utf8', 'replace')
        p += 4 + ln
        p += (-p) % 4
    transfer = d[dfd_off + 4 + 10]
    return {'vkFormat': vk, 'width': w, 'height': h, 'levels': levels, 'kv': kv, 'scheme': scheme,
            'srgb': transfer == KHR_DF_TRANSFER_SRGB}
