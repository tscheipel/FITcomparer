# FITcomparer
# Copyright (c) 2026 Tobias Scheipel
# SPDX-License-Identifier: MIT
"""Erhoeht die Versionsnummer (?v=N) an allen lokalen CSS-/JS-Verweisen.

Aufruf vor dem Hochladen:  python bump-version.py
Browser laden so nach einer Aenderung garantiert die neuen Dateien statt der zwischengespeicherten.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).parent
PATTERN = re.compile(r"(\./[\w.-]+\.(?:css|js))\?v=(\d+)")
FILES = ['index.html', 'help.html', 'app.js']

versions = [int(m.group(2)) for name in FILES for m in PATTERN.finditer((ROOT / name).read_text(encoding='utf-8'))]
new = max(versions) + 1
for name in FILES:
    path = ROOT / name
    text = path.read_text(encoding='utf-8')
    path.write_text(PATTERN.sub(lambda m: f'{m.group(1)}?v={new}', text), encoding='utf-8', newline='')
print(f'Version {new}')
