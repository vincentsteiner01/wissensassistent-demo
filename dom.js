// ============================================================================
// dom.js  ·  Elemente bauen, Text setzen, deutsch formatieren (SPEC 13.3.9)
// ----------------------------------------------------------------------------
// Ein einziger Elementbauer für App, Renderer und die Abgeben-Module. Warum so
// streng:
//   - Modell- und Datenbanktext kommt NUR als Textknoten in den DOM. Es gibt
//     kein `html`-Attribut, kein HTML aus Zeichenketten, keinen style-String – wer hier
//     etwas einschleusen will, findet keine Tür.
//   - Kinder werden beliebig tief flach gemacht (flat(Infinity)). Entwurf B
//     machte nur eine Ebene flach, und aus einem verschachtelten Knopf wurde
//     der Text „[object HTMLButtonElement]“. Unbekannte Kinder werden laut
//     gemeldet und übersprungen, nie per String() in Text verwandelt.
//   - href/src nur mit sicheren Schemata: kein javascript:, keine fremden
//     Bildquellen (Handbuchbilder kommen als blob:, Logos als data:image/).
//
// Safari < 16.4 wirft schon beim Einlesen einer Datei mit Lookbehind oder
// benannten Gruppen – und dann lädt GAR NICHTS. Deshalb hier und in allen
// web/*.js: keine (?<…), kein ?. und kein ?? (Matari-Lehre, siehe bloecke.js).
// ============================================================================

const SVG_NS = "http://www.w3.org/2000/svg";

/** Attribute, die als Boolean gelten: true → gesetzt, false/null → weggelassen. */
const BOOLESCH = {
  hidden: 1, disabled: 1, checked: 1, required: 1, readonly: 1, multiple: 1,
  selected: 1, open: 1, inert: 1, novalidate: 1, autofocus: 1, reversed: 1,
};

/** Nie als Attribut: Stil nur per el.style.setProperty im Code, HTML nie. */
const VERBOTEN = { style: 1, html: 1, innerhtml: 1, outerhtml: 1, srcdoc: 1, formaction: 1 };

/** Darf ein Attributname überhaupt gesetzt werden? (Kleinbuchstaben, Ziffern, Bindestrich) */
const NAME_OK = /^[a-z][a-z0-9-]*$/;

/**
 * href: nur Sprungmarken (#…), relative Pfade und https:. mailto: und tel:
 * dazu, weil sie nichts ausführen. Alles andere (javascript:, data:, http:)
 * fällt weg – mit Meldung, damit ein Fehler im Code auffällt.
 */
function hrefOk(wert) {
  const s = String(wert).trim();
  if (!s) return false;
  if (s.charAt(0) === "#") return true;
  if (/^https:\/\//i.test(s)) return true;
  if (/^(mailto|tel):/i.test(s)) return true;
  // relativ: kein Schema (kein „xyz:“ vor dem ersten /, ? oder #), nicht „//host“
  if (/^\/\//.test(s)) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(s);
}

/** src: data:image/…, blob: oder relativ. */
function srcOk(wert) {
  const s = String(wert).trim();
  if (!s) return false;
  if (/^data:image\/(png|jpeg|webp|gif|svg\+xml)[;,]/i.test(s)) return true;
  if (/^blob:/i.test(s)) return true;
  if (/^\/\//.test(s)) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(s);
}

function kinderAnhaengen(knoten, kinder, wo) {
  const flach = kinder.flat(Infinity);
  for (let i = 0; i < flach.length; i++) {
    const k = flach[i];
    if (k === null || k === undefined || k === false || k === true) continue;
    if (typeof k === "string" || typeof k === "number") {
      knoten.appendChild(document.createTextNode(String(k)));
    } else if (k && typeof k === "object" && typeof k.nodeType === "number") {
      knoten.appendChild(k);
    } else {
      // Nie String(obj): sonst steht „[object Object]“ in der Oberfläche.
      console.error("dom.h: unbekanntes Kind in <" + wo + "> übersprungen:", k);
    }
  }
}

function attributeSetzen(knoten, attrs, istSvg) {
  let wert = null;
  let hatWert = false;
  const namen = Object.keys(attrs);
  for (let i = 0; i < namen.length; i++) {
    const roh = namen[i];
    const v = attrs[roh];
    if (v === null || v === undefined || v === false) continue;
    const name = istSvg ? roh : roh.toLowerCase();

    if (name === "text") {
      knoten.textContent = String(v);
      continue;
    }
    if (name === "class") {
      knoten.setAttribute("class", String(v));
      continue;
    }
    if (name.slice(0, 2) === "on") {
      if (typeof v === "function") knoten.addEventListener(name.slice(2), v);
      else console.error("dom.h: Ereignis „" + name + "“ braucht eine Funktion – übersprungen.");
      continue;
    }
    if (VERBOTEN[name.toLowerCase()]) {
      console.error("dom.h: Attribut „" + name + "“ ist nicht erlaubt (kein HTML, kein style-String).");
      continue;
    }
    if (name === "value" && !istSvg) {
      // Für textarea/select wirkt nur die Eigenschaft; select braucht dafür
      // erst seine Optionen – deshalb nach den Kindern setzen.
      wert = v;
      hatWert = true;
      continue;
    }
    if (!istSvg && !NAME_OK.test(name)) {
      console.error("dom.h: Attributname „" + roh + "“ ungültig – übersprungen.");
      continue;
    }
    if (name === "href" && !istSvg && !hrefOk(v)) {
      console.error("dom.h: href „" + String(v).slice(0, 60) + "“ abgelehnt (nur #…, relativ, https:).");
      continue;
    }
    if (name === "src" && !srcOk(v)) {
      console.error("dom.h: src abgelehnt (nur data:image/…, blob:, relativ).");
      continue;
    }
    if (v === true) {
      knoten.setAttribute(name, "");
      if (!istSvg && BOOLESCH[name] && name in knoten) {
        try {
          knoten[name] = true;
        } catch (e) {
          // nur Attribut
        }
      }
      continue;
    }
    knoten.setAttribute(name, String(v));
  }
  return { wert: wert, hatWert: hatWert };
}

/**
 * Element bauen.
 *   h("button", { class: "knopf", type: "button", onclick: fn }, ikon("plus"), "Neu")
 * kinder: beliebig tief verschachtelte Arrays aus Node, string, number;
 * null/undefined/false/true werden übersprungen.
 */
export function h(tag, attrs) {
  const knoten = document.createElement(tag);
  const kinder = Array.prototype.slice.call(arguments, 2);
  const w = attrs && typeof attrs === "object" ? attributeSetzen(knoten, attrs, false) : { hatWert: false };
  kinderAnhaengen(knoten, kinder, tag);
  if (w.hatWert) knoten.value = String(w.wert);
  return knoten;
}

/** Dasselbe im SVG-Namensraum (Symbole, Diagramme). */
export function svg(tag, attrs) {
  const knoten = document.createElementNS(SVG_NS, tag);
  const kinder = Array.prototype.slice.call(arguments, 2);
  if (attrs && typeof attrs === "object") attributeSetzen(knoten, attrs, true);
  kinderAnhaengen(knoten, kinder, tag);
  return knoten;
}

export function leeren(el) {
  if (!el) return el;
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// --- Deutsche Typografie -------------------------------------------------------

const NBSP = " ";

/**
 * Für Texte, die nicht von uns stammen (Modell, Datenbank):
 *   - geschütztes Leerzeichen zwischen Zahl und Einheit („0,6 bar“ bricht
 *     sonst am Zeilenende auseinander – ausgerechnet auf dem Handy im Keller)
 *     und nach „S.“ vor einer Seitenzahl;
 *   - "…" → „…“ paarweise an Wortgrenzen (ein Apostroph wie in „geht's“ bleibt);
 *   - "..." → „…“, freistehender Bindestrich → Halbgeviertstrich.
 * Lookahead statt \b, weil „mm²“ mit einem Nicht-Wortzeichen endet.
 */
export function typo(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/\.\.\./g, "…")
    .replace(/ - /g, " – ")
    .replace(
      /(\d) (bar|kWh|kWp|kW|mm²|mm2|°C|K|A|V|W|Hz|Tagen|Tage|Tag|Stunden|Std\.|min|s|%|Tickets|Ticket|Fällen|Fälle|Seiten|Seite|Zeichen|Tokens|USD|MB|KB)(?=$|[\s.,;:!?)\]–-])/g,
      "$1" + NBSP + "$2",
    )
    .replace(/(^|[\s(])S\. (\d)/g, "$1S." + NBSP + "$2")
    .replace(/(^|[\s(\[–])"([^"\n]+)"(?=$|[\s.,;:!?)\]–])/g, "$1„$2“")
    .replace(/(^|[\s(\[–])'([^'\n]+)'(?=$|[\s.,;:!?)\]–])/g, "$1‚$2‘");
}

// --- Datum und Zahl ------------------------------------------------------------

const formate = {};

function format(name, optionen) {
  if (formate[name]) return formate[name];
  try {
    formate[name] = new Intl.DateTimeFormat("de-DE", Object.assign({ timeZone: "Europe/Berlin" }, optionen));
  } catch (e) {
    // Sehr alte Browser ohne timeZone: dann eben Ortszeit.
    formate[name] = new Intl.DateTimeFormat("de-DE", optionen);
  }
  return formate[name];
}

/**
 * Reine Kalenderdaten („2025-04-15“) werden von Hand zerlegt, NICHT über
 * new Date(): Das liest sie als Mitternacht UTC, und westlich von Greenwich
 * stünde der Vortag da. Zeitstempel gehen über Europe/Berlin – dieselbe
 * Tagesgrenze wie im SQL (SPEC 2), sonst rechnet der Server „34 Tage“ und hier
 * steht ein anderes Datum daneben.
 */
function zerlege(wert) {
  if (wert === null || wert === undefined || wert === "") return null;
  const s = String(wert);
  const tag = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (tag) return { tag: tag };
  const d = new Date(s);
  if (isNaN(d.getTime())) return { roh: s };
  return { d: d };
}

/** „08.10.2026“ */
export function datum(wert) {
  const z = zerlege(wert);
  if (!z) return "";
  if (z.tag) return z.tag[3] + "." + z.tag[2] + "." + z.tag[1];
  if (z.roh) return z.roh;
  return format("datum", { day: "2-digit", month: "2-digit", year: "numeric" }).format(z.d);
}

/** „08.10.“ */
export function datumKurz(wert) {
  const z = zerlege(wert);
  if (!z) return "";
  if (z.tag) return z.tag[3] + "." + z.tag[2] + ".";
  if (z.roh) return z.roh;
  // de-DE liefert „08.10.“ mit Schlusspunkt – manche Engines ohne; dann ergänzen.
  const s = format("kurz", { day: "2-digit", month: "2-digit" }).format(z.d);
  return /\.$/.test(s) ? s : s + ".";
}

/** „10:43“ (Europe/Berlin); leer bei reinen Kalenderdaten. */
export function uhrzeit(wert) {
  const z = zerlege(wert);
  if (!z || !z.d) return "";
  return format("uhr", { hour: "2-digit", minute: "2-digit", hour12: false }).format(z.d);
}

const zahlformate = {};

/** „90.000“, „0,6“. stellen = feste Nachkommastellen; ohne Angabe höchstens 2. */
export function zahl(n, stellen) {
  const fest = typeof stellen === "number";
  const k = fest ? "f" + stellen : "x";
  if (!zahlformate[k]) {
    zahlformate[k] = new Intl.NumberFormat("de-DE", fest
      ? { minimumFractionDigits: stellen, maximumFractionDigits: stellen }
      : { maximumFractionDigits: 2 });
  }
  const wert = Number(n);
  return isNaN(wert) ? String(n) : zahlformate[k].format(wert);
}

/** Initialen für den Nutzer-Kreis: „Birte Lorenzen (Meister)“ → „BL“. */
export function initialen(name) {
  return String(name || "")
    .replace(/\([^)]*\)/g, "")
    .replace(/^Dr\.\s*/, "")
    .split(/\s+/)
    .filter(Boolean)
    .map(function (w) {
      return w.charAt(0);
    })
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
