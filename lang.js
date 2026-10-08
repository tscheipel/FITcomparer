/*
 * FITcomparer
 * Copyright (c) 2026 Tobias Scheipel
 * SPDX-License-Identifier: MIT
 * See the LICENSE file in the project root for the full license text.
 */

// Sprachwahl. Klassisches Skript im <head>, damit eine Weiterleitung vor dem ersten Zeichnen passiert.
//  1. Ein Klick auf eine Flagge speichert die Wahl (localStorage).
//  2. Deutsche Seiten leiten beim allerersten Besuch auf die englische Gegenseite um, wenn der Browser
//     auf Englisch eingestellt ist. Nicht bei gespeicherter Wahl und nicht fuer Suchmaschinen-Bots,
//     sonst saehe Google die deutsche Startseite nie.
(function () {
  var KEY = 'fitcomparer-lang';

  function stored() {
    try {
      return localStorage.getItem(KEY);
    } catch (error) {
      return null;
    }
  }

  document.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('.lang-link');
    if (!link) {
      return;
    }
    try {
      localStorage.setItem(KEY, link.getAttribute('lang') === 'en' ? 'en' : 'de');
    } catch (error) {
      // Privater Modus: die Wahl gilt dann nur fuer diesen Klick.
    }
  });

  var isGerman = /^de/i.test(document.documentElement.lang);
  var isBot = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|lighthouse|headless|pagespeed/i.test(navigator.userAgent);
  var preferred = (navigator.languages && navigator.languages[0]) || navigator.language || '';

  if (isGerman && !isBot && !stored() && /^en/i.test(preferred)) {
    // Gegenseite: "en/" vor den Dateinamen setzen (/ -> /en/, /help.html -> /en/help.html).
    var target = location.pathname.replace(/[^/]*$/, function (file) {
      return 'en/' + file;
    });
    location.replace(target + location.search + location.hash);
  }
})();
