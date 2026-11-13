function result = spectral_bench_thz(thickness_mm, index, absorption_cm1, include_echoes, window_ps)
%SPECTRAL_BENCH_THZ Simulate and analyze a transmission THz-TDS measurement.
%   R = SPECTRAL_BENCH_THZ() uses a 1 mm slab with n = 1.50, no absorption,
%   coherent internal reflections, and a 100 ps acquisition window.
%   R = SPECTRAL_BENCH_THZ(D, N, ALPHA, ECHOES, WINDOW) changes the slab
%   thickness (mm), refractive index, intensity absorption coefficient
%   (cm^-1), coherent echo setting, and acquisition window (ps).
%   The synthetic model assumes normal incidence and a homogeneous slab.
%   Signal synthesis and retrieval use base MATLAB FFT and IFFT.

if nargin < 1, thickness_mm = 1.00; end
if nargin < 2, index = 1.50; end
if nargin < 3, absorption_cm1 = 0; end
if nargin < 4, include_echoes = true; end
if nargin < 5, window_ps = 100; end
validateattributes(thickness_mm, {'numeric'}, {'scalar','real','finite','>=',0.2,'<=',2.5});
validateattributes(index, {'numeric'}, {'scalar','real','finite','>=',1.1,'<=',2.6});
validateattributes(absorption_cm1, {'numeric'}, {'scalar','real','finite','>=',0,'<=',30});
validateattributes(include_echoes, {'logical','numeric'}, {'scalar','binary'});
validateattributes(window_ps, {'numeric'}, {'scalar','real','finite','>=',40,'<=',150});

c_mm_per_ps = 0.299792458;
step_ps = 0.05;
point_count = 4096;
time = (0:point_count-1) * step_ps;
positive = 1:(point_count/2+1);
frequency = (positive - 1) / (point_count * step_ps);
offset = time - 6;
reference_field = 4.8 * (exp(-0.5 * (offset / 0.31).^2) - exp(-0.5 * (offset / 0.23).^2)) ...
    + 0.74 * (offset / 0.16) .* exp(-0.5 * (offset / 0.16).^2);

incident_spectrum = fft(reference_field);
positive_sample = incident_spectrum(positive) .* slab_transfer( ...
    frequency, index, absorption_cm1, thickness_mm, include_echoes, c_mm_per_ps);
positive_sample([1 end]) = real(positive_sample([1 end]));
sample_field = real(ifft([positive_sample, conj(positive_sample(end-1:-1:2))]));

recorded = time <= window_ps;
reference_arrival = pulse_time(time(recorded), reference_field(recorded));
sample_arrival = pulse_time(time(recorded), sample_field(recorded));
pulse_delay = sample_arrival - reference_arrival;
first_echo = 2 * index * thickness_mm / c_mm_per_ps;
measured_echo = NaN;
if include_echoes && first_echo > 2 && sample_arrival + first_echo + 0.5 < window_ps
    echo_window = abs(time - sample_arrival - first_echo) < 0.5;
    measured_echo = pulse_time(time(echo_window), sample_field(echo_window)) - sample_arrival;
end

% Use the same acquisition window and time origin for both fields.
taper = min(1, max(0, (window_ps - time) / 4));
taper = (1 - cos(pi * taper)) / 2;
reference_fft = fft(reference_field .* taper);
sample_fft = fft(sample_field .* taper);
reference_fft = reference_fft(positive);
sample_fft = sample_fft(positive);
reporting = frequency >= 0.15 & frequency <= 3.5;
frequency = frequency(reporting);
reference_fft = reference_fft(reporting);
sample_fft = sample_fft(reporting);
reference_peak = max(abs(reference_fft));
valid = abs(reference_fft) > 0.018 * reference_peak & abs(sample_fft) > 0.004 * reference_peak;
transfer = complex(NaN(size(frequency)), NaN(size(frequency)));
transfer(valid) = sample_fft(valid) ./ reference_fft(valid);
phase = angle(transfer);
expected_phase = -2 * pi * frequency * pulse_delay;
phase = phase + 2 * pi * round((expected_phase - phase) / (2 * pi));

retrieved_index = NaN(size(frequency));
retrieved_absorption = NaN(size(frequency));
for bin = find(valid)
    [retrieved_index(bin), retrieved_absorption(bin)] = fit_slab( ...
        frequency(bin), transfer(bin), phase(bin), thickness_mm, include_echoes, c_mm_per_ps);
end
usable = isfinite(retrieved_index) & frequency > 0.4 & frequency < 1.4;
result = struct( ...
    'time_ps', time(recorded), 'reference_field', reference_field(recorded), 'sample_field', sample_field(recorded), ...
    'frequency_thz', frequency, 'reference_spectrum', reference_fft, 'sample_spectrum', sample_fft, ...
    'transfer', transfer, 'phase_rad', phase, 'refractive_index', retrieved_index, ...
    'absorption_cm1', retrieved_absorption, 'mean_refractive_index', mean(retrieved_index(usable)), ...
    'mean_absorption_cm1', mean(retrieved_absorption(usable)), 'primary_delay_ps', pulse_delay, ...
    'echo_spacing_ps', measured_echo, 'nominal_frequency_resolution_thz', 1 / window_ps);
end

function transfer = slab_transfer(frequency, index, absorption, thickness, echoes, c)
phase = 2 * pi * frequency * thickness / c;
loss = absorption * thickness / 10;
transmitted = 4 * index / (1 + index)^2 * exp(-loss/2 - 1i * phase * (index-1));
if echoes
    reflectance = ((index - 1) / (index + 1))^2;
    round_trip = reflectance * exp(-loss - 2i * phase * index);
    transfer = transmitted ./ (1 - round_trip);
else
    transfer = transmitted;
end
end

function [index, absorption] = fit_slab(frequency, observed, phase, thickness, echoes, c)
index = 1 - phase * c / (2 * pi * frequency * thickness);
absorption = NaN;
if ~isfinite(index) || index < 0.5 || index > 3.6 || abs(observed) < 1e-7
    index = NaN;
    return
end
interface = 4 * index / (1 + index)^2;
absorption = -20 / thickness * log(abs(observed) / interface);
for iteration = 1:10
    prediction = slab_transfer(frequency, index, absorption, thickness, echoes, c);
    residual = observed - prediction;
    if abs(residual) < 1e-8, break; end
    derivative_index = (slab_transfer(frequency, index + 1e-5, absorption, thickness, echoes, c) - prediction) / 1e-5;
    derivative_absorption = (slab_transfer(frequency, index, absorption + 1e-3, thickness, echoes, c) - prediction) / 1e-3;
    jacobian = [real(derivative_index), real(derivative_absorption); imag(derivative_index), imag(derivative_absorption)];
    if abs(det(jacobian)) < 1e-12, break; end
    update = jacobian \ [real(residual); imag(residual)];
    index = index + update(1);
    absorption = absorption + update(2);
    if index < 0.5 || index > 3.6 || absorption < -120 || absorption > 1000
        break
    end
end
if abs(slab_transfer(frequency, index, absorption, thickness, echoes, c) - observed) > 1e-3 ...
        || ~isfinite(index) || ~isfinite(absorption)
    index = NaN;
    absorption = NaN;
end
end

function time_at_peak = pulse_time(time, field)
[~, peak] = max(field);
time_at_peak = time(peak);
if peak <= 1 || peak >= numel(field), return; end
left = field(peak-1);
center = field(peak);
right = field(peak+1);
fraction = (left - right) / (2 * (left - 2*center + right));
if isfinite(fraction) && abs(fraction) < 1
    time_at_peak = time_at_peak + fraction * (time(2) - time(1));
end
end
