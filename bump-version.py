# FITcomparer
# Copyright (c) 2026 Tobias Scheipel
# SPDX-License-Identifier: MIT
"""Erhoeht die Versionsnummer (?v=N) an allen lokalen CSS-/JS-/Bild-Verweisen.

Aufruf vor dem Hochladen:  python bump-version.py
Browser laden so nach einer Aenderung garantiert die neuen Dateien statt der zwischengespeicherten.
Danach laeuft build-lang.py, das die englische Startseite und die Suchmaschinen-Angaben neu schreibt.
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).parent
PATTERN = re.compile(r"(\.{1,2}/[\w.-]+\.(?:css|js|svg|png))\?v=(\d+)")
FILES = ['index.html', 'help.html', 'en/help.html', 'app.js', 'video-export.js', 'tooltips.js']


def read(name):
    path = ROOT / name
    return path.read_text(encoding='utf-8') if path.exists() else None


versions = [int(m.group(2)) for name in FILES if read(name) for m in PATTERN.finditer(read(name))]
new = max(versions) + 1
for name in FILES:
    text = read(name)
    if text is None:
        continue
    (ROOT / name).write_text(PATTERN.sub(lambda m: f'{m.group(1)}?v={new}', text), encoding='utf-8', newline='')

# lang.js-Verweise stehen in den von build-lang.py erzeugten Bloecken und folgen der Version in index.html.
subprocess.run([sys.executable, str(ROOT / 'build-lang.py')], check=True)
print(f'Version {new}')
