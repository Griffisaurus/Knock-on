"""Validator v1, headless (ASSET_PIPELINE §9). Exit 0 = pass, 1 = errors (CI-blocking).

Usage: blender -b <part>.blend --factory-startup -P tools/blender/validate_part.py -- [--json report.json]
"""
import json
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _cli  # noqa: E402
from kn_tools import validate  # noqa: E402

args = _cli.script_args()
json_out = _cli.option(args, '--json')
import bpy  # noqa: E402

if not bpy.data.filepath:
    _cli.die('open a part .blend first: blender -b <part>.blend -P validate_part.py')
rep = validate.validate()
print(rep.format())
if json_out:
    with open(json_out, 'w', encoding='utf-8') as f:
        json.dump(rep.as_dict(), f, indent=2)
sys.stdout.flush()
sys.exit(0 if rep.ok else 1)
