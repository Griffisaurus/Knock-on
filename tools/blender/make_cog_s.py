"""Procedurally build the COG S source file (docs/art/briefs/drive.md, "COG: Spur and bevel gears").

Usage: blender -b --factory-startup -P tools/blender/make_cog_s.py -- [out.blend]
Default output: assets/src/drive/cog_s.blend. Shared builder: tools/blender/_cog.py.
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402
import _cog  # noqa: E402

if __name__ == '__main__':
    args = _cli.script_args()
    _cog.make('s', os.path.abspath(args[0]) if args else None)
