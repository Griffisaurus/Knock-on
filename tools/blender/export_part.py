"""One-click export, headless (ASSET_PIPELINE §8): validate, then write
assets/build/parts/<type>/<type>.glb, .art.json, .shapes.json (+ .report.json).

Usage: blender -b <part>.blend --factory-startup -P tools/blender/export_part.py -- [--out DIR] [--no-validate]

M0 scope: the gltf-transform post-process (dedupe, prune, meshopt, KTX2), SDF and impostor bakes,
thumbnails, .frac.glb and cavity fill LUTs are named hooks reported as "deferred" (see kn_tools/export.py
DEFERRED and tools/assets.mjs postprocess()).
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402
from kn_tools import export  # noqa: E402

args = _cli.script_args()
out_dir = _cli.option(args, '--out')
no_validate = _cli.flag(args, '--no-validate')
import bpy  # noqa: E402

if not bpy.data.filepath:
    _cli.die('open a part .blend first: blender -b <part>.blend -P export_part.py')
try:
    export.export_part(out_dir=os.path.abspath(out_dir) if out_dir else None, validate_first=not no_validate)
except export.ExportError as e:
    _cli.die(str(e))
sys.stdout.flush()
sys.exit(0)
