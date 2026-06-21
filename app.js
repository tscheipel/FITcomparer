import FitParser from 'https://esm.sh/fit-file-parser@3.0.2';

const METRICS = [
  { key: 'heartRate', label: 'HR', unit: 'bpm', color: '#ff9f5c' },
  { key: 'power', label: 'Power', unit: 'W', color: '#4de1c1' },
  { key: 'speed', label: 'Geschwindigkeit', unit: 'km/h', color: '#78a6ff' },
  { key: 'cadence', label: 'Kadenz', unit: 'rpm', color: '#f4d35e' },
  { key: 'altitude', label: 'Höhe', unit: 'm', color: '#d6a7ff' },
];

const state = {
  tracks: [null, null],
  offsetSeconds: 0,
  selectedMetric: 'speed',
  isPlaying: false,
  playbackSpeed: 1,
  currentTime: 0,
  duration: 0,
  lastFrame: null,
  map: null,
  chart: null,
  layers: {
    polylineA: null,
    polylineB: null,
    markerA: null,
    markerB: null,
  },
};

const elements = {
  fileA: document.getElementById('fileA'),
  fileB: document.getElementById('fileB'),
  metaA: document.getElementById('metaA'),
  metaB: document.getElementById('metaB'),
  statusA: document.getElementById('statusA'),
  statusB: document.getElementById('statusB'),
  mapLabelA: document.getElementById('mapLabelA'),
  mapLabelB: document.getElementById('mapLabelB'),
  progressBarA: document.getElementById('progressBarA'),
  progressBarB: document.getElementById('progressBarB'),
  progressLabelA: document.getElementById('progressLabelA'),
  progressLabelB: document.getElementById('progressLabelB'),
  progressValueA: document.getElementById('progressValueA'),
  progressValueB: document.getElementById('progressValueB'),
  offset: document.getElementById('offset'),
  offsetText: document.getElementById('offsetText'),
  playPause: document.getElementById('playPause'),
  resetPlayback: document.getElementById('resetPlayback'),
  speed: document.getElementById('speed'),
  progress: document.getElementById('progress'),
  currentTimeLabel: document.getElementById('currentTimeLabel'),
  durationLabel: document.getElementById('durationLabel'),
  metricSwitcher: document.getElementById('metricSwitcher'),
  chart: document.getElementById('chart'),
  currentPointTime: document.getElementById('currentPointTime'),
  currentPointValues: document.getElementById('currentPointValues'),
  hoverPointTime: document.getElementById('hoverPointTime'),
  hoverPointValues: document.getElementById('hoverPointValues'),
  selectionPanel: document.getElementById('selectionPanel'),
  selectionRange: document.getElementById('selectionRange'),
  selectionValues: document.getElementById('selectionValues'),
  selectionClose: document.getElementById('selectionClose'),
};

const METRIC_BUTTONS = new Map();

const chartInteraction = {
  hoverTime: null,
  hoverPixelX: null,
  selectionStart: null,
  selectionEnd: null,
  selectionStartPixelX: null,
  selectionEndPixelX: null,
  selectionActive: false,
  selectionDragActive: false,
  dragPointerId: null,
};

init();

function init() {
  createMetricButtons();
  initMap();
  initChart();
  bindEvents();
  resetMapLabels();
  updateOffsetDisplay();
  renderEmptyState();
}

function bindEvents() {
  elements.fileA.addEventListener('change', () => handleFileSelection(0));
  elements.fileB.addEventListener('change', () => handleFileSelection(1));
  elements.offset.addEventListener('input', () => {
    state.offsetSeconds = Number(elements.offset.value);
    updateOffsetDisplay();
    recomputeTimeline();
  });
  elements.offsetText.addEventListener('change', () => {
    const parsed = parseOffsetText(elements.offsetText.value);
    if (parsed === null) {
      updateOffsetDisplay();
      return;
    }

    state.offsetSeconds = parsed;
    elements.offset.value = String(parsed);
    updateOffsetDisplay();
    recomputeTimeline();
  });
  elements.offsetText.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      elements.offsetText.blur();
    }
  });
  elements.playPause.addEventListener('click', togglePlayback);
  elements.resetPlayback.addEventListener('click', resetPlayback);
  elements.speed.addEventListener('change', () => {
    state.playbackSpeed = Number(elements.speed.value);
  });
  elements.progress.addEventListener('input', () => {
    state.currentTime = Number(elements.progress.value);
    state.isPlaying = false;
    elements.playPause.textContent = '▶';
    updateVisuals();
  });
  elements.selectionClose.addEventListener('click', clearSelectionWindow);
}

function createMetricButtons() {
  for (const metric of METRICS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = metric.label;
    button.className = metric.key === state.selectedMetric ? 'active' : '';
    button.addEventListener('click', () => {
      state.selectedMetric = metric.key;
      for (const [key, btn] of METRIC_BUTTONS.entries()) {
        btn.classList.toggle('active', key === metric.key);
      }
      refreshChart();
    });
    METRIC_BUTTONS.set(metric.key, button);
    elements.metricSwitcher.appendChild(button);
  }
}

function initMap() {
  state.map = L.map('map', { preferCanvas: true }).setView([48.2, 11.6], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap-Mitwirkende',
    maxZoom: 19,
  }).addTo(state.map);
}

function initChart() {
  state.chart = new Chart(elements.chart, {
    type: 'line',
    data: {
      datasets: [],
    },
    plugins: [createChartOverlayPlugin()],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          labels: {
            color: '#eff5ff',
            usePointStyle: true,
          },
        },
        tooltip: {
          callbacks: {
            title(items) {
              const seconds = items[0]?.parsed?.x ?? 0;
              return formatDuration(seconds);
            },
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          grid: { color: 'rgba(255, 255, 255, 0.08)' },
          ticks: {
            color: '#9fb1c9',
            callback(value) {
              return formatDuration(Number(value));
            },
          },
          title: {
            display: true,
            text: 'Zeit',
            color: '#9fb1c9',
          },
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.08)' },
          ticks: { color: '#9fb1c9' },
          title: {
            display: true,
            text: 'Wert',
            color: '#9fb1c9',
          },
        },
      },
    },
  });

  elements.chart.addEventListener('pointerdown', handleChartPointerDown);
  elements.chart.addEventListener('pointermove', handleChartPointerMove);
  elements.chart.addEventListener('pointerup', handleChartPointerUp);
  elements.chart.addEventListener('pointerleave', handleChartPointerLeave);
}

async function handleFileSelection(index) {
  const input = index === 0 ? elements.fileA : elements.fileB;
  const file = input.files?.[0];
  if (!file) {
    return;
  }

  setLoadingState(index, {
    phase: 'Lese Datei',
    percent: 5,
    loading: true,
    status: 'Lädt ...',
    meta: `${file.name} wird gelesen ...`,
  });

  try {
    const buffer = await readFileWithProgress(file, index);
    setLoadingState(index, {
      phase: 'Analysiere Datei',
      percent: 90,
      loading: true,
      status: 'Verarbeite ...',
      meta: `${file.name} wird analysiert ...`,
    });

    const track = await parseFitnessFile(buffer, file);
    state.tracks[index] = track;
    setMapLabel(index, file.name);
    setLoadingState(index, {
      phase: 'Fertig',
      percent: 100,
      loading: false,
      status: 'Geladen',
      meta: buildTrackSummary(track, file.name),
    });
    recomputeTimeline();
    fitMapBounds();
  } catch (error) {
    console.error(error);
    state.tracks[index] = null;
    setMapLabel(index, index === 0 ? 'Datei 1' : 'Datei 2');
    setLoadingState(index, {
      phase: 'Fehler',
      percent: 0,
      loading: false,
      status: 'Fehler',
      meta: `Datei konnte nicht geladen werden: ${error.message}`,
    });
    renderEmptyState();
  }
}

function readFileWithProgress(file, index) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    updateProgress(index, 5, 'Lese Datei');

    reader.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }

      const percent = Math.min(85, Math.max(10, Math.round((event.loaded / event.total) * 80)));
      updateProgress(index, percent, 'Lese Datei');
    };

    reader.onload = () => {
      updateProgress(index, 90, 'Daten geladen');
      resolve(reader.result);
    };

    reader.onerror = () => {
      reject(reader.error || new Error('Datei konnte nicht gelesen werden.'));
    };

    reader.readAsArrayBuffer(file);
  });
}

async function parseFitnessFile(buffer, file) {
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension === 'gpx') {
    return parseGpx(buffer, file.name);
  }

  if (extension === 'fit') {
    return parseFit(buffer, file.name);
  }

  throw new Error('Nur GPX und FIT werden unterstützt.');
}

function parseGpx(buffer, fileName) {
  const xml = new TextDecoder().decode(buffer);
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const parseError = document.querySelector('parsererror');
  if (parseError) {
    throw new Error(`GPX konnte nicht gelesen werden: ${parseError.textContent?.trim() || 'ungültiges XML'}`);
  }

  const points = Array.from(document.getElementsByTagName('trkpt'))
    .map((point) => {
      const lat = Number(point.getAttribute('lat'));
      const lon = Number(point.getAttribute('lon'));
      const timeNode = point.getElementsByTagName('time')[0];
      const time = timeNode ? new Date(timeNode.textContent || '') : null;
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !time || Number.isNaN(time.getTime())) {
        return null;
      }

      const extensionValues = readExtensionValues(point);
      return {
        t: time,
        lat,
        lon,
        altitude: readFirstNumeric(point, ['ele']) ?? extensionValues.altitude ?? null,
        heartRate: extensionValues.heartRate ?? readFirstNumeric(point, ['hr']) ?? null,
        power: extensionValues.power ?? readFirstNumeric(point, ['power']) ?? null,
        speed: extensionValues.speed ?? readFirstNumeric(point, ['speed']) ?? null,
        cadence: extensionValues.cadence ?? readFirstNumeric(point, ['cad']) ?? null,
      };
    })
    .filter(Boolean);

  if (!points.length) {
    throw new Error(`In ${fileName} wurden keine Trackpunkte gefunden.`);
  }

  const samples = normalizeSamples(points, true);
  return createTrack(samples, samples.filter(hasCoordinates), fileName, 'GPX');
}

async function parseFit(buffer, fileName) {
  const parser = new FitParser({
    force: true,
    speedUnit: 'kmh',
    lengthUnit: 'km',
    temperatureUnit: 'celsius',
    elapsedRecordField: true,
    mode: 'both',
  });

  const parsed = await parser.parseAsync(buffer);
  const samples = collectFitSamples(parsed);

  if (!samples.length) {
    throw new Error(`In ${fileName} wurden keine FIT-Records gefunden.`);
  }

  const normalized = normalizeSamples(samples, true);
  if (!normalized.length) {
    throw new Error(`In ${fileName} wurden keine verwertbaren FIT-Records gefunden.`);
  }

  return createTrack(normalized, normalized.filter(hasCoordinates), fileName, 'FIT');
}

function normalizeSamples(rawSamples, keepAbsoluteTime = false) {
  if (!rawSamples.length) {
    return [];
  }

  const sorted = [...rawSamples].sort((a, b) => a.t - b.t);
  const firstTime = sorted[0].t.getTime();
  let cumulativeDistance = 0;

  return sorted.map((sample, index) => {
    const seconds = keepAbsoluteTime ? (sample.t.getTime() - firstTime) / 1000 : sample.t;
    const hasCurrentCoordinates = hasCoordinates(sample);
    const hasPreviousCoordinates = index > 0 && hasCoordinates(sorted[index - 1]);

    if (hasCurrentCoordinates && hasPreviousCoordinates) {
      cumulativeDistance += haversineKm(sorted[index - 1].lat, sorted[index - 1].lon, sample.lat, sample.lon);
    }

    let speed = sample.speed;
    if (!Number.isFinite(speed) && index > 0 && hasPreviousCoordinates && hasCurrentCoordinates) {
      const deltaSeconds = (sorted[index].t.getTime() - sorted[index - 1].t.getTime()) / 1000;
      if (deltaSeconds > 0) {
        const deltaDistance = haversineKm(sorted[index - 1].lat, sorted[index - 1].lon, sample.lat, sample.lon);
        speed = (deltaDistance / deltaSeconds) * 3.6;
      }
    } else if (Number.isFinite(speed)) {
      speed = normalizeSpeed(speed);
    }

    return {
      t: seconds,
      lat: Number.isFinite(sample.lat) ? sample.lat : null,
      lon: Number.isFinite(sample.lon) ? sample.lon : null,
      altitude: sample.altitude ?? null,
      heartRate: sample.heartRate ?? null,
      power: sample.power ?? null,
      speed: Number.isFinite(speed) ? speed : null,
      cadence: sample.cadence ?? null,
      distance: Number.isFinite(sample.lat) && Number.isFinite(sample.lon) ? cumulativeDistance : null,
    };
  });
}

function collectFitSamples(root) {
  const recordGroups = findFitRecordGroups(root);
  const collected = [];

  for (const group of recordGroups) {
    for (const record of group) {
      const sample = extractFitSample(record);
      if (sample) {
        collected.push(sample);
      }
    }
  }

  return collected;
}

function findFitRecordGroups(root) {
  const groups = [];
  const queue = [root];
  const visited = new Set();

  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== 'object' || visited.has(value)) {
      continue;
    }

    visited.add(value);

    if (Array.isArray(value)) {
      if (value.length && value.every((entry) => entry && typeof entry === 'object')) {
        const looksLikeRecords = value.some((entry) =>
          Object.prototype.hasOwnProperty.call(entry, 'timestamp') ||
          Object.prototype.hasOwnProperty.call(entry, 'position_lat') ||
          Object.prototype.hasOwnProperty.call(entry, 'position_long') ||
          Object.prototype.hasOwnProperty.call(entry, 'heart_rate')
        );

        if (looksLikeRecords) {
          groups.push(value);
          continue;
        }
      }

      for (const entry of value) {
        queue.push(entry);
      }
      continue;
    }

    for (const [key, entry] of Object.entries(value)) {
      if (Array.isArray(entry) && key.toLowerCase().includes('record')) {
        groups.push(entry);
        continue;
      }

      queue.push(entry);
    }
  }

  return groups;
}

function extractFitSample(record) {
  const timestamp = parseTimestamp(record.timestamp);
  if (!timestamp) {
    return null;
  }

  const latitude = pickNumber(record, ['position_lat', 'positionLat', 'lat', 'latitude']);
  const longitude = pickNumber(record, ['position_long', 'positionLong', 'lon', 'lng', 'longitude']);

  return {
    t: timestamp,
    lat: Number.isFinite(latitude) ? toDegrees(latitude) : null,
    lon: Number.isFinite(longitude) ? toDegrees(longitude) : null,
    altitude: pickNumber(record, ['altitude', 'enhanced_altitude']) ?? null,
    heartRate: pickNumber(record, ['heart_rate', 'heartRate']) ?? null,
    power: pickNumber(record, ['power']) ?? null,
    speed: normalizeSpeed(pickNumber(record, ['speed'])),
    cadence: pickNumber(record, ['cadence']) ?? null,
  };
}

function createTrack(samples, mapSamples, fileName, source) {
  const startTime = samples[0].t;
  const endTime = samples[samples.length - 1].t;
  return {
    fileName,
    source,
    samples,
    mapSamples,
    startTime,
    endTime,
    duration: endTime - startTime,
    distance: mapSamples.length ? mapSamples[mapSamples.length - 1].distance : null,
  };
}

function hasCoordinates(sample) {
  return Number.isFinite(sample?.lat) && Number.isFinite(sample?.lon);
}

function readExtensionValues(point) {
  const values = {
    heartRate: null,
    power: null,
    speed: null,
    cadence: null,
    altitude: null,
  };

  const extensionNodes = point.getElementsByTagName('extensions');
  for (const extensions of extensionNodes) {
    const nodes = Array.from(extensions.getElementsByTagName('*'));
    for (const node of nodes) {
      const name = node.localName?.toLowerCase();
      const value = readNumberFromText(node.textContent);
      if (!Number.isFinite(value)) {
        continue;
      }

      if (name?.includes('hr') || name?.includes('heartrate')) {
        values.heartRate = value;
      } else if (name?.includes('power')) {
        values.power = value;
      } else if (name?.includes('speed')) {
        values.speed = value;
      } else if (name?.includes('cad')) {
        values.cadence = value;
      } else if (name?.includes('alt')) {
        values.altitude = value;
      }
    }
  }

  return values;
}

function readFirstNumeric(node, tagNames) {
  for (const tagName of tagNames) {
    const candidate = node.getElementsByTagName(tagName)[0];
    if (!candidate) {
      continue;
    }

    const value = readNumberFromText(candidate.textContent);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function readNumberFromText(text) {
  const value = Number(String(text ?? '').replace(',', '.').trim());
  return Number.isFinite(value) ? value : null;
}

function pickNumber(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function parseTimestamp(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDegrees(value) {
  if (!Number.isFinite(value)) {
    return value;
  }

  if (Math.abs(value) > 180) {
    return value * (180 / Math.pow(2, 31));
  }

  return value;
}

function normalizeSpeed(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return value > 20 ? value : value * 3.6;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const earthRadiusKm = 6371;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function recomputeTimeline() {
  const trackA = state.tracks[0];
  const trackB = state.tracks[1];
  if (!trackA && !trackB) {
    renderEmptyState();
    return;
  }

  const origin = Math.min(0, state.offsetSeconds);
  const adjustedEndA = trackA ? trackA.endTime - origin : 0;
  const adjustedEndB = trackB ? trackB.endTime + state.offsetSeconds - origin : 0;
  state.duration = Math.max(adjustedEndA, adjustedEndB);
  elements.progress.max = String(Math.max(state.duration, 0.1));
  elements.durationLabel.textContent = formatDuration(state.duration);

  if (state.currentTime > state.duration) {
    state.currentTime = state.duration;
  }

  updateVisuals();
}

function updateVisuals() {
  updatePlaybackLabels();
  updateMapLayers();
  refreshChart();
  elements.progress.value = String(state.currentTime);
  refreshCurrentPointInspector();
}

function updatePlaybackLabels() {
  elements.currentTimeLabel.textContent = formatDuration(state.currentTime);
  elements.durationLabel.textContent = formatDuration(state.duration);
}

function updateMapLayers() {
  const trackA = state.tracks[0];
  const trackB = state.tracks[1];
  const origin = Math.min(0, state.offsetSeconds);

  clearMapLayer('polylineA');
  clearMapLayer('polylineB');
  clearMapLayer('markerA');
  clearMapLayer('markerB');

  if (trackA) {
    const coordsA = trackA.mapSamples.map((sample) => [sample.lat, sample.lon]);
    if (coordsA.length) {
      state.layers.polylineA = L.polyline(coordsA, { color: '#4de1c1', weight: 4, opacity: 0.9 }).addTo(state.map);
      const positionA = interpolatePosition(trackA.mapSamples, state.currentTime + origin);
      if (positionA) {
        state.layers.markerA = L.circleMarker([positionA.lat, positionA.lon], {
          radius: 8,
          color: '#4de1c1',
          weight: 3,
          fillColor: '#06131b',
          fillOpacity: 1,
        }).addTo(state.map);
      }
    }
  }

  if (trackB) {
    const coordsB = trackB.mapSamples.map((sample) => [sample.lat, sample.lon]);
    if (coordsB.length) {
      state.layers.polylineB = L.polyline(coordsB, { color: '#78a6ff', weight: 4, opacity: 0.9 }).addTo(state.map);
      const positionB = interpolatePosition(trackB.mapSamples, state.currentTime + origin - state.offsetSeconds);
      if (positionB) {
        state.layers.markerB = L.circleMarker([positionB.lat, positionB.lon], {
          radius: 8,
          color: '#78a6ff',
          weight: 3,
          fillColor: '#06131b',
          fillOpacity: 1,
        }).addTo(state.map);
      }
    }
  }
}

function clearMapLayer(layerName) {
  const layer = state.layers[layerName];
  if (layer) {
    layer.remove();
    state.layers[layerName] = null;
  }
}

function fitMapBounds() {
  const points = [];
  for (const track of state.tracks) {
    if (!track) {
      continue;
    }
    for (const sample of track.mapSamples) {
      points.push([sample.lat, sample.lon]);
    }
  }

  if (!points.length) {
    return;
  }

  const bounds = L.latLngBounds(points);
  if (bounds.isValid()) {
    state.map.fitBounds(bounds.pad(0.1));
  }
}

function interpolatePosition(samples, time) {
  if (!samples.length) {
    return null;
  }

  if (time <= samples[0].t) {
    return samples[0];
  }

  if (time >= samples[samples.length - 1].t) {
    return samples[samples.length - 1];
  }

  let left = 0;
  let right = samples.length - 1;
  while (right - left > 1) {
    const middle = Math.floor((left + right) / 2);
    if (samples[middle].t <= time) {
      left = middle;
    } else {
      right = middle;
    }
  }

  const start = samples[left];
  const end = samples[right];
  const ratio = (time - start.t) / Math.max(end.t - start.t, 0.001);

  return {
    lat: lerp(start.lat, end.lat, ratio),
    lon: lerp(start.lon, end.lon, ratio),
  };
}

function lerp(start, end, ratio) {
  return start + (end - start) * ratio;
}

function refreshChart() {
  const metric = METRICS.find((entry) => entry.key === state.selectedMetric);
  if (!metric || !state.chart) {
    return;
  }

  const origin = Math.min(0, state.offsetSeconds);
  const datasets = [];

  if (state.tracks[0]) {
    datasets.push(buildDataset(state.tracks[0], metric, '#4de1c1', 0, origin));
  }

  if (state.tracks[1]) {
    datasets.push(buildDataset(state.tracks[1], metric, '#78a6ff', state.offsetSeconds, origin));
  }

  state.chart.data.datasets = datasets;
  state.chart.options.scales.y.title.text = `${metric.label} (${metric.unit})`;
  state.chart.options.scales.y.suggestedMin = undefined;
  state.chart.options.scales.y.suggestedMax = undefined;
  state.chart.update('none');
  refreshHoverInspector();
  refreshSelectionInspector();
}

function getChartTimeFromPixel(pixelX) {
  const xScale = state.chart?.scales?.x;
  if (!xScale) {
    return null;
  }

  return xScale.getValueForPixel(pixelX);
}

function getChartPointerTime(event) {
  if (!state.chart) {
    return null;
  }

  const rect = elements.chart.getBoundingClientRect();
  const pixelX = event.clientX - rect.left;
  return getChartTimeFromPixel(pixelX);
}

function getChartPointerPixelX(event) {
  const rect = elements.chart.getBoundingClientRect();
  return event.clientX - rect.left;
}

function refreshCurrentPointInspector() {
  const origin = Math.min(0, state.offsetSeconds);
  const timeA = state.currentTime + origin;
  const timeB = state.currentTime + origin - state.offsetSeconds;
  const metric = getActiveMetric();
  const trackAValue = getTrackValueAtTime(state.tracks[0], timeA);
  const trackBValue = getTrackValueAtTime(state.tracks[1], timeB);

  elements.currentPointTime.textContent = formatDuration(state.currentTime);
  elements.currentPointValues.innerHTML = `
    ${formatValueRow('HR Datei 1', trackAValue?.heartRate, 'bpm', 'value-a')}
    ${formatValueRow('HR Datei 2', trackBValue?.heartRate, 'bpm', 'value-b')}
    ${formatValueRow('Power Datei 1', trackAValue?.power, 'W', 'value-a')}
    ${formatValueRow('Power Datei 2', trackBValue?.power, 'W', 'value-b')}
    ${formatValueRow('Geschw. Datei 1', trackAValue?.speed, 'km/h', 'value-a')}
    ${formatValueRow('Geschw. Datei 2', trackBValue?.speed, 'km/h', 'value-b')}
    ${formatValueRow(`${metric.label} Datei 1`, trackAValue?.[metric.key], metric.unit, 'value-a')}
    ${formatValueRow(`${metric.label} Datei 2`, trackBValue?.[metric.key], metric.unit, 'value-b')}
  `;
}

function refreshHoverInspector() {
  if (chartInteraction.hoverTime === null) {
    elements.hoverPointTime.textContent = '-';
    elements.hoverPointValues.innerHTML = '<div class="track-value-row"><span class="label">Maus über den Graphen bewegen</span><span class="value value-a">—</span></div>';
    return;
  }

  const origin = Math.min(0, state.offsetSeconds);
  const timeA = chartInteraction.hoverTime + origin;
  const timeB = chartInteraction.hoverTime + origin - state.offsetSeconds;
  const metric = getActiveMetric();
  const trackAValue = getTrackValueAtTime(state.tracks[0], timeA);
  const trackBValue = getTrackValueAtTime(state.tracks[1], timeB);

  elements.hoverPointTime.textContent = formatDuration(chartInteraction.hoverTime);
  elements.hoverPointValues.innerHTML = `
    ${formatValueRow(`${metric.label} Datei 1`, trackAValue?.[metric.key], metric.unit, 'value-a')}
    ${formatValueRow(`${metric.label} Datei 2`, trackBValue?.[metric.key], metric.unit, 'value-b')}
  `;
}

function refreshSelectionInspector() {
  if (!chartInteraction.selectionActive || chartInteraction.selectionStart === null || chartInteraction.selectionEnd === null) {
    elements.selectionPanel.classList.add('hidden');
    return;
  }

  const start = Math.min(chartInteraction.selectionStart, chartInteraction.selectionEnd);
  const end = Math.max(chartInteraction.selectionStart, chartInteraction.selectionEnd);
  const origin = Math.min(0, state.offsetSeconds);
  const metric = getActiveMetric();
  const averageA = averageMetric(state.tracks[0], start + origin, end + origin, metric.key);
  const averageB = averageMetric(state.tracks[1], start + origin - state.offsetSeconds, end + origin - state.offsetSeconds, metric.key);

  elements.selectionPanel.classList.remove('hidden');
  elements.selectionRange.textContent = `${formatDuration(start)} - ${formatDuration(end)}`;
  elements.selectionValues.innerHTML = [
    formatValueRow(`${metric.label} Ø Datei 1`, averageA, metric.unit, 'value-a'),
    formatValueRow(`${metric.label} Ø Datei 2`, averageB, metric.unit, 'value-b'),
    ...METRICS.flatMap((entry) => [
      formatValueRow(`${entry.label} Ø Datei 1`, averageMetric(state.tracks[0], start + origin, end + origin, entry.key), entry.unit, 'value-a'),
      formatValueRow(`${entry.label} Ø Datei 2`, averageMetric(state.tracks[1], start + origin - state.offsetSeconds, end + origin - state.offsetSeconds, entry.key), entry.unit, 'value-b'),
    ]),
  ].join('');
}

function createChartOverlayPlugin() {
  return {
    id: 'chartOverlay',
    afterDraw(chart) {
      const ctx = chart.ctx;
      const xScale = chart.scales.x;
      const chartArea = chart.chartArea;

      if (!xScale || !chartArea) {
        return;
      }

      const drawVerticalLine = (pixelX, color, dash) => {
        if (!Number.isFinite(pixelX)) {
          return;
        }

        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash(dash);
        ctx.moveTo(pixelX, chartArea.top);
        ctx.lineTo(pixelX, chartArea.bottom);
        ctx.stroke();
        ctx.restore();
      };

      if (chartInteraction.selectionActive && chartInteraction.selectionStartPixelX !== null && chartInteraction.selectionEndPixelX !== null) {
        const left = Math.min(chartInteraction.selectionStartPixelX, chartInteraction.selectionEndPixelX);
        const right = Math.max(chartInteraction.selectionStartPixelX, chartInteraction.selectionEndPixelX);
        ctx.save();
        ctx.fillStyle = 'rgba(77, 225, 193, 0.08)';
        ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
        ctx.restore();
        drawVerticalLine(left, 'rgba(77, 225, 193, 0.55)', [6, 4]);
        drawVerticalLine(right, 'rgba(77, 225, 193, 0.55)', [6, 4]);
      }

      if (chartInteraction.hoverPixelX !== null) {
        drawVerticalLine(chartInteraction.hoverPixelX, 'rgba(255, 255, 255, 0.42)', [4, 4]);
      }
    },
  };
}

function handleChartPointerDown(event) {
  const time = getChartPointerTime(event);
  if (time === null) {
    return;
  }

  chartInteraction.selectionStart = time;
  chartInteraction.selectionEnd = time;
  chartInteraction.selectionStartPixelX = getChartPointerPixelX(event);
  chartInteraction.selectionEndPixelX = getChartPointerPixelX(event);
  chartInteraction.selectionActive = true;
  chartInteraction.selectionDragActive = true;
  chartInteraction.dragPointerId = event.pointerId;
  elements.chart.setPointerCapture?.(event.pointerId);
  refreshSelectionInspector();
  state.chart.draw();
}

function handleChartPointerMove(event) {
  const time = getChartPointerTime(event);
  if (time === null) {
    return;
  }

  chartInteraction.hoverTime = time;
  chartInteraction.hoverPixelX = getChartPointerPixelX(event);
  refreshHoverInspector();

  if (chartInteraction.selectionDragActive) {
    chartInteraction.selectionEnd = time;
    chartInteraction.selectionEndPixelX = getChartPointerPixelX(event);
    refreshSelectionInspector();
  }

  state.chart.draw();
}

function handleChartPointerUp(event) {
  if (!chartInteraction.selectionDragActive) {
    return;
  }

  chartInteraction.selectionDragActive = false;
  if (chartInteraction.dragPointerId !== null) {
    elements.chart.releasePointerCapture?.(chartInteraction.dragPointerId);
  }
  chartInteraction.dragPointerId = null;
  chartInteraction.selectionEnd = getChartPointerTime(event) ?? chartInteraction.selectionEnd;
  chartInteraction.selectionEndPixelX = getChartPointerPixelX(event);
  refreshSelectionInspector();
  state.chart.draw();
}

function handleChartPointerLeave() {
  chartInteraction.hoverTime = null;
  chartInteraction.hoverPixelX = null;
  refreshHoverInspector();
  state.chart.draw();
}

function clearSelectionWindow() {
  chartInteraction.selectionStart = null;
  chartInteraction.selectionEnd = null;
  chartInteraction.selectionStartPixelX = null;
  chartInteraction.selectionEndPixelX = null;
  chartInteraction.selectionActive = false;
  chartInteraction.selectionDragActive = false;
  chartInteraction.dragPointerId = null;
  refreshSelectionInspector();
  state.chart.draw();
}

function buildDataset(track, metric, color, shift, origin) {
  const data = track.samples
    .map((sample) => ({
      x: sample.t + shift - origin,
      y: sample[metric.key],
    }))
    .filter((entry) => Number.isFinite(entry.y));

  return {
    label: track.fileName,
    data,
    borderColor: color,
    backgroundColor: color,
    pointRadius: 0,
    borderWidth: 2,
    tension: 0.22,
    parsing: false,
    spanGaps: true,
  };
}

function togglePlayback() {
  if (!state.tracks.some(Boolean)) {
    return;
  }

  state.isPlaying = !state.isPlaying;
  elements.playPause.textContent = state.isPlaying ? '⏸' : '▶';
  state.lastFrame = null;

  if (state.isPlaying) {
    requestAnimationFrame(stepPlayback);
  }
}

function stepPlayback(timestamp) {
  if (!state.isPlaying) {
    return;
  }

  if (state.lastFrame === null) {
    state.lastFrame = timestamp;
  }

  const deltaSeconds = (timestamp - state.lastFrame) / 1000;
  state.lastFrame = timestamp;
  state.currentTime = Math.min(state.duration, state.currentTime + deltaSeconds * state.playbackSpeed);
  updateVisuals();

  if (state.currentTime >= state.duration) {
    state.isPlaying = false;
    elements.playPause.textContent = '▶';
    return;
  }

  requestAnimationFrame(stepPlayback);
}

function resetPlayback() {
  state.isPlaying = false;
  state.currentTime = 0;
  state.lastFrame = null;
  elements.playPause.textContent = '▶';
  updateVisuals();
}

function renderEmptyState() {
  state.duration = Math.max(state.duration, 0);
  elements.progress.max = String(Math.max(state.duration, 0.1));
  elements.progress.value = String(state.currentTime);
  updatePlaybackLabels();
  refreshChart();
  refreshCurrentPointInspector();
  refreshHoverInspector();
  refreshSelectionInspector();
}

function setLoadingState(index, { phase, percent, loading, status, meta }) {
  setStatus(index, status, loading);
  setMeta(index, meta);
  updateProgress(index, percent, phase);
}

function setMeta(index, text) {
  const element = index === 0 ? elements.metaA : elements.metaB;
  element.textContent = text;
}

function updateProgress(index, percent, phase) {
  const bar = index === 0 ? elements.progressBarA : elements.progressBarB;
  const label = index === 0 ? elements.progressLabelA : elements.progressLabelB;
  const value = index === 0 ? elements.progressValueA : elements.progressValueB;
  const track = bar.closest('.file-progress-track');
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));

  track.classList.add('loading');
  bar.style.width = `${safePercent}%`;
  label.textContent = phase;
  value.textContent = `${Math.round(safePercent)} %`;
}

function setStatus(index, label, loading) {
  const element = index === 0 ? elements.statusA : elements.statusB;
  const bar = index === 0 ? elements.progressBarA : elements.progressBarB;
  const track = bar.closest('.file-progress-track');
  element.textContent = label;
  element.style.opacity = loading ? '0.75' : '1';
  track.classList.toggle('loading', loading);
}

function buildTrackSummary(track, fileName) {
  const distance = Number.isFinite(track.distance) ? `${track.distance.toFixed(2)} km` : 'n/a';
  return [
    `${fileName} (${track.source})`,
    `${track.samples.length} Punkte`,
    `Dauer: ${formatDuration(track.duration)}`,
    `Distanz: ${distance}`,
  ].join(' · ');
}

function getActiveMetric() {
  return METRICS.find((entry) => entry.key === state.selectedMetric) || METRICS[0];
}

function getTrackValueAtTime(track, time) {
  if (!track || !track.samples.length) {
    return null;
  }

  const samples = track.samples;
  if (time <= samples[0].t) {
    return samples[0];
  }

  if (time >= samples[samples.length - 1].t) {
    return samples[samples.length - 1];
  }

  let left = 0;
  let right = samples.length - 1;
  while (right - left > 1) {
    const middle = Math.floor((left + right) / 2);
    if (samples[middle].t <= time) {
      left = middle;
    } else {
      right = middle;
    }
  }

  const start = samples[left];
  const end = samples[right];
  const ratio = (time - start.t) / Math.max(end.t - start.t, 0.001);

  return {
    t: time,
    heartRate: interpolateNumeric(start.heartRate, end.heartRate, ratio),
    power: interpolateNumeric(start.power, end.power, ratio),
    speed: interpolateNumeric(start.speed, end.speed, ratio),
    cadence: interpolateNumeric(start.cadence, end.cadence, ratio),
    altitude: interpolateNumeric(start.altitude, end.altitude, ratio),
    lat: interpolateNumeric(start.lat, end.lat, ratio),
    lon: interpolateNumeric(start.lon, end.lon, ratio),
  };
}

function interpolateNumeric(start, end, ratio) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return Number.isFinite(start) ? start : Number.isFinite(end) ? end : null;
  }

  return start + (end - start) * ratio;
}

function formatMetricValue(value, unit) {
  if (!Number.isFinite(value)) {
    return '—';
  }

  const decimals = unit === 'km/h' || unit === 'm' ? 2 : 0;
  return `${value.toFixed(decimals)} ${unit}`;
}

function formatValueRow(label, value, unit, className) {
  return `
    <div class="track-value-row">
      <span class="label">${label}</span>
      <span class="value ${className}">${formatMetricValue(value, unit)}</span>
    </div>
  `;
}

function updateAllMetricRows(container, trackAValue, trackBValue) {
  container.innerHTML = `
    ${formatValueRow('HR', trackAValue?.heartRate, 'bpm', 'value-a')}
    ${formatValueRow('Power', trackAValue?.power, 'W', 'value-a')}
    ${formatValueRow('Geschwindigkeit', trackAValue?.speed, 'km/h', 'value-a')}
    ${formatValueRow('Kadenz', trackAValue?.cadence, 'rpm', 'value-a')}
    ${formatValueRow('Höhe', trackAValue?.altitude, 'm', 'value-a')}
    <div class="track-value-row">
      <span class="label">Track 2</span>
      <span class="value value-b"></span>
    </div>
  `;
}

function averageMetric(track, startTime, endTime, key) {
  if (!track || startTime === null || endTime === null) {
    return null;
  }

  const values = track.samples
    .filter((sample) => sample.t >= startTime && sample.t <= endTime)
    .map((sample) => sample[key])
    .filter((value) => Number.isFinite(value));

  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function updateOffsetDisplay() {
  const formatted = formatOffsetText(Number(elements.offset.value));
  elements.offsetText.value = formatted;
}

function formatOffsetText(seconds) {
  const safeSeconds = Math.round(Number(seconds) || 0);
  const sign = safeSeconds < 0 ? '-' : '';
  const absoluteSeconds = Math.abs(safeSeconds);
  const minutes = Math.floor(absoluteSeconds / 60);
  const secs = String(absoluteSeconds % 60).padStart(2, '0');
  return `${sign}${String(minutes).padStart(2, '0')}:${secs}`;
}

function parseOffsetText(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return null;
  }

  const sign = trimmed.startsWith('-') ? -1 : 1;
  const unsigned = trimmed.replace(/^-/, '');

  if (/^\d+$/.test(unsigned)) {
    return sign * Number(unsigned);
  }

  const parts = unsigned.split(':');
  if (parts.length !== 2) {
    return null;
  }

  const minutes = Number(parts[0]);
  const seconds = Number(parts[1]);
  if (!Number.isInteger(minutes) || !Number.isInteger(seconds) || seconds < 0 || seconds >= 60) {
    return null;
  }

  return sign * ((minutes * 60) + seconds);
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = Math.floor(safeSeconds % 60);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

function setMapLabel(index, label) {
  const element = index === 0 ? elements.mapLabelA : elements.mapLabelB;
  element.textContent = label;
}

function resetMapLabels() {
  setMapLabel(0, 'Datei 1');
  setMapLabel(1, 'Datei 2');
}