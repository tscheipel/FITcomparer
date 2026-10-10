/*
 * FITcomparer
 * Copyright (c) 2026 Tobias Scheipel
 * SPDX-License-Identifier: MIT
 * See the LICENSE file in the project root for the full license text.
 */

import { LANG, t } from './i18n.js?v=14';

// Kleine ?-Symbole mit Erklaerung. Im Markup steht nur
//   <button type="button" class="help" data-help="offset">?</button>
// Texte und Verhalten kommen von hier. Das Wiring haengt per Event-Delegation am
// Dokument; deshalb funktionieren auch Buttons in <template>-Klonen (Dateikarten)
// ohne zusaetzlichen Code.

const HELP_DE = {
  file: {
    title: 'Dateien laden und benennen',
    body: [
      'Wähle eine FIT-Datei, eine GPX-Datei oder direkt das ZIP aus Garmin Connect (Zahnrad → „Datei exportieren"). FIT-Dateien von Wahoo, COROS, Suunto, Polar, Strava und anderen funktionieren genauso, auch als .gz. Du kannst sie auch einfach auf die Karte ziehen. Die Datei wird nur in deinem Browser verarbeitet.',
      'Den Namen kannst du frei ändern, zum Beispiel in „Tobi 2025". Er erscheint überall: in den Tabellen, im Graphen, in der Kartenlegende und im exportierten Video.',
      'Der Farbpunkt legt die Farbe der Aktivität fest, mit × entfernst du die Datei wieder.',
    ],
  },
  addFile: {
    title: 'Weitere Aktivität hinzufügen',
    body: [
      'Du kannst bis zu 6 Aktivitäten gleichzeitig vergleichen. Mit × an einer Dateikarte entfernst du sie wieder; mindestens zwei Karten bleiben stehen.',
    ],
  },
  offset: {
    title: 'Start-Offset',
    body: [
      'Gleicht unterschiedliche Startzeitpunkte aus. Bei Rennen oder gemeinsamen Ausfahrten beginnen die Aufzeichnungen selten im selben Moment: Eine Uhr läuft früher an, eine andere später.',
      'Mit dem Offset verschiebst du diese Aktivität gegenüber Datei 1, bis markante Stellen (Startschuss, Kreuzung, Anstieg) deckungsgleich laufen. Datei 1 ist die Referenz und bleibt unverändert.',
      'Eingabe als mm:ss, auch negativ.',
    ],
  },
  compare: {
    title: 'Gesamtvergleich',
    body: [
      'Hier stehen die Kennzahlen aller Aktivitäten nebeneinander: Zeilen sind die Messwerte, Spalten die Dateien.',
      'Oben siehst du die Werte, die dein Gerät selbst gespeichert hat, darunter dieselben Werte aus den Messpunkten nachgerechnet.',
    ],
  },
  deviceValues: {
    title: 'Gerätewerte',
    body: [
      'Diese Zahlen hat deine Uhr oder dein Radcomputer am Ende der Aktivität selbst in die Datei geschrieben. Sie entsprechen dem, was Garmin Connect oder die App deines Geräts anzeigt.',
      'Enthält eine Datei keine solchen Werte (zum Beispiel bei GPX), bleibt ihre Spalte leer.',
    ],
  },
  computedValues: {
    title: 'Berechnet aus den Messpunkten',
    body: [
      'Dieselben Kennzahlen, aus den Sekundenwerten der Datei nachgerechnet, mit genau der Rechnung, die auch Zeit- und Distanzfenster nutzen.',
      'Das Badge zeigt die Abweichung zum Gerätewert. Kleine Abweichungen bis etwa 2 % sind normal, weil die Uhr intern feiner misst, als sie speichert.',
    ],
  },
  playback: {
    title: 'Wiedergabe',
    body: [
      '− 1 min, − 10 s, + 10 s und + 1 min springen in der Zeit; eine laufende Wiedergabe läuft danach weiter. ↺ springt zum Anfang.',
      'Das Tempo (0,5× bis 500×) bestimmt, wie schnell die Marker auf der Karte laufen.',
      'Im Zeitfeld kannst du eine Zeit eintippen, zum Beispiel 12:34 oder 1:30:00, und mit Enter dorthin springen.',
    ],
  },
  gap: {
    title: 'Abstand',
    body: [
      'Zeigt, wie weit die Marker gerade auseinander sind, sortiert nach ihrer Position auf der Strecke: der Vorderste links. Zwischen zwei Markern steht der Abstand in Kilometern und in Zeit.',
      'Die Kilometer werden entlang der Referenzstrecke gemessen, nicht über die Luftlinie und nicht über die Distanzzähler der Geräte, die auf langen Strecken einige hundert Meter auseinanderlaufen. Jede Position wird dazu auf die Linie der Referenzspur gelegt.',
      'Die Zeit ist der Rennabstand: wie lange es her ist, dass der Vordere an der Stelle war, an der der Hintere gerade ist.',
      'Gezählt wird ab der Startlinie (weißer Ring auf der Karte). Sie wird automatisch dort gesetzt, wo kurz nach dem Start alle Spuren eng beieinander liegen. Mit „Startlinie wählen“ und einem Klick auf die Referenzspur legst du sie selbst fest.',
      '„An Startlinie ausrichten“ setzt die Start-Offsets so, dass alle Aktivitäten im selben Moment über die Startlinie fahren.',
      'Ein blasser Punkt am Ende ist eine Aktivität, die noch vor der Startlinie oder länger als eine Minute abseits der Referenzstrecke ist.',
    ],
  },
  map: {
    title: 'Karte',
    body: [
      'Die Marker zeigen, wo jede Aktivität zur aktuellen Zeit ist.',
      'Klicke zweimal auf den Track, um ein Distanzfenster aufzuziehen: Die Tabelle darunter vergleicht dann genau diesen Streckenabschnitt für alle Dateien, auch wenn sie ihn zu unterschiedlichen Zeiten gefahren sind.',
      'Am unteren Rand der Karte kannst du die Höhe ziehen.',
    ],
  },
  exportVideo: {
    title: 'Als MP4 speichern',
    body: [
      'Rendert die Karte mit allen Aktivitäten und ihren wandernden Markern als Video. Das passiert in deinem Browser, es wird nichts hochgeladen.',
      'Du wählst Tempo, Format, Auflösung und Bildausschnitt. Dafür brauchst du einen aktuellen Chrome-, Edge- oder Firefox-Browser.',
    ],
  },
  graph: {
    title: 'Graph',
    body: [
      'Wähle oben, welcher Messwert über die Zeit gezeigt wird.',
      'Ziehe mit der Maus über den Graphen, um ein Zeitfenster aufzuziehen: Darunter vergleicht die Tabelle genau diesen Abschnitt.',
      'Die gelbe Linie ist die aktuelle Position der Wiedergabe.',
    ],
  },
  currentPoint: {
    title: 'Aktueller Punkt',
    body: ['Werte jeder Aktivität an der Stelle der gelben Linie, also der aktuellen Wiedergabeposition.'],
  },
  hover: {
    title: 'Hover',
    body: [
      'Werte jeder Aktivität an der Stelle, über der dein Mauszeiger im Graphen steht. So siehst du Details, ohne die Wiedergabe zu verändern.',
    ],
  },
  timeWindow: {
    title: 'Zeitfenster',
    body: [
      'Kennzahlen des gezogenen Abschnitts für jede Datei.',
      'Anfang und Ende kannst du unten genau eintippen, entweder als Zeit oder als Kilometer je Datei. Mit × schließt du das Fenster.',
    ],
  },
  distanceWindow: {
    title: 'Distanzfenster',
    body: [
      'Kennzahlen des Streckenabschnitts zwischen deinen beiden Klicks auf der Karte, für jede Datei einzeln gemessen.',
      'Der nächste Klick auf den Track startet ein neues Fenster.',
    ],
  },
  videoSpeed: {
    title: 'Tempo des Videos',
    body: [
      '60× heißt: Eine Minute Aktivität dauert im Video eine Sekunde.',
      'Unter den Feldern siehst du, wie lang das Video dann wird und wie groß die Datei höchstens werden kann.',
    ],
  },
  videoFormat: {
    title: 'Format',
    body: [
      'Das Seitenverhältnis des Videos: Querformat für Bildschirme und Präsentationen, 1:1 für Beiträge, 4:5 und 9:16 für Hochformat (Stories, Reels).',
    ],
  },
  videoQuality: {
    title: 'Auflösung',
    body: [
      'Die Bildgröße, gerechnet über die kurze Seite. „Vorschau" ist schnell und klein, „Full HD" ist scharf, aber deutlich größer. Die Pixelzahl steht jeweils in Klammern.',
    ],
  },
  videoGaps: {
    title: 'Abstände im Video',
    body: [
      'Blendet unten im Video dieselbe Abstandszeile ein wie unter der Wiedergabe: Marker nach Position sortiert, dazwischen Abstand in km und Zeit.',
      'Nur verfügbar, wenn eine Startlinie gesetzt ist und mindestens zwei Aktivitäten an ihr vorbeikommen.',
    ],
  },
  videoCrop: {
    title: 'Ausschnitt',
    body: [
      'Bestimme, welcher Kartenbereich im Video zu sehen ist. Ziehe die Vorschau zum Verschieben, zoome mit Mausrad, Regler oder zwei Fingern.',
      '„Alle Tracks" passt alles ins Bild, „Aktueller Kartenausschnitt" übernimmt den Bereich der großen Karte.',
    ],
  },
};

const HELP_EN = {
  file: {
    title: 'Loading and naming files',
    body: [
      'Choose a FIT file, a GPX file or the ZIP straight from Garmin Connect (gear icon → “Export File”). FIT files from Wahoo, COROS, Suunto, Polar, Strava and others work the same way, also as .gz. You can also just drag a file onto the card. The file is only processed in your browser.',
      'You can rename it freely, for example to “Tobi 2025”. The name shows up everywhere: in the tables, in the graph, in the map legend and in the exported video.',
      'The color dot sets the color of the activity, and × removes the file again.',
    ],
  },
  addFile: {
    title: 'Add another activity',
    body: [
      'You can compare up to 6 activities at the same time. Use × on a file card to remove it again; at least two cards always stay.',
    ],
  },
  offset: {
    title: 'Start offset',
    body: [
      'Compensates for different start times. In races or group rides the recordings rarely begin at the same moment: one watch starts earlier, another later.',
      'The offset shifts this activity relative to File 1 until landmarks (starting gun, intersection, climb) line up. File 1 is the reference and stays unchanged.',
      'Enter as mm:ss, negative values work too.',
    ],
  },
  compare: {
    title: 'Overall comparison',
    body: [
      'This puts the key figures of all activities side by side: rows are the metrics, columns are the files.',
      'At the top you see the values your device saved itself, below them the same values recalculated from the data points.',
    ],
  },
  deviceValues: {
    title: 'Device values',
    body: [
      'Your watch or bike computer wrote these numbers into the file itself at the end of the activity. They match what Garmin Connect or your device’s app shows.',
      'If a file contains no such values (for example GPX), its column stays empty.',
    ],
  },
  computedValues: {
    title: 'Calculated from the data points',
    body: [
      'The same key figures, recalculated from the per-second values in the file, using exactly the calculation that the time and distance windows use.',
      'The badge shows the deviation from the device value. Small deviations of up to about 2% are normal because the watch measures more finely internally than it stores.',
    ],
  },
  playback: {
    title: 'Playback',
    body: [
      '− 1 min, − 10 s, + 10 s and + 1 min jump in time; a running playback continues afterwards. ↺ jumps back to the start.',
      'The speed (0.5× to 500×) determines how fast the markers move on the map.',
      'In the time field you can type a time, for example 12:34 or 1:30:00, and press Enter to jump there.',
    ],
  },
  gap: {
    title: 'Gap',
    body: [
      'Shows how far apart the markers are right now, ordered by their position on the course: the leader on the left. Between two markers you see the gap in kilometres and in time.',
      'The kilometres are measured along the reference course, not as the crow flies and not with the devices’ distance counters, which drift apart by a few hundred metres on long rides. Each position is placed onto the line of the reference track.',
      'The time is the race gap: how long ago the one in front was at the spot where the one behind is now.',
      'Counting starts at the start line (white ring on the map). It is set automatically where all tracks run close together shortly after the start. With “Pick start line” and a click on the reference track you set it yourself.',
      '“Align to start line” sets the start offsets so that all activities cross the start line at the same moment.',
      'A faded dot at the end is an activity that is still before the start line or has been off the reference course for more than a minute.',
    ],
  },
  map: {
    title: 'Map',
    body: [
      'The markers show where each activity is at the current time.',
      'Click twice on the track to draw a distance window: the table below then compares exactly that stretch for all files, even if they rode it at different times.',
      'You can drag the bottom edge of the map to change its height.',
    ],
  },
  exportVideo: {
    title: 'Save as MP4',
    body: [
      'Renders the map with all activities and their moving markers as a video. This happens in your browser, nothing is uploaded.',
      'You choose speed, format, resolution and map section. This needs a current Chrome, Edge or Firefox browser.',
    ],
  },
  graph: {
    title: 'Graph',
    body: [
      'Choose at the top which metric is shown over time.',
      'Drag across the graph with the mouse to draw a time window: the table below then compares exactly that section.',
      'The yellow line is the current playback position.',
    ],
  },
  currentPoint: {
    title: 'Current point',
    body: ['Values of each activity at the position of the yellow line, i.e. the current playback position.'],
  },
  hover: {
    title: 'Hover',
    body: [
      'Values of each activity at the point your mouse pointer is over in the graph. This lets you see details without changing the playback.',
    ],
  },
  timeWindow: {
    title: 'Time window',
    body: [
      'Key figures of the section you dragged, for every file.',
      'You can type the start and end precisely below, either as a time or as kilometers per file. × closes the window.',
    ],
  },
  distanceWindow: {
    title: 'Distance window',
    body: [
      'Key figures of the stretch between your two clicks on the map, measured separately for each file.',
      'The next click on the track starts a new window.',
    ],
  },
  videoSpeed: {
    title: 'Video speed',
    body: [
      '60× means: one minute of activity takes one second in the video.',
      'Below the fields you can see how long the video will be and how large the file can get at most.',
    ],
  },
  videoFormat: {
    title: 'Format',
    body: [
      'The aspect ratio of the video: landscape for screens and presentations, 1:1 for posts, 4:5 and 9:16 for portrait (stories, reels).',
    ],
  },
  videoQuality: {
    title: 'Resolution',
    body: [
      'The image size, measured on the short side. “Preview” is fast and small, “Full HD” is sharp but much larger. The pixel count is shown in parentheses.',
    ],
  },
  videoGaps: {
    title: 'Gaps in the video',
    body: [
      'Shows the same gap line at the bottom of the video as below the playback: markers ordered by position, with the gap in km and time between them.',
      'Only available when a start line is set and at least two activities pass it.',
    ],
  },
  videoCrop: {
    title: 'Section',
    body: [
      'Decide which part of the map is visible in the video. Drag the preview to move it, zoom with the mouse wheel, the slider or two fingers.',
      '“All tracks” fits everything into the frame, “Current map section” takes over the area of the large map.',
    ],
  },
};

export const HELP = LANG === 'en' ? HELP_EN : HELP_DE;

const SHOW_DELAY_MS = 120;
const HIDE_DELAY_MS = 150;
const EDGE = 12;

let tip = null;
let active = null;
let pinned = false;
let sheet = false;
let lastPointerType = 'mouse';
let showTimer = 0;
let hideTimer = 0;

function ensureTip() {
  if (tip) {
    return tip;
  }

  tip = document.createElement('div');
  tip.id = 'helpTip';
  tip.className = 'help-tip';
  tip.setAttribute('role', 'tooltip');
  // Popover-API: liegt im Top Layer und damit auch ueber dem modalen Export-Dialog.
  tip.setAttribute('popover', 'manual');
  if (typeof tip.showPopover !== 'function') {
    tip.classList.add('no-popover');
  }
  document.body.appendChild(tip);
  return tip;
}

function fill(entry) {
  const element = ensureTip();
  element.replaceChildren();

  const title = document.createElement('strong');
  title.className = 'help-tip-title';
  title.textContent = entry.title;
  element.appendChild(title);

  for (const paragraph of entry.body) {
    const p = document.createElement('p');
    p.textContent = paragraph;
    element.appendChild(p);
  }

  // Auf dem Handy gibt es keinen Mauszeiger und kein Hover: Das Blatt braucht einen eigenen Schliessen-Knopf.
  if (sheet) {
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'help-tip-close';
    closeButton.setAttribute('aria-label', t('help.close'));
    closeButton.textContent = '×';
    element.prepend(closeButton);
  }
}

function place(button) {
  const element = ensureTip();
  const anchor = button.getBoundingClientRect();
  element.style.maxWidth = `${Math.min(340, window.innerWidth - 2 * EDGE)}px`;
  element.style.left = '0px';
  element.style.top = '0px';

  const box = element.getBoundingClientRect();
  const left = Math.max(EDGE, Math.min(window.innerWidth - box.width - EDGE, anchor.left + anchor.width / 2 - box.width / 2));
  let top = anchor.bottom + 10;
  if (top + box.height > window.innerHeight - EDGE && anchor.top - box.height - 10 > EDGE) {
    top = anchor.top - box.height - 10;
  }

  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(Math.max(EDGE, top))}px`;
  // Der Pfeil zeigt auf die Mitte des Buttons, auch wenn der Kasten am Rand klebt.
  element.style.setProperty('--arrow-x', `${Math.round(anchor.left + anchor.width / 2 - left)}px`);
  element.classList.toggle('above', top < anchor.top);
}

function open(button, asSheet = false) {
  const entry = HELP[button.dataset.help];
  if (!entry) {
    return;
  }

  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  if (active && active !== button) {
    active.removeAttribute('aria-describedby');
  }

  sheet = asSheet;
  ensureTip().classList.toggle('sheet', sheet);
  fill(entry);
  active = button;
  button.setAttribute('aria-describedby', 'helpTip');

  const element = ensureTip();
  if (typeof element.showPopover === 'function') {
    if (!element.matches(':popover-open')) {
      element.showPopover();
    }
  } else {
    // Rueckfall: im Dialog, falls der Button dort liegt, sonst am Body.
    (button.closest('dialog') ?? document.body).appendChild(element);
    element.classList.add('fallback-open');
  }
  if (sheet) {
    // Positionen einer frueheren Sprechblase wuerden das feste Blatt verschieben.
    for (const name of ['left', 'top', 'max-width']) {
      element.style.removeProperty(name);
    }
  } else {
    place(button);
  }
}

function close() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  pinned = false;
  if (active) {
    active.removeAttribute('aria-describedby');
    active.classList.remove('is-open');
  }
  active = null;

  if (!tip) {
    return;
  }
  if (typeof tip.hidePopover === 'function') {
    if (tip.matches(':popover-open')) {
      tip.hidePopover();
    }
  } else {
    tip.classList.remove('fallback-open');
  }
}

function labelButtons(root) {
  for (const button of root.querySelectorAll('.help[data-help]')) {
    const entry = HELP[button.dataset.help];
    if (!entry) {
      console.warn(`Kein Hilfetext fuer "${button.dataset.help}"`);
      continue;
    }
    button.setAttribute('aria-label', t('help.label', { title: entry.title }));
    button.setAttribute('aria-haspopup', 'true');
  }
}

export function initTooltips() {
  labelButtons(document);
  // Vorlagen (Dateikarte usw.) beschriften, damit Klone den Namen schon tragen.
  for (const template of document.querySelectorAll('template')) {
    labelButtons(template.content);
  }

  const helpButton = (target) => target?.closest?.('.help[data-help]') ?? null;

  // Merkt sich, womit zuletzt gedrueckt wurde: Finger und Stift bekommen das Blatt unten, Maus und Tastatur die Sprechblase.
  document.addEventListener('pointerdown', (event) => {
    lastPointerType = event.pointerType || 'mouse';
  }, true);

  document.addEventListener('pointerover', (event) => {
    const button = helpButton(event.target);
    if (!button || event.pointerType !== 'mouse' || pinned) {
      return;
    }
    clearTimeout(hideTimer);
    showTimer = setTimeout(() => open(button), SHOW_DELAY_MS);
  });

  document.addEventListener('pointerout', (event) => {
    const button = helpButton(event.target);
    if (!button || event.pointerType !== 'mouse' || pinned) {
      return;
    }
    if (helpButton(event.relatedTarget) === button) {
      return;
    }
    clearTimeout(showTimer);
    hideTimer = setTimeout(close, HIDE_DELAY_MS);
  });

  document.addEventListener('focusin', (event) => {
    const button = helpButton(event.target);
    // Nur bei Tastatur-Fokus oeffnen; ein Mausklick loest sein eigenes Click-Verhalten aus.
    if (button && button.matches(':focus-visible')) {
      open(button);
    }
  });

  document.addEventListener('focusout', (event) => {
    if (helpButton(event.target) && !pinned) {
      close();
    }
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest?.('.help-tip-close')) {
      event.preventDefault();
      close();
      return;
    }

    const button = helpButton(event.target);
    if (button) {
      // Der Button darf weder ein <summary> ein-/ausklappen noch ein Label ausloesen.
      event.preventDefault();
      event.stopPropagation();
      if (pinned && active === button) {
        close();
      } else {
        open(button, lastPointerType === 'touch' || lastPointerType === 'pen');
        pinned = true;
        button.classList.add('is-open');
      }
      return;
    }

    if (pinned && !tip?.contains(event.target)) {
      close();
    }
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && active) {
      event.preventDefault();
      close();
    }
  });

  // Die Position stimmt nach Scrollen oder Groessenaenderung nicht mehr.
  // Das Blatt am Handy sitzt fest am Bildschirmrand: Scrollen und das Ein-/Ausblenden der Adressleiste
  // (loest resize aus) duerfen es nicht schliessen.
  window.addEventListener('scroll', () => active && !sheet && close(), true);
  window.addEventListener('resize', () => active && !sheet && close());
}
