// ============================================================================
// bloecke.js  ·  Renderer für die Antwortblöcke (SPEC 5.1, 8, 13.3.9, 14.3.5)
// ----------------------------------------------------------------------------
// „Einfach (Mike)“, SPEC 14: Mike fand die Antworten „zu verwirrend“ – zu viel
// Text, zu viel Technik auf den ersten Blick. Deshalb zeigt jede Karte jetzt
// eine Überschrift und höchstens ein bis zwei Sätze; alles Weitere liegt hinter
// „Warum?“, „Mehr“ oder „Ansehen“. Herkunft, Prüfliste und Regel-IDs stehen im
// Blatt „Woher?“ (app.js), nicht mehr über jeder Karte. Die Herkunft bleibt
// trotzdem im DOM (data-herkunft), damit Tests und das Leuchten sie finden.
//
// Vertrag (SPEC 8, unverändert):
//   renderAntwort(antwort, ctx) → HTMLElement   (alle Blöcke + Fußzeile „Woher?“)
//   renderBlock(block, ctx)     → HTMLElement
//   ctx = { rolle, onAktion(item) → Promise<Block|null>, onAntworten(text),
//           ladeBild(id) → Promise<string> }
// Optional (13.3.9, 14.3.14): pfad, akteDaneben, oeffneAkte(anlageId, abschnitt?),
//   oeffneQuelle(id), ladeSeitenbild, rueckfrageTasten, oeffneWoher(knopf),
//   fallSuchen(), keineDavon(); dazu (nur App, additiv): oeffneBild(bild, knopf), toast(text, art),
//   onLage(lage) (SPEC 14.10: die Pille der Antwort hat sich beim Klicken im Fragebaum geändert).
// Ampel (SPEC 14.10, additiv): antwort.lage → Pille am Kopf, causes.items[].am_telefon →
//   grüne Karte, fragebaum.knoten[].antworten[].richtung → Punkt am Chip. Fehlt etwas
//   davon (älterer Server), sieht alles aus wie vorher.
// Fehlt etwas davon (Prüfseite, Einrichtung-Vorschau), zeigt der Renderer die
// ausführliche Fassung oder deaktiviert den Knopf – er wirft nie.
//
// Mit ctx.akteDaneben (App) stehen Steckbrief und Wiederholung links in der
// Akte und nicht im Chat; ohne (Prüfseite) erscheinen sie voll wie bisher.
//
// Grundsätze:
//   - Nie HTML aus Zeichenketten. Modell- und Servertext nur als Textknoten (dom.h).
//   - Ein unbekannter oder kaputter Block wird still übersprungen
//     (console.warn), nie die ganze Antwort.
//   - Keine Lookbehind-Regex, keine benannten Gruppen, kein ?. und kein ??.
//   - Netz zuerst, Bewegung parallel: Antworten im Fragebaum gehen im selben
//     Takt raus wie der Klick; abgewartet wird eine Animation nur mit Frist.
// ============================================================================
import { datum, datumKurz, h, leeren, typo, zahl } from "./dom.js";
import { ikon } from "./ikonen.js";
import { aufleuchten, einblenden, EASE, markeRgba, mitFrist, naechsterFrame, ruhig } from "./bewegung.js";

export { datum, leeren, typo, zahl };

// --- Feste Bezeichnungen -----------------------------------------------------

/** Rollen-Rang, überall gleich (SPEC 2): Server, Prompt und hier. */
export const ROLLEN_RANG = {
  kundenbetreuer: 1,
  standortleiter: 1,
  techniker: 2,
  meister: 3,
  ingenieur: 3,
};

export const ROLLEN_NAMEN = {
  kundenbetreuer: "Kundenbetreuer",
  standortleiter: "Standortleiter",
  techniker: "Techniker",
  meister: "Meister",
  ingenieur: "Ingenieur",
};

const LEVEL_NAMEN = { 1: "First Level", 2: "Second Level", 3: "Third Level" };

export const SYMPTOM_KATEGORIEN = {
  wp_druckverlust: "Druckverlust Wärmepumpe",
  wp_sonstige: "Wärmepumpe, sonstige Störung",
  ls_ausloesung: "LS-Auslösung",
  fi_ausloesung: "FI-Auslösung",
  wr_isolationsfehler: "Isolationsfehler Wechselrichter",
  ertrag_niedrig: "Ertrag zu niedrig",
  wallbox_laedt_nicht: "Wallbox lädt nicht",
  app_keine_daten: "App zeigt keine Daten",
  app_login: "App-Login",
  tarif_rechnung: "Tarif oder Rechnung",
};

/**
 * Kurznamen der Symptomkategorien (14.3.11): Kacheln im Einsatz und – wenn der
 * Text zu lang wäre – die Zeile im Verlauf der Akte. Gemeinsam für app.js und
 * abgeben.js, damit beide dasselbe Wort zeigen.
 */
export const KATEGORIE_KURZ = {
  wp_druckverlust: "Wärmepumpe: Druck fällt",
  wp_sonstige: "Wärmepumpe: anderes",
  ls_ausloesung: "Sicherung fliegt",
  fi_ausloesung: "FI fliegt",
  wr_isolationsfehler: "Wechselrichter: Isolationsfehler",
  ertrag_niedrig: "Zu wenig Ertrag",
  wallbox_laedt_nicht: "Wallbox lädt nicht",
  app_keine_daten: "App zeigt nichts",
  app_login: "Login geht nicht",
  tarif_rechnung: "Tarif oder Rechnung",
};

/**
 * Kurznamen der Ursachen (Gegenprüfung 09.10.): Auf einer Kachel steht
 * „Ausdehnungsgefäß“ statt „Vordruck Ausdehnungsgefäß zu niedrig oder Membran
 * defekt“; der lange Text bleibt als title und als Beschreibung im Ticket.
 */
export const URSACHE_KURZ = {
  ausdehnungsgefaess_vordruck: "Ausdehnungsgefäß",
  sicherheitsventil_undicht: "Sicherheitsventil",
  leckage_verschraubung: "Verschraubung oder Entlüfter",
  wallbox_auf_bestandsstromkreis: "Wallbox am alten Stromkreis",
  fehlerstrom_geraet: "Gerät mit Fehlerstrom",
  querschnitt_1_5mm2_fremdinstallation: "Leitung zu dünn",
  steckverbinder_feuchtigkeit: "Feuchter Steckverbinder",
  kabelschaden_tierverbiss: "Kabel angenagt",
  modul_defekt: "Modul defekt",
  wlan_zugangsdaten: "WLAN-Zugangsdaten",
  zaehlerkommunikation_unterbrochen: "Zähler sendet nicht",
  app_veraltet: "App veraltet",
  kontaktdaten_veraltet: "Kontaktdaten veraltet",
  passwort_vergessen: "Passwort vergessen",
  zweitzugang: "Zweiter Zugang",
  kein_defekt_ausrichtung: "Kein Defekt (Ausrichtung)",
  string_unterbrochen: "String unterbrochen",
  erdkabel_beschaedigt: "Erdkabel beschädigt",
  feuchtigkeit_aussensteckdose: "Feuchte Außensteckdose",
  rechnung_doppelt_versendet: "Rechnung doppelt",
  rechnung_korrektur: "Rechnung falsch",
  wartungstarif_frage: "Frage zum Wartungstarif",
  zustaendigkeit_netzbetreiber: "Sache des Netzbetreibers",
  fahrzeug_ladeplanung: "Ladeplanung im Auto",
  evu_sperrzeit: "Sperrzeit des Versorgers",
  kein_defekt_abtauen: "Kein Defekt (Abtauen)",
  sonstige: "Etwas anderes",
};

/**
 * Ursachen-Kategorien je Symptomkategorie für „Ursache dokumentieren“.
 * Der Server führt die verbindliche Liste und schickt sie im payload mit
 * (`ursache_optionen`) – dann gilt seine. Diese hier ist nur Rückfallebene,
 * mit denselben Schlüsseln wie im Seed (sonst zählt eine dokumentierte
 * Ursache nie in die Evidenz).
 */
export const URSACHEN = {
  wp_druckverlust: [
    ["ausdehnungsgefaess_vordruck", "Vordruck Ausdehnungsgefäß zu niedrig oder Membran defekt"],
    ["sicherheitsventil_undicht", "Sicherheitsventil undicht"],
    ["leckage_verschraubung", "Leckage an Verschraubung oder Schnellentlüfter"],
  ],
  ls_ausloesung: [
    ["wallbox_auf_bestandsstromkreis", "Wallbox auf Bestandsstromkreis"],
    ["fehlerstrom_geraet", "Fehlerstrom eines Geräts"],
    ["querschnitt_1_5mm2_fremdinstallation", "Querschnitt 1,5 mm² (Fremdinstallation)"],
  ],
  wr_isolationsfehler: [
    ["steckverbinder_feuchtigkeit", "Feuchtigkeit im Steckverbinder"],
    ["kabelschaden_tierverbiss", "Kabelschaden durch Tierverbiss"],
    ["modul_defekt", "Modul defekt"],
  ],
};

export const KOMPONENTEN = {
  waermepumpe: "Wärmepumpe",
  ausdehnungsgefaess: "Ausdehnungsgefäß",
  sicherheitsventil: "Sicherheitsventil",
  wallbox: "Wallbox",
  stromkreis: "Stromkreis",
  wechselrichter: "Wechselrichter",
  speicher: "Speicher",
  modulfeld: "Modulfeld",
  smartmeter: "Smartmeter",
};

/**
 * Hauptgeräte für die Akte (SPEC 14.3.3): Was ein Kunde am Telefon „seine
 * Anlage“ nennt. Ausdehnungsgefäß, Ventil, Stromkreis und Zähler stehen erst
 * hinter „Mehr zur Anlage“ – sie interessieren den Techniker, nicht den Anruf.
 */
export const HAUPTGERAETE = {
  waermepumpe: "Wärmepumpe",
  wallbox: "Wallbox",
  wechselrichter: "Wechselrichter",
  modulfeld: "Photovoltaik",
  speicher: "Speicher",
};

/** Symbol je Komponententyp (Akte, Steckbrief). */
export const KOMPONENTEN_IKON = {
  waermepumpe: "waermepumpe",
  ausdehnungsgefaess: "datenbank",
  sicherheitsventil: "schild",
  wallbox: "wallbox",
  stromkreis: "blitz",
  wechselrichter: "wechselrichter",
  speicher: "speicher",
  modulfeld: "modul",
  smartmeter: "app",
};

export const KANAELE = { app: "App", telefon: "Telefon", mail: "Mail" };
const KANAL_IKON = { app: "app", telefon: "telefon", mail: "mail" };
const STATUS = { offen: "offen", in_bearbeitung: "in Bearbeitung", geschlossen: "geschlossen" };
export const MASSNAHME_ART = {
  symptom: "nur Symptom",
  diagnose: "Diagnose",
  ursache_behoben: "Ursache behoben",
  sonstiges: "Sonstiges",
};

export const QUELLEN_ARTEN = {
  handbuch: "Handbuch",
  installationsanleitung: "Installationsanleitung",
  datenblatt: "Datenblatt",
  sop: "Ablauf",
  eskalationsmatrix: "Eskalationsmatrix",
  meister_notiz: "Meister-Notiz",
  ticket: "Ticket",
};

export const QUELLEN_IKON = {
  handbuch: "buch",
  installationsanleitung: "buch",
  datenblatt: "seite",
  sop: "seite",
  eskalationsmatrix: "seite",
  meister_notiz: "notiz",
  ticket: "ticket",
};

/** Bekannte Komponenten-Attribute: [Bezeichnung, Einheit]. */
const ATTRIBUTE = {
  vordruck_bar: ["Vordruck", "bar"],
  zuletzt_geprueft: ["Zuletzt geprüft"],
  ansprechdruck_bar: ["Ansprechdruck", "bar"],
  leistung_kw: ["Leistung", "kW"],
  leistung_kwp: ["Leistung", "kWp"],
  phasen: ["Phasen"],
  ladestrom_a: ["Ladestrom", "A"],
  eigener_stromkreis: ["Eigener Stromkreis"],
  ls: ["LS"],
  fi: ["FI"],
  fi_vorgeschaltet: ["FI vorgeschaltet"],
  pole: ["Pole"],
  querschnitt_mm2: ["Querschnitt", "mm²"],
  weitere_verbraucher: ["Weitere Verbraucher"],
  strings: ["Strings"],
  module: ["Module"],
  ausrichtung: ["Ausrichtung"],
  steckverbinder_gemischt: ["Steckverbinder gemischt"],
};

/**
 * Welche Attributwerte auffallen sollen: „Vordruck nicht erfasst“ bei A-1042
 * und „eigener Stromkreis: nein“ bei A-2177 – dort hängt die Geschichte der
 * Demo. Ein Fachmann soll sie sehen, bevor das Modell sie erwähnt.
 */
export function istAuffaellig(schluessel, wert) {
  if (wert === null || wert === undefined || wert === "") return true;
  if (schluessel === "eigener_stromkreis" && wert === false) return true;
  if (schluessel === "steckverbinder_gemischt" && wert === true) return true;
  return false;
}

/** Was eine Aktion mindestens an Rolle braucht (SPEC 7, `aktion`). */
const AKTION_ROLLE_MIN = { document_cause: "techniker", close_ticket: "techniker" };

/**
 * „weiß nicht“-artige Antworten stehen leiser da (14.3.6) und brauchen keinen
 * eigenen Knopf. Dasselbe Muster wie _shared/fragebaum.ts (WEISS_NICHT) –
 * beide gleich halten.
 */
const WEISS_NICHT = /^(wei(ß|ss) (ich )?nicht|unklar|keine ahnung|unsicher|nicht sicher|kann ich nicht sagen|unbekannt)/i;

// --- Kleine Werkzeuge --------------------------------------------------------

/**
 * Alter Elementbauer (Prüfseite, ältere Aufrufer): el(tag, attrs, kinder).
 * Läuft über dom.h – dieselben Schutzregeln, Kinder beliebig tief.
 */
export function el(tag, attrs, kinder) {
  return h(tag, attrs || null, kinder === undefined ? null : kinder);
}

export function anhaengen(knoten, kinder) {
  if (kinder === null || kinder === undefined) return knoten;
  const liste = Array.isArray(kinder) ? kinder.flat(Infinity) : [kinder];
  for (const k of liste) {
    if (k === null || k === undefined || k === false || k === true || k === "") continue;
    if (typeof k === "string" || typeof k === "number") knoten.appendChild(document.createTextNode(String(k)));
    else if (k && typeof k.nodeType === "number") knoten.appendChild(k);
  }
  return knoten;
}

/**
 * Markdown-Reste entfernen. Der Prompt verbietet `**` und `#`, aber ein
 * Modell hält sich daran nicht mit letzter Sicherheit. Bewusst KEIN Umwandeln
 * in <strong>: Formatierung kommt aus dem Blocktyp, nicht aus dem Text.
 * Ohne Lookbehind: (.*?[^\s]) fängt das letzte Zeichen mit ein.
 */
export function ohneMarkdown(text) {
  return String(text)
    .replace(/\*\*\*([\s\S]+?)\*\*\*/g, "$1")
    .replace(/\*\*([\s\S]+?)\*\*/g, "$1")
    .replace(/(^|[\s(])\*(?!\s)([^*\n]*?[^\s*])\*(?=[\s.,;:!?)]|$)/g, "$1$2")
    .replace(/(^|[\s(])__?(?!\s)([^_\n]*?[^\s_])__?(?=[\s.,;:!?)]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*[*+][ \t]+/gm, "– ");
}

/** Modell- oder Servertext für die Anzeige: erst Markdown weg, dann Typografie. */
function satz(text) {
  if (text === null || text === undefined) return "";
  return typo(ohneMarkdown(text));
}

/** Text in Absätze: Leerzeile trennt Absätze, einfacher Umbruch bleibt Umbruch. */
function absaetze(text, klasse) {
  const teile = satz(text).split(/\n\s*\n/);
  const ergebnis = [];
  for (const teil of teile) {
    const t = teil.trim();
    if (!t) continue;
    const p = h("p", { class: klasse || null });
    t.split("\n").forEach(function (z, i) {
      if (i > 0) p.appendChild(h("br"));
      p.appendChild(document.createTextNode(z));
    });
    ergebnis.push(p);
  }
  return ergebnis;
}

function tageText(n, dativ) {
  if (n === 1) return "1 Tag";
  return zahl(n) + " " + (dativ ? "Tagen" : "Tage");
}

function rang(rolle) {
  return ROLLEN_RANG[rolle] || 0;
}

function pille(text, art, titel, ikonName) {
  return h("span", { class: "pille pille-" + (art || "neutral"), title: titel || null },
    ikonName ? ikon(ikonName, { groesse: 13 }) : null, text);
}

function idListe(ids) {
  return (Array.isArray(ids) ? ids : []).map(String).filter(Boolean).join(" ");
}

let idNr = 0;
function neueId(praefix) {
  idNr += 1;
  return praefix + "-" + idNr;
}

function fokus(el) {
  if (!el) return;
  try {
    el.focus({ preventScroll: true });
  } catch (e) {
    el.focus();
  }
}

/** WAAPI ohne Abwarten; bei ruhig() gar nicht. */
function bewege(el, frames, dauer) {
  if (!el || ruhig() || typeof el.animate !== "function") return null;
  try {
    return el.animate(frames, { duration: dauer, easing: EASE });
  } catch (e) {
    return null;
  }
}

// --- Wurzel und Herkunft -----------------------------------------------------

/**
 * Blockwurzel: <article class="blk blk-<typ>" data-herkunft="…">. Das sichtbare
 * Herkunfts-Etikett entfällt (14.3.1) – die Herkunft bleibt für Tests,
 * Leuchten und das Blatt „Woher?“ im DOM.
 */
function wurzel(typ, herkunft, extraKlasse) {
  return h("article", {
    class: "blk blk-" + typ + (extraKlasse ? " " + extraKlasse : ""),
    "data-herkunft": herkunft,
  });
}

/** Feste Antwort ohne Modell (Abschluss, Auswahl, Trennung …)? */
function ohneModell(ctx) {
  return !!(ctx && ctx.pfad && ctx.pfad !== "modell");
}

/** Verstecktes Element mit Herkunft – der Block existiert, steht aber nicht im Chat. */
function versteckt(typ, herkunft, grund) {
  const e = wurzel(typ, herkunft, "blk-versteckt");
  e.hidden = true;
  if (grund) e.setAttribute("data-grund", grund);
  return e;
}

// --- Quellen -----------------------------------------------------------------

const DOKUMENT_WORT = /handbuch|anleitung|datenblatt|matrix|\bsop\b/i;

function istUnterlage(q) {
  return !!q && q.kind !== "meister_notiz" && q.kind !== "ticket";
}

/** Titel einer Unterlage ohne Seite – mit Dokumentart, wenn der Titel sie nicht nennt. */
function dokumentTitel(q) {
  const art = QUELLEN_ARTEN[q.kind] || "";
  let text = q.title ? satz(q.title).trim() : String(q.id || "");
  if (art && !DOKUMENT_WORT.test(text) && q.kind !== "sop") text = art + " " + text;
  return text;
}

/** „Birte Lorenzen, Wärmepumpe“ → „Lorenzen“. */
export function nachname(titel) {
  const wer = String(titel || "").split(",")[0].trim();
  const teile = wer.split(/\s+/);
  return teile.length ? teile[teile.length - 1] : wer;
}

export function quellenText(q) {
  const art = QUELLEN_ARTEN[q.kind] || "";
  const titel = q.title ? satz(q.title).trim() : "";
  const id = q.id ? String(q.id) : "";
  if (q.kind === "meister_notiz") return "Meister-Notiz " + id + (titel ? " – " + titel : "");
  if (q.kind === "ticket") {
    // Der Server betitelt Tickets „Ticket vom 02.09.2026“ – daraus „Ticket T-2026-0812 vom 02.09.2026“.
    const vom = /^Ticket vom\s+/i.test(titel) ? titel.replace(/^Ticket\s+/i, "") : null;
    return "Ticket " + id + (vom ? " " + vom : titel && titel !== id ? " – " + titel : "");
  }
  const text = dokumentTitel(q);
  return typeof q.page === "number" ? text + ", S. " + q.page : (art && !text ? art : text);
}

/**
 * Quellen gleicher Unterlage zusammenfassen: [{q, seiten:[{page, id}], ids}].
 * Eine Unterlage = ein Eintrag mit allen Seiten; jede Seitenzahl bleibt einzeln
 * anklickbar (SPEC 12.6), denn jede Seite ist ein eigenes Q.
 */
export function gruppiereQuellen(liste) {
  const gruppen = [];
  const nachTitel = new Map();
  for (const q of liste) {
    if (!q) continue;
    if (!istUnterlage(q) || !q.title) {
      gruppen.push({ q: q, seiten: typeof q.page === "number" ? [{ page: q.page, id: String(q.id || "") }] : [], ids: [String(q.id || "")] });
      continue;
    }
    const schluessel = q.kind + "|" + q.title;
    let g = nachTitel.get(schluessel);
    if (!g) {
      g = { q: q, seiten: [], ids: [] };
      nachTitel.set(schluessel, g);
      gruppen.push(g);
    }
    if (typeof q.page === "number" && !g.seiten.some(function (s) { return s.page === q.page; })) {
      g.seiten.push({ page: q.page, id: String(q.id || "") });
    }
    g.ids.push(String(q.id || ""));
  }
  gruppen.forEach(function (g) {
    g.seiten.sort(function (a, b) { return a.page - b.page; });
  });
  return gruppen;
}

/**
 * Kurzname einer Quellen-Gruppe für die eine Zeile unter einer Antwort
 * (SPEC 14.3.9): „Notiz Lorenzen“, „Vaillant S. 25, 39, 41“, „Ticket 02.09.“,
 * „Ähnlicher Fall“, „Ablauf“, „Eskalation“.
 */
export function quelleKurz(g) {
  const q = g.q || {};
  const titel = String(q.title || "").trim();
  if (q.kind === "meister_notiz") return "Notiz " + nachname(titel || q.id);
  if (q.kind === "ticket") {
    const m = /^Ticket vom\s+(\d{2})\.(\d{2})\./i.exec(titel);
    return m ? "Ticket " + m[1] + "." + m[2] + "." : "Ähnlicher Fall";
  }
  if (q.kind === "sop") return "Ablauf";
  if (q.kind === "eskalationsmatrix") return "Eskalation";
  const wort = titel.split(/\s+/)[0] || String(q.id || "");
  const seiten = g.seiten.map(function (s) { return s.page; });
  return seiten.length ? wort + " S. " + seiten.join(", ") : wort;
}

/**
 * Kurznamen für die eine Quellenzeile, gleiche zusammengelegt: Zwei Notizen
 * derselben Meisterin hießen sonst zweimal „Notiz Lorenzen“ – das sieht wie
 * ein Fehler aus und ist doppelter Text. Daraus wird „Notizen Lorenzen“
 * (bzw. „Ähnliche Fälle“); die einzelnen Quellen stehen im Blatt „Woher?“.
 */
export function kurznamenOhneDoppel(gruppen) {
  const liste = [];
  gruppen.forEach(function (g) {
    const k = quelleKurz(g);
    const da = liste.filter(function (x) { return x.k === k; })[0];
    if (da) da.n += 1;
    else liste.push({ k: k, n: 1 });
  });
  return liste.map(function (x) {
    if (x.n < 2) return x.k;
    if (x.k.indexOf("Notiz ") === 0) return "Notizen " + x.k.slice(6);
    if (x.k === "Ähnlicher Fall") return "Ähnliche Fälle";
    return x.k;
  });
}

/** Knopf oder Text, je nachdem, ob die App Quellen öffnen kann. */
function quellenZiel(ctx, id, klasse, titel, kinder) {
  const kannOeffnen = ctx && typeof ctx.oeffneQuelle === "function";
  if (!kannOeffnen) return h("span", { class: klasse, "data-quelle": id, title: titel || null }, kinder);
  return h("button", {
    type: "button",
    class: klasse,
    "data-quelle": id,
    title: titel || null,
    onclick: function (e) {
      e.stopPropagation();
      ctx.oeffneQuelle(id);
    },
  }, kinder);
}

// --- text --------------------------------------------------------------------

/** Fester Rollensatz des Validators (5.3 Punkt 2) – auch ohne `art` erkennen (alte Ströme). */
const ROLLENSATZ = /^Dieser Schritt ist für Fachkräfte ab Rolle/;

function blockText(b, ctx) {
  const herkunft = ohneModell(ctx) ? "system" : "assistent";
  const inhalt = String(b.content || "");
  // Ersatztext der Auswahl ist nur für die alte Oberfläche da (14.2.2).
  if (b.art === "auswahl_ersatz") return versteckt("text", herkunft, "auswahl_ersatz");
  const rollenhinweis = b.art === "rollenhinweis" || ROLLENSATZ.test(inhalt);
  if (rollenhinweis) {
    // Mit Übergabe-Karte sagt „Für den Techniker · Alles ist vorbereitet.“ dasselbe.
    if (ctx.mitUebergabe) return versteckt("text", herkunft, "rollenhinweis");
    const box = wurzel("text", herkunft, "blk-text-leise");
    box.appendChild(h("p", { class: "antwort-leise" }, ikon("schild", { groesse: 14 }), h("span", { text: satz(inhalt) })));
    return box;
  }
  const box = wurzel("text", herkunft);
  if (Array.isArray(b.source_ids) && b.source_ids.length) box.setAttribute("data-quellen", idListe(b.source_ids));
  box.setAttribute("data-zitat-titel", "Einschätzung");
  absaetze(inhalt, "antwort-text").forEach(function (p) { box.appendChild(p); });
  return box;
}

// --- warning -------------------------------------------------------------------

const WARN_STUFEN = {
  stop: { name: "Stopp", herkunft: "regel-stopp", ikon: "stopp" },
  caution: { name: "Achtung", herkunft: "regel-achtung", ikon: "achtung" },
  info: { name: "Hinweis", herkunft: "regel-hinweis", ikon: "info" },
};

/** „Stattdessen: …“ für den ersten Blick: bis zum ersten „:“ oder „.“, höchstens 12 Wörter. */
function stattKurz(alternative) {
  const roh = String(alternative || "").trim();
  if (!roh) return "";
  const anfang = roh.split(/[:.]/)[0].trim();
  if (!anfang) return "";
  return anfang.split(/\s+/).length <= 12 ? anfang : "";
}

function regelZeile(b, lang) {
  const teile = [];
  if (b.norm_ref) teile.push(satz(b.norm_ref));
  if (b.rule_id) teile.push("Regel " + b.rule_id);
  if (b.entwurf) teile.push(lang ? "Entwurf, fachlich noch nicht freigegeben" : "Entwurf");
  return teile.join(" · ");
}

function belegZeile(b) {
  if (!b.beleg) return null;
  // Daten-Trigger (R09, R10) belegen aus den Anlagendaten („A-1042: …“), nicht
  // aus der Frage – sonst zitierte die Karte einen Satz, den niemand sagte.
  const ausDaten = /^A-\d{4}: /.test(String(b.beleg));
  return h("p", { class: "mehr-beleg", text: ausDaten ? "Aus der Akte: " + String(b.beleg) : "Erkannt: „" + String(b.beleg) + "“" });
}

/**
 * Stopp: nicht einklappbar, Symbol UND Wort, nie in Markenfarbe, einmal
 * aufleuchten. Die Box stammt aus der Regel-Engine des Servers, nicht aus der
 * Tagesform des Modells. Begründung, Norm, Regel und Beleg hinter „Warum?“.
 */
function blockStopp(b, ctx) {
  const mitRegel = !!b.rule_id;
  const herkunft = mitRegel ? "regel-stopp" : ohneModell(ctx) ? "akte" : "assistent";
  const titel = satz(b.title || "Stopp");
  const box = wurzel("warning", herkunft, "blk-stufe-stop w-stopp");
  box.setAttribute("role", "alert");
  box.setAttribute("aria-label", "Stopp: " + titel);
  if (b.rule_id) box.setAttribute("data-regel", String(b.rule_id));
  const kurz = stattKurz(b.alternative);
  const mehr = h("details", { class: "mehr" },
    h("summary", null, h("span", { text: "Warum?" }), ikon("runter", { groesse: 14, klasse: "mehr-pfeil" })),
    h("div", { class: "mehr-inhalt" },
      absaetze(b.content || ""),
      b.alternative ? h("p", { text: "Stattdessen: " + satz(b.alternative) }) : null,
      regelZeile(b, true) ? h("p", { class: "mehr-regel", text: regelZeile(b, true) }) : null,
      belegZeile(b)));
  box.appendChild(h("div", { class: "stopp-kopf" },
    h("span", { class: "warn-symbol", "aria-hidden": "true" }, ikon("stopp", { groesse: 20, strich: 2 })),
    h("div", { class: "stopp-text" },
      h("span", { class: "warn-stufe", text: "Stopp" }),
      h("h3", { class: "warn-titel", text: titel }),
      kurz ? h("p", { class: "stopp-statt", text: "Stattdessen: " + satz(kurz) + "." }) : null,
      mehr)));
  naechsterFrame(function () {
    if (box.isConnected) aufleuchten(box, "rgba(180,35,24,.28)");
  });
  return box;
}

/**
 * Achtung und Hinweis: eine Zeile in der Fläche der Stufe – Symbol und Titel,
 * darunter `kurz` (14.2.3, z. B. „Kam zuletzt nach 14 Tagen zurück.“), rechts
 * „Mehr“ mit Begründung, „Stattdessen“ und Regel.
 */
function blockWarnZeile(b, ctx, stufe) {
  const art = WARN_STUFEN[stufe];
  const mitRegel = !!b.rule_id;
  const herkunft = mitRegel ? art.herkunft : ohneModell(ctx) ? "akte" : "assistent";
  const titel = satz(b.title || art.name);
  const box = wurzel("warning", herkunft, "blk-stufe-" + stufe + " w-zeile");
  box.setAttribute("role", "note");
  box.setAttribute("aria-label", art.name + ": " + titel);
  if (b.rule_id) box.setAttribute("data-regel", String(b.rule_id));
  const mehrWort = h("span", { class: "warn-mehr", text: "Mehr" });
  const regel = regelZeile(b, false);
  const inhalt = [
    absaetze(b.content || ""),
    b.alternative ? h("p", { text: "Stattdessen: " + satz(b.alternative) }) : null,
    regel ? h("p", { class: "mehr-regel", text: regel }) : null,
    belegZeile(b),
  ];
  const leer = !b.content && !b.alternative && !regel;
  const kopf = [
    h("span", { class: "warn-symbol", "aria-hidden": "true" }, ikon(art.ikon, { groesse: 18, strich: 2 })),
    h("span", { class: "warn-zeile-text" },
      h("strong", { class: "warn-titel", text: titel }),
      b.kurz ? h("span", { class: "warn-kurz", text: satz(b.kurz) }) : null),
  ];
  if (leer) {
    box.appendChild(h("div", { class: "warn-zeile" }, kopf));
    return box;
  }
  const details = h("details", { class: "warn-details" },
    h("summary", { class: "warn-zeile" }, kopf, mehrWort),
    h("div", { class: "mehr-inhalt" }, inhalt));
  details.addEventListener("toggle", function () {
    mehrWort.textContent = details.open ? "Weniger" : "Mehr";
  });
  box.appendChild(details);
  return box;
}

function blockWarnung(b, ctx) {
  const stufe = WARN_STUFEN[b.level] ? b.level : "info";
  // Regel-Hinweise, die schon in „Wichtig“ stehen oder in diesem Fall schon
  // einmal im Chat standen (ctx.ausblendenRegeln, von app.js), nicht noch
  // einmal als Karte – Gegenprüfung 09.10.: „Kommt immer wieder“ stand sonst
  // dreimal auf einem Bildschirm. Eine Stopp-Box wird nie ausgeblendet.
  if (stufe !== "stop" && b.rule_id && Array.isArray(ctx.ausblendenRegeln) && ctx.ausblendenRegeln.indexOf(String(b.rule_id)) !== -1) {
    const v = versteckt("warning", WARN_STUFEN[stufe].herkunft, "wichtig");
    v.setAttribute("data-regel", String(b.rule_id));
    return v;
  }
  return stufe === "stop" ? blockStopp(b, ctx) : blockWarnZeile(b, ctx, stufe);
}

// --- system_card (voll nur ohne Akte daneben) ------------------------------------

function attributText(schluessel, wert) {
  const def = ATTRIBUTE[schluessel];
  let bezeichnung;
  let einheit = def ? def[1] : null;
  if (def) bezeichnung = def[0];
  else {
    const m = /^(.*)_(bar|kw|kwp|kwh|a|v|mm2)$/.exec(schluessel);
    const basis = m ? m[1] : schluessel;
    if (m) einheit = { bar: "bar", kw: "kW", kwp: "kWp", kwh: "kWh", a: "A", v: "V", mm2: "mm²" }[m[2]];
    bezeichnung = basis.replace(/_/g, " ");
    bezeichnung = bezeichnung.charAt(0).toUpperCase() + bezeichnung.slice(1);
  }
  let wertText;
  if (wert === null || wert === undefined || wert === "") wertText = "nicht erfasst";
  else if (typeof wert === "boolean") wertText = wert ? "ja" : "nein";
  else if (typeof wert === "number") wertText = einheit ? zahl(wert) + " " + einheit : zahl(wert);
  else if (Array.isArray(wert)) wertText = wert.map(String).join(", ") || "keine";
  else if (typeof wert === "object") wertText = JSON.stringify(wert);
  else if (/^\d{4}-\d{2}-\d{2}/.test(String(wert))) wertText = datum(wert);
  else wertText = typo(String(wert));
  return { bezeichnung: bezeichnung, wert: wertText };
}

/** Attribute einer Komponente als kleine Marken (auffällige in Achtung-Farbe). */
export function attributMarken(attrs) {
  const a = attrs && typeof attrs === "object" ? attrs : {};
  const schluessel = Object.keys(a);
  if (!schluessel.length) return null;
  return h("ul", { class: "attr-marken" }, schluessel.map(function (s) {
    const t = attributText(s, a[s]);
    return h("li", { class: "attr-marke" + (istAuffaellig(s, a[s]) ? " attr-auffaellig" : "") },
      h("span", { class: "attr-name", text: t.bezeichnung + ": " }), h("strong", { text: t.wert }));
  }));
}

function statusPille(status, geschlossenAm) {
  if (!status) return null;
  if (status === "geschlossen") return pille(geschlossenAm ? "zu " + datumKurz(geschlossenAm) : "geschlossen", "neutral");
  return pille(STATUS[status] || status, "achtung");
}

/**
 * system_card. In der App steht die Akte links daneben – dort steht der
 * Steckbrief nicht im Chat (14.3.5). Auf der Prüfseite der volle Steckbrief.
 */
function blockSteckbrief(b, ctx) {
  if (ctx.akteDaneben) {
    const v = versteckt("system_card", "akte", "akte_links");
    v.setAttribute("data-anlage", String(b.anlage_id || ""));
    return v;
  }
  const a = b.anlage || {};
  const id = b.anlage_id || a.id || "";
  const komponenten = Array.isArray(a.komponenten) ? a.komponenten : [];
  const ort = [a.strasse ? a.strasse + (a.hausnummer ? " " + a.hausnummer : "") + "," : null, a.plz, a.ort].filter(Boolean).join(" ");
  const box = wurzel("system_card", "akte", "blk-steckbrief karte-e");
  box.appendChild(h("div", { class: "steckbrief-kopf" },
    h("span", { class: "steckbrief-id mono", text: id }),
    h("div", null,
      h("h3", { class: "steckbrief-name", text: a.kunde_alias || "Anlage " + id }),
      h("p", { class: "steckbrief-unter", text: [ort, a.inbetriebnahme ? "IBN " + datum(a.inbetriebnahme) : null, a.montage_team].filter(Boolean).join(" · ") }))));
  const mitGarantie = komponenten.some(function (k) { return k && k.garantie_bis; });
  const fakten = h("dl", { class: "eigenschaften eigenschaften-kompakt" });
  const fakt = function (dt, dd) {
    fakten.appendChild(h("div", { class: "eigenschaft" }, h("dt", { text: dt }), h("dd", { text: dd || "–" })));
  };
  fakt("Inbetriebnahme", datum(a.inbetriebnahme));
  fakt("Montage-Team", a.montage_team);
  fakt("Standort", a.standort);
  if (komponenten.length && !mitGarantie) fakt("Garantie", "nicht hinterlegt");
  box.appendChild(fakten);
  if (komponenten.length) {
    box.appendChild(h("ul", { class: "komponenten-liste" }, komponenten.map(function (k) {
      const typ = KOMPONENTEN[k.typ] || k.typ || "Komponente";
      const fremd = k.installiert_von && k.installiert_von !== "eigenes Team";
      return h("li", { class: "komponente" },
        h("span", { class: "komponente-symbol", "aria-hidden": "true" }, ikon(KOMPONENTEN_IKON[k.typ] || "werkzeug", { groesse: 16 })),
        h("div", { class: "komponente-text" },
          h("p", { class: "komponente-name" }, h("strong", { text: typ }), fremd ? pille(k.installiert_von, "achtung") : null),
          h("p", { class: "komponente-modell", text: [k.bezeichnung && k.bezeichnung !== typ ? k.bezeichnung : null, [k.hersteller, k.modell].filter(Boolean).join(" ")].filter(Boolean).join(" · ") }),
          k.seriennummer ? h("p", { class: "komponente-sn mono", text: k.seriennummer }) : null,
          attributMarken(k.attribute)));
    })));
  }
  const tickets = Array.isArray(a.letzte_tickets) ? a.letzte_tickets.slice(0, 3) : [];
  if (tickets.length) {
    box.appendChild(h("h4", { class: "blk-zwischentitel", text: "Letzte Tickets" }));
    box.appendChild(h("ul", { class: "ticket-zeilen" }, tickets.map(function (t) {
      return h("li", null,
        h("span", { class: "ticket-datum", text: datum(t.erstellt_am) }),
        h("span", { class: "mono ticket-id", text: t.id }),
        h("span", { class: "ticket-symptom", text: satz(t.symptom) }),
        statusPille(t.status));
    })));
  }
  return box;
}

/**
 * recurrence_alert mit Zeitleiste. Jede Zahl hier stammt aus SQL
 * (ticket_count, window_days, rueckkehr_tage) – das Modell liefert keine.
 * In der App steht die Wiederholung in „Wichtig“ und in der Akte (derselbe
 * Renderer ohne akteDaneben, „Mehr zur Anlage“); im Chat nicht.
 */
function blockAlarm(b, ctx) {
  if (ctx.akteDaneben) {
    const v = versteckt("recurrence_alert", "akte", "wichtig");
    if (Array.isArray(b.source_ids) && b.source_ids.length) v.setAttribute("data-quellen", idListe(b.source_ids));
    return v;
  }
  const kategorie = SYMPTOM_KATEGORIEN[b.symptom_kategorie] || b.symptom_kategorie || "";
  const box = wurzel("recurrence_alert", "akte", "karte-e");
  if (Array.isArray(b.source_ids) && b.source_ids.length) {
    box.setAttribute("data-quellen", idListe(b.source_ids));
    box.setAttribute("data-zitat-titel", "Wiederkehrender Fall · " + (b.anlage_id || ""));
  }
  const tickets = Array.isArray(b.tickets) ? b.tickets : [];
  const rueckkehr = Array.isArray(b.rueckkehr_tage) ? b.rueckkehr_tage : [];

  const kennzahl = h("p", { class: "alarm-kennzahl" });
  if (typeof b.ticket_count === "number") {
    kennzahl.appendChild(h("strong", { text: zahl(b.ticket_count) + " Tickets" }));
    if (typeof b.window_days === "number") {
      kennzahl.appendChild(document.createTextNode(b.window_days === 0 ? " am selben Tag" : " in "));
      if (b.window_days !== 0) kennzahl.appendChild(h("strong", { text: tageText(b.window_days, true).replace(" ", " ") }));
    }
  }
  if (rueckkehr.length) {
    kennzahl.appendChild(document.createTextNode(" · zurück nach "));
    rueckkehr.forEach(function (t, i) {
      if (i > 0) kennzahl.appendChild(document.createTextNode(i === rueckkehr.length - 1 ? " und " : ", "));
      kennzahl.appendChild(h("strong", { text: tageText(t, true).replace(" ", " ") }));
    });
  }
  box.appendChild(h("div", { class: "alarm-kopf" },
    h("span", { class: "alarm-symbol", "aria-hidden": "true" }, ikon("wiederholung", { groesse: 18 })),
    h("div", null, kennzahl,
      h("p", { class: "alarm-unter", text: [b.anlage_id, kategorie, b.cause_verified === false ? "Ursache nicht bestätigt" : null].filter(Boolean).join(" · ") }))));

  if (tickets.length) {
    const zl = h("ol", { class: "zeitleiste" });
    tickets.forEach(function (t, i) {
      if (i > 0 && typeof rueckkehr[i - 1] === "number") {
        zl.appendChild(h("li", { class: "zl-rueckkehr" }, ikon("wiederholung", { groesse: 13 }), "zurück nach " + tageText(rueckkehr[i - 1], true)));
      }
      const massnahmen = Array.isArray(t.massnahmen) ? t.massnahmen : [];
      zl.appendChild(h("li", { class: "zl-ticket" + (t.status === "geschlossen" ? "" : " ist-offen") },
        h("div", { class: "zl-kopf" },
          h("strong", { class: "zl-datum", text: datumKurz(t.erstellt_am) }),
          t.kanal ? h("span", { class: "zl-kanal" }, ikon(KANAL_IKON[t.kanal] || "telefon", { groesse: 13 }), KANAELE[t.kanal] || t.kanal) : null,
          h("span", { class: "zl-id mono", text: t.id }),
          statusPille(t.status, t.geschlossen_am)),
        t.symptom ? h("p", { class: "zl-symptom", text: "„" + satz(t.symptom) + "“" }) : null,
        massnahmen.length
          ? h("ul", { class: "zl-massnahmen" }, massnahmen.map(function (m) {
            const wer = [m.von, m.vor_ort ? "vor Ort" : null].filter(Boolean).join(", ");
            return h("li", { class: "zl-massnahme" },
              ikon("werkzeug", { groesse: 13 }),
              h("span", null,
                h("strong", { text: datumKurz(m.datum) + (wer ? " " + wer : "") + ": " }),
                satz(m.text)),
              m.art ? pille(MASSNAHME_ART[m.art] || m.art, m.art === "symptom" ? "achtung" : "neutral") : null);
          }))
          : h("p", { class: "zl-leer", text: t.status === "geschlossen" ? "Keine Maßnahme erfasst." : "Noch keine Maßnahme." })));
    });
    box.appendChild(zl);
  } else if (Array.isArray(b.previous_actions) && b.previous_actions.length) {
    box.appendChild(h("h4", { class: "blk-zwischentitel", text: "Bisherige Maßnahmen" }));
    box.appendChild(h("ul", { class: "liste" }, b.previous_actions.map(function (p) { return h("li", { text: satz(p) }); })));
  }
  if (b.hypothesis) box.appendChild(h("p", { class: "alarm-hypothese" }, satz(b.hypothesis)));
  return box;
}

// --- Ampel (SPEC 14.10) -----------------------------------------------------------
// Vincent 12.10.: „Der Kundenbetreuer soll wirklich in grünen Boxen Lösungen
// bekommen, die er direkt am Telefon mitteilen kann“ und „mehr mit einfachen
// Farbmerkmalen spielen: richtiger Pfad vs. schlechter oder unklarer“.
// Eine Bedeutung je Farbe (14.10.1): grün = am Telefon lösbar / auf gutem Weg,
// gelb = schlechter oder unklarer, rot = nur die Stopp-Regel, grau = wird
// eingegrenzt. Die Farbe setzt der Server (antwort.lage, am_telefon,
// richtung); hier wird sie nur gezeigt – und im Zweifel weggelassen: lieber
// eine grüne Box zu wenig als eine falsche. Farbe nie allein (Punkt + Wort).

/** Je höher, desto schlechter. Grau heißt „noch keine Aussage“ und deckelt nichts. */
const AMPEL_RANG = { gruen: 1, grau: 2, gelb: 3, rot: 4 };
const RICHTUNG_LAGE = {
  gut: { farbe: "gruen", text: "Auf gutem Weg" },
  schlecht: { farbe: "gelb", text: "Eher Techniker" },
  offen: { farbe: "grau", text: "Wird eingegrenzt" },
};

function istStopp(b) {
  return !!(b && b.type === "warning" && b.level === "stop");
}

function ganzeZahl(n) {
  return typeof n === "number" && isFinite(n) && Math.floor(n) === n && n >= 0;
}

/** Anführungszeichen, die das Modell selbst gesetzt hat, weg – die Karte setzt „…“. */
function ohneRandZeichen(t) {
  return String(t).trim().replace(/^[„“”"»«‚‘’']+/, "").replace(/[„“”"»«‚‘’']+$/, "").trim();
}

/**
 * Grüne Lösung (14.10.3/14.10.5): nur mit Satz und mindestens einer Quelle –
 * der Server prüft das ausführlich, hier nur die Form. belegt nur, wenn die
 * Zahlen zusammenpassen (sie kommen aus SQL; passen sie nicht, keine Zeile).
 */
export function telefonVon(u) {
  const t = u && u.am_telefon && typeof u.am_telefon === "object" ? u.am_telefon : null;
  if (!t || typeof t.satz !== "string") return null;
  const text = ohneRandZeichen(ohneMarkdown(t.satz)).replace(/\s+/g, " ");
  if (!text || text.length > 400) return null;
  if (!Array.isArray(u.source_ids) || !u.source_ids.length) return null;
  const b = t.belegt && typeof t.belegt === "object" ? t.belegt : null;
  const belegt = b && ganzeZahl(b.faelle) && ganzeZahl(b.ohne_einsatz) && b.faelle >= 1 && b.ohne_einsatz >= 1 && b.ohne_einsatz <= b.faelle
    ? { faelle: b.faelle, ohne_einsatz: b.ohne_einsatz }
    : null;
  // Die Karte setzt „…“ – Anführungen im Satz werden deshalb zu ‚…‘ (deutsche Typografie).
  return { satz: typo(text).replace(/„/g, "‚").replace(/“/g, "‘"), belegt: belegt };
}

/** Gibt es in der Antwort eine Lösung, die grün gezeigt wird? (Nie bei Stopp.) */
function hatGrueneLoesung(antwort) {
  const bloecke = antwort && Array.isArray(antwort.blocks) ? antwort.blocks : [];
  if (bloecke.some(istStopp)) return false;
  return bloecke.some(function (b) {
    return b && b.type === "causes" && Array.isArray(b.items) && b.items.some(function (u) { return !!telefonVon(u); });
  });
}

/**
 * Lage einer Antwort (antwort.lage, 14.10.4) für die Anzeige – oder null.
 * Ohne lage (älterer Server) keine Pille: Die Oberfläche erfindet keine Farbe.
 * Absicherungen: Stopp-Box → immer rot „Stopp“; rot ohne Stopp-Box → gelb;
 * grün ohne grüne Lösung → keine Pille.
 */
export function lageVon(antwort) {
  if (!antwort || typeof antwort !== "object") return null;
  const l = antwort.lage;
  if (!l || typeof l !== "object" || !AMPEL_RANG[l.farbe] || typeof l.text !== "string") return null;
  const text = ohneMarkdown(l.text).trim();
  if (!text || text.length > 40) return null;
  const bloecke = Array.isArray(antwort.blocks) ? antwort.blocks : [];
  if (bloecke.some(istStopp)) return l.farbe === "rot" ? { farbe: "rot", text: typo(text) } : { farbe: "rot", text: "Stopp" };
  if (l.farbe === "rot") return { farbe: "gelb", text: "Achtung" };
  if (l.farbe === "gruen" && !hatGrueneLoesung(antwort)) return null;
  return { farbe: l.farbe, text: typo(text) };
}

/**
 * Lage aus dem Pfad des Fragebaums (14.10.5): irgendein „schlecht“ → gelb
 * „Eher Techniker“, sonst irgendein „gut“ → grün „Auf gutem Weg“, sonst grau.
 * Ohne beantwortete Frage: null (die Pille zeigt dann die Lage des Servers).
 */
export function pfadLage(pfad) {
  const liste = Array.isArray(pfad) ? pfad : [];
  if (!liste.length) return null;
  if (liste.some(function (p) { return p && p.richtung === "schlecht"; })) return RICHTUNG_LAGE.schlecht;
  if (liste.some(function (p) { return p && p.richtung === "gut"; })) return RICHTUNG_LAGE.gut;
  return RICHTUNG_LAGE.offen;
}

/**
 * Was die Pille zeigt, wenn Server und Pfad etwas sagen: nie besser als der
 * Server – sagt er gelb oder rot, bleibt es dabei (bei Gleichstand gilt sein
 * Wort). Grau heißt auf beiden Seiten „noch keine Aussage“ und deckelt nichts:
 * Sonst bliebe ein Fragebaum (Server: grau) für immer grau.
 */
export function lageKombiniert(server, pfad) {
  if (!pfad || pfad.farbe === "grau") return server || pfad || null;
  if (!server || server.farbe === "grau") return pfad;
  return AMPEL_RANG[server.farbe] >= AMPEL_RANG[pfad.farbe] ? server : pfad;
}

/** Richtung einer Fragebaum-Antwort: fehlt/ungültig/„weiß nicht“ → offen (14.10.3). */
function richtungVon(a) {
  const r = a && typeof a.richtung === "string" ? a.richtung : "";
  if (WEISS_NICHT.test(String(a && a.label || ""))) return "offen";
  return r === "gut" || r === "schlecht" ? r : "offen";
}

/** Pille „● Wort“. lage = {farbe, text}. */
export function lagePille(lage, extraKlasse) {
  const el = h("p", { class: "lage" + (extraKlasse ? " " + extraKlasse : "") },
    h("span", { class: "lage-punkt", "aria-hidden": "true" }),
    h("span", { class: "sr-only", text: "Lage: " }),
    h("span", { class: "lage-text" }));
  lageSetzen(el, lage);
  return el;
}

/** Pille an Ort und Stelle umfärben (die Farbe gleitet, das Element bleibt). null → versteckt. */
export function lageSetzen(el, lage) {
  if (!el) return;
  ["gruen", "gelb", "rot", "grau"].forEach(function (f) { el.classList.remove("lage-" + f); });
  if (!lage) {
    el.hidden = true;
    el.removeAttribute("data-lage");
    return;
  }
  el.classList.add("lage-" + lage.farbe);
  el.setAttribute("data-lage", lage.farbe);
  const t = el.querySelector(".lage-text");
  if (t && t.textContent !== lage.text) t.textContent = lage.text;
  el.hidden = false;
}

// --- Fragebaum (14.3.6) -----------------------------------------------------------

/** Nachricht im Format von SPEC 8: „{label}: {antwort} · …“ (kein Doppelpunkt nach ?, ., !, :). */
export function nachrichtAusAntworten(items, antworten) {
  const teile = [];
  items.forEach(function (it, i) {
    const a = antworten[i];
    if (a === undefined || a === null || a === "") return;
    const label = String(it.label || it.id || "Antwort").trim();
    teile.push(/[?.!:]$/.test(label) ? label + " " + a : label + ": " + a);
  });
  return teile.join(" · ");
}

/**
 * Eine Frage im Fokus, Antwortknöpfe, beantwortete Fragen als Chips mit
 * „Ändern“. Der Baum liegt vollständig vor: Die nächste Frage gleitet ohne
 * Anfrage und ohne Warten herein. Bei „fertig“ geht die Zusammenfassung über
 * ctx.onAntworten raus – im selben Takt wie der Klick – und die Karte blendet
 * aus (die Antworten stehen dann in der Nutzer-Blase).
 *
 * baum = { start, knoten: {id → {id, kurz, frage, antworten:[{label, weiter}], freitext_weiter}},
 *          zusammenfassen(pfad) → Text }
 * Kein „Frage n von m“ – die Länge ist adaptiv; nur dezente Punkte.
 */
function baumKarte(typ, baum, ctx) {
  const karte = wurzel(typ, "assistent", "karte-e baum");
  karte.setAttribute("data-zitat-titel", "Rückfragen");
  const chips = h("div", { class: "baum-chips", role: "list", "aria-label": "Beantwortet" });
  // aria-live auf der Bühne (14.3.6): Die neue Frage wird vorgelesen; der Fokus
  // springt nach jeder Antwort auf die erste Antwort (Gruppe trägt die Frage als Namen).
  const buehne = h("div", { class: "baum-buehne", "aria-live": "polite" });
  const punkte = h("div", { class: "baum-punkte", "aria-hidden": "true" });
  const meldung = h("p", { class: "baum-meldung", role: "status" });
  karte.appendChild(chips);
  karte.appendChild(buehne);
  karte.appendChild(punkte);
  karte.appendChild(meldung);

  let pfad = []; // [{id, label}]
  let aktuell = baum.start;
  let gesendet = false;
  let knoepfe = [];

  function kurzVon(id) {
    const k = baum.knoten[id];
    return k ? String(k.kurz || "").trim() : "";
  }

  /**
   * Ampel im Pfad (14.10.5): Jede gewählte Antwort bekommt am Chip einen Punkt
   * in ihrer Richtung (gut grün, schlecht gelb, offen ohne); die Pille der
   * Antwort folgt live (ctx.lagePfad, renderAntwort). Die Knöpfe davor bleiben
   * neutral – kein Vorsagen.
   */
  function lageMelden() {
    if (typeof ctx.lagePfad === "function") ctx.lagePfad(pfadLage(pfad));
  }

  function chipsZeigen(neuIndex) {
    leeren(chips);
    pfad.forEach(function (p, i) {
      const k = baum.knoten[p.id] || {};
      const kurz = kurzVon(p.id);
      const r = p.richtung === "gut" || p.richtung === "schlecht" ? p.richtung : "";
      const chip = h("span", { class: "antwort-chip" + (r ? " ist-" + r : ""), role: "listitem", title: satz(k.frage || ""), "data-richtung": p.richtung || "offen" },
        r ? h("span", { class: "antwort-chip-punkt", "aria-hidden": "true" }) : null,
        h("span", { class: "antwort-chip-text" }, kurz ? satz(kurz) + ": " : null, h("strong", { text: typo(p.label) }),
          r ? h("span", { class: "sr-only", text: r === "gut" ? " – gutes Zeichen" : " – eher Techniker" }) : null),
        gesendet ? null : h("button", {
          type: "button",
          class: "antwort-chip-aendern",
          "aria-label": (kurz ? satz(kurz) : satz(k.frage || "Antwort")) + " ändern",
          text: "Ändern",
          onclick: function () { zurueck(i); },
        }));
      chips.appendChild(chip);
      if (i === neuIndex) bewege(chip, [{ opacity: 0, transform: "scale(.92)" }, { opacity: 1, transform: "none" }], 240);
    });
  }

  function punkteZeigen() {
    leeren(punkte);
    // Erst ab der zweiten Frage: ein Punkt je beantworteter Frage plus der aktuelle.
    if (gesendet || !pfad.length) return;
    for (let i = 0; i <= pfad.length; i++) punkte.appendChild(h("i", { class: i === pfad.length ? "ist-jetzt" : null }));
  }

  function frageZeigen(richtung, mitFokus) {
    const k = baum.knoten[aktuell];
    leeren(buehne);
    knoepfe = [];
    if (!k) return;
    const frageId = neueId("baum-frage");
    const antworten = Array.isArray(k.antworten) ? k.antworten : [];
    knoepfe = antworten.map(function (a, i) {
      const label = String(a.label || "");
      return h("button", {
        type: "button",
        class: "baum-antwort" + (WEISS_NICHT.test(label) ? " ist-leise" : ""),
        "data-wert": label,
        title: i < 4 ? "Taste " + (i + 1) : null,
        onclick: function () { antworte({ label: label, weiter: a.weiter, richtung: richtungVon(a) }); },
      }, typo(label));
    });
    // Eigene Antwort bei JEDER Frage (Vincent 09.10.: „Es fehlt der eigene
    // Input bei den Möglichkeiten“): Unter den Knöpfen ein leiser Chip „Andere
    // Antwort …“, der ein kleines Feld aufklappt; Enter übernimmt. Die Antwort
    // steht danach wie eine geklickte als Chip da („Ändern“ geht). Weiter geht
    // es bei freitext_weiter, sonst wie bei „weiß nicht“ (eine Nachfrage statt
    // Sackgasse), sonst ist die Frage fertig. Ohne Antwortknöpfe steht das Feld
    // gleich offen – es gibt dann nichts anderes zu wählen.
    const weissNicht = antworten.filter(function (a) { return WEISS_NICHT.test(String(a.label || "")); })[0];
    const freiWeiter = String(k.freitext_weiter || "") || (weissNicht ? String(weissNicht.weiter || "") : "") || "fertig";
    const feldId = neueId("baum-feld");
    const feld = h("input", {
      type: "text",
      class: "baum-feld",
      id: feldId,
      placeholder: "Andere Antwort …",
      "aria-label": "Andere Antwort",
      autocomplete: "off",
      enterkeyhint: "send",
      maxlength: "200",
    });
    const nimm = function () {
      const v = feld.value.trim();
      if (!v) {
        fokus(feld);
        return;
      }
      // Eigene Antwort = offen (14.10.5): Die KI hat sie nicht eingeordnet.
      antworte({ label: v, weiter: freiWeiter, richtung: "offen" });
    };
    const frei = h("div", { class: "baum-frei", hidden: knoepfe.length > 0 }, feld,
      h("button", { type: "button", class: "baum-frei-senden", "aria-label": "Antwort übernehmen", onclick: nimm }, ikon("pfeil-rechts", { groesse: 18, strich: 2 })));
    let anders = null;
    if (knoepfe.length) {
      anders = h("button", {
        type: "button",
        class: "baum-anders",
        "aria-expanded": "false",
        "aria-controls": feldId,
        onclick: function () {
          frei.hidden = false;
          anders.hidden = true;
          anders.setAttribute("aria-expanded", "true");
          bewege(frei, [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], 200);
          fokus(feld);
        },
      }, ikon("stift", { groesse: 15 }), h("span", { text: "Andere Antwort …" }));
    }
    feld.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        nimm();
      } else if (e.key === "Escape" && anders && !feld.value.trim()) {
        // Leer zuklappen; mit Text bleibt es offen (nichts geht verloren).
        e.preventDefault();
        e.stopPropagation();
        frei.hidden = true;
        anders.hidden = false;
        anders.setAttribute("aria-expanded", "false");
        fokus(anders);
      }
    });
    const box = h("div", { class: "baum-frage-box", role: "group", "aria-labelledby": frageId },
      h("h3", { class: "baum-frage", id: frageId, text: satz(k.frage) }),
      knoepfe.length ? h("div", { class: "baum-antworten" }, knoepfe) : null,
      anders,
      frei);
    buehne.appendChild(box);
    punkteZeigen();
    if (richtung) bewege(box, [{ opacity: 0, transform: "translateX(" + (richtung * 24) + "px)" }, { opacity: 1, transform: "none" }], 280);
    if (mitFokus) {
      naechsterFrame(function () {
        if (!karte.isConnected) return;
        fokus(knoepfe[0] || box.querySelector("input"));
      });
    }
  }

  function antworte(a) {
    if (gesendet || !aktuell) return;
    meldung.textContent = "";
    pfad.push({ id: aktuell, label: a.label, richtung: a.richtung || "offen" });
    chipsZeigen(pfad.length - 1);
    lageMelden();
    if (a.weiter === "fertig" || !baum.knoten[a.weiter]) {
      fertig();
      return;
    }
    aktuell = a.weiter;
    frageZeigen(1, true);
  }

  function zurueck(i) {
    if (gesendet || !pfad[i]) return;
    aktuell = pfad[i].id;
    pfad = pfad.slice(0, i);
    meldung.textContent = "";
    chipsZeigen(-1);
    lageMelden();
    frageZeigen(-1, true);
  }

  function fertig() {
    const text = baum.zusammenfassen(pfad);
    // A1 „Notiz fürs Ticket“ (SPEC 14.9): derselbe Pfad als Zeile „Geprüft:“.
    const geprueft = typeof baum.geprueft === "function" ? baum.geprueft(pfad) : text;
    aktuell = null;
    leeren(buehne);
    if (typeof ctx.onAntworten !== "function") {
      // Prüfseite: kein Senden. Die Zusammenfassung bleibt sichtbar.
      gesendet = true;
      chipsZeigen(-1);
      punkteZeigen();
      meldung.textContent = "Geht als Nachricht raus: " + text;
      return;
    }
    gesendet = true;
    karte.classList.add("ist-gesendet");
    // Netz zuerst: Die Anfrage startet im selben Takt wie der Klick.
    const angenommen = ctx.onAntworten(text, { geprueft: geprueft });
    if (angenommen === false) {
      gesendet = false;
      karte.classList.remove("ist-gesendet");
      // Letzte Antwort zurücknehmen, damit ein zweiter Klick wieder „fertig“ auslöst.
      const letzte = pfad.pop();
      aktuell = letzte ? letzte.id : baum.start;
      chipsZeigen(-1);
      lageMelden();
      frageZeigen(0, false);
      meldung.textContent = "Bitte warten, bis die laufende Antwort fertig ist.";
      return;
    }
    chipsZeigen(-1);
    punkteZeigen();
    // Karte geht, die Blase kommt: Die Antworten leben ab jetzt in der Nachricht.
    const weg = function () {
      if (karte.parentNode) karte.parentNode.removeChild(karte);
    };
    if (ruhig() || typeof karte.animate !== "function") {
      weg();
      return;
    }
    let anim = null;
    try {
      anim = karte.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.98)" }], { duration: 240, easing: EASE, fill: "forwards" });
    } catch (e) {
      anim = null;
    }
    mitFrist(anim ? anim.finished : null, 320).then(weg);
  }

  // Tasten 1–4 wählen Antworten, solange die Karte den Fokus hat.
  if (ctx.rueckfrageTasten !== false) {
    karte.addEventListener("keydown", function (e) {
      const ziel = e.target;
      if (!ziel || ziel.tagName === "INPUT" || ziel.tagName === "TEXTAREA" || gesendet || !aktuell) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const z = parseInt(e.key, 10);
      if (z >= 1 && z <= Math.min(4, knoepfe.length)) {
        e.preventDefault();
        knoepfe[z - 1].click();
      }
    });
  }

  frageZeigen(0, false);
  return karte;
}

/** Den Baum aus dem Draht prüfen: nur Knoten mit Frage, Start muss existieren. */
function blockFragebaum(b, ctx) {
  const liste = Array.isArray(b.knoten) ? b.knoten.filter(function (k) { return k && k.id && k.frage; }) : [];
  const knoten = {};
  liste.forEach(function (k) { knoten[String(k.id)] = k; });
  if (!liste.length || !knoten[b.start]) return versteckt("fragebaum", "assistent", "leer");
  return baumKarte("fragebaum", {
    start: String(b.start),
    knoten: knoten,
    zusammenfassen: function (pfad) {
      // „Ablauf: trocken · Vordruck: nie geprüft“ – ohne kurz: „{frage} {label}“.
      return pfad.map(function (p) {
        const k = knoten[p.id] || {};
        const kurz = String(k.kurz || "").trim();
        return kurz ? ohneMarkdown(kurz) + ": " + p.label : ohneMarkdown(k.frage || "") + " " + p.label;
      }).join(" · ");
    },
    // Für die Notiz ohne Doppelpunkt: „Ventil trocken · Vordruck nie geprüft“.
    geprueft: function (pfad) {
      return pfad.map(function (p) {
        const k = knoten[p.id] || {};
        const kurz = String(k.kurz || "").trim();
        return (kurz ? ohneMarkdown(kurz) : ohneMarkdown(k.frage || "")) + " " + p.label;
      }).join(" · ");
    },
  }, ctx);
}

/**
 * questions ohne fragebaum (alter Server, alte Ströme): als linearer Baum –
 * je Item eine Frage, Optionen als Antworten, Freitext bei free_text oder ohne
 * Optionen. „weiß nicht“ kommt dazu, damit niemand in einer Frage stecken
 * bleibt (wie die Server-Sicherung 14.2.1 Punkt 6). Am Ende eine Nachricht im
 * alten Format „{label}: {antwort} · …“ (SPEC 8).
 */
function blockFragen(b, ctx) {
  if (ctx.mitBaum) return versteckt("questions", "assistent", "fragebaum_da");
  const items = (Array.isArray(b.items) ? b.items : []).filter(function (it) { return it && it.label; });
  if (!items.length) return versteckt("questions", "assistent", "leer");
  const knoten = {};
  items.forEach(function (it, i) {
    const id = "q" + i;
    const weiter = i + 1 < items.length ? "q" + (i + 1) : "fertig";
    const optionen = Array.isArray(it.options) ? it.options.map(String).filter(Boolean) : [];
    const antworten = optionen.map(function (o) { return { label: o, weiter: weiter }; });
    if (antworten.length && antworten.length < 4 && !optionen.some(function (o) { return WEISS_NICHT.test(o); })) {
      antworten.push({ label: "weiß nicht", weiter: weiter });
    }
    knoten[id] = {
      id: id,
      kurz: "",
      frage: it.label,
      antworten: antworten,
      freitext_weiter: it.free_text === true || !optionen.length ? weiter : "",
    };
  });
  const karte = baumKarte("questions", {
    start: "q0",
    knoten: knoten,
    zusammenfassen: function (pfad) {
      const antworten = items.map(function () { return undefined; });
      pfad.forEach(function (p) { antworten[parseInt(p.id.slice(1), 10)] = p.label; });
      return nachrichtAusAntworten(items, antworten);
    },
  }, ctx);
  if (b.intro) karte.insertBefore(h("p", { class: "baum-intro", text: satz(b.intro) }), karte.firstChild);
  return karte;
}

// --- Lösungen (causes, 14.3.7) ------------------------------------------------------

function evidenzVon(u) {
  return u && u.evidence && typeof u.evidence.matching === "number" && typeof u.evidence.similar_cases === "number" ? u.evidence : null;
}

/** Ein Strich je Fall, die passenden gefüllt – die Zahl steht daneben (aus SQL). */
function evidenzBalken(ev) {
  const gesamt = Math.max(0, ev.similar_cases);
  const max = Math.min(gesamt, 24);
  const an = Math.round(ev.matching * max / Math.max(1, gesamt));
  const balken = h("span", { class: "evidenz-balken", "aria-hidden": "true" });
  for (let i = 0; i < max; i++) balken.appendChild(h("i", { class: i < an ? "ist-an" : null }));
  return h("span", { class: "evidenz", title: "So oft war das bei ähnlichen, geklärten Fällen die Ursache." },
    balken, h("span", { class: "evidenz-text zahl", text: zahl(ev.matching) + " von " + zahl(ev.similar_cases) + " Fällen" }));
}

/**
 * „Lösung 1 · 2 · 3“: Wer am Telefon sitzt, soll wissen, dass es nach dem
 * ersten Weg noch einen gibt (Mike). Lösung 1 offen, die anderen zu; „Klappt
 * nicht? Lösung 2“ öffnet die nächste und schließt die vorige (eine offen).
 * Die Evidenz („7 von 11“) setzt nur der Server (SPEC 5.3 Punkt 4).
 *
 * Gegenprüfung 09.10.:
 *   - ctx.fuerTechniker (Rollenhinweis + Übergabe): Die Lösungen sind Arbeit
 *     für den Techniker. Davor steht „Prüft der Techniker vor Ort:“, und der
 *     Knopf heißt nur „Lösung 2“ – „Klappt nicht?“ hieße für den
 *     Kundenbetreuer am Telefon: „Probier das selbst.“
 *   - Mit Übergabe (ohne Rollenhinweis) bekommt die letzte Lösung das Netz
 *     „Klappt nicht? Übergeben“ – es gibt immer einen nächsten Schritt.
 *   - ctx.loesungenZu (Fragebaum in derselben Antwort): erst die Fragen, die
 *     Lösungen liegen zu hinter einer leisen Zeile. Ältere Lösungen desselben
 *     Falls klappt app.js über loesungenEinklappen() zu.
 *
 * Grüne Karte (SPEC 14.10.5, Vincent 12.10.): Hat der Server eine Lösung als
 * „am Telefon lösbar“ geprüft (am_telefon), steht sie grün getönt und offen da:
 * Telefon-Symbol + „Am Telefon lösbar“, darunter „Sagen Sie dem Kunden“ und der
 * Satz groß als Zitat – das darf der Kundenbetreuer wörtlich sagen. Leise die
 * Zahl aus SQL („Bisher 3 von 4 ähnlichen Fällen am Telefon gelöst“), „Hat
 * geklappt“ als grüner Hauptknopf, „Warum?“ (check/why) zugeklappt. Nie neben
 * einer Stopp-Box (ctx.mitStopp). Technik-Karten bleiben, wie sie sind.
 */
function blockUrsachen(b, ctx) {
  const items = (Array.isArray(b.items) ? b.items : []).filter(Boolean);
  const box = wurzel("causes", "assistent", "loesungen");
  if (!items.length) {
    box.hidden = true;
    return box;
  }
  const techniker = !!ctx.fuerTechniker;
  const netz = !techniker && !!ctx.mitUebergabe;
  const telefone = items.map(function (u) { return ctx.mitStopp ? null : telefonVon(u); });
  // Mehrere grüne Karten: die Nummer sichtbar im Kopf („Am Telefon lösbar · Lösung 2“),
  // sonst verliert der Kundenbetreuer nach „Klappt nicht? Lösung 2“ die Zählung.
  const mehrereGruen = telefone.filter(Boolean).length > 1;
  const karten = items.map(function (u, i) {
    const ev = evidenzVon(u);
    const titel = satz(u.title || "");
    const tel = telefone[i];
    const koerperId = neueId("loesung");
    const ohneQuelle = !Array.isArray(u.source_ids) || !u.source_ids.length;
    const kopfZahl = ev ? h("span", { class: "loesung-zahl zahl", text: zahl(ev.matching) + " von " + zahl(ev.similar_cases) }) : null;
    const kicker = tel
      ? h("span", { class: "loesung-nr telefon-marke" },
        h("span", { class: "telefon-ikon", "aria-hidden": "true" }, ikon("telefon", { groesse: 14, strich: 2 })),
        h("span", { text: "Am Telefon lösbar" }),
        mehrereGruen ? h("span", { class: "telefon-nr", text: "· Lösung " + (i + 1) }) : h("span", { class: "sr-only", text: " · Lösung " + (i + 1) }))
      : h("span", { class: "loesung-nr", text: "Lösung " + (i + 1) });
    const knopf = h("button", { type: "button", class: "loesung-kopf", "aria-expanded": "false", "aria-controls": koerperId },
      h("span", { class: "loesung-kopf-text" },
        kicker,
        h("span", { class: "loesung-titel" }, h("span", { text: titel }),
          ohneQuelle ? h("span", { class: "ohne-quelle-ikon", title: "ohne Quelle" },
            ikon("achtung", { groesse: 14, label: "ohne Quelle" })) : null)),
      h("span", { class: "loesung-kopf-rechts" }, kopfZahl, ikon("runter", { groesse: 18, klasse: "loesung-pfeil" })));
    let weiter = null;
    if (i + 1 < items.length) {
      // Von einer grünen Karte aus geht es am Telefon weiter – also „Klappt nicht?“.
      weiter = h("button", { type: "button", class: "weiter-knopf", onclick: function () { oeffne(i + 1, true); } },
        h("span", { text: (techniker && !tel ? "" : "Klappt nicht? ") + "Lösung " + (i + 2) }), ikon("weiter", { groesse: 16, strich: 2 }));
    } else if (netz) {
      weiter = h("button", { type: "button", class: "weiter-knopf", onclick: function () { zurUebergabe(); } },
        h("span", { text: "Klappt nicht? Übergeben" }), ikon("weiter", { groesse: 16, strich: 2 }));
    }
    const geklappt = geklapptKnopf(u, i, titel, weiter, !!tel);
    const fuss = ev || weiter || geklappt
      ? h("div", { class: "loesung-fuss" }, ev ? evidenzBalken(ev) : tel ? null : h("span"),
        geklappt || weiter ? h("div", { class: "loesung-knoepfe" }, geklappt, weiter) : null)
      : null;
    const koerper = tel
      ? h("div", { class: "loesung-koerper", id: koerperId, hidden: true }, telefonInhalt(u, tel), fuss)
      : h("div", { class: "loesung-koerper", id: koerperId, hidden: true },
        u.check ? absaetze(u.check, "loesung-wie") : null,
        u.why ? absaetze(u.why, "loesung-warum") : null,
        fuss);
    const karte = h("div", {
      class: "loesung" + (tel ? " ist-telefon" : ""),
      "data-quellen": idListe(u.source_ids) || null,
      "data-zitat-titel": "Lösung " + (i + 1) + " · " + titel,
      "data-key": u.key ? String(u.key) : null,
    }, knopf, koerper);
    knopf.addEventListener("click", function () {
      const auf = knopf.getAttribute("aria-expanded") === "true";
      if (auf) zu(i);
      else oeffne(i, false);
    });
    return { karte: karte, knopf: knopf, koerper: koerper, kopfZahl: kopfZahl, telefon: !!tel };
  });

  /**
   * Inhalt der grünen Karte: „Sagen Sie dem Kunden“, der Satz als Zitat, leise
   * die Zahl aus SQL, dann „Warum?“ (zu) mit check und why.
   */
  function telefonInhalt(u, tel) {
    const teile = [
      h("p", { class: "telefon-sagen", text: "Sagen Sie dem Kunden" }),
      h("blockquote", { class: "telefon-satz" }, h("p", { text: "„" + tel.satz + "“" })),
    ];
    const warumId = neueId("warum");
    const hatWarum = !!(u.check || u.why);
    const warum = hatWarum
      ? h("button", { type: "button", class: "telefon-warum-knopf", "aria-expanded": "false", "aria-controls": warumId },
        h("span", { text: "Warum?" }), ikon("runter", { groesse: 16, klasse: "mehr-pfeil" }))
      : null;
    const beleg = tel.belegt
      ? h("span", { class: "telefon-beleg", title: "Aus den geklärten Fällen in der Datenbank, nicht von der KI." },
        "Bisher " + zahl(tel.belegt.ohne_einsatz) + " von " + zahl(tel.belegt.faelle) + " ähnlichen Fällen am Telefon gelöst")
      : null;
    if (beleg || warum) teile.push(h("div", { class: "telefon-zeile" }, beleg, warum));
    if (warum) {
      const inhalt = h("div", { class: "telefon-warum", id: warumId, hidden: true },
        u.check ? absaetze(u.check, "loesung-wie") : null,
        u.why ? absaetze(u.why, "loesung-warum") : null);
      warum.addEventListener("click", function () {
        const auf = warum.getAttribute("aria-expanded") !== "true";
        warum.setAttribute("aria-expanded", auf ? "true" : "false");
        warum.classList.toggle("ist-auf", auf);
        inhalt.hidden = !auf;
        if (auf) bewege(inhalt, [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], 240);
      });
      teile.push(inhalt);
    }
    return teile;
  }

  /**
   * „Hat geklappt“ (SPEC 14.9, A2): ein leiser Knopf je Lösung. Ein Klick
   * speichert über die Aktion `ergebnis` (Server: fall_ergebnisse, einmal je
   * Fall und Lösung) und wird zu „Notiert – zählt in der Monatsauswertung“.
   * „7 von 11“ ändert sich dadurch nicht – bestätigte Ursachen kommen nur über
   * „Ursache dokumentieren“ bzw. „Einsatz dokumentieren“. Ohne ctx.onAktion
   * (Einrichtung-Vorschau) kein Knopf.
   */
  function geklapptKnopf(u, i, titel, weiter, amTelefon) {
    if (typeof ctx.onAktion !== "function") return null;
    // Gegenprüfung 12.10.: Ohne Anlage im Fall kann der Server nichts zählen (14.9: 409) –
    // dann gar kein Knopf statt eines Fehlers unter der grünen Karte (T9, Fragen ohne Kunde).
    if (typeof ctx.fallAnlage === "function" && !ctx.fallAnlage()) return null;
    const status = h("span", { class: "geklappt-status", role: "status", tabindex: "-1" });
    // Auf der grünen Karte der Hauptknopf (14.10.5), sonst leise.
    const knopf = h("button", { type: "button", class: "geklappt-knopf" + (amTelefon ? " ist-haupt" : "") },
      ikon("haken", { groesse: 15, strich: 2.2 }), h("span", { text: "Hat geklappt" }));
    knopf.addEventListener("click", function () {
      if (knopf.disabled) return;
      // Vor disabled merken: Chrome nimmt einem deaktivierten Knopf den Fokus.
      const hatteFokus = document.activeElement === knopf;
      knopf.disabled = true;
      status.textContent = "";
      const anlage = typeof ctx.fallAnlage === "function" ? ctx.fallAnlage() : null;
      const payload = {
        ergebnis: "geklappt",
        loesung_nr: i + 1,
        loesung_key: u.key ? String(u.key) : null,
        source_ids: Array.isArray(u.source_ids) ? u.source_ids.map(String) : [],
      };
      if (anlage) payload.anlage_id = String(anlage);
      // Grüne Karte: zählt als „am Telefon gelöst“ (fall_ergebnisse.am_telefon, 14.10.5).
      if (amTelefon) payload.am_telefon = true;
      aktionAusfuehren(ctx, { action: "ergebnis", label: "Hat geklappt", payload: payload, titel: titel }).then(function () {
        knopf.hidden = true;
        // „Klappt nicht? …“ passt nicht mehr, wenn es geklappt hat.
        if (weiter) weiter.hidden = true;
        leeren(status).appendChild(ikon("haken", { groesse: 15, strich: 2.2 }));
        status.appendChild(h("span", { text: "Notiert – zählt in der Monatsauswertung" }));
        status.classList.add("ist-notiert");
        if (hatteFokus) fokus(status);
      }, function (e) {
        knopf.disabled = false;
        if (hatteFokus) fokus(knopf);
        status.textContent = "Nicht notiert: " + (e && e.message ? e.message : "unbekannter Fehler");
      });
    });
    return h("span", { class: "geklappt" }, knopf, status);
  }

  function zu(n) {
    const k = karten[n];
    k.karte.classList.remove("ist-offen");
    k.knopf.setAttribute("aria-expanded", "false");
    k.koerper.hidden = true;
    if (k.kopfZahl) k.kopfZahl.hidden = false;
  }

  function oeffne(n, mitFokus) {
    karten.forEach(function (k, i) {
      if (i !== n) zu(i);
    });
    const k = karten[n];
    // „Klappt nicht? Lösung 2“ von einer offenen grünen Karte zu einer Karte hinter der leisen Zeile.
    if (liste.hidden && liste.contains(k.karte)) {
      liste.hidden = false;
      auf.setAttribute("aria-expanded", "true");
    }
    k.karte.classList.add("ist-offen");
    k.knopf.setAttribute("aria-expanded", "true");
    k.koerper.hidden = false;
    if (k.kopfZahl) k.kopfZahl.hidden = true;
    bewege(k.koerper, [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], 240);
    if (mitFokus) {
      naechsterFrame(function () {
        fokus(k.knopf);
        try {
          k.karte.scrollIntoView({ block: "nearest", behavior: ruhig() ? "auto" : "smooth" });
        } catch (e) {
          // ohne Scrollen
        }
      });
    }
  }

  /** „Klappt nicht? Übergeben“: zur Übergabe-Karte dieser Antwort, einmal aufleuchten, Fokus auf „Übergeben“. */
  function zurUebergabe() {
    const antwort = box.closest(".antwort");
    const ziel = antwort ? antwort.querySelector(".blk-handover") : null;
    if (!ziel) return;
    try {
      ziel.scrollIntoView({ block: "nearest", behavior: ruhig() ? "auto" : "smooth" });
    } catch (e) {
      // ohne Scrollen
    }
    aufleuchten(ziel, markeRgba(0.22));
    const knopf = ziel.querySelector(".knopf-e-primaer:not([disabled])");
    naechsterFrame(function () { fokus(knopf || ziel); });
  }

  const liste = h("div", { class: "loesungen-liste", id: neueId("loesungen") });
  // Grüne Karten stehen vorn (der Server sortiert). Mit Fragebaum (ctx.loesungenZu)
  // bleiben sie trotzdem offen sichtbar – Vincent 12.10.: „in grünen Boxen Lösungen,
  // die er direkt am Telefon mitteilen kann“ (14.10.5 „offen statt zugeklappt“);
  // nur die Technik-Karten liegen hinter der leisen Zeile.
  let gruenVorn = 0;
  while (gruenVorn < karten.length && karten[gruenVorn].telefon) gruenVorn++;
  const gruenOffen = !!ctx.loesungenZu && gruenVorn > 0;
  const gruenListe = gruenOffen ? h("div", { class: "loesungen-liste loesungen-gruen" }) : null;
  // „Prüft der Techniker vor Ort:“ steht vor der ersten Technik-Karte – grüne
  // Karten (am Telefon) stehen davor und gehören nicht dazu. Stehen grüne Karten
  // davor, sagt eine leise Zeile, dass danach der Techniker kommt (Gegenprüfung
  // 12.10.: bei T17 trug die Technik-Karte sonst keine Marke).
  let kickerDa = false;
  karten.forEach(function (k, i) {
    if (gruenListe && i < gruenVorn) {
      gruenListe.appendChild(k.karte);
      return;
    }
    if (!k.telefon && !kickerDa && (techniker || gruenVorn > 0)) {
      liste.appendChild(h("p", { class: "loesungen-kicker", text: techniker ? "Prüft der Techniker vor Ort:" : "Sonst: Techniker vor Ort" }));
      kickerDa = true;
    }
    liste.appendChild(k.karte);
  });
  // Leise Zeile zum Auf- und Zuklappen – sichtbar nur, solange die Lösungen
  // zu sind oder einmal zu waren (ctx.loesungenZu, loesungenEinklappen).
  const auf = h("button", { type: "button", class: "loesungen-auf", hidden: true, "aria-expanded": "true", "aria-controls": liste.id },
    h("span", { class: "loesungen-auf-text" }), ikon("runter", { groesse: 16, klasse: "loesungen-auf-pfeil" }));
  auf.addEventListener("click", function () {
    const offen = auf.getAttribute("aria-expanded") === "true";
    auf.setAttribute("aria-expanded", offen ? "false" : "true");
    liste.hidden = offen;
    if (!offen) bewege(liste, [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], 240);
  });
  box.setAttribute("data-anzahl", String(items.length));
  if (gruenListe) box.appendChild(gruenListe);
  box.appendChild(auf);
  box.appendChild(liste);
  if (gruenListe && gruenVorn === karten.length) liste.hidden = true;
  // Lösung 1 offen – ohne Bewegung beim ersten Zeichnen. Die grüne Karte steht
  // vorn (der Server sortiert) und damit offen da (14.10.5); weitere grüne Karten
  // zeigen ihren grünen Kopf und gehen wie jede andere mit „Klappt nicht?“ auf
  // (eine offen – sonst stünden zwei Sätze untereinander).
  let offenNr = 0;
  for (let j = karten.length - 1; j >= 0; j--) if (karten[j].telefon) offenNr = j;
  karten.forEach(function (k, i) {
    if (i !== offenNr) return;
    k.karte.classList.add("ist-offen");
    k.knopf.setAttribute("aria-expanded", "true");
    k.koerper.hidden = false;
    if (k.kopfZahl) k.kopfZahl.hidden = true;
  });
  if (gruenOffen) {
    // Grün bleibt offen; die Technik-Karten (falls es welche gibt) liegen zu.
    const rest = karten.length - gruenVorn;
    if (rest > 0) loesungenZuklappen(box, (rest === 1 ? "Weitere Lösung" : "Weitere Lösungen") + " ansehen (" + rest + ")");
  } else if (ctx.loesungenZu) {
    loesungenZuklappen(box, (items.length === 1 ? "Lösung" : "Lösungen") + " schon jetzt ansehen (" + items.length + ")");
    // Liegt darunter eine grüne Karte, sagt die Zeile es mit dem Telefon-Symbol (ohne mehr Text).
    if (telefone.some(Boolean)) {
      auf.classList.add("ist-telefon");
      auf.insertBefore(h("span", { class: "telefon-ikon", "aria-hidden": "true" }, ikon("telefon", { groesse: 13, strich: 2 })), auf.firstChild);
      auf.appendChild(h("span", { class: "sr-only", text: ", darunter am Telefon lösbar" }));
    }
  }
  return box;
}

/** Lösungen eines causes-Blocks hinter eine leise Zeile legen (wieder aufklappbar). */
function loesungenZuklappen(box, text) {
  const auf = box.querySelector(".loesungen-auf");
  const liste = box.querySelector(".loesungen-liste:not(.loesungen-gruen)");
  if (!auf || !liste) return;
  const t = auf.querySelector(".loesungen-auf-text");
  if (t) t.textContent = text;
  auf.hidden = false;
  auf.setAttribute("aria-expanded", "false");
  liste.hidden = true;
  box.classList.add("ist-eingeklappt");
}

/**
 * Ältere Lösungen desselben Falls zuklappen, wenn eine neuere Antwort eigene
 * bringt (Gegenprüfung 09.10.: Bei T5 standen sonst zwei Lösungsblöcke
 * untereinander). Bleibt aufklappbar: „Lösungen von vorhin (3)“.
 */
export function loesungenEinklappen(bereich) {
  if (!bereich || typeof bereich.querySelectorAll !== "function") return;
  Array.prototype.forEach.call(bereich.querySelectorAll(".blk-causes"), function (box) {
    if (box.hidden) return;
    // Offene grüne Karten (mit Fragebaum) gehören bei einer älteren Antwort mit hinter die Zeile.
    const gruen = box.querySelector(".loesungen-gruen");
    const liste = box.querySelector(".loesungen-liste:not(.loesungen-gruen)");
    if (gruen && liste) {
      while (gruen.lastChild) liste.insertBefore(gruen.lastChild, liste.firstChild);
      gruen.remove();
    }
    const n = parseInt(box.getAttribute("data-anzahl") || "0", 10) || 0;
    loesungenZuklappen(box, (n === 1 ? "Lösung" : "Lösungen") + " von vorhin" + (n ? " (" + n + ")" : ""));
  });
}

// --- image ---------------------------------------------------------------------------

/**
 * Ein Knopf „Bild ansehen“ mit kleinem Vorschaubild; das Bild öffnet in einem
 * Blatt (App, ctx.oeffneBild) oder – ohne App – klappt es hier auf. Das Bild
 * kommt als Blob-URL über ctx.ladeBild (die Function `bild` verlangt die
 * Sitzung als Header, <img src> kann keine Header schicken).
 */
function blockBild(b, ctx) {
  const caption = satz(b.caption || "");
  const box = wurzel("image", "unterlage");
  if (b.source_id) {
    box.setAttribute("data-quellen", String(b.source_id));
    box.setAttribute("data-zitat-titel", "Abbildung · " + (b.dokument_titel || ""));
  }
  const quelleText = "Quelle: " + satz(b.dokument_titel || b.source_id || "") + (typeof b.seite === "number" ? ", S. " + b.seite : "");
  const vorschau = h("span", { class: "bild-vorschau", "aria-hidden": "true" }, h("span", { class: "skelett bild-vorschau-skelett" }));
  // „Schaubild ansehen“ sagt, was kommt – „Bild ansehen“ allein ließ offen, welches (Gegenprüfung 09.10.).
  const knopf = h("button", { type: "button", class: "bild-zeile", "aria-haspopup": "dialog" }, vorschau, h("span", { text: "Schaubild ansehen" }));
  box.appendChild(knopf);
  let url = null;
  let laden = null;
  if (typeof ctx.ladeBild === "function") {
    try {
      laden = Promise.resolve(ctx.ladeBild(b.image_id));
    } catch (e) {
      laden = Promise.reject(e);
    }
    laden.then(function (u) {
      if (!u) throw new Error("leere Bildadresse");
      url = u;
      leeren(vorschau).appendChild(h("img", { src: u, alt: "", decoding: "async" }));
    }).then(null, function (e) {
      console.warn("Abbildung " + b.image_id + " nicht geladen:", e);
      leeren(vorschau).appendChild(ikon("bild", { groesse: 18 }));
    });
  } else {
    leeren(vorschau).appendChild(ikon("bild", { groesse: 18 }));
  }
  const info = { url: null, caption: caption, quelle: quelleText, source_id: b.source_id ? String(b.source_id) : "", laden: laden };
  let inline = null;
  knopf.addEventListener("click", function () {
    info.url = url;
    if (typeof ctx.oeffneBild === "function") {
      ctx.oeffneBild(info, knopf);
      return;
    }
    // Ohne App (Prüfseite): hier aufklappen.
    if (inline) {
      inline.hidden = !inline.hidden;
      return;
    }
    inline = h("figure", { class: "bild-inline" },
      url ? h("img", { src: url, alt: caption || "Abbildung aus der Herstellerunterlage", decoding: "async" })
        : h("p", { class: "bild-hinweis", text: "Abbildung hier nicht verfügbar." }),
      h("figcaption", null, caption ? h("span", { text: caption }) : null, h("span", { class: "bild-quelle", text: quelleText })));
    box.appendChild(inline);
  });
  return box;
}

// --- steps -----------------------------------------------------------------------------

/** Nummerierte Schritte: drei sichtbar, der Rest hinter „Alle {n} Schritte“. */
function blockSchritte(b, ctx) {
  const box = wurzel("steps", "assistent", "karte-e");
  if (Array.isArray(b.source_ids) && b.source_ids.length) {
    box.setAttribute("data-quellen", idListe(b.source_ids));
    box.setAttribute("data-zitat-titel", "Schritte" + (b.title ? " · " + satz(b.title) : ""));
  }
  const fehltRolle = b.role_min && ctx.rolle && rang(ctx.rolle) < rang(b.role_min);
  box.appendChild(h("h3", { class: "karte-titel" }, h("span", { text: b.title ? satz(b.title) : "So gehst du vor" }),
    fehltRolle ? h("span", { class: "pille pille-achtung", text: "ab " + (ROLLEN_NAMEN[b.role_min] || b.role_min) }) : null));
  const items = Array.isArray(b.items) ? b.items : [];
  const liste = h("ol", { class: "schritte" });
  const rest = [];
  items.forEach(function (s, i) {
    const li = h("li", { hidden: i >= 3 }, h("span", { class: "schritt-nr", "aria-hidden": "true", text: String(i + 1) }), h("div", null, absaetze(s)));
    if (i >= 3) rest.push(li);
    liste.appendChild(li);
  });
  box.appendChild(liste);
  if (rest.length) {
    const alle = h("button", { type: "button", class: "knopf-leise-e", text: "Alle " + items.length + " Schritte" });
    alle.addEventListener("click", function () {
      rest.forEach(function (li) { li.hidden = false; });
      alle.parentNode.removeChild(alle);
      fokus(rest[0]);
    });
    box.appendChild(alle);
  }
  return box;
}

// --- handover + actions ---------------------------------------------------------------

function uebergabeText(b) {
  const zeilen = ["Übergabepaket an " + (LEVEL_NAMEN[b.to_level] ? "den " + LEVEL_NAMEN[b.to_level] : "Level " + b.to_level)];
  const kopf = [b.anlage_id ? "Anlage: " + b.anlage_id : null, b.ticket_id ? "Ticket: " + b.ticket_id : null].filter(Boolean).join(" · ");
  if (kopf) zeilen.push(kopf);
  if (b.summary) zeilen.push("", "Zusammenfassung: " + ohneMarkdown(b.summary));
  if (Array.isArray(b.codes) && b.codes.length) zeilen.push("Codes: " + b.codes.join(", "));
  const liste = function (titel, werte) {
    if (!Array.isArray(werte) || !werte.length) return;
    zeilen.push("", titel + ":");
    werte.forEach(function (w) { zeilen.push("– " + ohneMarkdown(w)); });
  };
  liste("Bisherige Maßnahmen", b.actions_taken);
  liste("Vermutungen", b.hypotheses);
  return zeilen.join("\n");
}

/**
 * A1 „Notiz fürs Ticket“ (SPEC 14.9): 4–5 Zeilen Klartext für Zendesk, gebaut
 * nur aus dem, was auf dem Schirm steht (app.js sammelt, hier wird gesetzt –
 * Muster wie uebergabeText). Leere Zeilen fallen weg.
 *   n = { anlage_id, kunde, adresse, anliegen, wiederholung, geprueft, ergebnis, quellen: [] }
 *   → „A-1042 · Familie Petersen, Lindenstraße 14, Neumünster
 *      Anliegen: Wärmepumpe – Druck zu niedrig (F.022) · kommt wieder: 3× in 34 Tagen
 *      Geprüft: Ventil trocken · Vordruck nie geprüft
 *      Ergebnis: Lösung 1 „Vordruck am Ausdehnungsgefäß prüfen“ – hat geklappt
 *      Quellen: MN-07, Vaillant S. 39, 41“
 */
export function notizText(n) {
  const d = n || {};
  const glatt = function (t) {
    return t ? ohneMarkdown(String(t)).replace(/\s+/g, " ").trim() : "";
  };
  const verbinde = function (teile, trenner) {
    return teile.map(glatt).filter(Boolean).join(trenner);
  };
  const anliegen = verbinde([d.anliegen, d.wiederholung ? "kommt wieder: " + d.wiederholung : ""], " · ");
  const quellen = Array.isArray(d.quellen) ? verbinde(d.quellen, ", ") : "";
  return [
    verbinde([d.anlage_id, verbinde([d.kunde, d.adresse], ", ")], " · "),
    anliegen ? "Anliegen: " + anliegen : "",
    glatt(d.geprueft) ? "Geprüft: " + glatt(d.geprueft) : "",
    glatt(d.ergebnis) ? "Ergebnis: " + glatt(d.ergebnis) : "",
    quellen ? "Quellen: " + quellen : "",
  ].filter(Boolean).join("\n");
}

/**
 * Text in die Zwischenablage. Lehnt die Clipboard-API ab (kein Fokus, keine
 * Berechtigung), versucht es der alte Weg über ein unsichtbares Feld.
 */
export function kopieren(text) {
  const altmodisch = function () {
    return new Promise(function (aufloesen, ablehnen) {
      const vorher = document.activeElement;
      const feld = h("textarea", { readonly: true, class: "sr-only" });
      feld.value = text;
      document.body.appendChild(feld);
      feld.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e) {
        ok = false;
      }
      document.body.removeChild(feld);
      // Der Fokus bleibt am Knopf, der kopiert hat (Tastatur).
      if (vorher && vorher !== document.body && typeof vorher.focus === "function") {
        try {
          vorher.focus({ preventScroll: true });
        } catch (e) {
          // ohne Fokus
        }
      }
      if (ok) aufloesen();
      else ablehnen(new Error("Kopieren nicht möglich"));
    });
  };
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(null, altmodisch);
  return altmodisch();
}

/** Eine Aktion ausführen (App: api.aktion) – liefert die Bestätigung oder wirft. */
function aktionAusfuehren(ctx, item) {
  let v;
  try {
    v = Promise.resolve(ctx.onAktion(item));
  } catch (e) {
    v = Promise.reject(e);
  }
  return v;
}

function bestaetigungText(bestaetigung, rueckfall) {
  return bestaetigung && typeof bestaetigung === "object" && bestaetigung.content ? satz(bestaetigung.content) : rueckfall;
}

/**
 * Übergabe als EINE Karte: „Für den Techniker · Alles ist vorbereitet.“ und
 * ein Knopf „Übergeben“ (führt create_handover aus). Das Paket selbst –
 * Zusammenfassung, Bisher, Code, Vermutungen – liegt hinter „Ansehen“.
 */
function blockUebergabe(b, ctx) {
  const box = wurzel("handover", "assistent", "karte-e");
  const ziel = b.to_level === 3 ? "Für den Third Level" : b.to_level === 1 ? "Für den First Level" : "Für den Techniker";
  const item = ctx.uebergabeAktion || null;
  const status = h("p", { class: "aktion-status", role: "status" });
  let knopf = null;
  if (item) {
    const voll = satz(item.label || "Übergeben");
    knopf = h("button", { type: "button", class: "knopf-e knopf-e-primaer", title: voll, text: "Übergeben" });
    if (typeof ctx.onAktion !== "function") {
      knopf.disabled = true;
      knopf.title = "Hier nicht verfügbar";
    }
    knopf.addEventListener("click", function () {
      if (knopf.disabled) return;
      knopf.disabled = true;
      status.textContent = "";
      aktionAusfuehren(ctx, item).then(function (bestaetigung) {
        leeren(knopf);
        knopf.appendChild(ikon("haken", { groesse: 16, strich: 2.2 }));
        knopf.appendChild(document.createTextNode("Übergeben"));
        knopf.classList.add("ist-erledigt");
        // Eigener Satz statt „Übergabepaket an Level 2 angelegt (Nr. 1).“ –
        // drei Begriffe, die am Telefon niemand braucht (Gegenprüfung 09.10.).
        // Der Satz des Servers bleibt als title am Knopf.
        const text = b.to_level === 3 ? "An den Third Level übergeben." : b.to_level === 1 ? "An den First Level übergeben." : "An den Techniker übergeben.";
        const server = bestaetigungText(bestaetigung, "");
        if (server) knopf.title = server;
        if (typeof ctx.toast === "function") ctx.toast(text, "gut");
        else status.textContent = text;
      }, function (e) {
        knopf.disabled = false;
        status.textContent = "Nicht übergeben: " + (e && e.message ? e.message : "unbekannter Fehler");
      });
    });
  }
  box.appendChild(h("div", { class: "uebergabe-zeile" },
    h("span", { class: "uebergabe-symbol", "aria-hidden": "true" }, ikon("uebergabe", { groesse: 20 })),
    h("div", { class: "uebergabe-text" }, h("strong", { text: ziel }), h("span", { text: "Alles ist vorbereitet." })),
    knopf));
  const kopierStatus = h("span", { class: "kopier-status", role: "status" });
  const kopierKnopf = h("button", { type: "button", class: "knopf-leise-e" }, ikon("kopieren", { groesse: 14 }), "Als Text kopieren");
  kopierKnopf.addEventListener("click", function () {
    kopieren(uebergabeText(b)).then(function () {
      kopierStatus.textContent = "Kopiert.";
      setTimeout(function () { kopierStatus.textContent = ""; }, 2500);
    }, function () {
      kopierStatus.textContent = "Kopieren nicht möglich.";
    });
  });
  const codes = Array.isArray(b.codes) ? b.codes : [];
  const bisher = Array.isArray(b.actions_taken) ? b.actions_taken : [];
  const vermutungen = Array.isArray(b.hypotheses) ? b.hypotheses : [];
  box.appendChild(h("details", { class: "mehr" },
    h("summary", null, h("span", { text: "Ansehen" }), ikon("runter", { groesse: 14, klasse: "mehr-pfeil" })),
    h("div", { class: "mehr-inhalt" },
      b.summary ? absaetze(b.summary) : null,
      bisher.length ? h("p", { text: "Bisher: " + bisher.map(satz).join(" · ") }) : null,
      codes.length ? h("p", { text: "Code: " + codes.join(", ") }) : null,
      vermutungen.length ? h("p", { text: "Vermutungen: " + vermutungen.map(satz).join(" · ") }) : null,
      h("p", { class: "mehr-knoepfe" }, kopierKnopf, kopierStatus))));
  box.appendChild(status);
  return box;
}

/** Ursachen-Optionen für „Ursache dokumentieren“: Server-Liste vor eigener. */
function ursachenOptionen(payload) {
  const vomServer = payload && (payload.ursache_optionen || payload.ursache_kategorien || payload.optionen);
  if (Array.isArray(vomServer) && vomServer.length) {
    return vomServer.map(function (o) {
      if (o && typeof o === "object") return [String(o.key || o.wert || o.id), String(o.label || o.titel || o.key)];
      return [String(o), String(o).replace(/_/g, " ")];
    });
  }
  const kat = payload && payload.symptom_kategorie;
  return URSACHEN[kat] || [];
}

/** „Ursache dokumentieren“ braucht Eingaben (SPEC 7) – das Formular klappt inline auf. */
function ursachenFormular(item, ausfuehren, abbrechen) {
  const payload = item.payload || {};
  const optionen = ursachenOptionen(payload);
  const id = neueId("u");
  const auswahl = h("select", { id: id + "-k", class: "feld" },
    h("option", { value: "", text: optionen.length ? "Bitte wählen …" : "Keine Kategorien bekannt" }),
    optionen.map(function (o) { return h("option", { value: o[0], text: o[1] }); }));
  const befund = h("textarea", { id: id + "-t", class: "feld", rows: "2", maxlength: "500" });
  if (payload.ursache) befund.value = String(payload.ursache);
  const verifiziert = h("input", { type: "checkbox", id: id + "-v" });
  if (payload.verifiziert === true) verifiziert.checked = true;
  const speichern = h("button", { type: "submit", class: "knopf knopf-primaer", text: "Speichern" });
  const zurueck = h("button", { type: "button", class: "knopf knopf-leise", text: "Abbrechen" });
  const hinweis = h("p", { class: "feld-fehler", role: "status" });

  auswahl.addEventListener("change", function () {
    if (!befund.value.trim() || befund.dataset.vorbelegt === "1") {
      const gewaehlt = optionen.filter(function (o) { return o[0] === auswahl.value; })[0];
      befund.value = gewaehlt ? gewaehlt[1] : "";
      befund.dataset.vorbelegt = "1";
    }
  });
  befund.addEventListener("input", function () { befund.dataset.vorbelegt = "0"; });

  const formular = h("form", { class: "aktion-formular", novalidate: true },
    h("label", { class: "feld-label", for: id + "-k", text: "Woran lag es?" }), auswahl,
    h("label", { class: "feld-label", for: id + "-t", text: "Kurz beschreiben" }), befund,
    h("label", { class: "haken-zeile", for: id + "-v" }, verifiziert, h("span", { text: "Vor Ort bestätigt" })),
    h("div", { class: "aktion-formular-knoepfe" }, speichern, zurueck),
    hinweis);
  formular.addEventListener("submit", function (e) {
    e.preventDefault();
    if (optionen.length && !auswahl.value) {
      hinweis.textContent = "Bitte eine Ursache wählen.";
      auswahl.focus();
      return;
    }
    if (!befund.value.trim()) {
      hinweis.textContent = "Bitte kurz beschreiben.";
      befund.focus();
      return;
    }
    hinweis.textContent = "";
    ausfuehren({ ursache: befund.value.trim(), ursache_kategorie: auswahl.value || null, verifiziert: verifiziert.checked }, function (sperren) {
      [auswahl, befund, verifiziert, speichern, zurueck].forEach(function (f) { f.disabled = sperren; });
    });
  });
  zurueck.addEventListener("click", abbrechen);
  return formular;
}

/**
 * Übrige actions als Knöpfe. Knopftext = label bis zum ersten „:“ (voller
 * Text als title und in der Bestätigung). Aktionen schreiben echt in die
 * Demo-DB – die Bestätigung erscheint inline, der Knopf ist danach erledigt.
 */
function blockAktionen(b, ctx) {
  const items = (Array.isArray(b.items) ? b.items : []).filter(function (it) {
    // create_handover steckt in der Übergabe-Karte, wenn es eine gibt.
    if (!it || (it.action === "create_handover" && ctx.mitUebergabe)) return false;
    // In der App zeigen wir nur, was die Rolle auch tun darf (14.3: nichts Graues,
    // das nur verwirrt). Die Prüfseite zeigt den gesperrten Knopf weiter zur Diagnose.
    const min = AKTION_ROLLE_MIN[it.action];
    return !(ctx.akteDaneben && min && ctx.rolle && rang(ctx.rolle) < rang(min));
  });
  if (!items.length) return versteckt("actions", "aktion", "in_uebergabe");
  const box = wurzel("actions", "aktion");
  const knoepfe = h("div", { class: "aktion-knoepfe" });
  const bereiche = h("div", { class: "aktion-bereiche" });
  // Ein Hauptknopf: Steht „Ursache dokumentieren“ da, ist das der nächste
  // Schritt; die Wiedervorlage wird zweitrangig und heißt in Alltagssprache
  // „In 14 Tagen nachhaken“ (Gegenprüfung 09.10.).
  const mitUrsache = items.some(function (it) { return it.action === "document_cause"; });
  items.forEach(function (item) {
    const voll = satz(item.label || item.action);
    let kurz = voll.split(":")[0].trim() || voll;
    let stil = item.stil === "sekundaer" ? "knopf-e-rand" : "knopf-e-primaer";
    if (item.action === "create_followup") {
      const m = /^Wiedervorlage in (\d+)\s*Tag(en)?/i.exec(kurz);
      if (m) kurz = "In " + m[1] + (m[1] === "1" ? " Tag" : "\u00A0Tagen") + " nachhaken";
      if (mitUrsache) stil = "knopf-e-rand";
    }
    const knopf = h("button", { type: "button", class: "knopf-e " + stil, title: voll !== kurz ? voll : null, text: kurz });
    const bereich = h("div", { class: "aktion-bereich", "aria-live": "polite" });
    const ergebnis = h("div", { class: "aktion-ergebnis" });
    bereich.appendChild(ergebnis);
    let erledigt = false;

    const minRolle = AKTION_ROLLE_MIN[item.action];
    const fehltRolle = minRolle && ctx.rolle && rang(ctx.rolle) < rang(minRolle);
    const ohneHandler = typeof ctx.onAktion !== "function";
    if (fehltRolle || ohneHandler) {
      knopf.disabled = true;
      knopf.title = fehltRolle ? "Ab " + (ROLLEN_NAMEN[minRolle] || minRolle) : "Hier nicht verfügbar";
    }

    function formularWeg() {
      const f = bereich.querySelector(".aktion-formular");
      if (f) bereich.removeChild(f);
    }

    function ausfuehren(zusatz, sperren) {
      if (erledigt) return;
      const payload = Object.assign({}, item.payload || {}, zusatz || {});
      const aufruf = Object.assign({}, item, { payload: payload });
      knopf.disabled = true;
      if (sperren) sperren(true);
      leeren(ergebnis).appendChild(h("p", { class: "aktion-hinweis", text: kurz + " …" }));
      aktionAusfuehren(ctx, aufruf).then(function (bestaetigung) {
        erledigt = true;
        knopf.disabled = true;
        knopf.classList.add("ist-erledigt");
        knopf.insertBefore(ikon("haken", { groesse: 15, strich: 2.2 }), knopf.firstChild);
        formularWeg();
        leeren(ergebnis);
        ergebnis.appendChild(h("p", { class: "aktion-ok" }, ikon("haken", { groesse: 15, strich: 2.2 }), h("span", { text: bestaetigungText(bestaetigung, voll + ": erledigt.") })));
      }, function (e) {
        knopf.disabled = !!bereich.querySelector(".aktion-formular");
        if (sperren) sperren(false);
        leeren(ergebnis).appendChild(h("p", {
          class: "aktion-fehler",
          role: "alert",
          text: kurz + " – nicht ausgeführt: " + (e && e.message ? e.message : "unbekannter Fehler"),
        }));
      });
    }

    knopf.addEventListener("click", function () {
      if (erledigt || knopf.disabled) return;
      if (item.action === "document_cause") {
        if (bereich.querySelector(".aktion-formular")) return;
        const formular = ursachenFormular(item, ausfuehren, function () {
          formularWeg();
          leeren(ergebnis);
          knopf.disabled = false;
          fokus(knopf);
        });
        knopf.disabled = true;
        bereich.insertBefore(formular, ergebnis);
        const erstes = formular.querySelector("select, textarea");
        if (erstes) fokus(erstes);
        return;
      }
      ausfuehren(null, null);
    });

    knoepfe.appendChild(knopf);
    bereiche.appendChild(bereich);
  });
  box.appendChild(knoepfe);
  box.appendChild(bereiche);
  return box;
}

// --- auswahl („Welche Frau Petersen?“, 14.3.8) ------------------------------------------

/**
 * Zweite Zeile eines Auswahl-Knopfs: „24534 Neumünster · 1 offen“. Wer „wieder
 * Störung“ meldet, ist meist die Familie mit offenem Ticket – die Zahl kommt
 * aus der schon geladenen Anlagenliste (ctx.offeneTickets, ohne Anfrage).
 * Bei der Wahl über die Adresse steht die Familie davor: Sie unterscheidet,
 * wenn Name und Straße nicht zusammenpassen (Gegenprüfung 09.10.).
 */
function auswahlUnter(o, b, ctx) {
  const teile = [];
  if (b.grund === "adresse" && o.kunde_alias) teile.push(o.kunde_alias);
  teile.push(o.unter || [o.plz, o.ort].filter(Boolean).join(" "));
  const n = typeof ctx.offeneTickets === "function" ? ctx.offeneTickets(String(o.anlage_id)) : null;
  if (typeof n === "number" && n > 0) teile.push(n + " offen");
  return typo(teile.filter(Boolean).join(" · "));
}

/**
 * Mehrere Kunden passen zum Namen – die Adresse entscheidet (Mike: „mit der
 * Adresse … um die zu identifizieren am Telefon“). Ein Klick schickt die
 * Wahl samt Anlagennummer als nächste Nachricht; der Server lädt dann ohne
 * Umweg die richtige Anlage. Kommt ohne KI aus.
 */
function blockAuswahl(b, ctx) {
  const box = wurzel("auswahl", "system", "karte-e");
  const optionen = (Array.isArray(b.optionen) ? b.optionen : []).filter(function (o) { return o && o.anlage_id; });
  box.setAttribute("data-grund", String(b.grund || ""));
  const meldung = h("p", { class: "baum-meldung", role: "status" });
  let gewaehlt = false;
  const knoepfe = optionen.map(function (o) {
    const knopf = h("button", {
      type: "button",
      class: "auswahl-knopf",
      "data-anlage": String(o.anlage_id),
      "aria-pressed": "false",
      title: [o.kunde_alias, o.anlage_id].filter(Boolean).join(" · "),
    },
    h("span", { class: "ort-ikon", "aria-hidden": "true" }, ikon("ort", { groesse: 20 })),
    h("span", { class: "auswahl-text" },
      h("strong", { text: typo(o.label || [o.strasse, o.hausnummer].filter(Boolean).join(" ")) }),
      h("span", { text: auswahlUnter(o, b, ctx) })));
    knopf.addEventListener("click", function () {
      if (gewaehlt) return;
      if (typeof ctx.onAntworten !== "function") {
        meldung.textContent = "Geht als Nachricht raus: " + String(o.nachricht || "");
        return;
      }
      const angenommen = ctx.onAntworten(String(o.nachricht || ""));
      if (angenommen === false) {
        meldung.textContent = "Bitte warten, bis die laufende Antwort fertig ist.";
        return;
      }
      gewaehlt = true;
      meldung.textContent = "";
      knoepfe.forEach(function (k) {
        k.disabled = true;
        k.setAttribute("aria-pressed", k === knopf ? "true" : "false");
      });
      knopf.classList.add("ist-gewaehlt");
      // Die Akte darf sofort laden (nur lesen); maßgeblich bleibt meta.fall der Folgeantwort.
      if (typeof ctx.oeffneAkte === "function") ctx.oeffneAkte(String(o.anlage_id), null, true);
      if (keine) keine.disabled = true;
    });
    return knopf;
  });
  // „Keine davon“ → Eingabefeld (ctx.keineDavon, Vincent 09.10.); ohne: Fallsuche wie bisher.
  const keineZiel = typeof ctx.keineDavon === "function" ? ctx.keineDavon : (typeof ctx.fallSuchen === "function" ? ctx.fallSuchen : null);
  const keine = keineZiel
    ? h("button", { type: "button", class: "knopf-leise-e", text: "Keine davon", onclick: function () { keineZiel(); } })
    : null;
  box.appendChild(h("h3", { class: "auswahl-frage", text: satz(b.frage || "Welche Anlage ist gemeint?") }));
  box.appendChild(h("div", { class: "auswahl-knoepfe", role: "group", "aria-label": satz(b.frage || "Auswahl") }, knoepfe));
  if (keine) box.appendChild(h("div", { class: "auswahl-unten" }, keine));
  box.appendChild(meldung);
  return box;
}

// --- sources ------------------------------------------------------------------------------

/**
 * sources: In der App (ctx.oeffneWoher) keine Karte – die eine Quellenzeile
 * steht in der Fußzeile (renderAntwort). Ohne (Prüfseite) die Liste wie
 * bisher: Seiten derselben Unterlage in einer Zeile, jede Zahl einzeln.
 */
function blockQuellen(b, ctx) {
  const items = Array.isArray(b.items) ? b.items : [];
  if (typeof ctx.oeffneWoher === "function") {
    const v = h("footer", { class: "blk blk-sources blk-versteckt", hidden: true, "aria-hidden": "true" });
    v.setAttribute("data-anzahl", String(items.length));
    return v;
  }
  const fuss = h("footer", { class: "blk blk-sources", "aria-label": "Quellen" });
  fuss.appendChild(h("p", { class: "quellen-kopf" }, ikon("buch", { groesse: 14 }), h("span", { text: "Quellen" }),
    items.length ? h("span", { class: "quellen-anzahl zahl", text: String(items.length) }) : null));
  if (!items.length) {
    fuss.appendChild(h("p", { class: "ohne-quelle", text: "Keine Quellen angegeben." }));
    return fuss;
  }
  fuss.appendChild(h("ul", { class: "quellen-zeilen" }, gruppiereQuellen(items).map(function (g) {
    const q = g.q;
    if (istUnterlage(q) && g.seiten.length) {
      const titel = dokumentTitel(q);
      return h("li", { class: "quellen-zeile", "data-quellen": g.seiten.map(function (s) { return s.id; }).join(" ") },
        ikon(QUELLEN_IKON[q.kind] || "buch", { groesse: 14 }),
        h("span", null, h("span", { class: "quellen-titel", text: titel }), ", S. ",
          g.seiten.map(function (s, i) {
            return [i > 0 ? ", " : null, quellenZiel(ctx, s.id, "quellen-seite", titel + ", S. " + s.page, String(s.page))];
          })));
    }
    const id = String(q.id || "");
    return h("li", { class: "quellen-zeile" },
      ikon(QUELLEN_IKON[q.kind] || "seite", { groesse: 14 }),
      quellenZiel(ctx, id, "quellen-link", null, quellenText(q)));
  })));
  return fuss;
}

const RENDERER = {
  text: blockText,
  warning: blockWarnung,
  system_card: blockSteckbrief,
  recurrence_alert: blockAlarm,
  fragebaum: blockFragebaum,
  questions: blockFragen,
  causes: blockUrsachen,
  image: blockBild,
  steps: blockSchritte,
  handover: blockUebergabe,
  actions: blockAktionen,
  auswahl: blockAuswahl,
  sources: blockQuellen,
};

function uebersprungen(typ) {
  return h("div", { hidden: true, class: "blk-uebersprungen", "data-typ": typ || "" });
}

/**
 * Einen Block darstellen. Wirft nie: Ein unbekannter Typ oder ein kaputter
 * Block wird übersprungen, der Rest der Antwort steht trotzdem.
 */
export function renderBlock(block, ctx) {
  const c = ctx || {};
  if (!c.quellen) c.quellen = new Map();
  const typ = block && typeof block === "object" ? block.type : undefined;
  if (!typ || !Object.prototype.hasOwnProperty.call(RENDERER, typ)) {
    console.warn("Unbekannter Blocktyp übersprungen:", typ, block);
    return uebersprungen(typ);
  }
  try {
    const knoten = RENDERER[typ](block, c);
    knoten.setAttribute("data-block", typ);
    return knoten;
  } catch (e) {
    console.warn("Block „" + typ + "“ konnte nicht dargestellt werden und wird übersprungen:", e, block);
    return uebersprungen(typ);
  }
}

/**
 * Reihenfolge absichern: Stopp-Boxen ganz oben, Quellen ganz unten. Der
 * Server sortiert bereits (SPEC 5.1) – hier nur die zweite Sicherung.
 */
function sortiere(bloecke) {
  const stopps = [];
  const mitte = [];
  const quellen = [];
  for (const b of bloecke) {
    if (b && b.type === "warning" && b.level === "stop") stopps.push(b);
    else if (b && b.type === "sources") quellen.push(b);
    else mitte.push(b);
  }
  return stopps.concat(mitte, quellen);
}

/**
 * Übergabe direkt hinter den ersten sichtbaren Text (Einleitungssatz) bzw.
 * hinter die Stopp-Boxen, wenn es keinen gibt. Stopp bleibt immer zuerst.
 */
function uebergabeNachVorn(bloecke, uebergabe) {
  const ohne = bloecke.filter(function (b) { return b !== uebergabe; });
  let nach = -1;
  ohne.forEach(function (b, i) {
    if (b && b.type === "warning" && b.level === "stop") nach = i;
  });
  for (let i = 0; i < ohne.length; i++) {
    const b = ohne[i];
    if (b && b.type === "text" && b.art !== "auswahl_ersatz" && b.art !== "rollenhinweis" && !ROLLENSATZ.test(String(b.content || ""))) {
      nach = Math.max(nach, i);
      break;
    }
  }
  ohne.splice(nach + 1, 0, uebergabe);
  return ohne;
}

/** Alle Quellen einer Antwort (aus dem sources-Block). */
export function quellenDerAntwort(antwort) {
  const liste = [];
  (antwort && Array.isArray(antwort.blocks) ? antwort.blocks : []).forEach(function (b) {
    if (b && b.type === "sources" && Array.isArray(b.items)) {
      b.items.forEach(function (q) {
        if (q && q.id) liste.push(q);
      });
    }
  });
  return liste;
}

/**
 * Fußzeile jeder Antwort (14.3.9): „Woher?“ und EINE Zeile mit höchstens drei
 * Kurznamen („Notiz Lorenzen · Vaillant S. 25, 39, 41 · +1“). Beides öffnet
 * dasselbe Blatt. Ohne Modell steht statt der Liste „Ohne KI“.
 */
function antwortFuss(antwort, ctx) {
  const woher = h("button", { type: "button", class: "woher", "aria-haspopup": "dialog" }, ikon("info", { groesse: 15 }), h("span", { text: "Woher?" }));
  woher.addEventListener("click", function () { ctx.oeffneWoher(woher); });
  let rechts = null;
  if (ohneModell(ctx)) {
    rechts = h("span", { class: "fuss-ohne-ki", text: "Ohne KI" });
  } else {
    const namen = kurznamenOhneDoppel(gruppiereQuellen(quellenDerAntwort(antwort)));
    if (namen.length) {
      const sichtbar = namen.slice(0, 3);
      const rest = namen.length - sichtbar.length;
      const zeile = sichtbar.join(" · ") + (rest > 0 ? " · +" + rest : "");
      rechts = h("button", { type: "button", class: "quellenzeile", title: "Quellen ansehen", "aria-haspopup": "dialog", text: zeile });
      rechts.addEventListener("click", function () { ctx.oeffneWoher(woher); });
    }
  }
  return h("footer", { class: "antwort-fuss" }, woher, rechts);
}

const SICHERHEIT = { hoch: "gut", mittel: "neutral", niedrig: "achtung" };

/** Hat der Fragebaum der Antwort Richtungen (14.10.3)? Sonst färbt der Pfad nichts. */
function baumMitRichtung(bloecke) {
  return bloecke.some(function (b) {
    return b && b.type === "fragebaum" && Array.isArray(b.knoten) && b.knoten.some(function (k) {
      return k && Array.isArray(k.antworten) && k.antworten.some(function (a) { return a && (a.richtung === "gut" || a.richtung === "schlecht" || a.richtung === "offen"); });
    });
  });
}

/**
 * Ganze Antwort: alle Blöcke in Server-Reihenfolge (Stopp zuerst), darunter
 * die Fußzeile „Woher?“ (App). Keine Kopfzeile „Assistent“ – Level und
 * Sicherheit stehen nur auf der Prüfseite (ohne akteDaneben).
 *
 * Ampel (14.10.5): Die Lage (antwort.lage) steht als Pille am Kopf der Antwort
 * und färbt einen dezenten Rand links (data-lage). Hat die Antwort einen
 * Fragebaum mit Richtungen, folgt die Pille dem Pfad beim Klicken – nie besser
 * als der Server. ctx.onLage(lage) erfährt jede Änderung (App: Kopf der
 * rechten Zone).
 */
export function renderAntwort(antwort, ctx) {
  const wurzelEl = h("div", { class: "b-antwort antwort-bloecke antwort" });
  if (!antwort || typeof antwort !== "object") {
    console.warn("Leere oder unlesbare Antwort:", antwort);
    wurzelEl.appendChild(h("p", { class: "antwort-text", text: "Keine Antwort erhalten." }));
    return wurzelEl;
  }
  const c = ctx || {};
  if (c.pfad) wurzelEl.setAttribute("data-pfad", String(c.pfad));

  const alleBloecke = Array.isArray(antwort.blocks) ? antwort.blocks : [];
  const serverLage = c.pfad === "vorab" ? null : lageVon(antwort);
  const mitPfad = c.pfad !== "vorab" && baumMitRichtung(alleBloecke);
  let lageEl = null;
  if (serverLage || mitPfad) {
    lageEl = lagePille(serverLage || RICHTUNG_LAGE.offen, "lage-antwort");
    if (!serverLage) lageSetzen(lageEl, null);
  }
  // Weniger Text (Mike): Sagt schon eine Karte dieser Antwort dasselbe – die
  // Stopp-Karte „Stopp“, die grüne Karte „Am Telefon lösbar“, die Übergabe „Für
  // den Techniker“ –, steht die Pille nicht noch einmal darüber (nur in der App;
  // der Rand links und die Pille im Kopf der rechten Zone bleiben).
  // Grün: Die grüne Karte steht immer offen da – auch mit Fragebaum (Gegenprüfung 12.10.).
  const sagtKarte = {
    rot: alleBloecke.some(istStopp),
    gruen: hatGrueneLoesung(antwort),
    gelb: alleBloecke.some(function (b) { return b && b.type === "handover"; }),
  };
  const lageZeigen = function (lage) {
    lageSetzen(lageEl, lage);
    if (lageEl) lageEl.classList.toggle("lage-doppelt", !!(c.akteDaneben && lage && serverLage && lage.farbe === serverLage.farbe && sagtKarte[lage.farbe]));
    if (lage) wurzelEl.setAttribute("data-lage", lage.farbe);
    else wurzelEl.removeAttribute("data-lage");
  };
  if (lageEl) lageZeigen(serverLage);

  if (!c.akteDaneben && c.pfad !== "vorab") {
    // Prüfseite: Level und Sicherheit als kleine Diagnose-Zeile, davor die Lage.
    const pillen = [];
    if (lageEl) pillen.push(lageEl);
    const fest = !!(c.pfad && c.pfad !== "modell");
    if (fest) pillen.push(h("span", { class: "pille pille-neutral", text: "ohne Modell" }));
    if (antwort.level && !fest) pillen.push(h("span", { class: "pille pille-neutral", text: "Level " + antwort.level }));
    if (antwort.confidence && !fest) pillen.push(h("span", { class: "pille pille-" + (SICHERHEIT[antwort.confidence] || "neutral"), text: "Sicherheit " + antwort.confidence }));
    if (pillen.length) wurzelEl.appendChild(h("div", { class: "antwort-kopfzeile" }, h("div", { class: "antwort-pillen" }, pillen)));
  } else if (lageEl) {
    wurzelEl.appendChild(lageEl);
  }

  let bloecke = sortiere(Array.isArray(antwort.blocks) ? antwort.blocks : []);
  const quellen = new Map();
  quellenDerAntwort(antwort).forEach(function (q) { quellen.set(String(q.id), q); });
  const uebergabe = bloecke.filter(function (b) { return b && b.type === "handover"; })[0] || null;
  const aktionen = bloecke.filter(function (b) { return b && b.type === "actions"; })[0] || null;
  const uebergabeAktion = uebergabe && aktionen && Array.isArray(aktionen.items)
    ? aktionen.items.filter(function (it) { return it && it.action === "create_handover"; })[0] || null
    : null;
  const mitBaum = bloecke.some(function (b) { return b && b.type === "fragebaum" && Array.isArray(b.knoten) && b.knoten.length; });
  // Rollenhinweis + Übergabe: Die Arbeit macht der Techniker. Dann steht das
  // Einzige, was der Anrufer-Kollege selbst tun kann – „Für den Techniker ·
  // Übergeben“ –, direkt unter dem Einleitungssatz, vor den Lösungen
  // (Gegenprüfung 09.10.: sonst las Mike „Heizkreis drucklos machen“ als
  // Auftrag an die Kundin, und die Übergabe lag bei 390 px unter dem Rand).
  const fuerTechniker = !!uebergabe && bloecke.some(function (b) {
    return b && b.type === "text" && (b.art === "rollenhinweis" || ROLLENSATZ.test(String(b.content || "")));
  });
  if (fuerTechniker && c.akteDaneben) bloecke = uebergabeNachVorn(bloecke, uebergabe);
  const innen = Object.assign({}, c, {
    quellen: quellen,
    mitBaum: mitBaum,
    mitUebergabe: !!uebergabe,
    uebergabeAktion: uebergabeAktion,
    fuerTechniker: fuerTechniker,
    // Akinator: erst die Fragen. Bringt eine Antwort Fragebaum UND Lösungen
    // (Regeltreffer, „woran liegt es?“), liegen die Lösungen zu (nur App).
    loesungenZu: !!(mitBaum && c.akteDaneben && c.pfad !== "vorab"),
    // Neben einer Stopp-Box wird nichts grün (14.10.3 Punkt 2).
    mitStopp: alleBloecke.some(istStopp),
    // Fragebaum → Pille: der Pfad färbt mit, der Server deckelt.
    lagePfad: mitPfad && lageEl ? function (pfad) {
      const lage = lageKombiniert(serverLage, pfad);
      lageZeigen(lage);
      if (typeof c.onLage === "function") c.onLage(lage);
    } : null,
  });
  let i = 0;
  for (const b of bloecke) {
    const knoten = renderBlock(b, innen);
    wurzelEl.appendChild(knoten);
    if (!knoten.hidden && c.einblenden !== false) {
      einblenden(knoten, i);
      i += 1;
    }
  }
  if (typeof c.oeffneWoher === "function" && c.pfad !== "vorab") wurzelEl.appendChild(antwortFuss(antwort, innen));
  return wurzelEl;
}
