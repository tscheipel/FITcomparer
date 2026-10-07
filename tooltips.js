/*
 * FITcomparer
 * Copyright (c) 2026 Tobias Scheipel
 * SPDX-License-Identifier: MIT
 * See the LICENSE file in the project root for the full license text.
 */

// Kleine ?-Symbole mit Erklaerung. Im Markup steht nur
//   <button type="button" class="help" data-help="offset">?</button>
// Texte und Verhalten kommen von hier. Das Wiring haengt per Event-Delegation am
// Dokument; deshalb funktionieren auch Buttons in <template>-Klonen (Dateikarten)
// ohne zusaetzlichen Code.

export const HELP = {
  file: {
    title: 'Dateien laden und benennen',
    body: [
      'Wähle eine FIT-Datei, eine GPX-Datei oder direkt das ZIP aus Garmin Connect (Zahnrad → „Datei exportieren"). FIT-Dateien von Wahoo, COROS, Suunto, Polar, Strava und anderen funktionieren genauso, auch als .gz. Die Datei wird nur in deinem Browser verarbeitet.',
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
  videoCrop: {
    title: 'Ausschnitt',
    body: [
      'Bestimme, welcher Kartenbereich im Video zu sehen ist. Ziehe die Vorschau zum Verschieben, zoome mit Mausrad, Regler oder zwei Fingern.',
      '„Alle Tracks" passt alles ins Bild, „Aktueller Kartenausschnitt" übernimmt den Bereich der großen Karte.',
    ],
  },
};

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
    closeButton.setAttribute('aria-label', 'Hilfe schließen');
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
    button.setAttribute('aria-label', `Hilfe: ${entry.title}`);
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
