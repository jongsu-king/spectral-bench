export function matlabJson(value) {
  const chars = Array.from(JSON.stringify(value));
  const lines = [];
  for (let offset = 0; offset < chars.length; offset += 100) {
    const text = chars.slice(offset, offset + 100).join('').replaceAll("'", "''");
    lines.push("    '" + text + "' ...");
  }
  return 'jsondecode([ ...\n' + lines.join('\n') + '\n]);';
}

export function generateMatlabWorkbench(scene, { sweepDetectorId = '', sweepOffsets = [] } = {}) {
  const layout = {
    name: scene?.name ?? 'Optical Workbench',
    parts: scene?.parts ?? [],
    maxInteractions: scene?.maxInteractions ?? 20,
    maxDistance: scene?.maxDistance ?? 2200,
    escapeLength: scene?.escapeLength ?? 260,
  };
  const sweep = { detectorId: sweepDetectorId, offsets_mm: sweepOffsets.filter(Number.isFinite).slice(0, 200) };
  return [
    '% Spectral Bench | 3D Optical Workbench',
    '% Run this file in base MATLAB. All lengths are mm, angles are degrees,',
    '% wavelengths are nm, and optical power is mW. Euler rotations act on X,',
    '% Y and Z in that order. Change scene.parts to adjust the optical layout.',
    '% A saved Bench layout uses geometric, incoherent ray power.',
    '',
    'scene = ' + matlabJson(layout),
    'sweep = ' + matlabJson(sweep),
    '',
    'rayTrace = traceOptics(scene);',
    '[detectorSummary, pathSegments] = summarizeTrace(rayTrace);',
    'disp(detectorSummary);',
    "disp('First ray segments (the full table is in pathSegments):');",
    'disp(pathSegments(1:min(18,height(pathSegments)),:));',
    'drawOptics(scene, rayTrace);',
    'sweepResult = sweepDetector(scene, sweep);',
    '',
    matlabRaySolver,
  ].join('\n');
}

export const matlabRaySolver = `
function result = traceOptics(scene)
    parts = normalizeParts(scene.parts);
    sources = parts(cellfun(@(p) p.enabled && strcmp(p.type,'source'),parts));
    surfaces = parts(cellfun(@(p) p.enabled && ~strcmp(p.type,'source'),parts));
    detectorParts = parts(cellfun(@(p) strcmp(p.type,'detector'),parts));
    queue = launchRays(sources);
    wavelengths = unique(cellfun(@(r) r.wavelength,queue));
    detectors = cellfun(@(p) detectorFor(p,wavelengths),detectorParts,'UniformOutput',false);
    result = struct('rays',{{}},'detectors',{{}}, ...
        'emittedPower',sum(cellfun(@(r) r.power,queue)), ...
        'detectedPower',0,'unresolvedPower',0);
    maxInteractions = round(fieldValue(scene,'maxInteractions',20,1,80));
    maxDistance = fieldValue(scene,'maxDistance',2200,1,10000);
    escapeLength = fieldValue(scene,'escapeLength',260,1,2000);
    eventId = 0;
    while ~isempty(queue)
        ray = queue{end};
        queue(end) = [];
        ray.reason = 'limit';
        while numel(ray.interactions) < maxInteractions && ray.power > 1e-12 && ray.pathLength < maxDistance
            origin = ray.points(end,:);
            groundDistance = Inf;
            if ray.direction(3) < -1e-6 && origin(3) >= 0
                groundDistance = -origin(3)/ray.direction(3);
            end
            remaining = maxDistance-ray.pathLength;
            limit = min(remaining,groundDistance);
            [surface, hit] = findHit(origin,ray.direction,surfaces,limit);
            if isempty(surface)
                span = min(escapeLength,limit);
                if span > 1e-6
                    ray.points(end+1,:) = origin + span*ray.direction;
                end
                ray.reason = 'escaped';
                if groundDistance <= min(escapeLength,remaining)
                    ray.reason = 'table';
                end
                ray.pathLength = ray.pathLength + span;
                break
            end
            ray.points(end+1,:) = hit.point;
            ray.pathLength = ray.pathLength + hit.distance;
            eventId = eventId+1;
            ray.interactions{end+1} = struct('partId',surface.id,'segmentLength',hit.distance, ...
                'pathLength',ray.pathLength,'inputPower',ray.power,'eventId',eventId);
            if strcmp(surface.type,'detector')
                k = find(cellfun(@(d) strcmp(d.id,surface.id),detectors),1);
                detectors{k} = detect(detectors{k},ray,hit);
                ray.detectorId = surface.id;
                ray.reason = 'detected';
                break
            end
            [ray, reflected] = opticalInteraction(ray,surface,hit);
            if ~isempty(reflected)
                if numel(result.rays)+numel(queue)+1 < 6000
                    queue{end+1} = reflected;
                else
                    result.unresolvedPower = result.unresolvedPower + reflected.power;
                end
            end
            if ~strcmp(ray.reason,'limit')
                break
            end
            if ray.power <= 1e-12
                ray.reason = 'absorption';
                ray.power = 0;
            end
        end
        if strcmp(ray.reason,'limit')
            result.unresolvedPower = result.unresolvedPower + ray.power;
        end
        result.rays{end+1} = ray;
    end
    for k = 1:numel(detectors)
        detector = detectors{k};
        if detector.power > 0
            detector.centroid = sum(detector.hits(:,1:2).*detector.hits(:,4),1)/detector.power;
        end
        detectors{k} = detector;
    end
    result.detectors = detectors;
    result.detectedPower = sum(cellfun(@(d) d.power,detectors));
end

function parts = normalizeParts(input)
    if ~iscell(input)
        input = num2cell(input);
    end
    types = {'source','mirror','lens','aperture','detector','splitter','filter','grating'};
    ids = {};
    parts = {};
    for k = 1:numel(input)
        p = input{k};
        if ~isstruct(p) || ~isfield(p,'type') || ~isfield(p,'id') || ...
                ~any(strcmp(p.type,types)) || any(strcmp(p.id,ids))
            continue
        end
        ids{end+1} = p.id;
        if ~isfield(p,'name'), p.name = p.id; end
        p.enabled = ~isfield(p,'enabled') || p.enabled;
        p.position = pointValue(p,'position',[0 0 70]);
        rotation = pointValue(p,'rotation',[0 0 0]);
        a = cosd(rotation);
        b = sind(rotation);
        x = [1 0 0; 0 a(1) -b(1); 0 b(1) a(1)];
        y = [a(2) 0 b(2); 0 1 0; -b(2) 0 a(2)];
        z = [a(3) -b(3) 0; b(3) a(3) 0; 0 0 1];
        orientation = z*y*x;
        p.normal = orientation(:,1).';
        p.u = orientation(:,2).';
        p.v = orientation(:,3).';
        radii = [8,30,26,25,25,28,25,28];
        p.radius = fieldValue(p,'radius',radii(strcmp(p.type,types)),0.01,1000);
        p.rectangular = strcmp(p.type,'detector') || (hasNumber(p,'width') && hasNumber(p,'height'));
        p.width = fieldValue(p,'width',46,0.01,2000);
        p.height = fieldValue(p,'height',46,0.01,2000);
        parts{end+1} = p;
    end
end

function yes = hasNumber(object,name)
    yes = isfield(object,name) && isnumeric(object.(name)) && isscalar(object.(name)) && isfinite(object.(name));
end

function value = fieldValue(object,name,default,lower,upper)
    value = default;
    if hasNumber(object,name), value = double(object.(name)); end
    value = max(lower,min(upper,value));
end

function point = pointValue(object,name,default)
    point = default;
    if isfield(object,name) && isnumeric(object.(name)) && numel(object.(name)) == 3 && all(isfinite(object.(name)))
        point = reshape(double(object.(name)),1,3);
    end
end

function [wavelength,weight] = sourceSpectrum(source)
    wavelength = [];
    weight = [];
    if isfield(source,'spectrum')
        entries = source.spectrum;
        if ~iscell(entries), entries = num2cell(entries); end
        for k = 1:numel(entries)
            line = entries{k};
            if isstruct(line) && hasNumber(line,'wavelength') && line.wavelength > 0
                wavelength(end+1) = line.wavelength;
                weight(end+1) = fieldValue(line,'power',1,0,1e9);
                if numel(wavelength) == 24, break; end
            end
        end
    end
    if isempty(wavelength)
        wavelength = fieldValue(source,'wavelength',532,1,1e7);
        weight = 1;
    end
    wavelength = wavelength(weight > 0);
    weight = weight(weight > 0);
end

function rays = launchRays(sources)
    spectra = cell(numel(sources),2);
    for k = 1:numel(sources)
        [spectra{k,1},spectra{k,2}] = sourceSpectrum(sources{k});
    end
    countLines = sum(cellfun(@numel,spectra(:,1)));
    sampleLimit = min(301,max(1,floor(3200/max(1,countLines))));
    rays = {};
    for k = 1:numel(sources)
        p = sources{k};
        wavelength = spectra{k,1};
        weight = spectra{k,2};
        power = fieldValue(p,'power',1,0,1e6);
        if power <= 1e-12 || isempty(weight), continue; end
        count = round(fieldValue(p,'samples',49,1,sampleLimit));
        divergence = tand(fieldValue(p,'divergence',0.35,0,70));
        samples = zeros(count,2);
        pairs = floor(count/2);
        for sample = 0:pairs-1
            angle = sample*pi*(3-sqrt(5));
            radial = sqrt((sample+0.5)/pairs)*[cos(angle),sin(angle)];
            first = 1+mod(count,2)+2*sample;
            samples(first,:) = radial;
            samples(first+1,:) = -radial;
        end
        for sample = 1:count
            offset = samples(sample,1)*p.u + samples(sample,2)*p.v;
            for line = 1:numel(weight)
                watts = power*weight(line)/(sum(weight)*count);
                rays{end+1} = struct('sourceId',p.id,'wavelength',wavelength(line), ...
                    'power',watts,'inputPower',watts,'points',p.position+p.radius*offset, ...
                    'direction',unit(p.normal+divergence*offset),'pathLength',0, ...
                    'interactions',{{}},'detectorId','');
            end
        end
    end
end

function [surface,hit] = findHit(origin,dir,surfaces,limit)
    surface = [];
    hit = [];
    for k = 1:numel(surfaces)
        p = surfaces{k};
        projection = dot(dir,p.normal);
        if abs(projection) <= 1e-6, continue; end
        distance = dot(p.position-origin,p.normal)/projection;
        if distance <= 1e-6 || distance >= limit, continue; end
        point = origin+distance*dir;
        offset = point-p.position;
        u = dot(offset,p.u);
        v = dot(offset,p.v);
        if p.rectangular
            outside = abs(u)>p.width/2+1e-6 || abs(v)>p.height/2+1e-6;
        else
            outside = u^2+v^2>p.radius^2+1e-6;
        end
        if outside, continue; end
        limit = distance;
        surface = p;
        hit = struct('point',point,'distance',distance,'u',u,'v',v,'projection',projection);
    end
end

function vector = unit(vector)
    vector = vector/norm(vector);
end

function [ray,reflected] = opticalInteraction(ray,p,hit)
    reflected = [];
    switch p.type
        case 'mirror'
            ray.direction = unit(ray.direction-2*hit.projection*p.normal);
            ray.power = ray.power*fieldValue(p,'reflectivity',0.98,0,1);
        case 'lens'
            focal = fieldValue(p,'focalLength',110,-5000,5000);
            if abs(focal)>1e-6
                ray.direction = unit(ray.direction/abs(hit.projection)-(hit.u*p.u+hit.v*p.v)/focal);
            end
            ray.power = ray.power*fieldValue(p,'transmission',0.97,0,1);
        case 'aperture'
            if hasNumber(p,'openingWidth') && hasNumber(p,'openingHeight')
                inside = p.openingWidth>0 && p.openingHeight>0 && ...
                    abs(hit.u)<=p.openingWidth/2 && abs(hit.v)<=p.openingHeight/2;
            else
                radius = fieldValue(p,'opening',10,0,2000)/2;
                inside = radius>0 && hit.u^2+hit.v^2<=radius^2;
            end
            if ~inside, ray.power = 0; ray.reason = 'aperture'; end
        case 'filter'
            center = fieldValue(p,'centerWavelength',532,1,1e7);
            width = fieldValue(p,'bandwidth',55,0.001,1e7);
            ray.power = ray.power*exp(-4*log(2)*((ray.wavelength-center)/width)^2)*fieldValue(p,'transmission',0.9,0,1);
        case 'grating'
            density = fieldValue(p,'grooveDensity',600,0,10000);
            order = floor(fieldValue(p,'order',1,-12,12)+0.5);
            u = dot(ray.direction,p.u)+order*ray.wavelength*density/1e6;
            v = dot(ray.direction,p.v);
            normalSquared = 1-u^2-v^2;
            if normalSquared <= 1e-6
                ray.power = 0;
                ray.reason = 'evanescent';
            else
                side = sign(hit.projection);
                if isfield(p,'reflective') && p.reflective, side = -side; end
                ray.direction = unit(u*p.u+v*p.v+side*sqrt(normalSquared)*p.normal);
                ray.power = ray.power*fieldValue(p,'transmission',0.8,0,1);
            end
        case 'splitter'
            reflectivity = fieldValue(p,'reflectivity',0.5,0,1);
            transmission = fieldValue(p,'transmission',0.5,0,1);
            fraction = max(1,reflectivity+transmission);
            power = ray.power*reflectivity/fraction;
            if power > 1e-12
                reflected = ray;
                reflected.direction = unit(ray.direction-2*hit.projection*p.normal);
                reflected.power = power;
            end
            ray.power = ray.power*transmission/fraction;
    end
end

function detector = detectorFor(p,wavelengths)
    columns = round(fieldValue(p,'columns',32,1,128));
    rows = round(fieldValue(p,'rows',32,1,128));
    detector = struct('id',p.id,'name',p.name,'width',p.width,'height',p.height, ...
        'power',0,'count',0,'centroid',[NaN NaN],'hits',zeros(0,6), ...
        'bins',zeros(rows,columns),'spectrum',[wavelengths(:),zeros(numel(wavelengths),1)]);
end

function detector = detect(detector,ray,hit)
    [rows,columns] = size(detector.bins);
    column = max(0,min(columns-1,floor((0.5+hit.u/detector.width)*columns)));
    row = max(0,min(rows-1,floor((0.5-hit.v/detector.height)*rows)));
    detector.bins(row+1,column+1) = detector.bins(row+1,column+1)+ray.power;
    detector.power = detector.power+ray.power;
    detector.count = detector.count+1;
    detector.hits(end+1,:) = [hit.u hit.v ray.wavelength ray.power column row];
    band = find(detector.spectrum(:,1)==ray.wavelength,1);
    detector.spectrum(band,2) = detector.spectrum(band,2)+ray.power;
end

function [detectorSummary,pathSegments] = summarizeTrace(result)
    detectorCount = numel(result.detectors);
    label = strings(detectorCount,1);
    power = zeros(detectorCount,1);
    count = zeros(detectorCount,1);
    centroid = nan(detectorCount,2);
    for k = 1:detectorCount
        d = result.detectors{k};
        label(k) = string(d.name);
        power(k) = d.power;
        count(k) = d.count;
        centroid(k,:) = d.centroid;
    end
    detectorSummary = table(label,power,count,centroid(:,1),centroid(:,2), ...
        'VariableNames',{'Detector','Power_mW','HitCount','CentroidU_mm','CentroidV_mm'});
    segmentCount = sum(cellfun(@(r) numel(r.interactions),result.rays));
    rayNumber = zeros(segmentCount,1);
    wavelength = zeros(segmentCount,1);
    from = strings(segmentCount,1);
    to = strings(segmentCount,1);
    lengthMm = zeros(segmentCount,1);
    cumulative = zeros(segmentCount,1);
    deltaMm = zeros(segmentCount,3);
    incidentPower = zeros(segmentCount,1);
    index = 0;
    for r = 1:numel(result.rays)
        ray = result.rays{r};
        previous = ray.sourceId;
        for k = 1:numel(ray.interactions)
            hit = ray.interactions{k};
            index = index+1;
            rayNumber(index) = r;
            wavelength(index) = ray.wavelength;
            from(index) = string(previous);
            to(index) = string(hit.partId);
            lengthMm(index) = hit.segmentLength;
            cumulative(index) = hit.pathLength;
            deltaMm(index,:) = ray.points(k+1,:) - ray.points(k,:);
            incidentPower(index) = hit.inputPower;
            previous = hit.partId;
        end
    end
    pathSegments = table(rayNumber,wavelength,from,to,lengthMm,cumulative,deltaMm(:,1),deltaMm(:,2),deltaMm(:,3),incidentPower, ...
        'VariableNames',{'Ray','Wavelength_nm','From','To','Segment_mm','Cumulative_mm','DeltaX_mm','DeltaY_mm','DeltaZ_mm','Incident_mW'});
end

function drawOptics(scene,result)
    figure('Name',['Spectral Bench | ' char(scene.name)],'Color','white');
    layout = tiledlayout(1,2,'TileSpacing','compact','Padding','compact');
    bench = nexttile(layout);
    hold(bench,'on');
    parts = normalizeParts(scene.parts);
    for k = 1:numel(parts)
        p = parts{k};
        if p.rectangular
            offsets = [-1 -1; 1 -1; 1 1; -1 1; -1 -1].*[p.width/2 p.height/2];
        else
            angle = linspace(0,2*pi,25).';
            offsets = p.radius*[cos(angle) sin(angle)];
        end
        outline = p.position + offsets(:,1)*p.u + offsets(:,2)*p.v;
        plot3(bench,outline(:,1),outline(:,2),outline(:,3),'Color',[0.25 0.31 0.36]);
        text(bench,p.position(1),p.position(2),p.position(3)+12,p.name,'FontSize',8,'Interpreter','none');
    end
    rayStep = max(1,ceil(numel(result.rays)/180));
    for k = 1:rayStep:numel(result.rays)
        ray = result.rays{k};
        p = ray.points;
        color = rayColor(ray.wavelength);
        plot3(bench,p(:,1),p(:,2),p(:,3),'Color',color);
    end
    grid(bench,'on'); axis(bench,'equal'); view(bench,35,28);
    xlabel(bench,'X (mm)'); ylabel(bench,'Y (mm)'); zlabel(bench,'Z (mm)');
    title(bench,'3D ray paths');
    sensor = nexttile(layout);
    if isempty(result.detectors)
        axis(sensor,'off');
        title(sensor,'No detector');
        return
    end
    detector = result.detectors{1};
    [rows,columns] = size(detector.bins);
    u = ((1:columns)-0.5)/columns*detector.width-detector.width/2;
    v = ((1:rows)-0.5)/rows*detector.height-detector.height/2;
    imagesc(sensor,u,v,flipud(detector.bins));
    axis(sensor,'xy','image');
    bar = colorbar(sensor);
    bar.Label.String = 'Power per pixel (mW)';
    xlabel(sensor,'U (mm)'); ylabel(sensor,'V (mm)');
    title(sensor,detector.name,'Interpreter','none');
end

function color = rayColor(wavelength)
    if wavelength < 490
        color = [0.23 0.45 0.89];
    elseif wavelength < 575
        color = [0.18 0.62 0.35];
    else
        color = [0.90 0.32 0.20];
    end
end

function data = sweepDetector(scene,options)
    offsets = double(options.offsets_mm(:));
    data = table();
    if isempty(offsets) || isempty(options.detectorId), return; end
    if ~iscell(scene.parts), scene.parts = num2cell(scene.parts); end
    index = find(cellfun(@(p) strcmp(p.id,options.detectorId) && strcmp(p.type,'detector'),scene.parts),1);
    if isempty(index), return; end
    normalized = normalizeParts(scene.parts(index));
    center = normalized{1}.position;
    axis = normalized{1}.normal;
    power = zeros(size(offsets));
    hits = zeros(size(offsets));
    radiusRms = nan(size(offsets));
    position = zeros(numel(offsets),3);
    for k = 1:numel(offsets)
        position(k,:) = center + offsets(k)*axis;
        scene.parts{index}.position = position(k,:);
        result = traceOptics(scene);
        detectorIndex = find(cellfun(@(d) strcmp(d.id,options.detectorId),result.detectors),1);
        detector = result.detectors{detectorIndex};
        power(k) = detector.power;
        hits(k) = detector.count;
        if detector.power > 0
            distances = detector.hits(:,1:2)-detector.centroid;
            radiusRms(k) = sqrt(sum(sum(distances.^2,2).*detector.hits(:,4))/detector.power);
        end
    end
    data = table(offsets,power,hits,radiusRms,position(:,1),position(:,2),position(:,3), ...
        'VariableNames',{'DetectorAxialOffset_mm','Power_mW','HitCount','RmsRadius_mm','X_mm','Y_mm','Z_mm'});
    figure('Name','Detector offset sweep','Color','white');
    tiledlayout(2,1);
    nexttile;
    plot(offsets,power,'-o');
    xlabel('Detector axial offset (mm)'); ylabel('Detected power (mW)'); grid on;
    nexttile;
    plot(offsets,radiusRms,'-o');
    xlabel('Detector axial offset (mm)'); ylabel('RMS radius (mm)'); grid on;
end
`;
