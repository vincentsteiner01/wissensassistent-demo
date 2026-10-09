// ============================================================================
// abgeben.js  ·  „Wissen aufladen“: Start, Erfahrung festhalten, Einsatz
// dokumentieren (SPEC 13.3.4, 13.3.9, 14.3.10, 14.3.11)
// ----------------------------------------------------------------------------
// Drei Bildschirme, die app.js per dynamischem import() in den rechten
// Container hängt (links bleibt die Akte stehen, solange ein Fall offen ist):
//   zeigeAbgeben(container, ctx)          #/abgeben   („Wissen aufladen“)
//   zeigeErfahrung(container, ctx)        #/abgeben/erfahrung
//   zeigeEinsatz(container, ctx, param)   #/abgeben/einsatz?anlage=…&ticket=…
// Rückgabe: { titel, verlassen?, aufraeumen? }.
//
// SPEC 14 (Mike): wenig Text, eine Frage je Schritt, einladend statt
// verpflichtend. Einsatz dokumentieren ist kein langes Formular mehr, sondern
// acht kurze Schritte mit großen Wahlkarten; gesendet wird erst am Ende.
//
// Dazu gemeinsame Teile für freigabe.js, handbuch.js und einrichtung.js
// (Kopf, Feldgruppe, Notiz-Editor, Fehlertext) – damit eine Meister-Notiz in
// „Erfahrung festhalten“ und in „Freigaben“ dieselben sechs Felder mit
// denselben Grenzen hat wie der Server (800 bzw. 80 Zeichen).
//
// Grundsätze (wie überall in web/):
//   - Text aus Datenbank und Modell nur als Textknoten (dom.h, textContent).
//   - Die Anfrage startet im selben Takt wie der Klick; Bewegung läuft
//     parallel und wird nie abgewartet, Eingaben werden nie gesperrt, nur der
//     Knopf, der gerade arbeitet.
//   - Rechte nur aus ctx.rechte (vom Server); fehlt das Feld, dieselbe
//     Tabelle wie der Server (api.rechteFuer). Der Server entscheidet ohnehin.
//   - Keine Lookbehind-Regex, keine benannten Gruppen, kein ?. / ?? (Safari < 16.4).
// ============================================================================
import { datum, datumKurz, h, leeren, typo, uhrzeit, zahl } from "./dom.js";
import { einblenden, hochzaehlen, naechsterFrame, ruhig } from "./bewegung.js";
import { ikon } from "./ikonen.js";
// Kurznamen teilen sich Akte (app.js) und Einsatz – ein Wort, überall dasselbe.
import { KATEGORIE_KURZ, URSACHE_KURZ } from "./bloecke.js";

// --- Gemeinsame Teile (auch für freigabe.js, handbuch.js, einrichtung.js) ---------

const RANG = { kundenbetreuer: 1, standortleiter: 1, techniker: 2, meister: 3, ingenieur: 3 };

export const ROLLEN_ANZEIGE = {
  kundenbetreuer: "Kundenbetreuer",
  standortleiter: "Standortleiter",
  techniker: "Techniker",
  meister: "Meister",
  ingenieur: "Ingenieur",
};

/** Rechte der Sitzung; ohne `rechte` vom Server dieselbe Tabelle wie _shared/rollen.ts. */
export function rechteVon(ctx) {
  if (ctx && ctx.rechte && typeof ctx.rechte === "object") return ctx.rechte;
  if (ctx && ctx.api && typeof ctx.api.rechteFuer === "function") return ctx.api.rechteFuer(ctx.rolle, ctx.istAdmin);
  const r = RANG[ctx && ctx.rolle] || 0;
  const admin = !!(ctx && ctx.istAdmin);
  return { erfahrung: r >= 1, einsatz: r >= 2, freigabe: r >= 3 || admin, handbuch: r >= 3 || admin, einrichtung: admin, modus_wahl: r >= 2 };
}

/** „Ole Thiessen (Techniker)“ – wie die Schreiberzeile des Servers. */
export function schreiber(ctx) {
  const name = String((ctx && ctx.anzeigename) || "");
  if (/\)\s*$/.test(name)) return name;
  const rolle = ROLLEN_ANZEIGE[ctx && ctx.rolle] || "";
  return rolle ? name + " (" + rolle + ")" : name;
}

/** Deutsche Meldung aus einem ApiFehler oder sonstigen Fehler. */
export function fehlerText(err, rueckfall) {
  if (err && typeof err.message === "string" && err.message) return err.message;
  return rueckfall || "Das hat nicht geklappt. Bitte noch einmal versuchen.";
}

/** „08.10.2026, 12:01“ */
export function datumZeit(iso) {
  const d = datum(iso);
  const u = uhrzeit(iso);
  return u ? d + ", " + u : d;
}

/**
 * Knopf während einer Anfrage: deaktiviert, mit Arbeitstext, aria-busy.
 * Den ursprünglichen Inhalt hält das Element selbst (Kinder werden geparkt),
 * damit Symbole im Knopf nach der Anfrage wieder da sind.
 */
export function beschaeftigt(knopf, an, text) {
  if (!knopf) return;
  if (an) {
    if (!knopf._ruhe) knopf._ruhe = Array.prototype.slice.call(knopf.childNodes);
    leeren(knopf);
    knopf.appendChild(h("span", { class: "ab-kreisel", "aria-hidden": "true" }));
    knopf.appendChild(document.createTextNode(text || "Bitte warten …"));
    knopf.disabled = true;
    knopf.setAttribute("aria-busy", "true");
  } else {
    if (knopf._ruhe) {
      leeren(knopf);
      knopf._ruhe.forEach(function (k) { knopf.appendChild(k); });
      knopf._ruhe = null;
    }
    knopf.disabled = false;
    knopf.removeAttribute("aria-busy");
  }
}

/**
 * Kopf eines Bildschirms: Rückweg, Kicker, Serifen-Titel, ein Satz.
 * Der Titel ist mit tabindex=-1 fokussierbar – app.js setzt den Fokus nach
 * einem Routenwechsel dorthin, damit Screenreader den neuen Bildschirm ansagen.
 */
export function seitenKopf(ctx, opt) {
  const o = opt || {};
  const zurueck = o.zurueck
    ? h("a", {
      class: "ab-zurueck",
      href: o.zurueck.route,
      onclick: function (e) {
        e.preventDefault();
        ctx.navigiere(o.zurueck.route);
      },
    }, ikon("zurueck", { groesse: 16 }), o.zurueck.text)
    : null;
  return h("header", { class: "ab-kopf" },
    zurueck,
    o.kicker ? h("p", { class: "kicker", text: o.kicker }) : null,
    h("h1", { class: "titel-serif ab-titel", tabindex: "-1", text: o.titel }),
    o.satz ? h("p", { class: "ab-satz", text: o.satz }) : null,
    o.zusatz || null);
}

let feldNr = 0;
/** Eindeutige ID für Label/Feld/Hilfe-Paare. */
export function neueId(praefix) {
  feldNr += 1;
  return (praefix || "ab") + "-" + feldNr;
}

/**
 * Feld mit Label, Pflichtmarke, Hilfe und Fehlerzeile. aria-describedby
 * verbindet Hilfe und Fehler mit dem Feld (Screenreader lesen beides vor).
 */
export function feldGruppe(opt) {
  const id = opt.feld.id || neueId("feld");
  opt.feld.id = id;
  const hilfeId = id + "-hilfe";
  const fehlerId = id + "-fehler";
  const hilfe = opt.hilfe ? h("p", { class: "feld-hilfe", id: hilfeId }, opt.hilfe) : null;
  const fehler = h("p", { class: "feld-fehler", id: fehlerId, role: "alert" });
  opt.feld.setAttribute("aria-describedby", (hilfe ? hilfeId + " " : "") + fehlerId);
  if (opt.pflicht) opt.feld.setAttribute("aria-required", "true");
  const wurzel = h("div", { class: "ab-feld" + (opt.klasse ? " " + opt.klasse : "") },
    h("label", { class: "feld-label", for: id },
      opt.label,
      opt.pflicht ? h("span", { class: "pflicht", "aria-hidden": "true", text: "*" }) : null,
      opt.marke || null),
    opt.feld,
    opt.unter || null,
    hilfe,
    fehler);
  return {
    wurzel: wurzel,
    feld: opt.feld,
    fehler: function (text) {
      fehler.textContent = text || "";
      if (text) opt.feld.setAttribute("aria-invalid", "true");
      else opt.feld.removeAttribute("aria-invalid");
    },
  };
}

/** Kleine Zeichenzählung „120 / 3.000“ unter einem Textfeld. */
export function zeichenZaehler(feld, max) {
  const anzeige = h("span", { class: "ab-zaehler zahl", "aria-hidden": "true" });
  function neu() {
    const n = feld.value.length;
    anzeige.textContent = zahl(n) + " / " + zahl(max);
    anzeige.classList.toggle("ab-zaehler-voll", n >= max);
  }
  feld.addEventListener("input", neu);
  neu();
  return anzeige;
}

/** Vorschau „Geht als … raus“ (SPEC 13.3.1, Entwurf B). */
export function gehtRaus(kopf, kinder) {
  return h("div", { class: "geht-raus ab-geht-raus", "aria-live": "polite" },
    kopf ? h("p", { class: "geht-raus-kopf", text: kopf }) : null,
    kinder);
}

/** Karten-Etikett (Herkunft) wie die Antwortkarten (13.3.5). */
export function etikett(art, symbol, text, unterArt) {
  return h("div", { class: "etikett etikett-" + art },
    ikon(symbol, { groesse: 15 }),
    h("span", { text: text }),
    unterArt ? h("span", { class: "etikett-art", text: unterArt }) : null);
}

/** Navigationslink, der über ctx.navigiere geht (verlassen()-Prüfung der App). */
export function routenLink(ctx, route, param, klasse, kinder) {
  let href = route;
  if (param) {
    const q = Object.keys(param).filter(function (k) { return param[k] !== null && param[k] !== undefined && param[k] !== ""; })
      .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(String(param[k])); }).join("&");
    if (q) href += "?" + q;
  }
  return h("a", {
    class: klasse,
    href: href,
    onclick: function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      ctx.navigiere(route, param || undefined);
    },
  }, kinder);
}

/** Karte weich zeigen (nie abwarten). */
export function zeige(el, i) {
  einblenden(el, i || 0);
  return el;
}

/** Element in den sichtbaren Bereich holen, ruhig oder weich. */
export function inSicht(el) {
  if (!el || typeof el.scrollIntoView !== "function") return;
  naechsterFrame(function () {
    try {
      el.scrollIntoView({ behavior: ruhig() ? "auto" : "smooth", block: "nearest" });
    } catch (e) {
      el.scrollIntoView();
    }
  });
}

/** Zeigegerät mit Maus? Dann darf der Fokus springen, auf dem Handy nicht (Tastatur ginge auf). */
export function mitMaus() {
  try {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  } catch (e) {
    return true;
  }
}

// --- Notiz-Editor (Erfahrung festhalten und Freigaben) ----------------------------

export const NOTIZ_FELDER = [
  { key: "geraet", label: "Gerät", lang: false, max: 80, platz: "z. B. Wärmepumpe" },
  { key: "hersteller", label: "Hersteller", lang: false, max: 80, platz: "falls bekannt" },
  { key: "modell_serie", label: "Modell / Serie", lang: false, max: 80, platz: "falls bekannt" },
  { key: "fehlerbild", label: "Fehlerbild", lang: true, max: 800, pflicht: true, platz: "Was sieht oder meldet man?" },
  { key: "ursache", label: "Ursache", lang: true, max: 800, platz: "Woran lag es?" },
  { key: "loesung", label: "Lösung", lang: true, max: 800, pflicht: true, platz: "Was hat geholfen, worauf achten?" },
];

function vereinfacht(s) {
  return String(s).toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
}

/** Welche Felder nennt die unklar-Liste der Strukturierung? (über Schlüssel oder Bezeichnung) */
function unklareFelder(unklar) {
  const treffer = {};
  unklar.forEach(function (u) {
    const t = vereinfacht(u);
    NOTIZ_FELDER.forEach(function (f) {
      if (t.indexOf(f.key) !== -1 || t.indexOf(vereinfacht(f.label)) !== -1) treffer[f.key] = true;
    });
    if (t.indexOf("modell") !== -1 || t.indexOf("serie") !== -1) treffer.modell_serie = true;
  });
  return treffer;
}

/**
 * Sechs editierbare Felder einer Meister-Notiz. Editierbar ist der Kern: Wenn
 * das Diktat „Schnellentlüfter“ verreißt und der Meister es sichtbar
 * korrigiert, ist das die beste Antwort auf „Wie bleibt die Datenbank aktuell?“.
 *
 * opt.unklar: Liste aus der Strukturierung (markiert Felder „unklar“)
 * opt.original: Vergleichswerte – geänderte Felder zeigen „vorher: …“ (Freigaben)
 * opt.beiAenderung: Rückruf bei jeder Eingabe (Vorschau „Geht als … raus“)
 */
export function notizEditor(werte, opt) {
  const o = opt || {};
  const w = werte || {};
  const unklar = Array.isArray(o.unklar) ? o.unklar.filter(Boolean).map(String) : [];
  const markiert = unklareFelder(unklar);
  const gruppen = {};
  const vorherZeilen = {};
  const kurz = h("div", { class: "ab-notiz-kurz" });
  const lang = h("div", { class: "ab-notiz-lang" });

  NOTIZ_FELDER.forEach(function (f) {
    const wert = w[f.key] === null || w[f.key] === undefined ? "" : String(w[f.key]);
    const feld = f.lang
      ? h("textarea", { class: "feld", rows: "3", maxlength: String(f.max), placeholder: f.platz, spellcheck: "true" })
      : h("input", { class: "feld", type: "text", maxlength: String(f.max), autocomplete: "off", placeholder: f.platz });
    feld.value = wert;
    feld.dataset.feld = f.key;
    let marke = null;
    if (markiert[f.key]) marke = h("span", { class: "ab-marke ab-marke-unklar", text: "unklar" });
    else if (!wert.trim() && o.unklar) marke = h("span", { class: "ab-marke", text: "nicht genannt" });
    const vorher = o.original ? h("p", { class: "ab-vorher", hidden: true }) : null;
    if (vorher) vorherZeilen[f.key] = vorher;
    const g = feldGruppe({ feld: feld, label: f.label, pflicht: !!f.pflicht, marke: marke, unter: vorher,
      klasse: markiert[f.key] ? "ab-feld-unklar" : "" });
    gruppen[f.key] = g;
    (f.lang ? lang : kurz).appendChild(g.wurzel);
    feld.addEventListener("input", function () {
      g.fehler("");
      if (marke && feld.value.trim()) marke.classList.add("ab-marke-erledigt");
      // Ausgefüllt ist nicht mehr unklar: der gelbe Rahmen geht, die Marke wird blass.
      if (feld.value.trim()) g.wurzel.classList.remove("ab-feld-unklar");
      vergleichen(f.key);
      if (typeof o.beiAenderung === "function") o.beiAenderung();
    });
  });

  function lesen() {
    const n = {};
    NOTIZ_FELDER.forEach(function (f) {
      const v = gruppen[f.key].feld.value.trim();
      n[f.key] = v ? v : null;
    });
    return n;
  }

  function vergleichen(key) {
    if (!o.original) return;
    const zeile = vorherZeilen[key];
    const alt = o.original[key] === null || o.original[key] === undefined ? "" : String(o.original[key]).trim();
    const neu = gruppen[key].feld.value.trim();
    const anders = alt !== neu;
    gruppen[key].wurzel.classList.toggle("ab-feld-geaendert", anders);
    leeren(zeile);
    if (anders) {
      zeile.appendChild(h("span", { class: "ab-vorher-label", text: "Vorher: " }));
      zeile.appendChild(alt ? h("del", { text: alt }) : h("span", { class: "ab-vorher-leer", text: "leer" }));
    }
    zeile.hidden = !anders;
  }

  const kasten = unklar.length
    ? h("div", { class: "ab-unklar", role: "note" },
      h("p", { class: "ab-unklar-titel" }, ikon("achtung", { groesse: 16 }), "Unklare Punkte – bitte prüfen"),
      h("ul", null, unklar.map(function (u) { return h("li", { text: u }); })))
    : null;

  const element = h("div", { class: "ab-notiz" }, kasten, kurz, lang);

  return {
    element: element,
    lesen: lesen,
    /** Pflichtfelder prüfen; gibt das erste ungültige Feld zurück (oder null). */
    pruefen: function () {
      const n = lesen();
      let erstes = null;
      ["fehlerbild", "loesung"].forEach(function (k) {
        if (!n[k]) {
          gruppen[k].fehler(k === "fehlerbild" ? "Bitte das Fehlerbild beschreiben." : "Bitte die Lösung beschreiben – ohne Lösung hilft der Beitrag niemandem.");
          if (!erstes) erstes = gruppen[k].feld;
        }
      });
      return erstes;
    },
    geaendert: function () {
      if (!o.original) return false;
      return NOTIZ_FELDER.some(function (f) {
        const alt = o.original[f.key] === null || o.original[f.key] === undefined ? "" : String(o.original[f.key]).trim();
        return alt !== gruppen[f.key].feld.value.trim();
      });
    },
    hatInhalt: function () {
      return NOTIZ_FELDER.some(function (f) { return !!gruppen[f.key].feld.value.trim(); });
    },
    sperren: function (an) {
      NOTIZ_FELDER.forEach(function (f) { gruppen[f.key].feld.disabled = !!an; });
    },
    fokusErstesUnklar: function () {
      const f = element.querySelector(".ab-feld-unklar .feld");
      if (f && mitMaus()) f.focus();
    },
  };
}

/** Kurzfassung einer Notiz für „Geht als … raus“ (mehrzeilig). */
export function notizVorschau(n) {
  const kopf = [n.geraet, n.hersteller, n.modell_serie].filter(Boolean).join(" · ");
  const zeilen = [];
  if (kopf) zeilen.push(kopf);
  zeilen.push("Fehlerbild: " + (n.fehlerbild || "–"));
  if (n.ursache) zeilen.push("Ursache: " + n.ursache);
  zeilen.push("Lösung: " + (n.loesung || "–"));
  return typo(zeilen.join("\n"));
}

// --- Bildschirm: Wissen aufladen (Start, SPEC 14.3.10) -----------------------------
//
// Mike: nicht „Meister müssen das machen“, sondern „Meister haben die
// Möglichkeit, ihr Wissen zu teilen“. Deshalb lädt der Bildschirm ein statt zu
// verpflichten – ein Satz, große Kacheln je Recht, kein „muss“, kein „Pflicht“.

const STATUS_BEITRAG = {
  vorgeschlagen: { text: "wartet", klasse: "pille-achtung" },
  freigegeben: { text: "Quelle", klasse: "pille-gut" },
  abgelehnt: { text: "abgelehnt", klasse: "pille-neutral" },
};

/** Kachel als Link (Routenwechsel über ctx.navigiere, damit verlassen() greift). */
function kachelLink(ctx, route, param, ikonName, titel, zeile, zusatz) {
  return routenLink(ctx, route, param, "kachel", [
    h("span", { class: "kachel-ikon", "aria-hidden": "true" }, ikon(ikonName, { groesse: 28 })),
    h("span", { class: "kachel-text" }, h("strong", null, titel, zusatz || null), h("span", { text: zeile })),
  ]);
}

function kuerzen(text, max) {
  const t = String(text || "").trim();
  if (t.length <= max) return t;
  const schnitt = t.slice(0, max + 1);
  const leer = schnitt.lastIndexOf(" ");
  return (leer > 12 ? schnitt.slice(0, leer) : t.slice(0, max)).replace(/[\s,;:.–-]+$/, "") + " …";
}

/**
 * „Deine Beiträge“: leise Zeile zum Aufklappen, darunter die Liste. Ein
 * freigegebener Tipp heißt „hilft schon“ (das Kürzel steht im title) – „Quelle
 * MN-09“ war ein Kürzel auf dem ersten Blick (Gegenprüfung 09.10.).
 */
function beitraegeBauen(ctx, istWeg) {
  const liste = h("div", { class: "ab-beitraege", id: neueId("ab-beitraege"), hidden: true, "aria-live": "polite" });
  const knopf = h("button", { type: "button", class: "knopf-leise-e", "aria-expanded": "false", "aria-controls": liste.id, text: "Deine Beiträge" });
  let geladen = false;
  knopf.addEventListener("click", function () {
    const auf = liste.hidden;
    liste.hidden = !auf;
    knopf.setAttribute("aria-expanded", auf ? "true" : "false");
    if (auf && !geladen) {
      geladen = true;
      laden();
    }
  });
  function laden() {
    leeren(liste).appendChild(h("div", { class: "skelett ab-skelett-zeile", "aria-hidden": "true" }));
    ctx.api.beitraege().then(function (antwort) {
      if (istWeg()) return;
      leeren(liste);
      const b = Array.isArray(antwort.beitraege) ? antwort.beitraege : [];
      if (!b.length) {
        liste.appendChild(h("p", { class: "ab-leise", text: "Noch keine." }));
        return;
      }
      liste.appendChild(h("ul", { class: "ab-beitrag-liste" }, b.map(function (x) {
        const st = STATUS_BEITRAG[x.status] || STATUS_BEITRAG.vorgeschlagen;
        const frei = x.status === "freigegeben";
        return h("li", { class: "ab-beitrag ab-beitrag-" + (x.status || "vorgeschlagen") },
          h("span", { class: "ab-beitrag-text", title: typo(x.fehlerbild || ""), text: typo(kuerzen(x.fehlerbild, 60)) }),
          h("span", { class: "pille " + st.klasse, title: frei && x.kuerzel ? "Quelle " + x.kuerzel : null, text: frei ? "hilft schon" : st.text }),
          x.grund ? h("span", { class: "ab-beitrag-grund", text: typo(x.grund) }) : null);
      })));
    }, function (err) {
      if (istWeg()) return;
      leeren(liste).appendChild(h("p", { class: "ab-leise", text: fehlerText(err, "Nicht geladen.") }));
    });
  }
  return { unten: h("div", { class: "ab-unten" }, knopf), liste: liste };
}

export function zeigeAbgeben(container, ctx) {
  const r = rechteVon(ctx);
  // Nur eine Kachel (Kundenbetreuer: „Erfahrung festhalten“)? Dann gleich das
  // Feld – eine Auswahl mit einer Möglichkeit ist ein unnötiger Klick
  // (Gegenprüfung 09.10.). Der Einladungssatz bleibt obenauf.
  if (r.erfahrung && !r.einsatz && !r.handbuch && !r.freigabe) {
    return zeigeErfahrung(container, ctx, { einladung: true });
  }
  let weg = false;
  const fall = ctx.fall && ctx.fall.anlage_id ? ctx.fall.anlage_id : null;
  const kacheln = [];
  if (r.erfahrung) kacheln.push(kachelLink(ctx, "#/abgeben/erfahrung", null, "idee", "Erfahrung festhalten", "Ein Tipp fürs Team"));
  if (r.einsatz) kacheln.push(kachelLink(ctx, "#/abgeben/einsatz", fall ? { anlage: fall } : null, "werkzeug", "Einsatz dokumentieren", "Was war, was half"));
  let handbuch = null;
  if (r.handbuch) {
    handbuch = kachelLink(ctx, "#/abgeben/handbuch", null, "hochladen", "Handbuch hochladen", "Für ein neues Gerät");
    kacheln.push(handbuch);
  }
  const freigabeZahl = h("span", { class: "zahl-marke", hidden: true });
  if (r.freigabe) kacheln.push(kachelLink(ctx, "#/freigaben", null, "freigabe", "Freigaben", "Tipps prüfen", freigabeZahl));

  const beitraege = beitraegeBauen(ctx, function () { return weg; });
  const seite = h("section", { class: "ab-aufladen", "aria-label": "Wissen aufladen" },
    h("h1", { class: "ab-gross-titel", tabindex: "-1", text: "Wissen aufladen" }),
    h("p", { class: "ab-einladung", text: "Teile dein Wissen – jeder Tipp hilft dem Team." }),
    h("div", { class: "kacheln " + (kacheln.length === 1 ? "kacheln-1" : "kacheln-2") }, kacheln),
    beitraege.unten,
    beitraege.liste);
  container.appendChild(seite);
  kacheln.forEach(function (k, i) { zeige(k, i); });

  // Handbuch: erst nach einem Blick auf HANDBUCH_BEREIT – dynamisch, damit ein
  // Fehler in handbuch.js diesen Bildschirm nie mitreißt (13.3.10 Rückfall).
  if (handbuch) {
    import("./handbuch.js").then(function (m) { return m.HANDBUCH_BEREIT === true; }, function () { return false; })
      .then(function (bereit) {
        if (weg || bereit) return;
        const zeile = handbuch.querySelector(".kachel-text > span");
        if (zeile) zeile.textContent = "Bald verfügbar";
        handbuch.setAttribute("aria-disabled", "true");
        handbuch.addEventListener("click", function (e) { e.preventDefault(); e.stopImmediatePropagation(); }, true);
      });
  }
  if (r.freigabe) {
    ctx.api.freigaben(true).then(function (antwort) {
      if (weg) return;
      const z = antwort.zahlen || {};
      const n = (z.beitraege_offen || 0) + (z.codes_offen || 0);
      freigabeZahl.textContent = String(n);
      freigabeZahl.hidden = !n;
    }, function () {});
  }

  return {
    titel: "Wissen aufladen",
    aufraeumen: function () { weg = true; },
  };
}

// --- Bildschirm: Erfahrung festhalten (14.3.10) ----------------------------------------

/** Vier Felder auf den ersten Blick, zwei hinter „Mehr“ – Fragen statt Fachwörter. */
const ERFAHRUNG_FELDER = [
  { key: "geraet", label: "Gerät", lang: false, max: 80 },
  { key: "fehlerbild", label: "Was war los?", lang: true, max: 800, pflicht: true },
  { key: "ursache", label: "Woran lag es?", lang: true, max: 800 },
  { key: "loesung", label: "Was hilft?", lang: true, max: 800, pflicht: true },
  { key: "hersteller", label: "Hersteller", lang: false, max: 80, mehr: true },
  { key: "modell_serie", label: "Modell", lang: false, max: 80, mehr: true },
];

function vereinfachtText(s) {
  return String(s).toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
}

/** Welche Felder nennt die unklar-Liste der Strukturierung? → {feld: Hinweistext}. */
function unklarFuer(unklar) {
  const aus = {};
  (unklar || []).forEach(function (u) {
    const t = vereinfachtText(u);
    NOTIZ_FELDER.forEach(function (f) {
      if (t.indexOf(f.key) !== -1 || t.indexOf(vereinfachtText(f.label)) !== -1) aus[f.key] = String(u);
    });
    if (t.indexOf("modell") !== -1 || t.indexOf("serie") !== -1) aus.modell_serie = String(u);
  });
  return aus;
}

function mikroKnopf(feld) {
  return h("button", { type: "button", class: "rund mikro", title: "Diktieren: am Mac zweimal Fn", "aria-label": "Diktieren: am Mac zweimal Fn", onclick: function () { feld.focus(); } },
    ikon("mikrofon", { groesse: 20 }));
}

/**
 * opt.einladung (nur Kundenbetreuer, „Wissen aufladen“ mit genau einer
 * Kachel): oben „Wissen aufladen“ und der Einladungssatz, unten „Deine
 * Beiträge“ – das Feld steht gleich da.
 */
export function zeigeErfahrung(container, ctx, opt) {
  const o = opt || {};
  const r = rechteVon(ctx);
  const sofort = !!r.freigabe;
  const eingabeArt = { diktiert: 0, getippt: 0 };
  let felder = null;
  let fertig = false;
  let weg = false;

  const seite = h("section", { class: "ab-erfahrung" + (o.einladung ? " ab-aufladen" : ""), "aria-label": o.einladung ? "Wissen aufladen" : "Erfahrung festhalten" });
  if (o.einladung) {
    seite.appendChild(h("h1", { class: "ab-gross-titel", tabindex: "-1", text: "Wissen aufladen" }));
    seite.appendChild(h("p", { class: "ab-einladung", text: "Teile dein Wissen – jeder Tipp hilft dem Team." }));
  }
  container.appendChild(seite);

  const text = h("textarea", {
    class: "ab-erzaehlen", rows: "6", maxlength: "3000", spellcheck: "true",
    placeholder: "Tippen oder diktieren …", "aria-label": "Was hast du gelernt?",
  });
  text.addEventListener("input", function (e) {
    fehler.textContent = "";
    // Getippt oder diktiert? Das Diktat fügt ganze Wörter in einem Rutsch ein,
    // Tippen ein Zeichen je Ereignis. Das reicht, um `quelle` ehrlich zu füllen.
    const n = typeof e.data === "string" ? e.data.length : 0;
    if (e.inputType === "insertFromDictation" || ((e.inputType === "insertText" || e.inputType === "insertReplacementText") && n > 3)) {
      eingabeArt.diktiert += Math.max(n, 1);
    } else if (n > 0) {
      eingabeArt.getippt += n;
    }
  });
  const fehler = h("p", { class: "feld-fehler", role: "alert" });
  const weiter = h("button", { type: "button", class: "knopf-e knopf-e-primaer", text: "Weiter" });
  const selbst = h("button", { type: "button", class: "knopf-leise-e", text: "Selbst ausfüllen" });
  const sortiert = h("p", { class: "ab-sortiert", role: "status", hidden: true },
    h("span", { class: "kreisel-e", "aria-hidden": "true" }), h("span", { class: "schimmer", text: "Ich sortiere …" }));
  const schritt1 = h("div", { class: "ab-schritt-teil" },
    o.einladung
      ? h("h2", { class: "ab-gross-titel ab-unter-titel", text: "Was hast du gelernt?" })
      : h("h1", { class: "ab-gross-titel", tabindex: "-1", text: "Was hast du gelernt?" }),
    h("div", { class: "ab-text-rahmen" }, text, mikroKnopf(text)),
    fehler,
    sortiert,
    h("div", { class: "ab-fuss" },
      o.einladung ? h("span") : routenLink(ctx, "#/abgeben", null, "knopf-leise-e", "Abbrechen"),
      h("span", { class: "ab-fuss-rechts" }, selbst, weiter)));
  seite.appendChild(schritt1);
  const platz = h("div");
  seite.appendChild(platz);
  if (o.einladung) {
    const beitraege = beitraegeBauen(ctx, function () { return weg; });
    seite.appendChild(beitraege.unten);
    seite.appendChild(beitraege.liste);
  }
  if (mitMaus()) text.focus();

  function quelle() {
    return eingabeArt.diktiert > eingabeArt.getippt ? "diktat" : "text";
  }

  weiter.addEventListener("click", async function () {
    const t = text.value.trim();
    if (t.length < 20) {
      fehler.textContent = "Bitte etwas mehr: Gerät, was los war, was half.";
      text.focus();
      return;
    }
    weiter.disabled = true;
    selbst.disabled = true;
    sortiert.hidden = false;
    try {
      const antwort = await ctx.api.notiz("strukturieren", { text: t });
      if (weg) return;
      const karte = antwort && (antwort.karte || antwort.notiz) ? antwort.karte || antwort.notiz : {};
      karteZeigen(karte, Array.isArray(karte.unklar) ? karte.unklar : []);
    } catch (err) {
      if (weg) return;
      fehler.textContent = fehlerText(err, "Hat nicht geklappt. Du kannst auch selbst ausfüllen.");
    } finally {
      weiter.disabled = false;
      selbst.disabled = false;
      sortiert.hidden = true;
    }
  });
  selbst.addEventListener("click", function () { karteZeigen({}, []); });

  function karteZeigen(werte, unklar) {
    const markiert = unklarFuer(unklar);
    const gruppen = {};
    const kurz = h("div", { class: "ab-passt-felder" });
    const mehrFelder = h("div", { class: "ab-passt-felder" });
    ERFAHRUNG_FELDER.forEach(function (f) {
      const id = neueId("erf");
      const w = werte && werte[f.key] !== null && werte[f.key] !== undefined ? String(werte[f.key]) : "";
      const feld = f.lang
        ? h("textarea", { class: "feld", id: id, rows: "2", maxlength: String(f.max), spellcheck: "true" })
        : h("input", { class: "feld", id: id, type: "text", maxlength: String(f.max), autocomplete: "off" });
      feld.value = w;
      feld.dataset.feld = f.key;
      const fehlerZeile = h("p", { class: "feld-fehler", role: "alert" });
      const unklarText = markiert[f.key] || "";
      const wurzel = h("div", { class: "ab-feld" + (unklarText ? " ab-feld-unklar" : ""), title: unklarText || null },
        h("label", { class: "feld-label", for: id, text: f.label }), feld, fehlerZeile);
      feld.addEventListener("input", function () {
        fehlerZeile.textContent = "";
        feld.removeAttribute("aria-invalid");
        if (feld.value.trim()) wurzel.classList.remove("ab-feld-unklar");
      });
      gruppen[f.key] = { feld: feld, fehler: fehlerZeile };
      (f.mehr ? mehrFelder : kurz).appendChild(wurzel);
    });
    const status = h("p", { class: "feld-fehler", role: "alert" });
    const abgeben = h("button", { type: "button", class: "knopf-e knopf-e-primaer", text: sofort ? "Freigeben" : "Einreichen" });
    const zurueck = h("button", { type: "button", class: "knopf-leise-e", text: "Zurück", onclick: function () {
      leeren(platz);
      schritt1.hidden = false;
      text.focus();
    } });
    const karte = h("div", { class: "ab-schritt-teil" },
      h("h1", { class: "ab-gross-titel", tabindex: "-1", text: "Passt das so?" }),
      kurz,
      h("details", { class: "mehr ab-mehr" }, h("summary", null, h("span", { text: "Mehr" }), ikon("runter", { groesse: 14, klasse: "mehr-pfeil" })), mehrFelder),
      // Passend zum Knopf „Freigeben“ (vorher „Ab dem Speichern …“, einen Knopf „Speichern“ gibt es nicht).
      h("p", { class: "ab-leise", text: sofort ? "Ab jetzt hilft es allen." : "Ein Meister schaut kurz drüber." }),
      status,
      h("div", { class: "ab-fuss" }, zurueck, abgeben));
    schritt1.hidden = true;
    leeren(platz).appendChild(karte);
    bewege(karte, [{ opacity: 0, transform: "translateX(24px)" }, { opacity: 1, transform: "none" }], 280);
    const titel = karte.querySelector("h1");
    if (titel) titel.focus({ preventScroll: true });
    felder = gruppen;

    abgeben.addEventListener("click", async function () {
      status.textContent = "";
      const n = {};
      ERFAHRUNG_FELDER.forEach(function (f) {
        const v = gruppen[f.key].feld.value.trim();
        n[f.key] = v ? v : null;
      });
      let erstes = null;
      [["fehlerbild", "Was war los?"], ["loesung", "Was hilft?"]].forEach(function (p) {
        if (n[p[0]]) return;
        gruppen[p[0]].fehler.textContent = "Bitte ausfüllen.";
        gruppen[p[0]].feld.setAttribute("aria-invalid", "true");
        if (!erstes) erstes = gruppen[p[0]].feld;
      });
      if (erstes) {
        erstes.focus();
        return;
      }
      abgeben.disabled = true;
      zurueck.disabled = true;
      try {
        const antwort = await ctx.api.notiz("einreichen", { notiz: n, quelle: quelle() });
        if (weg) return;
        fertig = true;
        ctx.geaendert({ freigaben: true });
        ergebnisZeigen(antwort);
      } catch (err) {
        if (weg) return;
        status.textContent = fehlerText(err, "Hat nicht geklappt.");
        abgeben.disabled = false;
        zurueck.disabled = false;
      }
    });
  }

  function ergebnisZeigen(antwort) {
    const istQuelle = antwort.status === "freigegeben";
    // Eigener, einladender Satz statt des Server-Texts („Erst nach der Freigabe
    // ist er Quelle.“ / „MN-09 ist ab jetzt Quelle.“) – der widersprach dem
    // Versprechen „Ein Meister schaut kurz drüber.“ und zeigte ein Kürzel
    // (Gegenprüfung 09.10.). Dass der Assistent den Tipp ab jetzt nutzt, bleibt
    // sichtbar; Kürzel und Server-Text stehen im title.
    const satz = istQuelle ? "Danke! Ab jetzt nutzt der Assistent deinen Tipp." : "Danke! Ein Meister schaut kurz drüber.";
    const hinweis = [antwort.kuerzel ? "Quelle " + antwort.kuerzel : null, antwort.text ? String(antwort.text) : null].filter(Boolean).join(" · ");
    const karte = h("div", { class: "ab-schritt-teil ab-ergebnis", role: "status" },
      h("span", { class: "ab-ergebnis-symbol" + (istQuelle ? " ist-gut" : ""), "aria-hidden": "true" }, ikon(istQuelle ? "haken" : "uhr", { groesse: 28 })),
      h("h1", { class: "ab-gross-titel", tabindex: "-1", title: hinweis || null, text: satz }),
      h("div", { class: "ab-fuss ab-fuss-mitte" },
        routenLink(ctx, "#/brauchen", null, "knopf-e knopf-e-primaer", "Zurück zum Kunden"),
        h("button", { type: "button", class: "knopf-e knopf-e-rand", text: "Noch ein Tipp", onclick: function () {
          fertig = false;
          felder = null;
          text.value = "";
          eingabeArt.diktiert = 0;
          eingabeArt.getippt = 0;
          leeren(platz);
          schritt1.hidden = false;
          text.focus();
        } })));
    leeren(platz).appendChild(karte);
    bewege(karte, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], 280);
    const titel = karte.querySelector("h1");
    if (titel) titel.focus({ preventScroll: true });
  }

  return {
    titel: o.einladung ? "Wissen aufladen" : "Erfahrung festhalten",
    verlassen: function () {
      if (fertig) return true;
      const offen = text.value.trim() || (felder && Object.keys(felder).some(function (k) { return felder[k].feld.value.trim(); }));
      if (!offen) return true;
      return ctx.bestaetigen("Dein Tipp ist noch nicht gespeichert. Trotzdem verlassen?", { ja: "Verlassen", nein: "Bleiben", gefahr: true });
    },
    aufraeumen: function () { weg = true; },
  };
}

// --- Bildschirm: Einsatz dokumentieren – Schritt für Schritt (14.3.11) -------------------

/** Evidenz-Punkte: n von gesamt, gefüllt in --marke-balken (auch für freigabe.js/handbuch.js). */
export function evidenzPunkte(matching, total) {
  const max = Math.min(total, 24);
  const gefuellt = Math.round(matching * max / Math.max(total, 1));
  const punkte = h("span", { class: "ab-punkte", "aria-hidden": "true" });
  for (let i = 0; i < max; i++) punkte.appendChild(h("span", { class: "ab-punkt" + (i < gefuellt ? " ab-punkt-voll" : "") }));
  return punkte;
}

// Kurz, damit ein Schritt höchstens 20 Wörter hat (SPEC 14.3.2, Gegenprüfung 09.10.).
const MASSNAHME_KACHELN = [
  ["symptom", "Nachgefüllt / neu gestartet"],
  ["diagnose", "Gemessen"],
  ["ursache_behoben", "Ursache behoben"],
  ["sonstiges", "Etwas anderes"],
];

/** Kurzname einer Ursache für Kachel und „Passt das?“; der lange Text bleibt im title. */
function ursacheKurz(o) {
  if (!o) return "";
  const kurz = URSACHE_KURZ[o.key];
  if (kurz) return kurz;
  const l = String(o.label || o.key || "");
  return l.charAt(0).toUpperCase() + l.slice(1);
}

/** Server-Feld eines 400 → Schritt, der es abfragt. */
const FELD_SCHRITT = {
  anlage_id: "anlage", kanal: "was", symptom: "was", symptom_kategorie: "was", komponente_id: "was",
  fehlercode: "code", massnahme: "gemacht", "massnahme.text": "gemacht", "massnahme.art": "gemacht", "massnahme.vor_ort": "gemacht",
  ursache: "ursache", "ursache.text": "ursache", "ursache.ursache_kategorie": "ursache", "ursache.verifiziert": "ursache",
  schliessen: "schliessen",
};

/** Wie die Fallsuche in app.js: auch „A1042“ findet A-1042 (Gegenprüfung 09.10.). */
function suchformE(s) {
  return String(s || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/str\./g, "strasse")
    .replace(/\ba\s?[-–‑]?\s?(\d{4})\b/g, "a$1");
}

function bewege(el, frames, dauer) {
  if (!el || ruhig() || typeof el.animate !== "function") return;
  try {
    el.animate(frames, { duration: dauer, easing: "cubic-bezier(.2,.8,.2,1)" });
  } catch (e) {
    // ohne Bewegung
  }
}

/** Große Wahlkarte: Symbol links, Titel, optional eine Zeile. */
function wahlKarte(ikonName, titel, zeile, onclick, opt) {
  const o = opt || {};
  return h("button", {
    type: "button",
    class: "ab-wahl-karte" + (o.gewaehlt ? " ist-gewaehlt" : "") + (o.gestrichelt ? " ist-gestrichelt" : ""),
    "aria-pressed": o.gewaehlt ? "true" : "false",
    onclick: onclick,
  },
  h("span", { class: "ort-ikon" + (o.neutral ? " neutral" : ""), "aria-hidden": "true" }, ikon(ikonName, { groesse: 20 })),
  h("span", { class: "ab-wahl-text" }, h("strong", { text: titel }), zeile ? h("span", { text: zeile }) : null));
}

export function zeigeEinsatz(container, ctx, param) {
  const p = param || {};
  const r = rechteVon(ctx);
  let weg = false;
  let gespeichert = false;
  let basis = null; // GET einsatz (Listen)
  let teil = null; // GET einsatz?anlage_id=…
  const s = {
    anlage: null,
    ticket: "neu",
    kategorie: "",
    symptom: "",
    kanal: "telefon",
    komponente_id: null,
    fehlercode: undefined,
    massnahme: undefined, // {text, art, vor_ort} | null („Noch nichts“)
    ursache: undefined, // {ursache_kategorie, verifiziert, text} | null („Weiß ich noch nicht“)
    schliessen: null,
  };
  let schritt = "anlage";
  let serverFehler = null; // {schritt, text}
  let suchen = false;

  const seite = h("section", { class: "ab-einsatz", "aria-label": "Einsatz dokumentieren" });
  container.appendChild(seite);

  if (!r.einsatz) {
    seite.appendChild(h("h1", { class: "ab-gross-titel", text: "Nur für Techniker und Meister." }));
    return { titel: "Einsatz dokumentieren" };
  }

  const balken = h("div", { class: "ab-balken", "aria-hidden": "true" });
  const titel = h("h1", { class: "ab-gross-titel", tabindex: "-1" });
  const inhalt = h("div", { class: "ab-schritt-inhalt" });
  const fehler = h("p", { class: "feld-fehler", role: "alert" });
  const links = h("span", { class: "ab-fuss-links" });
  const rechts = h("span", { class: "ab-fuss-rechts" });
  const buehne = h("div", { class: "ab-schritt-teil" }, balken, titel, inhalt, fehler, h("div", { class: "ab-fuss" }, links, rechts));
  seite.appendChild(buehne);
  inhalt.appendChild(h("div", { class: "skelett ab-skelett-karte", "aria-hidden": "true" }));

  ctx.api.einsatzListen().then(function (antwort) {
    if (weg) return;
    basis = antwort;
    const start = String(p.anlage || (ctx.fall && ctx.fall.anlage_id) || "").trim().toUpperCase();
    const a = start ? anlagenListe().filter(function (x) { return x.id === start; })[0] : null;
    if (a) s.anlage = a;
    else suchen = true;
    zeigen(0);
  }, function (err) {
    if (weg) return;
    leeren(inhalt).appendChild(h("p", { class: "ab-leise", text: fehlerText(err, "Nicht geladen.") }));
  });

  /** Anlagen mit Adresse: aus GET einsatz, ergänzt aus der Fallsuche-Liste (ctx.anlagen). */
  function anlagenListe() {
    const roh = basis && Array.isArray(basis.anlagen) ? basis.anlagen : [];
    const extra = Array.isArray(ctx.anlagen) ? ctx.anlagen : [];
    return roh.map(function (a) {
      const e = extra.filter(function (x) { return x.id === a.id; })[0] || {};
      return Object.assign({}, e, a, {
        strasse: a.strasse || e.strasse || "",
        hausnummer: a.hausnummer || e.hausnummer || "",
        plz: a.plz || e.plz || "",
        ort: a.ort || e.ort || "",
      });
    });
  }

  function adresse(a) {
    return [[a.strasse, a.hausnummer].filter(Boolean).join(" "), a.ort].filter(Boolean).join(", ");
  }

  function offene() {
    return teil && Array.isArray(teil.offene_tickets) ? teil.offene_tickets : [];
  }

  function kategorieJetzt() {
    if (s.ticket !== "neu") {
      const t = offene().filter(function (x) { return x.id === s.ticket; })[0];
      return t ? t.symptom_kategorie : "";
    }
    return s.kategorie;
  }

  function komponenteJetzt() {
    const k = teil && Array.isArray(teil.komponenten) ? teil.komponenten : [];
    return k.filter(function (x) { return x.id === s.komponente_id; })[0] || null;
  }

  function codesPassend() {
    const k = komponenteJetzt();
    const codes = teil && Array.isArray(teil.fehlercodes) ? teil.fehlercodes : [];
    const hersteller = k && k.hersteller ? String(k.hersteller).toLowerCase() : "";
    return hersteller ? codes.filter(function (c) { return String(c.hersteller || "").toLowerCase() === hersteller; }) : [];
  }

  /** Codes, die bei dieser Anlage schon vorkamen (aus der Akte links, ctx.akteCodes). */
  function bekannteCodes() {
    const a = ctx.akteCodes;
    if (!a || !s.anlage || a.anlage_id !== s.anlage.id || !Array.isArray(a.codes)) return [];
    return a.codes.map(String);
  }

  function schritte() {
    const l = ["anlage"];
    if (offene().length) l.push("ticket");
    if (s.ticket === "neu") {
      l.push("was");
      if (codesPassend().length) l.push("code");
    }
    l.push("gemacht", "ursache", "schliessen", "passt");
    return l;
  }

  function weiterZu(richtung) {
    const l = schritte();
    const i = l.indexOf(schritt);
    const ziel = l[i + richtung];
    if (!ziel) {
      if (richtung < 0) ctx.navigiere("#/abgeben");
      return;
    }
    schritt = ziel;
    zeigen(richtung);
  }

  function springeZu(name) {
    schritt = name;
    zeigen(-1);
  }

  function knopf(text, klasse, onclick) {
    return h("button", { type: "button", class: klasse, text: text, onclick: onclick });
  }

  /** Einen Schritt zeigen: Balken, Titel, Inhalt, Fuß. Bewegung parallel, nie abgewartet. */
  function zeigen(richtung) {
    fehler.textContent = serverFehler && serverFehler.schritt === schritt ? serverFehler.text : "";
    if (serverFehler && serverFehler.schritt === schritt) serverFehler = null;
    const l = schritt === "fertig" ? [] : schritte();
    leeren(balken);
    l.forEach(function (n, i) { balken.appendChild(h("i", { class: i <= l.indexOf(schritt) ? "ist-an" : null })); });
    leeren(inhalt);
    leeren(links);
    leeren(rechts);
    const bauer = SCHRITTE[schritt];
    bauer();
    if (richtung) bewege(buehne, [{ opacity: 0, transform: "translateX(" + (richtung > 0 ? 24 : -24) + "px)" }, { opacity: 1, transform: "none" }], 280);
    naechsterFrame(function () {
      if (!buehne.isConnected) return;
      try {
        titel.focus({ preventScroll: true });
      } catch (e) {
        titel.focus();
      }
      const zone = buehne.closest(".rechts-bildschirm");
      if (zone) zone.scrollTop = 0;
    });
  }

  function zurueckKnopf() {
    const erster = schritte()[0] === schritt;
    links.appendChild(erster
      ? routenLink(ctx, "#/abgeben", null, "knopf-leise-e", "Abbrechen")
      : knopf("Zurück", "knopf-leise-e", function () { weiterZu(-1); }));
  }

  // --- Schritte ----------------------------------------------------------------------
  const SCHRITTE = {
    anlage: function () {
      titel.textContent = "Welche Anlage?";
      if (!suchen || !s.anlage) zurueckKnopf();
      else {
        links.appendChild(knopf("Zurück", "knopf-leise-e", function () {
          suchen = false;
          zeigen(-1);
        }));
      }
      if (!suchen && s.anlage) {
        inhalt.appendChild(h("div", { class: "ab-wahl" },
          wahlKarte("ort", s.anlage.kunde_alias || s.anlage.id, adresse(s.anlage), function () { anlageNehmen(s.anlage); }, { gewaehlt: true }),
          wahlKarte("suche", "Andere Anlage", null, function () {
            suchen = true;
            zeigen(0);
          }, { gestrichelt: true, neutral: true })));
        rechts.appendChild(knopf("Weiter", "knopf-e knopf-e-primaer", function () { anlageNehmen(s.anlage); }));
        return;
      }
      // Suche wie die Fallsuche: Kunde, Adresse oder Anlagennummer.
      const treffer = h("div", { class: "ab-wahl" });
      const feld = h("input", { type: "search", class: "suchfeld-eingabe", placeholder: "Name, Straße oder Nummer", "aria-label": "Kunde suchen: Name, Straße oder Anlagennummer", autocomplete: "off", spellcheck: "false" });
      function filtern() {
        leeren(treffer);
        const q = suchformE(feld.value.trim());
        if (q.length < 2) return;
        const teile = q.split(/[\s,]+/).filter(Boolean);
        const liste = anlagenListe().filter(function (a) {
          const heu = suchformE([a.kunde_alias, a.strasse, a.hausnummer, a.plz, a.ort, a.id].filter(Boolean).join(" "));
          return teile.every(function (t) { return heu.indexOf(t) !== -1; });
        }).slice(0, 6);
        liste.forEach(function (a) {
          treffer.appendChild(wahlKarte("ort", a.kunde_alias || a.id, adresse(a), function () {
            s.anlage = a;
            suchen = false;
            anlageNehmen(a);
          }));
        });
        if (!liste.length) treffer.appendChild(h("p", { class: "ab-leise", text: "Nichts gefunden." }));
      }
      feld.addEventListener("input", filtern);
      feld.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          const erster = treffer.querySelector(".ab-wahl-karte");
          if (erster) erster.click();
        }
      });
      inhalt.appendChild(h("label", { class: "suchfeld" }, ikon("suche", { groesse: 20 }), feld));
      inhalt.appendChild(treffer);
      naechsterFrame(function () { if (mitMaus()) feld.focus(); });
    },

    ticket: function () {
      titel.textContent = "Neues Ticket oder offenes?";
      zurueckKnopf();
      const karten = offene().map(function (t) {
        return wahlKarte("ticket", kuerzen(typo(t.symptom || t.id), 36), "offen seit " + datumKurz(t.erstellt_am), function () {
          s.ticket = t.id;
          weiterZu(1);
        }, { gewaehlt: s.ticket === t.id });
      });
      karten.push(wahlKarte("plus", "Neues Ticket", null, function () {
        s.ticket = "neu";
        weiterZu(1);
      }, { gewaehlt: s.ticket === "neu" && s.kategorie !== "", neutral: true }));
      inhalt.appendChild(h("div", { class: "ab-wahl" }, karten));
    },

    was: function () {
      titel.textContent = "Was war los?";
      zurueckKnopf();
      // Reihenfolge wie die Kurznamen (Wärmepumpe zuerst) statt alphabetisch nach Schlüssel.
      const reihe = Object.keys(KATEGORIE_KURZ);
      const alleKat = (basis && Array.isArray(basis.symptom_kategorien) ? basis.symptom_kategorien.slice() : []).sort(function (x, y) {
        const a = reihe.indexOf(x.key);
        const b = reihe.indexOf(y.key);
        return (a === -1 ? 99 : a) - (b === -1 ? 99 : b);
      });
      // Nur, was zu dieser Anlage passt: Fehlerbilder ohne Gerät (Login,
      // Rechnung) und solche, deren Gerät die Anlage hat. Bei A-1042 (nur
      // Wärmepumpe) also kein „Wallbox lädt nicht“ – der Rest bleibt hinter
      // „Etwas anderes …“ (Gegenprüfung 09.10.).
      const typen = (teil && Array.isArray(teil.komponenten) ? teil.komponenten : []).map(function (k) { return k.typ; });
      const passend = typen.length
        ? alleKat.filter(function (k) { return !k.geraetetyp || typen.indexOf(k.geraetetyp) !== -1; })
        : alleKat;
      let alleZeigen = passend.length === alleKat.length || (!!s.kategorie && !passend.some(function (k) { return k.key === s.kategorie; }));
      const kacheln = h("div", { class: "ab-kat", role: "group", "aria-label": "Was war los?" });
      function kachelnZeigen() {
        leeren(kacheln);
        (alleZeigen ? alleKat : passend).forEach(function (k) {
          const b = h("button", { type: "button", class: "ab-kat-knopf", "aria-pressed": s.kategorie === k.key ? "true" : "false", "data-wert": k.key, title: k.label, text: KATEGORIE_KURZ[k.key] || k.label });
          b.addEventListener("click", function () {
            s.kategorie = k.key;
            Array.prototype.forEach.call(kacheln.querySelectorAll(".ab-kat-knopf"), function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
            geraetWahlNeu();
            fehler.textContent = "";
          });
          kacheln.appendChild(b);
        });
        if (!alleZeigen) {
          kacheln.appendChild(h("button", { type: "button", class: "ab-kat-knopf ab-kat-mehr", onclick: function () {
            alleZeigen = true;
            kachelnZeigen();
            const erste = kacheln.querySelectorAll(".ab-kat-knopf")[passend.length];
            if (erste) erste.focus();
          } }, "Etwas anderes …"));
        }
      }
      kachelnZeigen();
      const id = neueId("symptom");
      // Kein sichtbares Label „In einem Satz“ – der Platzhalter sagt es, der
      // Screenreader liest das Label (SPEC 14.3.2: höchstens 20 Wörter je Schritt).
      const symptom = h("textarea", { class: "feld", id: id, rows: "2", maxlength: "500", placeholder: "In einem Satz: Was ist los?" });
      symptom.value = s.symptom;
      symptom.addEventListener("input", function () { s.symptom = symptom.value; fehler.textContent = ""; });
      const kanaele = basis && Array.isArray(basis.kanaele) && basis.kanaele.length ? basis.kanaele : [{ key: "telefon", label: "Telefon" }, { key: "mail", label: "Mail" }, { key: "app", label: "App" }];
      const kanalName = function (key) {
        const k = kanaele.filter(function (x) { return x.key === key; })[0];
        return k ? k.label : key;
      };
      const kanal = h("div", { class: "segment ab-segment", role: "group", "aria-label": "Kanal" }, kanaele.map(function (k) {
        const b = h("button", { type: "button", "aria-pressed": s.kanal === k.key ? "true" : "false", text: k.label });
        b.addEventListener("click", function () {
          s.kanal = k.key;
          Array.prototype.forEach.call(kanal.children, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        });
        return b;
      }));
      // Kanal: meist Telefon – deshalb nur ein leiser Link „per Telefon“, der
      // die Wahl erst auf Klick zeigt (vorher lag der Schalter bei 390 px unter
      // der klebenden Fußleiste).
      const kanalPlatz = h("div", { class: "ab-kanal" });
      if (s.kanal === "telefon") {
        kanalPlatz.appendChild(h("button", {
          type: "button", class: "knopf-leise-e ab-kanal-link", "aria-label": "Kanal ändern, jetzt per " + kanalName(s.kanal),
          onclick: function () {
            leeren(kanalPlatz).appendChild(kanal);
            const gewaehlt = kanal.querySelector("[aria-pressed=true]");
            if (gewaehlt) gewaehlt.focus();
          },
        }, "per " + kanalName(s.kanal), ikon("runter", { groesse: 14 })));
      } else {
        kanalPlatz.appendChild(kanal);
      }
      const geraetPlatz = h("div");
      function geraetWahlNeu() {
        leeren(geraetPlatz);
        const kat = alleKat.filter(function (k) { return k.key === s.kategorie; })[0];
        const typ = kat ? kat.geraetetyp : null;
        const alle = teil && Array.isArray(teil.komponenten) ? teil.komponenten : [];
        const passendeGeraete = typ ? alle.filter(function (k) { return k.typ === typ; }) : [];
        // Gerät automatisch, wenn die Anlage genau eines vom passenden Typ hat (14.3.11).
        if (passendeGeraete.length === 1) {
          s.komponente_id = passendeGeraete[0].id;
          return;
        }
        if (!passendeGeraete.some(function (k) { return k.id === s.komponente_id; })) s.komponente_id = null;
        if (passendeGeraete.length > 1) {
          geraetPlatz.appendChild(h("p", { class: "feld-label", text: "Welches Gerät?" }));
          const seg = h("div", { class: "segment ab-segment", role: "group", "aria-label": "Welches Gerät?" }, passendeGeraete.map(function (k) {
            const b = h("button", { type: "button", "aria-pressed": s.komponente_id === k.id ? "true" : "false", text: [k.bezeichnung || k.typ, k.hersteller].filter(Boolean).join(" · ") });
            b.addEventListener("click", function () {
              s.komponente_id = k.id;
              Array.prototype.forEach.call(seg.children, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
            });
            return b;
          }));
          geraetPlatz.appendChild(seg);
        }
      }
      geraetWahlNeu();
      inhalt.appendChild(kacheln);
      inhalt.appendChild(h("div", { class: "ab-feld" }, h("label", { class: "sr-only", for: id, text: "In einem Satz" }), symptom));
      inhalt.appendChild(kanalPlatz);
      inhalt.appendChild(geraetPlatz);
      rechts.appendChild(knopf("Weiter", "knopf-e knopf-e-primaer", function () {
        if (!s.kategorie) {
          fehler.textContent = "Bitte wählen, was los war.";
          return;
        }
        if (s.symptom.trim().length < 10) {
          fehler.textContent = "Bitte in einem Satz beschreiben (mindestens 10 Zeichen).";
          symptom.focus();
          return;
        }
        s.fehlercode = undefined;
        weiterZu(1);
      }));
    },

    code: function () {
      titel.textContent = "Code im Display?";
      zurueckKnopf();
      // „Kein Code“ ist die häufigste Antwort – sie steht vorn. Danach die
      // Codes, die bei dieser Anlage schon vorkamen, mit Bezeichnung (auf dem
      // Handy gibt es kein Überfahren für den title); der Rest hinter „Andere
      // Codes (n)“ (Gegenprüfung 09.10.: vorher eine Wand aus 15 Codes).
      const alle = codesPassend();
      const bekannt = bekannteCodes();
      const vorne = alle.filter(function (c) { return bekannt.indexOf(c.code) !== -1; });
      const rest = alle.filter(function (c) { return bekannt.indexOf(c.code) === -1; });
      const nimm = function (code) {
        return function () {
          s.fehlercode = code;
          weiterZu(1);
        };
      };
      const karten = [wahlKarte("schliessen", "Kein Code", null, nimm(null), { gewaehlt: s.fehlercode === null, neutral: true })];
      vorne.forEach(function (c) {
        karten.push(wahlKarte("seite", c.code, c.bezeichnung ? typo(c.bezeichnung) : null, nimm(c.code), { gewaehlt: s.fehlercode === c.code }));
      });
      inhalt.appendChild(h("div", { class: "ab-wahl" }, karten));
      if (rest.length) {
        const chips = h("div", { class: "ab-codes", hidden: !rest.some(function (c) { return c.code === s.fehlercode; }) }, rest.map(function (c) {
          return h("button", { type: "button", class: "ab-code" + (s.fehlercode === c.code ? " ist-gewaehlt" : ""), title: c.bezeichnung || null, text: c.code, onclick: nimm(c.code) });
        }));
        const auf = h("button", { type: "button", class: "knopf-leise-e ab-codes-auf", "aria-expanded": chips.hidden ? "false" : "true", onclick: function () {
          chips.hidden = !chips.hidden;
          auf.setAttribute("aria-expanded", chips.hidden ? "false" : "true");
        } }, (vorne.length ? "Andere Codes (" : "Codes (") + rest.length + ")", ikon("runter", { groesse: 14 }));
        inhalt.appendChild(auf);
        inhalt.appendChild(chips);
      }
    },


    gemacht: function () {
      titel.textContent = "Was hast du gemacht?";
      zurueckKnopf();
      const m = s.massnahme || { text: "", art: "", vor_ort: true };
      const id = neueId("mass");
      const feld = h("textarea", { class: "feld", id: id, rows: "2", maxlength: "500", "aria-label": "Was hast du gemacht?", placeholder: "z. B. Vordruck gemessen: 0,4 bar, auf 1,0 bar eingestellt" });
      feld.value = m.text || "";
      const arten = h("div", { class: "ab-kat ab-kat-breit", role: "group", "aria-label": "Art" }, MASSNAHME_KACHELN.map(function (a) {
        const b = h("button", { type: "button", class: "ab-kat-knopf", "aria-pressed": m.art === a[0] ? "true" : "false", text: a[1] });
        b.addEventListener("click", function () {
          m.art = a[0];
          Array.prototype.forEach.call(arten.children, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
          fehler.textContent = "";
        });
        return b;
      }));
      const vorOrt = h("button", { type: "button", class: "ab-schalter", role: "switch", "aria-checked": m.vor_ort === false ? "false" : "true" },
        h("span", { class: "ab-schalter-spur", "aria-hidden": "true" }, h("span", { class: "ab-schalter-knopf" })), h("span", { text: "Vor Ort" }));
      vorOrt.addEventListener("click", function () {
        const an = vorOrt.getAttribute("aria-checked") !== "true";
        vorOrt.setAttribute("aria-checked", an ? "true" : "false");
        m.vor_ort = an;
      });
      feld.addEventListener("input", function () { m.text = feld.value; fehler.textContent = ""; });
      inhalt.appendChild(feld);
      inhalt.appendChild(arten);
      inhalt.appendChild(vorOrt);
      rechts.appendChild(knopf("Noch nichts", "knopf-leise-e", function () {
        s.massnahme = null;
        weiterZu(1);
      }));
      rechts.appendChild(knopf("Weiter", "knopf-e knopf-e-primaer", function () {
        const t = String(m.text || "").trim();
        if (!t && !m.art) {
          fehler.textContent = "Kurz beschreiben oder „Noch nichts“.";
          feld.focus();
          return;
        }
        if (t.length < 3) {
          fehler.textContent = "Bitte kurz beschreiben (mindestens 3 Zeichen).";
          feld.focus();
          return;
        }
        if (!m.art) {
          fehler.textContent = "Bitte wählen, was es war.";
          return;
        }
        s.massnahme = { text: t, art: m.art, vor_ort: m.vor_ort !== false };
        weiterZu(1);
      }));
      naechsterFrame(function () { if (mitMaus()) feld.focus(); });
    },

    ursache: function () {
      titel.textContent = "Woran lag es?";
      zurueckKnopf();
      const kat = kategorieJetzt();
      const liste = basis && basis.ursachen && kat ? basis.ursachen[kat] || [] : [];
      const u = s.ursache || { ursache_kategorie: "", verifiziert: false, text: "" };
      const details = h("div", { class: "ab-ursache-details", hidden: !u.ursache_kategorie });
      const kacheln = h("div", { class: "ab-kat ab-kat-breit", role: "group", "aria-label": "Woran lag es?" }, liste.map(function (o) {
        // Kurzname auf der Kachel, der lange Text als title und als Beschreibung im Ticket.
        const b = h("button", { type: "button", class: "ab-kat-knopf", "aria-pressed": u.ursache_kategorie === o.key ? "true" : "false", title: o.label, text: ursacheKurz(o) });
        b.addEventListener("click", function () {
          // Beschreibung mit der Bezeichnung vorbelegen, solange niemand selbst geschrieben hat.
          const alt = liste.filter(function (x) { return x.key === u.ursache_kategorie; })[0];
          if (!u.text || (alt && u.text === alt.label)) u.text = o.key === "sonstige" ? "" : o.label;
          u.ursache_kategorie = o.key;
          Array.prototype.forEach.call(kacheln.children, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
          details.hidden = false;
          feld.value = u.text;
          fehler.textContent = "";
        });
        return b;
      }));
      const seg = h("div", { class: "segment ab-segment", role: "group", "aria-label": "Bestätigt oder vermutet" },
        [["Bestätigt", true], ["Vermutet", false]].map(function (x) {
          const b = h("button", { type: "button", "aria-pressed": u.verifiziert === x[1] ? "true" : "false", text: x[0] });
          b.addEventListener("click", function () {
            u.verifiziert = x[1];
            Array.prototype.forEach.call(seg.children, function (y) { y.setAttribute("aria-pressed", y === b ? "true" : "false"); });
          });
          return b;
        }));
      const id = neueId("urs");
      const feld = h("textarea", { class: "feld", id: id, rows: "2", maxlength: "500" });
      feld.value = u.text || "";
      feld.addEventListener("input", function () { u.text = feld.value; fehler.textContent = ""; });
      details.appendChild(seg);
      details.appendChild(h("div", { class: "ab-feld" }, h("label", { class: "feld-label", for: id, text: "Kurz beschreiben" }), feld));
      inhalt.appendChild(kacheln);
      inhalt.appendChild(details);
      if (!liste.length) inhalt.appendChild(h("p", { class: "ab-leise", text: "Für dieses Fehlerbild gibt es keine Liste." }));
      rechts.appendChild(knopf("Weiß ich noch nicht", "knopf-leise-e", function () {
        s.ursache = null;
        weiterZu(1);
      }));
      rechts.appendChild(knopf("Weiter", "knopf-e knopf-e-primaer", function () {
        if (!u.ursache_kategorie) {
          fehler.textContent = "Bitte wählen oder „Weiß ich noch nicht“.";
          return;
        }
        const t = String(u.text || "").trim();
        if (t.length < 3) {
          fehler.textContent = "Bitte kurz beschreiben (mindestens 3 Zeichen).";
          feld.focus();
          return;
        }
        s.ursache = { ursache_kategorie: u.ursache_kategorie, verifiziert: u.verifiziert === true, text: t };
        weiterZu(1);
      }));
    },

    schliessen: function () {
      titel.textContent = "Ticket schließen?";
      zurueckKnopf();
      const t = offene().filter(function (x) { return x.id === s.ticket; })[0];
      const hatBisher = t && (t.massnahmen || 0) > 0;
      inhalt.appendChild(h("div", { class: "ab-wahl" },
        wahlKarte("haken", "Ja, erledigt", null, function () {
          // Schließen braucht eine Maßnahme – in diesem Einsatz oder schon am Ticket.
          if (!s.massnahme && !hatBisher) {
            serverFehler = { schritt: "gemacht", text: "Zum Schließen braucht es eine Maßnahme." };
            springeZu("gemacht");
            return;
          }
          s.schliessen = true;
          weiterZu(1);
        }, { gewaehlt: s.schliessen === true }),
        wahlKarte("uhr", "Nein, bleibt offen", null, function () {
          s.schliessen = false;
          weiterZu(1);
        }, { gewaehlt: s.schliessen === false, neutral: true })));
    },

    passt: function () {
      titel.textContent = "Passt das?";
      zurueckKnopf();
      const a = s.anlage || {};
      const zeilen = [];
      if (s.ticket === "neu") {
        const kat = (basis.symptom_kategorien || []).filter(function (k) { return k.key === s.kategorie; })[0];
        zeilen.push("Neues Ticket · " + (a.kunde_alias || a.id) + " · " + (kat ? KATEGORIE_KURZ[kat.key] || kat.label : ""));
        if (s.fehlercode) zeilen.push("Code " + s.fehlercode);
      } else {
        const t = offene().filter(function (x) { return x.id === s.ticket; })[0];
        zeilen.push("Nachtrag · " + (a.kunde_alias || a.id) + " · " + kuerzen(t ? t.symptom : s.ticket, 36));
      }
      // Ohne „Geht so in die Akte:“ und ohne „(Ursache behoben, vor Ort)“ –
      // was der Nutzer selbst getippt hat, steht als eigener Text da (data-eigen,
      // zählt nicht ins Wortziel); die Ursache mit Kurzname (Gegenprüfung 09.10.).
      const text = h("p", { class: "geht-raus-text" });
      const zeile = function (kinder) {
        if (text.childNodes.length) text.appendChild(h("br"));
        (Array.isArray(kinder) ? kinder : [kinder]).forEach(function (k) {
          text.appendChild(typeof k === "string" ? document.createTextNode(typo(k)) : k);
        });
      };
      zeilen.forEach(function (z) { zeile(z); });
      if (s.ticket === "neu" && s.symptom.trim()) zeile(h("span", { "data-eigen": "1", text: "„" + typo(s.symptom.trim()) + "“" }));
      if (s.massnahme) zeile(["Gemacht: ", h("span", { "data-eigen": "1", text: typo(s.massnahme.text) })]);
      if (s.ursache) {
        const liste = basis && basis.ursachen ? basis.ursachen[kategorieJetzt()] || [] : [];
        const o = liste.filter(function (x) { return x.key === s.ursache.ursache_kategorie; })[0];
        if (o && o.key !== "sonstige") zeile("Ursache: " + ursacheKurz(o) + (s.ursache.verifiziert ? " (bestätigt)" : " (vermutet)"));
        else zeile(["Ursache: ", h("span", { "data-eigen": "1", text: typo(s.ursache.text) }), s.ursache.verifiziert ? " (bestätigt)" : " (vermutet)"]);
      }
      zeile(s.schliessen ? "Ticket wird geschlossen." : "Ticket bleibt offen.");
      inhalt.appendChild(gehtRaus(null, text));
      const speichern = knopf("Speichern", "knopf-e knopf-e-primaer", function () { speichernJetzt(speichern); });
      rechts.appendChild(speichern);
    },

    fertig: function () {
      titel.textContent = "Gespeichert.";
      const zm = s.ergebnis && s.ergebnis.zaehlt_mit;
      if (zm) {
        // „Ausdehnungsgefäß: jetzt 8 von 12 Fällen.“ – mit Bezug; „Zählt ab jetzt
        // mit: 8 von 12“ ließ offen, was gezählt wird (Gegenprüfung 09.10.).
        // Die Zahlen kommen weiter vom Server (zaehlt_mit).
        const liste = basis && basis.ursachen ? basis.ursachen[kategorieJetzt()] || [] : [];
        const o = s.ursache ? liste.filter(function (x) { return x.key === s.ursache.ursache_kategorie; })[0] : null;
        const wer = o && o.key !== "sonstige" ? ursacheKurz(o) : "Diese Ursache";
        inhalt.appendChild(h("p", { class: "ab-zaehlt" },
          evidenzPunkte(zm.matching, zm.total),
          h("span", { text: wer + ": jetzt " + zm.matching + " von " + zm.total + " Fällen." })));
      }
      const t = s.ergebnis && s.ergebnis.ticket ? s.ergebnis.ticket : {};
      links.appendChild(routenLink(ctx, "#/brauchen", { anlage: (s.anlage || {}).id, ticket: t.id }, "knopf-e knopf-e-rand", "Akte ansehen"));
      rechts.appendChild(routenLink(ctx, "#/brauchen", null, "knopf-e knopf-e-primaer", "Zurück zum Kunden"));
    },
  };

  /** Anlage gewählt → anlagenbezogene Listen laden, dann weiter. */
  function anlageNehmen(a) {
    s.anlage = a;
    leeren(rechts).appendChild(h("span", { class: "kreisel-e", "aria-hidden": "true" }));
    ctx.api.einsatzListen(a.id).then(function (antwort) {
      if (weg || s.anlage !== a) return;
      teil = antwort;
      if (antwort.anlage) s.anlage = Object.assign({}, a, antwort.anlage, { strasse: (antwort.anlage.strasse || a.strasse), hausnummer: (antwort.anlage.hausnummer || a.hausnummer) });
      const gewuenscht = String(p.ticket || "").trim().toUpperCase();
      if (offene().some(function (t) { return t.id === gewuenscht; })) s.ticket = gewuenscht;
      else if (s.ticket !== "neu" && !offene().some(function (t) { return t.id === s.ticket; })) s.ticket = "neu";
      weiterZu(1);
    }, function (err) {
      if (weg) return;
      fehler.textContent = fehlerText(err, "Die Anlage ist nicht geladen.");
      leeren(rechts).appendChild(knopf("Weiter", "knopf-e knopf-e-primaer", function () { anlageNehmen(a); }));
    });
  }

  async function speichernJetzt(knopfEl) {
    fehler.textContent = "";
    knopfEl.disabled = true;
    let schrittName;
    let daten;
    if (s.ticket === "neu") {
      schrittName = "anlegen";
      daten = {
        anlage_id: s.anlage.id,
        komponente_id: s.komponente_id,
        kanal: s.kanal,
        symptom: s.symptom.trim(),
        symptom_kategorie: s.kategorie,
        fehlercode: s.fehlercode || null,
        massnahme: s.massnahme || null,
        ursache: s.ursache || null,
        schliessen: s.schliessen === true,
      };
    } else {
      schrittName = "nachtragen";
      daten = { ticket_id: s.ticket, massnahme: s.massnahme || null, ursache: s.ursache || null, schliessen: s.schliessen === true };
    }
    try {
      const antwort = await ctx.api.einsatz(schrittName, daten);
      if (weg) return;
      gespeichert = true;
      s.ergebnis = antwort;
      ctx.geaendert({ anlage_id: s.anlage.id });
      schritt = "fertig";
      zeigen(1);
    } catch (err) {
      if (weg) return;
      knopfEl.disabled = false;
      // Ein 400 mit `feld` springt zum Schritt dieses Felds und zeigt den Server-Text dort.
      const feld = err && err.inhalt && err.inhalt.feld ? String(err.inhalt.feld) : "";
      const ziel = FELD_SCHRITT[feld];
      if (ziel && schritte().indexOf(ziel) !== -1) {
        serverFehler = { schritt: ziel, text: fehlerText(err) };
        springeZu(ziel);
        return;
      }
      fehler.textContent = fehlerText(err, "Speichern hat nicht geklappt.");
    }
  }

  return {
    titel: "Einsatz dokumentieren",
    verlassen: function () {
      const angefangen = schritt !== "anlage" && !gespeichert;
      if (!angefangen) return true;
      return ctx.bestaetigen("Der Einsatz ist noch nicht gespeichert. Trotzdem verlassen?", { ja: "Verlassen", nein: "Bleiben", gefahr: true });
    },
    aufraeumen: function () { weg = true; },
  };
}
