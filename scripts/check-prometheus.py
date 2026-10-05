#!/usr/bin/env python3
"""
Prometheus rejects scrapes or drops series when metrics or labels are
malformed. This renders each telemetry fixture through the server and
validates the output with promtool.
"""
import json
import os
import pathlib
import platform
import subprocess
import sys
import urllib.request
import tarfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURES_DIR = ROOT / 'test' / 'fixtures'
CACHE_DIR = pathlib.Path.home() / '.cache' / 'glasshouse-prometheus'
PROMTOOL_VERSION = '2.54.1'


def find_promtool():
    """Locate promtool in PATH or local cache; download if missing."""
    import shutil
    promtool = shutil.which('promtool')
    if promtool:
        return promtool

    cached = CACHE_DIR / 'promtool'
    if cached.is_file() and os.access(cached, os.X_OK):
        return str(cached)

    # Download promtool into CACHE_DIR
    sys_os = platform.system().lower()
    machine = platform.machine().lower()
    arch_map = {
        'x86_64': 'amd64',
        'amd64': 'amd64',
        'arm64': 'arm64',
        'aarch64': 'arm64'
    }
    arch = arch_map.get(machine)
    if not arch:
        sys.exit(f'Unsupported architecture for promtool: {machine}')

    url = (f'https://github.com/prometheus/prometheus/releases/download/'
           f'v{PROMTOOL_VERSION}/prometheus-{PROMTOOL_VERSION}.{sys_os}-{arch}.tar.gz')

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    print(f'promtool not found; downloading v{PROMTOOL_VERSION} for {sys_os}/{arch}...')
    tar_path = CACHE_DIR / 'promtool.tar.gz'
    try:
        urllib.request.urlretrieve(url, tar_path)
        with tarfile.open(tar_path, 'r:gz') as tar:
            for member in tar.getmembers():
                if member.name.endswith('/promtool') or member.name == 'promtool':
                    member.name = 'promtool'
                    if hasattr(tarfile, 'data_filter'):
                        tar.extract(member, path=CACHE_DIR, filter='data')
                    else:
                        tar.extract(member, path=CACHE_DIR)
                    break
        cached.chmod(0o755)
        if tar_path.exists():
            tar_path.unlink()
        return str(cached)
    except Exception as e:
        sys.exit(f'Could not download promtool: {e}\nPlease install promtool or prometheus.')


def render_metrics(fixture_path, version='0.80.4'):
    """Render metrics for a fixture via node server/lib/prometheus.js."""
    script = (
        "var p = require('./server/lib/prometheus');\n"
        "var stats = process.argv[1] === '{}' ? {} : require(process.argv[1]);\n"
        "process.stdout.write(p.render(stats, process.argv[2]));\n"
    )
    cmd = ['node', '-e', script, str(fixture_path), version]
    res = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, check=True)
    return res.stdout


def main():
    promtool = find_promtool()

    # Get promtool version
    ver_proc = subprocess.run([promtool, '--version'], capture_output=True, text=True)
    promtool_ver = ver_proc.stdout.split('\n')[0] if ver_proc.returncode == 0 else PROMTOOL_VERSION

    fixtures = sorted(FIXTURES_DIR.glob('stats-*.json'))
    targets = [(f.name, f) for f in fixtures]
    targets.append(('empty stats {}', '{}'))

    problems = []

    for name, path in targets:
        rendered = render_metrics(path)

        # 1. Run through promtool check metrics
        proc = subprocess.run(
            [promtool, 'check', 'metrics'],
            input=rendered,
            capture_output=True,
            text=True
        )

        if proc.returncode != 0:
            err = proc.stderr.strip() or proc.stdout.strip()
            problems.append(f'{name} rejected by promtool:\n{err}')

        # 2. Check for required headers and stable family names
        for line in rendered.splitlines():
            if line.startswith('# TYPE'):
                parts = line.split()
                if len(parts) >= 4:
                    metric_name, metric_type = parts[2], parts[3]
                    if metric_type == 'counter' and not metric_name.endswith('_total'):
                        problems.append(f'{name}: counter {metric_name} does not end with _total')

    for p in problems:
        print(p, file=sys.stderr)

    print(f'{len(targets)} fixture scenarios checked against {promtool_ver}, '
          f'{len(problems)} problem{"s" if len(problems) != 1 else ""}')

    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
