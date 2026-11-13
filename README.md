# Spectral Bench — Instrument Laboratory

Spectral Bench is an English-language desktop simulator for nine instruments: array spectrometer, UV–Vis with an integrating sphere, steady-state PL, TRPL, confocal Raman, FTIR with ATR, spectroscopic ellipsometer, pump–probe transient absorption, and THz‑TDS.

The app opens on the UV–Vis **3D Ray Tracing** view. Every instrument starts with the ray tracer above its live measurement. Choose **Acquisition** for a larger plot. Choose **Workbench** for a separate collimation, folded-beam, grating, or empty layout. Add lenses, mirrors, sources, detectors, apertures, splitters, filters, and gratings from Components. Use Inspector to edit X/Y/Z in millimeters, rotations in degrees, or optical parameters such as focal length and reflectivity. Turn on **Labels** to identify every optic at once.

Drag an optic in Move mode, holding Alt to change height. In Rotate mode drag about Z, Shift-drag about Y, or Alt-drag about X. Drag the background to orbit, use the right or middle button to pan, and scroll to zoom. The view menu also has Top, Front, and Side projections. Rays, sensor pixels, detected spectrum, captured power, and spot radius update when optics change.

Source presets include a single line, three lines, a sampled visible band, near-infrared lines, and custom wavelength/weight pairs. Each source accepts up to 301 rays per wavelength. The tracer limits the combined ray budget in dense scenes to keep the controls responsive.

Open **Distances** to inspect each selected ray segment, including axis displacements and cumulative distance. Set the detector offset range and step, then click **Run sweep** for axial power and RMS spot radius. **MATLAB code** generates a runnable base-MATLAB script for the current layout and sweep. The code computes new ray paths, detector results, and path distances and can be edited independently.

All nine instrument tabs have their own editable 3D bench. Select **Thin lens** or **Plane mirror** and click **Add** to insert it into the beam, then drag it in **Move** or **Rotate** mode, or enter coordinates, angles and optical properties in the inspector. The detector signal, analysis and mean optical path lengths update as you edit. In **Inspect ray** mode, click a ray to highlight it and see which optics it crosses, the distance per segment and whether it reaches a detector. Each tab keeps its own layout, measurement settings and captured reference and dark scans. **Reset layout** restores the factory optics. **Open in Workbench** copies the active layout for detector distance sweeps. A saved session includes the instrument layouts and the separate workbench.

Enter a value beside an instrument slider to set it directly. **Stop** cancels an acquisition in progress. The bench toolbar has **Undo** and **Redo** for optic edits (Ctrl/⌘+Z and Ctrl/⌘+Shift+Z). A drag counts as one edit.

Open **Alignment sweep** below the ray paths and select an optic, detector, and position or rotation axis. The sweep traces 2–61 offsets from the current pose and reports optical transfer, detector power, detected rays, and RMS spot radius. Select a result and use **Apply offset** to move the optic in one undoable edit. The sweep table can be exported to CSV.

Use **Import CSV** to overlay a measured trace on an instrument plot. Select its X and Y columns and a simulation trace with the same units. CSV, TSV, semicolon-delimited files, and line traces in Spectral Bench CSV exports are supported. RMSE and bias use the overlapping measured samples, with the simulation interpolated at their X values. Each instrument retains one imported trace in the session and includes it in CSV export.

Use **Trace memory → Store trace** to keep a copy of the displayed sample line plots. The stored traces appear dashed over matching live graphs. You can turn off **Overlay** without losing the trace. Each instrument has its own trace memory, which is included in session files and written to CSV as `memory_signal` rows. For graph measurements, click to place cursor A, Shift-click to place B and read the distance between them, and press Escape to clear both. On the transient absorption map, the cursor readout also shows the difference along the second axis.

- **Graph / Data:** Choose a measurement channel in **Display**, or view all graphs. Data shows the actual samples of a selected trace or a delay slice of the TA map.
- **Fit:** Select a trace, then choose Gaussian, Lorentzian, exponential decay, double exponential decay, or linear. Enter a range or use the graph's A/B cursors. The app shows the fit, residuals, fit values, RMSE and R². CSV export includes the current fit when it still matches the displayed data. These are trace models; the instrument's dedicated analysis (such as TRPL reconvolution) is shown separately.
- **3D map:** TA can display its wavelength–delay grid directly. For any instrument, select a line plot and sweep one numeric setting. The app runs the instrument model at each setting; when the line grids differ, it interpolates to the original X axis without filling gaps. Drag to rotate, scroll to zoom, and use **Export map CSV** for the numeric grid.
- **Sample:** Choose one of 18 literature-based samples or calibration inputs. **Source & model notes** links to the experiment or reference data and identifies approximated linewidths, intensities, decay terms, or optical constants. The selected specimen is retained in the session and included in the measurement MATLAB script.

## Launch

Open `releases/Spectral Bench.app` on Apple Silicon macOS. The app bundles its Python runtime, HTML interface, and C FFT library. It uses the system WebKit view and can run offline.

### MATLAB

On any instrument tab, click **MATLAB code**, then **Save .m file**. Run the standalone script in MATLAB to trace the exported layout and calculate the instrument's measurement using the exported settings, acquisition mode, reference and dark scans. The output includes `measurement.charts`, `measurement.metrics`, `rayTrace`, `detectorSummary` and `pathSegments`. The script retraces the setup when you edit `scene.parts` in MATLAB. A set of nine ready-to-run scripts ships in the macOS installer. To regenerate them, run `node tools/generate_matlab_examples.mjs`.

In **FTIR** or **THz–TDS**, select **MATLAB** in **FFT engine** to use the installed MATLAB release for the instrument FFTs. **Run MATLAB model** is a separate bundled demonstration using nominal alignment. Native C is the default engine.

MATLAB mode needs a licensed, installed MATLAB release and its Python Engine. The app looks for the engine shipped with R2026a and later in the standard installation folders. For a custom location, set `MATLAB_ROOT` to the installed MATLAB root before launching from a terminal. You can also run the examples in MATLAB with `addpath('matlab'); spectral_bench_demo` from this project directory. [MathWorks Engine setup](https://www.mathworks.com/help/matlab/matlab_external/install-the-matlab-engine-for-python.html)

## Build and verify

On macOS, install Xcode Command Line Tools and run these commands with Python 3.12:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-desktop.txt
.venv/bin/python tools/build_desktop.py
```

For a Windows build, run the same build script in an x64 Visual Studio Developer Command Prompt with Python 3.12, the C/C++ build tools, and the Microsoft Edge WebView2 Runtime available:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-desktop.txt
.venv\Scripts\python.exe tools\build_desktop.py
```

The Windows output is the `releases/Spectral Bench/` folder. Keep that folder together and launch `Spectral Bench.exe` inside it.

Use `node --test` for instrument models. Run `desktop.py --self-test` after building the C library to check the native transform and bundled asset server. Run `desktop.py --smoke-ui` to verify the desktop window and that THz analysis reaches the C library. On a MATLAB-equipped machine, `desktop.py --self-test-matlab` compares the C and MATLAB FFTs and runs both MATLAB simulations through the application server.

## Model scope

Signals come from synthetic sources and samples. The 3D tracer uses geometric paths through finite optics and paraxial thin lenses. The instrument models use the resulting detector hits, wavelength-dependent throughput and the relevant path geometry for calibration, excitation, timing, angle or phase. Integrating-sphere collection is simplified. Results require separate calibration and validation before use with real measurements.
