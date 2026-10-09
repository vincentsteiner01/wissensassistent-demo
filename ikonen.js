// ============================================================================
// ikonen.js  ·  Eigene Liniensymbole (SPEC 13.3.9)
// ----------------------------------------------------------------------------
// Selbst gezeichnet (24er Raster, 1,75er Linie), keine Symbolbibliothek, kein
// CDN, kein HTML aus Zeichenketten: Jedes Symbol entsteht über dom.svg() aus festen
// Pfaddaten dieser Datei. Ohne `label` sind Symbole dekorativ
// (aria-hidden="true") – die Bedeutung trägt immer auch ein Wort daneben
// (Stopp hat Symbol UND Wort, SPEC 13.3.5).
// ============================================================================
import { svg } from "./dom.js";

const PFADE = {
  akte: "M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M14 3v5h5 M9 13h6 M9 17h4",
  regel: "M12 3l7 3v5c0 4.6-3 8.3-7 10-4-1.7-7-5.4-7-10V6z",
  assistent: "M12 3.5l1.7 4.3 4.3 1.7-4.3 1.7L12 15.5l-1.7-4.3L6 9.5l4.3-1.7z M18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z",
  buch: "M5 5.5A2.5 2.5 0 0 1 7.5 3H19v14H7.5A2.5 2.5 0 0 0 5 19.5z M5 19.5A2.5 2.5 0 0 0 7.5 22H19v-5",
  notiz: "M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M8 8.5h8 M8 11.5h5",
  ticket: "M4 6h16a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4V7a1 1 0 0 1 1-1z M15 6v2 M15 11v2 M15 16v2",
  haken: "M5 12.5l4.5 4.5L19 7.5",
  stopp: "M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3z M8 12h8",
  achtung: "M12 4.2l9 15.6H3z M12 10v4.2 M12 17.2v.01",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11v5.5 M12 7.7v.01",
  wiederholung: "M20 11.5A8 8 0 0 0 6 6.5L4 8.5 M4 4.5v4h4 M4 12.5a8 8 0 0 0 14 5l2-2 M20 19.5v-4h-4",
  "pfeil-rechts": "M5 12h14 M13 6l6 6-6 6",
  "pfeil-links": "M19 12H5 M11 6l-6 6 6 6",
  schliessen: "M6 6l12 12 M18 6L6 18",
  plus: "M12 5v14 M5 12h14",
  hochladen: "M12 15V4 M7 9l5-5 5 5 M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4",
  stift: "M4 20l1-4L16 5l3 3L8 19z M14 7l3 3",
  suche: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4",
  telefon: "M6 3.5h2.5l1.8 4.6-2.1 1.4a11 11 0 0 0 6.3 6.3l1.4-2.1 4.6 1.8V18a2.5 2.5 0 0 1-2.7 2.5A15.5 15.5 0 0 1 3.5 6.2 2.5 2.5 0 0 1 6 3.5z",
  mail: "M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z M3.5 7l8.5 6.5L20.5 7",
  app: "M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3z M11 18h2",
  werkzeug: "M14.7 6.3a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.7-7.7z M14.7 6.3L17 4l3 3-2.3 2.3",
  uebergabe: "M4 8h14 M14 4l4 4-4 4 M20 16H6 M10 12l-4 4 4 4",
  kalender: "M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M4 10h16 M8 3v4 M16 3v4",
  ort: "M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11z M12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  team: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M3 20a6 6 0 0 1 12 0 M16 4.3a3.5 3.5 0 0 1 0 6.4 M17.5 14.2A6 6 0 0 1 21 20",
  schild: "M12 3l7 3v5c0 4.6-3 8.3-7 10-4-1.7-7-5.4-7-10V6z M9 12l2.2 2.2L15.5 10",
  mikrofon: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5.5 11a6.5 6.5 0 0 0 13 0 M12 17.5V21",
  senden: "M12 19V5 M6 11l6-6 6 6",
  einstellungen: "M4 7h9 M17 7h3 M15 5v4 M4 17h3 M11 17h9 M9 15v4",
  freigabe: "M12 3l2.2 1.6 2.7-.1.9 2.6 2.2 1.6-.8 2.6.8 2.6-2.2 1.6-.9 2.6-2.7-.1L12 21l-2.2-1.6-2.7.1-.9-2.6-2.2-1.6.8-2.6-.8-2.6 2.2-1.6.9-2.6 2.7.1z M8.8 12l2.2 2.2 4.2-4.4",
  datei: "M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M14 3v5h5",
  seite: "M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M8.5 8h7 M8.5 12h7 M8.5 16h4",
  auge: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  muell: "M4 7h16 M9.5 7V4.5h5V7 M6 7l1 13h10l1-13 M10 11v5.5 M14 11v5.5",
  zurueck: "M15 5l-7 7 7 7",
  // Ergänzungen über die Pflichtliste hinaus (FG intern)
  weiter: "M9 5l7 7-7 7",
  runter: "M5 9l7 7 7-7",
  hoch: "M5 15l7-7 7 7",
  haus: "M4 11l8-7 8 7 M6 9.5V20h12V9.5 M10 20v-5h4v5",
  datenbank: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  extern: "M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  person: "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4.5 21a7.5 7.5 0 0 1 15 0",
  abmelden: "M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4 M10 8l-4 4 4 4 M6 12h10",
  menue: "M4 7h16 M4 12h16 M4 17h16",
  spalte: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M15 5v14",
  uhr: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7.5V12l3 2",
  kopieren: "M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  bild: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M3 16l5-5 4 4 3-3 6 6 M15.5 8.5v.01",
  blitz: "M13 3L5 13.5h6L10 21l8-10.5h-6z",
  wechselrichter: "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M8 10c1-1.5 2-1.5 3 0s2 1.5 3 0 2-1.5 3 0 M8 15h8",
  waermepumpe: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M14.5 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0z M11.5 9v6 M8.5 12h6 M18 8.5v7",
  modul: "M3 17l3-10h12l3 10z M8 7l-1.5 10 M16 7l1.5 10 M4.5 12h15 M12 7v10",
  wallbox: "M7 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M11.5 8l-2 3.5h3L10.5 15 M16 9h2a1 1 0 0 1 1 1v6a2 2 0 0 0 2 2",
  speicher: "M7 6h10a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z M10 3h4v3 M9.5 13.5h5 M12 11v5",
  // SPEC 14: „Wissen aufladen“ (Glühbirne) und Kunde (Fallsuche).
  idee: "M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  kunde: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4.5 21a7.5 7.5 0 0 1 15 0",
};

/** Alle bekannten Namen (für Tests und FA). */
export const IKON_NAMEN = Object.keys(PFADE);

function baue(d, opt) {
  const o = opt || {};
  const groesse = typeof o.groesse === "number" ? o.groesse : 16;
  const attrs = {
    viewBox: "0 0 24 24",
    width: String(groesse),
    height: String(groesse),
    fill: "none",
    stroke: "currentColor",
    "stroke-width": o.strich ? String(o.strich) : "1.75",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    class: "ikon" + (o.klasse ? " " + o.klasse : ""),
    focusable: "false",
  };
  if (o.label) {
    attrs.role = "img";
    attrs["aria-label"] = String(o.label);
  } else {
    attrs["aria-hidden"] = "true";
  }
  return svg("svg", attrs, svg("path", { d: d }));
}

/** Symbol aus der Liste; unbekannter Name → leerer Kreis + Meldung (nie werfen). */
export function ikon(name, opt) {
  const d = PFADE[name];
  if (!d) {
    console.error("ikonen: unbekanntes Symbol „" + name + "“");
    return baue("M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", opt);
  }
  return baue(d, opt);
}

/** Eigenes Symbol aus Pfaddaten (für FA). */
export function ikonAusPfad(d, opt) {
  return baue(String(d || ""), opt);
}
