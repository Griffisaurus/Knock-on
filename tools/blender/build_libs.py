"""Build the shared libraries: assets/src/lib/materials.blend and assets/src/lib/port_ring.blend.

Usage: blender -b --factory-startup -P tools/blender/build_libs.py -- [--force]
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402
from kn_tools import library, paths  # noqa: E402

args = _cli.script_args()
force = _cli.flag(args, '--force')
built = library.ensure_libs(paths.repo_root(), force=force)
print('libraries:', ', '.join(built) if built else 'up to date')
