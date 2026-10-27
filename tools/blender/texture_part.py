"""Texture-set step, headless (ASSET_PIPELINE §5.2, D78; M3 stream E3c): UV1 atlas over every LOD, Cycles bake
of the tactile materials into albedo / normal / ORM, source PNGs under assets/src/<family>/tex/, image
datablocks and root props in the .blend (saved in place). Export then writes the build set.

Usage: blender -b <part>.blend --factory-startup -P tools/blender/texture_part.py -- [--size 1024|2048]
       [--samples N] [--no-save]
Driver: node tools/assets.mjs <type> --tex
"""
import os
import sys
import time

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

args = _cli.script_args()
size = _cli.option(args, '--size')
samples = int(_cli.option(args, '--samples', '24'))
no_save = _cli.flag(args, '--no-save')
import bpy  # noqa: E402

from kn_tools import textures  # noqa: E402

if not bpy.data.filepath:
    _cli.die('open a part .blend first: blender -b <part>.blend -P texture_part.py')
t0 = time.time()
res = textures.texture_part(size=int(size) if size else None, samples=samples)
if res is not None and not no_save:
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath, compress=True, relative_remap=True)
    print('saved', bpy.data.filepath)
print('texture step %.1fs' % (time.time() - t0))
sys.stdout.flush()
sys.exit(0)
