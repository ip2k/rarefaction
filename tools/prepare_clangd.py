#!/usr/bin/env python3
"""Create a separate clangd analysis database; never execute a compiler.

JieLi's pi32v2 backend is not in upstream clangd. An explicitly selected
analysis target approximates parsing only, not device ABI/code generation.
"""
import argparse
import json
from pathlib import Path
import shlex
import sys


def prepare(entries, mappings, jieli=False, analysis_target=None):
    if jieli and not analysis_target:
        raise ValueError("--jieli requires an explicit --analysis-target; there is no upstream pi32v2 target")
    mappings = sorted(mappings, key=lambda pair: len(pair[0]), reverse=True)

    def remap(value):
        for source, target in mappings:
            if value == source or value.startswith(source.rstrip('/') + '/'):
                value = target.rstrip('/') + value[len(source.rstrip('/')):]
                break
        # clangd may treat symlink and canonical database directories as
        # different workspaces, preventing background-index enumeration.
        return str(Path(value).resolve()) if Path(value).is_absolute() else value

    output = []
    for entry in entries:
        directory = remap(entry['directory'])
        filename = remap(entry['file'])
        args = entry.get('arguments')
        if args is None:
            args = shlex.split(entry['command'], posix=True)
        if not isinstance(args, list) or not args or not all(isinstance(a, str) for a in args):
            raise ValueError('Each command must have a nonempty string argument list')
        # Shell commands are never run. Reject wrappers rather than silently
        # turning a multi-command build recipe into a misleading compile entry.
        if any(a in ('&&', '||', ';', '|', '>', '<') for a in args):
            raise ValueError('Shell pipelines/compound commands are not compilation commands')
        if Path(args[0]).name in ('ccache', 'sccache', 'env'):
            raise ValueError('Strip compiler wrappers before preparing the database')
        cleaned = ['clang++' if Path(filename).suffix in ('.cc', '.cpp', '.cxx') else 'clang']
        i = 1
        while i < len(args):
            a = args[i]
            if jieli and a in ('-target', '--target', '-mcpu', '-march', '-mllvm'):
                if i + 1 >= len(args):
                    raise ValueError(f'Missing value for {a}')
                i += 2
                continue
            if jieli and a.startswith(('--target=', '-target=', '-mcpu=', '-march=')):
                i += 1
                continue
            if jieli and args[i:i+3] == ['-Xclang', '-target-feature', '-Xclang']:
                if i + 3 >= len(args):
                    raise ValueError('Missing JieLi target-feature value')
                i += 4
                continue
            # Remap standalone paths and attached include/sysroot arguments.
            for prefix in ('-isystem', '-iquote', '-include', '-I', '--sysroot=', '-isysroot'):
                if a.startswith(prefix) and len(a) > len(prefix):
                    a = prefix + remap(a[len(prefix):])
                    break
            else:
                a = remap(a)
            cleaned.append(a)
            i += 1
        if jieli:
            cleaned.append('--target=' + analysis_target)
        output.append({'directory': directory, 'file': filename, 'arguments': cleaned})
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--map', action='append', default=[], metavar='REMOTE=LOCAL')
    parser.add_argument('--jieli', action='store_true')
    parser.add_argument('--analysis-target')
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    try:
        if args.input.resolve() == args.output.resolve():
            raise ValueError('Output must be separate from the firmware build database')
        if args.output.exists() and not args.force:
            raise ValueError('Output exists; use --force to replace the analysis database')
        mappings = []
        for mapping in args.map:
            source, target = mapping.split('=', 1)
            if not Path(source).is_absolute() or not Path(target).is_absolute():
                raise ValueError('Path mappings must be absolute')
            mappings.append((source.rstrip('/'), target.rstrip('/')))
        entries = json.loads(args.input.read_text())
        if not isinstance(entries, list):
            raise ValueError('Compilation database must be an array')
        result = prepare(entries, mappings, args.jieli, args.analysis_target)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + '\n')
        if args.jieli:
            print('Analysis only: custom ISA flags removed; target=' + args.analysis_target + '. pi32v2 ABI/assembly/code generation remain unverified.', file=sys.stderr)
        print(f'Prepared {len(result)} commands in {args.output}', file=sys.stderr)
    except (ValueError, KeyError, OSError) as error:
        parser.error(str(error))


if __name__ == '__main__':
    main()
