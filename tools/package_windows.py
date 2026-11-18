"""Verify and package the Windows x64 portable desktop application."""

from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path
import platform
import subprocess
import sys
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
RELEASES = ROOT / 'releases'


def verify(executable: Path) -> None:
    for flag in ['--self-test', '--smoke-ui']:
        subprocess.run([str(executable), flag], cwd=executable.parent, check=True, timeout=90)


def main() -> None:
    if sys.platform != 'win32':
        raise SystemExit('Package this executable on Windows after tools/build_desktop.py.')
    version = (ROOT / 'VERSION').read_text(encoding='utf-8').strip()
    bundle = RELEASES / 'Spectral Bench'
    executable = bundle / 'Spectral Bench.exe'
    if not executable.is_file():
        raise SystemExit('Build Spectral Bench.exe with tools/build_desktop.py first.')
    verify(executable)
    examples = bundle / 'MATLAB Measurements'
    subprocess.run(['node', 'tools/generate_matlab_examples.mjs', str(examples)], cwd=ROOT, check=True)
    if len(list(examples.glob('*.m'))) != 9:
        raise RuntimeError('Nine MATLAB measurement examples are required.')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    (bundle / 'BUILD.json').write_text(json.dumps({'version': version, 'commit': commit,
        'platform': 'windows', 'architecture': platform.machine()}, indent=2) + '\n', encoding='utf-8')
    (bundle / 'START HERE.txt').write_text(
        f'Spectral Bench {version}\n\n'
        'Extract the entire ZIP, then launch Spectral Bench.exe.\n'
        'Keep the _internal directory beside the executable.\n'
        'Microsoft Edge WebView2 Runtime is required.\n'
        'https://developer.microsoft.com/microsoft-edge/webview2/\n\n'
        'The Python runtime and native C FFT are bundled; Python is not required.\n'
        'MATLAB is optional and requires its own installation and license.\n'
        'The MATLAB Measurements folder contains nine standalone measurement scripts.\n\n'
        'This is an unsigned Windows build. Signals are synthetic models.\n'
        'https://github.com/jongsu-king/spectral-bench\n', encoding='utf-8')
    archive_path = RELEASES / 'Spectral-Bench-Windows-x64.zip'
    with ZipFile(archive_path, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
        for source in sorted(bundle.rglob('*')):
            if source.is_file():
                archive.write(source, source.relative_to(RELEASES))
    with TemporaryDirectory(prefix='spectral-bench-windows-') as temporary:
        with ZipFile(archive_path) as archive:
            if archive.testzip():
                raise RuntimeError('The portable archive is damaged.')
            archive.extractall(temporary)
        installed = Path(temporary) / bundle.name
        if (installed / '_internal' / 'VERSION').read_text(encoding='utf-8').strip() != version:
            raise RuntimeError('The executable bundle version differs from VERSION.')
        web = installed / '_internal' / 'web'
        for source in (ROOT / 'dist').rglob('*'):
            if source.is_file() and source.read_bytes() != (web / source.relative_to(ROOT / 'dist')).read_bytes():
                raise RuntimeError(f'The archive contains a different asset: {source.relative_to(ROOT)}')
        verify(installed / executable.name)
    (RELEASES / 'SHA256SUMS-Windows.txt').write_text(
        f'{sha256(archive_path.read_bytes()).hexdigest()}  {archive_path.name}\n', encoding='utf-8')
    print(f'Verified Windows {version} portable archive: {archive_path.name}')


if __name__ == '__main__':
    main()
