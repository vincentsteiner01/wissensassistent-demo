// ============================================================================
// bewegung.js  ·  Animation nur mit CSS + Web Animations API (SPEC 13.3.7)
// ----------------------------------------------------------------------------
// Technik aus Entwurf C, Regeln aus dem Matari-Projekt:
//   - Jedes abgewartete Animationsende hat eine Frist (mitFrist). Hintergrund-
//     Tabs und Headless-Browser liefern `finished` manchmal nie – Entwurf A
//     wartete ohne Frist, und die Oberfläche blieb hängen.
//   - Jeder layoutrelevante requestAnimationFrame hat setTimeout als zweites
//     Bein (naechsterFrame): rAF feuert in einem verdeckten Tab gar nicht.
//   - Keine Transition auf Breite/Höhe oder calc(var())-Längen. Höhen laufen
//     über WAAPI mit gemessenen Pixelwerten und werden danach entfernt.
//   - prefers-reduced-motion: alles springt sofort in den Endzustand.
//   - Netz zuerst, Bewegung parallel: Nichts hier sperrt eine Eingabe.
// ============================================================================

const anfrage = typeof window !== "undefined" && typeof window.matchMedia === "function"
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : null;

export const EASE = "cubic-bezier(.2,.8,.2,1)";
export const FEDER = "cubic-bezier(.34,1.36,.64,1)";

let gesperrt = false;

/** Ruhe gewünscht (Systemeinstellung) oder für Bildschirmfotos gesperrt? */
export function ruhig() {
  return gesperrt || (anfrage ? anfrage.matches : false);
}

/** Bewegung für Standbilder abschalten (?ruhig=1, Screenshots). */
export function sperren(an) {
  gesperrt = !!an;
}

/** rAF mit setTimeout als zweitem Bein – fn läuft genau einmal. */
export function naechsterFrame(fn) {
  let fertig = false;
  const lauf = function () {
    if (fertig) return;
    fertig = true;
    fn();
  };
  if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(lauf);
  window.setTimeout(lauf, 34);
}

/** Ein Versprechen höchstens ms lang abwarten; Fehler werden geschluckt. */
export function mitFrist(versprechen, ms) {
  return Promise.race([
    Promise.resolve(versprechen).then(null, function () {}),
    new Promise(function (r) {
      window.setTimeout(r, ms);
    }),
  ]);
}

export function warte(ms) {
  return new Promise(function (r) {
    window.setTimeout(r, ruhig() ? 0 : ms);
  });
}

function zahlOder(wert, standard) {
  return typeof wert === "number" ? wert : standard;
}

/**
 * Element weich einblenden: opacity, translateY 8 px, blur 4 px → 0, 360 ms,
 * gestaffelt 60 ms (höchstens 8 Stufen – die neunte Karte wartet nicht noch
 * länger). Gibt die Animation zurück; NIE abwarten.
 */
export function einblenden(el, i, opt) {
  const o = opt || {};
  if (!el || ruhig() || typeof el.animate !== "function") return null;
  const stufe = Math.min(zahlOder(i, 0), 7);
  const y = zahlOder(o.y, 8);
  try {
    return el.animate(
      [
        { opacity: 0, transform: "translateY(" + y + "px)", filter: "blur(" + zahlOder(o.blur, 4) + "px)" },
        { opacity: 1, transform: "none", filter: "blur(0)" },
      ],
      {
        duration: zahlOder(o.dauer, 360),
        delay: zahlOder(o.start, 0) + stufe * zahlOder(o.abstand, 60),
        easing: o.easing || EASE,
        fill: "backwards",
      },
    );
  } catch (e) {
    return null;
  }
}

/** Ausblenden (Endzustand bleibt stehen, bis der Aufrufer das Element entfernt). */
export function ausblenden(el, opt) {
  const o = opt || {};
  if (!el || ruhig() || typeof el.animate !== "function") return Promise.resolve();
  const dauer = zahlOder(o.dauer, 200);
  let a;
  try {
    a = el.animate(
      [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: "translateY(" + zahlOder(o.y, -8) + "px) scale(" + zahlOder(o.skala, 0.98) + ")" },
      ],
      { duration: dauer, easing: EASE, fill: "forwards" },
    );
  } catch (e) {
    return Promise.resolve();
  }
  return mitFrist(a.finished, dauer + 80);
}

/**
 * Höhe weich morphen: misst vorher/nachher, animiert px → px, räumt auf.
 * aenderung() verändert den Inhalt synchron.
 */
export function hoeheMorphen(el, aenderung, dauer) {
  const d = zahlOder(dauer, 280);
  if (!el || ruhig() || typeof el.animate !== "function") {
    aenderung();
    return Promise.resolve();
  }
  const h1 = el.getBoundingClientRect().height;
  aenderung();
  const h2 = el.getBoundingClientRect().height;
  if (Math.abs(h1 - h2) < 1 || !h1) return Promise.resolve();
  let a;
  try {
    a = el.animate([{ height: h1 + "px" }, { height: h2 + "px" }], { duration: d, easing: EASE });
  } catch (e) {
    return Promise.resolve();
  }
  el.style.setProperty("overflow", "hidden");
  return mitFrist(a.finished, d + 80).then(function () {
    try {
      a.cancel();
    } catch (e) {
      // schon weg
    }
    el.style.removeProperty("overflow");
  });
}

/**
 * Markenfarbe als rgba() für aufleuchten(): aus der berechneten Variable
 * --marke-500 (gesetzt aus farben.variablen, sonst der Rückfallwert aus
 * design.css). Fest verdrahtetes Blau wirkte bei roter oder gelber Marke
 * fremd (Befund design-06). Die Stopp-Box leuchtet weiter rot – das ist keine Marke.
 */
export function markeRgba(alpha) {
  const a = typeof alpha === "number" && isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.24;
  let hex = "";
  try {
    hex = String(window.getComputedStyle(document.documentElement).getPropertyValue("--marke-500") || "").trim();
  } catch (e) {
    hex = "";
  }
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!m) return "rgba(54,116,197," + a + ")";
  return "rgba(" + parseInt(m[1], 16) + "," + parseInt(m[2], 16) + "," + parseInt(m[3], 16) + "," + a + ")";
}

/** Einmaliges, weiches Aufleuchten (Stopp-Box, hervorgehobene Akte). */
export function aufleuchten(el, farbe) {
  if (!el || ruhig() || typeof el.animate !== "function") return;
  const f = farbe || "rgba(180,35,24,.28)";
  const aus = f.replace(/[\d.]+\)\s*$/, "0)");
  try {
    el.animate([{ boxShadow: "0 0 0 0 " + f }, { boxShadow: "0 0 0 10px " + aus }], { duration: 1400, easing: EASE });
  } catch (e) {
    // ohne Leuchten weiter
  }
}

/**
 * Zahl hochzählen. Der Endwert ist garantiert: Ein Timer setzt ihn spätestens
 * nach dauer + 80 ms – auch wenn kein einziger Frame kam.
 */
export function hochzaehlen(el, ziel, opt) {
  const o = opt || {};
  const dauer = zahlOder(o.dauer, 600);
  const start = zahlOder(o.verzoegerung, 0);
  const fmt = typeof o.format === "function" ? o.format : function (n) {
    return String(n);
  };
  if (!el) return;
  if (ruhig()) {
    el.textContent = fmt(ziel);
    return;
  }
  el.textContent = fmt(0);
  const jetzt = function () {
    return window.performance && window.performance.now ? window.performance.now() : Date.now();
  };
  const t0 = jetzt() + start;
  let fertig = false;
  const schritt = function () {
    if (fertig) return;
    const t = Math.min(1, Math.max(0, (jetzt() - t0) / dauer));
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(Math.round(ziel * e));
    if (t < 1) naechsterFrame(schritt);
    else fertig = true;
  };
  window.setTimeout(function () {
    naechsterFrame(schritt);
  }, start);
  window.setTimeout(function () {
    fertig = true;
    el.textContent = fmt(ziel);
  }, start + dauer + 80);
}

/** Kurzer Druck (Tastenkappe, Auswahl). Nie abwarten. */
export function druecken(el) {
  if (!el || ruhig() || typeof el.animate !== "function") return;
  try {
    el.animate([{ transform: "scale(1)" }, { transform: "scale(.96)" }, { transform: "scale(1)" }], { duration: 240, easing: FEDER });
  } catch (e) {
    // egal
  }
}

/**
 * Eine Animation mit Frist abwarten – der einzige erlaubte Weg, auf
 * das Ende einer Animation zu warten (Prüfung 13.4.3).
 */
export function animiereUndWarte(el, keyframes, optionen) {
  if (!el || ruhig() || typeof el.animate !== "function") return Promise.resolve();
  let a;
  try {
    a = el.animate(keyframes, optionen);
  } catch (e) {
    return Promise.resolve();
  }
  return mitFrist(a.finished, (optionen && optionen.duration ? optionen.duration : 240) + 80);
}
