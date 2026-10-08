// ============================================================================
// bloecke.js  ·  Renderer für die Antwortblöcke (SPEC 5.1 und 8)
// ----------------------------------------------------------------------------
// Die Blöcke SIND das Produkt (Plan Pos. 2): Ein Fließtext-Chat beweist nichts,
// was ein ChatGPT-Ordner nicht auch kann. Deshalb bekommt jeder Blocktyp eine
// eigene, ruhige Darstellung – und die Prüfseite nutzt genau denselben
// Renderer, damit „grün auf der Prüfseite“ auch „richtig in der Demo“ heißt.
//
// Vertrag (SPEC 8):
//   renderAntwort(antwort, ctx) → HTMLElement   (Badges + alle Blöcke)
//   renderBlock(block, ctx)     → HTMLElement
//   ctx = { rolle, onAktion(item) → Promise<Block|null>, onAntworten(text),
//           ladeBild(id) → Promise<string> }
// Jeder Teil von ctx darf fehlen (Prüfseite, Tests) – dann werden die
// betroffenen Knöpfe deaktiviert, statt dass etwas wirft.
//
// Grundsätze, die hier überall gelten:
//   - Nie innerHTML mit Server- oder Modelltext. Alles über textContent.
//   - Ein unbekannter oder kaputter Block wird still übersprungen
//     (console.warn), nie die ganze Antwort. Ein neuer Blocktyp im Backend
//     darf das Frontend in einer Live-Demo nicht umwerfen.
//   - Keine Lookbehind-Regex, keine benannten Fanggruppen, kein `?.`/`??`:
//     Safari unter 16.4 wirft schon beim Einlesen der Datei einen
//     SyntaxError, und dann lädt nicht ein Teil nicht, sondern gar nichts
//     (bezahlter Fehler aus dem Matari-Widget).
// ============================================================================

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
 * Ursachen-Kategorien je Symptomkategorie für „Ursache dokumentieren“.
 *
 * Der Server führt die verbindliche Liste (SPEC 7, `document_cause`) und
 * schickt sie im payload mit (`ursache_optionen: [{key, label}]`, inklusive
 * „sonstige“) – dann gilt seine, denn nur gegen genau diese Liste nimmt die
 * Function aktion an. Diese hier ist nur die Rückfallebene, damit das
 * Formular nicht leer bleibt – mit
 * denselben Schlüsseln wie im Seed (SPEC 3), sonst zählt eine dokumentierte
 * Ursache nie in die Evidenz-Badges.
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
    ["querschnitt_1_5mm2_fremdinstallation", "Querschnitt 1,5 mm² (Fremdinstallation)"],
  ],
  wr_isolationsfehler: [
    ["steckverbinder_feuchtigkeit", "Feuchtigkeit im Steckverbinder"],
    ["kabelschaden_tierverbiss", "Kabelschaden durch Tierverbiss"],
    ["modul_defekt", "Modul defekt"],
  ],
};

const KOMPONENTEN = {
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

const KANAELE = { app: "App", telefon: "Telefon", mail: "Mail" };
const STATUS = { offen: "offen", in_bearbeitung: "in Bearbeitung", geschlossen: "geschlossen" };
const MASSNAHME_ART = {
  symptom: "Symptombehandlung",
  diagnose: "Diagnose",
  ursache_behoben: "Ursache behoben",
  sonstiges: "Sonstiges",
};

const QUELLEN_ARTEN = {
  handbuch: "Handbuch",
  installationsanleitung: "Installationsanleitung",
  datenblatt: "Datenblatt",
  sop: "SOP",
  eskalationsmatrix: "Eskalationsmatrix",
  meister_notiz: "Meister-Notiz",
  ticket: "Ticket",
};

/**
 * Bekannte Komponenten-Attribute: [Bezeichnung, Einheit].
 * Unbekannte Schlüssel bekommen eine Bezeichnung aus dem Schlüssel selbst –
 * der Seed darf Attribute ergänzen, ohne dass hier etwas fehlt.
 */
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
  steckverbinder_gemischt: ["Steckverbinder gemischt"],
};

/**
 * Welche Attributwerte auffallen sollen. Das sind die Stellen, an denen die
 * Geschichte der Demo hängt: „Vordruck nicht erfasst“ bei A-1042 und
 * „eigener Stromkreis: nein“ bei A-2177. Ein Fachmann soll sie im Steckbrief
 * sehen, bevor das Modell sie erwähnt.
 */
function istAuffaellig(schluessel, wert) {
  if (wert === null || wert === undefined || wert === "") return true;
  if (schluessel === "eigener_stromkreis" && wert === false) return true;
  if (schluessel === "steckverbinder_gemischt" && wert === true) return true;
  return false;
}

/** Was eine Aktion mindestens an Rolle braucht (SPEC 7, `aktion`). */
const AKTION_ROLLE_MIN = { document_cause: "techniker", close_ticket: "techniker" };

// --- Kleine Werkzeuge --------------------------------------------------------

/**
 * Element bauen. attrs: class, text, on<Ereignis>, sonst Attribute.
 * `false`/`null` lassen ein Attribut weg, `true` setzt es leer.
 */
export function el(tag, attrs, kinder) {
  const knoten = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") knoten.className = v;
      else if (k === "text") knoten.textContent = String(v);
      else if (k.slice(0, 2) === "on" && typeof v === "function") {
        knoten.addEventListener(k.slice(2), v);
      } else if (v === true) knoten.setAttribute(k, "");
      else knoten.setAttribute(k, String(v));
    }
  }
  anhaengen(knoten, kinder);
  return knoten;
}

export function anhaengen(knoten, kinder) {
  if (kinder === null || kinder === undefined) return knoten;
  const liste = Array.isArray(kinder) ? kinder : [kinder];
  for (const k of liste) {
    if (k === null || k === undefined || k === false || k === "") continue;
    if (Array.isArray(k)) anhaengen(knoten, k);
    else if (typeof k === "string" || typeof k === "number") {
      knoten.appendChild(document.createTextNode(String(k)));
    } else knoten.appendChild(k);
  }
  return knoten;
}

export function leeren(knoten) {
  while (knoten.firstChild) knoten.removeChild(knoten.firstChild);
  return knoten;
}

/**
 * Markdown-Reste entfernen.
 *
 * Der Prompt verbietet `**` und `#`, aber ein Modell hält sich daran nicht
 * mit letzter Sicherheit – und dann steht „**Vordruck**“ wörtlich im Block
 * und sieht aus wie ein Fehler. Beim Matari-Bot hat erst die zweite
 * Sicherung im Browser das Problem erledigt; eine Stelle allein reichte
 * nicht. Bewusst KEIN Umwandeln in <strong>: Formatierung kommt aus dem
 * Blocktyp, nicht aus dem Text.
 *
 * Ohne Lookbehind: (.*?[^\s]) fängt das letzte Zeichen mit ein und erzwingt
 * so, dass es kein Leerzeichen ist (Safari < 16.4, siehe Dateikopf).
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

/**
 * Deutsche Typografie für Texte, die nicht von uns stammen: geschütztes
 * Leerzeichen zwischen Zahl und Einheit („0,6 bar“ bricht sonst am
 * Zeilenende auseinander, ausgerechnet auf dem Handy im Heizungskeller) und
 * nach „S.“ vor einer Seitenzahl. Lookahead statt \b, weil „mm²“ mit einem
 * Nicht-Wortzeichen endet und \b dort nie greift.
 *
 * Gerade Anführungszeichen aus dem Modelltext („Ursache 'Luft im System'“)
 * werden zu deutschen – nur paarweise und nur an Wortgrenzen, damit ein
 * Apostroph wie in „geht's“ bleibt, wie er ist.
 */
export function typo(text) {
  return String(text)
    .replace(
      /(\d) (bar|kWh|kWp|kW|mm²|mm2|°C|A|V|W|Hz|Tagen|Tage|Tag|Stunden|Std\.|min|%|Tickets|Ticket|Fällen|Fälle)(?=$|[\s.,;:!?)\]–-])/g,
      "$1 $2",
    )
    .replace(/(^|[\s(])S\. (\d)/g, "$1S. $2")
    .replace(/(^|[\s(\[–])"([^"\n]+)"(?=$|[\s.,;:!?)\]–])/g, "$1„$2“")
    .replace(/(^|[\s(\[–])'([^'\n]+)'(?=$|[\s.,;:!?)\]–])/g, "$1‚$2‘");
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
    const p = el("p", { class: klasse || null });
    const zeilen = t.split("\n");
    zeilen.forEach(function (z, i) {
      if (i > 0) p.appendChild(el("br"));
      p.appendChild(document.createTextNode(z));
    });
    ergebnis.push(p);
  }
  return ergebnis;
}

let datumsformat = null;
function berlinFormat() {
  if (datumsformat) return datumsformat;
  try {
    datumsformat = new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch (e) {
    // Sehr alte Browser kennen timeZone nicht – dann eben Ortszeit.
    datumsformat = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  return datumsformat;
}

/**
 * Datum als 06.10.2026.
 *
 * Reine Kalenderdaten („2025-04-15“) werden von Hand zerlegt, NICHT über
 * new Date(): Das liest sie als Mitternacht UTC, und in jeder Zeitzone
 * westlich von Greenwich stünde dann der Vortag im Steckbrief.
 * Zeitstempel gehen über Europe/Berlin – dieselbe Tagesgrenze wie im SQL
 * (SPEC 2), sonst rechnet der Server „34 Tage“ und hier steht ein anderes
 * Datum daneben.
 */
export function datum(wert) {
  if (wert === null || wert === undefined || wert === "") return "";
  const s = String(wert);
  const tag = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (tag) return tag[3] + "." + tag[2] + "." + tag[1];
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return berlinFormat().format(d);
}

let zahlformat = null;
export function zahl(n) {
  if (!zahlformat) zahlformat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
  return zahlformat.format(n);
}

function mitEinheit(n, einheit) {
  return einheit ? zahl(n) + " " + einheit : zahl(n);
}

/** „1 Tag“, „16 Tagen“ – mit geschütztem Leerzeichen. */
function tageText(n, dativ) {
  if (n === 1) return "1 Tag";
  return zahl(n) + " " + (dativ ? "Tagen" : "Tage");
}

function rang(rolle) {
  return ROLLEN_RANG[rolle] || 0;
}

function badge(text, klasse, titel) {
  return el("span", { class: "b-badge" + (klasse ? " " + klasse : ""), title: titel || null, text: text });
}

/**
 * Feste, selbst geschriebene SVG-Symbole. innerHTML ist hier unbedenklich:
 * Der Inhalt ist eine Konstante dieser Datei, nie Server- oder Modelltext.
 */
const SYMBOLE = {
  stop:
    '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">' +
    '<path d="M7.6 1.5h8.8l6.1 6.1v8.8l-6.1 6.1H7.6l-6.1-6.1V7.6z" fill="currentColor"/>' +
    '<rect x="5.5" y="10.5" width="13" height="3" rx="1" fill="#fff"/></svg>',
  caution:
    '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">' +
    '<path d="M12 2 23 21H1z" fill="currentColor"/>' +
    '<rect x="10.8" y="8" width="2.4" height="7" rx="1" fill="#fff"/>' +
    '<circle cx="12" cy="17.6" r="1.4" fill="#fff"/></svg>',
  info:
    '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">' +
    '<circle cx="12" cy="12" r="11" fill="currentColor"/>' +
    '<rect x="10.8" y="10" width="2.4" height="8" rx="1" fill="#fff"/>' +
    '<circle cx="12" cy="6.8" r="1.5" fill="#fff"/></svg>',
  wiederholung:
    '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">' +
    '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 4v6h-6l2.3-2.3A6 6 0 1 0 18 12h2a8 8 0 0 1-16 0z" fill="currentColor"/></svg>',
};

function symbol(name) {
  const span = el("span", { class: "b-symbol" });
  span.innerHTML = SYMBOLE[name] || "";
  return span;
}

// --- Quellen -----------------------------------------------------------------

/** Ein Titel, der schon sagt, was für ein Dokument er ist. */
const DOKUMENT_WORT = /handbuch|anleitung|datenblatt|matrix|\bsop\b/i;

/**
 * Anzeige einer Quelle: „Installationsanleitung WP …, S. 23“,
 * „Meister-Notiz MN-07 – Druckverlust …“, „Ticket T-2026-0812 vom 02.09.2026“.
 * Die Q-Nummern (Q7) sind eine interne Zählung des Präfixes und sagen einem
 * Fachmann nichts – sie erscheinen nur als Tooltip.
 */
function quellenText(q) {
  const art = QUELLEN_ARTEN[q.kind] || "";
  const titel = q.title ? satz(q.title).trim() : "";
  const id = q.id ? String(q.id) : "";
  if (q.kind === "meister_notiz" || q.kind === "ticket") {
    const kopf = (art ? art + " " : "") + id;
    if (!titel || titel === id) return kopf;
    // „Ticket vom 02.09.2026“ wird zu „Ticket T-… vom 02.09.2026“, ohne die
    // Art doppelt zu nennen.
    if (art && titel.toLowerCase().indexOf(art.toLowerCase()) === 0) {
      let rest = titel.slice(art.length).trim();
      if (id && rest.indexOf(id) === 0) rest = rest.slice(id.length).trim();
      return rest ? kopf + " " + rest : kopf;
    }
    if (id && titel.indexOf(id) === 0) return (art ? art + " " : "") + titel;
    return kopf + " – " + titel;
  }
  const text = dokumentTitel(q);
  return typeof q.page === "number" ? text + ", S. " + q.page : text;
}

/** Titel einer Unterlage ohne Seite – mit Dokumentart, wenn der Titel sie nicht schon nennt. */
function dokumentTitel(q) {
  const art = QUELLEN_ARTEN[q.kind] || "";
  // Sagt der Titel schon, was er ist („Bedienungsanleitung …“), nicht
  // davorsetzen – sonst liest man „Handbuch Bedienungsanleitung …“.
  let text = q.title ? satz(q.title).trim() : String(q.id || "");
  if (art && !DOKUMENT_WORT.test(text)) text = art + " " + text;
  return text;
}

function istUnterlage(q) {
  return !!q && q.kind !== "meister_notiz" && q.kind !== "ticket";
}

/**
 * Quellen gleicher Unterlage zusammenfassen: [{q, seiten:[29, 34], ids:[…]}].
 * Drei Chips „KeContact P30 … S. 29/34/59“ sahen live gleich aus, weil die
 * Seite abgeschnitten war – eine Unterlage, alle Seiten, ist kürzer und klarer.
 */
function gruppiereQuellen(liste) {
  const gruppen = [];
  const nachTitel = new Map();
  for (const q of liste) {
    if (!istUnterlage(q) || !q.title) {
      gruppen.push({ q: q, seiten: typeof q.page === "number" ? [q.page] : [], ids: [String(q.id || "")] });
      continue;
    }
    const schluessel = q.kind + "|" + q.title;
    let g = nachTitel.get(schluessel);
    if (!g) {
      g = { q: q, seiten: [], ids: [] };
      nachTitel.set(schluessel, g);
      gruppen.push(g);
    }
    if (typeof q.page === "number" && g.seiten.indexOf(q.page) === -1) g.seiten.push(q.page);
    g.ids.push(String(q.id || ""));
  }
  gruppen.forEach(function (g) {
    g.seiten.sort(function (a, b) {
      return a - b;
    });
  });
  return gruppen;
}

function seitenText(seiten) {
  return seiten.length ? "S. " + seiten.join(", ") : "";
}

/** Chip-Inhalt: Titel kürzt sich mit „…“, die Seite steht daneben und kürzt sich nie. */
function quellenChip(titel, seite, lang) {
  return el("li", { class: "b-quelle-chip", title: lang }, [
    el("span", { class: "b-chip-titel", text: titel }),
    seite ? el("span", { class: "b-chip-seite", text: ", " + seite }) : null,
  ]);
}

/**
 * Quellen-Chips eines Blocks – oder sichtbar „ohne Quelle“.
 * Prinzip 6: Was keine Quelle hat, wird markiert, nicht verschwiegen. Der
 * Post-Validator lässt ein Item ohne gültige Quelle stehen, setzt aber
 * source_ids auf [] (SPEC 5.3) – genau dafür ist diese Markierung da.
 */
function quellenChips(ids, ctx) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return el("p", { class: "b-ohnequelle" }, [
      el("span", { class: "b-ohnequelle-marke", text: "ohne Quelle" }),
      " Keine Unterlage, Notiz oder Ticket belegt diesen Punkt.",
    ]);
  }
  const liste = el("ul", { class: "b-chips-quellen", "aria-label": "Quellen" });
  const bekannt = [];
  for (const roh of ids) {
    const id = String(roh);
    const q = ctx.quellen && ctx.quellen.get ? ctx.quellen.get(id) : null;
    if (!q) liste.appendChild(quellenChip(id, "", id));
    else if (!istUnterlage(q)) liste.appendChild(quellenChip(id, "", quellenText(q)));
    else bekannt.push(q);
  }
  gruppiereQuellen(bekannt).forEach(function (g) {
    const titel = dokumentTitel(g.q);
    const seite = seitenText(g.seiten);
    liste.appendChild(quellenChip(titel, seite, titel + (seite ? ", " + seite : "")));
  });
  return liste;
}

// --- Blöcke ------------------------------------------------------------------

function blockText(b) {
  const box = el("div", { class: "b-block b-text" });
  anhaengen(box, absaetze(b.content || ""));
  return box;
}

const WARN_STUFEN = {
  stop: { name: "Stopp", symbol: "stop" },
  caution: { name: "Achtung", symbol: "caution" },
  info: { name: "Hinweis", symbol: "info" },
};

/**
 * warning in drei Stufen. Stopp ist bewusst nicht einklappbar und hat kein
 * Schließen: Die Box stammt aus der Regel-Engine des Servers, nicht aus der
 * Tagesform des Modells (Prinzip 5) – sie soll stehen bleiben.
 * „Entwurf“ heißt fachlich_geprueft = false; das wird im Termin offen gesagt,
 * also steht es auch offen in der Box (Plan, Mo 12.10.).
 */
function blockWarnung(b) {
  const stufe = WARN_STUFEN[b.level] ? b.level : "info";
  const art = WARN_STUFEN[stufe];
  const titel = satz(b.title || art.name);
  const box = el("section", {
    class: "b-block b-warnung b-" + stufe,
    role: stufe === "stop" ? "alert" : "note",
    "aria-label": art.name + ": " + titel,
  });
  const kopf = el("div", { class: "b-warnung-kopf" }, [
    symbol(art.symbol),
    el("div", { class: "b-warnung-titelzeile" }, [
      el("span", { class: "b-warnung-stufe", text: art.name }),
      el("h3", { class: "b-warnung-titel", text: titel }),
    ]),
    el("div", { class: "b-warnung-marken" }, [
      b.rule_id ? badge("Regel " + b.rule_id, "b-badge-regel") : null,
      b.entwurf ? badge("Entwurf – fachlich nicht freigegeben", "b-badge-entwurf") : null,
    ]),
  ]);
  box.appendChild(kopf);
  anhaengen(box, absaetze(b.content || "", "b-warnung-text"));
  if (b.alternative) {
    box.appendChild(
      el("p", { class: "b-alternative" }, [el("strong", { text: "Stattdessen: " }), satz(b.alternative)]),
    );
  }
  if (b.norm_ref) {
    box.appendChild(el("p", { class: "b-norm" }, [el("span", { text: "Normverweis: " }), satz(b.norm_ref)]));
  }
  if (b.beleg) {
    // Daten-Trigger (R09, R10) belegen aus den Anlagendaten, nicht aus der
    // Frage; der Server schreibt diesen Beleg immer als „A-1042: …“. Stünde
    // dort „Erkannt in der Frage“, zitierte die Box vor dem Fachmann einen
    // Satz, den niemand gesagt hat.
    const ausDaten = /^A-\d{4}: /.test(String(b.beleg));
    box.appendChild(
      el("p", {
        class: "b-beleg",
        text: ausDaten ? "Beleg aus der Datenbank: " + String(b.beleg) : "Erkannt in der Frage: „" + String(b.beleg) + "“",
      }),
    );
  }
  return box;
}

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
  else if (typeof wert === "number") wertText = mitEinheit(wert, einheit);
  else if (Array.isArray(wert)) wertText = wert.map(String).join(", ") || "keine";
  else if (typeof wert === "object") wertText = JSON.stringify(wert);
  else if (/^\d{4}-\d{2}-\d{2}/.test(String(wert))) wertText = datum(wert);
  else wertText = typo(String(wert));
  return { bezeichnung: bezeichnung, wert: wertText };
}

/**
 * Tabellenzelle. Leere Werte („–“) bekommen eine Klasse, damit sie auf dem
 * Handy wegfallen dürfen – dort wird jede Zeile zur Karte, und fünf Striche
 * je Komponente machen den Steckbrief doppelt so lang.
 */
function zelle(beschriftung, inhalt) {
  const leer = inhalt === "–" || inhalt === "" || inhalt === null || inhalt === undefined;
  return el("td", { "data-label": beschriftung, class: leer ? "b-zelle-leer" : null }, leer ? "–" : inhalt);
}

/**
 * system_card als Steckbrief. Die Daten kommen vollständig im Block mit
 * (SPEC 5.1) – kein Nachladen, damit der Steckbrief in der Vorab-Stufe nach
 * zwei Sekunden steht und nicht noch einmal auf das Netz wartet.
 */
function blockSteckbrief(b, ctx) {
  const a = b.anlage || {};
  const id = b.anlage_id || a.id || "";
  // Folgt ein Wiederholungs-Alarm derselben Anlage, stehen die Tickets dort
  // mit Zeitleiste; auf dem Handy entfällt die Liste hier dann (app.css).
  const mitAlarm = !!(ctx && ctx.alarmFuer && ctx.alarmFuer.indexOf(id) !== -1);
  const box = el("section", {
    class: "b-block b-karte b-steckbrief" + (mitAlarm ? " b-steckbrief-mit-alarm" : ""),
    "aria-label": "Steckbrief Anlage " + id,
  });

  const ortText = [a.plz, a.ort].filter(Boolean).join(" ");
  box.appendChild(
    el("header", { class: "b-karte-kopf" }, [
      el("h3", { class: "b-karte-titel" }, [
        el("span", { class: "b-kennung", text: "Anlage " + id }),
        a.kunde_alias ? el("span", { class: "b-karte-unter", text: a.kunde_alias }) : null,
      ]),
      ortText ? el("span", { class: "b-karte-ort", text: ortText }) : null,
    ]),
  );

  const fakten = el("dl", { class: "b-fakten" });
  const fakt = function (dt, dd) {
    fakten.appendChild(el("div", null, [el("dt", { text: dt }), el("dd", { text: dd || "–" })]));
  };
  fakt("Inbetriebnahme", datum(a.inbetriebnahme));
  fakt("Montage-Team", a.montage_team);
  fakt("Standort", a.standort);

  const komponenten = Array.isArray(a.komponenten) ? a.komponenten : [];
  // Firmware ist im Seed bewusst überall NULL (keine erfundenen
  // Versionsnummern echter Produkte, SPEC 3), Garantie nur mit Beleg. Eine
  // Spalte voller Striche sähe nach Attrappe aus – also nur zeigen, wenn es
  // Werte gibt. Die Garantie bleibt sichtbar: als Fakt „nicht hinterlegt“.
  const mitFirmware = komponenten.some(function (k) {
    return k && k.firmware;
  });
  const mitGarantie = komponenten.some(function (k) {
    return k && k.garantie_bis;
  });
  if (komponenten.length && !mitGarantie) fakt("Garantie", "nicht hinterlegt");
  box.appendChild(fakten);

  if (komponenten.length) {
    const spalten = ["Komponente", "Hersteller / Modell", "Seriennummer"];
    if (mitFirmware) spalten.push("Firmware");
    spalten.push("Installiert");
    if (mitGarantie) spalten.push("Garantie bis");
    spalten.push("Details");
    const kopfzeile = el("tr", null, spalten.map(function (s) {
      return el("th", { scope: "col", text: s });
    }));
    const rumpf = el("tbody");
    // Auf dem Handy (≤ 600 px) statt der Tabelle: je Komponente eine
    // aufklappbare Zeile. Als Tabelle war der Steckbrief dort über 1000 px
    // hoch, und der Wiederholungs-Alarm – der Kernbeweis – kam erst nach mehr
    // als einem Bildschirm. Welche Ansicht gilt, entscheidet allein das CSS.
    const kompListe = el("div", { class: "b-komp-liste" });
    for (const k of komponenten) {
      if (!k) continue;
      const typ = KOMPONENTEN[k.typ] || k.typ || "Komponente";
      const name = [k.bezeichnung && k.bezeichnung !== typ ? k.bezeichnung : null].filter(Boolean);
      const herstellerModell = [k.hersteller, k.modell].filter(Boolean).join(" · ");
      const attrs = k.attribute && typeof k.attribute === "object" ? k.attribute : {};
      const details = el("ul", { class: "b-attribute" });
      for (const schluessel of Object.keys(attrs)) {
        const t = attributText(schluessel, attrs[schluessel]);
        details.appendChild(
          el("li", { class: istAuffaellig(schluessel, attrs[schluessel]) ? "b-auffaellig" : null }, [
            el("span", { class: "b-attr-name", text: t.bezeichnung + ": " }),
            t.wert,
          ]),
        );
      }
      const zellen = [
        zelle("Komponente", [
          el("strong", { text: typ }),
          name.length ? el("span", { class: "b-unterzeile", text: name[0] }) : null,
          k.installiert_von && k.installiert_von !== "eigenes Team"
            ? badge(k.installiert_von, "b-badge-fremd", "Installiert von: " + k.installiert_von)
            : null,
        ]),
        zelle("Hersteller / Modell", herstellerModell || "–"),
        zelle("Seriennummer", k.seriennummer ? el("span", { class: "b-mono", text: k.seriennummer }) : "–"),
      ];
      if (mitFirmware) zellen.push(zelle("Firmware", k.firmware || "–"));
      zellen.push(zelle("Installiert", datum(k.installiert_am) || "–"));
      if (mitGarantie) zellen.push(zelle("Garantie bis", datum(k.garantie_bis) || "–"));
      zellen.push(zelle("Details", details.childNodes.length ? details.cloneNode(true) : "–"));
      rumpf.appendChild(el("tr", null, zellen));
      kompListe.appendChild(komponenteKompakt(k, typ, herstellerModell, details, mitFirmware, mitGarantie));
    }
    box.appendChild(
      el("div", { class: "b-tabelle-rahmen" }, [
        el("table", { class: "b-tabelle" }, [
          el("caption", { class: "unsichtbar", text: "Komponenten der Anlage " + id }),
          el("thead", null, kopfzeile),
          rumpf,
        ]),
      ]),
    );
    box.appendChild(kompListe);
  }

  const tickets = Array.isArray(a.letzte_tickets) ? a.letzte_tickets.slice(0, 3) : [];
  if (tickets.length) {
    const liste = el("ul", { class: "b-ticketliste" });
    for (const t of tickets) {
      liste.appendChild(
        el("li", null, [
          el("span", { class: "b-ticket-datum", text: datum(t.erstellt_am) }),
          el("span", { class: "b-kennung b-mono", text: t.id }),
          el("span", { class: "b-ticket-symptom", text: satz(t.symptom) }),
          statusBadge(t.status),
        ]),
      );
    }
    box.appendChild(el("h4", { class: "b-zwischentitel b-letzte-tickets", text: "Letzte Tickets" }));
    liste.classList.add("b-letzte-tickets");
    box.appendChild(liste);
  }
  return box;
}

/**
 * Eine Komponente als aufklappbare Zeile (Handy). In der Zusammenfassung
 * steht, was auffällt („Vordruck: nicht erfasst“) – die Stellen, an denen die
 * Geschichte der Demo hängt, sollen ohne Aufklappen zu sehen sein.
 */
function komponenteKompakt(k, typ, herstellerModell, details, mitFirmware, mitGarantie) {
  const attrs = k.attribute && typeof k.attribute === "object" ? k.attribute : {};
  const auffaellig = Object.keys(attrs).filter(function (s) {
    return istAuffaellig(s, attrs[s]);
  }).map(function (s) {
    const t = attributText(s, attrs[s]);
    return t.bezeichnung + ": " + t.wert;
  });
  const fremd = k.installiert_von && k.installiert_von !== "eigenes Team";
  const kopf = el("summary", { class: "b-komp-kopf" }, [
    el("strong", { text: typ }),
    herstellerModell ? el("span", { class: "b-komp-modell", text: herstellerModell }) : null,
    fremd ? badge(k.installiert_von, "b-badge-fremd", "Installiert von: " + k.installiert_von) : null,
    auffaellig.length ? el("span", { class: "b-komp-auffaellig b-auffaellig", text: auffaellig.join(" · ") }) : null,
  ]);
  const daten = el("dl", { class: "b-komp-daten" });
  const zeile = function (dt, dd) {
    if (dd === null || dd === undefined || dd === "") return;
    daten.appendChild(el("div", null, [el("dt", { text: dt }), el("dd", null, dd)]));
  };
  if (k.bezeichnung && k.bezeichnung !== typ) zeile("Bezeichnung", k.bezeichnung);
  zeile("Seriennummer", k.seriennummer ? el("span", { class: "b-mono", text: k.seriennummer }) : null);
  if (mitFirmware) zeile("Firmware", k.firmware);
  zeile("Installiert", datum(k.installiert_am));
  if (mitGarantie) zeile("Garantie bis", datum(k.garantie_bis));
  if (details.childNodes.length) zeile("Details", details);
  return el("details", { class: "b-komp" }, [kopf, daten]);
}

function statusBadge(status) {
  if (!status) return null;
  return badge(STATUS[status] || status, "b-status b-status-" + status);
}

/**
 * recurrence_alert mit Zeitleiste. Jede Zahl hier stammt aus SQL
 * (ticket_count, window_days, rueckkehr_tage) – das Modell liefert keine
 * einzige (Prinzip 4). Die Hypothese ist eine Servervorlage, kein Modelltext.
 */
function blockAlarm(b, ctx) {
  const box = el("section", { class: "b-block b-karte b-alarm", "aria-label": "Wiederholungs-Alarm" });
  const kategorie = SYMPTOM_KATEGORIEN[b.symptom_kategorie] || b.symptom_kategorie || "";
  box.appendChild(
    el("header", { class: "b-alarm-kopf" }, [
      symbol("wiederholung"),
      el("div", null, [
        el("h3", { class: "b-alarm-titel", text: "Wiederholungs-Alarm" }),
        el("p", { class: "b-alarm-unter", text: [b.anlage_id, kategorie].filter(Boolean).join(" · ") }),
      ]),
    ]),
  );

  const kennzahl = el("p", { class: "b-alarm-zahl" });
  if (typeof b.ticket_count === "number") {
    kennzahl.appendChild(el("strong", { text: zahl(b.ticket_count) + " Tickets" }));
    if (typeof b.window_days === "number") {
      kennzahl.appendChild(
        document.createTextNode(
          b.window_days === 0 ? " am selben Tag" : " in " + tageText(b.window_days, true),
        ),
      );
    }
  }
  if (b.cause_verified === false) kennzahl.appendChild(badge("Ursache nicht bestätigt", "b-badge-alarm"));
  box.appendChild(kennzahl);

  const tickets = Array.isArray(b.tickets) ? b.tickets : [];
  const rueckkehr = Array.isArray(b.rueckkehr_tage) ? b.rueckkehr_tage : [];
  if (tickets.length) {
    const leiste = el("ol", { class: "b-zeitleiste" });
    tickets.forEach(function (t, i) {
      if (i > 0) {
        const tage = rueckkehr[i - 1];
        if (typeof tage === "number") {
          leiste.appendChild(
            el("li", { class: "b-zl-rueckkehr" }, [
              el("span", { text: "Rückkehr nach " + tageText(tage, true) }),
            ]),
          );
        }
      }
      const massnahmen = Array.isArray(t.massnahmen) ? t.massnahmen : [];
      const mListe = massnahmen.length
        ? el(
          "ul",
          { class: "b-zl-massnahmen" },
          massnahmen.map(function (m) {
            const wer = [m.von, m.vor_ort ? "vor Ort" : null].filter(Boolean).join(", ");
            return el("li", null, [
              el("span", { class: "b-zl-mdatum", text: datum(m.datum) }),
              wer ? el("span", { class: "b-zl-wer", text: wer }) : null,
              el("span", { class: "b-zl-mtext", text: satz(m.text) }),
              m.art
                ? badge(MASSNAHME_ART[m.art] || m.art, m.art === "symptom" ? "b-badge-symptom" : null)
                : null,
            ]);
          }),
        )
        : el("p", { class: "b-zl-leer", text: t.status === "geschlossen" ? "Keine Maßnahme erfasst." : "Noch keine Maßnahme." });
      leiste.appendChild(
        el("li", { class: "b-zl-ticket" + (t.status === "geschlossen" ? "" : " b-zl-offen") }, [
          el("div", { class: "b-zl-kopf" }, [
            el("span", { class: "b-zl-datum", text: datum(t.erstellt_am) }),
            t.kanal ? el("span", { class: "b-zl-kanal", text: KANAELE[t.kanal] || t.kanal }) : null,
            el("span", { class: "b-kennung b-mono", text: t.id }),
            // „geschlossen | geschlossen 03.09.2026“ stand live doppelt da:
            // Bei geschlossenen Tickets trägt das Badge das Datum gleich mit.
            t.status === "geschlossen" && t.geschlossen_am
              ? badge("geschlossen " + datum(t.geschlossen_am), "b-status b-status-geschlossen")
              : statusBadge(t.status),
          ]),
          t.symptom ? el("p", { class: "b-zl-symptom", text: "„" + satz(t.symptom) + "“" }) : null,
          mListe,
        ]),
      );
    });
    box.appendChild(leiste);
  } else if (Array.isArray(b.previous_actions) && b.previous_actions.length) {
    // Rückfallebene: Ohne Ticketliste wenigstens die bisherigen Maßnahmen.
    box.appendChild(el("h4", { class: "b-zwischentitel", text: "Bisherige Maßnahmen" }));
    box.appendChild(el("ul", { class: "b-liste" }, b.previous_actions.map(function (p) {
      return el("li", { text: satz(p) });
    })));
  }

  if (b.hypothesis) {
    box.appendChild(el("p", { class: "b-hypothese" }, [el("strong", { text: "Einschätzung: " }), satz(b.hypothesis)]));
  }
  if (Array.isArray(b.source_ids) && b.source_ids.length) box.appendChild(quellenChips(b.source_ids, ctx));
  return box;
}

/**
 * questions: Chips + Freitext je Frage, eine Nachricht für alles.
 * Format der Nachricht: „{label}: {antwort} · {label}: {antwort}“ (SPEC 8).
 * Unbeantwortete Fragen fallen weg; wer nur eine weiß, schickt nur eine.
 */
function blockFragen(b, ctx) {
  const box = el("section", { class: "b-block b-karte b-fragen", "aria-label": "Rückfragen" });
  box.appendChild(el("h3", { class: "b-karte-titel", text: "Rückfragen" }));
  if (b.intro) anhaengen(box, absaetze(b.intro, "b-intro"));

  const items = Array.isArray(b.items) ? b.items : [];
  const zustand = items.map(function () {
    return { chip: null, frei: "" };
  });
  const liste = el("div", { class: "b-fragen-liste" });
  const senden = el("button", { type: "button", class: "knopf knopf-primaer", disabled: true, text: "Antworten senden" });
  const meldung = el("p", { class: "b-fragen-meldung", role: "status" });
  const felder = [];

  function aktualisiere() {
    const irgendwas = zustand.some(function (z) {
      return z.chip || z.frei.trim();
    });
    senden.disabled = !irgendwas || box.classList.contains("b-gesendet");
  }

  items.forEach(function (item, i) {
    const feldId = "f-" + Math.random().toString(36).slice(2, 9);
    const gruppe = el("fieldset", { class: "b-frage" });
    gruppe.appendChild(el("legend", { class: "b-frage-text", text: satz(item.label || "") }));
    const optionen = Array.isArray(item.options) ? item.options : [];
    if (optionen.length) {
      const chips = el("div", { class: "b-chips", role: "group" });
      const knoepfe = [];
      optionen.forEach(function (o) {
        const k = el("button", { type: "button", class: "b-chip", "aria-pressed": "false", text: String(o) });
        k.addEventListener("click", function () {
          const an = zustand[i].chip !== o;
          zustand[i].chip = an ? o : null;
          knoepfe.forEach(function (x) {
            x.setAttribute("aria-pressed", x === k && an ? "true" : "false");
          });
          aktualisiere();
        });
        knoepfe.push(k);
        felder.push(k);
        chips.appendChild(k);
      });
      gruppe.appendChild(chips);
    }
    // Freitext gibt es immer – auch neben Chips („Nein, aber …“). Im
    // Heizungskeller passt die vorgedachte Option oft nicht ganz.
    const eingabe = el("input", {
      type: "text",
      id: feldId,
      class: "feld b-frage-feld",
      autocomplete: "off",
      enterkeyhint: "send",
      placeholder: optionen.length ? "oder eigene Antwort …" : "Antwort …",
      "aria-label": (item.label || "Antwort") + (optionen.length ? " – eigene Antwort" : ""),
    });
    eingabe.addEventListener("input", function () {
      zustand[i].frei = eingabe.value;
      aktualisiere();
    });
    eingabe.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        if (!senden.disabled) senden.click();
      }
    });
    felder.push(eingabe);
    gruppe.appendChild(eingabe);
    liste.appendChild(gruppe);
  });
  box.appendChild(liste);

  senden.addEventListener("click", function () {
    const teile = [];
    items.forEach(function (item, i) {
      const z = zustand[i];
      const frei = z.frei.trim();
      const antwort = z.chip && frei ? z.chip + ", " + frei : z.chip || frei;
      if (!antwort) return;
      // „Welchen Druck zeigt das Manometer?: 0,6 bar“ – endet die Frage schon
      // mit einem Satzzeichen, kommt kein Doppelpunkt dazu.
      const label = String(item.label || item.id || "Antwort").trim();
      teile.push(/[?.!:]$/.test(label) ? label + " " + antwort : label + ": " + antwort);
    });
    if (!teile.length) return;
    if (typeof ctx.onAntworten !== "function") {
      meldung.textContent = "Senden ist hier nicht verfügbar.";
      return;
    }
    // onAntworten gibt false zurück, wenn gerade eine andere Antwort läuft
    // (Doppel-Senden). Dann bleibt alles bearbeitbar.
    const angenommen = ctx.onAntworten(teile.join(" · "));
    if (angenommen === false) {
      meldung.textContent = "Bitte warten, bis die laufende Antwort fertig ist.";
      return;
    }
    box.classList.add("b-gesendet");
    felder.forEach(function (f) {
      f.disabled = true;
    });
    senden.disabled = true;
    senden.textContent = "Gesendet";
    meldung.textContent = "";
  });

  box.appendChild(el("div", { class: "b-fragen-fuss" }, [senden, meldung]));
  return box;
}

/**
 * causes als Karten. Das Evidenz-Badge erscheint NUR, wenn der Server
 * `evidence` gesetzt hat – aus SQL, nie aus dem Modell (SPEC 5.3 Punkt 4).
 * Ohne Badge kein Ersatztext mit Zahlen.
 */
function blockUrsachen(b, ctx) {
  const box = el("section", { class: "b-block b-ursachen", "aria-label": "Wahrscheinliche Ursachen" });
  const kategorie = b.symptom_kategorie ? SYMPTOM_KATEGORIEN[b.symptom_kategorie] || b.symptom_kategorie : "";
  box.appendChild(
    el("h3", { class: "b-abschnitt-titel" }, [
      "Wahrscheinliche Ursachen",
      kategorie ? el("span", { class: "b-abschnitt-unter", text: kategorie }) : null,
    ]),
  );
  const items = Array.isArray(b.items) ? b.items : [];
  const liste = el("ol", { class: "b-ursachen-liste" });
  let mitEvidenz = false;
  items.forEach(function (u) {
    const karte = el("li", { class: "b-karte b-ursache" });
    const ev = u.evidence && typeof u.evidence.matching === "number" && typeof u.evidence.similar_cases === "number"
      ? u.evidence
      : null;
    karte.appendChild(el("h4", { class: "b-ursache-titel", text: satz(u.title || "") }));
    if (ev) {
      mitEvidenz = true;
      const anteil = ev.similar_cases > 0 ? Math.max(0, Math.min(1, ev.matching / ev.similar_cases)) : 0;
      const balken = el("span", { class: "b-evidenz-balken", "aria-hidden": "true" }, el("span"));
      balken.firstChild.style.width = (anteil * 100).toFixed(1) + "%";
      karte.appendChild(
        el("p", { class: "b-evidenz" }, [
          el("span", {
            class: "b-badge b-badge-evidenz",
            text: zahl(ev.matching) + " von " + zahl(ev.similar_cases) + " ähnlichen Fällen",
          }),
          balken,
        ]),
      );
    }
    anhaengen(karte, absaetze(u.why || "", "b-ursache-warum"));
    if (u.check) {
      karte.appendChild(
        el("details", { class: "b-pruefschritt" }, [
          el("summary", { text: "Prüfschritt" }),
          el("div", { class: "b-pruefschritt-inhalt" }, absaetze(u.check)),
        ]),
      );
    }
    karte.appendChild(quellenChips(u.source_ids, ctx));
    liste.appendChild(karte);
  });
  box.appendChild(liste);
  if (mitEvidenz) {
    box.appendChild(
      el("p", {
        class: "b-fussnote",
        text: "Evidenz: verifizierte Fälle aller Anlagen mit diesem Fehlerbild, direkt aus der Datenbank gezählt.",
      }),
    );
  }
  return box;
}

/**
 * image: Das Bild kommt über ctx.ladeBild als Blob-URL, weil die Function
 * `bild` die Sitzung als Header verlangt und <img src> keine Header
 * mitschicken kann (SPEC 7). Handbuchbilder liegen nie im Frontend-Repo.
 */
function blockBild(b, ctx) {
  const caption = satz(b.caption || "");
  const rahmen = el("div", { class: "b-bild-rahmen" }, el("span", { class: "b-bild-laedt", text: "Abbildung wird geladen …" }));
  const figur = el("figure", { class: "b-block b-karte b-bild" }, [
    rahmen,
    el("figcaption", null, [
      caption ? el("span", { class: "b-bild-text", text: caption }) : null,
      b.dokument_titel || typeof b.seite === "number"
        ? el("span", {
          class: "b-bild-quelle",
          text: "Quelle: " + satz(b.dokument_titel || b.source_id || "") +
            (typeof b.seite === "number" ? ", S. " + b.seite : ""),
        })
        : null,
    ]),
  ]);
  if (typeof ctx.ladeBild !== "function") {
    leeren(rahmen).appendChild(el("span", { class: "b-bild-laedt", text: "Abbildung hier nicht verfügbar." }));
    return figur;
  }
  let laden;
  try {
    laden = Promise.resolve(ctx.ladeBild(b.image_id));
  } catch (e) {
    laden = Promise.reject(e);
  }
  laden.then(
    function (url) {
      if (!url) throw new Error("leere Bildadresse");
      const img = el("img", { src: url, alt: caption || "Abbildung aus der Herstellerunterlage", decoding: "async" });
      leeren(rahmen).appendChild(img);
    },
  ).then(null, function (e) {
    console.warn("Abbildung " + b.image_id + " nicht geladen:", e);
    leeren(rahmen).appendChild(el("span", { class: "b-bild-laedt", text: "Abbildung konnte nicht geladen werden." }));
  });
  return figur;
}

function blockSchritte(b, ctx) {
  const box = el("section", { class: "b-block b-karte b-schritte", "aria-label": b.title || "Schritte" });
  box.appendChild(el("h3", { class: "b-karte-titel", text: satz(b.title || "Schritte") }));
  if (b.role_min) {
    const genug = !ctx.rolle || rang(ctx.rolle) >= rang(b.role_min);
    box.appendChild(
      el("p", { class: "b-rollenhinweis" + (genug ? "" : " b-auffaellig") }, [
        "Freigegeben ab Rolle " + (ROLLEN_NAMEN[b.role_min] || b.role_min),
      ]),
    );
  }
  const items = Array.isArray(b.items) ? b.items : [];
  box.appendChild(el("ol", { class: "b-schrittliste" }, items.map(function (s) {
    return el("li", null, absaetze(s));
  })));
  box.appendChild(quellenChips(b.source_ids, ctx));
  return box;
}

function uebergabeText(b) {
  const zeilen = ["Übergabepaket an " + (LEVEL_NAMEN[b.to_level] || "Level " + b.to_level)];
  const kopf = [b.anlage_id ? "Anlage: " + b.anlage_id : null, b.ticket_id ? "Ticket: " + b.ticket_id : null]
    .filter(Boolean)
    .join(" · ");
  if (kopf) zeilen.push(kopf);
  if (b.summary) zeilen.push("", "Zusammenfassung: " + ohneMarkdown(b.summary));
  if (Array.isArray(b.codes) && b.codes.length) zeilen.push("Codes: " + b.codes.join(", "));
  const liste = function (titel, werte) {
    if (!Array.isArray(werte) || !werte.length) return;
    zeilen.push("", titel + ":");
    werte.forEach(function (w) {
      zeilen.push("– " + ohneMarkdown(w));
    });
  };
  liste("Bisherige Maßnahmen", b.actions_taken);
  liste("Vermutungen", b.hypotheses);
  return zeilen.join("\n");
}

function kopieren(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  return new Promise(function (aufloesen, ablehnen) {
    const feld = el("textarea", { readonly: true, class: "unsichtbar" });
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
    if (ok) aufloesen();
    else ablehnen(new Error("Kopieren nicht möglich"));
  });
}

/**
 * handover als Übergabepaket-Karte – der Beweis, dass Information nicht
 * verschwindet, sondern weitergereicht wird (Plan, Sa 10.10.). „Als Text
 * kopieren“, weil das Paket am Ende in einem anderen Ticketsystem landet.
 */
function blockUebergabe(b) {
  const ziel = LEVEL_NAMEN[b.to_level] || "Level " + b.to_level;
  const box = el("section", { class: "b-block b-karte b-uebergabe", "aria-label": "Übergabepaket an " + ziel });
  box.appendChild(
    el("header", { class: "b-karte-kopf" }, [
      el("h3", { class: "b-karte-titel", text: "Übergabepaket an " + ziel }),
      el("span", { class: "b-karte-ort", text: [b.anlage_id, b.ticket_id].filter(Boolean).join(" · ") }),
    ]),
  );
  if (b.summary) anhaengen(box, absaetze(b.summary, "b-uebergabe-summe"));
  const dl = el("dl", { class: "b-uebergabe-daten" });
  const eintrag = function (titel, inhalt) {
    dl.appendChild(el("div", null, [el("dt", { text: titel }), el("dd", null, inhalt)]));
  };
  const codes = Array.isArray(b.codes) ? b.codes : [];
  eintrag(
    "Codes",
    codes.length
      ? el("ul", { class: "b-chips-quellen" }, codes.map(function (c) {
        return el("li", { class: "b-quelle-chip b-mono", text: String(c) });
      }))
      : "keine",
  );
  const liste = function (werte) {
    return Array.isArray(werte) && werte.length
      ? el("ul", { class: "b-liste" }, werte.map(function (w) {
        return el("li", { text: satz(w) });
      }))
      : "–";
  };
  eintrag("Bisherige Maßnahmen", liste(b.actions_taken));
  eintrag("Vermutungen", liste(b.hypotheses));
  box.appendChild(dl);

  const knopf = el("button", { type: "button", class: "knopf knopf-leise", text: "Als Text kopieren" });
  const status = el("span", { class: "b-kopier-status", role: "status" });
  knopf.addEventListener("click", function () {
    kopieren(uebergabeText(b)).then(
      function () {
        status.textContent = "Kopiert.";
        setTimeout(function () {
          status.textContent = "";
        }, 2500);
      },
      function () {
        status.textContent = "Kopieren nicht möglich – bitte von Hand markieren.";
      },
    );
  });
  box.appendChild(el("div", { class: "b-karte-fuss" }, [knopf, status]));
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

/**
 * „Ursache dokumentieren“ braucht Eingaben (Kategorie, Befund, verifiziert –
 * SPEC 7), ein einzelner Knopf reicht nicht. Das Formular klappt inline auf,
 * damit der Techniker im Gespräch bleibt.
 */
function ursachenFormular(item, ausfuehren, abbrechen) {
  const payload = item.payload || {};
  const optionen = ursachenOptionen(payload);
  const id = "u-" + Math.random().toString(36).slice(2, 9);
  const auswahl = el("select", { id: id + "-k", class: "feld" }, [
    el("option", { value: "", text: optionen.length ? "Bitte wählen …" : "Keine Kategorien bekannt" }),
  ].concat(optionen.map(function (o) {
    return el("option", { value: o[0], text: o[1] });
  })));
  const befund = el("textarea", { id: id + "-t", class: "feld", rows: "3", maxlength: "500" });
  if (payload.ursache) befund.value = String(payload.ursache);
  const verifiziert = el("input", { type: "checkbox", id: id + "-v" });
  if (payload.verifiziert === true) verifiziert.checked = true;
  const speichern = el("button", { type: "submit", class: "knopf knopf-primaer", text: "Ursache speichern" });
  const zurueck = el("button", { type: "button", class: "knopf knopf-leise", text: "Abbrechen" });
  const hinweis = el("p", { class: "b-formular-hinweis", role: "status" });

  auswahl.addEventListener("change", function () {
    // Befund mit der Kategorie vorbelegen, solange niemand selbst getippt hat.
    if (!befund.value.trim() || befund.dataset.vorbelegt === "1") {
      const gewaehlt = optionen.filter(function (o) {
        return o[0] === auswahl.value;
      })[0];
      befund.value = gewaehlt ? gewaehlt[1] : "";
      befund.dataset.vorbelegt = "1";
    }
  });
  befund.addEventListener("input", function () {
    befund.dataset.vorbelegt = "0";
  });

  const formular = el("form", { class: "b-aktion-formular", novalidate: true }, [
    el("label", { for: id + "-k", text: "Ursache (Kategorie)" }),
    auswahl,
    el("label", { for: id + "-t", text: "Befund in einem Satz" }),
    befund,
    el("label", { class: "b-checkbox", for: id + "-v" }, [verifiziert, " Vor Ort bestätigt (Ursache verifiziert)"]),
    el("p", { class: "b-formular-erklaerung", text: "Nur verifizierte Ursachen zählen später in die Evidenz ähnlicher Fälle." }),
    el("div", { class: "b-formular-knoepfe" }, [speichern, zurueck]),
    hinweis,
  ]);
  formular.addEventListener("submit", function (e) {
    e.preventDefault();
    if (optionen.length && !auswahl.value) {
      hinweis.textContent = "Bitte eine Kategorie wählen.";
      auswahl.focus();
      return;
    }
    if (!befund.value.trim()) {
      hinweis.textContent = "Bitte den Befund kurz beschreiben.";
      befund.focus();
      return;
    }
    hinweis.textContent = "";
    ausfuehren(
      {
        ursache: befund.value.trim(),
        ursache_kategorie: auswahl.value || null,
        verifiziert: verifiziert.checked,
      },
      function (sperren) {
        [auswahl, befund, verifiziert, speichern, zurueck].forEach(function (f) {
          f.disabled = sperren;
        });
      },
    );
  });
  zurueck.addEventListener("click", abbrechen);
  return formular;
}

/**
 * actions als Knöpfe. Bestätigung erscheint inline, der Knopf ist danach
 * deaktiviert – create_followup schreibt echt in die Demo-DB, ein zweiter
 * Klick legte eine zweite Wiedervorlage an (deshalb auch der Reset vor der
 * Demo, Plan Pos. 11).
 *
 * Aufbau: alle Knöpfe in einer Zeile, darunter je Aktion ein Bereich für
 * Formular und Bestätigung in voller Breite. Ein aufgeklapptes Formular
 * schiebt so keine anderen Knöpfe zur Seite.
 */
function blockAktionen(b, ctx) {
  const box = el("section", { class: "b-block b-aktionen", "aria-label": "Aktionen" });
  const knoepfe = el("div", { class: "b-aktion-knoepfe" });
  const bereiche = el("div", { class: "b-aktion-bereiche" });
  const items = Array.isArray(b.items) ? b.items : [];
  items.forEach(function (item) {
    const stil = item.stil === "sekundaer" ? "knopf-sekundaer" : "knopf-primaer";
    const label = satz(item.label || item.action);
    const knopf = el("button", { type: "button", class: "knopf " + stil, text: label });
    const bereich = el("div", { class: "b-aktion-bereich", "aria-live": "polite" });
    const ergebnis = el("div", { class: "b-aktion-ergebnis" });
    bereich.appendChild(ergebnis);
    let erledigt = false;

    const minRolle = AKTION_ROLLE_MIN[item.action];
    const fehltRolle = minRolle && ctx.rolle && rang(ctx.rolle) < rang(minRolle);
    const ohneHandler = typeof ctx.onAktion !== "function";
    if (fehltRolle || ohneHandler) {
      knopf.disabled = true;
      ergebnis.appendChild(
        el("p", {
          class: "b-aktion-hinweis",
          text: "„" + label + "“ " +
            (fehltRolle ? "ist ab Rolle " + (ROLLEN_NAMEN[minRolle] || minRolle) + " freigegeben." : "ist hier nicht verfügbar."),
        }),
      );
    }

    function formularWeg() {
      const formular = bereich.querySelector(".b-aktion-formular");
      if (formular) bereich.removeChild(formular);
    }

    function ausfuehren(zusatz, sperren) {
      if (erledigt) return;
      const payload = Object.assign({}, item.payload || {}, zusatz || {});
      const aufruf = Object.assign({}, item, { payload: payload });
      knopf.disabled = true;
      if (sperren) sperren(true);
      leeren(ergebnis).appendChild(el("p", { class: "b-aktion-hinweis", text: label + ": wird ausgeführt …" }));
      let versprechen;
      try {
        versprechen = Promise.resolve(ctx.onAktion(aufruf));
      } catch (e) {
        versprechen = Promise.reject(e);
      }
      versprechen.then(
        function (bestaetigung) {
          erledigt = true;
          knopf.disabled = true;
          knopf.classList.add("knopf-erledigt");
          formularWeg();
          leeren(ergebnis);
          const blk = bestaetigung && typeof bestaetigung === "object"
            ? renderBlock(bestaetigung, ctx)
            : el("p", { text: label + ": erledigt." });
          blk.classList.add("b-bestaetigung");
          ergebnis.appendChild(blk);
        },
        function (e) {
          // Bei offenem Formular bleibt der Knopf gesperrt – das Formular ist
          // noch da und wird erneut abgeschickt.
          knopf.disabled = !!bereich.querySelector(".b-aktion-formular");
          if (sperren) sperren(false);
          leeren(ergebnis).appendChild(
            el("p", {
              class: "b-aktion-fehler",
              role: "alert",
              text: label + " – nicht ausgeführt: " + (e && e.message ? e.message : "unbekannter Fehler"),
            }),
          );
        },
      );
    }

    knopf.addEventListener("click", function () {
      if (erledigt || knopf.disabled) return;
      if (item.action === "document_cause") {
        if (bereich.querySelector(".b-aktion-formular")) return;
        const formular = ursachenFormular(item, ausfuehren, function () {
          formularWeg();
          leeren(ergebnis);
          knopf.disabled = false;
          knopf.focus();
        });
        knopf.disabled = true;
        bereich.insertBefore(formular, ergebnis);
        // Erst das ganze Formular ins Bild holen, dann ohne zweiten Sprung
        // fokussieren. Live lagen Befundfeld und „Ursache speichern“ hinter
        // der klebenden Eingabezeile, und focus() scrollte nicht, weil das Feld
        // formal im Viewport lag (scroll-padding in app.css rechnet sie ein).
        try {
          const ruhig = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          formular.scrollIntoView({ block: "nearest", behavior: ruhig ? "auto" : "smooth" });
        } catch (e) {
          formular.scrollIntoView(false);
        }
        const erstes = formular.querySelector("select, textarea");
        if (erstes) {
          try {
            erstes.focus({ preventScroll: true });
          } catch (e) {
            erstes.focus();
          }
        }
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

function blockQuellen(b) {
  const items = Array.isArray(b.items) ? b.items : [];
  const fuss = el("footer", { class: "b-block b-quellen", "aria-label": "Quellen" });
  fuss.appendChild(el("h3", { class: "b-quellen-titel", text: "Quellen" }));
  if (!items.length) {
    fuss.appendChild(el("p", { class: "b-ohnequelle", text: "Keine Quellen angegeben." }));
    return fuss;
  }
  // Gleiche Unterlage in einer Zeile: „Vaillant VWZ MEH 97/6 – …, S. 25, 39, 41“
  // statt dreimal derselbe Titel untereinander.
  fuss.appendChild(el("ul", { class: "b-quellenliste" }, gruppiereQuellen(items).map(function (g) {
    const text = istUnterlage(g.q) && g.q.title
      ? dokumentTitel(g.q) + (g.seiten.length ? ", " + seitenText(g.seiten) : "")
      : quellenText(g.q);
    return el("li", { class: "b-quelle b-quelle-" + (g.q.kind || "sonst"), title: g.ids.filter(Boolean).join(", ") || null, text: text });
  })));
  return fuss;
}

const RENDERER = {
  text: blockText,
  warning: blockWarnung,
  system_card: blockSteckbrief,
  recurrence_alert: blockAlarm,
  questions: blockFragen,
  causes: blockUrsachen,
  image: blockBild,
  steps: blockSchritte,
  handover: blockUebergabe,
  actions: blockAktionen,
  sources: blockQuellen,
};

function uebersprungen(typ) {
  return el("div", { hidden: true, class: "b-uebersprungen", "data-typ": typ || "" });
}

/**
 * Einen Block darstellen. Wirft nie: Ein unbekannter Typ oder ein kaputter
 * Block wird übersprungen (verstecktes Platzhalter-Element), der Rest der
 * Antwort steht trotzdem.
 */
export function renderBlock(block, ctx) {
  const c = ctx || {};
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
 * Reihenfolge absichern: Stopp-Boxen ganz oben, Quellen ganz unten.
 * Der Server sortiert bereits (SPEC 5.1) – hier nur die zweite Sicherung,
 * damit eine Stopp-Box nie unter einem langen Steckbrief verschwindet.
 * Stabil: innerhalb der Gruppen bleibt die Serverreihenfolge.
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
 * Ganze Antwort: Level- und Konfidenz-Badge, dann alle Blöcke.
 * Die Quellenliste wird vorab eingelesen, damit die Chips in den Blöcken
 * statt „Q7“ den lesbaren Titel samt Seite zeigen.
 */
export function renderAntwort(antwort, ctx) {
  const wurzel = el("div", { class: "b-antwort" });
  if (!antwort || typeof antwort !== "object") {
    console.warn("Leere oder unlesbare Antwort:", antwort);
    wurzel.appendChild(el("p", { class: "b-text", text: "Keine Antwort erhalten." }));
    return wurzel;
  }
  const kopf = el("div", { class: "b-badges" });
  if (antwort.level) {
    kopf.appendChild(
      badge("Level " + antwort.level + " · " + (LEVEL_NAMEN[antwort.level] || ""), "b-badge-level", "Einstufung des Falls"),
    );
  }
  if (antwort.confidence) {
    kopf.appendChild(badge("Konfidenz: " + antwort.confidence, "b-badge-konfidenz b-konfidenz-" + antwort.confidence));
  }
  if (kopf.childNodes.length) wurzel.appendChild(kopf);

  const bloecke = sortiere(Array.isArray(antwort.blocks) ? antwort.blocks : []);
  const quellen = new Map();
  for (const b of bloecke) {
    if (b && b.type === "sources" && Array.isArray(b.items)) {
      for (const q of b.items) if (q && q.id) quellen.set(String(q.id), q);
    }
  }
  const alarmFuer = bloecke.filter(function (b) {
    return b && b.type === "recurrence_alert" && b.anlage_id;
  }).map(function (b) {
    return String(b.anlage_id);
  });
  const innen = Object.assign({}, ctx || {}, { quellen: quellen, alarmFuer: alarmFuer });
  for (const b of bloecke) wurzel.appendChild(renderBlock(b, innen));
  return wurzel;
}
