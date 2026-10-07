/*
 * FITcomparer
 * Copyright (c) 2026 Tobias Scheipel
 * SPDX-License-Identifier: MIT
 * See the LICENSE file in the project root for the full license text.
 */

import FitParser from 'https://esm.sh/fit-file-parser@3.0.2';
import { unzipSync } from 'https://esm.sh/fflate@0.8.2';
import { initTooltips } from './tooltips.js?v=6';
import {
  ASPECTS,
  AUTO_VIEW,
  QUALITIES,
  bitrateForSize,
  exportVideo,
  frameSize,
  isVideoExportSupported,
  panView,
  renderPreview,
  setViewZoom,
  viewFromLatLngBounds,
  zoomView,
} from './video-export.js?v=6';

const METRICS = [
  { key: 'heartRate', label: 'HR', unit: 'bpm', color: '#ff9f5c' },
  { key: 'power', label: 'Power', unit: 'W', color: '#4de1c1' },
  { key: 'speed', label: 'Geschwindigkeit', unit: 'km/h', color: '#78a6ff' },
  { key: 'distance', label: 'Distanz', unit: 'km', color: '#ffffff' },
  { key: 'cadence', label: 'Kadenz', unit: 'rpm', color: '#f4d35e' },
  { key: 'altitude', label: 'Höhe', unit: 'm', color: '#d6a7ff' },
];

const SPEED_MEDIAN_RADIUS_SECONDS = 5;
const SPEED_AVERAGE_RADIUS_SECONDS = 5;
// Reihenfolge = Spaltenreihenfolge der Dateien. Ab der 7. Datei wird durchrotiert.
const TRACK_COLORS = ['#4de1c1', '#78a6ff', '#ff9f5c', '#f4d35e', '#d6a7ff', '#ff8fa3'];

// Zeilen der Vergleichstabellen. `session` liest den Wert, den das Gerät selbst
// in die FIT-Datei geschrieben hat, `computed` rechnet ihn aus den Messpunkten
// nach. Zeilen mit `window: true` erscheinen auch in den Fenster-Tabellen.
const COMPARISON_ROWS = [
  { label: 'Distanz', unit: 'km', decimals: 2, window: true,
    session: (s) => s.totalDistance,
    computed: (track, start, end) => calculateDistanceCovered(track, start, end) },
  { label: 'Zeit', format: 'duration', window: true,
    session: (s) => s.timerTime,
    computed: (track, start, end) => calculateElapsedTime(track, start, end) },
  { label: 'Verstrichene Zeit', format: 'duration',
    session: (s) => s.elapsedTime },
  { label: 'Stehzeit', format: 'duration', window: true,
    computed: (track, start, end) => calculateStoppedTime(track, start, end) },
  { label: 'Ø Geschwindigkeit', unit: 'km/h', decimals: 1, window: true,
    session: (s) => s.avgSpeed,
    computed: (track, start, end) => calculateAverageSpeed(track, start, end) },
  { label: 'Max. Geschwindigkeit', unit: 'km/h', decimals: 1, window: true,
    session: (s) => s.maxSpeed,
    computed: (track, start, end) => maxMetric(track, start, end, 'speed') },
  { label: 'Ø HF', unit: 'bpm', decimals: 0, window: true,
    session: (s) => s.avgHeartRate,
    computed: (track, start, end) => averageMetric(track, start, end, 'heartRate') },
  { label: 'Max. HF', unit: 'bpm', decimals: 0, window: true,
    session: (s) => s.maxHeartRate,
    computed: (track, start, end) => maxMetric(track, start, end, 'heartRate') },
  { label: 'Ø Power', unit: 'W', decimals: 0, window: true,
    session: (s) => s.avgPower,
    computed: (track, start, end) => averageMetric(track, start, end, 'power') },
  { label: 'Max. Power', unit: 'W', decimals: 0, window: true,
    session: (s) => s.maxPower,
    computed: (track, start, end) => maxMetric(track, start, end, 'power') },
  { label: 'Normalized Power', unit: 'W', decimals: 0, window: true,
    session: (s) => s.normalizedPower,
    computed: (track, start, end) => calculateNormalizedPower(track, start, end) },
  { label: 'Ø Kadenz', unit: 'rpm', decimals: 0, window: true,
    session: (s) => s.avgCadence,
    computed: (track, start, end) => averageMetric(track, start, end, 'cadence', { ignoreZeros: true }) },
  { label: 'Anstieg', unit: 'm', decimals: 0, window: true,
    session: (s) => s.totalAscent,
    computed: (track, start, end) => calculateElevationGain(track, start, end) },
  { label: 'Abstieg', unit: 'm', decimals: 0, window: true,
    session: (s) => s.totalDescent,
    computed: (track, start, end) => calculateElevationLoss(track, start, end) },
  { label: 'Min. Höhe', unit: 'm', decimals: 0, window: true,
    session: (s) => s.minAltitude,
    computed: (track, start, end) => minMetric(track, start, end, 'altitude') },
  { label: 'Max. Höhe', unit: 'm', decimals: 0, window: true,
    session: (s) => s.maxAltitude,
    computed: (track, start, end) => maxMetric(track, start, end, 'altitude') },
  { label: 'Kalorien', unit: 'kcal', decimals: 0, session: (s) => s.totalCalories },
  { label: 'Arbeit', unit: 'kJ', decimals: 0,
    session: (s) => (Number.isFinite(s.totalWork) ? s.totalWork / 1000 : null) },
  { label: 'Training Stress Score', decimals: 1, session: (s) => s.trainingStressScore },
  { label: 'Intensity Factor', decimals: 3, session: (s) => s.intensityFactor },
];

const DEVICE_COMPARISON_ROWS = COMPARISON_ROWS.filter((row) => row.session);
const COMPUTED_COMPARISON_ROWS = COMPARISON_ROWS.filter((row) => row.computed);
const WINDOW_COMPARISON_ROWS = COMPARISON_ROWS.filter((row) => row.window && row.computed);

// Momentanwerte an einem Zeitpunkt -- dieselbe Tabelle, nur ohne Aggregation.
const POINT_ROWS = METRICS.map((metric) => ({
  label: metric.label,
  unit: metric.unit,
  decimals: metric.key === 'distance' ? 2 : metric.key === 'speed' ? 1 : 0,
  key: metric.key,
}));

const ALTITUDE_SMOOTHING_RADIUS_SECONDS = 5;
const METRIC_CACHE_LIMIT = 500;
const STOPPED_SPEED_THRESHOLD_KMH = 1;

const MIN_SLOTS = 2;
const MAX_SLOTS = TRACK_COLORS.length;
let nextSlotId = 1;

// Diese Konstanten muessen vor dem init()-Aufruf stehen: init() laeuft beim Laden
// des Moduls und liest sie sofort. Weiter unten deklariert waeren sie dann noch in
// der Temporal Dead Zone.
const MAP_MIN_HEIGHT = 240;
const MAP_KEY_STEP = 40;

// Stufen des Wiedergabefaktors im Video. Vorbelegt wird die kleinste, bei der das
// Video hoechstens zehn Minuten dauert.
const VIDEO_SPEED_STEPS = [10, 20, 60, 100, 200, 500, 1000];
const VIDEO_FPS = 30;
const VIDEO_TARGET_SECONDS = 600;
const VIDEO_WARN_BYTES = 400e6;
const VIDEO_MAX_BYTES = 1.5e9;

const videoExportState = {
  controller: null,
  view: AUTO_VIEW,
  viewport: null,
  previewController: null,
  previewFrame: 0,
  previewTimer: 0,
  pointers: new Map(),
};

const VIDEO_PREVIEW_SHORT_SIDE = 360;

const state = {
  slots: [],
  selectedMetric: 'speed',
  isPlaying: false,
  playbackSpeed: 1,
  currentTime: 0,
  duration: 0,
  lastFrame: null,
  map: null,
  chart: null,
  // Pro Slot liegen die Layer am Slot selbst; global bleiben nur die beiden
  // Marker des Distanzfensters, die zu keiner einzelnen Datei gehoeren.
  layers: {
    distanceStartMarker: null,
    distanceEndMarker: null,
  },
};

const elements = {
  fileCards: document.getElementById('fileCards'),
  addFile: document.getElementById('addFile'),
  fileCardTemplate: document.getElementById('fileCardTemplate'),
  legendItemTemplate: document.getElementById('legendItemTemplate'),
  selectionRowTemplate: document.getElementById('selectionRowTemplate'),
  distanceRowTemplate: document.getElementById('distanceRowTemplate'),
  mapLegend: document.getElementById('mapLegend'),
  mapFrame: document.getElementById('mapFrame'),
  exportVideoButton: document.getElementById('exportVideo'),
  videoDialog: document.getElementById('videoDialog'),
  videoForm: document.getElementById('videoForm'),
  videoSpeed: document.getElementById('videoSpeed'),
  videoAspect: document.getElementById('videoAspect'),
  videoQuality: document.getElementById('videoQuality'),
  videoPreview: document.getElementById('videoPreview'),
  videoZoom: document.getElementById('videoZoom'),
  videoViewAuto: document.getElementById('videoViewAuto'),
  videoViewMap: document.getElementById('videoViewMap'),
  videoEstimate: document.getElementById('videoEstimate'),
  videoProgress: document.getElementById('videoProgress'),
  videoProgressTrack: document.getElementById('videoProgressTrack'),
  videoProgressBar: document.getElementById('videoProgressBar'),
  videoStatus: document.getElementById('videoStatus'),
  videoCancel: document.getElementById('videoCancel'),
  videoStart: document.getElementById('videoStart'),
  mapResizeHandle: document.getElementById('mapResizeHandle'),
  selectionDistanceRows: document.getElementById('selectionDistanceRows'),
  distanceWindowRows: document.getElementById('distanceWindowRows'),
  playPause: document.getElementById('playPause'),
  resetPlayback: document.getElementById('resetPlayback'),
  speed: document.getElementById('speed'),
  progress: document.getElementById('progress'),
  currentTimeInput: document.getElementById('currentTimeInput'),
  skipBack60: document.getElementById('skipBack60'),
  skipBack10: document.getElementById('skipBack10'),
  skipForward10: document.getElementById('skipForward10'),
  skipForward60: document.getElementById('skipForward60'),
  durationLabel: document.getElementById('durationLabel'),
  metricSwitcher: document.getElementById('metricSwitcher'),
  comparisonPanel: document.getElementById('comparisonPanel'),
  deviceComparison: document.getElementById('deviceComparison'),
  deviceComparisonValues: document.getElementById('deviceComparisonValues'),
  computedComparisonValues: document.getElementById('computedComparisonValues'),
  chart: document.getElementById('chart'),
  currentPointTime: document.getElementById('currentPointTime'),
  currentPointValues: document.getElementById('currentPointValues'),
  hoverPointTime: document.getElementById('hoverPointTime'),
  hoverPointValues: document.getElementById('hoverPointValues'),
  selectionPanel: document.getElementById('selectionPanel'),
  selectionRange: document.getElementById('selectionRange'),
  selectionValues: document.getElementById('selectionValues'),
  selectionClose: document.getElementById('selectionClose'),
  selectionTimeStart: document.getElementById('selectionTimeStart'),
  selectionTimeEnd: document.getElementById('selectionTimeEnd'),
  distanceSelectionPanel: document.getElementById('distanceSelectionPanel'),
  distanceSelectionRange: document.getElementById('distanceSelectionRange'),
  distanceSelectionValues: document.getElementById('distanceSelectionValues'),
  distanceSelectionClose: document.getElementById('distanceSelectionClose'),
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

// Die Fenstergrenzen je Datei haengen am Slot (slot.distanceRange).
const distanceInteraction = {
  clicks: [],
};

init();

function init() {
  initTooltips();
  createMetricButtons();
  initMap();
  initChart();
  bindEvents();
  bindSelectionEditorEvents();
  initVideoExport();

  for (let index = 0; index < MIN_SLOTS; index++) {
    addSlot({ refresh: false });
  }

  syncSlotChrome();
  renderEmptyState();
}

function getSlotIndex(slot) {
  return state.slots.indexOf(slot);
}

function getSlotColor(slot) {
  return slot.color;
}

// Erste Palettenfarbe, die noch kein Slot traegt.
function pickFreeColor() {
  const used = new Set(state.slots.map((slot) => slot.color));
  return TRACK_COLORS.find((color) => !used.has(color))
    ?? TRACK_COLORS[state.slots.length % TRACK_COLORS.length];
}

function getLoadedSlots() {
  return state.slots.filter((slot) => slot.track);
}

function getSlotDisplayName(slot) {
  return slot.track?.displayName?.trim() || slot.track?.fileName || `Datei ${getSlotIndex(slot) + 1}`;
}

// Slot 0 ist der Zeitbezug und bleibt bei 0. Ein negativer Offset zieht den
// gemeinsamen Nullpunkt nach vorne, damit nichts links aus der Achse faellt.
function getTimelineOrigin() {
  return Math.min(0, ...state.slots.map((slot) => slot.offsetSeconds));
}

function getSlotTime(slot, overallTime) {
  return overallTime + getTimelineOrigin() - slot.offsetSeconds;
}

function addSlot({ refresh = true } = {}) {
  if (state.slots.length >= MAX_SLOTS) {
    return null;
  }

  const slot = {
    id: nextSlotId++,
    track: null,
    color: pickFreeColor(),
    offsetSeconds: 0,
    distanceRange: null,
    layers: { polyline: null, marker: null, hoverMarker: null, distanceSegment: null },
    el: {},
  };

  state.slots.push(slot);
  buildSlotCard(slot);

  if (refresh) {
    syncSlotChrome();
    recomputeTimeline();
  }

  return slot;
}

function applySlotColor(slot, color) {
  slot.color = color;
  slot.el.card.style.setProperty('--slot-color', color);
  slot.el.legendDot.style.background = color;
  for (const label of [slot.el.selectionLabel, slot.el.distanceLabel]) {
    label.style.color = color;
  }

  for (const layer of [slot.layers.polyline, slot.layers.marker, slot.layers.distanceSegment]) {
    layer?.setStyle({ color });
  }

  const dataset = state.chart.data.datasets.find((entry) => entry.slotId === slot.id);
  if (dataset) {
    dataset.borderColor = color;
    dataset.backgroundColor = color;
    state.chart.update('none');
  }

  // Spaltenkoepfe aller Tabellen.
  refreshActivityComparison();
  refreshCurrentPointInspector();
  refreshHoverInspector();
  refreshSelectionInspector();
  refreshDistanceSelectionInspector();
}

function removeSlot(slot) {
  if (state.slots.length <= MIN_SLOTS) {
    return;
  }

  for (const name of Object.keys(slot.layers)) {
    clearSlotLayer(slot, name);
  }

  for (const node of [slot.el.card, slot.el.legend, slot.el.selectionRow, slot.el.distanceRow]) {
    node.remove();
  }

  state.slots.splice(getSlotIndex(slot), 1);
  clearDistanceSelectionWindow();
  syncSlotChrome();
  recomputeTimeline();
  fitMapBounds();
}

function buildSlotCard(slot) {
  const pick = (root, role) => root.querySelector(`[data-role="${role}"]`);
  const clone = (template) => template.content.firstElementChild.cloneNode(true);

  slot.el.card = clone(elements.fileCardTemplate);
  for (const role of ['kicker', 'name', 'status', 'color', 'remove', 'file', 'progressBar', 'progressLabel',
    'progressValue', 'offsetGroup', 'offsetLabel', 'offsetRange', 'offsetText', 'meta']) {
    slot.el[role] = pick(slot.el.card, role);
  }
  // Auf Touch-Geraeten (Android/iOS) graut das System-Auswahlfenster Dateien mit
  // unbekannter Endung wie .fit aus, sobald ein accept-Filter gesetzt ist. Dort
  // lassen wir ihn weg; die Dateityp-Pruefung macht parseFitnessFile ohnehin.
  if (window.matchMedia('(pointer: coarse)').matches) {
    slot.el.file.removeAttribute('accept');
  }
  elements.fileCards.appendChild(slot.el.card);

  slot.el.legend = clone(elements.legendItemTemplate);
  slot.el.legendDot = pick(slot.el.legend, 'dot');
  slot.el.legendLabel = pick(slot.el.legend, 'label');
  elements.mapLegend.appendChild(slot.el.legend);

  slot.el.selectionRow = clone(elements.selectionRowTemplate);
  slot.el.selectionLabel = pick(slot.el.selectionRow, 'label');
  slot.el.selectionStart = pick(slot.el.selectionRow, 'start');
  slot.el.selectionEnd = pick(slot.el.selectionRow, 'end');
  elements.selectionDistanceRows.appendChild(slot.el.selectionRow);

  slot.el.distanceRow = clone(elements.distanceRowTemplate);
  slot.el.distanceLabel = pick(slot.el.distanceRow, 'label');
  slot.el.distanceStart = pick(slot.el.distanceRow, 'start');
  slot.el.distanceEnd = pick(slot.el.distanceRow, 'end');
  elements.distanceWindowRows.appendChild(slot.el.distanceRow);

  bindSlotEvents(slot);
}

function bindSlotEvents(slot) {
  slot.el.file.addEventListener('change', () => handleFileSelection(slot));
  slot.el.remove.addEventListener('click', () => removeSlot(slot));
  slot.el.color.addEventListener('input', () => applySlotColor(slot, slot.el.color.value));
  bindTrackNameEditor(slot);

  slot.el.offsetRange.addEventListener('input', () => {
    slot.offsetSeconds = Number(slot.el.offsetRange.value);
    updateOffsetDisplay(slot);
    recomputeTimeline();
  });
  slot.el.offsetText.addEventListener('change', () => {
    const parsed = parseOffsetText(slot.el.offsetText.value);
    if (parsed === null) {
      updateOffsetDisplay(slot);
      return;
    }

    slot.offsetSeconds = parsed;
    slot.el.offsetRange.value = String(parsed);
    updateOffsetDisplay(slot);
    recomputeTimeline();
  });
  slot.el.offsetText.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      slot.el.offsetText.blur();
    }
  });

  for (const [input, boundary] of [[slot.el.selectionStart, 'start'], [slot.el.selectionEnd, 'end']]) {
    input.addEventListener('change', () => applySelectionDistanceValue(slot, input, boundary));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        input.blur();
      }
    });
  }
}

// Alles, was von Anzahl und Reihenfolge der Slots abhängt: Nummerierung, Farben,
// Entfernen-Buttons, Offset-Sichtbarkeit und sämtliche Beschriftungen.
function syncSlotChrome() {
  const removable = state.slots.length > MIN_SLOTS;

  state.slots.forEach((slot, index) => {
    const color = slot.color;
    const name = getSlotDisplayName(slot);

    slot.el.card.style.setProperty('--slot-color', color);
    slot.el.color.value = color;
    slot.el.kicker.textContent = `Datei ${index + 1}`;
    slot.el.remove.disabled = !removable;
    slot.el.remove.title = removable ? 'Datei entfernen' : `Mindestens ${MIN_SLOTS} Dateien`;

    slot.el.offsetGroup.classList.toggle('hidden', index === 0);
    slot.el.offsetLabel.textContent = `Start-Offset ${name}`;

    slot.el.legendDot.style.background = color;
    slot.el.legendLabel.textContent = name;

    for (const element of [slot.el.selectionLabel, slot.el.distanceLabel]) {
      element.textContent = `${name} (km)`;
      element.style.color = color;
    }
  });

  elements.addFile.disabled = state.slots.length >= MAX_SLOTS;
  refreshActivityComparison();
  updateVideoButton();
}

function bindEvents() {
  elements.addFile.addEventListener('click', () => addSlot());
  elements.playPause.addEventListener('click', togglePlayback);
  elements.resetPlayback.addEventListener('click', resetPlayback);
  elements.speed.addEventListener('change', () => {
    state.playbackSpeed = Number(elements.speed.value);
  });
  elements.progress.addEventListener('input', () => {
    state.currentTime = Number(elements.progress.value);
    state.isPlaying = false;
    elements.playPause.textContent = '\u25b6';
    updateVisuals();
  });
  for (const [button, delta] of [
    [elements.skipBack60, -60],
    [elements.skipBack10, -10],
    [elements.skipForward10, 10],
    [elements.skipForward60, 60],
  ]) {
    button.addEventListener('click', () => seekTo(state.currentTime + delta));
  }

  elements.currentTimeInput.addEventListener('change', () => {
    const parsed = parseDurationText(elements.currentTimeInput.value);
    if (parsed === null) {
      updatePlaybackLabels();
      return;
    }

    seekTo(parsed);
  });
  elements.currentTimeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      elements.currentTimeInput.blur();
    }
  });

  elements.selectionClose.addEventListener('click', clearSelectionWindow);
  elements.distanceSelectionClose.addEventListener('click', clearDistanceSelectionWindow);
}

function bindTrackNameEditor(slot) {
  const input = slot.el.name;
  input.addEventListener('input', () => updateTrackDisplayName(slot, input.value));
  input.addEventListener('change', () => {
    if (!input.value.trim()) {
      input.value = slot.track?.fileName ?? `Datei ${getSlotIndex(slot) + 1}`;
      updateTrackDisplayName(slot, input.value);
    }
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      input.blur();
    }
  });
}

function bindSelectionEditorEvents() {
  for (const [input, boundary] of [[elements.selectionTimeStart, 'start'], [elements.selectionTimeEnd, 'end']]) {
    input.addEventListener('change', () => applySelectionTimeValue(input, boundary));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        input.blur();
      }
    });
  }
}

// ------------------------------ Video-Export ------------------------------

function initVideoExport() {
  elements.videoSpeed.innerHTML = VIDEO_SPEED_STEPS
    .map((step) => `<option value="${step}">${step}\u00d7</option>`)
    .join('');
  elements.videoAspect.innerHTML = ASPECTS
    .map((aspect) => `<option value="${aspect.id}">${aspect.label}</option>`)
    .join('');
  elements.videoQuality.innerHTML = QUALITIES
    .map((quality) => `<option value="${quality.id}">${quality.label}</option>`)
    .join('');
  elements.videoAspect.value = '16:9';
  elements.videoQuality.value = '720';
  refreshQualityLabels();

  elements.exportVideoButton.addEventListener('click', openVideoDialog);
  elements.videoSpeed.addEventListener('change', updateVideoEstimate);
  elements.videoAspect.addEventListener('change', () => {
    refreshQualityLabels();
    updateVideoEstimate();
    resizeVideoPreview();
    scheduleVideoPreview();
  });
  elements.videoQuality.addEventListener('change', updateVideoEstimate);
  elements.videoForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runVideoExport();
  });
  elements.videoCancel.addEventListener('click', () => {
    if (videoExportState.controller) {
      videoExportState.controller.abort();
    } else {
      closeVideoDialog();
    }
  });
  // Esc darf einen laufenden Export abbrechen, aber nicht still den Dialog schliessen.
  elements.videoDialog.addEventListener('cancel', (event) => {
    if (videoExportState.controller) {
      event.preventDefault();
      videoExportState.controller.abort();
    }
  });
  elements.videoDialog.addEventListener('close', () => {
    videoExportState.previewController?.abort();
  });

  bindVideoPreviewEvents();

  elements.videoViewAuto.addEventListener('click', () => {
    videoExportState.view = AUTO_VIEW;
    scheduleVideoPreview(true);
  });
  elements.videoViewMap.addEventListener('click', () => {
    const bounds = state.map.getBounds();
    const { width, height } = elements.videoPreview;
    videoExportState.view = viewFromLatLngBounds(
      { north: bounds.getNorth(), south: bounds.getSouth(), west: bounds.getWest(), east: bounds.getEast() },
      buildVideoTracks(),
      width,
      height
    );
    scheduleVideoPreview(true);
  });
  elements.videoZoom.addEventListener('input', () => {
    if (!videoExportState.viewport) {
      return;
    }
    videoExportState.view = setViewZoom(videoExportState.viewport, 2 ** Number(elements.videoZoom.value));
    scheduleVideoPreview();
  });

  updateVideoButton();
}

function closeVideoDialog() {
  elements.videoDialog.close();
}

// Pan per Ziehen, Zoom per Mausrad und per Zwei-Finger-Geste.
function bindVideoPreviewEvents() {
  const canvas = elements.videoPreview;
  const pointers = videoExportState.pointers;

  // Zeigerkoordinaten in Pixel der Zeichenflaeche umrechnen: das Canvas wird per CSS
  // skaliert, seine interne Aufloesung ist eine andere.
  const toCanvas = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * canvas.width) / rect.width,
      y: ((event.clientY - rect.top) * canvas.height) / rect.height,
    };
  };
  const pinchDistance = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  canvas.addEventListener('pointerdown', (event) => {
    if (videoExportState.controller) {
      return;
    }
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // bewusst ignoriert
    }
    pointers.set(event.pointerId, toCanvas(event));
    canvas.classList.add('dragging');
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId) || !videoExportState.viewport) {
      return;
    }

    const previous = pointers.get(event.pointerId);
    const current = toCanvas(event);

    if (pointers.size === 1) {
      videoExportState.view = panView(videoExportState.viewport, current.x - previous.x, current.y - previous.y);
    } else if (pointers.size === 2) {
      const before = pinchDistance();
      pointers.set(event.pointerId, current);
      const after = pinchDistance();
      const [a, b] = [...pointers.values()];
      if (before > 0) {
        videoExportState.view = zoomView(videoExportState.viewport, after / before, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
    }

    pointers.set(event.pointerId, current);
    scheduleVideoPreview();
  });

  const release = (event) => {
    pointers.delete(event.pointerId);
    if (!pointers.size) {
      canvas.classList.remove('dragging');
      // Erst jetzt fehlende Kacheln nachladen; waehrend des Ziehens nur Cache.
      scheduleVideoPreview(true);
    }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  canvas.addEventListener('wheel', (event) => {
    if (videoExportState.controller || !videoExportState.viewport) {
      return;
    }
    event.preventDefault();
    const point = toCanvas(event);
    videoExportState.view = zoomView(videoExportState.viewport, Math.exp(-event.deltaY * 0.0015), point.x, point.y);
    scheduleVideoPreview();
  }, { passive: false });
}

function updateVideoButton() {
  const hasPositions = getLoadedSlots().some((slot) => slot.track.mapSamples.length);
  let reason = '';
  if (!isVideoExportSupported()) {
    reason = 'Der Videoexport braucht WebCodecs (aktuelles Chrome oder Edge).';
  } else if (!hasPositions) {
    reason = 'Zuerst eine Datei mit GPS-Daten laden.';
  }

  elements.exportVideoButton.disabled = Boolean(reason);
  elements.exportVideoButton.title = reason;
}

function buildVideoTracks() {
  return getLoadedSlots()
    .filter((slot) => slot.track.mapSamples.length)
    .map((slot) => ({
      name: getSlotDisplayName(slot),
      color: slot.color,
      mapSamples: slot.track.mapSamples,
      // Gleiche Zeitabbildung wie die Karte: Offsets pro Datei, und vor Start bzw.
      // nach Ende bleibt der Marker am ersten bzw. letzten Punkt stehen.
      positionAt: (overallTime) =>
        interpolatePosition(slot.track.mapSamples, getSlotTime(slot, overallTime)),
    }));
}

function openVideoDialog() {
  state.isPlaying = false;
  state.lastFrame = null;
  elements.playPause.textContent = '\u25b6';

  const preselected = VIDEO_SPEED_STEPS.find((step) => state.duration / step <= VIDEO_TARGET_SECONDS)
    ?? VIDEO_SPEED_STEPS.at(-1);
  elements.videoSpeed.value = String(preselected);

  elements.videoProgress.classList.add('hidden');
  elements.videoStatus.textContent = '';
  elements.videoCancel.textContent = 'Schlie\u00dfen';
  videoExportState.view = AUTO_VIEW;
  videoExportState.viewport = null;
  updateVideoEstimate();
  resizeVideoPreview();
  elements.videoDialog.showModal();
  scheduleVideoPreview(true);
}

function readVideoSettings() {
  const quality = QUALITIES.find((entry) => entry.id === elements.videoQuality.value) ?? QUALITIES[1];
  const { width, height } = frameSize(elements.videoAspect.value, quality.shortSide);
  return { speed: Number(elements.videoSpeed.value), width, height };
}

// Hinter jeder Aufloesungsstufe steht die daraus folgende Bildgroesse.
function refreshQualityLabels() {
  for (const option of elements.videoQuality.options) {
    const quality = QUALITIES.find((entry) => entry.id === option.value);
    const { width, height } = frameSize(elements.videoAspect.value, quality.shortSide);
    option.textContent = `${quality.label} (${width} \u00d7 ${height})`;
  }
}

// Die Vorschau hat dasselbe Seitenverhaeltnis wie das Video, aber immer nur 360 px
// kurze Seite: so zeigt sie denselben Ausschnitt, ohne beim Ziehen zu ruckeln.
function resizeVideoPreview() {
  const { width, height } = frameSize(elements.videoAspect.value, VIDEO_PREVIEW_SHORT_SIDE);
  elements.videoPreview.width = width;
  elements.videoPreview.height = height;
  elements.videoPreview.style.aspectRatio = `${width} / ${height}`;
}

// Zeichnet hoechstens einmal je Bild neu. withTiles=true laedt zusaetzlich fehlende
// Kacheln nach, aber erst nach einer kurzen Ruhepause, damit beim Ziehen und Zoomen
// nicht fuer jeden Zwischenschritt Kacheln angefragt werden.
function scheduleVideoPreview(withTiles = false) {
  if (!elements.videoDialog.open) {
    return;
  }

  cancelAnimationFrame(videoExportState.previewFrame);
  clearTimeout(videoExportState.previewTimer);
  videoExportState.previewFrame = requestAnimationFrame(() => {
    paintVideoPreview(false);
    // Das Nachladen der Kacheln wird erst hier eingeplant: ein sofortiger Aufruf
    // wuerde sonst vom Neuzeichnen gleich darueber wieder abgebrochen.
    videoExportState.previewTimer = setTimeout(() => paintVideoPreview(true), withTiles ? 0 : 250);
  });
}

async function paintVideoPreview(loadMissing) {
  videoExportState.previewController?.abort();
  const controller = new AbortController();
  videoExportState.previewController = controller;

  try {
    const result = await renderPreview(elements.videoPreview, {
      tracks: buildVideoTracks(),
      view: videoExportState.view,
      time: state.currentTime,
      loadMissing,
      signal: controller.signal,
    });
    if (result && !controller.signal.aborted) {
      videoExportState.viewport = result.viewport;
      elements.videoZoom.value = String(Math.log2(result.viewport.scale / result.viewport.fit));
    }
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.error(error);
    }
  }
}

function updateVideoEstimate() {
  const { speed, width, height } = readVideoSettings();
  const seconds = state.duration / speed;
  const bytes = (bitrateForSize(width, height) * seconds) / 8;
  const frames = Math.ceil(seconds * VIDEO_FPS);

  let text = `Video: ${formatDuration(seconds)} \u00b7 ${frames.toLocaleString('de-DE')} Bilder \u00b7 bis ca. ${formatBytes(bytes)}`;
  const tooBig = bytes > VIDEO_MAX_BYTES;
  if (tooBig) {
    text += ' \u2013 zu gro\u00df f\u00fcr den Arbeitsspeicher, bitte eine h\u00f6here Geschwindigkeit w\u00e4hlen.';
  } else if (bytes > VIDEO_WARN_BYTES) {
    text += ' \u2013 sehr gro\u00df, eine h\u00f6here Geschwindigkeit ist ratsam.';
  }

  elements.videoEstimate.textContent = text;
  elements.videoEstimate.classList.toggle('warn', bytes > VIDEO_WARN_BYTES);
  elements.videoStart.disabled = tooBig || !Number.isFinite(seconds) || seconds <= 0;
}

function setVideoProgress(ratio, text) {
  elements.videoProgress.classList.remove('hidden');
  elements.videoProgressBar.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  elements.videoStatus.textContent = text;
}

function setVideoBusy(busy) {
  for (const control of [
    elements.videoSpeed,
    elements.videoAspect,
    elements.videoQuality,
    elements.videoZoom,
    elements.videoViewAuto,
    elements.videoViewMap,
    elements.videoStart,
  ]) {
    control.disabled = busy;
  }
  elements.videoPreview.classList.toggle('locked', busy);
  elements.videoProgressTrack.classList.toggle('loading', busy);
  elements.videoCancel.textContent = busy ? 'Abbrechen' : 'Schlie\u00dfen';
  if (!busy) {
    updateVideoEstimate();
  }
}

async function runVideoExport() {
  const { speed, width, height } = readVideoSettings();
  const slots = getLoadedSlots().filter((slot) => slot.track.mapSamples.length);
  const tracks = buildVideoTracks();

  videoExportState.previewController?.abort();
  clearTimeout(videoExportState.previewTimer);
  const controller = new AbortController();
  videoExportState.controller = controller;
  setVideoBusy(true);
  setVideoProgress(0, 'Starte \u2026');

  try {
    const result = await exportVideo({
      tracks,
      duration: state.duration,
      speed,
      width,
      height,
      fps: VIDEO_FPS,
      view: videoExportState.view,
      signal: controller.signal,
      onProgress: ({ phase, ratio, text }) => {
        const mapped = phase === 'tiles' ? ratio * 0.1 : phase === 'render' ? 0.1 + ratio * 0.88 : 1;
        setVideoProgress(mapped, text);
      },
    });

    downloadBlob(result.blob, buildVideoFileName(slots, width, height));
    const notes = [`Fertig: ${result.codec}, ${width} \u00d7 ${height}, ${result.frameCount.toLocaleString('de-DE')} Bilder, ${formatBytes(result.blob.size)}.`];
    if (result.tilesFailed) {
      notes.push(`${result.tilesFailed} von ${result.tilesTotal} Kacheln konnten nicht geladen werden, der Hintergrund ist dort leer.`);
    }
    setVideoProgress(1, notes.join(' '));
  } catch (error) {
    if (error?.name === 'AbortError') {
      setVideoProgress(0, 'Abgebrochen \u2013 es wurde keine Datei gespeichert.');
    } else {
      console.error(error);
      setVideoProgress(0, `Export fehlgeschlagen: ${error.message}`);
    }
  } finally {
    videoExportState.controller = null;
    setVideoBusy(false);
    scheduleVideoPreview(true);
  }
}

function buildVideoFileName(slots, width, height) {
  const base = slots
    .map((slot) => getSlotDisplayName(slot).replace(/\.[^.]+$/, ''))
    .join('_vs_')
    .replace(/[^\w\-\u00c4\u00d6\u00dc\u00e4\u00f6\u00fc\u00df.]+/g, '_')
    .slice(0, 70);
  return `${base || 'aktivitaet'}_${width}x${height}.mp4`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function formatBytes(bytes) {
  if (bytes >= 1e9) {
    return `${(bytes / 1e9).toFixed(1).replace('.', ',')} GB`;
  }
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
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
  state.map = L.map('map', { preferCanvas: true }).setView([47.0707, 15.4395], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap-Mitwirkende',
    maxZoom: 19,
  }).addTo(state.map);
  state.map.on('click', handleMapDistanceSelectionClick);
  initMapResize();
}


// Die Karte waechst nur in der Hoehe; die Breite folgt dem Layout. Leaflet merkt
// eine geaenderte Containergroesse nicht von selbst -- der ResizeObserver ruft
// invalidateSize auf und deckt damit auch das Fenster-Resize mit ab.
function initMapResize() {
  const frame = elements.mapFrame;
  const handle = elements.mapResizeHandle;
  const clampHeight = (height) =>
    Math.max(MAP_MIN_HEIGHT, Math.min(window.innerHeight * 0.9, height));

  let dragStartY = null;
  let dragStartHeight = 0;

  handle.addEventListener('pointerdown', (event) => {
    dragStartY = event.clientY;
    dragStartHeight = frame.getBoundingClientRect().height;
    // Schlaegt die Erfassung fehl (Zeiger schon weg), zieht der Griff trotzdem weiter,
    // nur ohne dass Bewegungen ausserhalb von ihm ankommen.
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // bewusst ignoriert
    }
    handle.classList.add('dragging');
    event.preventDefault();
  });
  handle.addEventListener('pointermove', (event) => {
    if (dragStartY === null) {
      return;
    }
    frame.style.height = `${clampHeight(dragStartHeight + event.clientY - dragStartY)}px`;
  });
  const endDrag = () => {
    dragStartY = null;
    handle.classList.remove('dragging');
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  // Auch per Tastatur erreichbar.
  handle.addEventListener('keydown', (event) => {
    const direction = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (!direction) {
      return;
    }
    frame.style.height = `${clampHeight(frame.getBoundingClientRect().height + direction * MAP_KEY_STEP)}px`;
    event.preventDefault();
  });

  let pending = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => state.map.invalidateSize());
  }).observe(frame);
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

async function handleFileSelection(slot) {
  const file = slot.el.file.files?.[0];
  if (!file) {
    return;
  }

  setLoadingState(slot, {
    phase: 'Lese Datei',
    percent: 5,
    loading: true,
    status: 'L\u00e4dt ...',
    meta: `${file.name} wird gelesen ...`,
  });

  try {
    const buffer = await readFileWithProgress(file, slot);
    setLoadingState(slot, {
      phase: 'Analysiere Datei',
      percent: 90,
      loading: true,
      status: 'Verarbeite ...',
      meta: `${file.name} wird analysiert ...`,
    });

    const track = await parseFitnessFile(buffer, file);
    slot.track = track;
    track.displayName = track.fileName;
    slot.el.name.value = track.displayName;
    slot.el.name.classList.remove('hidden');
    clearDistanceSelectionWindow();
    syncSlotChrome();
    setLoadingState(slot, {
      phase: 'Fertig',
      percent: 100,
      loading: false,
      status: 'Geladen',
      meta: buildTrackSummary(track, track.fileName),
    });
    recomputeTimeline();
    fitMapBounds();
  } catch (error) {
    console.error(error);
    slot.track = null;
    slot.el.name.value = '';
    slot.el.name.classList.add('hidden');
    syncSlotChrome();
    setLoadingState(slot, {
      phase: 'Fehler',
      percent: 0,
      loading: false,
      status: 'Fehler',
      meta: `Datei konnte nicht geladen werden: ${error.message}`,
    });
    renderEmptyState();
  }
}

function readFileWithProgress(file, slot) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    updateProgress(slot, 5, 'Lese Datei');

    reader.onprogress = (event) => {
      if (!event.lengthComputable) {
        return;
      }

      const percent = Math.min(85, Math.max(10, Math.round((event.loaded / event.total) * 80)));
      updateProgress(slot, percent, 'Lese Datei');
    };

    reader.onload = () => {
      updateProgress(slot, 90, 'Daten geladen');
      resolve(reader.result);
    };

    reader.onerror = () => {
      reject(reader.error || new Error('Datei konnte nicht gelesen werden.'));
    };

    reader.readAsArrayBuffer(file);
  });
}

async function parseFitnessFile(buffer, file) {
  // Erkannt wird am Inhalt, nicht an der Endung: Browser und Umbenennen lassen
  // beides auseinanderlaufen.
  if (isZipBuffer(buffer)) {
    const { name, data } = extractActivityFromZip(buffer);
    const exact = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    return parseActivityBuffer(exact, name);
  }

  return parseActivityBuffer(buffer, file.name);
}

function parseActivityBuffer(buffer, fileName) {
  const extension = fileName.split('.').pop()?.toLowerCase();

  if (extension === 'gpx') {
    return parseGpx(buffer, fileName);
  }

  if (extension === 'fit') {
    return parseFit(buffer, fileName);
  }

  throw new Error('Nur FIT, GPX und ZIP mit einer Aktivität werden unterstützt.');
}

function isZipBuffer(buffer) {
  if (buffer.byteLength < 4) {
    return false;
  }

  const [a, b, c, d] = new Uint8Array(buffer, 0, 4);
  return a === 0x50 && b === 0x4b && c === 0x03 && d === 0x04;
}

// Unterstuetzt wird das Garmin-"Original exportieren"-ZIP mit genau einer
// Aktivitaetsdatei. Der filter sorgt dafuer, dass nur diese eine dekomprimiert
// wird und nicht der ganze Archivinhalt.
function extractActivityFromZip(buffer) {
  const seenNames = [];
  let entries;
  try {
    entries = unzipSync(new Uint8Array(buffer), {
      filter: (entry) => {
        seenNames.push(entry.name);
        const isMacJunk = /(^|\/)(__MACOSX\/|\._)/.test(entry.name);
        return !isMacJunk && /\.(fit|gpx)$/i.test(entry.name);
      },
    });
  } catch (error) {
    throw new Error(`ZIP konnte nicht entpackt werden: ${error.message}`);
  }

  const names = Object.keys(entries);
  if (!names.length) {
    if (seenNames.some((name) => /\.zip$/i.test(name))) {
      throw new Error('Das ZIP enthält weitere ZIP-Archive und sieht nach dem Komplett-Export aus. Bitte eine einzelne Aktivität über „Original exportieren“ laden oder die .fit-Datei entpacken.');
    }
    throw new Error('Im ZIP wurde keine .fit- oder .gpx-Datei gefunden.');
  }

  if (names.length > 1) {
    throw new Error(`Das ZIP enthält ${names.length} Aktivitäten. Bitte eine einzelne Aktivität über „Original exportieren“ laden oder die gewünschte Datei entpacken.`);
  }

  const [entryName] = names;
  return { name: entryName.split('/').pop(), data: entries[entryName] };
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
    speedUnit: 'km/h',
    lengthUnit: 'km',
    temperatureUnit: '°C',
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

  return createTrack(normalized, normalized.filter(hasCoordinates), fileName, 'FIT', readFitSession(parsed));
}

function normalizeSamples(rawSamples, keepAbsoluteTime = false) {
  if (!rawSamples.length) {
    return [];
  }

  const sorted = [...rawSamples].sort((a, b) => a.t - b.t);
  const firstTime = sorted[0].t.getTime();
  let cumulativeDistance = 0;

  const normalized = sorted.map((sample, index) => {
    const seconds = keepAbsoluteTime ? (sample.t.getTime() - firstTime) / 1000 : sample.t;
    const hasCurrentCoordinates = hasCoordinates(sample);
    const hasPreviousCoordinates = index > 0 && hasCoordinates(sorted[index - 1]);
    let deltaDistance = null;

    if (index > 0) {
      const previousSample = sorted[index - 1];
      if (Number.isFinite(previousSample.distance) && Number.isFinite(sample.distance)) {
        const recordedDelta = sample.distance - previousSample.distance;
        if (recordedDelta >= 0) {
          deltaDistance = recordedDelta;
        }
      }

      if (!Number.isFinite(deltaDistance) && hasPreviousCoordinates && hasCurrentCoordinates) {
        deltaDistance = haversineKm(previousSample.lat, previousSample.lon, sample.lat, sample.lon);
      }

      if (Number.isFinite(deltaDistance)) {
        cumulativeDistance += deltaDistance;
      }
    }

    let speed = null;
    if (index > 0 && Number.isFinite(deltaDistance)) {
      const deltaSeconds = (sorted[index].t.getTime() - sorted[index - 1].t.getTime()) / 1000;
      if (deltaSeconds > 0) {
        speed = (deltaDistance / deltaSeconds) * 3600;
      }
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
      distance: Number.isFinite(deltaDistance) || index === 0 ? cumulativeDistance : null,
    };
  });

  return smoothAltitudes(smoothSpeeds(normalized));
}

// Die Hoehe kommt mit 0,2 m Quantisierung bei 1 Hz. Ohne Glaettung zaehlt jedes
// Rauschkorn als Anstieg: die naive Summe liegt dadurch ueber alle vier
// Referenzdateien rund 5 % ueber session.total_ascent. Ein gleitender Mittelwert
// ueber +-5 s drueckt den Fehler auf unter 2 %. Das rohe `altitude` bleibt
// erhalten, damit Chart und Inspector weiter den Messwert zeigen.
function smoothAltitudes(samples) {
  return samples.map((sample, index) => {
    const minimumTime = sample.t - ALTITUDE_SMOOTHING_RADIUS_SECONDS;
    const maximumTime = sample.t + ALTITUDE_SMOOTHING_RADIUS_SECONDS;
    let sum = 0;
    let count = 0;

    for (let candidateIndex = index; candidateIndex >= 0 && samples[candidateIndex].t >= minimumTime; candidateIndex--) {
      if (Number.isFinite(samples[candidateIndex].altitude)) {
        sum += samples[candidateIndex].altitude;
        count++;
      }
    }

    for (let candidateIndex = index + 1; candidateIndex < samples.length && samples[candidateIndex].t <= maximumTime; candidateIndex++) {
      if (Number.isFinite(samples[candidateIndex].altitude)) {
        sum += samples[candidateIndex].altitude;
        count++;
      }
    }

    return { ...sample, smoothedAltitude: count ? sum / count : null };
  });
}

function smoothSpeeds(samples) {
  const medianSpeeds = samples.map((sample, index) => {
    const values = [];
    const minimumTime = sample.t - SPEED_MEDIAN_RADIUS_SECONDS;
    const maximumTime = sample.t + SPEED_MEDIAN_RADIUS_SECONDS;

    for (let candidateIndex = index; candidateIndex >= 0 && samples[candidateIndex].t >= minimumTime; candidateIndex--) {
      if (Number.isFinite(samples[candidateIndex].speed)) {
        values.push(samples[candidateIndex].speed);
      }
    }

    for (let candidateIndex = index + 1; candidateIndex < samples.length && samples[candidateIndex].t <= maximumTime; candidateIndex++) {
      if (Number.isFinite(samples[candidateIndex].speed)) {
        values.push(samples[candidateIndex].speed);
      }
    }

    if (!values.length) {
      return null;
    }

    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  });

  return samples.map((sample, index) => {
    const minimumTime = sample.t - SPEED_AVERAGE_RADIUS_SECONDS;
    const maximumTime = sample.t + SPEED_AVERAGE_RADIUS_SECONDS;
    let sum = 0;
    let count = 0;

    for (let candidateIndex = index; candidateIndex >= 0 && samples[candidateIndex].t >= minimumTime; candidateIndex--) {
      if (Number.isFinite(medianSpeeds[candidateIndex])) {
        sum += medianSpeeds[candidateIndex];
        count++;
      }
    }

    for (let candidateIndex = index + 1; candidateIndex < samples.length && samples[candidateIndex].t <= maximumTime; candidateIndex++) {
      if (Number.isFinite(medianSpeeds[candidateIndex])) {
        sum += medianSpeeds[candidateIndex];
        count++;
      }
    }

    return {
      ...sample,
      speed: count ? sum / count : null,
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

// fit-file-parser liefert im Modus 'both' die Records flach unter `records` und
// zusaetzlich verschachtelt unter activity.sessions[].laps[].records. Wir greifen
// gezielt darauf zu. Die alte Heuristik (searchFitRecordGroups) sammelte jedes
// Array ein, dessen Eintraege ein `timestamp`-Feld haben -- und erwischte damit
// auch events, device_infos, laps und sessions. Die landeten als Samples ohne
// jeden Messwert im Schrieb und rissen Loecher in die Distanz- und Speed-Kette.
function findFitRecordGroups(root) {
  if (Array.isArray(root?.records) && root.records.length) {
    return [root.records];
  }

  const nested = (root?.activity?.sessions ?? [])
    .flatMap((session) => session?.laps ?? [])
    .map((lap) => lap?.records)
    .filter((records) => Array.isArray(records) && records.length);

  if (nested.length) {
    return nested;
  }

  return searchFitRecordGroups(root);
}

function searchFitRecordGroups(root) {
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

// Garmin Connect zeigt nicht die Records an, sondern die Summen, die der Kopf
// selbst in die session-Message schreibt. Die weichen systematisch ab: avg_power
// stammt aus einem internen Arbeits-Konto, das schneller als 1 Hz abtastet.
function readFitSession(root) {
  const session = root?.sessions?.[0] ?? root?.activity?.sessions?.[0] ?? null;
  if (!session) {
    return null;
  }

  // parseFit setzt lengthUnit 'km', deshalb kommen total_distance, total_ascent,
  // total_descent und die Hoehenfelder bereits in Kilometern an.
  return {
    totalDistance: pickNumber(session, ['total_distance']),
    timerTime: pickNumber(session, ['total_timer_time']),
    elapsedTime: pickNumber(session, ['total_elapsed_time']),
    avgSpeed: pickNumber(session, ['enhanced_avg_speed', 'avg_speed']),
    maxSpeed: pickNumber(session, ['enhanced_max_speed', 'max_speed']),
    avgHeartRate: pickNumber(session, ['avg_heart_rate']),
    maxHeartRate: pickNumber(session, ['max_heart_rate']),
    avgPower: pickNumber(session, ['avg_power']),
    maxPower: pickNumber(session, ['max_power']),
    normalizedPower: pickNumber(session, ['normalized_power']),
    avgCadence: pickNumber(session, ['avg_cadence']),
    maxCadence: pickNumber(session, ['max_cadence']),
    totalAscent: kilometersToMeters(pickNumber(session, ['total_ascent'])),
    totalDescent: kilometersToMeters(pickNumber(session, ['total_descent'])),
    minAltitude: kilometersToMeters(pickNumber(session, ['enhanced_min_altitude', 'min_altitude'])),
    maxAltitude: kilometersToMeters(pickNumber(session, ['enhanced_max_altitude', 'max_altitude'])),
    totalCalories: pickNumber(session, ['total_calories']),
    totalWork: pickNumber(session, ['total_work']),
    trainingStressScore: pickNumber(session, ['training_stress_score']),
    intensityFactor: pickNumber(session, ['intensity_factor']),
  };
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
    altitude: kilometersToMeters(pickNumber(record, ['altitude', 'enhanced_altitude'])),
    heartRate: pickNumber(record, ['heart_rate', 'heartRate']) ?? null,
    power: pickNumber(record, ['power']) ?? null,
    distance: pickNumber(record, ['distance']),
    cadence: pickNumber(record, ['cadence']) ?? null,
  };
}

function createTrack(samples, mapSamples, fileName, source, session = null) {
  const startTime = samples[0].t;
  const endTime = samples[samples.length - 1].t;
  return {
    fileName,
    source,
    session,
    metricCache: new Map(),
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

function kilometersToMeters(value) {
  return Number.isFinite(value) ? value * 1000 : null;
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
  if (!getLoadedSlots().length) {
    renderEmptyState();
    return;
  }

  const origin = getTimelineOrigin();
  state.duration = Math.max(
    0,
    ...state.slots.map((slot) => (slot.track ? slot.track.endTime + slot.offsetSeconds - origin : 0))
  );
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
  // Nicht dazwischenfunken, solange jemand die Zeit gerade eintippt.
  if (document.activeElement !== elements.currentTimeInput) {
    elements.currentTimeInput.value = formatDuration(state.currentTime);
  }
  elements.durationLabel.textContent = formatDuration(state.duration);
}

// Springt an eine Stelle der gemeinsamen Zeitachse. Laeuft die Wiedergabe gerade,
// laeuft sie von dort weiter -- lastFrame zurueckzusetzen verhindert, dass der
// naechste Frame die uebersprungene Zeit nachholt.
function seekTo(seconds) {
  if (!Number.isFinite(seconds)) {
    return;
  }

  state.currentTime = Math.max(0, Math.min(state.duration, seconds));
  state.lastFrame = null;
  updateVisuals();
}

function updateMapLayers() {
  for (const slot of state.slots) {
    clearSlotLayer(slot, 'polyline');
    clearSlotLayer(slot, 'marker');

    if (!slot.track) {
      continue;
    }

    const coordinates = slot.track.mapSamples.map((sample) => [sample.lat, sample.lon]);
    if (!coordinates.length) {
      continue;
    }

    const color = getSlotColor(slot);
    slot.layers.polyline = L.polyline(coordinates, { color, weight: 4, opacity: 0.9 }).addTo(state.map);

    const position = interpolatePosition(slot.track.mapSamples, getSlotTime(slot, state.currentTime));
    if (position) {
      slot.layers.marker = L.circleMarker([position.lat, position.lon], {
        radius: 8,
        color,
        weight: 3,
        fillColor: '#06131b',
        fillOpacity: 1,
      }).addTo(state.map);
    }
  }

  updateHoverMapMarkers();
  renderDistanceSelectionLayers();
}

function handleMapDistanceSelectionClick(event) {
  const nearestBySlot = state.slots.map((slot) => findNearestMapSample(slot.track, event.latlng));
  const nearestDistance = Math.min(...nearestBySlot.map((result) => result?.pixelDistance ?? Infinity));
  if (nearestDistance > 30) {
    return;
  }

  if (distanceInteraction.clicks.length >= 2) {
    clearDistanceSelectionWindow();
  }

  const projections = nearestBySlot.map((result) =>
    result && result.pixelDistance <= 60 ? result.sample : null
  );
  distanceInteraction.clicks.push({ latlng: event.latlng, projections });

  if (distanceInteraction.clicks.length === 2) {
    state.slots.forEach((slot, index) => {
      const first = distanceInteraction.clicks[0].projections[index];
      const second = distanceInteraction.clicks[1].projections[index];
      slot.distanceRange = first && second
        ? {
          start: first.distance <= second.distance ? first : second,
          end: first.distance <= second.distance ? second : first,
        }
        : null;
    });
  }

  refreshDistanceSelectionInspector();
  renderDistanceSelectionLayers();
}

function findNearestMapSample(track, latlng) {
  if (!track?.mapSamples.length || !state.map) {
    return null;
  }

  const clickPoint = state.map.latLngToLayerPoint(latlng);
  let nearestSample = null;
  let nearestDistance = Infinity;
  for (const sample of track.mapSamples) {
    const samplePoint = state.map.latLngToLayerPoint([sample.lat, sample.lon]);
    const pixelDistance = clickPoint.distanceTo(samplePoint);
    if (pixelDistance < nearestDistance) {
      nearestDistance = pixelDistance;
      nearestSample = sample;
    }
  }

  return nearestSample ? { sample: nearestSample, pixelDistance: nearestDistance } : null;
}

function renderDistanceSelectionLayers() {
  clearMapLayer('distanceStartMarker');
  clearMapLayer('distanceEndMarker');

  for (const slot of state.slots) {
    clearSlotLayer(slot, 'distanceSegment');
    const range = slot.distanceRange;
    if (!range || !slot.track) {
      continue;
    }

    const coordinates = slot.track.mapSamples
      .filter((sample) => sample.t >= range.start.t && sample.t <= range.end.t)
      .map((sample) => [sample.lat, sample.lon]);
    if (coordinates.length >= 2) {
      slot.layers.distanceSegment = L.polyline(coordinates, {
        color: getSlotColor(slot),
        weight: 9,
        opacity: 0.48,
      }).addTo(state.map);
    }
  }

  const markerNames = ['distanceStartMarker', 'distanceEndMarker'];
  distanceInteraction.clicks.forEach((click, index) => {
    state.layers[markerNames[index]] = L.circleMarker(click.latlng, {
      radius: 8,
      color: '#f4d35e',
      weight: 3,
      fillColor: '#06131b',
      fillOpacity: 1,
    }).addTo(state.map);
  });
}

function updateHoverMapMarkers() {
  for (const slot of state.slots) {
    clearSlotLayer(slot, 'hoverMarker');
  }

  if (chartInteraction.hoverTime === null) {
    return;
  }

  for (const slot of state.slots) {
    addHoverMapMarker(slot, getSlotTime(slot, chartInteraction.hoverTime));
  }
}

function addHoverMapMarker(slot, time) {
  const track = slot.track;
  if (!track?.mapSamples.length || time < track.mapSamples[0].t || time > track.mapSamples[track.mapSamples.length - 1].t) {
    return;
  }

  const position = interpolatePosition(track.mapSamples, time);
  if (!position) {
    return;
  }

  slot.layers.hoverMarker = L.circleMarker([position.lat, position.lon], {
    radius: 4,
    color: '#ffffff',
    weight: 1,
    fillColor: '#ffffff',
    fillOpacity: 1,
  }).addTo(state.map);
}

function clearMapLayer(layerName) {
  const layer = state.layers[layerName];
  if (layer) {
    layer.remove();
    state.layers[layerName] = null;
  }
}

function clearSlotLayer(slot, layerName) {
  const layer = slot.layers[layerName];
  if (layer) {
    layer.remove();
    slot.layers[layerName] = null;
  }
}

function fitMapBounds() {
  const points = [];
  for (const slot of state.slots) {
    if (!slot.track) {
      continue;
    }
    for (const sample of slot.track.mapSamples) {
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

  const origin = getTimelineOrigin();
  state.chart.data.datasets = getLoadedSlots().map((slot) => ({
    ...buildDataset(slot.track, metric, getSlotColor(slot), slot.offsetSeconds, origin),
    slotId: slot.id,
  }));
  state.chart.options.scales.y.title.text = `${metric.label} (${metric.unit})`;
  state.chart.options.scales.y.suggestedMin = undefined;
  state.chart.options.scales.y.suggestedMax = undefined;
  state.chart.update('none');
  refreshHoverInspector();
  refreshSelectionInspector();
  refreshDistanceSelectionInspector();
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
  elements.currentPointTime.textContent = formatDuration(state.currentTime);
  renderPointTable(elements.currentPointValues, state.currentTime);
}

function refreshHoverInspector() {
  if (chartInteraction.hoverTime === null) {
    elements.hoverPointTime.textContent = '-';
    elements.hoverPointValues.innerHTML = '<p class="inspector-empty">Maus über den Graphen bewegen</p>';
    return;
  }

  elements.hoverPointTime.textContent = formatDuration(chartInteraction.hoverTime);
  renderPointTable(elements.hoverPointValues, chartInteraction.hoverTime);
}

function renderPointTable(container, overallTime) {
  const columns = getComparisonColumns();
  if (!columns.length) {
    container.innerHTML = '<p class="inspector-empty">Noch keine Datei geladen</p>';
    return;
  }

  renderComparisonTable(container, {
    rows: POINT_ROWS,
    columns,
    getValue: (row, column) =>
      getTrackValueAtTime(column.track, getSlotTime(column.slot, overallTime))?.[row.key],
  });
}

function refreshSelectionInspector() {
  if (!chartInteraction.selectionActive || chartInteraction.selectionStart === null || chartInteraction.selectionEnd === null) {
    elements.selectionPanel.classList.add('hidden');
    return;
  }

  const start = Math.min(chartInteraction.selectionStart, chartInteraction.selectionEnd);
  const end = Math.max(chartInteraction.selectionStart, chartInteraction.selectionEnd);

  elements.selectionPanel.classList.remove('hidden');
  elements.selectionRange.textContent = `${formatDuration(start)} - ${formatDuration(end)}`;
  syncSelectionEditor(start, end);

  const ranges = state.slots.map((slot) => ({
    startTime: getSlotTime(slot, start),
    endTime: getSlotTime(slot, end),
  }));
  renderComparisonTable(elements.selectionValues, {
    rows: WINDOW_COMPARISON_ROWS,
    columns: getComparisonColumns(),
    getValue: (row, column) => readWindowValue(row, column, ranges),
  });
}

function syncSelectionEditor(start, end) {
  elements.selectionTimeStart.value = formatDuration(start);
  elements.selectionTimeEnd.value = formatDuration(end);

  for (const slot of state.slots) {
    syncSelectionDistanceInput(slot, slot.el.selectionStart, start);
    syncSelectionDistanceInput(slot, slot.el.selectionEnd, end);
  }
}

function syncSelectionDistanceInput(slot, input, overallTime) {
  const track = slot.track;
  input.disabled = !track;
  if (!track) {
    input.value = '';
    return;
  }

  const trackTime = getSlotTime(slot, overallTime);
  if (trackTime < track.samples[0].t || trackTime > track.samples[track.samples.length - 1].t) {
    input.value = '';
    return;
  }

  const distance = getTrackValueAtTime(track, trackTime)?.distance;
  input.value = Number.isFinite(distance) ? distance.toFixed(2) : '';
}

function applySelectionTimeValue(input, boundary) {
  applySelectionBoundary(boundary, parseDurationText(input.value));
}

function applySelectionDistanceValue(slot, input, boundary) {
  const raw = String(input.value).trim();
  const distance = raw ? Number(raw.replace(',', '.')) : NaN;
  const trackTime = getTrackTimeAtDistance(slot.track, distance, boundary);
  applySelectionBoundary(
    boundary,
    trackTime === null ? NaN : trackTime + slot.offsetSeconds - getTimelineOrigin()
  );
}

function applySelectionBoundary(boundary, overallTime) {
  const currentStart = Math.min(chartInteraction.selectionStart, chartInteraction.selectionEnd);
  const currentEnd = Math.max(chartInteraction.selectionStart, chartInteraction.selectionEnd);

  if (!Number.isFinite(overallTime)) {
    syncSelectionEditor(currentStart, currentEnd);
    return;
  }

  const clampedTime = Math.max(0, Math.min(state.duration, overallTime));
  const start = boundary === 'start' ? clampedTime : currentStart;
  const end = boundary === 'end' ? clampedTime : currentEnd;
  chartInteraction.selectionStart = Math.min(start, end);
  chartInteraction.selectionEnd = Math.max(start, end);
  chartInteraction.selectionStartPixelX = state.chart?.scales?.x?.getPixelForValue(chartInteraction.selectionStart) ?? null;
  chartInteraction.selectionEndPixelX = state.chart?.scales?.x?.getPixelForValue(chartInteraction.selectionEnd) ?? null;
  chartInteraction.selectionActive = true;
  refreshSelectionInspector();
  state.chart?.draw();
}

function getTrackTimeAtDistance(track, distance, boundary) {
  if (!track?.samples.length || !Number.isFinite(distance) || distance < 0) {
    return null;
  }

  const samples = track.samples.filter((sample) => Number.isFinite(sample.distance));
  if (!samples.length || distance < samples[0].distance || distance > samples[samples.length - 1].distance) {
    return null;
  }

  if (boundary === 'start') {
    const index = samples.findIndex((sample) => sample.distance >= distance);
    if (index <= 0 || samples[index].distance === distance) {
      return samples[Math.max(index, 0)].t;
    }
    return interpolateTimeAtDistance(samples[index - 1], samples[index], distance);
  }

  for (let index = samples.length - 1; index >= 0; index--) {
    if (samples[index].distance <= distance) {
      if (index === samples.length - 1 || samples[index].distance === distance) {
        return samples[index].t;
      }
      return interpolateTimeAtDistance(samples[index], samples[index + 1], distance);
    }
  }

  return null;
}

function interpolateTimeAtDistance(start, end, distance) {
  const distanceDelta = end.distance - start.distance;
  if (distanceDelta <= 0) {
    return start.t;
  }
  return start.t + ((distance - start.distance) / distanceDelta) * (end.t - start.t);
}

function refreshDistanceSelectionInspector() {
  if (!distanceInteraction.clicks.length) {
    elements.distanceSelectionPanel.classList.add('hidden');
    return;
  }

  elements.distanceSelectionPanel.classList.remove('hidden');

  const firstProjections = distanceInteraction.clicks[0].projections;
  const secondProjections = distanceInteraction.clicks[1]?.projections ?? [];
  state.slots.forEach((slot, index) => {
    setDistanceWindowInput(slot.el.distanceStart, firstProjections[index]);
    setDistanceWindowInput(slot.el.distanceEnd, secondProjections[index]);
  });

  if (distanceInteraction.clicks.length < 2) {
    elements.distanceSelectionRange.textContent = 'Start gesetzt \u2013 jetzt Endpunkt w\u00e4hlen';
    elements.distanceSelectionValues.innerHTML = '';
    return;
  }

  for (const slot of state.slots) {
    setDistanceWindowInput(slot.el.distanceStart, slot.distanceRange?.start);
    setDistanceWindowInput(slot.el.distanceEnd, slot.distanceRange?.end);
  }

  elements.distanceSelectionRange.textContent = getLoadedSlots()
    .map((slot) => formatDistanceRange(getSlotDisplayName(slot), slot.distanceRange))
    .join(' \u00b7 ');

  const ranges = state.slots.map((slot) => (slot.distanceRange
    ? { startTime: slot.distanceRange.start.t, endTime: slot.distanceRange.end.t }
    : null));
  renderComparisonTable(elements.distanceSelectionValues, {
    rows: WINDOW_COMPARISON_ROWS,
    columns: getComparisonColumns(),
    getValue: (row, column) => readWindowValue(row, column, ranges),
  });
}

function setDistanceWindowInput(input, sample) {
  input.value = Number.isFinite(sample?.distance) ? sample.distance.toFixed(2) : '-';
}

function formatDistanceRange(label, range) {
  if (!range) {
    return `${label}: -`;
  }
  return `${label}: ${range.start.distance.toFixed(2)}–${range.end.distance.toFixed(2)} km`;
}

function clearDistanceSelectionWindow() {
  distanceInteraction.clicks = [];
  for (const slot of state.slots) {
    slot.distanceRange = null;
  }
  refreshDistanceSelectionInspector();
  renderDistanceSelectionLayers();
}

// Spalten der Vergleichstabellen: eine je geladener Datei. `index` bleibt der
// Slot-Index, damit Aufrufer ihre Zeitfenster darüber zuordnen können.
function getComparisonColumns() {
  return state.slots
    .map((slot, index) => ({
      slot,
      track: slot.track,
      index,
      name: getSlotDisplayName(slot),
      color: slot.color,
    }))
    .filter((column) => column.track);
}

function refreshActivityComparison() {
  const columns = getComparisonColumns();
  elements.comparisonPanel.classList.toggle('hidden', !columns.length);
  if (!columns.length) {
    return;
  }

  // GPX-Dateien bringen keine session-Message mit. Ist gar kein Gerätewert da,
  // bleibt die obere Tabelle weg, statt leer stehen zu bleiben.
  const hasSession = columns.some((column) => column.track.session);
  elements.deviceComparison.classList.toggle('hidden', !hasSession);
  if (hasSession) {
    renderComparisonTable(elements.deviceComparisonValues, {
      rows: DEVICE_COMPARISON_ROWS,
      columns,
      getValue: readSessionValue,
    });
  }

  renderComparisonTable(elements.computedComparisonValues, {
    rows: COMPUTED_COMPARISON_ROWS,
    columns,
    getValue: (row, column) => row.computed(column.track, column.track.startTime, column.track.endTime),
    getReference: hasSession ? readSessionValue : null,
  });
}

function renderComparisonTable(container, { rows, columns, getValue, getReference = null }) {
  const header = columns
    .map((column) => `<th scope="col" style="color: ${column.color}">${escapeHtml(column.name)}</th>`)
    .join('');

  const body = rows
    .map((row) => {
      const values = columns.map((column) => toFiniteOrNull(getValue(row, column)));
      // Welche session-Felder ein Gerät schreibt, ist modellabhängig. Eine Zeile,
      // zu der keine Spalte etwas liefert, wäre nur eine Reihe Gedankenstriche.
      if (values.every((value) => value === null)) {
        return '';
      }

      const cells = values
        .map((value, index) => {
          const reference = getReference ? toFiniteOrNull(getReference(row, columns[index])) : null;
          return `<td>${formatComparisonValue(row, value)}${renderDeltaBadge(relativeDelta(value, reference))}</td>`;
        })
        .join('');
      return `<tr><th scope="row">${escapeHtml(row.label)}</th>${cells}</tr>`;
    })
    .join('');

  container.innerHTML = `
    <table class="comparison-table">
      <thead><tr><th scope="col">Metrik</th>${header}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function toFiniteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function readSessionValue(row, column) {
  return column.track?.session && row.session ? row.session(column.track.session) : null;
}

// Fehlt einer Datei das Fenster (kein Treffer beim Distanzfenster), bleibt die
// Spalte leer -- nicht etwa die ganze Aktivität.
function readWindowValue(row, column, ranges) {
  const range = ranges[column.index];
  return range ? row.computed(column.track, range.startTime, range.endTime) : null;
}

function relativeDelta(value, reference) {
  if (!Number.isFinite(value) || !Number.isFinite(reference) || reference === 0) {
    return null;
  }

  return ((value - reference) / reference) * 100;
}

function renderDeltaBadge(delta) {
  if (!Number.isFinite(delta)) {
    return '';
  }

  const rounded = Math.round(delta * 10) / 10;
  if (rounded === 0) {
    return '';
  }

  const sign = rounded > 0 ? '+' : '−';
  const className = Math.abs(rounded) > 2 ? 'comparison-delta strong' : 'comparison-delta';
  return `<span class="${className}">${sign}${formatNumber(Math.abs(rounded), 1)} %</span>`;
}

function formatComparisonValue(row, value) {
  if (!Number.isFinite(value)) {
    return '—';
  }

  if (row.format === 'duration') {
    return formatDuration(value);
  }

  const text = formatNumber(value, row.decimals ?? 0);
  return row.unit ? `${text} ${row.unit}` : text;
}

function formatNumber(value, decimals) {
  return value.toLocaleString('de-DE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
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

      // Playhead: zeigt im Graphen dieselbe Stelle, die auf der Karte als
      // Positionsmarker sitzt.
      const playheadPixelX = xScale.getPixelForValue(state.currentTime);
      if (Number.isFinite(playheadPixelX) && playheadPixelX >= chartArea.left && playheadPixelX <= chartArea.right) {
        drawVerticalLine(playheadPixelX, 'rgba(244, 211, 94, 0.9)', []);
        ctx.save();
        ctx.fillStyle = 'rgba(244, 211, 94, 0.9)';
        ctx.beginPath();
        ctx.moveTo(playheadPixelX - 5, chartArea.top - 8);
        ctx.lineTo(playheadPixelX + 5, chartArea.top - 8);
        ctx.lineTo(playheadPixelX, chartArea.top - 1);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
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
  updateHoverMapMarkers();

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
  updateHoverMapMarkers();
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
    label: track.displayName || track.fileName,
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
  if (!getLoadedSlots().length) {
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
  refreshActivityComparison();
}

function setLoadingState(slot, { phase, percent, loading, status, meta }) {
  setStatus(slot, status, loading);
  setMeta(slot, meta);
  updateProgress(slot, percent, phase);
}

function setMeta(slot, text) {
  slot.el.meta.textContent = text;
}

function updateProgress(slot, percent, phase) {
  const track = slot.el.progressBar.closest('.file-progress-track');
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));

  track.classList.add('loading');
  slot.el.progressBar.style.width = `${safePercent}%`;
  slot.el.progressLabel.textContent = phase;
  slot.el.progressValue.textContent = `${Math.round(safePercent)} %`;
}

function setStatus(slot, label, loading) {
  const track = slot.el.progressBar.closest('.file-progress-track');
  slot.el.status.textContent = label;
  slot.el.status.style.opacity = loading ? '0.75' : '1';
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
    distance: interpolateNumeric(start.distance, end.distance, ratio),
    cadence: interpolateNumeric(start.cadence, end.cadence, ratio),
    altitude: interpolateNumeric(start.altitude, end.altitude, ratio),
    smoothedAltitude: interpolateNumeric(start.smoothedAltitude, end.smoothedAltitude, ratio),
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function averageMetric(track, startTime, endTime, key, { ignoreZeros = false } = {}) {
  if (!track || !Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return null;
  }

  const values = track.samples
    .filter((sample) => sample.t >= startTime && sample.t <= endTime)
    .map((sample) => sample[key])
    .filter((value) => Number.isFinite(value) && (!ignoreZeros || value > 0));

  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function minMetric(track, startTime, endTime, key) {
  return extremeMetric(track, startTime, endTime, key, -1);
}

function maxMetric(track, startTime, endTime, key) {
  return extremeMetric(track, startTime, endTime, key, 1);
}

function extremeMetric(track, startTime, endTime, key, direction) {
  if (!track || !Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return null;
  }

  let best = null;
  for (const sample of track.samples) {
    if (sample.t < startTime || sample.t > endTime) {
      continue;
    }
    const value = sample[key];
    if (Number.isFinite(value) && (best === null || (value - best) * direction > 0)) {
      best = value;
    }
  }

  return best;
}

// Garmin bildet den Schnitt aus Distanz/Zeit, nicht aus den Momentanwerten.
// Der Sample-Mittelwert lag bei RACA_Tobi 17,9 % daneben, weil Standphasen
// ohne Speed-Record den Schnitt nach oben ziehen.
function calculateAverageSpeed(track, startTime, endTime) {
  const distance = calculateDistanceCovered(track, startTime, endTime);
  const elapsed = calculateElapsedTime(track, startTime, endTime);
  if (!Number.isFinite(distance) || !Number.isFinite(elapsed) || elapsed <= 0) {
    return null;
  }

  return (distance / elapsed) * 3600;
}

// Die teuren Fensterwerte (NP, Hoehenmeter) laufen bei jedem refreshChart erneut,
// also bei jeder Mausbewegung ueber den Graphen. Der Cache haengt am Track und
// verfaellt damit automatisch, sobald eine Datei neu geladen wird.
function memoizeTrackMetric(track, key, compute) {
  if (!track) {
    return compute();
  }

  const cache = track.metricCache ?? (track.metricCache = new Map());
  if (cache.has(key)) {
    return cache.get(key);
  }

  const value = compute();
  // Beim Ziehen eines Zeitfensters entsteht pro Mausbewegung ein neuer Schluessel.
  // Ohne Deckel waechst der Cache ueber eine lange Sitzung unbegrenzt.
  if (cache.size >= METRIC_CACHE_LIMIT) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, value);
  return value;
}

function getClampedTrackRange(track, startTime, endTime) {
  if (!track?.samples.length || !Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return null;
  }

  const rangeStart = Math.max(Math.min(startTime, endTime), track.samples[0].t);
  const rangeEnd = Math.min(Math.max(startTime, endTime), track.samples[track.samples.length - 1].t);
  return rangeEnd >= rangeStart ? { start: rangeStart, end: rangeEnd } : null;
}

function calculateElapsedTime(track, startTime, endTime) {
  const range = getClampedTrackRange(track, startTime, endTime);
  return range ? range.end - range.start : null;
}

function calculateDistanceCovered(track, startTime, endTime) {
  const range = getClampedTrackRange(track, startTime, endTime);
  if (!range) {
    return null;
  }

  const startDistance = getTrackValueAtTime(track, range.start)?.distance;
  const endDistance = getTrackValueAtTime(track, range.end)?.distance;
  return Number.isFinite(startDistance) && Number.isFinite(endDistance)
    ? Math.max(0, endDistance - startDistance)
    : null;
}

function calculateElevationGain(track, startTime, endTime) {
  return memoizeTrackMetric(track, `gain:${startTime}:${endTime}`, () =>
    sumElevationDelta(track, startTime, endTime, 1));
}

function calculateElevationLoss(track, startTime, endTime) {
  return memoizeTrackMetric(track, `loss:${startTime}:${endTime}`, () =>
    sumElevationDelta(track, startTime, endTime, -1));
}

// direction 1 summiert die Anstiege, -1 die Abstiege. Gerechnet wird auf
// smoothedAltitude (siehe smoothAltitudes), nicht auf der rohen Hoehe.
function sumElevationDelta(track, startTime, endTime, direction) {
  const range = getClampedTrackRange(track, startTime, endTime);
  if (!range) {
    return null;
  }

  const altitudes = [getTrackValueAtTime(track, range.start)?.smoothedAltitude];
  for (const sample of track.samples) {
    if (sample.t > range.start && sample.t < range.end) {
      altitudes.push(sample.smoothedAltitude);
    }
  }
  altitudes.push(getTrackValueAtTime(track, range.end)?.smoothedAltitude);

  let total = 0;
  let previous = null;
  let hasAltitudeData = false;
  for (const altitude of altitudes) {
    if (!Number.isFinite(altitude)) {
      continue;
    }
    if (previous !== null) {
      total += Math.max(0, (altitude - previous) * direction);
    }
    previous = altitude;
    hasAltitudeData = true;
  }

  return hasAltitudeData ? total : null;
}

function calculateStoppedTime(track, startTime, endTime) {
  if (!track?.samples.length || !Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return null;
  }

  const rangeStart = Math.max(Math.min(startTime, endTime), track.samples[0].t);
  const rangeEnd = Math.min(Math.max(startTime, endTime), track.samples[track.samples.length - 1].t);
  if (rangeEnd <= rangeStart) {
    return 0;
  }

  let stoppedSeconds = 0;
  let hasSpeedData = false;

  for (let index = 1; index < track.samples.length; index++) {
    const intervalStart = Math.max(track.samples[index - 1].t, rangeStart);
    const intervalEnd = Math.min(track.samples[index].t, rangeEnd);
    if (intervalEnd <= intervalStart) {
      continue;
    }

    const speed = track.samples[index].speed;
    if (!Number.isFinite(speed)) {
      continue;
    }

    hasSpeedData = true;
    if (speed < STOPPED_SPEED_THRESHOLD_KMH) {
      stoppedSeconds += intervalEnd - intervalStart;
    }
  }

  return hasSpeedData ? stoppedSeconds : null;
}

function calculateNormalizedPower(track, startTime, endTime) {
  return memoizeTrackMetric(track, `np:${startTime}:${endTime}`, () =>
    computeNormalizedPower(track, startTime, endTime));
}

function computeNormalizedPower(track, startTime, endTime) {
  if (!track?.samples.length || !Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return null;
  }

  const rangeStart = Math.max(Math.min(startTime, endTime), track.samples[0].t);
  const rangeEnd = Math.min(Math.max(startTime, endTime), track.samples[track.samples.length - 1].t);
  if (rangeEnd - rangeStart < 30) {
    return null;
  }

  const rollingPowers = [];
  const fourthPowers = [];
  let rollingSum = 0;

  for (let time = rangeStart; time <= rangeEnd; time += 1) {
    const power = getTrackValueAtTime(track, time)?.power;
    if (!Number.isFinite(power)) {
      rollingPowers.length = 0;
      rollingSum = 0;
      continue;
    }

    rollingPowers.push(power);
    rollingSum += power;
    if (rollingPowers.length > 30) {
      rollingSum -= rollingPowers.shift();
    }

    if (rollingPowers.length === 30) {
      fourthPowers.push((rollingSum / 30) ** 4);
    }
  }

  if (!fourthPowers.length) {
    return null;
  }

  const meanFourthPower = fourthPowers.reduce((sum, value) => sum + value, 0) / fourthPowers.length;
  return meanFourthPower ** 0.25;
}

function updateOffsetDisplay(slot) {
  slot.el.offsetText.value = formatOffsetText(slot.offsetSeconds);
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

function parseDurationText(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const parts = trimmed.split(':').map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0)) {
    return null;
  }

  if (parts.length === 2 && parts[1] < 60) {
    return (parts[0] * 60) + parts[1];
  }

  if (parts.length === 3 && parts[1] < 60 && parts[2] < 60) {
    return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  }

  return null;
}

function formatDuration(seconds) {
  const safeSeconds = Math.round(Math.max(0, Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

function updateTrackDisplayName(slot, value) {
  if (!slot.track) {
    return;
  }

  slot.track.displayName = String(value || '').trim() || slot.track.fileName;
  syncSlotChrome();
  refreshChart();
  refreshCurrentPointInspector();
}

