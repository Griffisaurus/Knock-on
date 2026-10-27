"""Shared bootstrap for the headless entry scripts: puts kn_tools on sys.path and parses args after `--`."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)


def script_args():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def flag(args, name):
    if name in args:
        args.remove(name)
        return True
    return False


def option(args, name, default=None):
    if name in args:
        i = args.index(name)
        value = args[i + 1]
        del args[i:i + 2]
        return value
    return default


def die(msg, code=1):
    print('ERROR:', msg, file=sys.stderr)
    sys.stdout.flush()
    sys.stderr.flush()
    sys.exit(code)
