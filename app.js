// ============================================================================
// app.js  ·  App-Schale „Einfach (Mike)“ (SPEC 8, 12.6, 13.3, 14.3)
// ----------------------------------------------------------------------------
// Mike (Laie, steht für die echten Nutzer): „Akte immer links …, dass du egal
// wo du bist … es halt immer sehen kannst. Chat und rechts … Sachen, die
// wichtig sind.“ Und: „so simpel … so wenig Text wie möglich“. Deshalb:
//
//   Zwei Zonen statt drei. Links die Akte des Falls (bzw. ohne Fall die
//   Fallsuche „Kunde, Adresse oder Anlagennummer“) – auf jedem Bildschirm,
//   auch in „Wissen aufladen“. Rechts der Chat mit einer schmalen Leiste
//   „Wichtig“ darüber (Stopp, „Kommt wieder: 3× in 34 Tagen“, überfällige
//   Wiedervorlage). Die frühere Herkunfts-Spalte steckt hinter „Woher?“ an
//   jeder Antwort und öffnet als Blatt (≥ 1024 von rechts, sonst von unten).
//   Unter 1024 px wird die Akte zur einklappbaren Kopfkarte.
//
// Zweistufiges Rendern bleibt (SPEC 4, 8): Was aus SQL kommt (Stopp-Box,
// Cautions, Steckbrief → Akte links), steht nach ein bis zwei Sekunden da;
// darunter „Ich schaue nach …“. Kommt `antwort`, ersetzt sie die Vorab-
// Ansicht. Kommt `fehler`, bleiben die Vorab-Blöcke stehen (sie stammen aus
// der Datenbank und sind gültig).
//
// Netz zuerst, Bewegung parallel: Die Anfrage startet im selben Takt wie der
// Klick (auch beim Fragebaum: „fertig“ schickt sofort); Animationen sperren
// nie eine Eingabe und werden nur mit Frist abgewartet.
//
// „Wissen aufladen“, Freigaben und Einrichtung bauen die Module abgeben.js,
// handbuch.js, freigabe.js, einrichtung.js – app.js lädt sie per import()
// in den rechten Container und gibt ihnen ctx (SPEC 13.3.9).
// ============================================================================
import * as api from "./api.js";
import { datum, datumKurz, h, initialen, leeren, typo, uhrzeit } from "./dom.js";
import { ikon } from "./ikonen.js";
import { animiereUndWarte, aufleuchten, ausblenden, einblenden, EASE, hoeheMorphen, markeRgba, mitFrist, naechsterFrame, ruhig, sperren } from "./bewegung.js";
import {
  attributMarken,
  gruppiereQuellen,
  HAUPTGERAETE,
  KANAELE,
  KATEGORIE_KURZ,
  loesungenEinklappen,
  KOMPONENTEN,
  KOMPONENTEN_IKON,
  MASSNAHME_ART,
  QUELLEN_ARTEN,
  QUELLEN_IKON,
  quellenDerAntwort,
  renderAntwort,
  renderBlock,
  ROLLEN_NAMEN,
  ROLLEN_RANG,
} from "./bloecke.js";

// --- Feste Texte -----------------------------------------------------------------

/**
 * Vorschläge im leeren Chat (14.3.3): ein kurzer Knopf, der nur das Eingabefeld
 * füllt – der Interessent sieht, was er gleich fragt, und darf es ändern.
 */
// Der erste Vorschlag nennt bewusst keine Anlagennummer – ein Anrufer nennt
// keine. So führt der naheliegende erste Klick zu „Welche Frau Petersen?“
// (Mikes Punkt 3: am Telefon über die Adresse erkennen), ohne KI und ohne
// Kosten; „Lindenstraße 14“ antippen, dann läuft T1 (Gegenprüfung 09.10.).
const VORSCHLAEGE = {
  kundenbetreuer: [
    ["Wärmepumpe in Störung", "Frau Petersen ruft an, ihre Wärmepumpe ist wieder in Störung."],
    ["Sicherung fliegt raus", "Herr Brandt fragt, ob wir nicht einfach eine größere Sicherung reinmachen können, die fliegt ständig. A-2177."],
    ["App geht nicht", "Kunde kommt nicht mehr in die App."],
  ],
  technik: [
    ["Wärmepumpe in Störung", "Frau Petersen ruft an, ihre Wärmepumpe ist wieder in Störung."],
    ["Sicherung fliegt raus", "Herr Brandt fragt, ob wir nicht einfach eine größere Sicherung reinmachen können, die fliegt ständig. A-2177."],
    ["Vor Ort", "Bin bei A-1042 vor Ort, was soll ich prüfen?"],
  ],
};

/**
 * Regel-Hinweise, die in die Leiste „Wichtig“ wandern, sobald die
 * Wiederholung dort steht – mit kurzem Chip-Text. R09 („Wiederholtes
 * Nachfüllen ohne Ursachensuche“) sagte sonst als Karte im Chat noch einmal,
 * was „Kommt wieder: 3× in 34 Tagen“ schon sagt (Gegenprüfung 09.10.).
 */
const WICHTIG_REGELN = { R09: "Nicht nur nachfüllen" };

const ROLLEN_IKON = { kundenbetreuer: "telefon", standortleiter: "team", techniker: "werkzeug", meister: "freigabe", ingenieur: "einstellungen" };

const STANDARD_BRANDING = {
  branding: { firmenname: "Wissensassistent", untertitel: null, primaerfarbe: "#1F5FAE", logo_data_url: null },
  farben: null,
};

/** Routen (SPEC 13.3.2; sichtbar heißen die Modi „Kunden betreuen“ und „Wissen aufladen“, 14.3.10). */
const ROUTEN = {
  "/brauchen": { recht: null, modus: "brauchen", titel: "Kunden betreuen" },
  "/abgeben": { recht: "erfahrung", modus: "abgeben", modul: "abgeben", fn: "zeigeAbgeben", titel: "Wissen aufladen" },
  "/abgeben/erfahrung": { recht: "erfahrung", modus: "abgeben", modul: "abgeben", fn: "zeigeErfahrung", titel: "Erfahrung festhalten" },
  "/abgeben/einsatz": { recht: "einsatz", modus: "abgeben", modul: "abgeben", fn: "zeigeEinsatz", titel: "Einsatz dokumentieren" },
  "/abgeben/handbuch": { recht: "handbuch", modus: "abgeben", modul: "handbuch", fn: "zeigeHandbuch", titel: "Handbuch hochladen", zurueck: true },
  "/freigaben": { recht: "freigabe", modus: "abgeben", modul: "freigabe", fn: "zeigeFreigabe", titel: "Freigaben" },
  // Einrichtung ist Logo und Farbe des Betriebs, kein Kundenfall – und braucht
  // die ganze Breite für ihre Live-Vorschau. Deshalb ohne Akte links.
  "/einrichtung": { recht: "einrichtung", modus: null, modul: "einrichtung", fn: "zeigeEinrichtung", titel: "Einrichtung", ohneAkte: true },
};

const MODUL_DATEI = {
  abgeben: "./abgeben.js",
  handbuch: "./handbuch.js",
  freigabe: "./freigabe.js",
  einrichtung: "./einrichtung.js",
};

const MODUS_SPEICHER = "wa.modus";

/** Fortschrittstexte des Servers für „Geprüft“ im Blatt (14.3.9) – sonst wörtlich. */
const GEPRUEFT = [
  [/^Anlage .* über .* gefunden/, "Kunde erkannt"],
  [/^Anlage .* geladen/, "Akte geladen"],
  [/^Regeln geprüft/, "Regeln geprüft"],
  [/^Wiederholung erkannt/, "Wiederholung erkannt"],
  [/^(Verifizierte|Ähnliche) Fälle geladen/, "Ähnliche Fälle gezählt"],
  [/^Frage geht an das Modell/, "KI formuliert"],
];

// --- Zustand -----------------------------------------------------------------------

const z = {
  sitzung: null,
  branding: STANDARD_BRANDING,
  modus: "brauchen",
  fall: null, // {anlage_id, kunde_alias} – die Anlage, die sich die Sitzung (Server) merkt
  gewaehlt: null, // {anlage_id, kunde_alias} – aus Fallsuche, Auswahl oder „Akte ansehen“; gilt bis meta.fall
  fallVorab: null, // Anlage aus dem Vorab-Steckbrief, bevor meta.fall sie bestätigt
  fallVorabName: "",
  suchen: false, // Fallsuche ausdrücklich angefordert („Keine davon“), obwohl eine Akte offen ist
  wahlNr: 0, // zählt jede neue Kundenwahl – eine ältere, noch laufende Antwort darf sie nicht überschreiben
  akte: null, // letzte Antwort von GET akte
  akteId: null,
  akteFehler: null,
  akteNr: 0,
  liste: null, // Promise der Anlagenliste (GET akte?liste=1), einmal je Sitzung
  listeDaten: null,
  linksArt: null, // "suche" | "akte" | "aus"
  kopfkarteAuf: false, // < 1024: Akte aufgeklappt
  verlaufAuf: true,
  verlaufAlle: false,
  mehrAuf: false,
  laeuft: false,
  runden: [],
  wichtigAlle: false,
  route: null,
  modul: null,
  routeNr: 0,
  ignoriereHash: false,
  passcode: "", // nur zwischen Passcode und Rollenwahl, nie gespeichert
  login: null,
  freigabenOffen: 0,
  blatt: null, // offenes Blatt {el, schliessen}
  quelleNr: 0,
};

// --- Kleine Helfer -------------------------------------------------------------------

function $(id) {
  return document.getElementById(id);
}

function speicherLesen(schluessel) {
  try {
    return window.sessionStorage.getItem(schluessel);
  } catch (e) {
    return null;
  }
}

function speicherSchreiben(schluessel, wert) {
  try {
    if (wert === null) window.sessionStorage.removeItem(schluessel);
    else window.sessionStorage.setItem(schluessel, wert);
  } catch (e) {
    // privat/gesperrt: dann eben nicht merken
  }
}

const MQ = {
  schmal: window.matchMedia("(max-width: 1023.98px)"),
  handy: window.matchMedia("(max-width: 639.98px)"),
};

function schmal() {
  return MQ.schmal.matches;
}

function istZeigegeraet() {
  return !!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches);
}

function rolleName(rolle) {
  return ROLLEN_NAMEN[rolle] || rolle || "";
}

function rechte() {
  return (z.sitzung && z.sitzung.rechte) || api.rechteFuer(z.sitzung ? z.sitzung.rolle : "", z.sitzung ? z.sitzung.ist_admin : false);
}

function fokus(el) {
  if (!el) return;
  try {
    el.focus({ preventScroll: true });
  } catch (e) {
    el.focus();
  }
}

/** Zwei Frames (mit setTimeout-Bein), damit Höhen nach dem Einfügen feststehen. */
function nachDemZeichnen(fn) {
  naechsterFrame(function () {
    naechsterFrame(fn);
  });
}

function attrWert(id) {
  return String(id).replace(/["\\]/g, "");
}

/** Bewegung, die nie abgewartet wird (bei ruhig() gar keine). */
function bewege(el, frames, dauer) {
  if (!el || ruhig() || typeof el.animate !== "function") return null;
  try {
    return el.animate(frames, { duration: dauer, easing: EASE });
  } catch (e) {
    return null;
  }
}

/**
 * Für die Fallsuche: klein, ohne Umlaute, „str.“ → „strasse“ (14.3.4); die
 * Anlagennummer ohne Bindestrich („A1042“, „A 1042“ → „a1042“) – auf beiden
 * Seiten, sonst fand „A1042“ nichts (Gegenprüfung 09.10.).
 */
function suchform(s) {
  return String(s || "").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/str\./g, "strasse")
    .replace(/\ba\s?[-–‑]?\s?(\d{4})\b/g, "a$1");
}

// --- Branding ------------------------------------------------------------------------

const MARKE_SCHLUESSEL = /^--(marke(-[a-z0-9]+)*|auf-marke)$/;
const HEX = /^#[0-9A-F]{6}$/;
const LOGO_OK = /^data:image\/(png|svg\+xml|webp|jpeg);base64,/;

/**
 * Markenfarben als CSS-Variablen setzen (SPEC 13.3.6). Nur Schlüssel der
 * Marken-Familie und nur #RRGGBB – ein Wert aus der Datenbank wird nie als
 * beliebiges CSS übernommen.
 */
function farbenSetzen(ziel, farben) {
  const stil = ziel.style;
  const gesetzt = [];
  for (let i = stil.length - 1; i >= 0; i--) {
    const name = stil[i];
    if (MARKE_SCHLUESSEL.test(name)) gesetzt.push(name);
  }
  gesetzt.forEach(function (n) {
    stil.removeProperty(n);
  });
  if (!farben || typeof farben !== "object") return;
  let werte = farben.variablen && typeof farben.variablen === "object" ? farben.variablen : null;
  if (!werte) {
    werte = {
      "--marke": farben.primaer,
      "--marke-knopf": farben.primaer,
      "--auf-marke": farben.text_auf_primaer,
      "--marke-text": farben.akzent_auf_hell,
      "--marke-text-dunkel": farben.akzent_auf_dunkel,
    };
  }
  Object.keys(werte).forEach(function (k) {
    const v = String(werte[k] || "").toUpperCase();
    if (MARKE_SCHLUESSEL.test(k) && HEX.test(v)) stil.setProperty(k, v);
  });
}

/**
 * Logo NUR per <img src> (SPEC 12.6): Ein SVG im <img> führt kein Skript aus
 * und lädt nichts nach – inline eingebunden täte es beides.
 */
function logoElement(klasse) {
  const b = z.branding.branding || {};
  if (!b.logo_data_url || !LOGO_OK.test(String(b.logo_data_url))) return null;
  const plakette = h("span", { class: "logo-plakette " + (klasse || "") });
  const bild = h("img", { src: b.logo_data_url, alt: b.firmenname || "Logo", onload: function () {
    logoFormat(plakette, bild);
  } });
  plakette.appendChild(bild);
  if (bild.complete && bild.naturalWidth) logoFormat(plakette, bild);
  return plakette;
}

/** Wortbild (nennt den Namen schon) oder Zeichen (Name daneben)? */
function logoFormat(plakette, bild) {
  const w = bild.naturalWidth || 0;
  const hoehe = bild.naturalHeight || 0;
  if (!w || !hoehe) return;
  plakette.setAttribute("data-format", w / hoehe > 1.6 ? "breit" : "quadrat");
}

function marke(klasseLogo) {
  const b = z.branding.branding || STANDARD_BRANDING.branding;
  const logo = logoElement(klasseLogo);
  return [logo, h("span", { class: "marke-name" + (logo ? " mit-logo" : ""), text: b.firmenname || "Wissensassistent" })];
}

function brandingAnwenden() {
  const b = z.branding.branding || STANDARD_BRANDING.branding;
  farbenSetzen(document.documentElement, z.branding.farben);
  document.title = "Wissensassistent · " + (b.firmenname || "Demo") + (api.istMock ? " (Mock)" : "");
  const k = $("kopf-marke");
  if (k) {
    leeren(k);
    marke("logo-kopf").forEach(function (e) {
      if (e) k.appendChild(e);
    });
  }
  // Nur das Logo tauschen, nicht die Login-Seite: Kommt das Branding nach mehr
  // als 2,5 s (kalter Start), wäre ein schon getippter Passcode sonst weg.
  const l = $("login-kopf");
  if (l) {
    leeren(l);
    marke("logo-gross").forEach(function (e) {
      if (e) l.appendChild(e);
    });
  }
}

async function brandingLaden() {
  try {
    const r = await api.einrichtung();
    if (r && r.branding) z.branding = { branding: r.branding, farben: r.farben || null };
  } catch (e) {
    // Die Anmeldung darf nie am Branding hängen (SPEC 12.6).
    console.warn("Branding nicht geladen, Standardwerte:", e && e.message ? e.message : e);
    z.branding = STANDARD_BRANDING;
  }
  brandingAnwenden();
}

// --- Toast und Bestätigung -------------------------------------------------------------

function toast(text, art) {
  const ziel = $("toasts");
  if (!ziel) return;
  const symbol = { gut: "haken", hinweis: "info", achtung: "achtung", fehler: "stopp" }[art] || "info";
  const t = h("div", { class: "toast toast-" + (art || "hinweis"), role: art === "fehler" ? "alert" : "status" },
    ikon(symbol, { groesse: 16 }), h("span", { text: typo(text) }));
  ziel.appendChild(t);
  einblenden(t, 0, { y: 12, blur: 0, dauer: 240 });
  window.setTimeout(function () {
    ausblenden(t, { y: 12, dauer: 240 }).then(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
    });
  }, 4000);
}

/** Bestätigungsdialog → Promise<boolean>. Esc und Schleier = nein. */
function bestaetigen(frage, optionen) {
  const o = optionen || {};
  return new Promise(function (fertig) {
    const vorher = document.activeElement;
    const schleier = h("div", { class: "dialog-schleier" });
    const ja = h("button", { type: "button", class: "knopf " + (o.gefahr ? "knopf-gefahr" : "knopf-primaer"), text: o.ja || "OK" });
    const nein = h("button", { type: "button", class: "knopf knopf-rand", text: o.nein || "Abbrechen" });
    const titelId = "dialog-" + Date.now();
    const box = h("div", { class: "dialog", role: "alertdialog", "aria-modal": "true", "aria-labelledby": titelId },
      h("p", { class: "dialog-text", id: titelId, text: typo(frage) }),
      h("div", { class: "dialog-knoepfe" }, nein, ja));
    const huelle = h("div", { class: "dialog-huelle" }, schleier, box);
    document.body.appendChild(huelle);
    const rest = [$("app")];
    rest.forEach(function (r) {
      if (r) r.setAttribute("inert", "");
    });
    let erledigt = false;
    function schliessen(wert) {
      if (erledigt) return;
      erledigt = true;
      document.removeEventListener("keydown", tasten, true);
      rest.forEach(function (r) {
        if (r && !z.blatt) r.removeAttribute("inert");
      });
      ausblenden(box, { y: 8, dauer: 160 }).then(function () {
        if (huelle.parentNode) huelle.parentNode.removeChild(huelle);
      });
      if (vorher && vorher.focus) fokus(vorher);
      fertig(wert);
    }
    function tasten(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        schliessen(false);
      } else if (e.key === "Tab") {
        const ziele = [nein, ja];
        const i = ziele.indexOf(document.activeElement);
        e.preventDefault();
        fokus(ziele[(i + 1) % 2]);
      }
    }
    document.addEventListener("keydown", tasten, true);
    ja.addEventListener("click", function () {
      schliessen(true);
    });
    nein.addEventListener("click", function () {
      schliessen(false);
    });
    schleier.addEventListener("click", function () {
      schliessen(false);
    });
    einblenden(box, 0, { y: 8, dauer: 200 });
    fokus(o.gefahr ? nein : ja);
  });
}

// --- Blatt (Woher?, Quelle, Bild) -----------------------------------------------------------

/**
 * Ein Blatt über der App (14.3.4, 14.3.9): ab 1024 px von rechts (420 px,
 * Schleier), darunter von unten (max. 88 dvh, Griff, nach unten wischen).
 * Immer modal: App dahinter `inert`, Fokusfalle, Esc, ✕, Schleier; beim
 * Schließen geht der Fokus zurück auf den Auslöser („Woher?“).
 */
function blattOeffnen(titel, ausloeser) {
  if (z.blatt) z.blatt.schliessen(true);
  const titelEl = h("h2", { class: "blatt-titel", id: "blatt-titel", text: titel });
  const zurueckPlatz = h("div", { class: "blatt-zurueck-platz" });
  const koerper = h("div", { class: "blatt-innen" });
  const zu = h("button", { type: "button", class: "rund blatt-zu", "aria-label": "Schließen" }, ikon("schliessen", { groesse: 18 }));
  const blatt = h("aside", { class: "blatt", role: "dialog", "aria-modal": "true", "aria-labelledby": "blatt-titel", tabindex: "-1" },
    h("div", { class: "blatt-griff", "aria-hidden": "true" }),
    h("div", { class: "blatt-kopf" }, zurueckPlatz, titelEl, zu),
    koerper);
  const schleier = h("div", { class: "schleier" });
  document.body.appendChild(schleier);
  document.body.appendChild(blatt);
  const app = $("app");
  if (app) app.setAttribute("inert", "");
  einblenden(schleier, 0, { y: 0, blur: 0, dauer: 240 });
  if (schmal()) bewege(blatt, [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], 320);
  else bewege(blatt, [{ transform: "translateX(24px)", opacity: 0 }, { transform: "none", opacity: 1 }], 280);

  let offen = true;
  function tasten(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      griff.schliessen(false);
      return;
    }
    if (e.key !== "Tab") return;
    const ziele = Array.prototype.filter.call(
      blatt.querySelectorAll("button, [href], input, select, textarea, summary, [tabindex]:not([tabindex='-1'])"),
      function (el) { return !el.disabled && el.offsetParent !== null; });
    if (!ziele.length) return;
    const erstes = ziele[0];
    const letztes = ziele[ziele.length - 1];
    if (e.shiftKey && (document.activeElement === erstes || document.activeElement === blatt)) {
      e.preventDefault();
      fokus(letztes);
    } else if (!e.shiftKey && document.activeElement === letztes) {
      e.preventDefault();
      fokus(erstes);
    }
  }
  document.addEventListener("keydown", tasten, true);

  const griff = {
    el: blatt,
    koerper: koerper,
    titel: function (t) { titelEl.textContent = t; },
    zurueck: function (fn) {
      leeren(zurueckPlatz);
      if (fn) {
        zurueckPlatz.appendChild(h("button", { type: "button", class: "blatt-zurueck", onclick: fn }, ikon("zurueck", { groesse: 16 }), "Zurück"));
      }
    },
    schliessen: function (sofort) {
      if (!offen) return Promise.resolve();
      offen = false;
      document.removeEventListener("keydown", tasten, true);
      if (z.blatt === griff) z.blatt = null;
      leuchtenAus();
      const warten = sofort || ruhig() ? Promise.resolve() : animiereUndWarte(blatt,
        schmal() ? [{ transform: "translateY(0)" }, { transform: "translateY(100%)" }] : [{ transform: "none", opacity: 1 }, { transform: "translateX(24px)", opacity: 0 }],
        { duration: 240, easing: EASE });
      const schleierWeg = sofort || ruhig() ? Promise.resolve() : ausblenden(schleier, { y: 0, skala: 1, dauer: 240 });
      if (app && !document.querySelector(".dialog-huelle")) app.removeAttribute("inert");
      if (!sofort && ausloeser && ausloeser.isConnected) fokus(ausloeser);
      return mitFrist(Promise.all([warten, schleierWeg]), 320).then(function () {
        if (blatt.parentNode) blatt.parentNode.removeChild(blatt);
        if (schleier.parentNode) schleier.parentNode.removeChild(schleier);
      });
    },
  };
  zu.addEventListener("click", function () { griff.schliessen(false); });
  schleier.addEventListener("click", function () { griff.schliessen(false); });
  blattWischen(blatt, griff);
  // Überfahren einer Quelle im Blatt lässt die zitierenden Aussagen im Chat dahinter aufleuchten.
  blatt.addEventListener("mouseover", leuchtenUeber);
  blatt.addEventListener("mouseout", leuchtenWeg);
  blatt.addEventListener("focusin", leuchtenUeber);
  blatt.addEventListener("focusout", leuchtenWeg);
  z.blatt = griff;
  naechsterFrame(function () { fokus(zu); });
  return griff;
}

/**
 * Blatt am Kopf nach unten ziehen (< 1024 px): folgt dem Finger (transform,
 * keine transition); ab 80 px oder schnellem Wisch zu, sonst federt es zurück.
 * Knöpfe im Kopf starten keinen Zug.
 */
function blattWischen(blatt, griff) {
  if (typeof window.PointerEvent !== "function") return;
  let zug = null;
  blatt.addEventListener("pointerdown", function (e) {
    if (!schmal()) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const t = e.target;
    if (!t || !t.closest || !(t.closest(".blatt-kopf") || t.closest(".blatt-griff")) || t.closest("button, a, input, select, textarea")) return;
    zug = { id: e.pointerId, y0: e.clientY, t0: Date.now(), dy: 0, aktiv: false };
    try {
      blatt.setPointerCapture(e.pointerId);
    } catch (x) {
      // ohne Capture
    }
  });
  blatt.addEventListener("pointermove", function (e) {
    if (!zug || e.pointerId !== zug.id) return;
    zug.dy = Math.max(0, e.clientY - zug.y0);
    if (!zug.aktiv && zug.dy > 6) zug.aktiv = true;
    if (zug.aktiv) {
      e.preventDefault();
      blatt.style.setProperty("transform", "translateY(" + zug.dy + "px)");
    }
  });
  function ende(e) {
    if (!zug || e.pointerId !== zug.id) return;
    const z2 = zug;
    zug = null;
    if (!z2.aktiv) return;
    const tempo = z2.dy / Math.max(1, Date.now() - z2.t0);
    const von = "translateY(" + z2.dy + "px)";
    if (z2.dy > 80 || tempo > 0.6) {
      const weg = ruhig() ? Promise.resolve() : animiereUndWarte(blatt, [{ transform: von }, { transform: "translateY(100%)" }], { duration: 200, easing: EASE });
      mitFrist(weg, 280).then(function () {
        griff.schliessen(true);
        const zurueck = document.querySelector("[data-blatt-ausloeser]");
        if (zurueck) fokus(zurueck);
      });
    } else {
      blatt.style.removeProperty("transform");
      bewege(blatt, [{ transform: von }, { transform: "translateY(0)" }], 240);
    }
  }
  blatt.addEventListener("pointerup", ende);
  blatt.addEventListener("pointercancel", ende);
}

// --- Login, Rolle, Modus ----------------------------------------------------------------

function zeige(ansicht) {
  ["ansicht-laden", "ansicht-login", "ansicht-arbeit"].forEach(function (id) {
    const el = $(id);
    if (el) el.hidden = id !== ansicht;
  });
  document.body.setAttribute("data-ansicht", ansicht.replace("ansicht-", ""));
}

function zeigeLogin(schritt, daten) {
  z.login = { schritt: schritt || "passcode", daten: daten || null, fehler: "" };
  $("kopf").hidden = true;
  zeige("ansicht-login");
  loginNeu();
}

function loginFehler(text) {
  if (!z.login) return;
  z.login.fehler = text || "";
  const f = $("login-fehler");
  if (f) f.textContent = z.login.fehler;
}

/** Eine große Kachel mit Symbol, einem Wort und höchstens einer kurzen Zeile. */
function kachel(ikonName, titel, zeile, onclick, extra) {
  return h("button", { type: "button", class: "kachel", onclick: onclick },
    h("span", { class: "kachel-ikon", "aria-hidden": "true" }, ikon(ikonName, { groesse: 28 })),
    h("span", { class: "kachel-text" }, h("strong", { text: titel }), zeile ? h("span", { text: zeile }) : null),
    extra || null);
}

/**
 * Login, Rolle, Modus: eine Sache je Bildschirm (14.3.3). Login = Logo,
 * Passcode, ein Satz Datenschutz – der eine Satz, der bleiben muss: Wer tippt,
 * muss wissen, dass protokolliert wird.
 */
function loginNeu() {
  const ziel = $("ansicht-login");
  if (!ziel || !z.login) return;
  const schritt = z.login.schritt;
  leeren(ziel);
  const innen = h("div", { class: "einstieg-innen" });
  if (schritt === "passcode") {
    const kopf = h("div", { class: "einstieg-logo", id: "login-kopf" }, marke("logo-gross"));
    const feld = h("input", {
      class: "passcode-feld",
      id: "passcode",
      type: "password",
      placeholder: "Passcode",
      "aria-label": "Passcode",
      autocomplete: "current-password",
      autocapitalize: "off",
      autocorrect: "off",
      spellcheck: "false",
      required: true,
      "aria-describedby": "login-fehler",
    });
    const weiter = h("button", { type: "submit", class: "rund senden passcode-weiter", id: "passcode-weiter", "aria-label": "Weiter" }, ikon("weiter", { groesse: 22, strich: 2 }));
    innen.appendChild(kopf);
    innen.appendChild(h("form", { class: "passcode", novalidate: true, onsubmit: passcodeAbschicken }, feld, weiter));
    innen.appendChild(h("p", { class: "login-fehler", id: "login-fehler", role: "alert", text: z.login.fehler || "" }));
    innen.appendChild(h("p", { class: "einstieg-fuss", text: "Bitte keine echten Kundendaten – Eingaben werden protokolliert." }));
    naechsterFrame(function () {
      if (istZeigegeraet()) fokus(feld);
    });
  } else if (schritt === "rolle") {
    const d = z.login.daten || {};
    const rollen = (d.rollen || []).slice().sort(function (a, c) {
      return (ROLLEN_RANG[a] || 9) - (ROLLEN_RANG[c] || 9);
    });
    innen.appendChild(h("button", { type: "button", class: "einstieg-zurueck", "aria-label": "Anderen Passcode eingeben", onclick: function () {
      z.passcode = "";
      zeigeLogin("passcode");
    } }, ikon("zurueck", { groesse: 20 })));
    innen.appendChild(h("h1", { class: "einstieg-titel", text: "Wer bist du?" }));
    innen.appendChild(h("div", { class: "kacheln kacheln-" + Math.min(rollen.length, 3) }, rollen.map(function (rolle) {
      const k = kachel(ROLLEN_IKON[rolle] || "kunde", rolleName(rolle), null, function () { rolleWaehlen(rolle, k); });
      k.setAttribute("data-rolle", rolle);
      return k;
    })));
    innen.appendChild(h("p", { class: "login-fehler", id: "login-fehler", role: "alert", text: z.login.fehler || "" }));
    naechsterFrame(function () {
      fokus(innen.querySelector(".kachel"));
    });
  } else if (schritt === "modus") {
    innen.appendChild(h("h1", { class: "einstieg-titel", text: "Was steht an?" }));
    innen.appendChild(h("div", { class: "kacheln kacheln-2" },
      kachel("telefon", "Kunden betreuen", "Fall lösen", function () { modusGewaehlt("brauchen"); }),
      kachel("idee", "Wissen aufladen", "Erfahrung teilen", function () { modusGewaehlt("abgeben"); })));
    naechsterFrame(function () {
      fokus(innen.querySelector(".kachel"));
    });
  }
  ziel.appendChild(innen);
}

function loginFehlerText(err) {
  if (err && (err.status === 401 || err.code === "passcode")) return "Passcode stimmt nicht.";
  if (err && err.code === "netz") return "Keine Verbindung. Bitte gleich noch mal.";
  return err && err.message ? err.message : "Anmelden hat nicht geklappt.";
}

async function passcodeAbschicken(e) {
  e.preventDefault();
  const feld = $("passcode");
  const code = feld ? feld.value.trim() : "";
  if (!code) {
    loginFehler("Bitte den Passcode eingeben.");
    fokus(feld);
    return;
  }
  loginFehler("");
  const knopf = $("passcode-weiter");
  if (knopf) {
    knopf.disabled = true;
    knopf.setAttribute("aria-busy", "true");
    knopf.classList.add("ist-laeuft");
  }
  try {
    let r = await api.anmelden(code, null);
    if (!r.angemeldet && r.rollen.length === 1) r = await api.anmelden(code, r.rollen[0]);
    if (r.angemeldet) {
      if (feld) feld.value = "";
      angemeldet(r);
      return;
    }
    z.passcode = code;
    zeigeLogin("rolle", r);
  } catch (err) {
    if (knopf) {
      knopf.disabled = false;
      knopf.removeAttribute("aria-busy");
      knopf.classList.remove("ist-laeuft");
    }
    loginFehler(loginFehlerText(err));
    if (feld) feld.select();
  }
}

async function rolleWaehlen(rolle, knopf) {
  const alle = $("ansicht-login").querySelectorAll(".kachel");
  Array.prototype.forEach.call(alle, function (k) {
    k.disabled = true;
  });
  if (knopf) knopf.classList.add("ist-laeuft");
  loginFehler("");
  try {
    const r = await api.anmelden(z.passcode, rolle);
    if (!r.angemeldet) throw new Error("Anmelden mit dieser Rolle nicht möglich.");
    z.passcode = "";
    angemeldet(r);
  } catch (err) {
    loginFehler(loginFehlerText(err));
    Array.prototype.forEach.call(alle, function (k) {
      k.disabled = false;
    });
    if (knopf) knopf.classList.remove("ist-laeuft");
  }
}

/** Nach dem Anmelden: Moduswahl für ALLE Rollen (14.3.3 – `modus_wahl` wertet die Oberfläche nicht mehr aus). */
function angemeldet(info) {
  z.sitzung = info;
  zeigeLogin("modus");
}

function modusGewaehlt(modus) {
  z.modus = modus === "abgeben" ? "abgeben" : "brauchen";
  speicherSchreiben(MODUS_SPEICHER, z.modus);
  z.login = null;
  appStarten(z.modus === "abgeben" ? "#/abgeben" : "#/brauchen");
}

function abmelden() {
  api.abmelden();
  speicherSchreiben(MODUS_SPEICHER, null);
  // Neu laden statt Zustand von Hand zurückzusetzen: Eine noch laufende
  // Antwort, offene Formulare und Blob-URLs sind damit sicher weg.
  window.location.hash = "";
  window.location.reload();
}

// --- Kopfzeile: Logo · Modus · Person. Sonst nichts. -------------------------------------

function kopfBauen() {
  const kopf = $("kopf");
  leeren(kopf);
  const s = z.sitzung || {};
  const seg = function (id, modus, lang, kurz, ikonName, route) {
    return h("button", { type: "button", id: id, "aria-pressed": "false", "aria-label": lang, onclick: function () { navigiere(route); } },
      ikon(ikonName, { groesse: 16 }), h("span", { class: "seg-lang", text: lang }), h("span", { class: "seg-kurz", "aria-hidden": "true", text: kurz }));
  };
  const segment = h("nav", { class: "modus-segment", id: "modus-segment", "aria-label": "Modus" },
    seg("modus-brauchen", "brauchen", "Kunden betreuen", "Betreuen", "telefon", "#/brauchen"),
    // Kurz „Wissen“, nicht „Aufladen“: In diesem Betrieb heißt Aufladen Auto oder Akku (Gegenprüfung 09.10.).
    seg("modus-abgeben", "abgeben", "Wissen aufladen", "Wissen", "idee", "#/abgeben"));
  const name = String(s.anzeigename || "");
  const avatar = h("button", {
    type: "button",
    class: "avatar-knopf",
    id: "nutzer-knopf",
    title: name + " · " + rolleName(s.rolle),
    "aria-label": name + ", " + rolleName(s.rolle) + " – Menü",
    "aria-haspopup": "true",
    "aria-expanded": "false",
    "aria-controls": "nutzer-menue",
    onclick: menueUmschalten,
  }, h("span", { class: "avatar-kuerzel", "aria-hidden": "true", text: initialen(name) || "?" }),
  h("span", { class: "avatar-zahl", id: "avatar-zahl", hidden: true }));
  const menue = h("div", { class: "menue", id: "nutzer-menue", hidden: true });
  kopf.appendChild(h("div", { class: "kopf-innen" },
    h("a", { class: "kopf-marke", id: "kopf-marke", href: "#/brauchen", "aria-label": "Kunden betreuen" }),
    segment,
    h("div", { class: "person" }, avatar, menue)));
  brandingAnwenden();
  menueNeu();
  kopf.hidden = false;
}

function menueNeu() {
  const menue = $("nutzer-menue");
  if (!menue) return;
  const r = rechte();
  const s = z.sitzung || {};
  leeren(menue);
  menue.appendChild(h("p", { class: "menue-kopf", text: String(s.anzeigename || "") + " · " + rolleName(s.rolle) }));
  if (r.freigabe) {
    menue.appendChild(h("button", { type: "button", class: "menue-eintrag", onclick: function () {
      menueZu();
      navigiere("#/freigaben");
    } }, ikon("freigabe", { groesse: 16 }), "Freigaben · " + z.freigabenOffen + " offen"));
  }
  if (r.einrichtung) {
    menue.appendChild(h("button", { type: "button", class: "menue-eintrag", onclick: function () {
      menueZu();
      navigiere("#/einrichtung");
    } }, ikon("einstellungen", { groesse: 16 }), "Einrichtung"));
  }
  menue.appendChild(h("button", { type: "button", class: "menue-eintrag", onclick: abmelden }, ikon("abmelden", { groesse: 16 }), "Abmelden"));
}

function menueUmschalten() {
  const menue = $("nutzer-menue");
  const knopf = $("nutzer-knopf");
  if (!menue) return;
  const auf = menue.hidden;
  menue.hidden = !auf;
  knopf.setAttribute("aria-expanded", auf ? "true" : "false");
  if (auf) {
    menueNeu();
    einblenden(menue, 0, { y: -6, blur: 0, dauer: 160 });
    naechsterFrame(function () {
      fokus(menue.querySelector("button"));
    });
  }
}

function menueZu() {
  const menue = $("nutzer-menue");
  if (menue && !menue.hidden) {
    menue.hidden = true;
    const k = $("nutzer-knopf");
    if (k) k.setAttribute("aria-expanded", "false");
  }
}

function kopfNeu() {
  if (!z.sitzung) return;
  const b = $("modus-brauchen");
  const a = $("modus-abgeben");
  const route = z.route ? z.route.pfad : "/brauchen";
  if (b) b.setAttribute("aria-pressed", route === "/brauchen" ? "true" : "false");
  if (a) a.setAttribute("aria-pressed", route !== "/brauchen" && route !== "/einrichtung" ? "true" : "false");
  document.body.setAttribute("data-modus", z.modus);
  menueNeu();
}

async function freigabenZaehlen() {
  if (!rechte().freigabe) {
    avatarZahlSetzen(0);
    return;
  }
  try {
    const r = await api.freigaben(true);
    const zahlen = (r && r.zahlen) || {};
    avatarZahlSetzen((Number(zahlen.beitraege_offen) || 0) + (Number(zahlen.codes_offen) || 0));
  } catch (e) {
    // Abzeichen ist Zusatz – ein alter Server ohne `freigabe` darf nichts kaputt machen.
    avatarZahlSetzen(0);
  }
}

function avatarZahlSetzen(n) {
  z.freigabenOffen = n;
  const el = $("avatar-zahl");
  if (el) {
    leeren(el);
    el.hidden = !n;
    if (n) {
      el.appendChild(h("span", { "aria-hidden": "true", text: String(n) }));
      el.appendChild(h("span", { class: "sr-only", text: ", " + n + (n === 1 ? " Freigabe offen" : " Freigaben offen") }));
    }
  }
  const menue = $("nutzer-menue");
  if (menue && !menue.hidden) menueNeu();
}

// --- Fall: welche Anlage steht links? ----------------------------------------------------------

/** Die Anlage, deren Akte links steht: Vorab-Steckbrief → Wahl → Sitzungsfall. */
function anzeigeId() {
  if (z.laeuft && z.fallVorab) return z.fallVorab;
  if (z.gewaehlt) return z.gewaehlt.anlage_id;
  if (z.fall) return z.fall.anlage_id;
  return null;
}

function anzeigeName() {
  const id = anzeigeId();
  if (z.akte && z.akteId === id && z.akte.anlage && z.akte.anlage.kunde_alias) return z.akte.anlage.kunde_alias;
  if (z.gewaehlt && z.gewaehlt.anlage_id === id && z.gewaehlt.kunde_alias) return z.gewaehlt.kunde_alias;
  if (z.fall && z.fall.anlage_id === id && z.fall.kunde_alias) return z.fall.kunde_alias;
  if (z.fallVorab === id && z.fallVorabName) return z.fallVorabName;
  const l = listeEintrag(id);
  return l ? l.kunde_alias : "";
}

function listeEintrag(id) {
  const l = Array.isArray(z.listeDaten) ? z.listeDaten : [];
  return l.filter(function (a) { return a.id === id; })[0] || null;
}

/**
 * Anlagenliste neu holen – nach einer Aktion oder einem Einsatz stimmt
 * „· 1 offen“ sonst nicht mehr. Die alte Liste bleibt stehen, bis die neue da ist.
 */
function listeNeu() {
  z.liste = null;
  listeLaden().then(function () { linksNeu(); }, function () {});
}

/** Die Anlagenliste (Fallsuche, Adressen) – einmal je Sitzung. */
function listeLaden() {
  if (!z.liste) {
    z.liste = api.akteListe().then(function (r) {
      z.listeDaten = Array.isArray(r.anlagen) ? r.anlagen : [];
      return z.listeDaten;
    }, function (e) {
      z.liste = null; // nächster Versuch darf es erneut probieren
      throw e;
    });
  }
  return z.liste;
}

/**
 * Laufenden Fall der Sitzung setzen (meta.fall, GET anmelden). Eine Wahl aus
 * der Fallsuche gilt nur bis dahin – dann zählt, was der Server sagt.
 */
function fallSetzen(f) {
  const neu = f && f.anlage_id ? { anlage_id: String(f.anlage_id), kunde_alias: f.kunde_alias ? String(f.kunde_alias) : "" } : null;
  z.fall = neu;
  z.gewaehlt = null;
  z.suchen = false;
  akteFolgen();
}

/** Akte links an die Anzeige-Anlage anpassen (laden, wenn sie wechselt). */
function akteFolgen() {
  const id = anzeigeId();
  if (id && id !== z.akteId) {
    akteLaden(id);
    return;
  }
  if (!id) {
    z.akteId = null;
    z.akte = null;
    z.akteFehler = null;
  }
  linksNeu();
  wichtigNeu();
  leerNeu();
}

/** Akte laden (bei Fallwechsel, nach Aktionen, nach ctx.geaendert). Kein Polling. */
async function akteLaden(anlageId, still) {
  const nr = ++z.akteNr;
  const neu = z.akteId !== anlageId;
  z.akteId = anlageId;
  z.akteFehler = null;
  if (neu) {
    z.akte = null;
    z.verlaufAlle = false;
    z.mehrAuf = false;
  }
  if (neu || !still) linksNeu(neu);
  listeLaden().then(function () {
    if (nr === z.akteNr) linksNeu();
  }, function () {});
  try {
    const a = await api.akte(anlageId);
    if (nr !== z.akteNr) return;
    z.akte = a;
    if (z.fall && z.fall.anlage_id === anlageId && a.anlage && a.anlage.kunde_alias && !z.fall.kunde_alias) z.fall.kunde_alias = a.anlage.kunde_alias;
  } catch (e) {
    if (nr !== z.akteNr) return;
    z.akte = null;
    z.akteFehler = e && e.message ? e.message : "Akte nicht geladen.";
  }
  linksNeu();
  wichtigNeu();
  leerNeu();
}

/** Adresse aus der Akte, sonst aus der Anlagenliste (ältere Server ohne Spalten). */
function adresseVon(anlage) {
  const a = anlage || {};
  const l = listeEintrag(a.id) || {};
  return {
    strasse: a.strasse || l.strasse || "",
    hausnummer: a.hausnummer || l.hausnummer || "",
    plz: a.plz || l.plz || "",
    ort: a.ort || l.ort || "",
  };
}

// --- Linke Zone: Akte oder Fallsuche -----------------------------------------------------------

function routeHatChat() {
  return !z.route || z.route.pfad === "/brauchen";
}

/**
 * Linke Zone neu: Kunden betreuen ohne Fall → Fallsuche; mit Fall → Akte;
 * Wissen aufladen → Akte, sobald ein Fall offen ist, sonst keine linke Zone;
 * Einrichtung → keine (14.3.4).
 */
function linksNeu(mitBewegung) {
  const zone = $("zone-links");
  const flaeche = $("ansicht-arbeit");
  if (!zone || !flaeche) return;
  const def = z.route ? ROUTEN[z.route.pfad] : null;
  const id = anzeigeId();
  let art = "aus";
  if (def && def.ohneAkte) art = "aus";
  else if ((z.suchen || !id) && routeHatChat()) art = "suche";
  else if (id && !z.suchen) art = "akte";
  else if (id && z.suchen && !routeHatChat()) art = "akte";
  flaeche.classList.toggle("ohne-links", art === "aus");
  zone.hidden = art === "aus";
  if (art === "suche") {
    if (z.linksArt !== "suche") {
      leeren(zone).appendChild(sucheBauen());
      if (mitBewegung) bewege(zone.firstChild, [{ opacity: 0, transform: "translateX(-12px)" }, { opacity: 1, transform: "none" }], 280);
    }
  } else if (art === "akte") {
    const vorher = zone.querySelector(".akte-mehr-wrap");
    const scroll = vorher ? vorher.scrollTop : 0;
    const neu = akteBauen();
    leeren(zone).appendChild(neu);
    const nachher = zone.querySelector(".akte-mehr-wrap");
    if (nachher && scroll && !mitBewegung) nachher.scrollTop = scroll;
    if (mitBewegung) bewege(neu, [{ opacity: 0, transform: "translateX(-12px)" }, { opacity: 1, transform: "none" }], 280);
  } else {
    leeren(zone);
  }
  z.linksArt = art;
}

/** „Wer ruft an?“ – Kunde, Adresse oder Anlagennummer; Treffer filtern im Browser. */
function sucheBauen() {
  const liste = h("ul", { class: "treffer", id: "fallsuche-treffer", "aria-label": "Treffer" });
  const meldung = h("p", { class: "sr-only", role: "status", "aria-live": "polite" });
  const feld = h("input", {
    type: "search",
    id: "fallsuche",
    class: "suchfeld-eingabe",
    // Kurz genug für 300 px (vorher abgeschnitten: „… Anlagennumm…“); „Straße“
    // ist am Telefon greifbarer als „Adresse“. Die Suche findet weiter alles.
    placeholder: "Name, Straße oder Nummer",
    "aria-label": "Kunde suchen: Name, Straße oder Anlagennummer",
    "aria-controls": "fallsuche-treffer",
    autocomplete: "off",
    spellcheck: "false",
    enterkeyhint: "search",
  });
  function filtern() {
    leeren(liste);
    const q = suchform(feld.value.trim());
    if (q.length < 2) {
      meldung.textContent = "";
      return;
    }
    const teile = q.split(/[\s,]+/).filter(Boolean);
    listeLaden().then(function (alle) {
      if (suchform(feld.value.trim()) !== q) return; // schon weitergetippt
      leeren(liste);
      const treffer = alle.filter(function (a) {
        const heu = suchform([a.kunde_alias, a.strasse, a.hausnummer, a.plz, a.ort, a.id].filter(Boolean).join(" "));
        return teile.every(function (t) { return heu.indexOf(t) !== -1; });
      }).slice(0, 6);
      treffer.forEach(function (a) {
        // „· 1 offen“: Bei zwei gleichen Namen ist der Anrufer meist die Familie mit offenem Ticket.
        const offen = Number(a.offene_tickets) || 0;
        liste.appendChild(h("li", null, h("button", {
          type: "button",
          class: "treffer-knopf",
          "data-anlage": a.id,
          // Während eine Antwort läuft, keine neue Kundenwahl – sonst gingen
          // Wahl und bezahlte Antwort verloren (Gegenprüfung 09.10.).
          disabled: z.laeuft,
          onclick: function () { fallWaehlen(a); },
        },
        h("strong", { text: a.kunde_alias || a.id }),
        h("span", { text: [[a.strasse, a.hausnummer].filter(Boolean).join(" "), a.ort].filter(Boolean).join(", ") + (offen ? " · " + offen + " offen" : "") }))));
      });
      if (!treffer.length) liste.appendChild(h("li", { class: "treffer-leer", text: "Nichts gefunden." }));
      meldung.textContent = treffer.length ? treffer.length + " Treffer" : "Nichts gefunden.";
    }, function () {
      leeren(liste).appendChild(h("li", { class: "treffer-leer", text: "Nicht geladen. Bitte gleich noch mal." }));
    });
  }
  feld.addEventListener("input", filtern);
  feld.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const erster = liste.querySelector(".treffer-knopf");
      if (erster) erster.click();
    } else if (e.key === "ArrowDown") {
      const erster = liste.querySelector(".treffer-knopf");
      if (erster) {
        e.preventDefault();
        fokus(erster);
      }
    }
  });
  liste.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const knoepfe = Array.prototype.slice.call(liste.querySelectorAll(".treffer-knopf"));
    const i = knoepfe.indexOf(document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    if (e.key === "ArrowDown" && knoepfe[i + 1]) fokus(knoepfe[i + 1]);
    if (e.key === "ArrowUp") fokus(knoepfe[i - 1] || feld);
  });
  // Liste schon laden, damit der erste Treffer nicht wartet.
  listeLaden().then(null, function () {});
  const zurueck = z.suchen && (z.fall || z.gewaehlt)
    ? h("button", { type: "button", class: "knopf-leise-e suche-zurueck", text: "Abbrechen", onclick: function () {
      z.suchen = false;
      linksNeu(true);
    } })
    : null;
  return h("section", { class: "suche", "aria-label": "Kunde finden" },
    h("h2", { class: "suche-titel", text: "Wer ruft an?" }),
    h("label", { class: "suchfeld" }, ikon("suche", { groesse: 20 }), feld),
    liste, meldung, zurueck);
}

/**
 * Der Server soll keinen alten Fall mehr im Kopf haben, wenn der Chat leer
 * aussieht: Sonst baut die nächste Frage auf bis zu sechs Runden des vorigen
 * Kunden auf (Gegenprüfung 09.10.). Wie „Nächster Kunde“: fall_beenden.
 */
async function serverFallVergessen() {
  if (!z.fall && !z.runden.length) return;
  await api.aktion("fall_beenden", {});
  z.fall = null;
}

/** Kunde aus der Fallsuche: Akte laden, Chat leer „Was ist los bei …?“, die nächste Frage geht mit anlage_id. */
async function fallWaehlen(a) {
  if (z.laeuft) return;
  const nr = ++z.wahlNr;
  try {
    await serverFallVergessen();
  } catch (err) {
    toast("Kunde nicht gewechselt: " + (err && err.message ? err.message : "unbekannter Fehler"), "fehler");
    return;
  }
  if (nr !== z.wahlNr) return;
  z.gewaehlt = { anlage_id: a.id, kunde_alias: a.kunde_alias || "" };
  z.suchen = false;
  z.kopfkarteAuf = false;
  chatLeeren();
  if (z.akteId === a.id && z.akte) linksNeu(true);
  else akteLaden(a.id);
  wichtigNeu();
  leerNeu();
  if (!routeHatChat()) navigiere("#/brauchen");
  naechsterFrame(function () {
    if (istZeigegeraet()) fokus($("frage-text"));
  });
}

/** „Keine davon“ (Auswahl): Fallsuche zeigen und hineinspringen. */
function fallSuchen() {
  z.suchen = true;
  if (!routeHatChat()) navigiere("#/brauchen");
  linksNeu(true);
  naechsterFrame(function () {
    const f = $("fallsuche");
    if (f) {
      fokus(f);
      try {
        f.scrollIntoView({ block: "nearest" });
      } catch (e) {
        // egal
      }
    }
  });
}

/**
 * Datum der Ticketzeile: immer das Erstelldatum – dasselbe wie in der
 * Quellenzeile („Ticket 19.09.“) und in „Kommt wieder: 3× in 34 Tagen“.
 * Vorher stand hier das Datum der Maßnahme, und „Ticket 19.09.“ war in der
 * Akte nicht zu finden (Gegenprüfung 09.10.).
 */
function ticketDatum(t) {
  return t.erstellt_am;
}

/**
 * Kurztext einer Ticketzeile (14.3.3): offen → Symptom, sonst letzte
 * Maßnahme. Passt er nicht in 36 Zeichen, steht der Kurzname des Fehlerbilds
 * da („Login geht nicht“) statt eines abgeschnittenen Satzfetzens – mit dem
 * kann am Telefon niemand einen Kunden wiedererkennen (Gegenprüfung 09.10.).
 */
function ticketKurz(t) {
  const massnahmen = Array.isArray(t.massnahmen) ? t.massnahmen : [];
  const letzte = massnahmen.length ? massnahmen[massnahmen.length - 1] : null;
  const offen = t.status !== "geschlossen";
  let text = String((offen || !letzte ? t.symptom : letzte.massnahme || letzte.text) || "").trim();
  if (text.length > 36) {
    const kurz = KATEGORIE_KURZ[t.symptom_kategorie];
    if (kurz) text = kurz;
    else {
      const schnitt = text.slice(0, 37);
      const leer = schnitt.lastIndexOf(" ");
      text = (leer > 12 ? schnitt.slice(0, leer) : text.slice(0, 36)).replace(/[\s,;:.–-]+$/, "") + "\u00A0…";
    }
  }
  text = text.charAt(0).toUpperCase() + text.slice(1);
  // „Ole Thiessen (Techniker)“ → „Thiessen“: Die Schreiberzeile trägt die Rolle in Klammern.
  const wer = !offen && letzte ? String(letzte.durchgefuehrt_von || letzte.von || "").replace(/\s*\([^)]*\)\s*$/, "").trim() : "";
  const nach = wer ? wer.split(/\s+/).pop() : "";
  return typo(text) + (nach ? " (" + nach + ")" : "");
}

function eigenschaft(ikonName, titel, wert) {
  return h("div", { class: "eigenschaft" },
    h("dt", null, ikon(ikonName, { groesse: 15 }), titel),
    h("dd", null, wert === null || wert === undefined || wert === "" ? h("span", { class: "leise", text: "–" }) : wert));
}

function teilKopf(titel, auf, ziel, onToggle) {
  const knopf = h("button", { type: "button", class: "akte-teil-kopf", "aria-expanded": auf ? "true" : "false", "aria-controls": ziel },
    h("span", { text: titel }), ikon("runter", { groesse: 16, klasse: "teil-pfeil" }));
  knopf.addEventListener("click", function () {
    const neu = knopf.getAttribute("aria-expanded") !== "true";
    knopf.setAttribute("aria-expanded", neu ? "true" : "false");
    onToggle(neu);
  });
  return knopf;
}

/**
 * Die Akte (14.3.3): Kunde, Adresse, Anlagennummer · Geräte · Verlauf ·
 * „Einsatz dokumentieren“ · „Neuer Fall“ · ganz unten eingeklappt „Mehr zur
 * Anlage“. Unter 1024 px ist dieselbe Karte die einklappbare Kopfkarte.
 */
function akteBauen() {
  const id = anzeigeId();
  const r = rechte();
  const box = h("section", { class: "akte" + (z.kopfkarteAuf ? " auf" : ""), id: "akte", "aria-label": "Akte" });
  const a = z.akte && z.akteId === id ? z.akte : null;
  const anlage = a && a.anlage ? a.anlage : { id: id, kunde_alias: anzeigeName() };
  const adr = adresseVon(anlage);
  const aufKnopf = h("button", {
    type: "button",
    class: "akte-auf-knopf rund",
    "aria-expanded": z.kopfkarteAuf ? "true" : "false",
    "aria-controls": "akte-mehr",
    "aria-label": z.kopfkarteAuf ? "Akte zuklappen" : "Akte aufklappen",
    onclick: function () { kopfkarteUmschalten(); },
  }, ikon("runter", { groesse: 18 }));
  const strasse = [adr.strasse, adr.hausnummer].filter(Boolean).join(" ");
  // „Nächster Kunde“ ist am Telefon die häufigste Handlung nach jedem
  // Gespräch – deshalb oben neben dem Namen, für jede Rolle an derselben
  // Stelle, am Handy in der Kopfkarte (Gegenprüfung 09.10.; vorher ein kleiner
  // grauer Textknopf „Neuer Fall“ ganz unten).
  const naechster = h("button", {
    type: "button",
    class: "knopf-e knopf-e-rand naechster-kunde",
    id: "fall-neu",
    disabled: z.laeuft,
    onclick: neuerFall,
  }, ikon("plus", { groesse: 16, strich: 2 }), h("span", { text: "Nächster Kunde" }));
  box.appendChild(h("div", { class: "akte-kopf" },
    h("div", { class: "akte-kopf-text" },
      h("h2", { class: "akte-name", text: anlage.kunde_alias || "Anlage " + (anlage.id || "") }),
      strasse || adr.ort
        ? h("p", { class: "akte-adresse" },
          strasse ? h("span", { class: "str", text: strasse }) : null,
          adr.ort ? h("span", { class: "ort" }, adr.plz ? h("span", { class: "plz", text: adr.plz + " " }) : null, adr.ort) : null)
        : null,
      h("p", { class: "akte-id mono", text: anlage.id || "" })),
    h("div", { class: "akte-kopf-knoepfe" }, naechster, aufKnopf)));

  const mehr = h("div", { class: "akte-mehr-wrap", id: "akte-mehr" });
  box.appendChild(mehr);
  if (z.akteFehler && z.akteId === id) {
    mehr.appendChild(h("div", { class: "akte-fehler" },
      h("p", { text: z.akteFehler }),
      h("button", { type: "button", class: "knopf-leise-e", text: "Noch mal laden", onclick: function () { akteLaden(id); } })));
    const unten = akteUnten(r, null);
    if (unten) mehr.appendChild(unten);
    return box;
  }
  if (!a) {
    mehr.appendChild(h("div", { class: "akte-skelett", "aria-label": "Akte wird geladen" },
      h("div", { class: "skelett skelett-zeile" }), h("div", { class: "skelett skelett-zeile" }), h("div", { class: "skelett skelett-block" })));
    return box;
  }
  const komponenten = Array.isArray(a.komponenten) ? a.komponenten : [];
  const tickets = (Array.isArray(a.tickets) ? a.tickets.slice() : []).sort(function (x, y) {
    return String(y.erstellt_am).localeCompare(String(x.erstellt_am));
  });

  // Geräte: nur Hauptgeräte, Modell und Seriennummer als title.
  const haupt = komponenten.filter(function (k) { return k && HAUPTGERAETE[k.typ]; });
  if (haupt.length) {
    mehr.appendChild(h("div", { class: "akte-teil" },
      h("h3", { class: "akte-teil-titel", text: "Geräte" }),
      h("ul", { class: "geraete" }, haupt.map(function (k) {
        const fremd = k.installiert_von && k.installiert_von !== "eigenes Team";
        return h("li", { class: "geraet", title: [k.modell, k.seriennummer].filter(Boolean).join(" · ") || null },
          h("span", { class: "geraet-ikon", "aria-hidden": "true" }, ikon(KOMPONENTEN_IKON[k.typ] || "werkzeug", { groesse: 20 })),
          h("span", { class: "geraet-text" },
            h("strong", { text: HAUPTGERAETE[k.typ] }),
            h("span", { text: (k.hersteller || "") + (fremd ? " · Fremdfirma" : "") })));
      }))));
  }

  // Verlauf: neueste drei Tickets, offen markiert.
  const sichtbar = z.verlaufAlle ? tickets : tickets.slice(0, 3);
  const verlaufListe = h("ul", { class: "verlauf-liste", id: "akte-verlauf", hidden: !z.verlaufAuf }, sichtbar.map(function (t) {
    const offen = t.status !== "geschlossen";
    return h("li", null, h("button", { type: "button", class: "verlauf-zeile", "data-quelle": t.id, title: "Ticket ansehen", onclick: function (e) {
      quelleOeffnen(t.id, e.currentTarget);
    } },
    h("span", { class: "verlauf-datum", text: datumKurz(ticketDatum(t)) }),
    h("span", { class: "verlauf-text", text: ticketKurz(t) }),
    offen ? h("span", { class: "verlauf-offen", text: "offen" }) : h("span")));
  }));
  if (!tickets.length) verlaufListe.appendChild(h("li", { class: "verlauf-leer", text: "Noch keine Tickets." }));
  const alle = tickets.length > 3
    ? h("button", { type: "button", class: "knopf-leise-e verlauf-alle", hidden: !z.verlaufAuf, text: z.verlaufAlle ? "Weniger" : "Alle " + tickets.length + " Tickets", onclick: function () {
      z.verlaufAlle = !z.verlaufAlle;
      linksNeu();
    } })
    : null;
  mehr.appendChild(h("section", { class: "akte-teil akte-verlauf" },
    teilKopf("Verlauf", z.verlaufAuf, "akte-verlauf", function (auf) {
      z.verlaufAuf = auf;
      verlaufListe.hidden = !auf;
      if (alle) alle.hidden = !auf;
    }),
    verlaufListe, alle));

  const unten = akteUnten(r, tickets);
  if (unten) mehr.appendChild(unten);
  mehr.appendChild(mehrZurAnlage(a, komponenten));
  return box;
}

function akteUnten(r, tickets) {
  const id = anzeigeId();
  const offenesTicket = (tickets || []).filter(function (t) { return t.status !== "geschlossen"; })[0];
  if (!r.einsatz) return null;
  return h("div", { class: "akte-unten" },
    h("button", { type: "button", class: "knopf-e knopf-e-rand", id: "akte-einsatz", onclick: function () {
      const param = { anlage: id };
      if (offenesTicket) param.ticket = offenesTicket.id;
      navigiere("#/abgeben/einsatz", param);
    } }, "Einsatz dokumentieren"));
}

/** „Mehr zur Anlage“: was ein Techniker braucht, der Anrufer nicht (eingeklappt). */
function mehrZurAnlage(a, komponenten) {
  const anlage = a.anlage || {};
  const wv = Array.isArray(a.wiedervorlagen) ? a.wiedervorlagen : [];
  const uebergaben = Array.isArray(a.uebergaben) ? a.uebergaben : [];
  const gruppen = (Array.isArray(a.gruppen) ? a.gruppen : []).filter(function (g) { return g && g.wiederholung && g.alarm; });
  const uebrige = komponenten.filter(function (k) { return k && !HAUPTGERAETE[k.typ]; });
  const garantie = komponenten.filter(function (k) { return k && k.garantie_bis; }).map(function (k) {
    return (KOMPONENTEN[k.typ] || k.typ) + " bis " + datum(k.garantie_bis);
  });
  const inhalt = h("div", { class: "mehr-anlage", id: "akte-mehr-anlage", hidden: !z.mehrAuf },
    h("dl", { class: "eigenschaften" },
      eigenschaft("kalender", "In Betrieb", datum(anlage.inbetriebnahme)),
      eigenschaft("team", "Montage", anlage.montage_team),
      eigenschaft("haus", "Standort", anlage.standort),
      eigenschaft("schild", "Garantie", garantie.length ? garantie.join(", ") : h("span", { class: "leise", text: "nicht hinterlegt" }))),
    anlage.notizen ? h("p", { class: "mehr-notiz", text: typo(anlage.notizen) }) : null,
    uebrige.length ? h("ul", { class: "akte-komponenten" }, uebrige.map(function (k) {
      const typ = KOMPONENTEN[k.typ] || k.typ || "Komponente";
      return h("li", { class: "akte-komponente" },
        h("span", { class: "komponente-symbol", "aria-hidden": "true" }, ikon(KOMPONENTEN_IKON[k.typ] || "werkzeug", { groesse: 16 })),
        h("div", { class: "komponente-text" },
          h("p", { class: "komponente-name" }, h("strong", { text: k.typ === "stromkreis" && k.bezeichnung ? typ + " " + k.bezeichnung : k.bezeichnung || typ })),
          attributMarken(k.attribute)));
    })) : null,
    wv.length ? h("div", { class: "mehr-block" }, h("h4", { class: "mehr-titel", text: "Wiedervorlagen" }),
      h("ul", { class: "akte-wv" }, wv.map(function (w) {
        const wann = w.erledigt ? "erledigt" : w.status === "ueberfaellig" ? "überfällig" : w.status === "heute" ? "heute" : typeof w.faellig_in_tagen === "number" ? "in " + w.faellig_in_tagen + "\u00A0Tagen" : "";
        return h("li", { class: "akte-wv-eintrag" + (w.status === "ueberfaellig" && !w.erledigt ? " ist-ueberfaellig" : "") },
          h("p", { class: "akte-wv-kopf" }, h("strong", { text: datum(w.faellig_am) }), wann ? h("span", { class: "pille pille-" + (w.status === "ueberfaellig" ? "stopp" : "neutral"), text: wann }) : null),
          h("p", { class: "akte-wv-text", text: typo(w.pruefpunkt || "") }));
      }))) : null,
    uebergaben.length ? h("div", { class: "mehr-block" }, h("h4", { class: "mehr-titel", text: "Übergaben" }),
      h("ul", { class: "akte-uebergaben" }, uebergaben.map(function (u) {
        const p = u.paket || {};
        return h("li", { class: "akte-wv-eintrag" },
          h("p", { class: "akte-wv-kopf" }, h("strong", { text: "An Level " + u.an_level }), h("span", { class: "leise", text: datum(u.erstellt_am) })),
          p.summary ? h("p", { class: "akte-wv-text", text: typo(p.summary) }) : null);
      }))) : null,
    gruppen.map(function (g) {
      return h("div", { class: "mehr-block mehr-wiederholung", id: "akte-wiederholung" },
        renderBlock(g.alarm, { rolle: z.sitzung ? z.sitzung.rolle : null, pfad: "akte", einblenden: false }));
    }));
  return h("section", { class: "akte-teil akte-mehr-anlage" },
    teilKopf("Mehr zur Anlage", z.mehrAuf, "akte-mehr-anlage", function (auf) {
      z.mehrAuf = auf;
      inhalt.hidden = !auf;
    }), inhalt);
}

/** < 1024: Kopfkarte auf/zu – Höhe per WAAPI (px → px), nie per transition. */
function kopfkarteUmschalten(auf) {
  const box = $("akte");
  const neu = typeof auf === "boolean" ? auf : !z.kopfkarteAuf;
  z.kopfkarteAuf = neu;
  if (!box) return Promise.resolve();
  const knopf = box.querySelector(".akte-auf-knopf");
  return hoeheMorphen(box, function () {
    box.classList.toggle("auf", neu);
    if (knopf) {
      knopf.setAttribute("aria-expanded", neu ? "true" : "false");
      knopf.setAttribute("aria-label", neu ? "Akte zuklappen" : "Akte aufklappen");
    }
  }, 280);
}

/** Einen Teil der Akte zeigen (Wichtig-Chip): aufklappen, hinscrollen, kurz aufleuchten. */
function akteTeilZeigen(teil) {
  const weiter = function () {
    if (teil === "verlauf") z.verlaufAuf = true;
    if (teil === "mehr") z.mehrAuf = true;
    linksNeu();
    nachDemZeichnen(function () {
      const ziel = teil === "verlauf" ? document.querySelector(".akte-verlauf") : document.querySelector(".akte-mehr-anlage");
      if (!ziel) return;
      try {
        ziel.scrollIntoView({ block: "nearest", behavior: ruhig() ? "auto" : "smooth" });
      } catch (e) {
        ziel.scrollIntoView();
      }
      aufleuchten(ziel, markeRgba(0.22));
    });
  };
  if (schmal() && !z.kopfkarteAuf) {
    z.kopfkarteAuf = true;
    linksNeu();
  }
  weiter();
}

// --- Wichtig ------------------------------------------------------------------------------------

/** Stopp-Blöcke einer Runde (Vorab und Antwort). */
function stoppsVon(r) {
  const liste = [];
  const sammle = function (bloecke) {
    (bloecke || []).forEach(function (b) {
      if (b && b.type === "warning" && b.level === "stop") liste.push(b);
    });
  };
  sammle(r.vorab);
  if (r.antwort) sammle(r.antwort.blocks);
  return liste;
}

/**
 * „Wichtig“ (14.3.3): nur, wenn es etwas gibt. Stopp aus einer FRÜHEREN
 * Antwort dieses Falls (in der Antwort mit der Stopp-Karte selbst nicht – sonst
 * stünde er doppelt da), „Kommt wieder: 3× in 34 Tagen“ (jüngste Gruppe mit
 * Wiederholung aus GET akte), „Wiedervorlage überfällig“.
 */
function wichtigEintraege() {
  const eintraege = [];
  const fallId = anzeigeId();
  const neueste = z.runden[z.runden.length - 1] || null;
  if (neueste && fallId) {
    const jetzt = stoppsVon(neueste).map(function (b) { return b.rule_id || b.title; });
    const gesehen = {};
    for (let i = z.runden.length - 2; i >= 0; i--) {
      const r = z.runden[i];
      if (r.fallId !== fallId) continue;
      stoppsVon(r).forEach(function (b) {
        const schluessel = b.rule_id || b.title;
        if (gesehen[schluessel] || jetzt.indexOf(schluessel) !== -1) return;
        gesehen[schluessel] = true;
        eintraege.push({ art: "stopp", text: "Stopp: " + typo(b.title || ""), runde: r, schluessel: schluessel });
      });
    }
  }
  const a = z.akte && z.akteId === fallId ? z.akte : null;
  const regelChips = [];
  if (fallId) {
    // Regel-Hinweise, die im Chat ausgeblendet wurden (WICHTIG_REGELN), einmal je Fall.
    const gesehen = {};
    z.runden.forEach(function (r) {
      if (r.fallId !== fallId || !Array.isArray(r.versteckteRegeln)) return;
      r.versteckteRegeln.forEach(function (b) {
        const id = String(b.rule_id || "");
        if (!WICHTIG_REGELN[id] || gesehen[id]) return;
        gesehen[id] = true;
        regelChips.push({ art: "regel", text: WICHTIG_REGELN[id], block: b });
      });
    });
  }
  if (a) {
    const gruppen = (Array.isArray(a.gruppen) ? a.gruppen : []).filter(function (g) { return g && g.wiederholung; });
    if (gruppen.length) {
      const juengste = gruppen.slice().sort(function (x, y) {
        return String(letztesDatum(y, a)).localeCompare(String(letztesDatum(x, a)));
      })[0];
      const n = Array.isArray(juengste.ticket_ids) ? juengste.ticket_ids.length : 0;
      if (n && typeof juengste.window_days === "number") {
        eintraege.push({ art: "wiederholung", text: "Kommt wieder: " + n + "× in " + juengste.window_days + "\u00A0Tagen" });
      }
    }
    regelChips.forEach(function (e) { eintraege.push(e); });
    const wv = Array.isArray(a.wiedervorlagen) ? a.wiedervorlagen : [];
    if (wv.some(function (w) { return w && w.status === "ueberfaellig" && !w.erledigt; })) {
      eintraege.push({ art: "wiedervorlage", text: "Wiedervorlage überfällig" });
    }
  } else {
    regelChips.forEach(function (e) { eintraege.push(e); });
  }
  return eintraege;
}

/**
 * Welche Regel-Hinweise in Runde r NICHT als Karte erscheinen (für
 * bloecke.js, ctx.ausblendenRegeln): solche aus WICHTIG_REGELN, wenn die
 * Wiederholung bekannt ist (dann stehen sie in „Wichtig“), und jeder, der in
 * diesem Fall schon einmal im Chat stand – dieselbe Regel höchstens einmal je
 * Fall (Gegenprüfung 09.10.: R09 stand sonst bei „Ticket kann zu“ noch einmal da).
 */
function ausblendenFuer(r, bloecke) {
  const fallId = r.fallId;
  const aus = [];
  if (!fallId) return aus;
  const alle = (r.vorab || []).concat(bloecke || []);
  const a = z.akte && z.akteId === fallId ? z.akte : null;
  const wiederholung = alle.some(function (b) { return b && b.type === "recurrence_alert"; }) ||
    !!(a && Array.isArray(a.gruppen) && a.gruppen.some(function (g) { return g && g.wiederholung; }));
  if (wiederholung) Object.keys(WICHTIG_REGELN).forEach(function (id) { aus.push(id); });
  z.runden.forEach(function (x) {
    if (x === r || x.fallId !== fallId) return;
    (x.vorab || []).concat(x.antwort && Array.isArray(x.antwort.blocks) ? x.antwort.blocks : []).forEach(function (b) {
      if (b && b.type === "warning" && b.level !== "stop" && b.rule_id && aus.indexOf(String(b.rule_id)) === -1) aus.push(String(b.rule_id));
    });
  });
  return aus;
}

/** Ausgeblendete Regel-Hinweise einer Runde merken (für den Chip in „Wichtig“). */
function versteckteMerken(r, bloecke, aus) {
  const liste = r.versteckteRegeln || [];
  (bloecke || []).forEach(function (b) {
    if (!b || b.type !== "warning" || b.level === "stop" || !b.rule_id || aus.indexOf(String(b.rule_id)) === -1) return;
    if (!liste.some(function (x) { return x.rule_id === b.rule_id; })) liste.push(b);
  });
  r.versteckteRegeln = liste;
}

/** Klick auf einen Regel-Chip: der bisherige „Mehr“-Inhalt im Blatt. */
function regelBlattOeffnen(e, ausloeser) {
  const b = e.block || {};
  const blatt = blattOeffnen(e.text, ausloeser);
  const k = blatt.koerper;
  k.appendChild(h("p", { class: "regel-blatt-titel" }, ikon("achtung", { groesse: 18, strich: 2 }), h("strong", { text: typo(b.title || e.text) })));
  String(b.content || "").split(/\n\s*\n/).forEach(function (t) {
    if (t.trim()) k.appendChild(h("p", { text: typo(t.trim()) }));
  });
  if (b.alternative) k.appendChild(h("p", { text: "Stattdessen: " + typo(b.alternative) }));
  const regel = ["Regel " + b.rule_id, b.entwurf ? "Entwurf, fachlich noch nicht freigegeben" : null].filter(Boolean).join(" · ");
  k.appendChild(h("p", { class: "mehr-regel", text: regel }));
}

function letztesDatum(g, a) {
  const tickets = Array.isArray(a.tickets) ? a.tickets : [];
  let max = "";
  tickets.forEach(function (t) {
    if ((g.ticket_ids || []).indexOf(t.id) !== -1 && String(t.erstellt_am) > max) max = String(t.erstellt_am);
  });
  return max;
}

const WICHTIG_IKON = { stopp: "stopp", wiederholung: "wiederholung", wiedervorlage: "kalender", regel: "achtung" };

function wichtigNeu() {
  const leiste = $("wichtig");
  if (!leiste) return;
  const eintraege = routeHatChat() ? wichtigEintraege() : [];
  const alt = Array.prototype.map.call(leiste.querySelectorAll(".wichtig-chip"), function (c) { return c.getAttribute("data-art") + c.textContent; });
  leeren(leiste);
  leiste.hidden = !eintraege.length;
  if (!eintraege.length) return;
  leiste.appendChild(h("span", { class: "wichtig-marke", text: "Wichtig" }));
  const zeigen = z.wichtigAlle ? eintraege : eintraege.slice(0, 2);
  zeigen.forEach(function (e) {
    const chip = h("button", { type: "button", class: "wichtig-chip wc-" + e.art, "data-art": e.art, onclick: function () { wichtigGeklickt(e, chip); } },
      ikon(WICHTIG_IKON[e.art] || "info", { groesse: 16, strich: 2 }), h("span", { text: e.text }));
    leiste.appendChild(chip);
    if (alt.indexOf(e.art + e.text) === -1) einblenden(chip, 0, { y: 4, blur: 0, dauer: 240 });
  });
  if (eintraege.length > zeigen.length) {
    leiste.appendChild(h("button", { type: "button", class: "wichtig-chip wc-mehr", "aria-label": "+" + (eintraege.length - zeigen.length) + " weitere zeigen", text: "+" + (eintraege.length - zeigen.length), onclick: function () {
      z.wichtigAlle = true;
      wichtigNeu();
    } }));
  }
}

function wichtigGeklickt(e, chip) {
  if (e.art === "regel") {
    regelBlattOeffnen(e, chip);
    return;
  }
  if (e.art === "stopp") {
    const el = e.runde && e.runde.el ? e.runde.el.querySelector(".w-stopp") : null;
    if (!el) return;
    try {
      el.scrollIntoView({ block: "center", behavior: ruhig() ? "auto" : "smooth" });
    } catch (x) {
      el.scrollIntoView();
    }
    aufleuchten(el, "rgba(180,35,24,.28)");
    return;
  }
  akteTeilZeigen(e.art === "wiederholung" ? "verlauf" : "mehr");
}

// --- Rechte Zone: Chat ----------------------------------------------------------------------

function arbeitBauen() {
  const ziel = $("ansicht-arbeit");
  leeren(ziel);
  const links = h("aside", { class: "links", id: "zone-links", "aria-label": "Kunde" });
  const leer = h("div", { class: "leer-chat", id: "chat-leer" });
  const feld = h("textarea", {
    class: "eingabe-text",
    id: "frage-text",
    rows: "1",
    maxlength: "1500",
    enterkeyhint: "send",
    placeholder: "Frage stellen …",
    "aria-label": "Frage",
  });
  const mikro = h("button", { type: "button", class: "rund mikro", title: "Diktieren: am Mac zweimal Fn", "aria-label": "Diktieren: am Mac zweimal Fn", onclick: function () { fokus(feld); } },
    ikon("mikrofon", { groesse: 20 }));
  const senden = h("button", { type: "submit", class: "rund senden", id: "frage-senden", "aria-label": "Senden" }, ikon("senden", { groesse: 20, strich: 2.2 }));
  const form = h("form", { class: "eingabe", id: "eingabe", novalidate: true },
    h("div", { class: "eingabe-feld" }, feld, mikro, senden));
  const betreuen = h("section", { class: "rechts-chat", id: "rechts-chat", "aria-label": "Chat" },
    h("div", { class: "wichtig", id: "wichtig", role: "region", "aria-label": "Wichtig", hidden: true }),
    h("div", { class: "verlauf-chat", id: "verlauf" }, h("div", { class: "verlauf-innen", id: "chat-innen" }, leer)),
    form);
  const bildschirm = h("section", { class: "rechts-bildschirm", id: "rechts-bildschirm", hidden: true });
  ziel.appendChild(links);
  ziel.appendChild(h("div", { class: "rechts", id: "zone-rechts" }, betreuen, bildschirm));

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (sende(feld.value)) {
      feld.value = "";
      hoeheAnpassen();
    }
  });
  feld.addEventListener("keydown", function (e) {
    // isComposing/229: Bei Eingabehilfen bestätigt Enter die Komposition.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      if (sende(feld.value)) {
        feld.value = "";
        hoeheAnpassen();
      }
    }
  });
  feld.addEventListener("input", hoeheAnpassen);
  // Überfahren einer Quelle ↔ zitierende Aussagen (Entwurf B) – im Chat.
  ziel.addEventListener("mouseover", leuchtenUeber);
  ziel.addEventListener("mouseout", leuchtenWeg);
  leerNeu();
}

function hoeheAnpassen() {
  const feld = $("frage-text");
  if (!feld) return;
  feld.style.setProperty("height", "auto");
  const max = Math.round(window.innerHeight * 0.3);
  feld.style.setProperty("height", Math.min(feld.scrollHeight + 2, max) + "px");
}

/** Leerer Chat: „Wie kann ich helfen?“ + drei Vorschläge – oder „Was ist los bei …?“ (14.3.3). */
function leerNeu() {
  const leer = $("chat-leer");
  if (!leer) return;
  leeren(leer);
  leer.hidden = z.runden.length > 0;
  if (leer.hidden) return;
  const id = anzeigeId();
  if (id) {
    const name = anzeigeName();
    leer.appendChild(h("h1", { class: "leer-titel", id: "chat-leer-titel", tabindex: "-1", text: name ? "Was ist los bei " + name + "?" : "Was ist los?" }));
    return;
  }
  const rolle = z.sitzung ? z.sitzung.rolle : "kundenbetreuer";
  const vorschlaege = (ROLLEN_RANG[rolle] || 1) >= 2 ? VORSCHLAEGE.technik : VORSCHLAEGE.kundenbetreuer;
  leer.appendChild(h("h1", { class: "leer-titel", id: "chat-leer-titel", tabindex: "-1", text: "Wie kann ich helfen?" }));
  leer.appendChild(h("div", { class: "vorschlaege" }, vorschlaege.map(function (v) {
    return h("button", { type: "button", class: "vorschlag", title: v[1], onclick: function () {
      const feld = $("frage-text");
      feld.value = v[1];
      hoeheAnpassen();
      fokus(feld);
    } }, v[0]);
  })));
}

function chatLeeren() {
  z.runden.forEach(function (r) {
    if (r.el && r.el.parentNode) r.el.parentNode.removeChild(r.el);
  });
  z.runden = [];
  z.wichtigAlle = false;
  leerNeu();
  wichtigNeu();
}

async function neuerFall() {
  if (z.laeuft) return;
  z.wahlNr += 1;
  const knopf = $("fall-neu");
  if (knopf) knopf.disabled = true;
  try {
    if (z.fall) await api.aktion("fall_beenden", {});
    chatLeeren();
    z.kopfkarteAuf = false;
    fallSetzen(null);
    const v = $("verlauf");
    if (v) v.scrollTop = 0;
    naechsterFrame(function () {
      const f = $("fallsuche");
      if (istZeigegeraet() && f) fokus(f);
    });
  } catch (err) {
    toast("Neuer Fall nicht möglich: " + (err && err.message ? err.message : "unbekannter Fehler"), "fehler");
    if (knopf) knopf.disabled = false;
  }
}

function setzeLaeuft(an) {
  z.laeuft = an;
  const knopf = $("frage-senden");
  if (knopf) knopf.disabled = an;
  const form = $("eingabe");
  if (form) form.setAttribute("aria-busy", an ? "true" : "false");
  const neu = $("fall-neu");
  if (neu) neu.disabled = an;
  // Keine Kundenwahl, solange eine Antwort läuft (Gegenprüfung 09.10.).
  Array.prototype.forEach.call(document.querySelectorAll("#fallsuche-treffer .treffer-knopf"), function (k) { k.disabled = an; });
}

/**
 * Offene Fragebäume sind überholt, sobald der Nutzer selbst schreibt (14.3.6) –
 * nur der jüngste ist bedienbar. Einer, der gerade selbst „fertig“ gesendet
 * hat (.ist-gesendet), blendet sich selbst aus.
 */
function ueberholteBaeumeEntfernen() {
  Array.prototype.forEach.call(document.querySelectorAll("#chat-innen .baum:not(.ist-gesendet)"), function (b) {
    if (b.parentNode) b.parentNode.removeChild(b);
  });
}

/**
 * Frage absenden. false, wenn gerade eine Antwort läuft oder der Text leer
 * ist (Doppel-Senden, auch über Fragebaum und Auswahl). Sonst true; der
 * Ablauf läuft asynchron weiter – die Anfrage startet sofort.
 */
function sende(text) {
  const t = String(text || "").trim();
  if (!t || z.laeuft || !z.sitzung) return false;
  if (z.blatt) z.blatt.schliessen(true);
  ueberholteBaeumeEntfernen();
  z.fallVorab = null;
  z.suchen = false;
  setzeLaeuft(true);
  runde(t).then(null, function (e) {
    console.error("Unerwarteter Fehler im Ablauf:", e);
  }).then(function () {
    setzeLaeuft(false);
    // Vorab-Anlage gilt nur während der Runde; danach zählt meta.fall.
    if (z.fallVorab) {
      z.fallVorab = null;
      akteFolgen();
    }
    wichtigNeu();
  });
  return true;
}

function verlaufScrollen(y) {
  const v = $("verlauf");
  if (!v) return;
  const ziel = Math.max(0, Math.round(y));
  if (Math.abs(v.scrollTop - ziel) < 4) return;
  try {
    v.scrollTo({ top: ziel, behavior: document.hidden || ruhig() ? "auto" : "smooth" });
  } catch (e) {
    v.scrollTop = ziel;
  }
}

function zumAnfang(knoten) {
  nachDemZeichnen(function () {
    const v = $("verlauf");
    if (!knoten.isConnected || !v) return;
    const oben = v.getBoundingClientRect().top;
    verlaufScrollen(knoten.getBoundingClientRect().top - oben + v.scrollTop - 12);
  });
}

function insSichtfeld(knoten) {
  nachDemZeichnen(function () {
    const v = $("verlauf");
    if (!knoten.isConnected || !v) return;
    const r = knoten.getBoundingClientRect();
    const vr = v.getBoundingClientRect();
    if (r.top >= vr.top && r.bottom <= vr.bottom) return;
    const passt = r.height <= vr.height - 24;
    verlaufScrollen(v.scrollTop + (passt ? r.bottom - vr.bottom + 16 : r.top - vr.top - 12));
  });
}

/** Obersten sichtbaren Block merken, um ihn nach dem Austausch an derselben Stelle zu halten. */
function ankerMerken(container) {
  const v = $("verlauf");
  const oben = v.getBoundingClientRect().top;
  const bloecke = container.querySelectorAll("[data-block]");
  for (let i = 0; i < bloecke.length; i++) {
    if (bloecke[i].hidden) continue;
    const r = bloecke[i].getBoundingClientRect();
    if (r.bottom <= oben + 8) continue;
    const typ = bloecke[i].getAttribute("data-block");
    let n = 0;
    for (let j = 0; j < i; j++) if (bloecke[j].getAttribute("data-block") === typ) n++;
    return { typ: typ, n: n, top: r.top };
  }
  return null;
}

function ankerHalten(container, anker) {
  const gleiche = Array.prototype.filter.call(container.querySelectorAll("[data-block]"), function (b) {
    return b.getAttribute("data-block") === anker.typ;
  });
  const neu = gleiche[anker.n];
  if (neu) $("verlauf").scrollTop += neu.getBoundingClientRect().top - anker.top;
}

function antwortCtx(r, bloecke) {
  const aus = ausblendenFuer(r, bloecke);
  versteckteMerken(r, bloecke, aus);
  return {
    rolle: z.sitzung ? z.sitzung.rolle : null,
    pfad: r && r.meta && r.meta.pfad ? r.meta.pfad : "modell",
    akteDaneben: true,
    rueckfrageTasten: true,
    ausblendenRegeln: aus,
    offeneTickets: function (id) {
      const l = listeEintrag(id);
      return l && typeof l.offene_tickets === "number" ? l.offene_tickets : null;
    },
    onAktion: function (item) {
      return api.aktion(item.action, item.payload || {}).then(function (ergebnis) {
        // Nach jeder erfolgreichen Aktion die Akte neu (SPEC 12.6) – kein
        // Polling –, dazu die Anlagenliste („· 1 offen“ in Suche und Auswahl).
        if (z.akteId) akteLaden(z.akteId, true);
        listeNeu();
        return ergebnis && ergebnis.bestaetigung ? ergebnis.bestaetigung : null;
      });
    },
    onAntworten: function (text) {
      return sende(text);
    },
    ladeBild: api.ladeBild,
    ladeSeitenbild: api.ladeSeitenbild,
    oeffneAkte: function (id, abschnitt, vorschau) {
      if (vorschau) {
        // Auswahl: Akte sofort zeigen (nur lesen); maßgeblich bleibt meta.fall der Folgeantwort.
        const o = String(id);
        const eintrag = listeEintrag(o);
        z.gewaehlt = { anlage_id: o, kunde_alias: eintrag ? eintrag.kunde_alias : "" };
        z.suchen = false;
        // Die Auswahl-Runde gehört ab jetzt zum gewählten Fall – ihr Stopp
        // erscheint so in „Wichtig“ (Gegenprüfung 09.10.).
        if (r) r.fallId = o;
        akteFolgen();
        return;
      }
      if (abschnitt) akteTeilZeigen(abschnitt === "wiederholung" ? "verlauf" : "mehr");
    },
    oeffneQuelle: function (id) {
      quelleOeffnen(id, document.activeElement, r);
    },
    oeffneWoher: function (knopf) {
      woherOeffnen(r, knopf);
    },
    oeffneBild: function (bild, knopf) {
      bildOeffnen(bild, knopf, r);
    },
    fallSuchen: fallSuchen,
    toast: toast,
  };
}

/** Eine Runde: Frage → (Vorab) → Antwort oder Fehler. */
async function runde(text) {
  const innen = $("chat-innen");
  const r = {
    id: "runde-" + (Date.now().toString(36)),
    frage: text,
    start: Date.now(),
    schritte: [],
    vorab: null,
    meta: null,
    antwort: null,
    fertig: false,
    fehler: null,
    fallId: anzeigeId(),
    wahlNr: z.wahlNr,
    versteckteRegeln: [],
  };
  // anlage_id (14.2.7): eine Wahl aus Fallsuche/Auswahl, die die Sitzung noch nicht kennt.
  const mit = {};
  if (z.gewaehlt && (!z.fall || z.fall.anlage_id !== z.gewaehlt.anlage_id)) mit.anlage_id = z.gewaehlt.anlage_id;

  const blase = h("div", { class: "blase", "data-eigen": "1" }, h("span", { class: "sr-only", text: "Deine Frage: " }), h("p", { class: "blase-text", text: text }));
  const vorabEl = h("div", { class: "vorab", hidden: true });
  const schaut = h("div", { class: "schaut", role: "status" },
    h("span", { class: "kreisel-e", "aria-hidden": "true" }),
    h("span", { class: "schimmer", text: "Ich schaue nach …" }));
  const fehlerEl = h("div", { class: "fehlerbox", role: "alert", hidden: true });
  const antwortEl = h("div", { class: "runde-antwort", "aria-busy": "true", "aria-label": "Antwort" }, vorabEl, schaut, fehlerEl);
  const rundeEl = h("div", { class: "runde", id: r.id }, blase, antwortEl);
  r.el = rundeEl;
  r.antwortEl = antwortEl;
  r.blase = blase;
  z.runden.push(r);
  innen.appendChild(rundeEl);
  leerNeu();
  einblenden(blase, 0, { y: 8, blur: 0, dauer: 240 });
  insSichtfeld(rundeEl);
  wichtigNeu();

  const lange = window.setTimeout(function () {
    const s = schaut.querySelector(".schimmer");
    if (s) s.textContent = "Dauert noch einen Moment …";
  }, 10000);

  let vorabTypen = [];
  // Hat der Nutzer während der Wartezeit selbst gescrollt, bleibt sein Ausschnitt stehen.
  let nutzerScrollt = false;
  const verlauf = $("verlauf");
  const merke = function () {
    nutzerScrollt = true;
  };
  verlauf.addEventListener("wheel", merke, { passive: true });
  verlauf.addEventListener("touchmove", merke, { passive: true });

  await api.frage(text, function (ev) {
    if (ev.t === "fortschritt") {
      if (ev.text) r.schritte.push(String(ev.text));
    } else if (ev.t === "vorab") {
      const bloecke = Array.isArray(ev.blocks) ? ev.blocks : [];
      r.vorab = bloecke;
      vorabTypen = bloecke.map(function (b) { return b && b.type; });
      bloecke.forEach(function (b) {
        if (b && b.type === "system_card" && b.anlage_id && b.anlage_id !== anzeigeId()) r.fallId = String(b.anlage_id);
      });
      leeren(vorabEl).appendChild(renderAntwort({ blocks: bloecke }, Object.assign(antwortCtx(r, bloecke), { pfad: "vorab" })));
      vorabEl.hidden = false;
      bloecke.forEach(function (b) {
        // Die Akte schon mit dem Steckbrief laden (1–2 s), nicht erst mit der
        // Modellantwort – der Fall steht damit sofort links.
        if (b && b.type === "system_card" && b.anlage_id && b.anlage_id !== anzeigeId()) {
          z.fallVorab = String(b.anlage_id);
          z.fallVorabName = b.anlage && b.anlage.kunde_alias ? String(b.anlage.kunde_alias) : "";
          r.fallId = z.fallVorab;
          akteFolgen();
        }
      });
      wichtigNeu();
    } else if (ev.t === "antwort") {
      r.antwort = ev.antwort || {};
      r.meta = ev.meta || {};
      r.fertig = true;
      // Kam seit dem Absenden eine neue Kundenwahl (Fallsuche, Auswahl), gehört
      // diese Antwort nicht mehr zum Fall links – sie darf ihn nicht überschreiben.
      const ueberholt = r.wahlNr !== z.wahlNr;
      if (!ueberholt && r.meta && r.meta.fall && r.meta.fall.anlage_id) r.fallId = String(r.meta.fall.anlage_id);
      const anker = nutzerScrollt ? ankerMerken(antwortEl) : null;
      const neueBloecke = Array.isArray(r.antwort.blocks) ? r.antwort.blocks : [];
      const inhalt = renderAntwort(r.antwort, Object.assign(antwortCtx(r, neueBloecke), { einblenden: false }));
      // Bringt diese Antwort Lösungen, klappen die Lösungen früherer Antworten
      // desselben Falls zu – „Lösungen von vorhin (3)“ (Gegenprüfung 09.10.).
      if (neueBloecke.some(function (b) { return b && b.type === "causes" && Array.isArray(b.items) && b.items.length; })) {
        z.runden.forEach(function (x) {
          if (x !== r && x.fallId === r.fallId && x.el) loesungenEinklappen(x.el);
        });
      }
      const tauschen = function () {
        Array.prototype.slice.call(antwortEl.childNodes).forEach(function (k) {
          if (k !== fehlerEl) antwortEl.removeChild(k);
        });
        antwortEl.insertBefore(inhalt, fehlerEl);
        antwortEl.removeAttribute("aria-busy");
        // Was schon als Vorab dastand, blendet nicht noch einmal ein; neue Karten gestaffelt.
        const schonDa = vorabTypen.slice();
        let stufe = 0;
        Array.prototype.forEach.call(inhalt.children, function (k) {
          if (k.hidden) return;
          const typ = k.getAttribute("data-block");
          const i = typ ? schonDa.indexOf(typ) : -1;
          if (i !== -1) {
            schonDa.splice(i, 1);
            return;
          }
          einblenden(k, stufe);
          stufe += 1;
        });
        if (anker) ankerHalten(antwortEl, anker);
        else if (!nutzerScrollt) zumAnfang(rundeEl);
      };
      if (vorabTypen.length && !ruhig()) {
        animiereUndWarte(vorabEl, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: EASE }).then(tauschen);
      } else {
        tauschen();
      }
      belegUnterstreichen(blase, r.antwort);
      if (!ueberholt && r.meta && Object.prototype.hasOwnProperty.call(r.meta, "fall")) {
        z.fallVorab = null;
        fallSetzen(r.meta.fall);
      }
    } else if (ev.t === "fehler") {
      r.fehler = ev;
      // Der Server merkt sich die Anlage auch im Fehlerfall (orchestrator
      // anlageMerken) – ohne meta.fall. Stand ein neuer Steckbrief im Vorab,
      // ist das jetzt der laufende Fall.
      if (z.fallVorab && (!z.fall || z.fall.anlage_id !== z.fallVorab)) {
        const f = { anlage_id: z.fallVorab, kunde_alias: z.fallVorabName || "" };
        z.fallVorab = null;
        fallSetzen(f);
      }
      if (schaut.parentNode) schaut.parentNode.removeChild(schaut);
      antwortEl.removeAttribute("aria-busy");
      zeigeFehler(fehlerEl, ev, text);
      insSichtfeld(fehlerEl);
    }
  }, mit);
  window.clearTimeout(lange);
  if (schaut.parentNode && !r.fertig && !r.fehler) schaut.parentNode.removeChild(schaut);
  verlauf.removeEventListener("wheel", merke);
  verlauf.removeEventListener("touchmove", merke);
}

/**
 * Stopp-Beleg in der eigenen Frage wellig unterstreichen (Entwurf B). Nur
 * Belege aus der Frage – Daten-Trigger („A-1042: …“) stehen nicht im Text.
 */
function belegUnterstreichen(blase, antwort) {
  const textEl = blase.querySelector(".blase-text");
  if (!textEl || !antwort || !Array.isArray(antwort.blocks)) return;
  const beleg = antwort.blocks.filter(function (b) {
    return b && b.type === "warning" && b.level === "stop" && b.beleg && !/^A-\d{4}: /.test(String(b.beleg));
  }).map(function (b) {
    return String(b.beleg);
  })[0];
  if (!beleg) return;
  const text = textEl.textContent;
  const pos = text.toLowerCase().indexOf(beleg.toLowerCase());
  if (pos === -1) return;
  leeren(textEl);
  textEl.appendChild(document.createTextNode(text.slice(0, pos)));
  textEl.appendChild(h("span", { class: "beleg-wellig", title: "Stopp-Regel erkannt", text: text.slice(pos, pos + beleg.length) }));
  textEl.appendChild(document.createTextNode(text.slice(pos + beleg.length)));
}

/**
 * „Die Daten oben …“ sagt der Server für die alte Oberfläche, wo Steckbrief und
 * Wiederholung über dem Fehler im Chat standen. Hier stehen sie links in der
 * Akte – „oben“ zeigte oft ins Leere (Gegenprüfung 09.10.).
 */
function fehlerTextHier(text) {
  const t = String(text || "");
  const satzOben = /\s*Die Daten oben stammen direkt aus der Datenbank und sind gültig\./;
  if (!satzOben.test(t)) return t;
  if (anzeigeId()) return t.replace(satzOben, " Die Akte kommt direkt aus der Datenbank und stimmt.");
  return t.replace(satzOben, " Bitte gleich noch einmal senden.");
}

/** Fehler: der Text des Servers + „Noch mal senden“ (14.3.3). */
function zeigeFehler(box, ev, text) {
  leeren(box);
  box.hidden = false;
  const code = ev.code || "fehler";
  box.appendChild(h("p", { class: "fehlerbox-text" }, ikon("achtung", { groesse: 16 }), h("span", { text: typo(fehlerTextHier(ev.text) || "Das hat nicht geklappt.") })));
  if (code === "sitzung") {
    box.appendChild(h("button", { type: "button", class: "knopf-e knopf-e-primaer", text: "Neu anmelden", onclick: abmelden }));
  } else if (code !== "deckel" && code !== "konfiguration") {
    const k = h("button", { type: "button", class: "knopf-e knopf-e-rand", text: "Noch mal senden" });
    k.addEventListener("click", function () {
      if (sende(text)) k.disabled = true;
    });
    box.appendChild(k);
  }
}

// --- Woher? ------------------------------------------------------------------------------------

/** Fortschrittstext → Wort für „Geprüft“; das Original bleibt als title. */
function geprueftText(t) {
  for (let i = 0; i < GEPRUEFT.length; i++) if (GEPRUEFT[i][0].test(t)) return GEPRUEFT[i][1];
  return typo(t);
}

/** Aussagen ohne Quelle: Lösungen und Schritte, deren source_ids leer sind. */
function ohneQuelleAnzahl(antwort) {
  let n = 0;
  (antwort && Array.isArray(antwort.blocks) ? antwort.blocks : []).forEach(function (b) {
    if (!b) return;
    if (b.type === "causes" && Array.isArray(b.items)) {
      b.items.forEach(function (u) {
        if (u && (!Array.isArray(u.source_ids) || !u.source_ids.length)) n += 1;
      });
    }
    if (b.type === "steps" && (!Array.isArray(b.source_ids) || !b.source_ids.length)) n += 1;
  });
  return n;
}

function zeilenKnopf(ikonName, titel, unter, id, r, extra) {
  return h("li", null, h("button", { type: "button", class: "quelle-reihe", "data-quelle": id, onclick: function (e) {
    quelleZeigenImBlatt(id, r);
    e.stopPropagation();
  } },
  h("span", { class: "quelle-ikon", "aria-hidden": "true" }, ikon(ikonName, { groesse: 18 })),
  h("span", { class: "quelle-reihe-text" }, h("strong", { text: titel }), unter ? h("span", { text: unter }) : null)),
  extra || null);
}

/**
 * Blatt „Woher kommt das?“ (14.3.9): Geprüft (übersetzt), Regeln, Quellen je
 * Unterlage (jede Seite einzeln), „ohne Quelle“, fester Satz. Ein Klick auf
 * eine Quelle schiebt das Quelle-Detail ins Blatt („‹ Zurück“).
 */
function woherOeffnen(r, ausloeser) {
  if (ausloeser) {
    Array.prototype.forEach.call(document.querySelectorAll("[data-blatt-ausloeser]"), function (e) { e.removeAttribute("data-blatt-ausloeser"); });
    ausloeser.setAttribute("data-blatt-ausloeser", "1");
  }
  const blatt = blattOeffnen("Woher kommt das?", ausloeser);
  blatt.el.setAttribute("data-runde", r.id);
  woherInhalt(blatt, r);
}

function woherInhalt(blatt, r) {
  blatt.titel("Woher kommt das?");
  blatt.zurueck(null);
  const koerper = leeren(blatt.koerper);
  const m = r.meta || {};
  const ohneKi = !!(m.pfad && m.pfad !== "modell");
  if (ohneKi) koerper.appendChild(h("p", { class: "woher-ohne-ki", text: "Ohne KI – direkt aus der Datenbank." }));
  const schritte = r.schritte.filter(function (t) { return t !== "Anfrage gesendet"; });
  const geprueft = schritte.map(function (t) {
    return h("li", { title: t }, ikon("haken", { groesse: 16, strich: 2.2 }), h("span", { text: geprueftText(t) }));
  });
  if (!ohneKi && r.fertig) {
    // „· 1 Korrektur“ las ein Laie als „die KI hat sich geirrt“ – die Zahl
    // steht jetzt im Tooltip (Gegenprüfung 09.10.).
    const n = typeof m.eingriffe === "number" ? m.eingriffe : 0;
    geprueft.push(h("li", { title: n === 1 ? "Der Server hat 1 Stelle korrigiert." : n > 1 ? "Der Server hat " + n + " Stellen korrigiert." : "Der Server musste nichts korrigieren." },
      ikon("haken", { groesse: 16, strich: 2.2 }), h("span", { text: "Antwort geprüft" })));
  }
  if (geprueft.length) {
    koerper.appendChild(h("h3", { class: "blatt-abschnitt", text: "Geprüft" }));
    koerper.appendChild(h("ul", { class: "haken-liste" }, geprueft));
  }
  const regeln = (r.antwort && Array.isArray(r.antwort.blocks) ? r.antwort.blocks : []).filter(function (b) {
    return b && b.type === "warning" && b.rule_id;
  });
  if (regeln.length) {
    koerper.appendChild(h("h3", { class: "blatt-abschnitt", text: "Regeln" }));
    koerper.appendChild(h("ul", { class: "haken-liste regel-liste" }, regeln.map(function (b) {
      return h("li", { class: b.level === "stop" ? "ist-stopp" : "ist-achtung" },
        ikon(b.level === "stop" ? "stopp" : "achtung", { groesse: 16 }),
        h("span", { text: typo(b.title || "") + " (" + b.rule_id + (b.entwurf ? ", Entwurf" : "") + ")" }));
    })));
  }
  const quellen = quellenDerAntwort(r.antwort);
  if (quellen.length) {
    koerper.appendChild(h("h3", { class: "blatt-abschnitt", text: "Quellen" }));
    const ul = h("ul", { class: "quellen-reihen" });
    gruppiereQuellen(quellen).forEach(function (g) {
      const q = g.q;
      const titel = String(q.title || "").trim();
      if (q.kind === "meister_notiz") {
        const teile = titel.split(",");
        ul.appendChild(zeilenKnopf("notiz", "Meister-Notiz · " + (teile[0] || q.id).trim(), teile.slice(1).join(",").trim() || null, q.id, r));
      } else if (q.kind === "ticket") {
        const vom = /^Ticket vom\s+/i.test(titel);
        ul.appendChild(zeilenKnopf("ticket", vom ? titel : titel || "Ticket", q.id, q.id, r));
      } else if (q.kind === "sop" || q.kind === "eskalationsmatrix") {
        ul.appendChild(zeilenKnopf("seite", q.kind === "sop" ? "Ablauf" : "Eskalation", typo(titel), q.id, r));
      } else {
        // Eine Reihe je Unterlage; jede Seite einzeln klickbar (SPEC 12.6).
        const art = q.kind === "installationsanleitung" ? "Anleitung" : "Handbuch";
        const hersteller = titel.split(/\s+/)[0] || "";
        const ersteId = g.seiten.length ? g.seiten[0].id : q.id;
        const seiten = g.seiten.length
          ? h("span", { class: "quelle-seiten" }, g.seiten.length === 1 ? "Seite " : "Seiten ",
            g.seiten.map(function (s, i) {
              return [i > 0 ? ", " : null, h("button", { type: "button", class: "quelle-seite", "data-quelle": s.id, "aria-label": "Seite " + s.page + " öffnen", text: String(s.page), onclick: function (e) {
                e.stopPropagation();
                quelleZeigenImBlatt(s.id, r);
              } })];
            }))
          : null;
        ul.appendChild(h("li", { class: "quelle-reihe-dok", "data-quellen-gruppe": g.ids.join(" ") },
          h("button", { type: "button", class: "quelle-reihe", "data-quelle": ersteId, title: typo(titel), onclick: function () { quelleZeigenImBlatt(ersteId, r); } },
            h("span", { class: "quelle-ikon", "aria-hidden": "true" }, ikon(QUELLEN_IKON[q.kind] || "buch", { groesse: 18 })),
            h("span", { class: "quelle-reihe-text" }, h("strong", { text: art + " " + hersteller }), seiten ? null : h("span", { text: typo(titel) }))),
          seiten));
      }
    });
    koerper.appendChild(ul);
  }
  const ohne = ohneQuelleAnzahl(r.antwort);
  if (ohne) koerper.appendChild(h("p", { class: "woher-ohne-quelle" }, ikon("achtung", { groesse: 16 }), h("span", { text: ohne === 1 ? "1 Aussage ohne Quelle" : ohne + " Aussagen ohne Quelle" })));
  koerper.appendChild(h("p", { class: "satz-db" }, ikon("datenbank", { groesse: 18 }), h("strong", { text: "Zahlen kommen aus der Datenbank, nicht von der KI." })));
}

// --- Quelle-Detail (im Blatt) ---------------------------------------------------------------

/** Quelle aus Akte oder Antwort öffnen: Blatt auf, Detail gleich drin. */
function quelleOeffnen(id, ausloeser, r) {
  if (ausloeser && ausloeser.setAttribute) {
    Array.prototype.forEach.call(document.querySelectorAll("[data-blatt-ausloeser]"), function (e) { e.removeAttribute("data-blatt-ausloeser"); });
    ausloeser.setAttribute("data-blatt-ausloeser", "1");
  }
  const blatt = blattOeffnen("Quelle", ausloeser && ausloeser.focus ? ausloeser : null);
  quelleLaden(blatt, id, r || null, false);
}

/** Aus der Liste „Woher?“ heraus: Detail als Push im selben Blatt. */
function quelleZeigenImBlatt(id, r) {
  const blatt = z.blatt;
  if (!blatt) return;
  quelleLaden(blatt, id, r, true);
}

function quelleLaden(blatt, id, r, mitZurueck) {
  const nr = ++z.quelleNr;
  blatt.titel("Quelle");
  blatt.zurueck(mitZurueck && r ? function () { woherInhalt(blatt, r); } : null);
  const koerper = leeren(blatt.koerper);
  const inhalt = h("div", { class: "quelle", "aria-busy": "true" },
    h("div", { class: "skelett skelett-zeile" }), h("div", { class: "skelett skelett-titel" }),
    h("div", { class: "skelett skelett-zeile" }), h("div", { class: "skelett skelett-seite" }));
  koerper.appendChild(inhalt);
  bewege(inhalt, [{ transform: "translateX(16px)", opacity: 0 }, { transform: "none", opacity: 1 }], 280);
  api.quelle(id).then(function (q) {
    if (nr !== z.quelleNr) return;
    quelleZeigen(inhalt, q, r);
  }, function (e) {
    if (nr !== z.quelleNr) return;
    leeren(inhalt).removeAttribute("aria-busy");
    inhalt.appendChild(h("div", { class: "leer" }, ikon("achtung", { groesse: 24 }),
      h("p", { text: e && e.message ? e.message : "Quelle nicht geladen." }),
      h("button", { type: "button", class: "knopf-leise-e", text: "Noch mal", onclick: function () {
        quelleLaden(blatt, id, r, mitZurueck);
      } })));
  });
}

const STOPPWOERTER = {};
("und oder der die das des dem den ein eine einer eines einem ist sind wird werden wurde nicht mit für fuer auf aus bei nach vor zum zur von vom " +
  "im in am an es sich dann wenn auch nur noch als wie kann können hier dieser diese dieses weil genau immer schon ohne über unter zwischen " +
  "damit dabei durch gegen sowie sollte sollten muss müssen haben hat hatte deren dessen welche welcher keine kein einen bitte").split(" ").forEach(function (w) {
  STOPPWOERTER[w] = 1;
});

function staemme(text) {
  const aus = {};
  String(text || "").toLowerCase().split(/[^a-zäöüß0-9]+/).forEach(function (w) {
    if (w.length < 6 || STOPPWOERTER[w]) return;
    aus[w.slice(0, 7)] = 1;
  });
  return aus;
}

/**
 * Zeilen der Seite markieren, die Begriffe der zitierenden Aussage enthalten.
 * Das Drahtformat liefert keine Satz-Anker – deshalb heuristisch und ehrlich
 * beschriftet („Markiert nach den Begriffen der Aussage …“, Entwurf B).
 */
function markierteZeilen(zeilen, kontext) {
  const alle = staemme(kontext);
  if (!Object.keys(alle).length) return {};
  const werte = zeilen.map(function (z2) {
    let n = 0;
    const gesehen = {};
    String(z2).toLowerCase().split(/[^a-zäöüß0-9]+/).forEach(function (x) {
      if (x.length < 6) return;
      const s = x.slice(0, 7);
      if (gesehen[s]) return;
      gesehen[s] = 1;
      if (alle[s]) n += 1;
    });
    return n;
  });
  const aus = {};
  let beste = -1;
  werte.forEach(function (w, i) {
    if (w >= 2) aus[i] = 1;
    if (beste === -1 || w > werte[beste]) beste = i;
  });
  if (!Object.keys(aus).length && beste !== -1 && werte[beste] > 0) aus[beste] = 1;
  return aus;
}

/** Elemente einer Runde (oder des ganzen Chats), die diese Quelle zitieren. */
function zitierende(id, r) {
  const bereich = r && r.el ? r.el : $("verlauf");
  if (!bereich) return [];
  return Array.prototype.filter.call(bereich.querySelectorAll('[data-quellen~="' + attrWert(id) + '"]'), function (el) {
    // Auch nicht, was in einem zugeklappten Bereich steckt („Lösungen von vorhin“).
    return !el.closest(".blk-sources") && !el.closest("[hidden]");
  });
}

function quelleZeigen(koerper, q, r) {
  leeren(koerper).removeAttribute("aria-busy");
  const kind = q.kind || "";
  const art = QUELLEN_ARTEN[kind] || "Quelle";
  if (kind === "meister_notiz") return notizZeigen(koerper, q, r);
  if (kind === "ticket") return ticketZeigen(koerper, q, r);
  const d = q.dokument || {};
  const unterlage = kind === "handbuch" || kind === "installationsanleitung" || kind === "datenblatt";
  koerper.appendChild(h("p", { class: "kicker quelle-kicker" }, ikon(unterlage ? "buch" : "seite", { groesse: 14 }), art));
  koerper.appendChild(h("h3", { class: "quelle-titel", text: typo(d.titel || q.titel || q.id) }));
  const herkunftText = d.herkunft === "upload"
    ? "hochgeladen" + (d.angelegt_von ? " von " + d.angelegt_von : "") + (d.aktiviert_am ? ", aktiv seit " + datum(d.aktiviert_am) : "")
    : unterlage ? "Herstellerunterlage (PDF), kuratiert" : "interne Unterlage";
  // Serie, Fassung, Herkunft hinter „Mehr“ – auf den ersten Blick nur Titel
  // und Seite (Gegenprüfung 09.10.: 114 Wörter Metadaten vor dem Inhalt).
  const mehrDaten = h("dl", { class: "eigenschaften" },
    d.hersteller ? eigenschaft("haus", "Hersteller", d.hersteller) : null,
    d.modell_serie ? eigenschaft("werkzeug", "Serie", typo(d.modell_serie)) : null,
    d.version ? eigenschaft("seite", "Fassung", typo(d.version)) : null,
    eigenschaft("datenbank", "Herkunft", herkunftText),
    eigenschaft("info", "Quelle", h("span", { class: "mono", text: String(q.id || "") })));

  // Umschalter der in dieser Antwort zitierten Seiten derselben Unterlage.
  const geschwister = r ? quellenDerAntwort(r.antwort).filter(function (x) {
    return x.kind === kind && x.title && (x.title === q.titel || x.title === d.titel) && typeof x.page === "number";
  }).sort(function (a, b) {
    return a.page - b.page;
  }) : [];
  if (geschwister.length > 1) {
    koerper.appendChild(h("div", { class: "quelle-seitenwahl" },
      h("div", { class: "segment", role: "group", "aria-label": "Zitierte Seiten" }, geschwister.map(function (x) {
        return h("button", { type: "button", "aria-pressed": String(x.id) === String(q.id) ? "true" : "false", "data-quelle": x.id, text: "S.\u00A0" + x.page, onclick: function () {
          quelleZeigenImBlatt(x.id, r);
        } });
      }))));
  }

  if (q.seitenbild && d.id && typeof q.seite === "number") {
    const rahmen = h("div", { class: "seitenbild" }, h("div", { class: "skelett skelett-seite" }));
    koerper.appendChild(h("figure", { class: "quelle-seitenbild" }, rahmen,
      h("figcaption", { class: "leise", text: "Seite\u00A0" + q.seite + (q.pdf_seite && q.pdf_seite !== q.seite ? " (PDF-Seite " + q.pdf_seite + ")" : "") })));
    api.ladeSeitenbild(d.id, q.seite).then(function (url) {
      leeren(rahmen).appendChild(h("img", { src: url, alt: "Seite " + q.seite + " von " + (d.titel || ""), decoding: "async" }));
    }, function () {
      leeren(rahmen).appendChild(h("p", { class: "leise seitenbild-fehlt", text: "Seitenbild konnte nicht geladen werden." }));
    });
  }

  const zitate = zitierende(q.id, r);
  if (q.inhalt) {
    const kontext = zitate.map(function (el) {
      return el.textContent;
    }).join(" ");
    const zeilen = String(q.inhalt).split("\n");
    const markiert = unterlage && kontext ? markierteZeilen(zeilen, kontext) : {};
    const text = h("div", { class: "quelle-text" });
    zeilen.forEach(function (zeile, i) {
      if (markiert[i]) text.appendChild(h("mark", { text: zeile }));
      else text.appendChild(document.createTextNode(zeile));
      if (i < zeilen.length - 1) text.appendChild(document.createTextNode("\n"));
    });
    koerper.appendChild(h("details", { class: "quelle-abschnitt quelle-wortlaut" },
      h("summary", null, h("span", { text: "Seitentext" }), ikon("runter", { groesse: 14, klasse: "mehr-pfeil" })),
      text,
      Object.keys(markiert).length
        ? h("p", { class: "quelle-markiert-hinweis" }, ikon("info", { groesse: 13 }), "Markiert nach den Begriffen der Aussage, die diese Seite zitiert.")
        : null));
  }

  if (Array.isArray(q.abbildungen) && q.abbildungen.length) {
    koerper.appendChild(h("section", { class: "quelle-abschnitt" }, h("h4", { class: "kicker", text: "Abbildungen" }),
      h("ul", { class: "quelle-abbildungen" }, q.abbildungen.map(function (a) {
        const fig = h("div", { class: "quelle-abbildung-bild" });
        const knopf = h("button", { type: "button", class: "knopf-leise-e" }, ikon("bild", { groesse: 14 }), "Abbildung zeigen");
        knopf.addEventListener("click", function () {
          knopf.disabled = true;
          leeren(fig).appendChild(h("div", { class: "skelett skelett-block" }));
          api.ladeBild(a.id).then(function (url) {
            leeren(fig).appendChild(h("img", { src: url, alt: typo(a.beschriftung || "Abbildung"), decoding: "async" }));
          }, function () {
            leeren(fig).appendChild(h("p", { class: "leise", text: "Abbildung konnte nicht geladen werden." }));
          });
        });
        return h("li", null, h("p", { text: typo(a.beschriftung || "") }), knopf, fig);
      }))));
  }

  if (q.original_url && /^https:\/\//i.test(String(q.original_url))) {
    // Öffnet das Hersteller-PDF; die Oberfläche selbst lädt nichts von dort.
    koerper.appendChild(h("p", { class: "quelle-original" },
      h("a", { href: String(q.original_url), target: "_blank", rel: "noopener noreferrer" }, ikon("extern", { groesse: 15 }), "Original beim Hersteller")));
  }
  zitiertIn(koerper, zitate);
  koerper.appendChild(mehrAufklapper(mehrDaten));
}

/** „Mehr“ zum Aufklappen am Ende einer Quelle: Kürzel, Autor, Fassung, Herkunft … */
function mehrAufklapper(inhalt) {
  return h("details", { class: "mehr quelle-mehr" },
    h("summary", null, h("span", { text: "Mehr" }), ikon("runter", { groesse: 14, klasse: "mehr-pfeil" })),
    h("div", { class: "mehr-inhalt" }, inhalt));
}

function zitiertIn(koerper, zitate) {
  if (!zitate.length) return;
  koerper.appendChild(h("section", { class: "quelle-abschnitt" }, h("h4", { class: "kicker", text: "Zitiert in diesem Gespräch" }),
    h("ul", { class: "quelle-zitate" }, zitate.map(function (el) {
      const titel = el.getAttribute("data-zitat-titel") || "Aussage";
      return h("li", null, h("button", { type: "button", class: "quelle-zitat", onclick: function () {
        const blatt = z.blatt;
        const springen = function () {
          el.scrollIntoView({ block: "center", behavior: ruhig() ? "auto" : "smooth" });
          aufleuchten(el, markeRgba(0.28));
        };
        if (blatt) blatt.schliessen(false).then(springen);
        else springen();
      } }, ikon("pfeil-links", { groesse: 14 }), h("span", { text: typo(titel) })));
    }))));
}

const NOTIZ_QUELLE = { sprachnotiz: "Sprachnotiz", diktat: "Diktat", text: "Texteingabe" };

function notizZeigen(koerper, q, r) {
  const n = q.notiz || {};
  koerper.appendChild(h("p", { class: "kicker quelle-kicker" }, ikon("notiz", { groesse: 14 }), "Meister-Notiz"));
  // Titel: das Gerät; Kürzel, Autor, Datum, Herkunft und Status hinter „Mehr“.
  koerper.appendChild(h("h3", { class: "quelle-titel", text: typo(n.geraet || n.autor || "Erfahrung aus dem Team") }));
  const herkunft = (NOTIZ_QUELLE[n.quelle] || "Notiz") + (n.eingereicht_rolle ? ", eingereicht als " + rolleName(n.eingereicht_rolle) : "");
  const mehrDaten = h("dl", { class: "eigenschaften" },
    eigenschaft("info", "Kürzel", h("span", { class: "mono", text: String(n.kuerzel || q.id || "") })),
    eigenschaft("person", "Autor", n.autor || "–"),
    n.erstellt_am ? eigenschaft("kalender", "Erfasst", datum(n.erstellt_am)) : null,
    eigenschaft("mikrofon", "Herkunft", herkunft),
    eigenschaft("freigabe", "Status", n.geprueft_von
      ? h("span", null, h("span", { class: "pille pille-gut", text: "Freigegeben" }), " von " + n.geprueft_von + (n.geprueft_am ? " am " + datum(n.geprueft_am) : ""))
      : h("span", { class: "pille pille-gut", text: "Freigegeben" })),
    n.hersteller || n.modell_serie ? eigenschaft("werkzeug", "Gerät", [n.hersteller, n.modell_serie].filter(Boolean).join(" ")) : null);
  [["Fehlerbild", n.fehlerbild], ["Ursache", n.ursache], ["Lösung", n.loesung]].forEach(function (f) {
    if (!f[1]) return;
    koerper.appendChild(h("section", { class: "quelle-abschnitt" }, h("h4", { class: "kicker", text: f[0] }), h("p", { class: "quelle-text", text: typo(f[1]) })));
  });
  zitiertIn(koerper, zitierende(q.id, r));
  koerper.appendChild(mehrAufklapper(mehrDaten));
}

function ticketZeigen(koerper, q, r) {
  const t = q.ticket || {};
  const a = q.anlage || {};
  koerper.appendChild(h("p", { class: "kicker quelle-kicker" }, ikon("ticket", { groesse: 14 }), "Ticket"));
  const zu = t.status === "geschlossen";
  // Titel „Ticket vom 19.09.2026“ und der Status; Nummer, Kanal, Code und
  // Herkunft hinter „Mehr“ (Gegenprüfung 09.10.).
  koerper.appendChild(h("h3", { class: "quelle-titel" }, h("span", { text: typo(q.titel || t.id || q.id) }), " ",
    h("span", { class: "pille " + (zu ? "pille-neutral" : "pille-achtung"), text: zu ? "geschlossen" : t.status === "in_bearbeitung" ? "in Bearbeitung" : "offen" })));
  const mehrDaten = h("dl", { class: "eigenschaften" },
    eigenschaft("ticket", "Nummer", h("span", { class: "mono", text: String(t.id || q.id || "") })),
    a.id ? eigenschaft("haus", "Anlage", h("span", null, h("span", { class: "mono", text: a.id }), a.kunde_alias ? " · " + a.kunde_alias : "")) : null,
    eigenschaft("info", "Status", h("span", { class: "pille " + (zu ? "pille-neutral" : "pille-achtung"), text: zu ? "geschlossen" + (t.geschlossen_am ? " " + datumKurz(t.geschlossen_am) : "") : t.status || "offen" })),
    t.kanal ? eigenschaft(t.kanal === "app" ? "app" : t.kanal === "mail" ? "mail" : "telefon", "Kanal", KANAELE[t.kanal] || t.kanal) : null,
    t.erstellt_am ? eigenschaft("kalender", "Gemeldet", datum(t.erstellt_am)) : null,
    t.symptom_label ? eigenschaft("akte", "Fehlerbild", typo(t.symptom_label)) : null,
    t.fehlercode ? eigenschaft("seite", "Fehlercode", h("span", { class: "mono", text: t.fehlercode })) : null,
    t.ursache ? eigenschaft("werkzeug", "Ursache", h("span", null, typo(t.ursache), " ", h("span", { class: "pille " + (t.ursache_verifiziert ? "pille-gut" : "pille-achtung"), text: t.ursache_verifiziert ? "bestätigt" : "vermutet" }))) : null,
    eigenschaft("datenbank", "Herkunft", t.herkunft === "app" ? "in der App erfasst" + (t.erfasst_von ? " von " + t.erfasst_von : "") : "Ticketsystem (Demo-Daten)"));
  if (t.symptom) koerper.appendChild(h("blockquote", { class: "quelle-zitat-block", text: "„" + typo(t.symptom) + "“" }));
  const massnahmen = Array.isArray(t.massnahmen) ? t.massnahmen : [];
  if (massnahmen.length) {
    koerper.appendChild(h("section", { class: "quelle-abschnitt" }, h("h4", { class: "kicker", text: "Maßnahmen" }),
      h("ul", { class: "quelle-massnahmen" }, massnahmen.map(function (m) {
        const wer = [m.durchgefuehrt_von || m.von, m.vor_ort ? "vor Ort" : null].filter(Boolean);
        return h("li", null,
          h("p", { class: "leise" }, h("strong", { text: datum(m.datum) }), wer.length ? " · " + wer.join(", ") : ""),
          h("p", null, typo(m.massnahme || m.text || ""), m.art ? " " : null, m.art ? h("span", { class: "pille " + (m.art === "symptom" ? "pille-achtung" : "pille-neutral"), text: MASSNAHME_ART[m.art] || m.art }) : null));
      }))));
  }
  if (t.ursache) {
    koerper.appendChild(h("section", { class: "quelle-abschnitt" }, h("h4", { class: "kicker", text: "Ursache" }),
      h("p", null, typo(t.ursache), " ", h("span", { class: "pille " + (t.ursache_verifiziert ? "pille-gut" : "pille-achtung"), text: t.ursache_verifiziert ? "bestätigt" : "vermutet" }))));
  }
  zitiertIn(koerper, zitierende(q.id, r));
  koerper.appendChild(mehrAufklapper(mehrDaten));
}

/**
 * Bild im Blatt: Schaubild und „Quelle: …, S. 41“ (Klick → Seite). Die
 * Beschriftung ist die Legende zu den Ziffern im Bild – rund 60 Wörter
 * Fachsprache. Sie liegt hinter „Beschriftung“, für Techniker und Meister
 * gleich offen, denn die brauchen sie (Gegenprüfung 09.10.).
 */
function bildOeffnen(bild, ausloeser, r) {
  const blatt = blattOeffnen("Schaubild", ausloeser);
  const rahmen = h("div", { class: "bild-rahmen" }, h("div", { class: "skelett skelett-block" }));
  const fachkraft = (ROLLEN_RANG[z.sitzung ? z.sitzung.rolle : ""] || 0) >= 2;
  const beschriftung = bild.caption
    ? h("details", { class: "mehr bild-beschriftung", open: fachkraft },
      h("summary", null, h("span", { text: "Beschriftung" }), ikon("runter", { groesse: 14, klasse: "mehr-pfeil" })),
      h("div", { class: "mehr-inhalt" }, h("p", { text: bild.caption })))
    : null;
  blatt.koerper.appendChild(h("figure", { class: "bild-blatt" },
    rahmen,
    h("figcaption", null,
      bild.source_id
        ? h("button", { type: "button", class: "bild-quelle-knopf", "data-quelle": bild.source_id, text: bild.quelle, onclick: function () { quelleZeigenImBlatt(bild.source_id, r); } })
        : h("p", { class: "leise", text: bild.quelle }),
      beschriftung)));
  const zeigen = function (url) {
    leeren(rahmen).appendChild(h("img", { src: url, alt: bild.caption || "Abbildung aus der Herstellerunterlage", decoding: "async" }));
  };
  if (bild.url) zeigen(bild.url);
  else if (bild.laden) {
    bild.laden.then(zeigen, function () {
      leeren(rahmen).appendChild(h("p", { class: "leise", text: "Abbildung konnte nicht geladen werden." }));
    });
  } else leeren(rahmen).appendChild(h("p", { class: "leise", text: "Abbildung hier nicht verfügbar." }));
}

// --- Leuchten: Quelle ↔ Aussage -------------------------------------------------------------

let leuchtend = [];

function leuchtenAus() {
  leuchtend.forEach(function (el) {
    el.classList.remove("zitat-leuchtet");
    el.classList.remove("quelle-leuchtet");
  });
  leuchtend = [];
}

/** Überfahren einer Quelle (Blatt) → zitierende Aussagen im Chat dahinter leuchten. */
function leuchtenUeber(e) {
  const t = e.target;
  if (!t || !t.closest) return;
  const quelle = t.closest("[data-quelle]");
  if (!quelle || !quelle.closest(".blatt")) return;
  leuchtenAus();
  const blatt = quelle.closest(".blatt");
  const rundeId = blatt ? blatt.getAttribute("data-runde") : null;
  const bereich = (rundeId && $(rundeId)) || $("verlauf");
  if (!bereich) return;
  const id = attrWert(quelle.getAttribute("data-quelle"));
  Array.prototype.forEach.call(bereich.querySelectorAll('[data-quellen~="' + id + '"]'), function (el) {
    if (el.closest("[hidden]") || el.closest(".blk-sources")) return;
    el.classList.add("zitat-leuchtet");
    leuchtend.push(el);
  });
}

function leuchtenWeg(e) {
  const t = e.target;
  if (!t || !t.closest || !t.closest("[data-quelle]")) return;
  const nach = e.relatedTarget;
  if (nach && nach.closest && nach.closest("[data-quelle]")) return;
  leuchtenAus();
}

// --- Router ---------------------------------------------------------------------------------

function routeLesen() {
  const roh = String(window.location.hash || "").replace(/^#/, "");
  const teile = roh.split("?");
  const pfad = teile[0] || "/brauchen";
  const param = {};
  new URLSearchParams(teile[1] || "").forEach(function (v, k) {
    param[k] = v;
  });
  return { pfad: ROUTEN[pfad] ? pfad : "/brauchen", param: param, roh: "#" + roh };
}

/** navigiere('#/abgeben/einsatz', {anlage: 'A-1042'}) */
function navigiere(route, param) {
  let ziel = String(route || "#/brauchen");
  if (ziel.charAt(0) !== "#") ziel = "#" + ziel;
  const q = [];
  if (param && typeof param === "object") {
    Object.keys(param).forEach(function (k) {
      if (param[k] !== null && param[k] !== undefined && param[k] !== "") q.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(param[k])));
    });
  }
  if (q.length) ziel += "?" + q.join("&");
  if (window.location.hash === ziel) routeAnwenden();
  else window.location.hash = ziel;
}

async function routeAnwenden() {
  if (!z.sitzung) return;
  if (z.ignoriereHash) {
    z.ignoriereHash = false;
    return;
  }
  const neu = routeLesen();
  const def = ROUTEN[neu.pfad];
  const r = rechte();
  if (def.recht && !r[def.recht]) {
    toast("Für deine Rolle nicht freigegeben.", "achtung");
    if (window.location.hash !== "#/brauchen") {
      z.ignoriereHash = true;
      window.location.hash = "#/brauchen";
    }
    routeZeigen({ pfad: "/brauchen", param: {}, roh: "#/brauchen" });
    return;
  }
  // Ungesicherte Eingaben fragt das Modul selbst ab (ctx.bestaetigen).
  if (z.modul && typeof z.modul.verlassen === "function") {
    let darf = true;
    try {
      darf = await Promise.resolve(z.modul.verlassen());
    } catch (e) {
      darf = true;
    }
    if (darf === false) {
      if (z.route) {
        z.ignoriereHash = true;
        window.location.hash = z.route.roh;
      }
      return;
    }
  }
  routeZeigen(neu);
}

function modulAufraeumen() {
  if (z.modul && typeof z.modul.aufraeumen === "function") {
    try {
      z.modul.aufraeumen();
    } catch (e) {
      console.error("aufraeumen() hat geworfen:", e);
    }
  }
  z.modul = null;
}

async function routeZeigen(neu) {
  const def = ROUTEN[neu.pfad];
  modulAufraeumen();
  menueZu();
  if (z.blatt) z.blatt.schliessen(true);
  z.route = neu;
  if (def.modus) {
    z.modus = def.modus;
    speicherSchreiben(MODUS_SPEICHER, z.modus);
  }
  kopfNeu();
  const nr = ++z.routeNr;
  const firma = (z.branding.branding || {}).firmenname || "Wissensassistent";
  const chat = $("rechts-chat");
  const bildschirm = $("rechts-bildschirm");
  zeige("ansicht-arbeit");
  freigabenZaehlen();

  if (neu.pfad === "/brauchen") {
    chat.hidden = false;
    bildschirm.hidden = true;
    leeren(bildschirm);
    document.title = "Kunden betreuen · " + firma;
    // „Akte ansehen“ nach einem Einsatz (#/brauchen?anlage=…&ticket=…): diese
    // Akte zeigen; ist es nicht der laufende Fall, wie eine Wahl aus der
    // Fallsuche. Danach den Parameter aus der Adresse nehmen.
    const anlage = String(neu.param.anlage || "").trim().toUpperCase();
    const ticketId = String(neu.param.ticket || "").trim().toUpperCase();
    if (/^A-\d{4}$/.test(anlage)) {
      z.route = { pfad: "/brauchen", param: {}, roh: "#/brauchen" };
      try {
        window.history.replaceState(null, "", window.location.pathname + window.location.search + "#/brauchen");
      } catch (e) {
        // Adresse bleibt mit Parameter – harmlos.
      }
      if (!z.fall || z.fall.anlage_id !== anlage) {
        // Wie eine Wahl aus der Fallsuche: Der Server vergisst den alten Fall,
        // sonst baut die nächste Frage still auf ihm auf (Gegenprüfung 09.10.).
        z.wahlNr += 1;
        serverFallVergessen().then(null, function (err) {
          console.warn("fall_beenden nach „Akte ansehen“ fehlgeschlagen:", err);
        });
        z.gewaehlt = { anlage_id: anlage, kunde_alias: "" };
        chatLeeren();
      }
      z.suchen = false;
      z.verlaufAuf = true;
      linksNeu();
      akteLaden(anlage, true).then(function () {
        if (/^T-\d{4}-\d{4}$/.test(ticketId)) ticketInAkteZeigen(ticketId);
      });
    } else {
      linksNeu();
    }
    wichtigNeu();
    leerNeu();
    const aktiv = document.activeElement;
    if (!aktiv || aktiv === document.body || !aktiv.isConnected || !chat.contains(aktiv)) {
      naechsterFrame(function () {
        if (istZeigegeraet()) fokus($("frage-text"));
        else fokus($("chat-leer-titel"));
      });
    }
    return;
  }

  chat.hidden = true;
  bildschirm.hidden = false;
  linksNeu();
  leeren(bildschirm);
  const container = h("section", { class: "bildschirm", id: "bildschirm" },
    h("div", { class: "bildschirm-laden" }, h("div", { class: "skelett skelett-titel" }), h("div", { class: "skelett skelett-zeile" }), h("div", { class: "skelett skelett-block" })));
  const innen = h("div", { class: "bildschirm-innen" + (neu.pfad === "/einrichtung" || neu.pfad === "/freigaben" || neu.pfad === "/abgeben/handbuch" ? " ist-breit" : "") },
    def.zurueck ? h("a", { class: "zurueck-link", href: "#/abgeben" }, ikon("zurueck", { groesse: 16 }), "Zurück") : null,
    container);
  bildschirm.appendChild(innen);
  bildschirm.scrollTop = 0;
  document.title = (def.titel || "") + " · " + firma;

  let modul = null;
  try {
    modul = await import(MODUL_DATEI[def.modul]);
  } catch (e) {
    console.warn("Modul " + def.modul + " nicht geladen:", e && e.message ? e.message : e);
    modul = null;
  }
  if (nr !== z.routeNr) return;
  leeren(container);
  if (def.modul === "handbuch" && modul && modul.HANDBUCH_BEREIT === false) {
    platzhalter(container, "Handbuch hochladen", "Bald verfügbar.", "hochladen");
    return;
  }
  const fn = modul && typeof modul[def.fn] === "function" ? modul[def.fn] : null;
  if (!fn) {
    platzhalter(container, def.titel || "Dieser Bereich", "Folgt bald.", "hochladen");
    return;
  }
  try {
    const param = def.modul === "handbuch" ? { dok: neu.param.dok } : def.fn === "zeigeEinsatz" ? { anlage: neu.param.anlage, ticket: neu.param.ticket } : neu.param;
    const rueck = await Promise.resolve(fn(container, faCtx(), param));
    if (nr !== z.routeNr) {
      if (rueck && typeof rueck.aufraeumen === "function") rueck.aufraeumen();
      return;
    }
    z.modul = rueck || null;
    if (rueck && rueck.titel) document.title = rueck.titel + " · " + firma;
  } catch (e) {
    console.error("Bildschirm " + neu.pfad + " ist gescheitert:", e);
    leeren(container);
    platzhalter(container, "Das hat nicht geklappt", "Dieser Bildschirm konnte nicht aufgebaut werden.", "achtung");
  }
}

function platzhalter(container, titel, text, ikonName) {
  container.appendChild(h("div", { class: "platzhalter" },
    h("span", { class: "platzhalter-symbol", "aria-hidden": "true" }, ikon(ikonName || "info", { groesse: 26 })),
    h("h1", { class: "titel-serif", text: titel }),
    h("p", { text: text }),
    h("a", { class: "knopf-e knopf-e-rand", href: "#/brauchen" }, "Zurück zum Kunden")));
}

/** Ein Ticket in der Akte zeigen (nach „Akte ansehen“): Verlauf auf, Zeile leuchtet. */
function ticketInAkteZeigen(ticketId) {
  const zeile = document.querySelector('#zone-links .verlauf-zeile[data-quelle="' + attrWert(ticketId) + '"]');
  if (!zeile) return;
  naechsterFrame(function () {
    try {
      zeile.scrollIntoView({ block: "nearest", behavior: ruhig() ? "auto" : "smooth" });
    } catch (e) {
      zeile.scrollIntoView();
    }
    aufleuchten(zeile, markeRgba(0.22));
  });
}

/** Fehlercodes aus den Tickets der Akte links: {anlage_id, codes} oder null. */
function akteCodes() {
  const a = z.akte && z.akteId ? z.akte : null;
  if (!a || !Array.isArray(a.tickets)) return null;
  const codes = [];
  a.tickets.forEach(function (t) {
    if (t && t.fehlercode && codes.indexOf(String(t.fehlercode)) === -1) codes.push(String(t.fehlercode));
  });
  return { anlage_id: z.akteId, codes: codes };
}

/** ctx für die Module (SPEC 13.3.9). `fall` = Akte links (Sitzungsfall oder Wahl). */
function faCtx() {
  const s = z.sitzung || {};
  const fall = z.gewaehlt || z.fall;
  return {
    api: api,
    rolle: s.rolle,
    anzeigename: s.anzeigename,
    istAdmin: !!s.ist_admin,
    rechte: Object.assign({}, rechte()),
    modus: z.modus,
    fall: fall ? Object.assign({}, fall, { kunde_alias: fall.kunde_alias || anzeigeName() }) : null,
    // Codes, die bei der Anlage links schon vorkamen – „Code im Display?“ zeigt sie vorn.
    akteCodes: akteCodes(),
    anlagen: z.listeDaten ? z.listeDaten.slice() : null,
    branding: z.branding,
    navigiere: navigiere,
    toast: toast,
    bestaetigen: bestaetigen,
    geaendert: geaendert,
    bloecke: { renderBlock: renderBlock, renderAntwort: renderAntwort },
  };
}

/**
 * Rückmeldung der Module: {anlage_id} lädt die Akte neu, wenn sie links steht;
 * {freigaben: true} das Abzeichen; {branding} setzt Farben, Logo und Namen.
 */
function geaendert(was) {
  const w = was || {};
  if (w.anlage_id && z.akteId === w.anlage_id) akteLaden(w.anlage_id, true);
  // Ein Einsatz ändert offene Tickets – „· 1 offen“ in Suche und Auswahl neu.
  if (w.anlage_id) listeNeu();
  if (w.freigaben) freigabenZaehlen();
  if (w.branding && typeof w.branding === "object") {
    const b = w.branding;
    z.branding = { branding: b.branding || z.branding.branding, farben: b.farben || z.branding.farben };
    brandingAnwenden();
  }
}

// --- Start ---------------------------------------------------------------------------------

function appStarten(route) {
  z.login = null;
  kopfBauen();
  arbeitBauen();
  z.linksArt = null;
  if (z.sitzung && z.sitzung.fall) fallSetzen(z.sitzung.fall);
  else fallSetzen(null);
  listeLaden().then(function () { linksNeu(); }, function () {});
  if (route && window.location.hash !== route) {
    window.location.hash = route;
  } else {
    routeAnwenden();
  }
}

function breiteGewechselt() {
  // Unter 1024 px ist die Akte eine Kopfkarte: zu, damit der Chat Platz hat.
  if (!schmal()) z.kopfkarteAuf = false;
  if (z.blatt) z.blatt.schliessen(true);
  z.linksArt = null;
  linksNeu();
}

function tastenGlobal(e) {
  if (e.key === "Escape") {
    const menue = $("nutzer-menue");
    if (menue && !menue.hidden) {
      menueZu();
      fokus($("nutzer-knopf"));
    }
  }
}

async function start() {
  if (api.istMock) {
    // Im Mock-Modus sichtbar sagen, dass nichts davon vom Server kommt.
    $("banner-zusatz").textContent = " · Offline-Modus";
  }
  try {
    if (new URLSearchParams(window.location.search).get("ruhig") === "1") sperren(true);
  } catch (e) {
    // egal
  }
  document.addEventListener("keydown", tastenGlobal);
  document.addEventListener("click", function (e) {
    const menue = $("nutzer-menue");
    if (menue && !menue.hidden && !e.target.closest(".person")) menueZu();
  });
  window.addEventListener("hashchange", routeAnwenden);
  [MQ.schmal, MQ.handy].forEach(function (mq) {
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", breiteGewechselt);
    else if (typeof mq.addListener === "function") mq.addListener(breiteGewechselt);
  });

  // Branding vor dem Login – parallel zur Sitzungsprüfung, die Anmeldung
  // wartet höchstens kurz darauf.
  const branding = brandingLaden();
  let info = null;
  try {
    info = await api.sitzung();
  } catch (e) {
    info = null;
  }
  await mitFrist(branding, 2500);
  if (info && info.rolle) {
    z.sitzung = info;
    const gespeichert = speicherLesen(MODUS_SPEICHER);
    z.modus = gespeichert === "abgeben" && rechte().erfahrung ? "abgeben" : "brauchen";
    const r = routeLesen();
    appStarten(window.location.hash ? r.roh : z.modus === "abgeben" ? "#/abgeben" : "#/brauchen");
  } else {
    zeigeLogin("passcode");
  }
}

start();
