function result = spectral_bench_ftir(material, mode, mirror_travel_um, contact_fraction)
%SPECTRAL_BENCH_FTIR Simulate a Michelson interferogram and its IR spectrum.
%   R = SPECTRAL_BENCH_FTIR() simulates polystyrene in transmission mode.
%   R = SPECTRAL_BENCH_FTIR(MATERIAL, MODE, TRAVEL, CONTACT) accepts
%   'polystyrene' or 'pet', 'transmission' or 'atr', one-sided mirror
%   travel in micrometers, and ATR contact as a fraction between 0 and 1.
%   The result includes sample and background interferograms, wavenumbers,
%   relative transmittance and absorbance. No toolbox is required.

if nargin < 1, material = 'polystyrene'; end
if nargin < 2, mode = 'transmission'; end
if nargin < 3, mirror_travel_um = 320; end
if nargin < 4, contact_fraction = 0.90; end
material = validatestring(material, {'polystyrene', 'pet'});
mode = validatestring(mode, {'transmission', 'atr'});
validateattributes(mirror_travel_um, {'numeric'}, {'scalar','real','finite','>=',60,'<=',560});
validateattributes(contact_fraction, {'numeric'}, {'scalar','real','finite','>=',0,'<=',1});

switch material
    case 'polystyrene'
        bands = [698 12 0.78; 756 13 0.59; 1028 16 0.23; 1452 15 0.36; ...
                 1493 15 0.55; 1601 13 0.69; 2924 31 0.34; 3026 28 0.55];
    case 'pet'
        bands = [725 16 0.58; 872 15 0.35; 1016 18 0.46; 1095 27 0.62; ...
                 1242 27 0.68; 1410 18 0.33; 1716 26 0.94; 2960 37 0.20];
end

point_count = 4096;
wavenumber_step = 4;
positive = 2:point_count/2;
wavenumber = (positive - 1) * wavenumber_step;
opd_step_cm = 1 / (point_count * wavenumber_step);
optical_path_cm = (-point_count/2:point_count/2-1) * opd_step_cm;
max_opd_cm = 2 * mirror_travel_um / 10000;

edges = (1 - exp(-(wavenumber / 420).^4)) .* exp(-(wavenumber / 4700).^6);
background = edges .* (0.26 + 0.74 * exp(-0.5 * ((wavenumber - 2150) / 1150).^2));
absorbance = sum(bands(:,3) .* exp(-0.5 * ((wavenumber - bands(:,1)) ./ bands(:,2)).^2), 1);
if strcmp(mode, 'atr')
    background = 0.82 * background;
    % At fixed incidence angle and refractive indices, ATR penetration
    % depth is proportional to wavelength. Normalize at 1500 cm^-1.
    absorbance = absorbance .* (1500 ./ wavenumber) * contact_fraction;
end
sample = background .* 10.^(-absorbance);
background_interferogram = interferogram(background);
sample_interferogram = interferogram(sample);

recorded = abs(optical_path_cm) <= max_opd_cm;
apodization = zeros(size(optical_path_cm));
apodization(recorded) = 0.5 + 0.5 * cos(pi * optical_path_cm(recorded) / max_opd_cm);
background_fft = abs(fft(ifftshift(apodization .* background_interferogram)));
sample_fft = abs(fft(ifftshift(apodization .* sample_interferogram)));
report = wavenumber >= 500 & wavenumber <= 4000;
bins = positive(report);
transmittance = NaN(size(bins));
valid = background_fft(bins) > 1e-8;
transmittance(valid) = sample_fft(bins(valid)) ./ background_fft(bins(valid));
result = struct( ...
    'optical_path_um', 10000 * optical_path_cm(recorded), ...
    'background_interferogram', background_interferogram(recorded), ...
    'sample_interferogram', sample_interferogram(recorded), ...
    'wavenumber_cm1', wavenumber(report), 'transmittance', transmittance, ...
    'absorbance', -log10(transmittance), 'nominal_resolution_cm1', 1 / (2 * max_opd_cm));
end

function signal = interferogram(positive_spectrum)
symmetric_spectrum = [0, positive_spectrum, 0, positive_spectrum(end:-1:1)];
signal = fftshift(real(ifft(symmetric_spectrum)));
end
