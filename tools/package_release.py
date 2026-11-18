"""Create and verify the macOS installer and MATLAB release examples."""

from __future__ import annotations

from hashlib import sha256
from pathlib import Path
import plistlib
import subprocess
import sys
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
RELEASES = ROOT / "releases"


def run(command: list[str]) -> None:
    subprocess.run(command, cwd=ROOT, check=True)


def main() -> None:
    if sys.platform != "darwin":
        raise SystemExit("Run this packager on macOS after tools/build_desktop.py.")
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    bundle = RELEASES / "Spectral Bench.app"
    binary = bundle / "Contents" / "MacOS" / "Spectral Bench"
    if not binary.is_file():
        raise SystemExit("Build Spectral Bench.app with tools/build_desktop.py first.")

    run(["codesign", "--verify", "--deep", "--strict", str(bundle)])
    run([str(binary), "--self-test"])
    run([str(binary), "--smoke-ui"])

    examples = RELEASES / "Spectral Bench MATLAB Measurements"
    run(["node", "tools/generate_matlab_examples.mjs", str(examples)])
    scripts = sorted(examples.glob("*.m"))
    if len(scripts) != 9:
        raise RuntimeError("The release requires nine standalone MATLAB measurement scripts.")
    archive_path = RELEASES / "Spectral-Bench-MATLAB-Measurements.zip"
    with ZipFile(archive_path, "w", ZIP_DEFLATED, compresslevel=9) as archive:
        for file in [examples / "README.txt", *scripts]:
            archive.write(file, file.relative_to(RELEASES))
    with ZipFile(archive_path) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("The MATLAB example archive did not pass its integrity check.")

    image = RELEASES / "Spectral-Bench-macOS-arm64.dmg"
    with TemporaryDirectory(prefix="spectral-bench-release-") as temporary:
        staging = Path(temporary)
        for artifact in [bundle, examples]:
            run(["ditto", str(artifact), str(staging / artifact.name)])
        (staging / "Applications").symlink_to("/Applications")
        run(["hdiutil", "create", "-ov", "-format", "UDZO", "-volname", "Spectral Bench", "-srcfolder", str(staging), str(image)])
    run(["hdiutil", "verify", str(image)])

    attached = subprocess.check_output(["hdiutil", "attach", "-readonly", "-nobrowse", "-plist", str(image)])
    volumes = plistlib.loads(attached)
    mount = next(Path(item["mount-point"]) for item in volumes["system-entities"] if "mount-point" in item)
    try:
        installed = mount / bundle.name
        with (installed / "Contents" / "Info.plist").open("rb") as source:
            info = plistlib.load(source)
        if info["CFBundleShortVersionString"] != version:
            raise RuntimeError("The installer version differs from VERSION.")
        web = installed / "Contents" / "Resources" / "web"
        for source in (ROOT / "dist").rglob("*"):
            if source.is_file() and source.read_bytes() != (web / source.relative_to(ROOT / "dist")).read_bytes():
                raise RuntimeError(f"The installer contains a different asset: {source.relative_to(ROOT)}")
        if len(list((mount / examples.name).glob("*.m"))) != 9:
            raise RuntimeError("The installer is missing MATLAB examples.")
        run(["codesign", "--verify", "--deep", "--strict", str(installed)])
        run([str(installed / "Contents" / "MacOS" / "Spectral Bench"), "--self-test"])
    finally:
        run(["hdiutil", "detach", str(mount)])

    checksums = RELEASES / "SHA256SUMS.txt"
    checksums.write_text("".join(f"{sha256(file.read_bytes()).hexdigest()}  {file.name}\n" for file in [image, archive_path]), encoding="utf-8")
    print(f"Verified release {version}: {image.name}, {archive_path.name}, {checksums.name}")


if __name__ == "__main__":
    main()
