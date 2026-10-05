// Rendert die Karte mit allen Tracks und den wandernden Positionsmarkern Bild fuer
// Bild auf ein Canvas und kodiert das Ergebnis mit WebCodecs zu einer MP4-Datei.
// Alles laeuft im Browser; ueber das Netz geht nur das einmalige Laden der
// OSM-Kacheln fuer den festen Kartenausschnitt.

const TILE_SIZE = 256;
const MIN_ZOOM = 2;
const MAX_ZOOM = 18;
const TILE_TIMEOUT_MS = 15000;
const MUXER_URL = 'https://esm.sh/mp4-muxer@5.1.3';
const MAX_ENCODE_QUEUE = 8;

// Ziel-Bitraten je Hoehe. Die Karte ist fast statisch und braucht in der Praxis
// weniger; das ist die Obergrenze, mit der auch die Groessenschaetzung rechnet.
export function bitrateForHeight(height) {
  if (height >= 1080) return 8_000_000;
  if (height >= 720) return 4_000_000;
  return 1_500_000;
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
  const bitrate = bitrateForHeight(height);

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

// --- Web-Mercator, wie Leaflet/OSM ihn verwenden ---------------------------------

function project(lat, lon, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  const clampedLat = Math.max(-85.0511287798, Math.min(85.0511287798, lat));
  const sin = Math.sin((clampedLat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function collectBounds(tracks) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  for (const track of tracks) {
    for (const sample of track.mapSamples) {
      if (sample.lat < minLat) minLat = sample.lat;
      if (sample.lat > maxLat) maxLat = sample.lat;
      if (sample.lon < minLon) minLon = sample.lon;
      if (sample.lon > maxLon) maxLon = sample.lon;
    }
  }

  return Number.isFinite(minLat) ? { minLat, maxLat, minLon, maxLon } : null;
}

// Groesster ganzzahliger Zoom, bei dem der gepolsterte Ausschnitt ins Bild passt.
function fitViewport(bounds, width, height) {
  const padding = Math.round(0.08 * Math.min(width, height));

  for (let zoom = MAX_ZOOM; zoom >= MIN_ZOOM; zoom--) {
    const topLeft = project(bounds.maxLat, bounds.minLon, zoom);
    const bottomRight = project(bounds.minLat, bounds.maxLon, zoom);
    const fits = (bottomRight.x - topLeft.x) <= width - 2 * padding
      && (bottomRight.y - topLeft.y) <= height - 2 * padding;

    if (fits || zoom === MIN_ZOOM) {
      return {
        zoom,
        originX: (topLeft.x + bottomRight.x) / 2 - width / 2,
        originY: (topLeft.y + bottomRight.y) / 2 - height / 2,
      };
    }
  }

  return null;
}

// --- Kacheln ---------------------------------------------------------------------

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

async function drawTiles(ctx, viewport, width, height, onProgress, signal) {
  const worldTiles = 2 ** viewport.zoom;
  const firstX = Math.floor(viewport.originX / TILE_SIZE);
  const lastX = Math.floor((viewport.originX + width) / TILE_SIZE);
  const firstY = Math.max(0, Math.floor(viewport.originY / TILE_SIZE));
  const lastY = Math.min(worldTiles - 1, Math.floor((viewport.originY + height) / TILE_SIZE));

  const jobs = [];
  for (let tileY = firstY; tileY <= lastY; tileY++) {
    for (let tileX = firstX; tileX <= lastX; tileX++) {
      jobs.push({ tileX, tileY, wrappedX: ((tileX % worldTiles) + worldTiles) % worldTiles });
    }
  }

  let done = 0;
  let failed = 0;
  await Promise.all(jobs.map(async (job) => {
    const image = await loadTile(viewport.zoom, job.wrappedX, job.tileY);
    signal?.throwIfAborted();
    done++;
    onProgress?.(done, jobs.length);
    if (!image) {
      failed++;
      return;
    }
    ctx.drawImage(image, job.tileX * TILE_SIZE - viewport.originX, job.tileY * TILE_SIZE - viewport.originY);
  }));

  return { total: jobs.length, failed };
}

// --- statische Ebene: Kacheln, Tracks, Legende, Attribution -------------------------

function drawTracks(ctx, tracks, viewport, lineWidth) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = 0.9;

  for (const track of tracks) {
    if (!track.mapSamples.length) {
      continue;
    }

    ctx.strokeStyle = track.color;
    ctx.beginPath();
    track.mapSamples.forEach((sample, index) => {
      const point = project(sample.lat, sample.lon, viewport.zoom);
      const x = point.x - viewport.originX;
      const y = point.y - viewport.originY;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
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

function drawLegend(ctx, tracks, width, height) {
  const unit = height / 720;
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

// Lizenzpflicht der OSM-Kacheln.
function drawAttribution(ctx, width, height) {
  const unit = height / 720;
  const fontSize = Math.round(11 * unit);
  const text = '© OpenStreetMap-Mitwirkende';

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
 * @param {(info: {phase: string, ratio: number, text: string}) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal]
 */
export async function exportVideo({ tracks, duration, speed, width, height, fps, onProgress, signal }) {
  if (!isVideoExportSupported()) {
    throw new Error('Dieser Browser unterstützt keinen Videoexport (WebCodecs). Bitte Chrome oder Edge verwenden.');
  }

  const drawable = tracks.filter((track) => track.mapSamples.length);
  const bounds = collectBounds(drawable);
  if (!bounds) {
    throw new Error('Keine Positionsdaten vorhanden – ohne GPS gibt es keine Karte zu exportieren.');
  }

  const choice = await chooseEncoderConfig({ width, height, fps });
  if (!choice) {
    throw new Error('Der Browser kann weder H.264 noch VP9 kodieren.');
  }

  signal?.throwIfAborted();
  const { Muxer, ArrayBufferTarget } = await import(MUXER_URL);

  // --- statische Ebene aufbauen
  const viewport = fitViewport(bounds, width, height);
  const base = new OffscreenCanvas(width, height);
  const baseCtx = base.getContext('2d');
  baseCtx.fillStyle = '#0b1626';
  baseCtx.fillRect(0, 0, width, height);

  const tiles = await drawTiles(baseCtx, viewport, width, height, (done, total) => {
    onProgress?.({ phase: 'tiles', ratio: done / total, text: `Lade Kartenkacheln (${done}/${total}) …` });
  }, signal);

  drawTracks(baseCtx, drawable, viewport, Math.max(3, Math.round(height / 180)));
  drawLegend(baseCtx, drawable, width, height);
  if (tiles.failed < tiles.total) {
    drawAttribution(baseCtx, width, height);
  }

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
        muxer.addVideoChunk(chunk, meta);
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
  const markerRadius = Math.max(5, Math.round(height / 90));
  const markerWidth = Math.max(2, Math.round(height / 240));
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
      for (const track of drawable) {
        const position = track.positionAt(time);
        if (!position) {
          continue;
        }
        const point = project(position.lat, position.lon, viewport.zoom);
        ctx.beginPath();
        ctx.arc(point.x - viewport.originX, point.y - viewport.originY, markerRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#06131b';
        ctx.fill();
        ctx.lineWidth = markerWidth;
        ctx.strokeStyle = track.color;
        ctx.stroke();
      }

      const frame = new VideoFrame(canvas, { timestamp: index * frameDurationUs, duration: frameDurationUs });
      encoder.encode(frame, { keyFrame: index % (fps * 2) === 0 });
      frame.close();

      // Der Oberflaeche Luft lassen, damit Fortschritt und Abbrechen reagieren.
      if (index % 10 === 0) {
        onProgress?.({ phase: 'render', ratio: index / frameCount, text: `Rendere Bild ${index + 1}/${frameCount} …` });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    onProgress?.({ phase: 'finish', ratio: 1, text: 'Schließe die Datei ab …' });
    await encoder.flush();
    if (encoderError) {
      throw encoderError;
    }
    if (chunkCount === 0) {
      throw new Error(`Der ${choice.label}-Encoder dieses Browsers hat kein einziges Bild geliefert.`);
    }
    if (chunkCount < frameCount * 0.9) {
      throw new Error(`Der Encoder lieferte nur ${chunkCount} von ${frameCount} Bildern; die Datei w\u00e4re unvollst\u00e4ndig.`);
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
    zoom: viewport.zoom,
    tilesFailed: tiles.failed,
    tilesTotal: tiles.total,
  };
}
