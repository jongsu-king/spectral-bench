"""Desktop launcher, native FFT binding, and experiment file dialogs."""

from __future__ import annotations

import argparse
import ctypes
import importlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import mimetypes
import os
from pathlib import Path
import sys
import tempfile
from threading import RLock, Thread
from time import monotonic, sleep
from urllib.parse import unquote, urlsplit
from urllib.request import ProxyHandler, Request, build_opener
import webbrowser


ROOT = Path(__file__).resolve().parent
FROZEN = getattr(sys, "frozen", False)
RESOURCE_ROOT = Path(getattr(sys, "_MEIPASS", ROOT))
ASSETS = RESOURCE_ROOT / ("web" if FROZEN else "dist")
MATLAB_ASSETS = RESOURCE_ROOT / "matlab"
LIBRARY_DIRECTORY = RESOURCE_ROOT / "native" if FROZEN else ROOT / ".build" / "native"
SESSION_LIMIT = 12_000_000
MATLAB_FILE_LIMIT = 2_000_000
MEASUREMENT_CSV_LIMIT = 4_000_000
CSV_LIMIT = 16_000_000
WEB_MIME = {"": "application/octet-stream", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8"}
SOURCE_DOMAINS = {
    "www.oceanoptics.com", "www.shimadzu.com", "www.horiba.com", "www.picoquant.com",
    "www.renishaw.com", "www.thermofisher.com", "www.jawoollam.com", "www.edinst.com",
    "www.itwm.fraunhofer.de", "doi.org", "physics.nist.gov", "webbook.nist.gov",
    "www.mdpi.com", "www.omlc.org", "nvlpubs.nist.gov", "pmc.ncbi.nlm.nih.gov",
    "www.ncrm.org.cn", "www.jstage.jst.go.jp", "www.nist.gov", "pubs.rsc.org",
    "www.nature.com", "www.toptica.com", "eprints.whiterose.ac.uk",
}


class NativeFFT:
    def __init__(self) -> None:
        filename = {
            "darwin": "bench_native.dylib",
            "win32": "bench_native.dll",
        }.get(sys.platform, "bench_native.so")
        self._library = ctypes.CDLL(str(LIBRARY_DIRECTORY / filename))
        self._transform = self._library.sb_fft
        pointer = ctypes.POINTER(ctypes.c_double)
        self._transform.argtypes = (pointer, pointer, ctypes.c_size_t, ctypes.c_int)
        self._transform.restype = ctypes.c_int

    def run(self, real: list[float], imag: list[float], inverse: bool) -> dict:
        count = validate_fft(real, imag)
        buffer = ctypes.c_double * count
        result_real = buffer(*real)
        result_imag = buffer(*imag)
        if self._transform(result_real, result_imag, count, int(inverse)):
            raise ValueError("Native FFT rejected the input.")
        return {"real": list(result_real), "imag": list(result_imag)}


def validate_fft(real: list[float], imag: list[float]) -> int:
    count = len(real)
    if not isinstance(real, list) or not isinstance(imag, list) or count != len(imag) or not 0 < count <= 65536 or count & (count - 1):
        raise ValueError("FFT input must have a matching power-of-two length.")
    if not all(math.isfinite(value) for sequence in (real, imag) for value in sequence):
        raise ValueError("FFT input must contain finite values.")
    return count


class MatlabBackend:
    def __init__(self) -> None:
        self._lock = RLock()
        self._engine = None
        self._matlab = None
        self._release = ""

    @staticmethod
    def _engine_locations() -> list[Path]:
        roots = []
        if configured := os.environ.get("MATLAB_ROOT"):
            roots.append(Path(configured))
        if sys.platform == "darwin":
            roots.extend(sorted(Path("/Applications").glob("MATLAB_R*.app"), reverse=True))
        elif sys.platform == "win32":
            program_files = Path(os.environ.get("ProgramFiles", "C:/Program Files"))
            roots.extend(sorted((program_files / "MATLAB").glob("R*"), reverse=True))
        return [root / "extern" / "engines" / "python" / "dist" for root in roots]

    def connect(self) -> dict:
        with self._lock:
            if self._engine is not None:
                return {"backend": "matlab", "release": self._release}
            for folder in reversed(self._engine_locations()):
                if folder.is_dir() and str(folder) not in sys.path:
                    sys.path.insert(0, str(folder))
            try:
                engine_module = importlib.import_module("matlab.engine")
                self._matlab = importlib.import_module("matlab")
            except ImportError as error:
                raise RuntimeError("MATLAB Engine was not found. Install a licensed MATLAB release with a compatible Python Engine.") from error
            future = engine_module.start_matlab("-nodesktop -nosplash", background=True)
            try:
                self._engine = future.result(timeout=40)
                self._release = str(self._engine.version("-release"))
                self._engine.addpath(str(MATLAB_ASSETS), nargout=0)
            except Exception:
                if self._engine is not None:
                    self._engine.quit()
                    self._engine = None
                else:
                    future.cancel()
                raise
            return {"backend": "matlab", "release": self._release}

    def run(self, real: list[float], imag: list[float], inverse: bool) -> dict:
        validate_fft(real, imag)
        with self._lock:
            if self._engine is None:
                raise RuntimeError("Connect MATLAB before selecting its FFT.")
            row = self._matlab.double([complex(r, i) for r, i in zip(real, imag)], is_complex=True)
            transform = self._engine.ifft if inverse else self._engine.fft
            result = transform(row, background=True).result(timeout=10)
            values = [complex(value) for value in result[0]] if len(real) > 1 else [complex(result)]
            return {"real": [value.real for value in values], "imag": [value.imag for value in values]}

    def simulate(self, instrument: str, settings: dict) -> dict:
        if instrument not in {"ftir", "thz"} or not isinstance(settings, dict):
            raise ValueError("Select FTIR or THz-TDS for the MATLAB model.")
        with self._lock:
            if self._engine is None:
                raise RuntimeError("Connect MATLAB before running a MATLAB simulation.")
            content = self._engine.spectral_bench_json(instrument, json.dumps(settings, allow_nan=False), background=True).result(timeout=20)
            return json.loads(content)

    def close(self) -> None:
        with self._lock:
            engine, self._engine = self._engine, None
            if engine is not None:
                engine.quit()


class BenchServer(ThreadingHTTPServer):
    # The desktop browser can request all module imports at once.
    request_queue_size = 64

    daemon_threads = True

    def __init__(self, fft: NativeFFT) -> None:
        super().__init__(("127.0.0.1", 0), BenchRequest)
        self.host = f"127.0.0.1:{self.server_port}"
        self.origin = f"http://{self.host}"
        self.fft = fft
        self.matlab = MatlabBackend()
        self.transforms_served = 0

    def server_close(self) -> None:
        try:
            self.matlab.close()
        finally:
            super().server_close()


class BenchRequest(BaseHTTPRequestHandler):
    server: BenchServer

    def log_message(self, format: str, *args: object) -> None:
        return

    def _reply(self, status: int, content: bytes, mime: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def _json(self, status: int, content: dict) -> None:
        self._reply(status, json.dumps(content, allow_nan=False).encode(), "application/json")

    def do_GET(self) -> None:
        if self.headers.get("Host") != self.server.host:
            self.send_error(403)
            return
        path = urlsplit(self.path).path
        if path == "/app/runtime.js":
            self._reply(200, b"window.__SPECTRAL_DESKTOP__ = true;\n", WEB_MIME[".js"])
            return
        path = "/index.html" if path == "/" else path
        file = (ASSETS / unquote(path.lstrip("/"))).resolve()
        if not file.is_relative_to(ASSETS.resolve()) or not file.is_file():
            self.send_error(404)
            return
        mime = WEB_MIME.get(file.suffix) or mimetypes.guess_type(file)[0] or WEB_MIME[""]
        self._reply(200, file.read_bytes(), mime)

    def do_POST(self) -> None:
        if self.headers.get("Host") != self.server.host or self.headers.get("Origin") != self.server.origin:
            self.send_error(403)
            return
        path = urlsplit(self.path).path
        if path not in {"/api/fft", "/api/matlab/connect", "/api/matlab/simulate"}:
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4_000_000 or self.headers.get_content_type() != "application/json":
                raise ValueError("Invalid request.")
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError("Request data must be an object.")
            if path == "/api/matlab/connect":
                result = self.server.matlab.connect()
            elif path == "/api/matlab/simulate":
                result = self.server.matlab.simulate(payload["instrument"], payload["settings"])
            else:
                backend = self.server.matlab if payload.get("backend") == "matlab" else self.server.fft
                result = backend.run(payload["real"], payload["imag"], payload["inverse"])
                self.server.transforms_served += 1
        except (KeyError, TypeError, ValueError, OverflowError):
            self._json(400, {"error": "Invalid simulation or FFT input."})
            return
        except RuntimeError as error:
            message = str(error).splitlines()[0].strip()[:320]
            self._json(503, {"error": message or "MATLAB operation failed."})
            return
        except Exception:
            self._json(503, {"error": "MATLAB could not complete the operation. Check the MATLAB installation and license."})
            return
        self._json(200, result)


def save_text(path: Path, content: str) -> None:
    """Replace an experiment file atomically after writing it successfully."""
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="", dir=path.parent, delete=False) as output:
            temporary = Path(output.name)
            output.write(content)
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


class FileDialogs:
    def __init__(self) -> None:
        self._window = None

    def save_csv(self, suggested: str, content: str) -> dict:
        return self._save(suggested, content, "CSV (*.csv)", CSV_LIMIT)

    def save_matlab(self, suggested: str, content: str) -> dict:
        return self._save(suggested, content, "MATLAB script (*.m)", MATLAB_FILE_LIMIT)

    def save_session(self, content: str) -> dict:
        return self._save("Spectral Bench session.sblab", content, "Spectral Bench session (*.sblab)", SESSION_LIMIT)

    def _save(self, suggested: str, content: str, file_type: str, limit: int) -> dict:
        import webview

        if not isinstance(content, str) or len(content.encode("utf-8")) > limit:
            return {"error": "The measurement file is too large."}
        selected = self._window.create_file_dialog(
            webview.FileDialog.SAVE, save_filename=Path(suggested).name, file_types=(file_type,)
        )
        if not selected:
            return {"cancelled": True}
        path = Path(selected[0] if isinstance(selected, (tuple, list)) else selected)
        if not path.suffix:
            path = path.with_suffix(Path(suggested).suffix)
        try:
            save_text(path, content)
        except OSError as error:
            return {"error": str(error)}
        return {"name": path.name}

    def open_session(self) -> dict:
        import webview

        selected = self._window.create_file_dialog(
            webview.FileDialog.OPEN, allow_multiple=False, file_types=("Spectral Bench session (*.sblab)",)
        )
        if not selected:
            return {"cancelled": True}
        path = Path(selected[0] if isinstance(selected, (tuple, list)) else selected)
        try:
            if path.stat().st_size > SESSION_LIMIT:
                return {"error": "The session file is too large."}
            return {"name": path.name, "content": path.read_text(encoding="utf-8")}
        except (OSError, UnicodeError) as error:
            return {"error": str(error)}

    def open_measurement(self) -> dict:
        import webview

        selected = self._window.create_file_dialog(
            webview.FileDialog.OPEN, allow_multiple=False, file_types=("Measurement data (*.csv;*.tsv;*.txt)",)
        )
        if not selected:
            return {"cancelled": True}
        path = Path(selected[0] if isinstance(selected, (tuple, list)) else selected)
        try:
            with path.open("rb") as source:
                data = source.read(MEASUREMENT_CSV_LIMIT + 1)
            if len(data) > MEASUREMENT_CSV_LIMIT:
                return {"error": "The measurement file exceeds 4 MB."}
            encoding = "utf-16" if data.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"
            return {"name": path.name, "content": data.decode(encoding)}
        except UnicodeError:
            return {"error": "Save the measurement file as UTF-8 or UTF-16 with a BOM and try again."}
        except OSError as error:
            return {"error": str(error)}

    def open_source(self, url: str) -> bool:
        parts = urlsplit(url)
        return parts.scheme == "https" and parts.hostname in SOURCE_DOMAINS and webbrowser.open(url)


def self_test(fft: NativeFFT, use_matlab: bool = False) -> None:
    impulse = fft.run([1.0, 0.0, 0.0, 0.0], [0.0] * 4, False)
    assert impulse == {"real": [1.0] * 4, "imag": [0.0] * 4}
    signal = [0.125, 1.25, -2.5, 3.75, -1, 0, 0.25, -0.5]
    spectrum = fft.run(signal, [0.0] * len(signal), False)
    recovered = fft.run(spectrum["real"], spectrum["imag"], True)
    assert all(abs(a - b) < 1e-10 for a, b in zip(signal, recovered["real"]))
    with BenchServer(fft) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        opener = build_opener(ProxyHandler({}))

        def post(path: str, payload: dict, timeout: int = 5) -> dict:
            request = Request(
                server.origin + path,
                data=json.dumps(payload).encode(),
                headers={"Origin": server.origin, "Content-Type": "application/json"},
            )
            with opener.open(request, timeout=timeout) as response:
                return json.load(response)

        try:
            with opener.open(server.origin, timeout=5) as response:
                assert b'Spectral Bench' in response.read()
            with opener.open(server.origin + "/app/runtime.js", timeout=5) as response:
                assert b'__SPECTRAL_DESKTOP__' in response.read()
            transform = {"real": signal, "imag": [0] * len(signal), "inverse": False}
            assert post("/api/fft", transform) == spectrum
            if use_matlab:
                release = post("/api/matlab/connect", {}, 60)["release"]
                matlab_fft = post("/api/fft", {**transform, "backend": "matlab"}, 15)
                assert all(abs(a - b) < 1e-10 for key in ("real", "imag") for a, b in zip(matlab_fft[key], spectrum[key]))
                ftir = post("/api/matlab/simulate", {"instrument": "ftir", "settings": {}}, 25)
                thz = post("/api/matlab/simulate", {"instrument": "thz", "settings": {}}, 25)
                assert len(ftir["series"][0]["x"]) > 100
                assert len(thz["series"]) == 2 and "1.667 ps" in thz["summary"]
                print(f"MATLAB {release} Engine FFT and both simulations verified.")
        finally:
            server.shutdown()
            thread.join()
    print("Spectral Bench desktop self-test passed.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Spectral Bench instrument laboratory")
    parser.add_argument("--self-test", action="store_true", help="Verify the bundled assets and C FFT.")
    parser.add_argument("--self-test-matlab", action="store_true", help="Also verify an installed MATLAB Engine and both MATLAB models.")
    parser.add_argument("--smoke-ui", action="store_true", help="Open and verify the native window, then exit.")
    parser.add_argument("--serve", action="store_true", help="Serve the local interface for development.")
    args = parser.parse_args()
    fft = NativeFFT()
    if args.self_test or args.self_test_matlab:
        self_test(fft, args.self_test_matlab)
        return
    with BenchServer(fft) as server:
        if args.serve:
            print(server.origin, flush=True)
            server.serve_forever()
            return

        import webview

        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            dialogs = FileDialogs()
            window = webview.create_window(
                "Spectral Bench — Instrument Laboratory",
                url=server.origin,
                js_api=dialogs,
                width=1420,
                height=930,
                min_size=(900, 650),
                background_color="#e5e6e7",
            )
            dialogs._window = window
            smoke_errors = []

            def check_window():
                try:
                    if not window.events.loaded.wait(20):
                        raise RuntimeError("The instrument window did not load.")
                    deadline = monotonic() + 5
                    while not window.evaluate_js("""Boolean(document.querySelector('[data-station=thz]')
                        && document.querySelector('#wb-viewport canvas') && window.pywebview?.api?.save_session)"""):
                        if monotonic() >= deadline:
                            raise RuntimeError("The instrument controls did not initialize.")
                        sleep(0.05)
                    result = window.evaluate_js("""(() => {
                        const buttons = [...document.querySelectorAll('.instrument-tab')];
                        if (buttons.length !== 10) return false;
                        document.querySelector('[data-station=thz]').click();
                        document.getElementById('trace-store').click();
                        return window.__SPECTRAL_DESKTOP__ && document.querySelectorAll('#plots .plot-card').length === 1
                            && document.getElementById('instrument-workspace').dataset.view === 'optics'
                            && !document.getElementById('instrument-bench').hidden
                            && Boolean(document.querySelector('#instrument-3d canvas'))
                            && typeof window.pywebview.api.open_measurement === 'function'
                            && Boolean(document.getElementById('instrument-alignment-sweep'))
                            && document.getElementById('parameter-thickness-value').valueAsNumber === 1
                            && document.getElementById('trace-memory-status').textContent.includes('5 graphs')
                            && document.getElementById('metrics').textContent.includes('1.67');
                    })()""")
                    if not result or server.transforms_served < 3:
                        raise RuntimeError(f"Native window or C FFT verification failed ({server.transforms_served} transforms).")
                    print(f"Native window verified with {server.transforms_served} C FFT calls.", flush=True)
                except Exception as error:
                    smoke_errors.append(error)
                finally:
                    window.destroy()

            webview.start(check_window if args.smoke_ui else None, gui="edgechromium" if sys.platform == "win32" else None)
            if smoke_errors:
                raise smoke_errors[0]
        finally:
            server.shutdown()
            thread.join()


if __name__ == "__main__":
    main()
