"""Build the platform-native Spectral Bench desktop bundle."""

from __future__ import annotations

import argparse
import importlib.util
import math
from pathlib import Path
import platform
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib


ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / ".build"
RELEASES = ROOT / "releases"
APP_NAME = "Spectral Bench"


def native_library() -> Path:
    source = ROOT / "native" / "fft.c"
    if not source.is_file():
        raise RuntimeError(f"Missing native source: {source}")

    native_dir = BUILD / "native"
    native_dir.mkdir(parents=True, exist_ok=True)
    if sys.platform == "darwin":
        compiler = shutil.which("clang")
        if not compiler:
            raise RuntimeError("Install the Xcode Command Line Tools to build the native library.")
        filename = "bench_native.dylib"
        flags = [
            "-std=c11", "-O3", "-dynamiclib", "-mmacosx-version-min=11.0",
            "-arch", platform.machine(),
        ]
    elif sys.platform == "win32":
        compiler = next((path for name in ("cl", "clang-cl", "clang") if (path := shutil.which(name))), None)
        if not compiler:
            raise RuntimeError("Open a Visual Studio Developer Command Prompt with MSVC or clang on PATH.")
        filename = "bench_native.dll"
        flags = []
    else:
        raise RuntimeError("Desktop bundles are built on macOS or Windows.")

    with tempfile.TemporaryDirectory(prefix="compile-", dir=native_dir) as directory:
        temporary = Path(directory) / filename
        msvc_style = Path(compiler).stem.lower() in {"cl", "clang-cl"}
        if msvc_style:
            command = [
                compiler, "/nologo", "/O2", "/MT", "/LD", "/std:c11",
                str(source), f"/Fe:{temporary}",
            ]
        else:
            if sys.platform == "win32":
                flags = ["-std=c11", "-O3", "-shared"]
            command = [compiler, *flags, str(source), "-o", str(temporary)]
        subprocess.run(command, cwd=directory, check=True)
        target = native_dir / filename
        temporary.replace(target)

    return target


def icon_png(size: int) -> bytes:
    """Rasterize the grating and its spectral rays over a rounded field."""
    pixels = bytearray()
    stride = 256 / size
    segments = (
        (39, 128, 117, 128, 4.2, (51, 55, 48)),
        (117, 128, 216, 73, 4.4, (39, 87, 141)),
        (117, 128, 220, 128, 4.7, (48, 97, 55)),
        (117, 128, 216, 183, 4.4, (149, 66, 36)),
        (106, 88, 124, 168, 4.2, (104, 107, 94)),
    )
    strokes = tuple(
        (x, y, ex - x, ey - y, (ex - x) ** 2 + (ey - y) ** 2, width, color)
        for x, y, ex, ey, width, color in segments
    )

    def coverage(distance: float) -> float:
        return max(0.0, min(1.0, 0.5 - distance / stride))

    for row in range(size):
        pixels.append(0)
        y = (row + 0.5) * stride
        shade = max(0.0, 1.0 - y / 240.0)
        background = (186 + 50 * shade, 187 + 49 * shade, 177 + 47 * shade)
        for column in range(size):
            x = (column + 0.5) * stride
            dx, dy = abs(x - 128) - 74, abs(y - 128) - 74
            distance = math.hypot(max(dx, 0.0), max(dy, 0.0)) + min(max(dx, dy), 0.0) - 42
            alpha = coverage(distance)
            if alpha == 0.0:
                pixels.extend((0, 0, 0, 0))
                continue

            edge = (1.0 - coverage(distance + 2.0)) * 0.27
            red = background[0] - 87 * edge
            green = background[1] - 86 * edge
            blue = background[2] - 83 * edge
            for start_x, start_y, vx, vy, length, width, color in strokes:
                projection = ((x - start_x) * vx + (y - start_y) * vy) / length
                position = max(0.0, min(1.0, projection))
                distance_to_stroke = math.hypot(x - start_x - vx * position, y - start_y - vy * position)
                intensity = coverage(distance_to_stroke - width)
                if intensity:
                    red += (color[0] - red) * intensity
                    green += (color[1] - green) * intensity
                    blue += (color[2] - blue) * intensity
            pixels.extend((round(red), round(green), round(blue), round(alpha * 255)))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(pixels))
        + chunk(b"IEND", b"")
    )


def app_icon() -> Path:
    icon_dir = BUILD / "icons"
    icon_dir.mkdir(parents=True, exist_ok=True)
    if sys.platform == "darwin":
        filename = icon_dir / "Spectral Bench.icns"
        icons = [(b"ic07", 128), (b"ic08", 256), (b"ic09", 512)]
        records = bytearray()
        for kind, size in icons:
            png = icon_png(size)
            records.extend(struct.pack(">4sI", kind, len(png) + 8))
            records.extend(png)
        filename.write_bytes(struct.pack(">4sI", b"icns", len(records) + 8) + records)
    else:
        filename = icon_dir / "Spectral Bench.ico"
        sizes = (16, 32, 48, 64, 128, 256)
        directory = bytearray(struct.pack("<HHH", 0, 1, len(sizes)))
        payload = bytearray()
        offset = 6 + len(sizes) * 16
        for size in sizes:
            png = icon_png(size)
            dimension = size % 256
            directory.extend(struct.pack("<BBBBHHII", dimension, dimension, 0, 0, 1, 32, len(png), offset))
            payload.extend(png)
            offset += len(png)
        filename.write_bytes(directory + payload)
    return filename


def build_bundle(library: Path) -> Path:
    if importlib.util.find_spec("PyInstaller") is None or importlib.util.find_spec("webview") is None:
        raise RuntimeError("Install the desktop dependencies in the active Python environment.")
    assets = ROOT / "dist"
    matlab = ROOT / "matlab"
    entry = ROOT / "desktop.py"
    if not (assets / "index.html").is_file() or not entry.is_file():
        raise RuntimeError("The desktop entry point and dist/index.html are required for packaging.")
    if not any(matlab.rglob("*.m")):
        raise RuntimeError("The MATLAB analysis scripts are required for packaging.")

    icon = app_icon()
    arguments = [
        sys.executable, "-m", "PyInstaller", "--noconfirm", "--windowed", "--onedir",
        "--name", APP_NAME, "--distpath", str(RELEASES),
        "--workpath", str(BUILD / "pyinstaller"), "--specpath", str(BUILD),
        "--add-data", f"{assets}:web", "--add-data", f"{matlab}:matlab",
        "--add-binary", f"{library}:native",
        "--icon", str(icon), "--noupx",
    ]
    if sys.platform == "darwin":
        arguments.extend(["--osx-bundle-identifier", "local.spectralbench.app"])
    subprocess.run([*arguments, str(entry)], cwd=ROOT, check=True)
    if sys.platform == "darwin":
        return RELEASES / f"{APP_NAME}.app"
    return RELEASES / APP_NAME / f"{APP_NAME}.exe"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compile-only", action="store_true", help="Build the native library without freezing the app.")
    options = parser.parse_args()
    try:
        library = native_library()
        print(f"Native library: {library}", flush=True)
        if not options.compile_only:
            print(f"Desktop application: {build_bundle(library)}", flush=True)
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        print(f"Build failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
