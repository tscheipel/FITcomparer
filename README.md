# FITcomparer

Vergleiche Aktivitäten von Garmin, Wahoo, COROS, Suunto, Polar, Strava und anderen (FIT, GPX oder das ZIP aus Garmin Connect) direkt nebeneinander: Kennzahlen, Karte, Graph und auf Wunsch als MP4-Video. Alles läuft in deinem Browser, deine Dateien werden nicht hochgeladen.

**App: <https://fit.scheipel.com>** · **Anleitung: <https://fit.scheipel.com/help.html>**

![FITcomparer mit zwei geladenen Aktivitäten](docs/img/hero.webp)

## Was kann es?

- **Zwei bis sechs Aktivitäten** gleichzeitig vergleichen, jede mit eigenem Namen und eigener Farbe.
- **Gerätewerte wie in Garmin Connect** (aus der Zusammenfassung der FIT-Datei) und daneben **nachgerechnete Werte** aus den Sekundenwerten, inklusive Abweichungsanzeige.
- **Zeit- und Distanzfenster:** Kennzahlen für einen beliebigen Abschnitt, auch wenn die Aktivitäten ihn zu verschiedenen Zeiten gefahren sind.
- **Start-Offset**, um ungleiche Startzeiten bei Rennen oder gemeinsamen Ausfahrten auszugleichen.
- **Wiedergabe** mit wandernden Markern auf der Karte, Graph für Puls, Leistung, Geschwindigkeit, Distanz, Kadenz und Höhe.
- **MP4-Export** in 16:9, 4:3, 1:1, 4:5 und 9:16 mit frei wählbarem Kartenausschnitt.
- Kleine **?-Erklärungen** an den Bedienelementen und eine Ansicht für das Smartphone.

## Schnellstart

1. In **Garmin Connect (Webseite, nicht die App)** die Aktivität öffnen, auf das Zahnrad klicken und **„Datei exportieren“** wählen. Du erhältst ein ZIP.
2. FITcomparer öffnen und das ZIP bei „Datei 1“ auswählen. Es muss nicht entpackt werden. Dasselbe bei „Datei 2“.
3. Vergleichen.

FIT ist ein offener Standard: Dateien von Wahoo, COROS, Suunto, Polar, Hammerhead, Zwift oder der Strava-Funktion „Export Original“ lassen sich genauso laden, auch als `.fit.gz`. Die Menüwege je Plattform stehen in der Anleitung.

Die ausführliche Anleitung mit Screenshots steht unter **[help.html](https://fit.scheipel.com/help.html)**.

## Lokal starten

Es gibt keinen Build-Schritt und keine Abhängigkeiten zum Installieren. Die Seite läuft aber nicht per Doppelklick auf `index.html`, weil sie ES-Module verwendet. Starte im Projektordner einen kleinen Webserver:

```
python -m http.server 8000
```

und öffne <http://localhost:8000>.

## Grenzen

- Unterstützt werden FIT, GPX (auch als `.gz`) und ZIP mit genau einer Aktivität. TCX wird nicht gelesen, der Komplett-Export eines Garmin-Kontos wird nicht direkt geladen.
- Der MP4-Export braucht einen Browser mit WebCodecs (aktuelles Chrome, Edge oder Firefox) und eine Datei mit GPS-Daten.
- Karten, Bibliotheken und Schriften kommen aus dem Internet (siehe „Datenschutz“ in der Anleitung).

## Lizenz und Credits

© 2026 Tobias Scheipel · [scheipel.com](https://scheipel.com) · [MIT-Lizenz](LICENSE)

Kartendaten © [OpenStreetMap-Mitwirkende](https://www.openstreetmap.org/copyright). Genutzte Bibliotheken: [Leaflet](https://leafletjs.com) (BSD-2-Clause), [Chart.js](https://www.chartjs.org), [fit-file-parser](https://github.com/jimmykane/fit-parser), [fflate](https://101arrowz.github.io/fflate) und [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (jeweils MIT). Garmin und Garmin Connect sind Marken der Garmin Ltd.; FITcomparer steht in keiner Verbindung zu Garmin.
