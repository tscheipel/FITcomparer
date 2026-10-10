/*
 * FITcomparer
 * Copyright (c) 2026 Tobias Scheipel
 * SPDX-License-Identifier: MIT
 * See the LICENSE file in the project root for the full license text.
 */

// Rendert die Karte mit allen Tracks und den wandernden Positionsmarkern Bild fuer
// Bild auf ein Canvas und kodiert das Ergebnis mit WebCodecs zu einer MP4-Datei.
// Alles laeuft im Browser; ueber das Netz geht nur das einmalige Laden der
// OSM-Kacheln fuer den festen Kartenausschnitt.

import { t } from './i18n.js?v=14';

const TILE_SIZE = 256;
const MIN_ZOOM = 2;
const MAX_ZOOM = 18;
const TILE_TIMEOUT_MS = 15000;
const MUXER_URL = 'https://esm.sh/mp4-muxer@5.1.3';
const MAX_ENCODE_QUEUE = 8;

// Bildformate. Aufgespannt wird immer ueber die kurze Seite: 720 heisst 1280x720 im
// 16:9-Querformat, aber 720x1280 im 9:16-Hochformat.
export const ASPECTS = [
  { id: '16:9', w: 16, h: 9, label: t('video.aspect.16:9') },
  { id: '4:3', w: 4, h: 3, label: t('video.aspect.4:3') },
  { id: '1:1', w: 1, h: 1, label: t('video.aspect.1:1') },
  { id: '4:5', w: 4, h: 5, label: t('video.aspect.4:5') },
  { id: '9:16', w: 9, h: 16, label: t('video.aspect.9:16') },
];

export const QUALITIES = [
  { id: '360', shortSide: 360, label: t('video.quality.360') },
  { id: '720', shortSide: 720, label: t('video.quality.720') },
  { id: '1080', shortSide: 1080, label: t('video.quality.1080') },
];

const toEven = (value) => Math.max(2, Math.round(value / 2) * 2);

// H.264 verlangt gerade Kantenlaengen. Alle Kombinationen bleiben unter dem Limit von
// Level 4.0 (8192 Makrobloecke je Bild): groesster Fall 1080x1920 = 8160.
export function frameSize(aspectId, shortSide) {
  const aspect = ASPECTS.find((entry) => entry.id === aspectId) ?? ASPECTS[0];
  const factor = shortSide / Math.min(aspect.w, aspect.h);
  return { width: toEven(aspect.w * factor), height: toEven(aspect.h * factor) };
}

// Zielbitrate nach Pixelzahl. Die Karte ist fast statisch und braucht in der Praxis
// weniger; das ist die Obergrenze, mit der auch die Groessenschaetzung rechnet.
export function bitrateForSize(width, height) {
  const target = width * height * 4.1;
  return Math.round(Math.max(1_500_000, Math.min(8_000_000, target)) / 100_000) * 100_000;
}

export function isVideoExportSupported() {
  return typeof VideoEncoder !== 'undefined'
    && typeof VideoFrame !== 'undefined'
    && typeof OffscreenCanvas !== 'undefined';
}

// Reihenfolge = Praeferenz: beste Qualitaet zuerst. Baseline (kein B-Frame-Umsortieren)
// und VP9 stehen als Rueckfall da, weil nicht jeder Encoder die Bilder in
// Darstellungsreihenfolge ausgibt (siehe probeEncoder).
const ENCODER_CANDIDATES = [
  { muxerCodec: 'avc', label: 'H.264 High', config: { codec: 'avc1.640028', avc: { format: 'avc' } } },
  { muxerCodec: 'avc', label: 'H.264 Main', config: { codec: 'avc1.4d0028', avc: { format: 'avc' } } },
  { muxerCodec: 'avc', label: 'H.264 Baseline', config: { codec: 'avc1.420028', avc: { format: 'avc' } } },
  { muxerCodec: 'vp9', label: 'VP9', config: { codec: 'vp09.00.10.08' } },
];

const PROBE_FRAMES = 8;

// Kodiert ein paar Probebilder und prueft, ob die Chunks mit monoton steigenden
// Zeitstempeln herauskommen. Firefox' H.264 High/Main nutzt B-Frames und gibt die
// Chunks in Dekodierreihenfolge aus (33333, 99999, 66666 …). Der Muxer kann das
// nicht abbilden; wuerde man es erst mitten im Export merken, waere die Arbeit weg.
async function probeEncoder(config, width, height) {
  const timestamps = [];
  let failed = false;
  const encoder = new VideoEncoder({
    output: (chunk) => timestamps.push(chunk.timestamp),
    error: () => { failed = true; },
  });

  try {
    encoder.configure(config);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const frameUs = Math.round(1e6 / config.framerate);
    for (let index = 0; index < PROBE_FRAMES; index++) {
      ctx.fillStyle = `hsl(${index * 40}, 60%, 40%)`;
      ctx.fillRect(0, 0, width, height);
      const frame = new VideoFrame(canvas, { timestamp: index * frameUs, duration: frameUs });
      encoder.encode(frame, { keyFrame: index === 0 });
      frame.close();
    }
    await encoder.flush();
  } catch {
    return false;
  } finally {
    if (encoder.state !== 'closed') {
      encoder.close();
    }
  }

  const monotonic = timestamps.every((time, index) => index === 0 || time > timestamps[index - 1]);
  return !failed && timestamps.length === PROBE_FRAMES && monotonic;
}

// Liefert den ersten Kandidaten, den der Browser nicht nur kennt, sondern dessen
// Ausgabe der Muxer auch verarbeiten kann. null, wenn keiner taugt.
export async function chooseEncoderConfig({ width, height, fps }) {
  const bitrate = bitrateForSize(width, height);

  for (const candidate of ENCODER_CANDIDATES) {
    const config = { ...candidate.config, width, height, bitrate, framerate: fps };
    try {
      const { supported } = await VideoEncoder.isConfigSupported(config);
      if (supported && await probeEncoder(config, width, height)) {
        return { muxerCodec: candidate.muxerCodec, label: candidate.label, config };
      }
    } catch {
      // naechster Kandidat
    }
  }

  return null;
}

// --- Web-Mercator in Weltkoordinaten -------------------------------------------------
//
// u waechst nach Osten, v nach Sueden, beide in [0, 1). Ein Pixel liegt bei
// (u - originU) * scale, scale = Pixel je Weltbreite. So laesst sich ein Ausschnitt
// ohne Bezug zur Aufloesung beschreiben: Vorschau und Export zeigen dasselbe Bild.

const MAX_SCALE = TILE_SIZE * 2 ** MAX_ZOOM;
const MIN_SCALE = TILE_SIZE * 2;
const FRAME_PADDING = 0.08;
const MAX_TILE_ZOOM = 19;
const TILE_CACHE_LIMIT = 600;

export const AUTO_VIEW = Object.freeze({ mode: 'auto' });

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function toWorld(lat, lon) {
  const sin = Math.sin((clamp(lat, -85.0511287798, 85.0511287798) * Math.PI) / 180);
  return {
    u: (lon + 180) / 360,
    v: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI),
  };
}

// Die Vorschau zeichnet beim Ziehen dutzende Male neu; die Projektion von zehntausenden
// Punkten je Track soll dann nicht jedes Mal anfallen.
const worldCache = new WeakMap();

function worldPoints(track) {
  let points = worldCache.get(track.mapSamples);
  if (!points) {
    const count = track.mapSamples.length;
    points = { u: new Float64Array(count), v: new Float64Array(count) };
    track.mapSamples.forEach((sample, index) => {
      const world = toWorld(sample.lat, sample.lon);
      points.u[index] = world.u;
      points.v[index] = world.v;
    });
    worldCache.set(track.mapSamples, points);
  }
  return points;
}

function collectWorldBounds(tracks) {
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;

  for (const track of tracks) {
    const points = worldPoints(track);
    for (let index = 0; index < points.u.length; index++) {
      if (points.u[index] < minU) minU = points.u[index];
      if (points.u[index] > maxU) maxU = points.u[index];
      if (points.v[index] < minV) minV = points.v[index];
      if (points.v[index] > maxV) maxV = points.v[index];
    }
  }

  return Number.isFinite(minU) ? { minU, maxU, minV, maxV } : null;
}

// Massstab, bei dem alle Tracks mit Rand ins Bild passen.
function fitScale(bounds, width, height) {
  const padding = FRAME_PADDING * Math.min(width, height);
  const spanU = Math.max(bounds.maxU - bounds.minU, 1e-9);
  const spanV = Math.max(bounds.maxV - bounds.minV, 1e-9);
  return clamp(Math.min((width - 2 * padding) / spanU, (height - 2 * padding) / spanV), MIN_SCALE, MAX_SCALE);
}

/**
 * view: AUTO_VIEW (alle Tracks) oder { mode: 'manual', centerU, centerV, zoom }, wobei
 * zoom der Faktor gegenueber dem automatischen Ausschnitt ist.
 */
export function computeViewport(view, bounds, width, height) {
  const fit = fitScale(bounds, width, height);
  const manual = view?.mode === 'manual';
  const scale = clamp(fit * (manual ? view.zoom : 1), MIN_SCALE, MAX_SCALE);
  const centerU = manual ? view.centerU : (bounds.minU + bounds.maxU) / 2;
  const centerV = manual ? view.centerV : (bounds.minV + bounds.maxV) / 2;
  return {
    width,
    height,
    scale,
    fit,
    centerU,
    centerV,
    originU: centerU - width / (2 * scale),
    originV: centerV - height / (2 * scale),
  };
}

function toPixel(lat, lon, viewport) {
  const world = toWorld(lat, lon);
  return { x: (world.u - viewport.originU) * viewport.scale, y: (world.v - viewport.originV) * viewport.scale };
}

// --- Ausschnitt veraendern (Pixelangaben beziehen sich auf die Zeichenflaeche) ----------

export function panView(viewport, dxPixels, dyPixels) {
  return {
    mode: 'manual',
    centerU: viewport.centerU - dxPixels / viewport.scale,
    centerV: viewport.centerV - dyPixels / viewport.scale,
    zoom: viewport.scale / viewport.fit,
  };
}

// Zoomt so, dass der Weltpunkt unter (pixelX, pixelY) an Ort und Stelle bleibt.
export function zoomView(viewport, factor, pixelX, pixelY) {
  const scale = clamp(viewport.scale * factor, MIN_SCALE, MAX_SCALE);
  const u = viewport.originU + pixelX / viewport.scale;
  const v = viewport.originV + pixelY / viewport.scale;
  const originU = u - pixelX / scale;
  const originV = v - pixelY / scale;
  return {
    mode: 'manual',
    centerU: originU + viewport.width / (2 * scale),
    centerV: originV + viewport.height / (2 * scale),
    zoom: scale / viewport.fit,
  };
}

// Zoom ueber den Regler: um die Bildmitte, absolut gegenueber dem automatischen Ausschnitt.
export function setViewZoom(viewport, zoomFactor) {
  const scale = clamp(viewport.fit * zoomFactor, MIN_SCALE, MAX_SCALE);
  return { mode: 'manual', centerU: viewport.centerU, centerV: viewport.centerV, zoom: scale / viewport.fit };
}

// Uebernimmt einen Kartenausschnitt (z. B. von Leaflet) als Bildausschnitt: er wird
// vollstaendig ins Bild eingepasst.
export function viewFromLatLngBounds(latLngBounds, tracks, width, height) {
  const bounds = collectWorldBounds(tracks.filter((track) => track.mapSamples.length));
  if (!bounds) {
    return AUTO_VIEW;
  }

  const northWest = toWorld(latLngBounds.north, latLngBounds.west);
  const southEast = toWorld(latLngBounds.south, latLngBounds.east);
  const spanU = Math.max(southEast.u - northWest.u, 1e-9);
  const spanV = Math.max(southEast.v - northWest.v, 1e-9);
  const scale = clamp(Math.min(width / spanU, height / spanV), MIN_SCALE, MAX_SCALE);
  return {
    mode: 'manual',
    centerU: (northWest.u + southEast.u) / 2,
    centerV: (northWest.v + southEast.v) / 2,
    zoom: scale / fitScale(bounds, width, height),
  };
}

// --- Kacheln (mit Cache: Vorschau und Export teilen sich geladene Kacheln) --------------

const tileCache = new Map();

function loadTile(zoom, x, y) {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), TILE_TIMEOUT_MS);
    image.onload = () => {
      clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    image.src = `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
  });
}

function requestTile(zoom, x, y) {
  const key = `${zoom}/${x}/${y}`;
  let entry = tileCache.get(key);
  if (!entry) {
    entry = { image: null, promise: null };
    entry.promise = loadTile(zoom, x, y).then((image) => {
      entry.image = image;
      if (!image) {
        // Fehlgeschlagene Kacheln nicht merken, damit ein neuer Versuch moeglich bleibt.
        tileCache.delete(key);
      }
      return image;
    });
    tileCache.set(key, entry);
    if (tileCache.size > TILE_CACHE_LIMIT) {
      tileCache.delete(tileCache.keys().next().value);
    }
  }
  return entry;
}

// loadMissing=false zeichnet nur, was schon im Cache liegt (fluessiges Ziehen in der
// Vorschau); true laedt fehlende Kacheln nach.
async function drawTiles(ctx, viewport, { loadMissing, onProgress, signal }) {
  const tileZoom = clamp(Math.round(Math.log2(viewport.scale / TILE_SIZE)), 0, MAX_TILE_ZOOM);
  const worldTiles = 2 ** tileZoom;
  const firstX = Math.floor(viewport.originU * worldTiles);
  const lastX = Math.floor((viewport.originU + viewport.width / viewport.scale) * worldTiles);
  const firstY = Math.max(0, Math.floor(viewport.originV * worldTiles));
  const lastY = Math.min(worldTiles - 1, Math.floor((viewport.originV + viewport.height / viewport.scale) * worldTiles));

  const jobs = [];
  for (let tileY = firstY; tileY <= lastY; tileY++) {
    for (let tileX = firstX; tileX <= lastX; tileX++) {
      jobs.push({ tileX, tileY, wrappedX: ((tileX % worldTiles) + worldTiles) % worldTiles });
    }
  }

  const paint = (job, image) => {
    const left = Math.floor((job.tileX / worldTiles - viewport.originU) * viewport.scale);
    const top = Math.floor((job.tileY / worldTiles - viewport.originV) * viewport.scale);
    const right = Math.ceil(((job.tileX + 1) / worldTiles - viewport.originU) * viewport.scale);
    const bottom = Math.ceil(((job.tileY + 1) / worldTiles - viewport.originV) * viewport.scale);
    ctx.drawImage(image, left, top, right - left, bottom - top);
  };

  let drawn = 0;
  let failed = 0;

  if (loadMissing) {
    let done = 0;
    const images = await Promise.all(jobs.map(async (job) => {
      const image = await requestTile(tileZoom, job.wrappedX, job.tileY).promise;
      done++;
      onProgress?.(done, jobs.length);
      return image;
    }));
    signal?.throwIfAborted();
    images.forEach((image, index) => {
      if (image) {
        paint(jobs[index], image);
        drawn++;
      } else {
        failed++;
      }
    });
  } else {
    for (const job of jobs) {
      const image = tileCache.get(`${tileZoom}/${job.wrappedX}/${job.tileY}`)?.image;
      if (image) {
        paint(job, image);
        drawn++;
      } else {
        failed++;
      }
    }
  }

  return { total: jobs.length, failed, drawn, tileZoom };
}

// --- statische Ebene: Kacheln, Tracks, Legende, Attribution ---------------------------

function drawTracks(ctx, tracks, viewport, lineWidth) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = 0.9;

  for (const track of tracks) {
    const points = worldPoints(track);
    if (!points.u.length) {
      continue;
    }

    ctx.strokeStyle = track.color;
    ctx.beginPath();
    let lastX = 0;
    let lastY = 0;
    let skipped = false;
    for (let index = 0; index < points.u.length; index++) {
      const x = (points.u[index] - viewport.originU) * viewport.scale;
      const y = (points.v[index] - viewport.originV) * viewport.scale;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else if (Math.abs(x - lastX) >= 0.6 || Math.abs(y - lastY) >= 0.6) {
        // Punkte unter einem halben Pixel Abstand tragen nichts zum Bild bei.
        ctx.lineTo(x, y);
      } else {
        skipped = true;
        continue;
      }
      lastX = x;
      lastY = y;
      skipped = false;
    }
    if (skipped) {
      const last = points.u.length - 1;
      ctx.lineTo((points.u[last] - viewport.originU) * viewport.scale, (points.v[last] - viewport.originV) * viewport.scale);
    }
    ctx.stroke();
  }

  ctx.restore();
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

// Alle Groessen haengen an der kurzen Bildseite, damit Hoch- und Querformat gleich
// aussehen (720 kurze Seite = Referenz).
function drawLegend(ctx, tracks, width, height) {
  const unit = Math.min(width, height) / 720;
  const fontSize = Math.round(14 * unit);
  const margin = Math.round(16 * unit);
  const padX = Math.round(12 * unit);
  const padY = Math.round(8 * unit);
  const dot = Math.round(5 * unit);
  const gap = Math.round(16 * unit);
  const rowHeight = Math.round(fontSize * 1.5);
  const maxRowWidth = width - 2 * margin - 2 * padX;

  ctx.save();
  ctx.font = `${fontSize}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.textBaseline = 'middle';

  // Eintraege in Zeilen umbrechen, falls viele oder lange Namen.
  const items = tracks.map((track) => ({
    track,
    width: 2 * dot + Math.round(8 * unit) + ctx.measureText(track.name).width,
  }));
  const rows = [[]];
  let rowWidth = 0;
  for (const item of items) {
    const needed = item.width + (rows.at(-1).length ? gap : 0);
    if (rows.at(-1).length && rowWidth + needed > maxRowWidth) {
      rows.push([]);
      rowWidth = 0;
    }
    rowWidth += item.width + (rows.at(-1).length ? gap : 0);
    rows.at(-1).push(item);
  }

  const boxWidth = Math.min(
    maxRowWidth,
    Math.max(...rows.map((row) => row.reduce((sum, item, i) => sum + item.width + (i ? gap : 0), 0)))
  ) + 2 * padX;
  const boxHeight = rows.length * rowHeight + 2 * padY;

  ctx.fillStyle = 'rgba(8, 16, 28, 0.82)';
  roundedRect(ctx, margin, margin, boxWidth, boxHeight, Math.round(12 * unit));
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  rows.forEach((row, rowIndex) => {
    let x = margin + padX;
    const y = margin + padY + rowIndex * rowHeight + rowHeight / 2;
    for (const item of row) {
      ctx.fillStyle = item.track.color;
      ctx.beginPath();
      ctx.arc(x + dot, y, dot, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#eff5ff';
      ctx.fillText(item.track.name, x + 2 * dot + Math.round(8 * unit), y);
      x += item.width + gap;
    }
  });

  ctx.restore();
}

// Abstandszeile unten mittig, wie unter der Wiedergabe: Marker-Ringe, dazwischen
// "2,10 km / 3:40". Die Eintraege kommen fertig formatiert aus app.js (buildGapItems).
// Umgebrochen wird nur vor einem Abstand, damit Abstand und folgender Marker zusammenbleiben.
function drawGapBar(ctx, items, width, height) {
  if (!items?.length) {
    return;
  }

  const unit = Math.min(width, height) / 720;
  const fontSize = Math.round(15 * unit);
  const radius = Math.max(4, Math.round(7 * unit));
  const ring = Math.max(2, Math.round(2.5 * unit));
  const line = Math.round(14 * unit);
  const textPad = Math.round(6 * unit);
  const missingGap = Math.round(18 * unit);
  const padX = Math.round(14 * unit);
  const padY = Math.round(8 * unit);
  const margin = Math.round(16 * unit);
  // Platz fuer die OSM-Attribution in der rechten unteren Ecke.
  const bottom = margin + Math.round(22 * unit);
  const rowHeight = Math.max(Math.round(fontSize * 1.6), 2 * (radius + ring));
  const maxRowWidth = width - 2 * margin - 2 * padX;

  ctx.save();
  ctx.font = `600 ${fontSize}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.textBaseline = 'middle';

  const pieces = items.map((item, index) => {
    if (item.type === 'gap') {
      return { item, width: 2 * line + 2 * textPad + ctx.measureText(item.text).width };
    }
    const lead = item.missing && index > 0 && !items[index - 1].missing ? missingGap : 0;
    return { item, lead, width: lead + 2 * (radius + ring) };
  });

  const groups = [];
  for (const piece of pieces) {
    if (piece.item.type === 'gap' || !groups.length || (piece.lead && groups.at(-1).at(-1).item.type === 'marker')) {
      groups.push([piece]);
    } else {
      groups.at(-1).push(piece);
    }
  }

  const rows = [[]];
  let rowWidth = 0;
  for (const group of groups) {
    const groupWidth = group.reduce((sum, piece) => sum + piece.width, 0);
    if (rows.at(-1).length && rowWidth + groupWidth > maxRowWidth) {
      rows.push([]);
      rowWidth = 0;
    }
    rows.at(-1).push(...group);
    rowWidth += groupWidth;
  }

  const rowWidths = rows.map((row) => row.reduce((sum, piece) => sum + piece.width, 0));
  const boxWidth = Math.min(maxRowWidth, Math.max(...rowWidths)) + 2 * padX;
  const boxHeight = rows.length * rowHeight + 2 * padY;
  const boxX = (width - boxWidth) / 2;
  const boxY = height - bottom - boxHeight;

  ctx.fillStyle = 'rgba(8, 16, 28, 0.82)';
  roundedRect(ctx, boxX, boxY, boxWidth, boxHeight, Math.round(12 * unit));
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  rows.forEach((row, rowIndex) => {
    let x = (width - rowWidths[rowIndex]) / 2;
    const y = boxY + padY + rowIndex * rowHeight + rowHeight / 2;
    for (const piece of row) {
      const { item } = piece;
      if (item.type === 'gap') {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = Math.max(1, Math.round(1.5 * unit));
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + line, y);
        ctx.moveTo(x + piece.width - line, y);
        ctx.lineTo(x + piece.width, y);
        ctx.stroke();
        ctx.fillStyle = '#eff5ff';
        ctx.fillText(item.text, x + line + textPad, y);
        x += piece.width;
      } else {
        const cx = x + piece.lead + radius + ring;
        ctx.globalAlpha = item.missing ? 0.4 : 1;
        ctx.beginPath();
        ctx.arc(cx, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = '#06131b';
        ctx.fill();
        ctx.lineWidth = ring;
        ctx.strokeStyle = item.color;
        ctx.stroke();
        ctx.globalAlpha = 1;
        x += piece.width;
      }
    }
  });

  ctx.restore();
}

// Lizenzpflicht der OSM-Kacheln.
function drawAttribution(ctx, width, height) {
  const unit = Math.min(width, height) / 720;
  const fontSize = Math.round(11 * unit);
  const text = t('map.attribution');

  ctx.save();
  ctx.font = `${fontSize}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  const padX = Math.round(6 * unit);
  const boxWidth = ctx.measureText(text).width + 2 * padX;
  const boxHeight = Math.round(fontSize * 1.8);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.fillRect(width - boxWidth, height - boxHeight, boxWidth, boxHeight);
  ctx.fillStyle = '#333';
  ctx.fillText(text, width - boxWidth + padX, height - boxHeight / 2);
  ctx.restore();
}

async function paintBase(ctx, tracks, viewport, { loadMissing, onTileProgress, signal }) {
  const { width, height } = viewport;
  ctx.fillStyle = '#0b1626';
  ctx.fillRect(0, 0, width, height);

  const tiles = await drawTiles(ctx, viewport, { loadMissing, onProgress: onTileProgress, signal });
  drawTracks(ctx, tracks, viewport, Math.max(3, Math.round(Math.min(width, height) / 180)));
  drawLegend(ctx, tracks, width, height);
  if (tiles.drawn > 0) {
    drawAttribution(ctx, width, height);
  }
  return tiles;
}

function drawMarkers(ctx, tracks, viewport, time) {
  const unit = Math.min(viewport.width, viewport.height);
  const radius = Math.max(5, Math.round(unit / 90));
  const lineWidth = Math.max(2, Math.round(unit / 240));

  for (const track of tracks) {
    const position = track.positionAt(time);
    if (!position) {
      continue;
    }
    const point = toPixel(position.lat, position.lon, viewport);
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#06131b';
    ctx.fill();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = track.color;
    ctx.stroke();
  }
}

/**
 * Zeichnet die Vorschau auf ein bestehendes Canvas und liefert den verwendeten
 * Viewport zurueck (die Oberflaeche braucht ihn zum Verschieben und Zoomen).
 * loadMissing=false: nur schon geladene Kacheln, ohne Netzwerk.
 */
export async function renderPreview(canvas, { tracks, view, time, gapsAt = null, loadMissing, signal }) {
  const drawable = tracks.filter((track) => track.mapSamples.length);
  const ctx = canvas.getContext('2d');
  const bounds = collectWorldBounds(drawable);
  if (!bounds) {
    ctx.fillStyle = '#0b1626';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return null;
  }

  const viewport = computeViewport(view, bounds, canvas.width, canvas.height);
  const tiles = await paintBase(ctx, drawable, viewport, { loadMissing, signal });
  signal?.throwIfAborted();
  drawMarkers(ctx, drawable, viewport, time);
  if (gapsAt) {
    drawGapBar(ctx, gapsAt(time), canvas.width, canvas.height);
  }
  return { viewport, tiles };
}

// --- avcC reparieren ---------------------------------------------------------------
//
// Der Muxer uebernimmt decoderConfig.description des Encoders unveraendert als
// avcC-Box. Firefox' Beschreibung ist nicht wohlgeformt: die Pflichtbits fehlen
// (03 01 statt FF E1) und SPS/PPS tragen ein doppeltes NAL-Kopfbyte (67 67 42 …).
// Firefox selbst liest die Parameter-Sets still aus dem Videostrom und spielt die
// Datei trotzdem ab. Die Windows-Medienwiedergabe haelt sich strikt an avcC, liest
// daraus 16x32 Pixel und findet keinen Decoder (MF_E_TOPO_CODEC_NOT_FOUND).

function isWellFormedAvcC(bytes) {
  if (bytes.length < 11 || bytes[0] !== 1) {
    return false;
  }
  if ((bytes[4] & 0xfc) !== 0xfc || (bytes[5] & 0xe0) !== 0xe0 || (bytes[5] & 0x1f) < 1) {
    return false;
  }

  const spsLength = (bytes[6] << 8) | bytes[7];
  const sps = bytes.subarray(8, 8 + spsLength);
  // Der SPS muss mit NAL-Typ 7 beginnen, und die drei Folgebytes (profile, constraint
  // flags, level) muessen den Kopfwerten der avcC entsprechen.
  if (sps.length !== spsLength || (sps[0] & 0x1f) !== 7
    || sps[1] !== bytes[1] || sps[2] !== bytes[2] || sps[3] !== bytes[3]) {
    return false;
  }

  const ppsCountOffset = 8 + spsLength;
  if (bytes.length < ppsCountOffset + 3 || bytes[ppsCountOffset] < 1) {
    return false;
  }
  const ppsLength = (bytes[ppsCountOffset + 1] << 8) | bytes[ppsCountOffset + 2];
  const pps = bytes.subarray(ppsCountOffset + 3, ppsCountOffset + 3 + ppsLength);
  return pps.length === ppsLength && (pps[0] & 0x1f) === 8;
}

// Zerlegt ein Sample im AVC-Format (laengenpraefixierte NAL-Einheiten).
function readNalUnits(data, lengthSize) {
  const units = [];
  let position = 0;
  while (position + lengthSize <= data.length) {
    let length = 0;
    for (let i = 0; i < lengthSize; i++) {
      length = (length * 256) + data[position + i];
    }
    position += lengthSize;
    if (length === 0 || position + length > data.length) {
      return null;
    }
    units.push(data.subarray(position, position + length));
    position += length;
  }
  return units;
}

// Baut eine wohlgeformte avcC aus den Parameter-Sets, die im ersten Keyframe stecken.
function buildAvcCFromSample(data) {
  const units = readNalUnits(data, 4);
  if (!units) {
    return null;
  }

  const sps = units.filter((unit) => (unit[0] & 0x1f) === 7);
  const pps = units.filter((unit) => (unit[0] & 0x1f) === 8);
  if (!sps.length || !pps.length || sps[0].length < 4) {
    return null;
  }

  const parts = [[1, sps[0][1], sps[0][2], sps[0][3], 0xff, 0xe0 | sps.length]];
  for (const unit of sps) {
    parts.push([unit.length >> 8, unit.length & 0xff], unit);
  }
  parts.push([pps.length]);
  for (const unit of pps) {
    parts.push([unit.length >> 8, unit.length & 0xff], unit);
  }

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

// Gibt meta unveraendert zurueck, wenn die Beschreibung in Ordnung ist (Chrome/Edge),
// sonst eine Kopie mit neu aufgebauter avcC. Kann sie nicht repariert werden, bleibt
// das Original; der Aufrufer meldet das dann nicht als Fehler, die Datei laeuft dann
// zumindest in Browsern.
function repairAvcMeta(chunk, meta) {
  const description = meta?.decoderConfig?.description;
  if (!description) {
    return meta;
  }

  const bytes = description instanceof ArrayBuffer
    ? new Uint8Array(description)
    : new Uint8Array(description.buffer, description.byteOffset, description.byteLength);
  if (isWellFormedAvcC(bytes)) {
    return meta;
  }

  const data = new Uint8Array(chunk.byteLength);
  chunk.copyTo(data);
  const rebuilt = buildAvcCFromSample(data);
  if (!rebuilt || !isWellFormedAvcC(rebuilt)) {
    return meta;
  }

  return { ...meta, decoderConfig: { ...meta.decoderConfig, description: rebuilt } };
}

// --- Export ------------------------------------------------------------------------

/**
 * @param {object} options
 * @param {{name: string, color: string, mapSamples: Array<{lat:number, lon:number}>,
 *          positionAt: (overallTime:number) => ({lat:number, lon:number}|null)}[]} options.tracks
 * @param {number} options.duration   Gesamtdauer der gemeinsamen Zeitachse in Sekunden
 * @param {number} options.speed      Wiedergabefaktor (60 = eine Videosekunde zeigt eine Minute)
 * @param {number} options.width
 * @param {number} options.height
 * @param {number} options.fps
 * @param {object} [options.view]     Kartenausschnitt (AUTO_VIEW = alle Tracks)
 * @param {(time: number) => Array|null} [options.gapsAt]  Abstandszeile je Zeitpunkt (null = keine)
 * @param {(info: {phase: string, ratio: number, text: string}) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 */
export async function exportVideo({ tracks, duration, speed, width, height, fps, view = AUTO_VIEW, gapsAt = null, onProgress, signal }) {
  if (!isVideoExportSupported()) {
    throw new Error(t('video.err.noWebCodecs'));
  }

  const drawable = tracks.filter((track) => track.mapSamples.length);
  const bounds = collectWorldBounds(drawable);
  if (!bounds) {
    throw new Error(t('video.err.noPositions'));
  }

  const choice = await chooseEncoderConfig({ width, height, fps });
  if (!choice) {
    throw new Error(t('video.err.noCodec'));
  }

  signal?.throwIfAborted();
  const { Muxer, ArrayBufferTarget } = await import(MUXER_URL);

  // --- statische Ebene aufbauen
  const viewport = computeViewport(view, bounds, width, height);
  const base = new OffscreenCanvas(width, height);
  const tiles = await paintBase(base.getContext('2d'), drawable, viewport, {
    loadMissing: true,
    signal,
    onTileProgress: (done, total) => {
      onProgress?.({ phase: 'tiles', ratio: done / total, text: t('video.progress.tiles', { done, total }) });
    },
  });

  // --- Encoder und Muxer
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: choice.muxerCodec, width, height, frameRate: fps },
    fastStart: 'in-memory',
    // Firefox' Encoder beginnt nicht bei Zeitstempel 0; 'offset' schiebt alles passend.
    firstTimestampBehavior: 'offset',
  });

  let encoderError = null;
  let chunkCount = 0;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      // Wirft der Muxer hier, erreicht das den error-Callback des Encoders nicht.
      // Ohne diesen try/catch entstuende still eine leere Datei.
      try {
        muxer.addVideoChunk(chunk, choice.muxerCodec === 'avc' ? repairAvcMeta(chunk, meta) : meta);
        chunkCount++;
      } catch (error) {
        encoderError ??= error;
      }
    },
    error: (error) => { encoderError ??= error; },
  });
  encoder.configure(choice.config);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const frameCount = Math.max(2, Math.ceil((duration / speed) * fps) + 1);
  const frameDurationUs = Math.round(1e6 / fps);

  try {
    for (let index = 0; index < frameCount; index++) {
      signal?.throwIfAborted();
      if (encoderError) {
        throw encoderError;
      }

      // Backpressure: nicht schneller rendern, als der Encoder abarbeitet.
      while (encoder.encodeQueueSize > MAX_ENCODE_QUEUE) {
        await new Promise((resolve) => encoder.addEventListener('dequeue', resolve, { once: true }));
      }

      const time = Math.min(duration, (index * speed) / fps);
      ctx.drawImage(base, 0, 0);
      drawMarkers(ctx, drawable, viewport, time);
      if (gapsAt) {
        drawGapBar(ctx, gapsAt(time), width, height);
      }

      const frame = new VideoFrame(canvas, { timestamp: index * frameDurationUs, duration: frameDurationUs });
      encoder.encode(frame, { keyFrame: index % (fps * 2) === 0 });
      frame.close();

      // Der Oberflaeche Luft lassen, damit Fortschritt und Abbrechen reagieren.
      if (index % 10 === 0) {
        onProgress?.({ phase: 'render', ratio: index / frameCount, text: t('video.progress.render', { index: index + 1, total: frameCount }) });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    onProgress?.({ phase: 'finish', ratio: 1, text: t('video.progress.finish') });
    await encoder.flush();
    if (encoderError) {
      throw encoderError;
    }
    if (chunkCount === 0) {
      throw new Error(t('video.err.noFrames', { codec: choice.label }));
    }
    if (chunkCount < frameCount * 0.9) {
      throw new Error(t('video.err.incomplete', { chunks: chunkCount, frames: frameCount }));
    }
    muxer.finalize();
  } finally {
    if (encoder.state !== 'closed') {
      encoder.close();
    }
  }

  return {
    blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }),
    frameCount,
    codec: choice.label,
    zoom: tiles.tileZoom,
    tilesFailed: tiles.failed,
    tilesTotal: tiles.total,
  };
}
