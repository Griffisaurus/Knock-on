"""Repo path discovery. Works from the repo checkout (CLI) and from an installed add-on copy."""
import os


def _looks_like_repo(d):
    return os.path.isdir(os.path.join(d, 'assets', 'src')) and os.path.isdir(os.path.join(d, 'docs', 'art'))


def _walk_up(start):
    d = os.path.abspath(start)
    while True:
        if _looks_like_repo(d):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def repo_root(blend_path=None):
    """KNOCKON_ROOT env, else the folder above the open .blend, else the folder above this add-on."""
    env = os.environ.get('KNOCKON_ROOT')
    if env and _looks_like_repo(env):
        return os.path.abspath(env)
    for start in (blend_path, os.path.dirname(__file__)):
        if start:
            found = _walk_up(os.path.dirname(start) if os.path.isfile(start) else start)
            if found:
                return found
    raise RuntimeError('Cannot find the KNOCK-ON repo root; set KNOCKON_ROOT')


def lib_dir(root):
    return os.path.join(root, 'assets', 'src', 'lib')


def materials_lib(root):
    return os.path.join(lib_dir(root), 'materials.blend')


def port_ring_lib(root):
    return os.path.join(lib_dir(root), 'port_ring.blend')


def source_blend(root, family, part_type):
    return os.path.join(root, 'assets', 'src', family, part_type + '.blend')


def build_dir(root, part_type):
    return os.path.join(root, 'assets', 'build', 'parts', part_type)
