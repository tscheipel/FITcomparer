# FITcomparer
# Copyright (c) 2026 Tobias Scheipel
# SPDX-License-Identifier: MIT
"""Haelt die zweisprachigen Seiten und die Suchmaschinen-Angaben konsistent.

Aufruf:  python build-lang.py      (bump-version.py ruft das Skript selbst auf)

Quelle der deutschen Startseite ist index.html. Daraus entsteht en/index.html: Der statische Text wird
ersetzt, die Pfade zeigen auf ../. Die Anleitungen (help.html, en/help.html) werden von Hand gepflegt.
In allen vier Seiten fuellt das Skript die Bereiche zwischen den Markern
  <!--lang:head--> (Titel, Beschreibung, canonical, hreflang, Open Graph, JSON-LD, lang.js)
  <!--lang:switch--> (Sprachumschalter)
und erzeugt sitemap.xml mit den Sprachalternativen.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).parent
BASE = 'https://fit.scheipel.com/'

# --------------------------------------------------------------------------- Seiteninhalt je Sprache
INDEX = {
    'de': {
        'title': 'FITcomparer – FIT- und GPX-Aktivitäten von Garmin, Wahoo, COROS & Co. vergleichen',
        'description': 'FITcomparer vergleicht Aktivitäten von Garmin, Wahoo, COROS, Suunto, Polar und Strava (FIT, GPX, Garmin-Connect-ZIP) nebeneinander: Kennzahlen, Karte, Graph, Zeit- und Distanzfenster und MP4-Video-Export. Kostenlos, direkt im Browser, ohne Upload.',
        'image': 'og-image.png',
        'image_alt': 'FITcomparer mit zwei verglichenen Garmin-Aktivitäten',
        'ld': {
            '@type': 'WebApplication',
            'name': 'FITcomparer',
            'applicationCategory': 'SportsApplication',
            'operatingSystem': 'Alle (Webbrowser)',
            'browserRequirements': 'Aktueller Browser; MP4-Export benötigt WebCodecs (Chrome, Edge, Firefox)',
            'featureList': ['Vergleich von zwei bis sechs Aktivitäten', 'Gerätewerte wie in Garmin Connect',
                            'Zeit- und Distanzfenster', 'Start-Offset für ungleiche Startzeiten',
                            'Wiedergabe mit Karte und Graph', 'MP4-Videoexport'],
        },
    },
    'en': {
        'title': 'FITcomparer – Compare FIT and GPX activities from Garmin, Wahoo, COROS & more',
        'description': 'FITcomparer compares activities from Garmin, Wahoo, COROS, Suunto, Polar and Strava (FIT, GPX, Garmin Connect ZIP) side by side: key figures, map, graph, time and distance windows and MP4 video export. Free, right in your browser, no upload.',
        'image': 'og-image-en.png',
        'image_alt': 'FITcomparer with two compared Garmin activities',
        'ld': {
            '@type': 'WebApplication',
            'name': 'FITcomparer',
            'applicationCategory': 'SportsApplication',
            'operatingSystem': 'All (web browser)',
            'browserRequirements': 'Current browser; MP4 export needs WebCodecs (Chrome, Edge, Firefox)',
            'featureList': ['Compare two to six activities', 'Device values as in Garmin Connect',
                            'Time and distance windows', 'Start offset for different start times',
                            'Playback with map and graph', 'MP4 video export'],
        },
    },
}

HELP = {
    'de': {
        'title': 'FITcomparer – Anleitung: Aktivitäten aus Garmin Connect exportieren und vergleichen',
        'description': 'Anleitung zu FITcomparer: So exportierst du Aktivitäten aus Garmin Connect (Web) oder von Strava, Wahoo und COROS als FIT-Datei, vergleichst sie nebeneinander und speicherst den Vergleich als MP4-Video.',
        'image': 'og-image.png',
        'image_alt': 'FITcomparer mit zwei verglichenen Garmin-Aktivitäten',
        'ld': {
            '@type': 'HowTo',
            'name': 'Aktivität aus Garmin Connect (Web) exportieren und in FITcomparer vergleichen',
            'image': BASE + 'docs/img/garmin-export.webp',
            'step': [
                ('Garmin Connect öffnen', 'Melde dich im Browser auf connect.garmin.com an und öffne die Aktivität. Der Export ist nur in der Webversion möglich, nicht in der Garmin-Connect-App.'),
                ('Zahnrad anklicken', 'Klicke in der Aktivität oben rechts auf das Zahnrad.'),
                ('Datei exportieren', 'Wähle „Datei exportieren“. Es wird ein ZIP mit der FIT-Datei heruntergeladen, das du nicht entpacken musst.'),
                ('ZIP in FITcomparer laden', 'Öffne fit.scheipel.com und wähle das ZIP bei „Datei auswählen“. Wiederhole das für die zweite Aktivität.'),
                ('Vergleichen', 'Vergleiche Kennzahlen, Karte und Graph und speichere den Vergleich bei Bedarf als MP4-Video.'),
            ],
        },
    },
    'en': {
        'title': 'FITcomparer – Guide: Export activities from Garmin Connect and compare them',
        'description': 'Guide to FITcomparer: How to export activities from Garmin Connect (web) or from Strava, Wahoo and COROS as FIT files, compare them side by side and save the comparison as an MP4 video.',
        'image': 'og-image-en.png',
        'image_alt': 'FITcomparer with two compared Garmin activities',
        'ld': {
            '@type': 'HowTo',
            'name': 'Export an activity from Garmin Connect (web) and compare it in FITcomparer',
            'image': BASE + 'docs/img/en/garmin-export.webp',
            'step': [
                ('Open Garmin Connect', 'Sign in at connect.garmin.com in your browser and open the activity. Exporting is only possible in the web version, not in the Garmin Connect app.'),
                ('Click the gear icon', 'Click the gear icon at the top right of the activity.'),
                ('Export File', 'Choose “Export File”. A ZIP containing the FIT file is downloaded; you do not need to unpack it.'),
                ('Load the ZIP in FITcomparer', 'Open fit.scheipel.com/en/ and choose the ZIP under “Select file”. Repeat this for the second activity.'),
                ('Compare', 'Compare key figures, map and graph and, if you like, save the comparison as an MP4 video.'),
            ],
        },
    },
}

PAGES = {  # Schluessel -> (Sprachdatei, Pfad der Gegenseite relativ zur Datei, URL)
    'index': {'de': 'index.html', 'en': 'en/index.html', 'url': {'de': BASE, 'en': BASE + 'en/'}, 'data': INDEX, 'type': 'website'},
    'help': {'de': 'help.html', 'en': 'en/help.html', 'url': {'de': BASE + 'help.html', 'en': BASE + 'en/help.html'}, 'data': HELP, 'type': 'article'},
}

LOCALE = {'de': 'de_AT', 'en': 'en_GB'}
SWITCH_LABEL = {'de': 'Sprache', 'en': 'Language'}

ABOUT_EN = '''  <section class="about-site">
    <h1>FITcomparer: Compare Garmin activities</h1>
    <p>FITcomparer puts two to six activities from your Garmin, Wahoo, COROS, Suunto or Polar watch or bike computer side by side: distance, time, heart rate, power, cadence and elevation gain, plus map, graph and a comparison of any time or distance section. With the start offset you compensate for different start times in races or group rides, and if you like you save the comparison as an MP4 video.</p>
    <p>Load FIT files, GPX files or the ZIP from Garmin Connect (web) right here; exports from Strava, Wahoo, COROS &amp; more work too. Everything runs in your browser, your files are not sent to any server. <a href="./help.html">Read the guide</a> for step-by-step help with exporting from Garmin Connect and the routes on other platforms.</p>
  </section>
'''

NOSCRIPT_EN = '''  <noscript><p class="noscript">FITcomparer needs JavaScript to compare activities in your browser. The <a href="./help.html">guide</a> works without it.</p></noscript>
'''

# Statischer Text der Startseite: (deutsch, englisch, erwartete Anzahl)
STATIC_EN = [
    ('<span class="help-glyph" aria-hidden="true">?</span> Hilfe</a>', '<span class="help-glyph" aria-hidden="true">?</span> Help</a>', 1),
    ('id="addFile" type="button">+ Datei</button>', 'id="addFile" type="button">+ File</button>', 1),
    ('<p class="card-kicker" data-role="kicker">Datei</p>', '<p class="card-kicker" data-role="kicker">File</p>', 1),
    ('aria-label="Farbe dieser Datei" title="Farbe dieser Datei"', 'aria-label="Color of this file" title="Color of this file"', 1),
    ('data-role="status">Noch nicht geladen</span>', 'data-role="status">Not loaded yet</span>', 1),
    ('aria-label="Datei entfernen">×', 'aria-label="Remove file">×', 1),
    ('<span>Datei auswählen</span>', '<span>Select file</span>', 1),
    ('<small class="drop-hint">oder hierher ziehen</small>', '<small class="drop-hint">or drop it here</small>', 1),
    ('<small>FIT, GPX, ZIP oder .gz</small>', '<small>FIT, GPX, ZIP or .gz</small>', 1),
    ('data-role="progressLabel">Bereit</span>', 'data-role="progressLabel">Ready</span>', 1),
    ('<label data-role="offsetLabel">Start-Offset</label>', '<label data-role="offsetLabel">Start offset</label>', 1),
    ('data-role="meta">Keine Datei gewählt.</div>', 'data-role="meta">No file selected.</div>', 1),
    ('<span data-role="label">Datei</span>', '<span data-role="label">File</span>', 1),
    ('data-role="label">Datei (km)</span>', 'data-role="label">File (km)</span>', 2),
    ('<label><span>Anfang</span>', '<label><span>Start</span>', 3),
    ('<label><span>Ende</span>', '<label><span>End</span>', 3),
    ('<span class="card-kicker">Vergleich</span>', '<span class="card-kicker">Comparison</span>', 1),
    ('<h3 class="comparison-title">Gesamte Aktivität</h3>', '<h3 class="comparison-title">Entire activity</h3>', 1),
    ('Gerätewerte aus der Datei <button', 'Device values from the file <button', 1),
    ('<span class="comparison-note">entspricht Garmin Connect</span>', '<span class="comparison-note">matches Garmin Connect</span>', 1),
    ('Berechnet aus den Messpunkten <button', 'Calculated from the data points <button', 1),
    ('<span class="comparison-note">gleiche Rechnung wie Zeit- und Distanzfenster</span>', '<span class="comparison-note">same calculation as the time and distance windows</span>', 1),
    ('aria-label="Eine Minute zurück" title="Eine Minute zurück"', 'aria-label="One minute back" title="One minute back"', 1),
    ('aria-label="Zehn Sekunden zurück" title="Zehn Sekunden zurück"', 'aria-label="Ten seconds back" title="Ten seconds back"', 1),
    ('aria-label="Zehn Sekunden vor" title="Zehn Sekunden vor"', 'aria-label="Ten seconds forward" title="Ten seconds forward"', 1),
    ('aria-label="Eine Minute vor" title="Eine Minute vor"', 'aria-label="One minute forward" title="One minute forward"', 1),
    ('aria-label="Aktuelle Zeit, bearbeitbar"', 'aria-label="Current time, editable"', 1),
    ('<p class="card-kicker">Karte</p>', '<p class="card-kicker">Map</p>', 1),
    ('id="exportVideo" type="button">Als MP4 speichern</button>', 'id="exportVideo" type="button">Save as MP4</button>', 1),
    ('aria-label="Kartenhöhe ändern"', 'aria-label="Change map height"', 1),
    ('title="Ziehen, um die Karte zu vergrößern oder zu verkleinern"', 'title="Drag to make the map larger or smaller"', 1),
    ('<p class="card-kicker">Aktueller Punkt</p>', '<p class="card-kicker">Current point</p>', 1),
    ('<span class="inspector-hint">Mausposition</span>', '<span class="inspector-hint">Mouse position</span>', 1),
    ('<p class="card-kicker">Zeitfenster</p>', '<p class="card-kicker">Time window</p>', 1),
    ('aria-label="Fenster schließen"', 'aria-label="Close window"', 1),
    ('aria-label="Fenster bearbeiten"', 'aria-label="Edit window"', 1),
    ('<span class="selection-editor-label">Gesamtzeit</span>', '<span class="selection-editor-label">Total time</span>', 1),
    ('<p class="card-kicker">Distanzfenster</p>', '<p class="card-kicker">Distance window</p>', 1),
    ('id="distanceSelectionRange">Startpunkt auf der Karte wählen</h3>', 'id="distanceSelectionRange">Pick the start point on the map</h3>', 1),
    ('aria-label="Distanzfenster schließen"', 'aria-label="Close distance window"', 1),
    ('aria-label="Distanzfenster">', 'aria-label="Distance window">', 1),
    ('<a href="./help.html">Anleitung</a> ·', '<a href="./help.html">Guide</a> ·', 1),
    ('rel="noopener">MIT-Lizenz</a>', 'rel="noopener">MIT License</a>', 1),
    ('Kartendaten © <a', 'Map data © <a', 1),
    ('rel="noopener">OpenStreetMap-Mitwirkende</a>', 'rel="noopener">OpenStreetMap contributors</a>', 1),
    ('<h3 class="video-dialog-title">Aktivität als MP4 speichern</h3>', '<h3 class="video-dialog-title">Save activity as MP4</h3>', 1),
    ('Zeigt die Karte mit allen geladenen Dateien und ihren wandernden Positionsmarkern über die gesamte Aktivität. Gerendert wird im Browser; hochgeladen wird nichts, nur die Kartenkacheln werden einmal geladen.',
     'Shows the map with all loaded files and their moving position markers over the entire activity. Rendering happens in the browser; nothing is uploaded, only the map tiles are loaded once.', 1),
    ('Geschwindigkeit <button', 'Speed <button', 1),
    ('Auflösung <button', 'Resolution <button', 1),
    ('Ausschnitt <button', 'Section <button', 1),
    ('Ziehen verschiebt, Mausrad, Regler oder zwei Finger zoomen.', 'Drag to move; zoom with the mouse wheel, the slider or two fingers.', 1),
    ('aria-label="Vorschau des Kartenausschnitts"', 'aria-label="Preview of the map section"', 1),
    ('id="videoViewAuto" type="button">Alle Tracks</button>', 'id="videoViewAuto" type="button">All tracks</button>', 1),
    ('id="videoViewMap" type="button">Aktueller Kartenausschnitt</button>', 'id="videoViewMap" type="button">Current map section</button>', 1),
    ('id="videoCancel" type="button">Schließen</button>', 'id="videoCancel" type="button">Close</button>', 1),
    ('id="videoStart" type="submit">Export starten</button>', 'id="videoStart" type="submit">Start export</button>', 1),
]

# --------------------------------------------------------------------------- Helfer


def read(path):
    text = (ROOT / path).read_text(encoding='utf-8')
    return text.replace('\r\n', '\n')


def write(path, text):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    with open(target, 'w', encoding='utf-8', newline='') as handle:
        handle.write(text)


def esc(text):
    return text.replace('&', '&amp;').replace('"', '&quot;').replace('<', '&lt;')


def current_version():
    versions = [int(m.group(1)) for m in re.finditer(r'\?v=(\d+)', read('index.html'))]
    return max(versions) if versions else 1


def fill(text, name, content):
    pattern = re.compile(r'(<!--lang:%s-->\n).*?(\n?[ \t]*<!--/lang:%s-->)' % (name, name), re.S)
    assert pattern.search(text), 'Marker fehlt: ' + name
    return pattern.sub(lambda m: m.group(1) + content + '\n' + m.group(2).lstrip('\n'), text, count=1)


def head_block(page_key, lang, version):
    page = PAGES[page_key]
    data = page['data'][lang]
    other = 'en' if lang == 'de' else 'de'
    url = page['url'][lang]
    prefix = '../' if lang == 'en' else './'
    image = BASE + data['image']
    lines = [
        '  <title>%s</title>' % esc(data['title']),
        '  <meta name="description" content="%s">' % esc(data['description']),
        '  <meta name="robots" content="index, follow, max-image-preview:large">',
        '  <meta name="author" content="Tobias Scheipel">',
        '  <link rel="canonical" href="%s">' % url,
        '  <link rel="alternate" hreflang="de" href="%s">' % page['url']['de'],
        '  <link rel="alternate" hreflang="en" href="%s">' % page['url']['en'],
        '  <link rel="alternate" hreflang="x-default" href="%s">' % page['url']['de'],
        '  <meta property="og:type" content="%s">' % page['type'],
        '  <meta property="og:site_name" content="FITcomparer">',
        '  <meta property="og:locale" content="%s">' % LOCALE[lang],
        '  <meta property="og:locale:alternate" content="%s">' % LOCALE[other],
        '  <meta property="og:title" content="%s">' % esc(data['title']),
        '  <meta property="og:description" content="%s">' % esc(data['description']),
        '  <meta property="og:url" content="%s">' % url,
        '  <meta property="og:image" content="%s">' % image,
        '  <meta property="og:image:width" content="1200">',
        '  <meta property="og:image:height" content="630">',
        '  <meta property="og:image:alt" content="%s">' % esc(data['image_alt']),
        '  <meta name="twitter:card" content="summary_large_image">',
        '  <meta name="twitter:title" content="%s">' % esc(data['title']),
        '  <meta name="twitter:description" content="%s">' % esc(data['description']),
        '  <meta name="twitter:image" content="%s">' % image,
    ]
    ld = {'@context': 'https://schema.org'}
    spec = data['ld']
    ld['@type'] = spec['@type']
    if spec['@type'] == 'WebApplication':
        ld.update({'name': spec['name'], 'url': url, 'description': data['description'],
                   'applicationCategory': spec['applicationCategory'], 'operatingSystem': spec['operatingSystem'],
                   'inLanguage': lang, 'browserRequirements': spec['browserRequirements'],
                   'offers': {'@type': 'Offer', 'price': '0', 'priceCurrency': 'EUR'},
                   'author': {'@type': 'Person', 'name': 'Tobias Scheipel', 'url': 'https://scheipel.com'},
                   'license': 'https://github.com/tscheipel/FITcomparer/blob/main/LICENSE',
                   'image': image, 'featureList': spec['featureList']})
    else:
        ld.update({'name': spec['name'], 'description': data['description'], 'inLanguage': lang, 'image': spec['image'],
                   'step': [{'@type': 'HowToStep', 'name': n, 'text': t} for n, t in spec['step']]})
    lines.append('  <script type="application/ld+json">')
    lines.append(json.dumps(ld, ensure_ascii=False, indent=2))
    lines.append('  </script>')
    lines.append('  <script src="%slang.js?v=%d"></script>' % (prefix, version))
    return '\n'.join(lines)


def switch_block(page_key, lang):
    """Zwei Flaggen-Links. Aktive Sprache markiert; Ziel ist die gleiche Seite in der anderen Sprache."""
    name = 'index' if page_key == 'index' else 'help.html'
    if page_key == 'index':
        hrefs = {'de': ('./' if lang == 'de' else '../'), 'en': ('./en/' if lang == 'de' else './')}
    else:
        hrefs = {'de': ('./help.html' if lang == 'de' else '../help.html'), 'en': ('./en/help.html' if lang == 'de' else './help.html')}
    at = ('<svg viewBox="0 0 3 2" aria-hidden="true" focusable="false"><rect width="3" height="2" fill="#ed2939"/>'
          '<rect y="0.667" width="3" height="0.667" fill="#fff"/></svg>')
    gb = ('<svg viewBox="0 0 60 30" aria-hidden="true" focusable="false"><clipPath id="gbA"><path d="M0,0v30h60v-30z"/></clipPath>'
          '<clipPath id="gbB"><path d="M30,15h30v15zv15h-30zh-30v-15zv-15h30z"/></clipPath>'
          '<g clip-path="url(#gbA)"><path d="M0,0v30h60v-30z" fill="#012169"/>'
          '<path d="M0,0L60,30M60,0L0,30" stroke="#fff" stroke-width="6"/>'
          '<path d="M0,0L60,30M60,0L0,30" clip-path="url(#gbB)" stroke="#c8102e" stroke-width="4"/>'
          '<path d="M30,0v30M0,15h60" stroke="#fff" stroke-width="10"/>'
          '<path d="M30,0v30M0,15h60" stroke="#c8102e" stroke-width="6"/></g></svg>')

    def link(code, title, svg, text_lang):
        active = code == lang
        return ('      <a class="lang-link%s" href="%s" hreflang="%s" lang="%s" title="%s" aria-label="%s"%s>%s</a>'
                % (' is-active' if active else '', hrefs[code], text_lang, text_lang, title, title,
                   ' aria-current="true"' if active else '', svg))

    return '\n'.join([
        '      <nav class="lang-switch" aria-label="%s">' % SWITCH_LABEL[lang],
        link('de', 'Deutsch', at, 'de'),
        link('en', 'English', gb, 'en'),
        '      </nav>',
    ])


def fix_assets_for_en(text):
    for asset in ('styles.css', 'help.css', 'favicon.svg', 'favicon-32.png', 'apple-touch-icon.png', 'app.js'):
        text = text.replace('"./%s' % asset, '"../%s' % asset)
    return text


def build():
    version = current_version()

    # Deutsche Seiten: Kopf und Umschalter fuellen
    for key in ('index', 'help'):
        path = PAGES[key]['de']
        text = read(path)
        text = fill(text, 'head', head_block(key, 'de', version))
        text = fill(text, 'switch', switch_block(key, 'de'))
        write(path, text)

    # Englische Startseite aus der deutschen ableiten
    text = read('index.html')
    text = text.replace('<html lang="de-AT">', '<html lang="en">', 1)
    for de, en, count in STATIC_EN:
        found = text.count(de)
        assert found == count, 'Statischer Text %d-mal gefunden (erwartet %d): %s' % (found, count, de[:60])
        text = text.replace(de, en)
    text = fill(text, 'about', ABOUT_EN.rstrip('\n'))
    text = fill(text, 'noscript', NOSCRIPT_EN.rstrip('\n'))
    text = fill(text, 'head', head_block('index', 'en', version))
    text = fill(text, 'switch', switch_block('index', 'en'))
    write('en/index.html', fix_assets_for_en(text))

    # Englische Anleitung: von Hand geschrieben, hier nur Kopf und Umschalter
    path = ROOT / 'en' / 'help.html'
    if path.exists():
        text = read('en/help.html')
        text = fill(text, 'head', head_block('help', 'en', version))
        text = fill(text, 'switch', switch_block('help', 'en'))
        write('en/help.html', text)

    # sitemap.xml
    rows = []
    for key, priority in (('index', '1.0'), ('help', '0.8')):
        for lang in ('de', 'en'):
            alternates = '\n'.join(
                '    <xhtml:link rel="alternate" hreflang="%s" href="%s"/>' % (code, PAGES[key]['url'][code])
                for code in ('de', 'en'))
            alternates += '\n    <xhtml:link rel="alternate" hreflang="x-default" href="%s"/>' % PAGES[key]['url']['de']
            rows.append('  <url>\n    <loc>%s</loc>\n%s\n    <priority>%s</priority>\n  </url>' % (PAGES[key]['url'][lang], alternates, priority))
    write('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + '\n'.join(rows) + '\n</urlset>\n')
    print('build-lang: Version %d, Seiten und sitemap.xml aktualisiert' % version)


if __name__ == '__main__':
    build()
