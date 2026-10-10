/*
 * FITcomparer
 * Copyright (c) 2026 Tobias Scheipel
 * SPDX-License-Identifier: MIT
 * See the LICENSE file in the project root for the full license text.
 */

// Abstand zwischen den Markern entlang der Strecke.
//
// Die Distanzzaehler der Dateien taugen dafuer nicht: Jedes Geraet misst etwas anders,
// auf 200 km laufen sie um 0,3 bis 0,5 km auseinander (gemessen an den Istria-Dateien).
// Stattdessen wird jede Position auf die Linie einer Referenzspur projiziert. Die km der
// Referenzspur an dieser Stelle sind die gemeinsame Streckenkoordinate. Gesucht wird nur
// vorwaerts in einem Fenster um die letzte Stelle, damit Schleifen und Hin-und-zurueck-
// Abschnitte nicht verwechselt werden. Das Fenster ist in km bemessen, nicht in
// Messpunkten: steht die Referenz minutenlang (Pause), kaeme die Suche sonst nicht weiter.

const COURSE_STEP_M = 10;
const MATCH_MAX_OFFSET_M = 100;
const MATCH_BACK_KM = 0.3;
const MATCH_AHEAD_KM = 1.5;
// Nach so vielen Punkten neben der Strecke wird weiter vorne gesucht (Umweg, Abkuerzung).
const MATCH_LOST_SAMPLES = 30;
const MATCH_LOST_AHEAD_KM = 30;
const MATCH_LOST_STRIDE = 10;
const CROSS_MAX_DISTANCE_M = 50;
// Laenger neben der Strecke: kein Abstand mehr, statt einen alten Wert stehen zu lassen.
const OFF_ROUTE_HOLD_SECONDS = 60;

const AUTO_START_MIN_KM = 0.2;
const AUTO_START_STEP_KM = 0.025;
const AUTO_START_MAX_SHARE = 0.5;
const AUTO_START_RADIUS_M = 25;
const GRID_CELL_M = 50;

const METERS_PER_DEGREE_LAT = 110540;
const METERS_PER_DEGREE_LON_EQUATOR = 111320;

function createProjector(latitude) {
  const kx = METERS_PER_DEGREE_LON_EQUATOR * Math.cos((latitude * Math.PI) / 180);
  return (lat, lon) => [lon * kx, lat * METERS_PER_DEGREE_LAT];
}

// Kleinster Index i mit values[i] >= target (values aufsteigend).
function lowerBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/**
 * Referenzstrecke aus den GPS-Punkten einer Spur: alle 10 m ein Punkt, km aus der
 * Distanz der Datei (damit die km zu dem passen, was die Referenzdatei selbst zeigt).
 */
export function buildCourse(mapSamples) {
  const usable = mapSamples.filter((sample) => Number.isFinite(sample.distance));
  if (usable.length < 2) {
    return null;
  }

  const project = createProjector(usable[0].lat);
  const lat = [];
  const lon = [];
  const x = [];
  const y = [];
  const km = [];
  let lastX = null;
  let lastY = null;
  let maxKm = -Infinity;

  for (const sample of usable) {
    const [px, py] = project(sample.lat, sample.lon);
    maxKm = Math.max(maxKm, sample.distance);
    if (lastX !== null && Math.hypot(px - lastX, py - lastY) < COURSE_STEP_M) {
      continue;
    }
    lat.push(sample.lat);
    lon.push(sample.lon);
    x.push(px);
    y.push(py);
    km.push(maxKm);
    lastX = px;
    lastY = py;
  }

  if (km.length < 2) {
    return null;
  }

  return { project, lat, lon, x, y, km, totalKm: km[km.length - 1] - km[0] };
}

// Naechster Punkt auf den Segmenten [first, last) der Strecke.
function projectOntoCourse(course, px, py, first, last) {
  let best = null;
  const end = Math.min(last, course.x.length - 1);
  for (let index = Math.max(0, first); index < end; index++) {
    const ax = course.x[index];
    const ay = course.y[index];
    const dx = course.x[index + 1] - ax;
    const dy = course.y[index + 1] - ay;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
    const distance = Math.hypot(px - (ax + ratio * dx), py - (ay + ratio * dy));
    if (!best || distance < best.distance) {
      best = {
        distance,
        index,
        km: course.km[index] + ratio * (course.km[index + 1] - course.km[index]),
      };
    }
  }
  return best;
}

/** Naechster Streckenpunkt zu einer Koordinate (Kartenklick). */
export function snapToCourse(course, lat, lon) {
  const [px, py] = course.project(lat, lon);
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < course.x.length; index++) {
    const distance = Math.hypot(course.x[index] - px, course.y[index] - py);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return { index: bestIndex, lat: course.lat[bestIndex], lon: course.lon[bestIndex], km: course.km[bestIndex] };
}

function buildGrid(course, mapSamples) {
  const grid = new Map();
  const limit = Math.max(1, Math.ceil(mapSamples.length * AUTO_START_MAX_SHARE));
  for (let index = 0; index < limit; index++) {
    const sample = mapSamples[index];
    const [px, py] = course.project(sample.lat, sample.lon);
    const key = `${Math.floor(px / GRID_CELL_M)},${Math.floor(py / GRID_CELL_M)}`;
    let cell = grid.get(key);
    if (!cell) {
      cell = [];
      grid.set(key, cell);
    }
    cell.push(px, py);
  }
  return grid;
}

function gridHasPointNear(grid, px, py, radius) {
  const cx = Math.floor(px / GRID_CELL_M);
  const cy = Math.floor(py / GRID_CELL_M);
  for (let ix = cx - 1; ix <= cx + 1; ix++) {
    for (let iy = cy - 1; iy <= cy + 1; iy++) {
      const cell = grid.get(`${ix},${iy}`);
      if (!cell) {
        continue;
      }
      for (let k = 0; k < cell.length; k += 2) {
        if (Math.hypot(cell[k] - px, cell[k + 1] - py) <= radius) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Erste Stelle der Referenzstrecke (ab 200 m nach ihrem Start), an der alle anderen
 * Spuren in der ersten Haelfte ihrer Aufzeichnung naeher als 25 m vorbeikommen.
 * Die Einschraenkung auf die erste Haelfte verhindert bei Rundkursen, dass das Ziel
 * einer spaeter gestarteten Spur als ihr Start gilt.
 */
export function findAutoStart(course, otherMapSamples) {
  const grids = otherMapSamples.filter((samples) => samples.length).map((samples) => buildGrid(course, samples));
  const firstKm = course.km[0] + AUTO_START_MIN_KM;
  const lastKm = course.km[0] + course.totalKm * AUTO_START_MAX_SHARE;
  let nextKm = firstKm;

  for (let index = lowerBound(course.km, firstKm); index < course.km.length && course.km[index] <= lastKm; index++) {
    if (course.km[index] < nextKm) {
      continue;
    }
    nextKm = course.km[index] + AUTO_START_STEP_KM;
    const px = course.x[index];
    const py = course.y[index];
    if (grids.every((grid) => gridHasPointNear(grid, px, py, AUTO_START_RADIUS_M))) {
      return { index, lat: course.lat[index], lon: course.lon[index], km: course.km[index] };
    }
  }
  return null;
}

/**
 * Bildet eine Spur auf die Strecke ab. Ab dem ersten Vorbeikommen an der Startlinie
 * bekommt jeder GPS-Punkt seinen Strecken-km. Punkte mehr als 100 m neben der
 * Strecke behalten den letzten km und merken sich, seit wann sie daneben liegen.
 * Ergebnis null, wenn die Spur nie an der Startlinie vorbeikommt.
 */
export function matchTrack(course, mapSamples, start) {
  const sx = course.x[start.index];
  const sy = course.y[start.index];
  const points = mapSamples.map((sample) => course.project(sample.lat, sample.lon));

  // Startlinie: tiefster Punkt der ersten Annaeherung unter 50 m.
  let crossIndex = -1;
  let crossDistance = Infinity;
  for (let index = 0; index < points.length; index++) {
    const distance = Math.hypot(points[index][0] - sx, points[index][1] - sy);
    if (distance <= CROSS_MAX_DISTANCE_M) {
      if (distance < crossDistance) {
        crossDistance = distance;
        crossIndex = index;
      }
    } else if (crossIndex >= 0) {
      break;
    }
  }
  if (crossIndex < 0) {
    return null;
  }

  const count = points.length - crossIndex;
  const t = new Float64Array(count);
  const km = new Float64Array(count);
  const kmMax = new Float64Array(count);
  const offSince = new Float64Array(count);
  let courseIndex = start.index;
  let currentKm = start.km;
  let lost = 0;
  let runningMax = start.km;
  let offStart = NaN;
  let offCount = 0;

  for (let k = 0; k < count; k++) {
    const sampleIndex = crossIndex + k;
    const [px, py] = points[sampleIndex];
    t[k] = mapSamples[sampleIndex].t;

    let match = null;
    if (k === 0) {
      match = { distance: 0, index: start.index, km: start.km };
    } else if (lost < MATCH_LOST_SAMPLES || lost % MATCH_LOST_STRIDE === 0) {
      const ahead = lost < MATCH_LOST_SAMPLES ? MATCH_AHEAD_KM : MATCH_LOST_AHEAD_KM;
      const first = lowerBound(course.km, course.km[courseIndex] - MATCH_BACK_KM);
      const last = lowerBound(course.km, course.km[courseIndex] + ahead) + 1;
      match = projectOntoCourse(course, px, py, first, last);
    }

    if (match && match.distance <= MATCH_MAX_OFFSET_M) {
      courseIndex = match.index;
      currentKm = match.km;
      lost = 0;
      offStart = NaN;
    } else {
      lost++;
      offCount++;
      if (Number.isNaN(offStart)) {
        offStart = t[k];
      }
    }

    runningMax = Math.max(runningMax, currentKm);
    km[k] = currentKm;
    kmMax[k] = runningMax;
    offSince[k] = offStart;
  }

  return { crossTime: t[0], t, km, kmMax, offSince, offShare: offCount / count };
}

/** Strecken-km einer Spur zu ihrer eigenen Zeit; null vor der Startlinie oder lange abseits. */
export function courseKmAt(match, time) {
  const { t, km, offSince } = match;
  if (!Number.isFinite(time) || time < t[0]) {
    return null;
  }

  const last = t.length - 1;
  let index = last;
  if (time < t[last]) {
    index = lowerBound(t, time);
    if (t[index] > time) {
      index--;
    }
  }

  if (Number.isFinite(offSince[index]) && time - offSince[index] > OFF_ROUTE_HOLD_SECONDS) {
    return null;
  }
  if (index === last || Number.isFinite(offSince[index]) || Number.isFinite(offSince[index + 1])) {
    return km[index];
  }

  const ratio = (time - t[index]) / Math.max(t[index + 1] - t[index], 0.001);
  return km[index] + ratio * (km[index + 1] - km[index]);
}

/** Eigene Zeit, zu der die Spur zum ersten Mal den Strecken-km erreicht hat; null, wenn nie. */
export function timeWhenAtKm(match, targetKm) {
  const { t, kmMax } = match;
  if (targetKm <= kmMax[0]) {
    return t[0];
  }
  if (targetKm > kmMax[kmMax.length - 1]) {
    return null;
  }

  const index = lowerBound(kmMax, targetKm);
  const before = kmMax[index - 1];
  const ratio = (targetKm - before) / Math.max(kmMax[index] - before, 1e-9);
  return t[index - 1] + ratio * (t[index] - t[index - 1]);
}
