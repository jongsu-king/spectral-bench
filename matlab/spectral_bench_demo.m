function [thz, ftir] = spectral_bench_demo(plot_results)
%SPECTRAL_BENCH_DEMO Verify and plot the standalone MATLAB simulations.
%   SPECTRAL_BENCH_DEMO() runs the examples and opens a figure.
%   SPECTRAL_BENCH_DEMO(FALSE) runs the numeric checks without graphics.

if nargin < 1, plot_results = true; end
thz = spectral_bench_thz();
ftir = spectral_bench_ftir();
assert(abs(thz.primary_delay_ps - 1.668) < 0.025, 'THz primary delay differs from the 1 mm slab prediction.');
assert(abs(thz.echo_spacing_ps - 10.007) < 0.05, 'The first THz echo is missing or misplaced.');
assert(abs(thz.mean_refractive_index - 1.50) < 0.02, 'THz index retrieval is outside tolerance.');
assert(abs(thz.mean_absorption_cm1) < 0.2, 'THz absorption for the lossless slab is outside tolerance.');
[~, peak] = max(ftir.absorbance);
assert(abs(ftir.wavenumber_cm1(peak) - 698) <= 8, 'The simulated polystyrene absorption maximum is misplaced.');
no_contact = spectral_bench_ftir('polystyrene', 'atr', 320, 0);
assert(max(abs(no_contact.absorbance)) < 1e-9, 'Zero ATR contact must give the crystal background.');

fprintf('THz-TDS: %.3f ps primary delay, %.3f ps first echo, n = %.4f.\n', ...
    thz.primary_delay_ps, thz.echo_spacing_ps, thz.mean_refractive_index);
fprintf('FTIR: principal polystyrene band at %.0f cm^-1.\n', ftir.wavenumber_cm1(peak));
if ~plot_results, return; end

figure('Name', 'Spectral Bench MATLAB Simulations', 'Color', 'white');
subplot(2, 2, 1);
plot(thz.time_ps, thz.reference_field, thz.time_ps, thz.sample_field);
xlim([3 21]); grid on;
xlabel('Time (ps)'); ylabel('Electric field (a.u.)'); title('THz time-domain traces');
legend('Air reference', 'Sample', 'Location', 'best');
subplot(2, 2, 2);
plot(thz.frequency_thz, thz.refractive_index); grid on;
xlabel('Frequency (THz)'); ylabel('Refractive index'); title('THz slab retrieval');
subplot(2, 2, 3);
plot(ftir.optical_path_um, ftir.background_interferogram, ftir.optical_path_um, ftir.sample_interferogram);
xlim([-35 35]); grid on;
xlabel('Optical path difference (um)'); ylabel('Detector signal (a.u.)'); title('Michelson interferograms');
legend('Background', 'Sample', 'Location', 'best');
subplot(2, 2, 4);
plot(ftir.wavenumber_cm1, ftir.absorbance); set(gca, 'XDir', 'reverse'); grid on;
xlabel('Wavenumber (cm^{-1})'); ylabel('Absorbance'); title('FTIR polystyrene spectrum');
end
