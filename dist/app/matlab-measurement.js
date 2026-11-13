import { matlabJson, matlabRaySolver } from './matlab-export3d.js';
import { createInstrumentScene, measurementPaths } from './instrument-optics.js';

const instrumentNames = {
  array: 'Array Spectrometer',
  uv: 'UV–Vis Spectrophotometer',
  pl: 'Steady-state Photoluminescence',
  trpl: 'Time-resolved Photoluminescence',
  raman: 'Raman Spectrometer',
  ftir: 'FTIR Spectrometer',
  ellipsometry: 'Spectroscopic Ellipsometer',
  ta: 'Transient Absorption',
  thz: 'Terahertz Time-domain Spectrometer',
};

function transferData(value = {}) {
  const geometry = { ...value.geometry };
  for (const key of ['arrayDetector', 'arrayCalibration']) {
    if (geometry[key]) {
      const { width, hits } = geometry[key];
      geometry[key] = { width, hits: hits.map(({ u, wavelength, power }) => ({ u, wavelength, power })) };
    }
  }
  return {
    coupling: value.coupling ?? 1,
    geometry,
    spectralSamples: value.spectralSamples ?? [],
    paths: value.paths ?? {},
    nominalPaths: value.nominalPaths ?? {},
  };
}

function acquisitionData(value) {
  if (!value) return [];
  const transfer = value.opticalTransfer ?? value;
  return {
    settings: value.settings ?? {},
    seed: value.seed ?? 631,
    ...transferData(transfer),
    scene: transfer.traceScene ?? transfer.scene ?? value.scene ?? [],
  };
}

export function generateMatlabMeasurement(instrumentId, scene, {
  settings = {}, mode = 'sample', seed = 631, reference = null, dark = null, opticalTransfer = {},
} = {}) {
  if (instrumentId === 'uvvis') instrumentId = 'uv';
  if (!Object.hasOwn(instrumentNames, instrumentId)) throw new Error('Unknown instrument: ' + instrumentId);
  const savedScene = {
    name: instrumentNames[instrumentId],
    ...(opticalTransfer.traceScene ?? opticalTransfer.scene ?? scene),
  };
  const arrayLampScene = instrumentId === 'array'
    ? createInstrumentScene('array', { ...settings, alignment: 0, positions: undefined }) : null;
  if (arrayLampScene) {
    arrayLampScene.parts.find(part => part.id === 'fiber').spectrum = [
      { wavelength: 405, power: 0.65 }, { wavelength: 436, power: 0.83 },
      { wavelength: 546, power: 1 }, { wavelength: 578, power: 0.62 },
      { wavelength: 630, power: 0.5 },
    ];
  }
  return [
    '% Spectral Bench | ' + instrumentNames[instrumentId],
    '% Run as a MATLAB script. Positions and focal lengths are in mm, rotations in degrees,',
    '% wavelengths in nm, and ray powers in mW. Measurement settings retain their instrument units.',
    '% Edit settings and scene.parts before the measurement call to rerun the instrument.',
    '% Source wavelength lists and other optical settings are specified in scene.parts.',
    '% measurement.charts holds the plotted data, measurement.metrics the calculated values.',
    '% rayTrace, detectorSummary and pathSegments hold the 3D ray trace and distances.',
    '',
    'instrumentId = ' + matlabJson(instrumentId),
    'savedSettings = ' + matlabJson(settings),
    'settings = savedSettings;',
    'acquisitionMode = ' + matlabJson(mode),
    'measurementSeed = ' + matlabJson(seed),
    'savedScene = ' + matlabJson(savedScene),
    'savedScene = prepareMeasurementScene(savedScene);',
    'scene = savedScene;',
    '% To rotate a component, set scene.parts{3}.rotation(3) to its new angle.',
    'savedTransfer = ' + matlabJson(transferData(opticalTransfer)),
    'pathDefinitions = ' + matlabJson(measurementPaths[instrumentId]),
    'arrayLampScene = ' + matlabJson(arrayLampScene),
    'reference = ' + matlabJson(acquisitionData(reference)),
    'dark = ' + matlabJson(acquisitionData(dark)),
    '',
    'rayTrace = traceOptics(scene);',
    '[detectorSummary, pathSegments] = summarizeTrace(rayTrace);',
    'opticalTransfer = measureTransfer(instrumentId, settings, acquisitionMode, scene, rayTrace, savedScene, savedTransfer, pathDefinitions, arrayLampScene);',
    "if isempty(reference) && strcmp(acquisitionMode,'sample') && ~isequaln(scene,savedScene) ...",
    "        && any(strcmp(instrumentId,{'uv','ftir','thz'}))",
    '    reference = savedTransfer;',
    '    reference.settings = savedSettings;',
    '    reference.seed = measurementSeed;',
    '    reference.scene = savedScene;',
    'end',
    'measurement = runMeasurement(instrumentId, settings, acquisitionMode, measurementSeed, opticalTransfer, reference, dark);',
    'disp(detectorSummary);',
    'disp(measurement.metrics);',
    'drawOptics(scene, rayTrace);',
    'plotMeasurement(measurement, ' + "'" + instrumentNames[instrumentId] + "'" + ');',
    matlabRaySolver,
    matlabMeasurementSolver,
  ].join('\n');
}

const matlabMeasurementSolver = `
function scene = prepareMeasurementScene(scene)
    if ~iscell(scene.parts), scene.parts = num2cell(scene.parts); end
    for k = 1:numel(scene.parts)
        part = scene.parts{k};
        part.position = pointValue(part,'position',[0,0,70]);
        part.rotation = pointValue(part,'rotation',[0,0,0]);
        scene.parts{k} = part;
    end
end

function result = runMeasurement(id, s, mode, seed, optical, reference, dark)
    ref = [];
    darkResult = [];
    if ~isempty(reference)
        ref = runMeasurement(id, reference.settings, 'reference', reference.seed, reference, [], []);
    end
    if ~isempty(dark)
        darkResult = runMeasurement(id, dark.settings, 'dark', dark.seed, dark, [], []);
    end
    switch id
        case 'array'
            result = measureArray(s,mode,optical,ref);
        case 'uv'
            result = measureUvVis(s,mode,optical,ref,darkResult);
        case 'pl'
            result = measurePL(s,mode,seed,optical,ref);
        case 'trpl'
            result = measureTRPL(s,mode,seed,optical,ref);
        case 'raman'
            result = measureRaman(s,mode,optical);
        case 'ftir'
            result = measureFTIR(s,mode,optical,reference);
        case 'ellipsometry'
            result = measureEllipsometry(s,mode,optical,reference);
        case 'ta'
            result = measureTA(s,mode,optical);
        case 'thz'
            result = measureTHz(s,mode,optical,reference);
    end
    result.mode = mode;
    result.opticalTransfer = optical;
end

function output = setting(s, key, fallback)
    output = fallback;
    if isstruct(s) && isfield(s,key) && ~isempty(s.(key))
        output = s.(key);
    end
end

function y = gauss(x,center,sigma)
    y = exp(-0.5*((x-center)./sigma).^2);
end

function x = jsRound(x)
    x = floor(x + 0.5);
end

function y = positiveRatio(numerator,denominator)
    y = NaN(size(numerator));
    usable = denominator > 0;
    y(usable) = numerator(usable)./denominator(usable);
end

function absorbance = toAbsorbance(ratio)
    absorbance = NaN(size(ratio));
    positive = ratio > 0;
    absorbance(positive) = -log10(ratio(positive));
end

function gain = measurementGain(optical, mode)
    gain = setting(optical,'coupling',1);
    if strcmp(mode,'dark'), gain = 0; end
end

function gain = spectralGain(optical, wavelength, ~)
    gain = ones(size(wavelength));
    samples = setting(optical,'spectralSamples',[]);
    if isscalar(samples) && isstruct(samples)
        gain = gain*samples.power;
    elseif isstruct(samples) && numel(samples)>1
        wavelengths = [samples.wavelength];
        clipped = min(max(wavelength,min(wavelengths)),max(wavelengths));
        gain = interp1(wavelengths,[samples.power],clipped,'linear');
    end
end

function a = mergeSettings(a,b)
    keys = fieldnames(b);
    for k = 1:numel(keys)
        a.(keys{k}) = b.(keys{k});
    end
end

function data = measurementSeries(name,x,y)
    data = struct('name',name,'x',reshape(x,1,[]),'y',reshape(y,1,[]));
end

function output = measurementChart(titleText,xLabel,yLabel,varargin)
    output = struct('title',titleText,'xLabel',xLabel,'yLabel',yLabel,'series',[varargin{:}],'heatmap',[]);
end

function plotMeasurement(measurement, name)
    figure('Name',name,'Color','white');
    tiledlayout(numel(measurement.charts),1,'TileSpacing','compact');
    for chart = measurement.charts
        nexttile;
        if ~isempty(chart.heatmap)
            imagesc(chart.heatmap.x,chart.heatmap.y,chart.heatmap.z);
            axis xy;
            colorbar;
        else
            hold on;
            for series = chart.series
                plot(series.x,series.y,'LineWidth',1.1,'DisplayName',series.name);
            end
            if numel(chart.series)>1, legend('Location','best'); end
            hold off;
        end
        grid on;
        title(chart.title);
        xlabel(chart.xLabel);
        ylabel(chart.yLabel);
    end
end

function [count,state] = measuredPoisson(meanValue,state)
    % The browser uses the same 32-bit LCG and switches to a normal approximation at 30.
    count = 0;
    if ~(meanValue > 0), return; end
    [first,state] = randomValue(state);
    if meanValue >= 30
        [second,state] = randomValue(state);
        normal = sqrt(-2*log(first))*cos(2*pi*second);
        count = max(0,jsRound(meanValue+normal*sqrt(meanValue)));
        return
    end
    product = first;
    threshold = exp(-meanValue);
    while product > threshold
        [next,state] = randomValue(state);
        product = product*next;
        count = count+1;
    end
end

function [value,state] = randomValue(state)
    state = mod(1664525*state+1013904223,4294967296);
    value = (state+0.5)/4294967296;
end

function [counts,state] = photonCounts(expectation,seed)
    counts = zeros(size(expectation));
    state = mod(fix(seed),4294967296);
    for k = 1:numel(expectation)
        [counts(k),state] = measuredPoisson(expectation(k),state);
    end
end

function result = measureTransfer(id,s,mode,scene,trace,savedScene,saved,definitions,arrayLampScene)
    % Use the captured calibration for an unchanged layout. Any optical edits
    % are retraced and compared with the instrument's nominal path calibration.
    result = saved;
    if isequaln(scene,savedScene), return; end
    nominal = saved.nominalPaths;
    if isempty(fieldnames(nominal)), return; end
    parts = normalizeParts(scene.parts);
    fields = fieldnames(definitions);
    paths = struct();
    for k = 1:numel(fields)
        name = fields{k};
        paths.(name) = summarizeMeasurementPath(trace,parts,definitions.(name),~strcmp(id,'array'));
    end
    result.paths = paths;
    geometry = saved.geometry;
    coupling = 1;
    if isfield(paths,'signal')
        coupling = pathGain(paths.signal,nominal.signal);
    end
    if isfield(paths,'excitation')
        geometry.excitationCoupling = pathGain(paths.excitation,nominal.excitation);
    end
    c = 0.299792458;
    switch id
        case 'array'
            detector = measurementPart(trace.detectors,'detector');
            geometry.arrayDetector = measurementCCD(detector);
            if ~isfield(geometry,'arrayCalibration') && ~isempty(arrayLampScene)
                calibrationTrace = traceOptics(arrayLampScene);
                geometry.arrayCalibration = measurementCCD(measurementPart(calibrationTrace.detectors,'detector'));
            end
            if ~isfield(geometry,'arrayGain')
                if any(cellfun(@(part) startsWith(part.id,'fiber-band-'),parts))
                    lines = arraySource(s,mode);
                    geometry.arrayGain = 1300*sum(lines(:,2));
                else
                    source = measurementPart(parts,'fiber');
                    [~,weights] = sourceSpectrum(source);
                    geometry.arrayGain = 1300*sum(weights);
                end
            end
        case 'trpl'
            geometry.trplDelayOffset = (pathDelta(paths.excitation,nominal.excitation) ...
                + pathDelta(paths.signal,nominal.signal))/(c*1000);
        case 'ftir'
            coupling = sqrt(pathGain(paths.moving,nominal.moving)*pathGain(paths.fixed,nominal.fixed));
            total = paths.moving.power+paths.fixed.power;
            geometry.ftirArmVisibility = 0;
            if total>1e-12
                geometry.ftirArmVisibility = 2*sqrt(paths.moving.power*paths.fixed.power)/total;
            end
            geometry.ftirOpdOffset = 1000*(pathDelta(paths.moving,nominal.moving)-pathDelta(paths.fixed,nominal.fixed));
        case 'ellipsometry'
            angle = setting(s,'incidenceAngle',65);
            if ~isempty(paths.sample.incidence) && ~isempty(nominal.sample.incidence)
                angle = min(89.99,max(0.01,angle+paths.sample.incidence-nominal.sample.incidence));
            end
            geometry.incidenceAngle = angle;
        case 'ta'
            geometry.pumpCoupling = setting(s,'pump',true)*pathGain(paths.pump,nominal.pump);
            probeDelta = pathDelta(paths.probe,nominal.probe);
            if isfield(paths,'generation')
                coupling = coupling*pathGain(paths.generation,nominal.generation);
                probeDelta = probeDelta+pathDelta(paths.generation,nominal.generation);
            end
            geometry.taDelayOffset = (pathDelta(paths.pump,nominal.pump)-probeDelta)/c;
            geometry.taOffset = 0;
            centroids = {paths.pump.centroid,paths.probe.centroid,nominal.pump.centroid,nominal.probe.centroid};
            if ~any(cellfun(@isempty,centroids))
                geometry.taOffset = 1000*norm(centroids{1}(:)-centroids{2}(:)-centroids{3}(:)+centroids{4}(:));
            end
        case 'thz'
            geometry.pumpCoupling = pathGain(paths.pump,nominal.pump);
            geometry.gateCoupling = pathGain(paths.gate,nominal.gate);
            coupling = sqrt(coupling)*geometry.pumpCoupling*geometry.gateCoupling;
            geometry.thzStageOffset = 500*(pathDelta(paths.gate,nominal.gate) ...
                - pathDelta(paths.pump,nominal.pump)-pathDelta(paths.signal,nominal.signal));
    end
    result.geometry = geometry;
    result.coupling = coupling;
    if ~isempty(saved.spectralSamples)
        spectralNormalization = coupling;
        if strcmp(id,'ta') && isfield(paths,'generation')
            spectralNormalization = pathGain(paths.signal,nominal.signal);
        end
        result.spectralSamples = relativeRaySpectrum(paths.signal.spectrum,nominal.signal.spectrum,spectralNormalization);
    end
end

function ccd = measurementCCD(detector)
    ccd = struct('width',1,'hits',[]);
    if isempty(detector), return; end
    data = detector.hits;
    ccd.width = detector.width;
    ccd.hits = struct('u',num2cell(data(:,1)),'wavelength',num2cell(data(:,3)),'power',num2cell(data(:,4)));
end

function part = measurementPart(parts,id)
    part = [];
    index = find(cellfun(@(item) strcmp(item.id,id),parts),1);
    if ~isempty(index), part = parts{index}; end
end

function path = summarizeMeasurementPath(trace,parts,definition,weighted)
    path = struct('power',0,'rawPower',0,'count',0,'distance',[], ...
        'centroid',[],'incidence',[],'spectrum',[]);
    target = measurementPart(parts,definition.target);
    if isempty(target), return; end
    counted = false(1,numel(trace.rays)*20);
    via = setting(definition,'via',{});
    detector = setting(definition,'detector',false);
    prefix = setting(definition,'sourcePrefix','');
    wavelength = zeros(1,numel(trace.rays));
    contribution = zeros(size(wavelength));
    distance = 0;
    centroid = [0,0,0];
    incidence = 0;
    for j = 1:numel(trace.rays)
        ray = trace.rays{j};
        sourceMatches = strcmp(ray.sourceId,definition.source) || (~isempty(prefix) && startsWith(ray.sourceId,prefix));
        if ~sourceMatches || (detector && ~strcmp(ray.detectorId,target.id)), continue; end
        events = ray.interactions;
        ids = cellfun(@(hit) hit.partId,events,'UniformOutput',false);
        k = find(strcmp(ids,target.id),1);
        if detector, k = numel(events); end
        if isempty(k) || k==0 || ~all(ismember(via,ids(1:k-1))), continue; end
        hit = events{k};
        if hit.inputPower <= 1e-12 || (hit.eventId<=numel(counted) && counted(hit.eventId)), continue; end
        counted(hit.eventId) = true;
        point = ray.points(k+1,:);
        attenuation = 1;
        if weighted && detector
            offset = point-target.position;
            u = 2*dot(offset,target.u)/target.width;
            v = 2*dot(offset,target.v)/target.height;
            attenuation = exp(-0.5*(u^2+v^2));
        end
        power = hit.inputPower*attenuation;
        direction = point-ray.points(k,:);
        cosine = min(1,max(0,abs(dot(direction,target.normal))/norm(direction)));
        path.rawPower = path.rawPower+hit.inputPower;
        path.power = path.power+power;
        path.count = path.count+1;
        distance = distance+power*hit.pathLength;
        centroid = centroid+power*point;
        incidence = incidence+power*acosd(cosine);
        wavelength(path.count) = ray.wavelength;
        contribution(path.count) = power;
    end
    if path.power<=1e-12, return; end
    path.distance = distance/path.power;
    path.centroid = centroid/path.power;
    path.incidence = incidence/path.power;
    [bands,~,group] = unique(wavelength(1:path.count));
    powers = accumarray(group(:),contribution(1:path.count).');
    path.spectrum = struct('wavelength',num2cell(bands(:)),'power',num2cell(powers));
end

function gain = pathGain(path,baseline)
    gain = 0;
    if baseline.power>1e-12, gain = path.power/baseline.power; end
end

function change = pathDelta(path,baseline)
    change = 0;
    if ~isempty(path.distance) && ~isempty(baseline.distance)
        change = path.distance-baseline.distance;
    end
end

function samples = relativeRaySpectrum(signal,baseline,coupling)
    wavelengths = unique([raySpectrumField(signal,'wavelength'),raySpectrumField(baseline,'wavelength')]);
    received = zeros(size(wavelengths));
    nominal = received;
    baselineWavelengths = raySpectrumField(baseline,'wavelength');
    baselinePowers = raySpectrumField(baseline,'power');
    if numel(baselineWavelengths)==1
        nominal(:) = baselinePowers;
    elseif numel(baselineWavelengths)>1
        clipped = min(max(wavelengths,min(baselineWavelengths)),max(baselineWavelengths));
        nominal = interp1(baselineWavelengths,baselinePowers,clipped,'linear');
    end
    if ~isempty(signal)
        [~,ix] = ismember([signal.wavelength],wavelengths);
        received(ix) = [signal.power];
    end
    ratio = zeros(size(received));
    valid = nominal>1e-12 & coupling>1e-12;
    ratio(valid) = received(valid)./nominal(valid)/coupling;
    samples = struct('wavelength',num2cell(wavelengths),'power',num2cell(ratio));
end

function values = raySpectrumField(spectrum,key)
    values = [];
    if ~isempty(spectrum), values = [spectrum.(key)]; end
end

function result = measureArray(s,mode,optical,ref)
    pixels = 0:767;
    bins = zeros(size(pixels));
    geometry = setting(optical,'geometry',[]);
    detector = setting(geometry,'arrayDetector',[]);
    hits = setting(detector,'hits',[]);
    width = setting(detector,'width',1);
    scale = setting(geometry,'arrayGain',1300);
    if ~strcmp(mode,'dark') && isstruct(hits) && width>0
        for hit = hits(:).'
            pixel = (0.5+hit.u/width)*767;
            use = abs(pixels-pixel)<=3;
            bins(use) = bins(use)+scale*hit.power*gauss(pixels(use),pixel,0.65)/(0.65*sqrt(2*pi));
        end
    elseif ~strcmp(mode,'dark') && isempty(detector)
        lines = arraySource(s,mode);
        slit = setting(s,'slit',70);
        for k = 1:size(lines,1)
            for sample = 0:20
                rayOffset = slit*((sample+0.5)/21-0.5);
                [pixel,weight] = nominalArrayRay(s,lines(k,1),rayOffset);
                if ~(pixel>=0 && pixel<768), continue; end
                use = abs(pixels-pixel)<=3;
                power = 1300*lines(k,2)*measurementGain(optical,mode)*weight;
                bins(use) = bins(use)+power*gauss(pixels(use),pixel,0.65)/(0.65*sqrt(2*pi));
            end
        end
    end
    calibration = setting(ref,'calibration',[]);
    if strcmp(mode,'reference')
        if isempty(detector)
            calibration = nominalArrayReference(s,bins);
        else
            calibration = arrayReference(hits,width);
        end
    end
    correction = setting(calibration,'correction',0);
    wavelength = nominalArrayWavelength(pixels-correction,setting(calibration,'settings',struct()));
    anchors = setting(calibration,'anchors',[]);
    if isempty(calibration)
        nominal = setting(geometry,'arrayCalibration',[]);
        fallback = arrayReference(setting(nominal,'hits',[]),setting(nominal,'width',1));
        anchors = setting(fallback,'anchors',[]);
    end
    if size(anchors,1)>=2
        wavelength = interp1(anchors(:,1),anchors(:,2),pixels,'linear','extrap');
    end
    [total,index] = max(bins);
    peak = NaN;
    peakPixel = NaN;
    if total>0
        peak = wavelength(index);
        peakPixel = pixels(index);
        if ~isempty(detector)
            neighborhood = max(1,index-2):min(768,index+2);
            subpixel = sum(pixels(neighborhood).*bins(neighborhood))/sum(bins(neighborhood));
            if size(anchors,1)>=2
                peak = interp1(anchors(:,1),anchors(:,2),subpixel,'linear','extrap');
            else
                peak = nominalArrayWavelength(subpixel-correction,setting(calibration,'settings',struct()));
            end
        end
    end
    result.charts = [ ...
        measurementChart('Raw CCD signal','Pixel','Counts',measurementSeries('CCD',pixels,bins+17)), ...
        measurementChart('Calibrated spectrum','Wavelength (nm)','Dark-corrected counts',measurementSeries('Spectrum',wavelength,bins))];
    result.metrics = struct('peakPixel',peakPixel,'peakWavelength_nm',peak, ...
        'calibrationLines',setting(calibration,'lines',size(anchors,1)));
    result.calibration = calibration;
end

function wavelength = nominalArrayWavelength(pixel,s)
    [positions,incoming,outgoing,beta] = arrayPositions(s);
    [grating,incidence] = nominalArrayInput(s,positions,incoming,0);
    if isempty(grating)
        wavelength = nominalArrayWavelength(pixel,struct());
        return
    end
    lensDistance = positions.focus-grating;
    detectorDistance = positions.detector-positions.focus;
    focal = 60*2.95*1.02;
    propagation = dot(detectorDistance,outgoing);
    factor = 1-propagation/focal;
    dispersion = propagation+factor*dot(lensDistance,outgoing);
    if dispersion<=1e-6
        wavelength = nominalArrayWavelength(pixel,struct());
        return
    end
    detectorAxis = perpendicular(outgoing);
    offset = dot(detectorDistance,detectorAxis)+factor*dot(lensDistance,detectorAxis);
    position = (pixel-383.5)*0.028*(2.95*1.02);
    rotation = deg2rad(setting(s,'rotation',0));
    wavelength = (sin(atan((position+offset)/dispersion)+beta+rotation)+sin(incidence))*1e6/setting(s,'density',600);
end

function lines = arraySource(s,mode)
    if strcmp(mode,'reference')
        lines = [405,0.65;436,0.83;546,1;578,0.62;630,0.5];
        return
    end
    source = setting(s,'source','triple');
    profile = setting(s,'sampleProfile',[]);
    custom = setting(profile,'sourceLines',[]);
    if ~strcmp(source,'white') && strcmp(source,setting(profile,'sourceType',source)) && isnumeric(custom) && size(custom,2)==2
        lines = custom(all(isfinite(custom) & custom>0,2),:);
        if ~isempty(lines), return; end
    end
    switch source
        case 'triple'
            lines = [450,0.69;520,1;630,0.76];
        case 'doublet'
            lines = [546,0.55;577,1;579,0.82];
        otherwise
            wavelength = (380:2:750)';
            lines = [wavelength,0.19*gauss(wavelength,582,111)+0.035];
    end
end

function [positions,incoming,outgoing,beta] = arrayPositions(s)
    incidence = deg2rad(15);
    beta = asin(550*600/1e6-sin(incidence));
    incoming = direction2D(-incidence);
    outgoing = direction2D(beta);
    grating = [423,145];
    distance = 60*2.95;
    positions = struct('fiber',grating-359*incoming,'slit',grating-241*incoming, ...
        'collimator',grating-124*incoming,'grating',grating, ...
        'focus',grating+distance*0.81*outgoing,'detector',grating+distance*1.83*outgoing);
    saved = setting(s,'positions',[]);
    for key = fieldnames(positions).'
        position = setting(saved,key{1},[]);
        if isstruct(position) && isfield(position,'x') && isfield(position,'y')
            positions.(key{1}) = [position.x,position.y];
        end
    end
end

function d = direction2D(angle)
    d = [cos(angle),sin(angle)];
end

function d = perpendicular(a)
    d = [-a(2),a(1)];
end

function p = hitPlane2D(origin,direction,center,normal)
    p = [];
    speed = dot(direction,normal);
    if speed<=1e-6, return; end
    distance = dot(center-origin,normal)/speed;
    if distance>=-1e-6, p = origin+distance*direction; end
end

function [grating,incidence,weight] = nominalArrayInput(s,p,incoming,offset)
    grating = [];
    incidence = NaN;
    weight = 0;
    slitAxis = perpendicular(incoming);
    slitPoint = p.slit+offset*117/(1000*60)*slitAxis;
    launch = slitPoint-p.fiber;
    axial = dot(launch,incoming);
    illumination = dot(p.slit-p.fiber,slitAxis);
    beamRadius = 12+max(0,axial)*0.025;
    if axial<=0 || abs(illumination)>beamRadius*3, return; end
    collimator = hitPlane2D(slitPoint,launch,p.collimator,incoming);
    if isempty(collimator), return; end
    height = dot(collimator-p.collimator,slitAxis);
    if abs(height)>30, return; end
    slope = dot(launch,slitAxis)/axial-height/117;
    angle = -deg2rad(15)+atan(slope)-2*deg2rad(setting(s,'alignment',0));
    rotation = deg2rad(setting(s,'rotation',0));
    normal = direction2D(-rotation);
    grating = hitPlane2D(collimator,direction2D(angle),p.grating,normal);
    if isempty(grating) || abs(dot(grating-p.grating,perpendicular(normal)))>27
        grating = [];
        return
    end
    incidence = rotation-angle;
    weight = gauss(illumination,0,beamRadius);
end

function [pixel,weight] = nominalArrayRay(s,wavelength,offset)
    [p,incoming,outgoing] = arrayPositions(s);
    [grating,incidence,weight] = nominalArrayInput(s,p,incoming,offset);
    pixel = NaN;
    weight = weight*setting(s,'slit',70)/(70*21);
    if isempty(grating), return; end
    rotation = deg2rad(setting(s,'rotation',0));
    diffraction = wavelength*setting(s,'density',600)/1e6-sin(incidence);
    if abs(diffraction)>=1, return; end
    diffracted = direction2D(asin(diffraction)-rotation);
    lens = hitPlane2D(grating,diffracted,p.focus,outgoing);
    if isempty(lens), return; end
    detectorAxis = perpendicular(outgoing);
    height = dot(lens-p.focus,detectorAxis);
    if abs(height)>57, return; end
    incidentSlope = dot(diffracted,detectorAxis)/dot(diffracted,outgoing);
    slope = incidentSlope-height/(60*2.95*1.02);
    detector = hitPlane2D(lens,outgoing+slope*detectorAxis,p.detector,outgoing);
    if ~isempty(detector)
        pixel = 383.5+dot(detector-p.detector,detectorAxis)/(0.028*2.95*1.02);
    end
end

function calibration = nominalArrayReference(s,bins)
    lines = arraySource(s,'reference');
    halfWidth = ceil(setting(s,'slit',70)/40)+4;
    corrections = [];
    for wavelength = lines(:,1).'
        expected = nominalArrayRay(s,wavelength,0);
        if ~(expected>=halfWidth && expected<768-halfWidth), continue; end
        range = jsRound(expected)+(-halfWidth:halfWidth);
        values = bins(range+1);
        if sum(values)>1
            corrections(end+1) = sum(range.*values)/sum(values)-expected; %#ok<AGROW>
        end
    end
    calibration = [];
    if numel(corrections)>=2
        calibration = struct('settings',s,'correction',mean(corrections),'lines',numel(corrections));
    end
end

function calibration = arrayReference(hits,width)
    calibration = [];
    if ~isstruct(hits) || width<=0, return; end
    wavelengths = [405,436,546,578,630];
    anchors = zeros(0,2);
    for wavelength = wavelengths
        selected = hits([hits.wavelength]==wavelength);
        weights = [selected.power];
        if sum(weights)<=1e-8, continue; end
        pixel = (0.5+sum([selected.u].*weights)/sum(weights)/width)*767;
        anchors(end+1,:) = [pixel,wavelength]; %#ok<AGROW>
    end
    anchors = sortrows(anchors,1);
    if size(anchors,1)<2 || any(diff(anchors(:,1))<0.5), return; end
    if ~all(diff(anchors(:,2))>0) && ~all(diff(anchors(:,2))<0), return; end
    calibration = struct('anchors',anchors,'lines',size(anchors,1));
end

function a = dyeAbsorbance(wavelength,s)
    bands = specimenBands(s,'absorptionBands',[405 22 0.78; 334 17 0.24]);
    profile = specimenBandProfile(wavelength,bands,0);
    a = setting(s,'concentration',1)*setting(s,'pathLength',1)*profile;
end

function bands = specimenBands(s,name,fallback)
    bands = fallback;
    profile = setting(s,'sampleProfile',[]);
    if ~isstruct(profile) || ~isfield(profile,name), return; end
    requested = profile.(name);
    if isnumeric(requested) && isempty(requested)
        bands = zeros(0,3);
    elseif isnumeric(requested) && size(requested,2)==3
        valid = all(isfinite(requested),2) & requested(:,1)>0 & requested(:,2)>0 & requested(:,3)>=0;
        bands = requested(valid,:);
    end
end

function response = specimenBandProfile(wavelength,bands,broadening)
    response = zeros(size(wavelength));
    for k = 1:size(bands,1)
        width = bands(k,2);
        broadened = hypot(width,broadening);
        response = response + bands(k,3)*(width/broadened)*gauss(wavelength,bands(k,1),broadened);
    end
end

function lamp = uvLamp(wavelength,fwhm,optical)
    lamp = 2900*fwhm*measurementGain(optical,'sample') ...
        .*(0.48+0.45*gauss(wavelength,510,143)).*spectralGain(optical,wavelength,'detector');
end

function area = integrateBand(wavelength,fwhm,evaluate)
    area = zeros(size(wavelength));
    sigma = fwhm/(2*sqrt(2*log(2)));
    offsets = -2:2;
    weights = exp(-0.5*offsets.^2);
    for k = 1:numel(offsets)
        area = area + weights(k)*evaluate(wavelength+sigma*offsets(k));
    end
    area = area/sum(weights);
end

function response = uvResponse(wavelength,s,sphere)
    if sphere
        response = 0.51+0.13*tanh((wavelength-500)/55)-0.22*gauss(wavelength,410,32);
        response = response+0.095*setting(s,'specular',true);
    else
        response = 10.^(-dyeAbsorbance(wavelength,s));
    end
end

function result = measureUvVis(s,mode,optical,ref,dark)
    wavelength = 300:760;
    sampling = setting(s,'mode','transmission');
    sphere = strcmp(sampling,'sphere');
    fwhm = setting(s,'bandwidth',2);
    collection = 1;
    blank = ones(size(wavelength));
    standard = 0.97;
    if sphere
        collection = 0.014/(1-(1-0.055)*setting(s,'wall',97)/100);
        blank(:) = standard;
    elseif strcmp(setting(s,'blank','matched'),'mismatch')
        blank = 0.83+0.14*(1-gauss(wavelength,350,45));
    end
    stray = setting(s,'stray',0)/100;
    reference = 31+collection*integrateBand(wavelength,fwhm,@(w) uvLamp(w,fwhm,optical)).*(blank+stray);
    baseline = reference;
    savedReference = setting(ref,'referenceData',[]);
    if ~strcmp(mode,'reference') && strcmp(setting(savedReference,'kind',''),sampling)
        baseline = savedReference.counts;
    end
    sourceName = 'Sample';
    if strcmp(mode,'dark')
        raw = repmat(31,size(wavelength));
        sourceName = 'Dark';
    elseif strcmp(mode,'reference')
        raw = reference;
    else
        raw = 31+collection*integrateBand(wavelength,fwhm,@(w) uvLamp(w,fwhm,optical).*(uvResponse(w,s,sphere)+stray));
    end
    darkCounts = setting(dark,'darkData',31);
    ratio = positiveRatio(raw-darkCounts,baseline-darkCounts);
    absorbance = toAbsorbance(ratio);
    if sphere
        result.charts = measurementChart('Integrating sphere reflectance','Wavelength (nm)','Reflectance (%)', ...
            measurementSeries('Reflectance',wavelength,100*standard*ratio));
        result.metrics = struct('reflectance550_pct',100*standard*ratio(wavelength==550));
    else
        result.charts = measurementChart('Absorbance spectrum','Wavelength (nm)','Absorbance (AU)', ...
            measurementSeries('Absorbance',wavelength,absorbance));
        [value,index] = max(absorbance);
        peak = NaN;
        if strcmp(mode,'sample') && value>1e-5, peak = wavelength(index); end
        result.metrics = struct('peak_nm',peak,'absorbance_AU',value,'transmittance_pct',ratio(index)*100);
    end
    result.charts = [measurementChart('Raw detector signal','Wavelength (nm)','Counts', ...
        measurementSeries(sourceName,wavelength,raw),measurementSeries('Reference',wavelength,baseline)),result.charts];
    if strcmp(mode,'reference'), result.referenceData = struct('kind',sampling,'counts',raw); end
    if strcmp(mode,'dark')
        result.darkData = raw;
        result.metrics = struct('detectorDarkCounts',31);
    end
end

function result = measurePL(s,mode,seed,optical,ref)
    wavelength = 350:2:760;
    excitation = setting(s,'excitation',405);
    fwhm = setting(s,'bandwidth',3);
    duration = setting(s,'exposure',200)/1000;
    absorption = 1-10.^(-dyeAbsorbance(excitation,s));
    sample = strcmp(mode,'sample');
    filter = setting(s,'filter',true);
    broadening = fwhm/(2*sqrt(2*log(2)));
    emissionBands = specimenBands(s,'emissionBands',[520 25 1]);
    leak = 1;
    bandpass = ones(size(wavelength));
    if filter
        leak = 0.004;
        bandpass(abs(wavelength-excitation)<8) = 0.12;
    end
    geometry = setting(optical,'geometry',[]);
    excitationGain = setting(geometry,'excitationCoupling',1);
    detectorGain = fwhm/3*excitationGain*measurementGain(optical,mode).*spectralGain(optical,wavelength,'detector');
    emission = sample*2100*absorption*specimenBandProfile(wavelength,emissionBands,broadening).*bandpass.*detectorGain;
    scatter = ~strcmp(mode,'dark')*2700*leak*gauss(wavelength,excitation,max(1.4,broadening));
    signal = emission + detectorGain.*scatter;
    sensitivity = 0.43+0.57*gauss(wavelength,550,124);
    darkRate = 18;
    raw = photonCounts((signal.*sensitivity+darkRate)*duration,seed);
    blank = setting(ref,'referenceData',[]);
    baseline = darkRate;
    if sample && strcmp(setting(blank,'kind',''),'pl') && blank.excitation==excitation && blank.filter==filter && blank.fwhm==fwhm
        baseline = blank.rate;
    end
    corrected = (raw/duration-baseline)./sensitivity;
    activeBand = false(size(wavelength));
    for k = 1:size(emissionBands,1)
        activeBand = activeBand | (emissionBands(k,3)>0 & abs(wavelength-emissionBands(k,1))<=1.2*emissionBands(k,2));
    end
    band = max(0,corrected).*activeBand;
    center = NaN;
    if any(emission(activeBand)>1e-9) && sum(band)>0, center = sum(band.*wavelength)/sum(band); end
    result.charts = [ ...
        measurementChart('Raw PMT signal','Emission wavelength (nm)','Counts',measurementSeries('Detector signal',wavelength,raw)), ...
        measurementChart('Emission spectrum','Emission wavelength (nm)','Corrected count rate (s⁻¹)',measurementSeries('Emission and scatter',wavelength,corrected))];
    result.metrics = struct('emissionCentroid_nm',center,'excitationAbsorbed_pct',100*absorption,'totalCounts',sum(raw));
    if strcmp(mode,'reference')
        result.referenceData = struct('kind','pl','excitation',excitation,'filter',filter,'fwhm',fwhm,'rate',raw/duration);
    end
end

function normalized = normalizeHistogram(counts)
    normalized = counts;
    if sum(counts)>0, normalized = counts/sum(counts); end
end

function decay = periodicDecayMatlab(response, bin, lifetime)
    remaining = exp(-bin/lifetime);
    newPhoton = -expm1(-bin/lifetime);
    last = filter(newPhoton,[1,-remaining],response);
    initialState = remaining*last(end)/(-expm1(-numel(response)*bin/lifetime));
    decay = filter(newPhoton,[1,-remaining],response,initialState);
end

function [lifetime,fitted] = fitDecayMatlab(observed,response,bin,background)
    amplitude = max(0,sum(observed)-numel(observed)*background);
    if amplitude<10
        lifetime = NaN;
        fitted = zeros(size(observed))+background;
        return
    end
    errorFor = @(t) photonError(amplitude*periodicDecayMatlab(response,bin,t)+background,observed);
    golden = (sqrt(5)-1)/2;
    lower = 0.12;
    upper = numel(observed)*bin*2;
    a = upper-golden*(upper-lower);
    b = lower+golden*(upper-lower);
    errorA = errorFor(a);
    errorB = errorFor(b);
    for k = 1:27
        if errorA<errorB
            upper = b;
            b = a;
            errorB = errorA;
            a = upper-golden*(upper-lower);
            errorA = errorFor(a);
        else
            lower = a;
            a = b;
            errorA = errorB;
            b = lower+golden*(upper-lower);
            errorB = errorFor(b);
        end
    end
    lifetime = (lower+upper)/2;
    fitted = amplitude*periodicDecayMatlab(response,bin,lifetime)+background;
end

function loss = photonError(expected,observed)
    expected = max(1e-8,expected);
    loss = sum(expected-observed.*log(expected));
end

function result = measureTRPL(s,mode,seed,optical,ref)
    repetition = setting(s,'repetition',20);
    period = 1000/repetition;
    binCount = jsRound(period/0.1);
    bin = period/binCount;
    time = (0:binCount-1)*bin;
    geometry = setting(optical,'geometry',[]);
    irfWidth = setting(s,'irf',0.3)/(2*sqrt(2*log(2)));
    delayOffset = setting(geometry,'trplDelayOffset',0);
    if delayOffset == 0
        response = normalizeHistogram(gauss(time,1.2,irfWidth));
    else
        separation = abs(time-mod(1.2+delayOffset,period));
        response = normalizeHistogram(gauss(min(separation,period-separation),0,irfWidth));
    end
    decay = periodicDecayMatlab(response,bin,setting(s,'lifetime',4));
    excitation = setting(s,'excitation',405);
    detection = setting(s,'detection',520);
    absorption = (1-10.^(-dyeAbsorbance(excitation,s)))/(1-10.^(-dyeAbsorbance(405,struct())));
    attenuation = 10^(-setting(s,'attenuation',0));
    excitationGain = setting(geometry,'excitationCoupling',1);
    gain = measurementGain(optical,mode)*spectralGain(optical,detection,'detector');
    emissionBands = specimenBands(s,'emissionBands',[520 25 1]);
    rate = setting(s,'flux',1)/100*attenuation*gain*excitationGain*absorption*specimenBandProfile(detection,emissionBands,0);
    pulses = jsRound(repetition*setting(s,'exposure',100)*1000);
    backgroundRate = 0.00008/binCount;
    background = backgroundRate*pulses;
    if strcmp(mode,'reference')
        incident = 0.008*response*gain*excitationGain+backgroundRate;
    else
        incident = rate*decay+backgroundRate;
    end
    expectation = pulses*exp(-[0,cumsum(incident(1:end-1))]).*(-expm1(-incident));
    if strcmp(mode,'dark'), expectation = zeros(size(time))+background; end
    counts = photonCounts(expectation,seed);
    measured = setting(ref,'referenceData',[]);
    if strcmp(setting(measured,'kind',''),'trpl') && measured.repetition==repetition
        response = measured.response;
    end
    lifetime = NaN;
    fitted = NaN(size(counts));
    if strcmp(mode,'sample')
        [lifetime,fitted] = fitDecayMatlab(counts,response,bin,background);
    end
    residuals = (counts-fitted)./sqrt(max(1,fitted));
    scale = max(counts)/max(response);
    result.charts = [ ...
        measurementChart('TCSPC arrival-time histogram','Delay (ns)','Counts',measurementSeries('Photon counts',time,counts), ...
            measurementSeries('IRF (scaled for display)',time,scale*response),measurementSeries('Reconvolution fit',time,fitted)), ...
        measurementChart('Fit residuals','Delay (ns)','Standardized residual',measurementSeries('Residual',time,residuals))];
    result.metrics = struct('fittedLifetime_ns',lifetime,'detectionProbability_pct',100*sum(counts)/pulses,'totalPhotons',sum(counts));
    if strcmp(mode,'reference')
        stored = normalizeHistogram(max(0,counts-background));
        if sum(stored)>0
            result.referenceData = struct('kind','trpl','repetition',repetition,'response',stored);
        end
    end
end

function result = measureRaman(s,mode,optical)
    laser = str2double(string(setting(s,'laser',532)));
    filter = setting(s,'filter',true);
    material = setting(s,'sample','silicon');
    if strcmp(mode,'reference'), material = 'silicon'; end
    switch material
        case 'polymer'
            lines = [621,0.32,7;1001,1,4.2;1031,0.48,6;1602,0.58,7;3054,0.72,14];
        case 'carbon'
            lines = [1350,0.78,46;1580,1,26;2690,0.43,54];
        otherwise
            lines = [520.7,1,4.5;300,0.09,11;960,0.08,31];
    end
    focus = (1+(setting(s,'focus',0)/3.1)^2)^-2;
    firstWavelength = 1/(1/laser+70/1e7);
    lastWavelength = 1/(1/laser-3350/1e7);
    alpha = asin(firstWavelength*600/1e6);
    beta = asin(lastWavelength*600/1e6);
    center = (alpha+beta)/2;
    theta = atan(linspace(tan(alpha-center),tan(beta-center),768))+center;
    wavelength = sin(theta)*1e6/600;
    shift = 1e7*(1/laser-1./wavelength);
    raman = sum(lines(:,2).*gauss(shift,lines(:,1),lines(:,3)),1);
    rayleigh = 8*gauss(shift,0,7);
    edge = ones(size(shift));
    if filter
        rayleigh = 0.006*gauss(shift,0,7);
        edge = 1./(1+exp((96-shift)/13));
    end
    geometry = setting(optical,'geometry',[]);
    excitationGain = setting(geometry,'excitationCoupling',1);
    collection = measurementGain(optical,mode)*spectralGain(optical,wavelength,'detector');
    gain = excitationGain*collection;
    corrected = 1250*(532/laser)^4*focus*gain.*(raman.*edge+rayleigh);
    [~,strongest] = max(lines(:,2));
    strongestShift = lines(strongest,1);
    result.charts = [ ...
        measurementChart('Raw CCD signal','Detected wavelength (nm)','Counts',measurementSeries('CCD',wavelength,corrected+17)), ...
        measurementChart('Raman spectrum','Raman shift (cm⁻¹)','Dark-corrected counts',measurementSeries('Raman',shift,corrected))];
    scattered = 1/(1/laser-strongestShift/1e7);
    collectionAtBand = focus;
    if ~isempty(setting(optical,'spectralSamples',[]))
        collectionAtBand = focus*setting(optical,'coupling',1)*spectralGain(optical,scattered,'detector');
    end
    result.metrics = struct('principalBand_cm1',strongestShift,'scatteredWavelength_nm',scattered, ...
        'relativeCollectionEfficiency_pct',100*collectionAtBand);
end

function depth = atrPenetration(wavenumber)
    depth = 10000./wavenumber/(2*pi*2.4*sqrt(sind(45)^2-(1.5/2.4)^2));
end

function scan = irScanMatlab(s,mode,coupling,maxOpd,offset)
    count = 4096;
    step = 4;
    opdStep = 1/(count*step);
    bins = 1:count/2-1;
    wavenumber = bins*step;
    spectrum = complex(zeros(1,count));
    atr = strcmp(setting(s,'mode','transmission'),'atr');
    switch setting(s,'material','polystyrene')
        case 'pet'
            bands = [725,16,0.58;872,15,0.35;1016,18,0.46;1095,27,0.62;1242,27,0.68;1410,18,0.33;1716,26,0.94;2960,37,0.20];
        otherwise
            bands = [698,12,0.78;756,13,0.59;1028,16,0.23;1452,15,0.36;1493,15,0.55;1601,13,0.69;2924,31,0.34;3026,28,0.55];
    end
    source = (1-exp(-(wavenumber/420).^4)).*exp(-(wavenumber/4700).^6).*(0.26+0.74*gauss(wavenumber,2150,1150));
    depth = 1;
    if atr
        source = source*0.82;
        depth = atrPenetration(wavenumber)/atrPenetration(1500)*setting(s,'contact',90)/100;
    end
    transmission = 1;
    if strcmp(mode,'sample')
        absorbance = sum(bands(:,3).*gauss(wavenumber,bands(:,1),bands(:,2)),1).*depth;
        transmission = 10.^(-absorbance);
    end
    spectrum(bins+1) = coupling*source.*transmission.*exp(2i*pi*wavenumber*offset/10000);
    spectrum(count-bins+1) = conj(spectrum(bins+1));
    interferogram = real(ifft(spectrum));
    halfScan = floor(maxOpd/opdStep);
    lags = -halfScan:halfScan;
    scan.opd = lags*opdStep*10000;
    scan.interferogram = interferogram(mod(lags,count)+1);
    lag = min(0:count-1,count-(0:count-1))*opdStep;
    apodization = (0.5+0.5*cos(pi*lag/maxOpd)).*(lag<maxOpd);
    scan.spectrum = abs(fft(interferogram.*apodization));
end

function result = measureFTIR(s,mode,optical,reference)
    travel = setting(s,'mirrorTravel',320);
    maxOpd = 2*travel/10000;
    atr = strcmp(setting(s,'mode','transmission'),'atr');
    geometry = setting(optical,'geometry',[]);
    offset = setting(geometry,'ftirOpdOffset',0);
    refSettings = s;
    refGain = setting(optical,'coupling',1);
    refOffset = offset;
    if ~isempty(reference)
        refSettings = mergeSettings(s,reference.settings);
        refGain = setting(reference,'coupling',1);
        refOffset = setting(setting(reference,'geometry',[]),'ftirOpdOffset',0);
    end
    background = irScanMatlab(refSettings,'reference',refGain,maxOpd,refOffset);
    measured = irScanMatlab(s,mode,measurementGain(optical,mode),maxOpd,offset);
    result.charts = measurementChart('Michelson interferogram','Optical path difference (µm)','AC detector signal (a.u.)', ...
        measurementSeries('Background',background.opd,background.interferogram), ...
        measurementSeries(mode,measured.opd,measured.interferogram));
    result.metrics = struct('maxOPD_um',2*travel,'nominalResolution_cm1',1/(2*maxOpd),'opdOffset_um',offset);
    if atr, result.metrics.penetrationDepth1500_um = atrPenetration(1500); end
    if strcmp(mode,'dark'), return; end
    wavenumber = 500:4:4000;
    index = wavenumber/4+1;
    denominator = background.spectrum(index);
    ratio = NaN(size(index));
    usable = denominator > 1e-8;
    ratio(usable) = max(1e-8,measured.spectrum(index(usable))./denominator(usable));
    if atr
        name = 'ATR absorbance';
        label = 'Absorbance (a.u.)';
        values = -log10(ratio);
    else
        name = 'Transmittance';
        label = 'Transmittance (%)';
        values = 100*ratio;
    end
    result.charts(2) = measurementChart('Background-corrected spectrum','Wavenumber (cm⁻¹)',label, ...
        measurementSeries(name,wavenumber,values));
end

function [rp,rs] = filmReflection(wavelength,incidence,thickness)
    n0 = ones(size(wavelength));
    n1 = 1.449+3400./wavelength.^2;
    n2 = 3.55+0.58*(480./wavelength).^2+1i*(0.015+0.19*exp(-(wavelength-400)/85));
    direction = sind(incidence).^2;
    q0 = sqrt(n0.^2-direction);
    q1 = sqrt(n1.^2-direction);
    q2 = sqrt(n2.^2-direction);
    roundTrip = exp(4i*pi*thickness*q1./wavelength);
    rs = layerAmplitude(q0,q1,q2,roundTrip);
    rp = layerAmplitude(q0./n0.^2,q1./n1.^2,q2./n2.^2,roundTrip);
end

function amplitude = layerAmplitude(a,b,c,roundTrip)
    front = (a-b)./(a+b);
    back = (b-c)./(b+c).*roundTrip;
    amplitude = (front+back)./(1+front.*back);
end

function [rho,intensity] = ellipsometryPoint(wavelength,incidence,thickness,analyzer)
    [rp,rs] = filmReflection(wavelength,incidence,thickness);
    rho = rp./rs;
    intensity = abs(rp).^2/2*cosd(analyzer)^2 + abs(rs).^2/2*sind(analyzer)^2 ...
        + real(rp.*conj(rs))/2*sind(2*analyzer);
end

function thickness = filmThicknessFit(incidence,sample)
    [wavelength,angle] = meshgrid([430,475,525,580,645,715,790],incidence+[-5,0,5]);
    observed = ellipsometryPoint(wavelength,angle,sample,0);
    errorFor = @(t) sum(abs(observed-ellipsometryPoint(wavelength,angle,t,0)).^2,'all');
    candidates = 0:3:360;
    [~,k] = min(arrayfun(errorFor,candidates));
    coarse = candidates(k);
    candidates = max(0,coarse-3):0.25:coarse+3;
    [~,k] = min(arrayfun(errorFor,candidates));
    thickness = candidates(k);
end

function result = measureEllipsometry(s,mode,optical,reference)
    wavelength = 400:4:800;
    geometry = setting(optical,'geometry',[]);
    incidence = min(84.9,max(5,setting(geometry,'incidenceAngle',setting(s,'incidenceAngle',65))));
    angles = incidence+[-5,0,5];
    analyzer = setting(s,'analyzerAngle',45);
    thickness = setting(s,'thickness',120);
    if strcmp(mode,'reference'), thickness = 0; end
    gain = measurementGain(optical,mode);
    spectral = spectralGain(optical,wavelength,'detector');
    [~,intensity] = ellipsometryPoint(wavelength,incidence,thickness,analyzer);
    intensity = gain*spectral.*intensity;
    series = measurementSeries('Analyzer signal',wavelength,intensity);
    if ~isempty(reference)
        refGeometry = setting(reference,'geometry',[]);
        refAngle = setting(refGeometry,'incidenceAngle',setting(reference.settings,'incidenceAngle',incidence));
        refAnalyzer = setting(reference.settings,'analyzerAngle',analyzer);
        [~,refIntensity] = ellipsometryPoint(wavelength,refAngle,0,refAnalyzer);
        refIntensity = reference.coupling*spectralGain(reference,wavelength,'detector').*refIntensity;
        series(2) = measurementSeries('Bare silicon reference',wavelength,refIntensity);
    end
    result.charts = measurementChart('Polarization analyzer signal','Wavelength (nm)','Relative intensity',series);
    result.metrics = struct('fittedThickness_nm',NaN,'incidenceAngles_deg',angles);
    if max(gain*spectral) <= 0.001, return; end
    for k = 1:numel(angles)
        rho = ellipsometryPoint(wavelength,angles(k),thickness,analyzer);
        rho(gain*spectral<=0.001) = NaN;
        name = sprintf('%.6g° incidence',angles(k));
        psi(k) = measurementSeries(name,wavelength,atand(abs(rho))); %#ok<AGROW>
        delta(k) = measurementSeries(name,wavelength,mod(rad2deg(angle(rho)),360)); %#ok<AGROW>
    end
    result.charts(2) = measurementChart('Ellipsometric amplitude angle Ψ','Wavelength (nm)','Ψ (°)',psi);
    result.charts(3) = measurementChart('Ellipsometric phase difference Δ','Wavelength (nm)','Δ (°)',delta);
    result.metrics.fittedThickness_nm = filmThicknessFit(incidence,thickness);
end

function a = transientAbsorbance(wavelength,time,excitation,bands)
    gate = 0.5*(1+tanh(time/0.135));
    elapsed = max(0,time);
    if ~isempty(bands)
        a = zeros(size(time,1),numel(wavelength));
        for k = 1:size(bands,1)
            a = a + bands(k,3)*exp(-elapsed/bands(k,4)).*gauss(wavelength,bands(k,1),bands(k,2));
        end
        a = excitation*gate.*a;
        return
    end
    bleach = -0.021*exp(-elapsed/4.2).*gauss(wavelength,521,20);
    excited = 0.029*exp(-elapsed/7.3).*gauss(wavelength,646,37);
    carrier = 0.010*exp(-elapsed/0.55).*gauss(wavelength,460,20);
    a = excitation*gate.*(bleach+excited+carrier);
end

function result = measureTA(s,mode,optical)
    wavelength = 430:3:760;
    delays = (-1:0.2:14.2)';
    delay = setting(s,'delay',0.8);
    geometry = setting(optical,'geometry',[]);
    shifted = setting(geometry,'taDelayOffset',0);
    offset = setting(s,'offset',0)+setting(geometry,'taOffset',0);
    overlap = gauss(offset,0,hypot(42,32));
    pumpGain = setting(geometry,'pumpCoupling',1);
    illuminated = strcmp(mode,'sample') && setting(s,'pump',true);
    excitation = illuminated*pumpGain*overlap*(1-exp(-setting(s,'fluence',30)/23));
    probeGain = measurementGain(optical,mode)*spectralGain(optical,wavelength,'detector');
    off = probeGain.*(0.20+0.80*gauss(wavelength,565,102)).*(1-0.13*gauss(wavelength,522,31));
    bands = setting(setting(s,'sampleProfile',[]),'transientBands',[]);
    on = off.*10.^(-transientAbsorbance(wavelength,delay-shifted,excitation,bands));
    difference = 1000*toAbsorbance(positiveRatio(on,off.*(off>1e-10)));
    image = 1000*transientAbsorbance(wavelength,delays-shifted,excitation,bands).*(off>1e-10);
    result.charts = [ ...
        measurementChart('Transmitted probe signal','Wavelength (nm)','Relative intensity', ...
            measurementSeries('Pump off',wavelength,off),measurementSeries('Pump on',wavelength,on)), ...
        measurementChart(sprintf('Transient absorption at %.1f ps',delay),'Wavelength (nm)','ΔA (mOD)', ...
            measurementSeries('ΔA',wavelength,difference)), ...
        measurementChart('Transient absorption map','Wavelength (nm)','Pump–probe delay (ps)')];
    result.charts(3).heatmap = struct('x',wavelength,'y',delays,'z',image);
    result.metrics = struct('overlap_pct',100*overlap,'stageDisplacement_um',delay*0.299792458*500, ...
        'pumpThroughput_pct',100*pumpGain,'timeZeroShift_ps',shifted);
end

function transfer = slabFieldTransfer(frequency,index,absorption,thickness,echoes)
    phase = 2*pi*frequency*thickness/0.299792458;
    absorptionLength = absorption*thickness/10;
    transfer = 4*index/(1+index)^2*exp(-absorptionLength/2).*exp(-1i*phase*(index-1));
    if echoes
        roundTrip = ((index-1)/(index+1))^2*exp(-absorptionLength).*exp(-2i*phase*index);
        transfer = transfer./(1-roundTrip);
    end
end

function transfer = waterVaporTransfer(frequency,humidity)
    lines = [0.557,0.017,0.68;0.752,0.019,0.41;0.988,0.021,0.54;1.113,0.026,0.48;1.669,0.023,0.34];
    poles = lines(:,2).*lines(:,3);
    lower = poles./(lines(:,2)+1i*(frequency-lines(:,1)));
    upper = poles./(lines(:,2)+1i*(frequency+lines(:,1)));
    transfer = exp(-humidity/100*sum(lower+upper,1));
end

function wave = terahertzWave(s,mode,gain,gateDelay)
    count = 4096;
    dt = 0.05;
    time = (0:count-1)*dt;
    source = 4.8*(gauss(time,6,0.31)-gauss(time,6,0.23))+0.74*(time-6)/0.16.*gauss(time,6,0.16);
    incident = fft(source)*gain;
    frequency = (0:count/2)/(count*dt);
    atmosphere = waterVaporTransfer(frequency,setting(s,'humidity',0));
    sample = 1;
    if strcmp(mode,'sample')
        sample = slabFieldTransfer(frequency,setting(s,'index',1.5),setting(s,'absorption',0), ...
            setting(s,'thickness',1),setting(s,'echoes',true));
    end
    positive = incident(1:count/2+1).*atmosphere.*sample.*exp(2i*pi*frequency*gateDelay);
    positive([1,end]) = real(positive([1,end]));
    wave = real(ifft([positive,conj(positive(end-1:-1:2))]));
end

function delay = pulseArrivalTime(wave,window)
    dt = 0.05;
    last = min(ceil(window/dt),numel(wave)-1);
    [~,k] = max(wave(2:last));
    k = k+1;
    left = wave(k-1);
    center = wave(k);
    right = wave(k+1);
    offset = (left-right)/(2*(left-2*center+right));
    if ~isfinite(offset) || abs(offset)>=1, offset = 0; end
    delay = dt*(k-1+offset);
end

function [index,absorption] = fitTerahertzSlab(frequency,measured,phase,thickness,echoes)
    index = 1-phase*0.299792458/(2*pi*frequency*thickness);
    absorption = NaN;
    if ~isfinite(index) || index<0.5 || index>3.6 || abs(measured)<1e-7
        index = NaN;
        return
    end
    interface = 4*index/(1+index)^2;
    absorption = -20/thickness*log(abs(measured)/interface);
    for k = 1:10
        model = slabFieldTransfer(frequency,index,absorption,thickness,echoes);
        difference = measured-model;
        if abs(difference)<1e-8, break; end
        dn = (slabFieldTransfer(frequency,index+1e-5,absorption,thickness,echoes)-model)/1e-5;
        da = (slabFieldTransfer(frequency,index,absorption+1e-3,thickness,echoes)-model)/1e-3;
        determinant = real(dn)*imag(da)-imag(dn)*real(da);
        if ~isfinite(determinant) || abs(determinant)<1e-12, break; end
        index = index+(real(difference)*imag(da)-imag(difference)*real(da))/determinant;
        absorption = absorption+(real(dn)*imag(difference)-imag(dn)*real(difference))/determinant;
        if ~isfinite(index) || ~isfinite(absorption) || index<0.5 || index>3.6 || absorption< -120 || absorption>1000
            break;
        end
    end
    if abs(slabFieldTransfer(frequency,index,absorption,thickness,echoes)-measured)>=1e-3 ...
            || ~isfinite(index) || ~isfinite(absorption) || index<0.5 || index>3.6 || absorption< -120 || absorption>1000
        index = NaN;
        absorption = NaN;
    end
end

function result = measureTHz(s,mode,optical,reference)
    count = 4096;
    dt = 0.05;
    time = (0:count-1)*dt;
    window = setting(s,'window',100);
    thickness = setting(s,'thickness',1);
    echoes = setting(s,'echoes',true);
    refSettings = s;
    refSettings.humidity = 0;
    geometry = setting(optical,'geometry',[]);
    delay = 2*setting(geometry,'thzStageOffset',0)/(0.299792458*1000);
    refGain = setting(optical,'coupling',1);
    refDelay = delay;
    if ~isempty(reference)
        refSettings = mergeSettings(refSettings,reference.settings);
        refGain = setting(reference,'coupling',1);
        refDelay = 2*setting(setting(reference,'geometry',[]),'thzStageOffset',0)/(0.299792458*1000);
    end
    refWave = terahertzWave(refSettings,'reference',refGain,refDelay);
    wave = terahertzWave(s,mode,measurementGain(optical,mode),delay);
    effectiveWindow = min(window,setting(setting(reference,'settings',[]),'window',window));
    arrival = pulseArrivalTime(wave,effectiveWindow)-pulseArrivalTime(refWave,effectiveWindow);
    stageDelay = 2*setting(s,'stage',1170)/(0.299792458*1000);
    recorded = 1:min(count,floor(window/dt)+1);
    sampled = wave(jsRound(stageDelay/dt)+1);
    result.charts = measurementChart('Time-domain electric field','Delay (ps)','E(t) (a.u.)', ...
        measurementSeries('Air reference',time(recorded),refWave(recorded)), ...
        measurementSeries(mode,time(recorded),wave(recorded)), ...
        measurementSeries('Current delay position',[stageDelay,stageDelay],[-0.75,1.4]));
    result.metrics = struct('currentDelay_ps',stageDelay,'sampledField',sampled, ...
        'nominalResolution_THz',1/effectiveWindow,'gateDelayOffset_ps',delay);
    if strcmp(mode,'dark'), return; end
    taper = 0.5-0.5*cos(pi*min(1,max(0,(effectiveWindow-time)/4)));
    fftRef = fft(refWave.*taper);
    fftObs = fft(wave.*taper);
    maxRef = max(abs(fftRef));
    binStep = 1/(count*dt);
    bins = ceil(0.15/binStep):floor(3.5/binStep);
    frequency = bins*binStep;
    fftRef = fftRef(bins+1);
    fftObs = fftObs(bins+1);
    valid = maxRef>1e-9 & abs(fftRef)>maxRef*0.018 & abs(fftObs)>maxRef*0.004;
    ratio = complex(NaN(size(frequency)));
    ratio(valid) = fftObs(valid)./fftRef(valid);
    phase = angle(ratio);
    phase = phase+2*pi*jsRound((-2*pi*frequency*arrival-phase)/(2*pi));
    result.charts(2) = measurementChart('Sample-to-reference field amplitude','Frequency (THz)','|E/E₀|', ...
        measurementSeries('Field amplitude ratio',frequency,abs(ratio)));
    result.charts(3) = measurementChart('Sample-to-reference phase difference','Frequency (THz)','Phase (rad)', ...
        measurementSeries('Unwrapped phase',frequency,phase));
    if ~strcmp(mode,'sample'), return; end
    index = NaN(size(frequency));
    absorption = NaN(size(frequency));
    for k = find(valid)
        [index(k),absorption(k)] = fitTerahertzSlab(frequency(k),ratio(k),phase(k),thickness,echoes);
    end
    result.charts(4) = measurementChart('Retrieved refractive index','Frequency (THz)','n', ...
        measurementSeries('Refractive index',frequency,index));
    result.charts(5) = measurementChart('Retrieved absorption coefficient','Frequency (THz)','α (cm⁻¹)', ...
        measurementSeries('Absorption coefficient',frequency,absorption));
    central = frequency>0.40 & frequency<1.40;
    result.metrics.primaryPulseDelay_ps = arrival;
    result.metrics.meanRefractiveIndex = mean(index(central),'omitnan');
    result.metrics.meanAbsorption_cm1 = mean(absorption(central),'omitnan');
    if echoes, result.metrics.firstEchoSpacing_ps = 2*setting(s,'index',1.5)*thickness/0.299792458; end
end
`;
