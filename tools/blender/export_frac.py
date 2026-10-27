"""Export a breakable part's fracture chunks (kn_tools/frac.py): <type>.frac.glb + packages/parts-data/src/frac_<type>.ts.

Usage: blender -b <part>.blend --factory-startup -P tools/blender/export_frac.py -- [--out DIR] [--ts PATH]
Also: node tools/assets.mjs <type> --frac
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402

import bpy  # noqa: E402

from kn_tools import frac, paths, template  # noqa: E402

args = _cli.script_args()
root_dir = paths.repo_root(bpy.data.filepath or None)
root = template.find_root(bpy.context.scene)
if root is None:
    _cli.die('no part root (kn_type) in this file')
ptype = root['kn_type']
out_dir = _cli.option(args, '--out') or paths.build_dir(root_dir, ptype)
ts = _cli.option(args, '--ts') or os.path.join(root_dir, 'packages', 'parts-data', 'src', 'frac_%s.ts' % ptype)
try:
    frac.export_frac(bpy.context.scene, os.path.abspath(out_dir), os.path.abspath(ts), ptype,
                     source=os.path.relpath(bpy.data.filepath, root_dir).replace(os.sep, '/'))
except frac.FracError as e:
    _cli.die(str(e))
