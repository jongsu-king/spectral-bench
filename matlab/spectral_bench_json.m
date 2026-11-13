function payload = spectral_bench_json(instrument, settings_json)
%SPECTRAL_BENCH_JSON Return an FTIR or THz-TDS plot as JSON for MATLAB Engine.
%   PAYLOAD = SPECTRAL_BENCH_JSON(INSTRUMENT, SETTINGS_JSON) accepts the
%   Spectral Bench instrument ID and its JSON-encoded controls.

instrument = validatestring(instrument, {'thz','ftir'});
settings = jsondecode(settings_json);
if ~isstruct(settings) || ~isscalar(settings)
    error('SpectralBench:InvalidSettings', 'Settings must be a JSON object.');
end
switch instrument
    case 'thz'
        result = spectral_bench_thz(setting(settings, 'thickness', 1), ...
            setting(settings, 'index', 1.5), setting(settings, 'absorption', 0), ...
            setting(settings, 'echoes', true), setting(settings, 'window', 100));
        summary = sprintf('Primary pulse delay %.3f ps.', result.primary_delay_ps);
        if isfinite(result.echo_spacing_ps)
            summary = sprintf('%s First echo follows after %.3f ps.', summary, result.echo_spacing_ps);
        end
        if isfinite(result.mean_refractive_index)
            summary = sprintf('%s Retrieved mean index %.4f.', summary, result.mean_refractive_index);
        end
        series = [line_series('Air reference', result.time_ps, result.reference_field), ...
                  line_series('Sample', result.time_ps, result.sample_field)];
        chart = struct('title', 'MATLAB THz time-domain electric field', 'xLabel', 'Time (ps)', ...
            'yLabel', 'Electric field (a.u.)', 'series', series, 'summary', summary);
    case 'ftir'
        mode = validatestring(setting(settings, 'mode', 'transmission'), {'transmission','atr'});
        mirror_travel = setting(settings, 'mirrorTravel', 320);
        contact_percent = setting(settings, 'contact', 90);
        validateattributes(contact_percent, {'numeric'}, {'scalar','real','finite','>=',0,'<=',100});
        result = spectral_bench_ftir(setting(settings, 'material', 'polystyrene'), ...
            mode, mirror_travel, contact_percent / 100);
        if strcmp(mode, 'atr')
            label = 'Absorbance (a.u.)';
            signal = result.absorbance;
        else
            label = 'Transmittance (%)';
            signal = 100 * result.transmittance;
        end
        series = line_series('Sample / background', result.wavenumber_cm1, signal);
        summary = sprintf('Maximum optical path difference %.0f µm. Nominal resolution %.2f cm⁻¹.', ...
            2 * mirror_travel, result.nominal_resolution_cm1);
        chart = struct('title', 'MATLAB background-corrected FTIR spectrum', ...
            'xLabel', 'Wavenumber (cm⁻¹)', 'yLabel', label, 'series', series, 'summary', summary);
end
% A cell array ensures that one spectrum is still encoded as a JSON array.
chart.series = num2cell(chart.series);
payload = jsonencode(chart);
end

function value = setting(settings, name, fallback)
if isfield(settings, name)
    value = settings.(name);
else
    value = fallback;
end
end

function series = line_series(name, x, y)
series = struct('name', name, 'x', x, 'y', y);
end
