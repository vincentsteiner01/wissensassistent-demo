// ============================================================================
// handbuch.js  ·  Handbuch hochladen im Browser (SPEC 13.3.10) [FA]
// ----------------------------------------------------------------------------
//   zeigeHandbuch(container, ctx, param)   #/abgeben/handbuch?dok=D-UP-001
//   HANDBUCH_BEREIT                        false → Kachel und Route zeigen
//                                          „Handbuch hochladen – in Vorbereitung“
//
// Ablauf in sechs Schritten, jeder einzeln wiederholbar:
//   1 PDF wählen   SHA-256 im Browser; das PDF verlässt den Browser nicht
//   2 Angaben      Titel, Hersteller, Serie, Fassung, Typ, Link, Seitenversatz
//   3 Seiten       Vorschaubilder (lazy), Auswahl, Tokenzähler mit Grenze
//   4 Hochladen    erst jetzt `anlegen`; je Seite Text + PNG (110/90/72 dpi),
//                  Prüfsummen, Teile ≤ 1.900.000 Zeichen, „Erneut versuchen“
//                  je Teil, Fortsetzen über handbuecher(dok)
//   5 Fehlercodes  EIN KI-Aufruf über den Text der ausgewählten Seiten; der
//                  Server prüft jede Zeile gegen die Seite, ein Mensch danach
//   6 Aktivieren   erst jetzt wird das Handbuch Quelle (Q30 ff.)
//
// Warum im Browser zerlegen: Das Original-PDF (oft 60–200 Seiten, urheber-
// rechtlich geschützt) muss nicht auf den Server. Hochgeladen wird nur, was
// der Meister bewusst auswählt – jede Seite als Text (für den Prompt) und als
// Bild (für die Quellenansicht). Und weil jede Seite Tokens kostet, zeigt der
// Zähler vor dem Hochladen, wie groß die Wissensbasis danach ist.
//
// pdf.js 6.3.289 (Legacy-Build, Apache-2.0) liegt lokal unter vendor/pdfjs/
// und wird NUR hier geladen, per dynamischem import() beim ersten Bedarf.
// Optionsnamen gegen diese Version geprüft: cMapUrl, cMapPacked,
// standardFontDataUrl, wasmUrl, iccUrl. `isEvalSupported` gibt es in 6.x
// nicht mehr – der Worker nutzt kein eval (geprüft: kein `new Function`/`eval(`
// im Worker) –, deshalb weggelassen statt wirkungslos gesetzt.
// ============================================================================
import { datum, h, leeren, typo, zahl } from "./dom.js";
import { einblenden, naechsterFrame, ruhig } from "./bewegung.js";
import { ikon } from "./ikonen.js";
import {
  beschaeftigt,
  feldGruppe,
  fehlerText,
  gehtRaus,
  inSicht,
  mitMaus,
  rechteVon,
  routenLink,
  seitenKopf,
} from "./abgeben.js";
import { aktiviertBox, codePruefliste, textPruefung } from "./freigabe.js";

/** Geprüft am 08.10.2026 im Mock mit dem Testhandbuch und drei echten Herstellerunterlagen. */
export const HANDBUCH_BEREIT = true;

// Rückfallwerte, falls GET handbuch scheitert (dieselben wie app_config, SPEC 13.1.5).
const UMFANG_RUECKFALL = {
  wissensbasis_tokens: 57590, empfohlen_tokens: 90000, max_tokens: 150000, zeichen_je_token: 1.8,
  aufschlag_je_seite_zeichen: 120,
  grenzen: { max_seiten: 40, max_zeichen_seite: 12000, max_png_bytes: 450000, max_anfrage_zeichen: 2000000, max_vorschlag_zeichen: 120000 },
};
const MAX_PDF_BYTES = 60 * 1024 * 1024;
const MAX_TEIL_ZEICHEN = 1900000; // Server nimmt 2.000.000 – Luft für den JSON-Rahmen
const MIN_TEXT = 20;
const MIN_SCHRIFT_PT = 3;
const UNSICHTBAR_AB = 20; // Buchstaben, ab denen eine Seite „unsichtbarer Text“ trägt
const DPI_STUFEN = [110, 90, 72];
const MAX_PIXEL = 2400;
const TYPEN = [
  { key: "handbuch", label: "Handbuch / Bedienungsanleitung" },
  { key: "installationsanleitung", label: "Installations- und Wartungsanleitung" },
  { key: "datenblatt", label: "Datenblatt" },
];
const SCHRITTE = ["PDF wählen", "Angaben", "Seiten", "Hochladen", "Fehlercodes", "Aktivieren"];

// --- pdf.js laden (nur hier, nur bei Bedarf) --------------------------------------------

let pdfjsLader = null;
function pdfjsLaden() {
  if (!pdfjsLader) {
    pdfjsLader = import("./vendor/pdfjs/pdf.min.mjs").then(function (m) {
      // Worker relativ zu diesem Modul (web/) – gleiche Herkunft, kein CDN.
      m.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
      return m;
    });
    pdfjsLader.then(null, function () { pdfjsLader = null; });
  }
  return pdfjsLader;
}

function pdfOptionen(bytes) {
  // Absolute URLs: Der Worker löst relative Pfade sonst gegen seinen eigenen Ort auf.
  const basis = new URL("./vendor/pdfjs/", import.meta.url).href;
  return {
    data: bytes,
    cMapUrl: basis + "cmaps/",
    cMapPacked: true,
    standardFontDataUrl: basis + "standard_fonts/",
    wasmUrl: basis + "wasm/",
    iccUrl: basis + "iccs/",
    enableXfa: false,
    stopAtErrors: false,
  };
}

// --- Kleine Helfer --------------------------------------------------------------------

/**
 * PDF schließen. In pdf.js 6.3.289 hat das Dokument selbst kein destroy()
 * mehr – nur seine loadingTask (gemessen 08.10. abends). Ein nacktes
 * z.pdf.destroy() warf deshalb beim zweiten PDF, bei „Weiteres Handbuch
 * hochladen“ und beim Fortsetzen eines Entwurfs. Wirft nie.
 */
function pdfSchliessen(doc) {
  if (!doc) return;
  try {
    if (typeof doc.destroy === "function") doc.destroy();
    else if (doc.loadingTask && typeof doc.loadingTask.destroy === "function") doc.loadingTask.destroy();
  } catch (e) {
    // schon zu
  }
}

function hex(puffer) {
  const b = new Uint8Array(puffer);
  let s = "";
  for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
  return s;
}

async function sha256(bytes) {
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

function base64url(bytes) {
  let bin = "";
  const stueck = 0x8000;
  for (let i = 0; i < bytes.length; i += stueck) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + stueck));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Dateigröße lesbar: unter 1 MB in KB (sonst stünde beim Testhandbuch „0,0 MB“). */
function mb(bytes) {
  if (bytes < 1024 * 1024) return zahl(Math.max(1, Math.round(bytes / 1024)), 0) + " KB";
  return zahl(bytes / 1024 / 1024, 1) + " MB";
}

/** Seitenbereiche lesbar: [3,4,5,9] → „S. 3–5, 9“ */
function bereiche(nummern) {
  const n = nummern.slice().sort(function (a, b) { return a - b; });
  const teile = [];
  for (let i = 0; i < n.length; i++) {
    let j = i;
    while (j + 1 < n.length && n[j + 1] === n[j] + 1) j++;
    teile.push(j > i ? n[i] + "–" + n[j] : String(n[i]));
    i = j;
  }
  return teile.join(", ");
}

/**
 * Text einer Seite: Zeilenumbruch bei hasEOL oder Zeilenwechsel, Lücken
 * zwischen Tabellenzellen als Leerzeichen, Leerraum zusammengefasst, NFC,
 * Steuerzeichen außer \n entfernt (SPEC 13.3.10). Genau dieser Text wird
 * gesendet – die Prüfsumme läuft über ihn.
 */
async function seitenText(seite) {
  const inhalt = await seite.getTextContent();
  const box = Array.isArray(seite.view) && seite.view.length === 4 ? seite.view : null;
  let aus = "";
  let entfernt = 0;
  let letzteY = null;
  let letztesEnde = null;
  (inhalt.items || []).forEach(function (it) {
    if (!it || typeof it.str !== "string") return;
    const tr = it.transform || [1, 0, 0, 1, 0, 0];
    const x = tr[4];
    const y = tr[5];
    // Schrift unter 3 pt liest kein Mensch, und Text außerhalb der Seite sieht
    // keiner – beides käme sonst ungesehen in den Präfix (Befund sicherheit-01).
    const groesse = Math.min(Math.hypot(tr[0], tr[1]), Math.hypot(tr[2], tr[3]));
    const draussen = box && (x < box[0] - 2 || x > box[2] + 2 || y < box[1] - 2 || y > box[3] + 2);
    if (it.str.trim() && (groesse < MIN_SCHRIFT_PT || draussen)) {
      entfernt += it.str.replace(/\s+/g, "").length;
      return;
    }
    const hoehe = Math.abs(tr[3]) || it.height || 10;
    if (letzteY !== null && Math.abs(y - letzteY) > hoehe * 0.5) {
      if (aus && aus.charAt(aus.length - 1) !== "\n") aus += "\n";
    } else if (letztesEnde !== null && x - letztesEnde > hoehe * 0.2 && it.str && aus && !/\s$/.test(aus) && !/^\s/.test(it.str)) {
      aus += " ";
    }
    aus += it.str;
    if (it.hasEOL) aus += "\n";
    letzteY = y;
    letztesEnde = x + (it.width || 0);
  });
  return { text: bereinigen(aus), entfernt: entfernt };
}

/**
 * Zählt Buchstaben, die gezeichnet, aber nicht zu sehen sind: Render-Modus 3/7
 * (unsichtbar), Deckkraft 0 oder weiße Füllung. Entfernt wird davon nichts –
 * Modus 3 ist auch die Texterkennung gescannter Anleitungen, Weiß steht auch
 * in dunklen Tabellenköpfen. Ab 20 Buchstaben wird die Seite markiert und ihr
 * Text soll gelesen werden. (KEBA P30: Ziffern in dunklen Kreisen – bleiben
 * unter der Schwelle; gemessen über 334 Seiten Herstellerunterlagen: 0 Treffer.)
 */
async function unsichtbareBuchstaben(seite, OPS) {
  if (!OPS || typeof seite.getOperatorList !== "function") return 0;
  const ol = await seite.getOperatorList();
  const zeigen = [OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText];
  let st = { modus: 0, weiss: false, alpha: 1 };
  const stapel = [];
  let n = 0;
  for (let i = 0; i < ol.fnArray.length; i++) {
    const f = ol.fnArray[i];
    const a = ol.argsArray[i] || [];
    if (f === OPS.save) stapel.push({ modus: st.modus, weiss: st.weiss, alpha: st.alpha });
    else if (f === OPS.restore) st = stapel.pop() || { modus: 0, weiss: false, alpha: 1 };
    else if (f === OPS.setTextRenderingMode) st.modus = a[0];
    else if (f === OPS.setFillRGBColor) st.weiss = /^#f[c-f]f[c-f]f[c-f]$/i.test(String(a[0]));
    else if (f === OPS.setFillGray) st.weiss = Number(a[0]) >= 0.98;
    else if (f === OPS.setGState && Array.isArray(a[0])) {
      a[0].forEach(function (paar) {
        if (Array.isArray(paar) && paar[0] === "ca") st.alpha = Number(paar[1]);
      });
    } else if (zeigen.indexOf(f) !== -1 && (st.modus === 3 || st.modus === 7 || st.alpha === 0 || st.weiss)) {
      (Array.isArray(a[0]) ? a[0] : []).forEach(function (g) {
        if (g && typeof g === "object" && typeof g.unicode === "string" && /[A-Za-zÄÖÜäöüß]/.test(g.unicode)) n += 1;
      });
    }
  }
  return n;
}

function bereinigen(t) {
  return String(t)
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F­]/g, "")
    .split("\n")
    .map(function (z) { return z.replace(/[\s  -​  　]+/g, " ").trim(); })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function canvasZuBytes(canvas) {
  return new Promise(function (aufloesen, ablehnen) {
    if (typeof canvas.toBlob !== "function") {
      ablehnen(new Error("Dieser Browser kann keine Seitenbilder erzeugen."));
      return;
    }
    canvas.toBlob(function (blob) {
      if (!blob) {
        ablehnen(new Error("Seitenbild konnte nicht erzeugt werden."));
        return;
      }
      blob.arrayBuffer().then(function (b) { aufloesen(new Uint8Array(b)); }, ablehnen);
    }, "image/png");
  });
}

/** Seite als PNG: 110 dpi, über der Grenze 90, dann 72 (nie größer als 2400 px). */
async function seitenPng(seite, maxBytes) {
  const v1 = seite.getViewport({ scale: 1 });
  const laengste = Math.max(v1.width, v1.height);
  for (let i = 0; i < DPI_STUFEN.length; i++) {
    let skala = DPI_STUFEN[i] / 72;
    if (laengste * skala > MAX_PIXEL) skala = MAX_PIXEL / laengste;
    const v = seite.getViewport({ scale: skala });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(v.width);
    canvas.height = Math.floor(v.height);
    const g = canvas.getContext("2d", { alpha: false });
    g.fillStyle = "#FFFFFF";
    g.fillRect(0, 0, canvas.width, canvas.height);
    await seite.render({ canvas: canvas, viewport: v, background: "#FFFFFF" }).promise;
    const bytes = await canvasZuBytes(canvas);
    canvas.width = 0;
    canvas.height = 0;
    if (bytes.length <= maxBytes) return { bytes: bytes, dpi: DPI_STUFEN[i] };
  }
  throw new Error("Die Seite ist auch mit 72 dpi größer als " + zahl(maxBytes) + " Byte.");
}

// --- Bildschirm: in Vorbereitung -----------------------------------------------------------

function zeigeInVorbereitung(container, ctx) {
  const seite = h("div", { class: "ab-seite" });
  seite.appendChild(seitenKopf(ctx, {
    titel: "Handbuch hochladen",
    satz: "Bald verfügbar.",
  }));
  seite.appendChild(h("div", { class: "karte ab-karte leer" }, ikon("buch", { groesse: 28 }),
    h("p", { text: "Dieser Schritt wird gerade fertig gebaut. Bis dahin liegen die kuratierten Herstellerunterlagen bereit." })));
  container.appendChild(seite);
  return { titel: "Handbuch hochladen" };
}

// --- Bildschirm --------------------------------------------------------------------------

export function zeigeHandbuch(container, ctx, param) {
  if (!HANDBUCH_BEREIT) return zeigeInVorbereitung(container, ctx);
  const p = param || {};
  const r = rechteVon(ctx);

  const z = {
    schritt: 1,
    weg: false,
    datei: null,          // {name, groesse, sha256}
    pdf: null,            // PDFDocumentProxy
    pdfjs: null,
    seitenGesamt: 0,
    labels: null,
    versatz: 0,
    meta: { titel: "", hersteller: "", modell_serie: "", version: "", typ: "installationsanleitung", quelle_url: "" },
    seiten: new Map(),    // pdf_seite → {text, zeichen, kein_text, gekuerzt}
    vorschauen: new Map(),// pdf_seite → canvas
    auswahl: new Set(),
    letzteKlick: null,
    umfang: UMFANG_RUECKFALL,
    dok: null,            // Server-Dokument (Entwurf) nach anlegen/fortsetzen
    serverSeiten: new Map(), // pdf_seite → {seite, bild}
    codes: [],
    vorschlag: null,      // letzte Antwort von codes_vorschlagen
    uploadLaeuft: false,
    anhalten: false,
    aufgaben: [],
    laufend: 0,
    renderTasks: new Set(),
    beobachter: null,
  };

  const seite = h("div", { class: "ab-seite ab-seite-breit hb-seite" });
  const meter = h("div", { class: "hb-kopf-meter" });
  seite.appendChild(seitenKopf(ctx, {
    titel: "Handbuch hochladen",
    satz: "Das PDF bleibt bei dir, hochgeladen werden nur die gewählten Seiten.",
    zusatz: meter,
  }));
  container.appendChild(seite);

  if (!r.handbuch) {
    seite.appendChild(h("div", { class: "karte ab-karte leer" }, ikon("schild", { groesse: 28 }),
      h("p", { text: "Handbücher hochladen dürfen Meister und Admins." })));
    return { titel: "Handbuch hochladen" };
  }

  const vorhanden = h("section", { class: "hb-vorhanden", "aria-labelledby": "hb-vorhanden-titel" });
  const schrittLeiste = h("ol", { class: "hb-schritte", "aria-label": "Schritte" });
  const buehne = h("div", { class: "hb-buehne" });
  const dialogPlatz = h("div");
  seite.appendChild(vorhanden);
  seite.appendChild(h("nav", { class: "hb-schritte-nav", "aria-label": "Fortschritt beim Hochladen" }, schrittLeiste));
  seite.appendChild(buehne);
  seite.appendChild(dialogPlatz);

  // --- Umfang und Liste vorhandener Uploads -----------------------------------------------
  // Der Zähler steht erst im Schritt „Seiten“, wo er Folgen hat – im ersten
  // Blick sagte „Wissensbasis heute ≈ 57.590 Tokens von empfohlen 90.000“ einem
  // Meister nichts (Gegenprüfung 09.10.). Der Deckel greift unverändert.
  function meterNeu() {
    leeren(meter);
  }

  function listeLaden() {
    return ctx.api.handbuecher().then(function (antwort) {
      if (z.weg) return antwort;
      if (antwort.umfang) z.umfang = Object.assign({}, UMFANG_RUECKFALL, antwort.umfang, { grenzen: Object.assign({}, UMFANG_RUECKFALL.grenzen, antwort.umfang.grenzen || {}) });
      meterNeu();
      listeZeigen(Array.isArray(antwort.uploads) ? antwort.uploads : [], Array.isArray(antwort.kuratiert) ? antwort.kuratiert : []);
      return antwort;
    }, function (err) {
      if (z.weg) return null;
      meterNeu();
      leeren(vorhanden);
      vorhanden.appendChild(h("p", { class: "ab-hinweis ab-hinweis-fehler", role: "alert", text: fehlerText(err, "Die Liste der Handbücher ist nicht geladen.") + " Der Zähler rechnet mit den Standardwerten." }));
      return null;
    });
  }

  // Eine Zeile „Schon da: 3 Handbücher (24 Seiten)“ statt „3 kuratierte
  // Unterlagen … sind schon Quelle“ neben „Noch keine.“ – das las sich wie ein
  // Widerspruch (Gegenprüfung 09.10.). Die Überschrift kommt erst mit Uploads.
  function listeZeigen(uploads, kuratiert) {
    leeren(vorhanden);
    const seitenKuratiert = kuratiert.reduce(function (n, k) { return n + (k.seiten || 0); }, 0);
    if (kuratiert.length) {
      vorhanden.appendChild(h("p", { class: "ab-satz-klein hb-kuratiert", id: uploads.length ? null : "hb-vorhanden-titel",
        text: "Schon da: " + kuratiert.length + (kuratiert.length === 1 ? " Handbuch" : " Handbücher") + " (" + seitenKuratiert + (seitenKuratiert === 1 ? " Seite)" : " Seiten)") }));
    }
    if (!uploads.length) return;
    vorhanden.appendChild(h("div", { class: "ab-abschnitt-kopf" },
      h("h2", { class: "ab-h2", id: "hb-vorhanden-titel", text: "Hochgeladene Handbücher" })));
    const ul = h("ul", { class: "hb-liste" });
    uploads.forEach(function (u) {
      const aktiv = u.status === "aktiv";
      const codes = u.codes || {};
      const teile = [
        u.seiten + (u.seiten === 1 ? " Seite" : " Seiten"),
        (codes.bestaetigt || 0) + ((codes.bestaetigt || 0) === 1 ? " Code bestätigt" : " Codes bestätigt") + (codes.vorgeschlagen ? ", " + codes.vorgeschlagen + " offen" : ""),
        "≈ " + zahl(u.tokens || 0) + " Tokens",
      ];
      const weiter = !aktiv ? h("button", {
        type: "button", class: "knopf knopf-rand knopf-klein",
        onclick: function () { fortsetzen(u.dokument_id); },
      }, "Weiter", ikon("weiter", { groesse: 14 })) : null;
      const loeschen = h("button", {
        type: "button", class: "knopf knopf-leise knopf-klein hb-loeschen", "aria-label": u.dokument_id + " löschen",
        onclick: function () { loeschenFragen(u, loeschen); },
      }, ikon("muell", { groesse: 14 }), "Löschen");
      ul.appendChild(h("li", { class: "hb-listen-zeile" + (z.dok && z.dok.dokument_id === u.dokument_id ? " hb-listen-aktuell" : "") },
        h("span", { class: "pille " + (aktiv ? "pille-gut" : "pille-achtung") }, aktiv ? "aktiv" : "Entwurf"),
        h("div", { class: "hb-listen-text" },
          h("p", { class: "hb-listen-titel" }, h("span", { class: "mono", text: u.dokument_id }), " · ", u.titel || ""),
          h("p", { class: "hb-listen-meta", text: [u.hersteller, u.modell_serie].filter(Boolean).join(" · ") + " · " + teile.join(" · ") +
            (aktiv && u.aktiviert_am ? " · aktiv seit " + datum(u.aktiviert_am) : "") })),
        h("div", { class: "hb-listen-knoepfe" }, weiter, loeschen)));
    });
    vorhanden.appendChild(ul);
  }

  async function loeschenFragen(u, knopf) {
    const aktiv = u.status === "aktiv";
    const ja = await ctx.bestaetigen(
      u.dokument_id + " „" + (u.titel || "") + "“ löschen? Seiten, Seitenbilder und Fehlercodes werden entfernt." +
      (aktiv ? " Das Handbuch ist danach keine Quelle mehr; die nächste Frage legt den Zwischenspeicher neu an." : ""),
      { ja: "Löschen", nein: "Abbrechen", gefahr: true });
    if (!ja || z.weg) return;
    beschaeftigt(knopf, true, "…");
    try {
      await ctx.api.handbuch("loeschen", { dokument_id: u.dokument_id });
      ctx.toast(u.dokument_id + " gelöscht.", "gut");
      ctx.geaendert({ freigaben: true });
      if (z.dok && z.dok.dokument_id === u.dokument_id) {
        z.dok = null;
        z.serverSeiten = new Map();
        z.codes = [];
        z.vorschlag = null;
        schrittZeigen(z.pdf ? 3 : 1);
      }
      listeLaden();
    } catch (err) {
      beschaeftigt(knopf, false);
      ctx.toast(fehlerText(err, "Löschen hat nicht geklappt."), "fehler");
    }
  }

  // --- Schrittleiste ---------------------------------------------------------------------
  function erreichbar(nr) {
    if (z.uploadLaeuft) return nr === z.schritt;
    if (nr === 1) return true;
    if (nr === 2) return !!z.pdf || !!z.dok;
    if (nr === 3) return !!z.pdf;
    if (nr === 4) return !!z.pdf && z.auswahl.size > 0;
    if (nr === 5 || nr === 6) return !!z.dok && seitenVollstaendig();
    return false;
  }

  function erledigt(nr) {
    if (nr === 1) return !!z.pdf || !!z.dok;
    if (nr === 2) return !!z.dok || (!!z.pdf && !!z.meta.titel && z.schritt > 2);
    if (nr === 3) return z.auswahl.size > 0 && z.schritt > 3;
    if (nr === 4) return !!z.dok && seitenVollstaendig();
    if (nr === 5) return !!z.dok && z.schritt > 5;
    return false;
  }

  function seitenVollstaendig() {
    if (!z.serverSeiten.size) return false;
    let alle = true;
    z.serverSeiten.forEach(function (s) { if (!s.bild) alle = false; });
    return alle;
  }

  function leisteNeu() {
    leeren(schrittLeiste);
    SCHRITTE.forEach(function (titel, i) {
      const nr = i + 1;
      const kann = erreichbar(nr) && nr !== z.schritt;
      const fertig = erledigt(nr);
      const inhalt = [
        h("span", { class: "hb-schritt-nr" }, fertig && nr !== z.schritt ? ikon("haken", { groesse: 14 }) : String(nr)),
        h("span", { class: "hb-schritt-titel", text: titel }),
      ];
      const el = kann
        ? h("button", { type: "button", class: "hb-schritt", onclick: function () { schrittZeigen(nr); } }, inhalt)
        : h("span", { class: "hb-schritt" + (nr === z.schritt ? "" : " hb-schritt-zu") }, inhalt);
      if (nr === z.schritt) el.setAttribute("aria-current", "step");
      schrittLeiste.appendChild(h("li", { class: "hb-schritt-li" + (fertig ? " hb-schritt-fertig" : "") + (nr === z.schritt ? " hb-schritt-jetzt" : "") }, el));
    });
  }

  function schrittZeigen(nr, ohneFokus) {
    z.schritt = nr;
    if (z.beobachter) {
      z.beobachter.disconnect();
      z.beobachter = null;
    }
    leisteNeu();
    leeren(buehne);
    const karte = h("section", { class: "karte ab-karte hb-karte", "aria-labelledby": "hb-schritt-titel" });
    buehne.appendChild(karte);
    if (nr === 1) schritt1(karte);
    else if (nr === 2) schritt2(karte);
    else if (nr === 3) schritt3(karte);
    else if (nr === 4) schritt4(karte);
    else if (nr === 5) schritt5(karte);
    else schritt6(karte);
    einblenden(karte, 0, { y: 6 });
    if (!ohneFokus) {
      const t = karte.querySelector("#hb-schritt-titel");
      if (t) {
        t.setAttribute("tabindex", "-1");
        t.focus({ preventScroll: true });
      }
      naechsterFrame(function () {
        const oben = schrittLeiste.getBoundingClientRect().top;
        if (oben < 0 || oben > window.innerHeight * 0.6) {
          try { schrittLeiste.scrollIntoView({ behavior: ruhig() ? "auto" : "smooth", block: "start" }); } catch (e) { schrittLeiste.scrollIntoView(); }
        }
      });
    }
  }

  function kartenKopf(karte, nr, titel, satz) {
    // Kein „Schritt 1 von 6 · PDF wählen“ über der Überschrift – das zeigt die Leiste schon.
    karte.setAttribute("data-schritt", String(nr));
    karte.appendChild(h("h2", { class: "ab-h2 hb-titel", id: "hb-schritt-titel", text: titel }));
    if (satz) karte.appendChild(h("p", { class: "ab-satz-klein", text: satz }));
  }

  // --- Schritt 1: PDF wählen ------------------------------------------------------------
  function schritt1(karte) {
    kartenKopf(karte, 1, "PDF wählen", null);
    // Kein zweiter Satz „Das PDF verlässt den Browser nicht …“ – der steht
    // schon als Einleitung oben (SPEC 14.3.12: höchstens ein einleitender Satz).
    const datei = h("input", { type: "file", class: "sr-only", id: "hb-datei", accept: "application/pdf,.pdf" });
    const ablage = h("label", { class: "ei-ablage hb-ablage", for: "hb-datei" },
      h("span", { class: "ei-ablage-symbol" }, ikon("hochladen", { groesse: 22 })),
      h("span", { class: "ei-ablage-text" },
        h("span", { class: "ei-ablage-titel", text: z.dok && !z.pdf ? "Dasselbe PDF erneut wählen" : "PDF hierher ziehen oder klicken" }),
        h("span", { class: "ei-ablage-hilfe", text: "bis 60 MB" })));
    const status = h("div", { class: "hb-status", "aria-live": "polite" });
    if (z.dok && !z.pdf) {
      karte.appendChild(h("p", { class: "ab-hinweis" }, ikon("info", { groesse: 16 }),
        (seitenVollstaendig()
          ? "Um die Seiten von " + z.dok.dokument_id + " zu ändern, wähle dasselbe PDF („"
          : "Für " + z.dok.dokument_id + " fehlen noch Seiten oder Seitenbilder. Wähle dasselbe PDF („") +
        (z.dok.datei_name || z.dok.titel) + "“) – die Prüfsumme stellt sicher, dass es dasselbe ist."));
    }
    karte.appendChild(datei);
    karte.appendChild(ablage);
    karte.appendChild(status);

    if (z.pdf && z.datei) {
      status.appendChild(dateiZusammenfassung());
      status.appendChild(h("div", { class: "ab-knopfreihe" },
        h("button", { type: "button", class: "knopf knopf-primaer", onclick: function () { schrittZeigen(z.dok ? 3 : 2); } },
          z.dok ? "Weiter: Seiten" : "Weiter: Angaben", ikon("weiter", { groesse: 16 }))));
    }

    async function nehmen(f) {
      leeren(status);
      if (!f) return;
      if (z.dok && z.pdf) {
        status.appendChild(h("p", { class: "feld-fehler", text: "Für einen anderen PDF bitte erst den Entwurf " + z.dok.dokument_id + " löschen oder fertigstellen." }));
        return;
      }
      if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") {
        status.appendChild(h("p", { class: "feld-fehler", role: "alert", text: "Bitte eine PDF-Datei wählen." }));
        return;
      }
      if (f.size > MAX_PDF_BYTES) {
        status.appendChild(h("p", { class: "feld-fehler", role: "alert", text: "Die Datei ist " + mb(f.size) + " groß – höchstens 60 MB." }));
        return;
      }
      const arbeit = h("p", { class: "hb-arbeit" }, h("span", { class: "ab-kreisel", "aria-hidden": "true" }), "PDF wird geöffnet …");
      status.appendChild(arbeit);
      try {
        const puffer = await f.arrayBuffer();
        const sha = await sha256(puffer);
        if (z.dok && z.dok.datei_sha256 && z.dok.datei_sha256 !== sha) {
          leeren(status);
          status.appendChild(h("p", { class: "feld-fehler", role: "alert", text: "Das ist nicht dasselbe PDF wie bei " + z.dok.dokument_id + " (andere Prüfsumme)." }));
          return;
        }
        let pdfjs;
        try {
          pdfjs = await pdfjsLaden();
        } catch (e) {
          throw new Error("Der PDF-Leser ließ sich nicht laden. Bitte die Seite neu laden.");
        }
        let doc;
        try {
          doc = await pdfjs.getDocument(pdfOptionen(new Uint8Array(puffer))).promise;
        } catch (e) {
          if (e && e.name === "PasswordException") throw new Error("Das PDF ist passwortgeschützt. Bitte eine Fassung ohne Passwort wählen.");
          throw new Error("Die Datei ist kein lesbares PDF.");
        }
        if (z.weg) {
          pdfSchliessen(doc);
          return;
        }
        if (z.pdf) pdfSchliessen(z.pdf);
        z.pdfjs = pdfjs;
        z.pdf = doc;
        z.seitenGesamt = doc.numPages;
        z.datei = { name: f.name, groesse: f.size, sha256: sha };
        z.seiten = new Map();
        z.vorschauen = new Map();
        if (!z.dok) z.auswahl = new Set();
        z.letzteKlick = null;
        try {
          z.labels = await doc.getPageLabels();
        } catch (e) {
          z.labels = null;
        }
        if (!z.dok) {
          z.versatz = versatzAusLabels(z.labels);
          let info = null;
          try {
            info = await doc.getMetadata();
          } catch (e) {
            info = null;
          }
          const t = info && info.info && typeof info.info.Title === "string" ? info.info.Title.trim() : "";
          // Viele Hersteller-PDFs tragen als „Titel“ nur einen Dateinamen („0020291526_04.pdf“) – dann lieber den Dateinamen lesbar machen.
          const echterTitel = t.length >= 3 && /\s/.test(t) && !/\.pdf$/i.test(t);
          z.meta.titel = (echterTitel ? t : f.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim()).slice(0, 160);
        }
        leeren(status);
        status.appendChild(dateiZusammenfassung());
        status.appendChild(h("div", { class: "ab-knopfreihe" },
          h("button", { type: "button", class: "knopf knopf-primaer", onclick: function () { schrittZeigen(z.dok ? 3 : 2); } },
            z.dok ? "Weiter: Seiten" : "Weiter: Angaben", ikon("weiter", { groesse: 16 }))));
        leisteNeu();
        const k = status.querySelector(".knopf-primaer");
        if (k && mitMaus()) k.focus();
      } catch (e) {
        leeren(status);
        status.appendChild(h("p", { class: "feld-fehler", role: "alert", text: fehlerText(e, "Das PDF ließ sich nicht öffnen.") }));
      }
    }
    datei.addEventListener("change", function () {
      const f = datei.files && datei.files[0];
      datei.value = "";
      nehmen(f);
    });
    ablage.addEventListener("dragover", function (e) { e.preventDefault(); ablage.classList.add("ei-ablage-drueber"); });
    ablage.addEventListener("dragleave", function () { ablage.classList.remove("ei-ablage-drueber"); });
    ablage.addEventListener("drop", function (e) {
      e.preventDefault();
      ablage.classList.remove("ei-ablage-drueber");
      nehmen(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
    });
  }

  function dateiZusammenfassung() {
    return h("div", { class: "hb-datei" },
      h("span", { class: "hb-datei-symbol" }, ikon("datei", { groesse: 22 })),
      h("div", { class: "hb-datei-text" },
        h("p", { class: "hb-datei-name", text: z.datei.name }),
        h("p", { class: "hb-datei-meta" },
          z.seitenGesamt + " Seiten · " + mb(z.datei.groesse) + " · Prüfsumme ",
          h("span", { class: "mono", title: z.datei.sha256, text: z.datei.sha256.slice(0, 8) + "…" + z.datei.sha256.slice(-6) }))),
      h("span", { class: "pille pille-gut" }, ikon("haken", { groesse: 13 }), "bleibt im Browser"));
  }

  function versatzAusLabels(labels) {
    if (!Array.isArray(labels)) return 0;
    for (let i = 0; i < labels.length; i++) {
      if (/^\d+$/.test(String(labels[i] || "").trim())) {
        const n = parseInt(labels[i], 10);
        const v = (i + 1) - n;
        return v >= 0 ? v : 0;
      }
    }
    return 0;
  }

  function gedruckt(pdfSeite) {
    return pdfSeite - z.versatz;
  }

  // --- Schritt 2: Angaben -----------------------------------------------------------------
  function schritt2(karte) {
    kartenKopf(karte, 2, "Angaben zum Handbuch", "Sie stehen später an jeder Quelle aus diesem Handbuch.");
    if (z.dok) {
      karte.appendChild(h("dl", { class: "ab-eigenschaften" },
        h("dt", { text: "Titel" }), h("dd", { text: z.dok.titel || "" }),
        h("dt", { text: "Hersteller" }), h("dd", { text: z.dok.hersteller || "" }),
        h("dt", { text: "Modell / Serie" }), h("dd", { text: z.dok.modell_serie || "" }),
        h("dt", { text: "Fassung" }), h("dd", { text: z.dok.version || "–" }),
        h("dt", { text: "Typ" }), h("dd", { text: (TYPEN.filter(function (t) { return t.key === z.dok.typ; })[0] || { label: z.dok.typ || "" }).label }),
        h("dt", { text: "Original" }), h("dd", { text: z.dok.quelle_url || "–" })));
      karte.appendChild(h("p", { class: "feld-hilfe", text: "Die Angaben sind mit dem Entwurf " + z.dok.dokument_id + " gespeichert. Für andere Angaben den Entwurf löschen und neu anlegen." }));
      karte.appendChild(h("div", { class: "ab-knopfreihe" },
        h("button", { type: "button", class: "knopf knopf-primaer", onclick: function () { schrittZeigen(z.pdf ? 3 : 1); } }, "Weiter", ikon("weiter", { groesse: 16 }))));
      return;
    }
    const m = z.meta;
    function textFeld(key, max, auto) {
      const f = h("input", { class: "feld", type: "text", maxlength: String(max), autocomplete: auto || "off" });
      f.value = m[key] || "";
      f.addEventListener("input", function () { m[key] = f.value; });
      return f;
    }
    const fTitel = textFeld("titel", 160);
    const fHersteller = textFeld("hersteller", 80);
    const fSerie = textFeld("modell_serie", 120);
    const fVersion = textFeld("version", 120);
    const fTyp = h("select", { class: "feld" }, TYPEN.map(function (t) { return h("option", { value: t.key, text: t.label }); }));
    fTyp.value = m.typ;
    fTyp.addEventListener("change", function () { m.typ = fTyp.value; });
    const fUrl = h("input", { class: "feld", type: "url", maxlength: "500", autocomplete: "off", placeholder: "https://…", inputmode: "url" });
    fUrl.value = m.quelle_url || "";
    fUrl.addEventListener("input", function () { m.quelle_url = fUrl.value; });
    const fVersatz = h("input", { class: "feld hb-versatz", type: "number", min: "0", max: "500", step: "1", inputmode: "numeric" });
    fVersatz.value = String(z.versatz);
    const versatzBeispiel = h("span", { class: "hb-versatz-beispiel" });
    function versatzText() {
      const v = parseInt(fVersatz.value, 10);
      versatzBeispiel.textContent = isNaN(v) ? "" : "PDF-Seite " + (v + 1) + " = gedruckte Seite 1";
    }
    fVersatz.addEventListener("input", function () {
      const v = parseInt(fVersatz.value, 10);
      if (!isNaN(v) && v >= 0 && v <= 500) {
        z.versatz = v;
        // Auswahl ohne gültige gedruckte Seite fällt heraus.
        z.auswahl.forEach(function (s) { if (gedruckt(s) < 1) z.auswahl.delete(s); });
      }
      versatzText();
    });
    versatzText();

    const g = {
      titel: feldGruppe({ feld: fTitel, label: "Titel", pflicht: true, hilfe: "Vorbelegt aus dem PDF – gern kürzer, z. B. „Musterwerk MWP 8 – Kurzanleitung“." }),
      hersteller: feldGruppe({ feld: fHersteller, label: "Hersteller", pflicht: true }),
      serie: feldGruppe({ feld: fSerie, label: "Modell / Serie", pflicht: true, hilfe: "Fehlercodes gelten je Hersteller und Serie." }),
      version: feldGruppe({ feld: fVersion, label: "Fassung", hilfe: "z. B. Dokumentnummer und Datum vom Deckblatt" }),
      typ: feldGruppe({ feld: fTyp, label: "Art der Unterlage", pflicht: true }),
      url: feldGruppe({ feld: fUrl, label: "Link zum Original", hilfe: "Optional, nur https. Erscheint an jeder Quelle als „Original beim Hersteller“." }),
      versatz: feldGruppe({ feld: fVersatz, label: "Seitenversatz", hilfe: "Gedruckte Seite = PDF-Seite − Versatz." + (z.labels ? " Vorbelegt aus den Seitenzahlen im PDF." : ""), unter: versatzBeispiel }),
    };
    // Formulare höchstens 720 px breit (SPEC 13.3.3), auch wenn die Karte bis 1400 geht.
    karte.appendChild(h("div", { class: "hb-formular" },
      g.titel.wurzel,
      h("div", { class: "ab-zwei" }, g.hersteller.wurzel, g.serie.wurzel),
      h("div", { class: "ab-zwei" }, g.version.wurzel, g.typ.wurzel),
      g.url.wurzel,
      g.versatz.wurzel));
    const weiter = h("button", { type: "submit", class: "knopf knopf-primaer" }, "Weiter: Seiten auswählen", ikon("weiter", { groesse: 16 }));
    const form = h("form", { novalidate: true }, h("div", { class: "leiste-unten ab-leiste" },
      h("button", { type: "button", class: "knopf knopf-leise", onclick: function () { schrittZeigen(1); } }, ikon("zurueck", { groesse: 16 }), "Zurück"),
      weiter));
    karte.appendChild(form);
    function pruefen() {
      let erstes = null;
      Object.keys(g).forEach(function (k) { g[k].fehler(""); });
      function falsch(gr, text) {
        gr.fehler(text);
        if (!erstes) erstes = gr.feld;
      }
      const t = fTitel.value.trim();
      if (t.length < 3 || t.length > 160) falsch(g.titel, "Bitte einen Titel mit 3 bis 160 Zeichen.");
      if (!fHersteller.value.trim()) falsch(g.hersteller, "Bitte den Hersteller angeben.");
      if (!fSerie.value.trim()) falsch(g.serie, "Bitte Modell oder Serie angeben.");
      const u = fUrl.value.trim();
      if (u && !/^https:\/\/\S+$/.test(u)) falsch(g.url, "Der Link muss mit https:// beginnen.");
      const v = parseInt(fVersatz.value, 10);
      if (isNaN(v) || v < 0 || v > 500 || v >= z.seitenGesamt) falsch(g.versatz, "Bitte eine Zahl zwischen 0 und " + Math.min(500, z.seitenGesamt - 1) + ".");
      return erstes;
    }
    [fTitel, fHersteller, fSerie, fUrl, fVersatz].forEach(function (f) {
      f.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          weiter.click();
        }
      });
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const erstes = pruefen();
      if (erstes) {
        erstes.focus();
        return;
      }
      m.titel = fTitel.value.trim();
      m.hersteller = fHersteller.value.trim();
      m.modell_serie = fSerie.value.trim();
      m.version = fVersion.value.trim();
      m.quelle_url = fUrl.value.trim();
      m.typ = fTyp.value;
      schrittZeigen(3);
    });
    if (mitMaus()) fTitel.focus();
  }

  // --- Schritt 3: Seiten auswählen --------------------------------------------------------
  function einreihen(aufgabe, vorne) {
    if (vorne) z.aufgaben.unshift(aufgabe);
    else z.aufgaben.push(aufgabe);
    pumpe();
  }

  function pumpe() {
    while (z.laufend < 2 && z.aufgaben.length && !z.weg) {
      const a = z.aufgaben.shift();
      z.laufend += 1;
      Promise.resolve().then(a).then(null, function (e) {
        if (!(e && e.name === "RenderingCancelledException")) console.warn("Handbuch: Seite nicht verarbeitet:", e);
      }).then(function () {
        z.laufend -= 1;
        pumpe();
      });
    }
  }

  /**
   * Text einer Seite (einmal je PDF), optional mit Vorschaubild für eine Kachel.
   * fertig() läuft genau einmal – auch wenn die Seite nicht lesbar war (dann
   * gilt sie als „kein Text“), damit „Alle mit Text wählen“ nie hängen bleibt.
   */
  function seiteVorbereiten(nr, mitBild, fertig) {
    const eintrag = z.seiten.get(nr) || { beiFertig: [] };
    z.seiten.set(nr, eintrag);
    const textDa = eintrag.text !== undefined;
    const bildDa = !mitBild || z.vorschauen.has(nr);
    if (textDa && bildDa) {
      if (fertig) fertig();
      return;
    }
    if (fertig) eintrag.beiFertig.push(fertig);
    // Schon unterwegs? Dann nur anhängen (Bild nur, wenn der laufende Auftrag eins macht).
    if (eintrag.textWartet && !mitBild) return;
    if (mitBild && eintrag.bildWartet) return;
    if (mitBild) eintrag.bildWartet = true;
    eintrag.textWartet = true;
    const pdf = z.pdf;
    einreihen(async function () {
      if (z.weg || pdf !== z.pdf) return;
      let s = null;
      try {
        s = await pdf.getPage(nr);
        if (mitBild && !z.vorschauen.has(nr)) {
          const v1 = s.getViewport({ scale: 1 });
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const v = s.getViewport({ scale: (150 * dpr) / v1.width });
          const c = document.createElement("canvas");
          c.width = Math.floor(v.width);
          c.height = Math.floor(v.height);
          c.className = "hb-vorschau-bild";
          c.setAttribute("aria-hidden", "true");
          const aufgabe = s.render({ canvas: c, viewport: v, background: "#FFFFFF" });
          z.renderTasks.add(aufgabe);
          try {
            await aufgabe.promise;
            z.vorschauen.set(nr, c);
          } finally {
            z.renderTasks.delete(aufgabe);
          }
        }
        if (eintrag.text === undefined) {
          const gelesen = await seitenText(s);
          let t = gelesen.text;
          const max = z.umfang.grenzen.max_zeichen_seite || 12000;
          const gekuerzt = t.length > max;
          if (gekuerzt) t = t.slice(0, max);
          let unsichtbar = 0;
          try {
            unsichtbar = await unsichtbareBuchstaben(s, z.pdfjs && z.pdfjs.OPS);
          } catch (x) {
            unsichtbar = 0; // ohne Zählung – der Text bleibt vor dem Aktivieren zu lesen
          }
          eintrag.text = t;
          eintrag.zeichen = t.length;
          eintrag.kein_text = t.length < MIN_TEXT;
          eintrag.gekuerzt = gekuerzt;
          eintrag.entfernt = gelesen.entfernt;
          eintrag.unsichtbar = unsichtbar >= UNSICHTBAR_AB ? unsichtbar : 0;
        }
      } catch (e) {
        if (e && e.name === "RenderingCancelledException") throw e;
        console.warn("Handbuch: PDF-Seite " + nr + " nicht lesbar:", e);
        if (eintrag.text === undefined) {
          eintrag.text = "";
          eintrag.zeichen = 0;
          eintrag.kein_text = true;
          eintrag.gekuerzt = false;
          eintrag.entfernt = 0;
          eintrag.unsichtbar = 0;
        }
      } finally {
        if (s) {
          try { s.cleanup(); } catch (x) { /* egal */ }
        }
        eintrag.textWartet = false;
        if (mitBild) eintrag.bildWartet = false;
        const rufe = eintrag.beiFertig;
        eintrag.beiFertig = [];
        rufe.forEach(function (fn) { if (typeof fn === "function") fn(); });
      }
    }, !mitBild);
  }

  function schritt3(karte) {
    const grob = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    kartenKopf(karte, 3, "Seiten auswählen",
      "Wähle die Seiten, die beim Fragen helfen: Fehlercode-Tabellen, Störungsbehebung, Inbetriebnahme. " +
      (grob ? "Tippen wählt eine Seite." : "Klick wählt, Umschalt-Klick wählt Bereiche."));
    const u = z.umfang;
    const max = u.grenzen.max_seiten || 40;
    const werkzeuge = h("div", { class: "hb-werkzeuge" });
    const anzahl = h("span", { class: "hb-anzahl zahl", "aria-live": "polite" });
    const meldung = h("p", { class: "hb-meldung", role: "status" });
    const alleMitText = h("button", { type: "button", class: "knopf knopf-leise knopf-klein" }, "Alle mit Text wählen");
    const leer = h("button", { type: "button", class: "knopf knopf-leise knopf-klein" }, "Auswahl leeren");
    werkzeuge.appendChild(anzahl);
    werkzeuge.appendChild(alleMitText);
    werkzeuge.appendChild(leer);
    karte.appendChild(werkzeuge);
    karte.appendChild(meldung);

    const raster = h("ol", { class: "hb-raster", "aria-label": "Seiten des PDFs" });
    karte.appendChild(raster);
    const kacheln = new Map();

    // Klebende Leiste mit Zähler
    const zaehler = h("div", { class: "hb-zaehler" });
    const weiterText = h("span", { text: "Weiter: Hochladen" });
    const weiter = h("button", { type: "button", class: "knopf knopf-primaer" }, weiterText, ikon("weiter", { groesse: 16 }));
    const leiste = h("div", { class: "hb-leiste" }, zaehler, h("div", { class: "hb-leiste-knoepfe" },
      h("button", { type: "button", class: "knopf knopf-leise", onclick: function () { schrittZeigen(2); } }, ikon("zurueck", { groesse: 16 }), "Zurück"),
      weiter));
    karte.appendChild(leiste);
    weiter.addEventListener("click", function () { schrittZeigen(4); });

    function kachelBauen(nr) {
      const druck = gedruckt(nr);
      const vorschau = h("span", { class: "hb-vorschau" }, h("span", { class: "skelett hb-vorschau-skelett", "aria-hidden": "true" }));
      const haken = h("span", { class: "hb-haken", "aria-hidden": "true" }, ikon("haken", { groesse: 16, strich: 2.5 }));
      const info = h("span", { class: "hb-kachel-info" });
      const knopf = h("button", { type: "button", class: "hb-kachel-wahl", "aria-pressed": "false" }, vorschau, haken);
      const textKnopf = h("button", { type: "button", class: "hb-text-knopf", "aria-label": "Text von PDF-Seite " + nr + " ansehen", title: "Text ansehen" }, ikon("auge", { groesse: 15 }));
      const li = h("li", { class: "hb-kachel", "data-seite": String(nr) },
        knopf,
        h("div", { class: "hb-kachel-fuss" },
          h("span", { class: "hb-kachel-nummern" },
            h("span", { class: "hb-kachel-seite", text: druck >= 1 ? "S. " + druck : "–" }),
            h("span", { class: "hb-kachel-pdf", text: "PDF " + nr })),
          textKnopf),
        info);
      knopf.addEventListener("click", function (e) { klick(nr, e.shiftKey); });
      textKnopf.addEventListener("click", function () { textZeigen(nr, textKnopf); });
      kacheln.set(nr, { li: li, knopf: knopf, info: info, vorschau: vorschau, textKnopf: textKnopf });
      return li;
    }

    function kachelNeu(nr) {
      const k = kacheln.get(nr);
      if (!k) return;
      const s = z.seiten.get(nr);
      const gewaehlt = z.auswahl.has(nr);
      const druck = gedruckt(nr);
      const bekannt = s && s.text !== undefined;
      const nichtWaehlbar = bekannt && (s.kein_text || druck < 1);
      k.li.classList.toggle("hb-gewaehlt", gewaehlt);
      k.li.classList.toggle("hb-aus", !!nichtWaehlbar);
      k.li.classList.toggle("hb-oben", z.serverSeiten.has(nr) && !!z.serverSeiten.get(nr).bild);
      k.knopf.setAttribute("aria-pressed", gewaehlt ? "true" : "false");
      k.knopf.disabled = !!nichtWaehlbar && !gewaehlt;
      let label = "PDF-Seite " + nr + (druck >= 1 ? ", gedruckt Seite " + druck : "");
      leeren(k.info);
      if (!bekannt) {
        k.info.appendChild(h("span", { class: "hb-info-leise", text: "wird gelesen …" }));
      } else if (s.kein_text) {
        k.info.appendChild(h("span", { class: "hb-info-achtung", text: "kein Text (Scan?)" }));
        label += ", kein Text, nicht wählbar";
      } else if (druck < 1) {
        k.info.appendChild(h("span", { class: "hb-info-leise", text: "vor Seite 1" }));
        label += ", ohne gedruckte Seitenzahl, nicht wählbar";
      } else {
        k.info.appendChild(h("span", { class: "zahl", text: zahl(s.zeichen) + " Zeichen" + (s.gekuerzt ? " (gekürzt)" : "") }));
        label += ", " + zahl(s.zeichen) + " Zeichen";
      }
      if (bekannt && s.unsichtbar) {
        k.info.appendChild(h("span", { class: "hb-info-achtung hb-info-unsichtbar" }, ikon("auge", { groesse: 12 }), "unsichtbarer Text"));
        label += ", enthält unsichtbaren Text – bitte Text ansehen";
      }
      k.li.classList.toggle("hb-unsichtbar", !!(bekannt && s.unsichtbar));
      if (z.serverSeiten.has(nr)) {
        k.info.appendChild(h("span", { class: "hb-info-oben" }, ikon("haken", { groesse: 12 }), "oben"));
        label += ", schon hochgeladen";
      }
      k.knopf.setAttribute("aria-label", label);
      k.textKnopf.disabled = !bekannt;
      const c = z.vorschauen.get(nr);
      if (c && c.parentNode !== k.vorschau) {
        leeren(k.vorschau);
        k.vorschau.appendChild(c);
      }
    }

    function klick(nr, bereich) {
      const s = z.seiten.get(nr);
      const an = !z.auswahl.has(nr);
      meldung.textContent = "";
      let nummern = [nr];
      if (bereich && z.letzteKlick !== null && z.letzteKlick !== nr) {
        nummern = [];
        const von = Math.min(z.letzteKlick, nr);
        const bis = Math.max(z.letzteKlick, nr);
        for (let i = von; i <= bis; i++) nummern.push(i);
      }
      z.letzteKlick = nr;
      let zuViele = false;
      nummern.forEach(function (n) {
        if (!an) {
          z.auswahl.delete(n);
          kachelNeu(n);
          return;
        }
        if (gedruckt(n) < 1) return;
        const e = z.seiten.get(n);
        if (e && e.text !== undefined && e.kein_text) return;
        if (z.auswahl.has(n)) return;
        if (z.auswahl.size >= max) {
          zuViele = true;
          return;
        }
        z.auswahl.add(n);
        kachelNeu(n);
        const tile = kacheln.get(n);
        if (tile && !ruhig()) {
          const hk = tile.li.querySelector(".hb-haken");
          if (hk && typeof hk.animate === "function") {
            try { hk.animate([{ transform: "scale(.4)" }, { transform: "scale(1)" }], { duration: 160, easing: "cubic-bezier(.34,1.36,.64,1)" }); } catch (x) { /* ohne */ }
          }
        }
        // Text unbekannt (Bereich über ungelesene Seiten): nachlesen, ggf. wieder abwählen.
        if (!e || e.text === undefined) {
          seiteVorbereiten(n, false, function () {
            const f = z.seiten.get(n);
            if (f && f.kein_text && z.auswahl.has(n)) {
              z.auswahl.delete(n);
              meldung.textContent = "PDF-Seite " + n + " hat keinen Text (Scan?) und wurde nicht gewählt.";
            }
            kachelNeu(n);
            zaehlerNeu();
          });
        }
      });
      if (zuViele) meldung.textContent = "Höchstens " + max + " Seiten je Handbuch – weitere Seiten sind nicht wählbar.";
      if (s && an && s.kein_text) meldung.textContent = "Diese Seite hat keinen Text (Scan?) und ist nicht wählbar.";
      zaehlerNeu();
    }

    alleMitText.addEventListener("click", function () {
      beschaeftigt(alleMitText, true, "Liest alle Seiten …");
      let offen = z.seitenGesamt;
      for (let n = 1; n <= z.seitenGesamt; n++) {
        seiteVorbereiten(n, false, function () {
          offen -= 1;
          if (offen > 0) return;
          let zuViele = false;
          for (let i = 1; i <= z.seitenGesamt; i++) {
            const e = z.seiten.get(i);
            if (!e || e.kein_text || gedruckt(i) < 1 || z.auswahl.has(i)) continue;
            if (z.auswahl.size >= max) {
              zuViele = true;
              break;
            }
            z.auswahl.add(i);
          }
          kacheln.forEach(function (k, i) { kachelNeu(i); });
          meldung.textContent = zuViele ? "Mehr als " + max + " Seiten haben Text – gewählt sind die ersten " + max + "." : "";
          beschaeftigt(alleMitText, false);
          zaehlerNeu();
        });
      }
    });
    leer.addEventListener("click", function () {
      z.auswahl.clear();
      kacheln.forEach(function (k, i) { kachelNeu(i); });
      meldung.textContent = "";
      zaehlerNeu();
    });

    function zaehlerNeu() {
      const st = auswahlStand();
      anzahl.textContent = z.auswahl.size ? z.auswahl.size + " von höchstens " + max + " Seiten gewählt" + (z.auswahl.size ? " (S. " + bereiche(Array.from(z.auswahl).map(gedruckt)) + ")" : "") : "Noch keine Seite gewählt";
      leeren(zaehler);
      zaehler.appendChild(tokenMeter(u, u.wissensbasis_tokens + st.tokens, st.tokens, false, st.unbekannt));
      const zuGross = u.wissensbasis_tokens + st.tokens > u.max_tokens;
      weiter.disabled = !z.auswahl.size || zuGross || st.unbekannt > 0;
      weiterText.textContent = z.auswahl.size ? "Weiter: " + z.auswahl.size + (z.auswahl.size === 1 ? " Seite hochladen" : " Seiten hochladen") : "Weiter: Hochladen";
      leisteNeu();
    }

    for (let n = 1; n <= z.seitenGesamt; n++) raster.appendChild(kachelBauen(n));
    kacheln.forEach(function (k, n) { kachelNeu(n); });
    zaehlerNeu();

    // Vorschaubilder erst, wenn die Kachel in Sicht kommt.
    const sichtbar = function (eintraege) {
      eintraege.forEach(function (e) {
        if (!e.isIntersecting) return;
        const nr = parseInt(e.target.getAttribute("data-seite"), 10);
        z.beobachter.unobserve(e.target);
        seiteVorbereiten(nr, true, function () {
          kachelNeu(nr);
          zaehlerNeu();
        });
      });
    };
    if (typeof IntersectionObserver === "function") {
      z.beobachter = new IntersectionObserver(sichtbar, { rootMargin: "300px 0px" });
      kacheln.forEach(function (k) { z.beobachter.observe(k.li); });
    } else {
      for (let n = 1; n <= Math.min(z.seitenGesamt, 60); n++) {
        (function (nr) { seiteVorbereiten(nr, true, function () { kachelNeu(nr); zaehlerNeu(); }); })(n);
      }
    }
    // Gewählte Seiten (Fortsetzen) sofort lesen, damit der Zähler stimmt.
    z.auswahl.forEach(function (nr) { seiteVorbereiten(nr, false, function () { kachelNeu(nr); zaehlerNeu(); }); });
  }

  function auswahlStand() {
    let zeichen = 0;
    let unbekannt = 0;
    z.auswahl.forEach(function (nr) {
      const s = z.seiten.get(nr);
      if (!s || s.text === undefined) unbekannt += 1;
      else zeichen += s.zeichen;
    });
    const u = z.umfang;
    const tokens = Math.ceil((zeichen + (u.aufschlag_je_seite_zeichen || 120) * z.auswahl.size) / (u.zeichen_je_token || 1.8));
    return { zeichen: zeichen, tokens: z.auswahl.size ? tokens : 0, unbekannt: unbekannt };
  }

  function textZeigen(nr, ausloeser) {
    const s = z.seiten.get(nr);
    if (!s || s.text === undefined) return;
    leeren(dialogPlatz);
    const schliessen = h("button", { type: "button", class: "knopf knopf-rand", autofocus: true }, "Schließen");
    const dlg = h("dialog", { class: "hb-dialog", "aria-labelledby": "hb-dialog-titel" },
      h("div", { class: "hb-dialog-kopf" },
        h("h2", { class: "ab-h2", id: "hb-dialog-titel", text: "PDF-Seite " + nr + (gedruckt(nr) >= 1 ? " · gedruckt S. " + gedruckt(nr) : "") }),
        h("span", { class: "pille pille-neutral zahl", text: zahl(s.zeichen) + " Zeichen" })),
      h("p", { class: "feld-hilfe", text: "So, wie er aus dem PDF gelesen wurde und hochgeladen würde." + (s.gekuerzt ? " Auf 12.000 Zeichen gekürzt." : "") +
        (s.entfernt ? " " + zahl(s.entfernt) + " Zeichen in winziger Schrift oder außerhalb der Seite nicht übernommen." : "") }),
      s.unsichtbar ? h("p", { class: "ab-hinweis ab-hinweis-achtung" }, ikon("achtung", { groesse: 16 }),
        "Auf dieser Seite steht Text, den das Seitenbild nicht zeigt (unsichtbar oder weiß, " + zahl(s.unsichtbar) + " Buchstaben). Er würde trotzdem hochgeladen – bitte lesen oder die Seite abwählen.") : null,
      h("pre", { class: "hb-text", tabindex: "0", text: s.text || "(kein Text)" }),
      h("div", { class: "ab-knopfreihe" }, schliessen));
    dialogPlatz.appendChild(dlg);
    function zu() {
      if (typeof dlg.close === "function" && dlg.open) dlg.close();
      else dlg.removeAttribute("open");
      leeren(dialogPlatz);
      if (ausloeser) ausloeser.focus();
    }
    schliessen.addEventListener("click", zu);
    dlg.addEventListener("close", function () {
      leeren(dialogPlatz);
      if (ausloeser) ausloeser.focus();
    });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) zu(); });
    if (typeof dlg.showModal === "function") dlg.showModal();
    else {
      dlg.setAttribute("open", "");
      schliessen.focus();
    }
  }

  /** „S. 3, 7 enthalten unsichtbaren Text“ – oder null. */
  function unsichtbarHinweis(nummern) {
    const betroffen = nummern.filter(function (nr) { const s = z.seiten.get(nr); return s && s.unsichtbar; });
    if (!betroffen.length) return null;
    return h("p", { class: "ab-geht-raus-fuss ab-geht-raus-achtung" }, ikon("achtung", { groesse: 14 }),
      "S. " + bereiche(betroffen.map(gedruckt)) + (betroffen.length === 1 ? " enthält" : " enthalten") +
      " Text, den das Seitenbild nicht zeigt – vor dem Aktivieren wird er dir zum Lesen gezeigt.");
  }

  // --- Schritt 4: Hochladen ---------------------------------------------------------------
  function schritt4(karte) {
    kartenKopf(karte, 4, "Hochladen", null);
    const ausgewaehlt = Array.from(z.auswahl).sort(function (a, b) { return a - b; });
    const st = auswahlStand();
    const zuLaden = ausgewaehlt.filter(function (nr) { const s = z.serverSeiten.get(nr); return !s || !s.bild; });
    const zuEntfernen = [];
    z.serverSeiten.forEach(function (s, nr) { if (!z.auswahl.has(nr)) zuEntfernen.push(nr); });

    karte.appendChild(gehtRaus("Geht als Entwurf an den Server:", [
      h("p", { class: "geht-raus-text", text: typo(
        (z.dok ? z.dok.dokument_id + " · " : "") + (z.dok ? z.dok.titel : z.meta.titel) + "\n" +
        ausgewaehlt.length + (ausgewaehlt.length === 1 ? " Seite" : " Seiten") + " (S. " + bereiche(ausgewaehlt.map(gedruckt)) + ") als Text und Bild, ≈ " + zahl(st.tokens) + " Tokens" +
        (zuLaden.length !== ausgewaehlt.length ? "\nDavon schon oben: " + (ausgewaehlt.length - zuLaden.length) + ", neu: " + zuLaden.length : "") +
        (zuEntfernen.length ? "\nWird entfernt: S. " + bereiche(zuEntfernen.map(gedruckt)) : "")) }),
      h("p", { class: "ab-geht-raus-fuss" }, ikon("info", { groesse: 14 }), "Quelle wird das Handbuch erst nach der Prüfung der Fehlercodes und „Aktivieren“."),
      unsichtbarHinweis(ausgewaehlt),
    ]));

    const fortschritt = h("div", { class: "hb-fortschritt", hidden: true },
      h("div", { class: "hb-fortschritt-balken", "aria-hidden": "true" }, h("span", { class: "hb-fortschritt-fuellung" })),
      h("p", { class: "hb-fortschritt-text zahl", role: "status", "aria-live": "polite" }));
    const teileListe = h("ol", { class: "hb-teile" });
    const status = h("div", { class: "ab-status", role: "alert" });
    const start = h("button", { type: "button", class: "knopf knopf-primaer" }, ikon("hochladen", { groesse: 16 }), zuLaden.length || zuEntfernen.length ? "Hochladen starten" : "Seiten prüfen");
    const anhalten = h("button", { type: "button", class: "knopf knopf-rand", hidden: true }, "Anhalten");
    const zurueck = h("button", { type: "button", class: "knopf knopf-leise", onclick: function () { schrittZeigen(3); } }, ikon("zurueck", { groesse: 16 }), "Zurück");
    const leiste = h("div", { class: "leiste-unten ab-leiste" }, zurueck, anhalten, start);
    karte.appendChild(fortschritt);
    karte.appendChild(teileListe);
    karte.appendChild(status);
    karte.appendChild(leiste);

    if (!z.pdf && zuLaden.length) {
      status.textContent = "Für das Hochladen fehlt das PDF. Bitte in Schritt 1 dasselbe PDF erneut wählen.";
      start.disabled = true;
      return;
    }

    function fortschrittSetzen(anteil, text) {
      fortschritt.hidden = false;
      fortschritt.querySelector(".hb-fortschritt-fuellung").style.setProperty("transform", "scaleX(" + Math.max(0, Math.min(1, anteil)) + ")");
      fortschritt.querySelector(".hb-fortschritt-text").textContent = text;
    }

    anhalten.addEventListener("click", function () {
      z.anhalten = true;
      anhalten.disabled = true;
      anhalten.textContent = "Hält nach diesem Teil an …";
    });

    start.addEventListener("click", function () { hochladen(); });

    async function hochladen() {
      status.textContent = "";
      z.anhalten = false;
      z.uploadLaeuft = true;
      leisteNeu();
      beschaeftigt(start, true, "Läuft …");
      zurueck.disabled = true;
      anhalten.hidden = false;
      anhalten.disabled = false;
      anhalten.textContent = "Anhalten";
      try {
        // 1. Entwurf anlegen (erst jetzt)
        if (!z.dok) {
          fortschrittSetzen(0, "Entwurf wird angelegt …");
          let antwort;
          try {
            antwort = await ctx.api.handbuch("anlegen", {
              metadaten: {
                titel: z.meta.titel, hersteller: z.meta.hersteller, modell_serie: z.meta.modell_serie,
                version: z.meta.version || null, typ: z.meta.typ, quelle_url: z.meta.quelle_url || null,
                datei_name: String(z.datei.name).slice(0, 200), datei_sha256: z.datei.sha256, seiten_gesamt: z.seitenGesamt,
              },
            });
          } catch (err) {
            if (err && err.code === "doppelt" && err.inhalt && err.inhalt.dokument_id) {
              const id = err.inhalt.dokument_id;
              leeren(status);
              status.appendChild(h("p", { text: "Dieses PDF ist schon als " + id + " da." }));
              status.appendChild(h("button", {
                type: "button", class: "knopf knopf-rand knopf-klein",
                onclick: function () { fortsetzen(id, true); },
              }, "Dort weitermachen", ikon("weiter", { groesse: 14 })));
              return;
            }
            throw err;
          }
          if (antwort.umfang) z.umfang = Object.assign({}, z.umfang, antwort.umfang);
          z.dok = { dokument_id: antwort.dokument_id, status: antwort.status || "entwurf", titel: z.meta.titel, hersteller: z.meta.hersteller,
            modell_serie: z.meta.modell_serie, version: z.meta.version || null, typ: z.meta.typ, quelle_url: z.meta.quelle_url || null,
            datei_name: z.datei.name, datei_sha256: z.datei.sha256, seiten_gesamt: z.seitenGesamt };
          ctx.geaendert({ freigaben: true });
          listeLaden();
        }
        // 2. Stand des Servers holen (Fortsetzen: Seiten mit Bild überspringen)
        await serverStandHolen();
        if (z.weg) return;
        const entfernen = [];
        z.serverSeiten.forEach(function (s, nr) { if (!z.auswahl.has(nr)) entfernen.push(nr); });
        if (entfernen.length) {
          fortschrittSetzen(0, "Abgewählte Seiten werden entfernt …");
          await ctx.api.handbuch("seiten_entfernen", { dokument_id: z.dok.dokument_id, pdf_seiten: entfernen });
          entfernen.forEach(function (nr) { z.serverSeiten.delete(nr); });
        }
        const offen = Array.from(z.auswahl).sort(function (a, b) { return a - b; })
          .filter(function (nr) { const s = z.serverSeiten.get(nr); return !s || !s.bild; });
        // 3. Seiten vorbereiten (Text + PNG + Prüfsummen), in Teile packen
        const teile = [];
        let teil = { seiten: [], zeichen: 60, nummern: [] };
        for (let i = 0; i < offen.length; i++) {
          if (z.weg) return;
          fortschrittSetzen(i / Math.max(offen.length, 1) * 0.5, "Seite " + (i + 1) + " von " + offen.length + " wird vorbereitet …");
          const eintrag = await seiteFuerUpload(offen[i]);
          const laenge = JSON.stringify(eintrag).length + 1;
          if (teil.seiten.length && teil.zeichen + laenge > MAX_TEIL_ZEICHEN) {
            teile.push(teil);
            teil = { seiten: [], zeichen: 60, nummern: [] };
          }
          teil.seiten.push(eintrag);
          teil.nummern.push(offen[i]);
          teil.zeichen += laenge;
        }
        if (teil.seiten.length) teile.push(teil);
        // 4. Teile nacheinander senden
        leeren(teileListe);
        const schonOben = Array.from(z.auswahl).filter(function (nr) { return offen.indexOf(nr) === -1; });
        if (schonOben.length) {
          // Fortsetzen ehrlich zeigen: Diese Seiten gehen nicht noch einmal über die Leitung.
          teileListe.appendChild(h("li", { class: "hb-teil hb-teil-fertig" },
            h("span", { class: "hb-teil-zustand", "aria-hidden": "true" }, ikon("haken", { groesse: 14 })),
            h("span", { class: "hb-teil-text", text: "S. " + bereiche(schonOben.map(gedruckt)) + " – schon oben, übersprungen" }),
            h("span", { class: "hb-teil-status", text: "fertig" })));
        }
        teile.forEach(function (t, i) {
          t.zeile = h("li", { class: "hb-teil" },
            h("span", { class: "hb-teil-zustand", "aria-hidden": "true" }, ikon("uhr", { groesse: 14 })),
            // Größe der Anfrage (Text + Seitenbilder als Base64) – nicht „Zeichen“,
            // das las sich wie 1,6 Mio. Zeichen Text (Befund design-14).
            h("span", { class: "hb-teil-text", text: "Teil " + (i + 1) + " von " + teile.length + " · S. " + bereiche(t.nummern.map(gedruckt)) + " · " + mb(t.zeichen) }),
            h("span", { class: "hb-teil-status", text: "wartet" }));
          teileListe.appendChild(t.zeile);
        });
        const gesamtSeiten = offen.length;
        let erledigtSeiten = 0;
        for (let i = 0; i < teile.length; i++) {
          if (z.weg) return;
          if (z.anhalten) {
            fortschrittSetzen(0.5 + erledigtSeiten / Math.max(gesamtSeiten, 1) * 0.5, "Angehalten nach " + erledigtSeiten + " von " + gesamtSeiten + " Seiten. Der Entwurf bleibt – „Hochladen starten“ macht weiter.");
            return;
          }
          const t = teile[i];
          const imTeil = t.seiten.length; // teilSenden gibt die Seiten danach frei
          fortschrittSetzen(0.5 + erledigtSeiten / Math.max(gesamtSeiten, 1) * 0.5,
            "Seite " + (erledigtSeiten + imTeil) + " von " + gesamtSeiten + " · Teil " + (i + 1) + " von " + teile.length);
          const ok = await teilSenden(t, i, teile.length);
          if (!ok) return; // Fehler steht am Teil, „Erneut versuchen“ ist da
          erledigtSeiten += imTeil;
        }
        // 5. Prüfen, ob alles oben ist
        fortschrittSetzen(1, "Wird geprüft …");
        await serverStandHolen();
        const fehlt = Array.from(z.auswahl).filter(function (nr) { const s = z.serverSeiten.get(nr); return !s || !s.bild; });
        if (fehlt.length) {
          fortschrittSetzen(1, "Bei " + fehlt.length + " Seiten fehlt das Bild noch.");
          status.textContent = "Seiten ohne Bild: S. " + bereiche(fehlt.map(gedruckt)) + ". Bitte „Hochladen starten“ erneut drücken.";
          return;
        }
        fortschrittSetzen(1, "Alle " + z.serverSeiten.size + " Seiten sind oben – mit Text und Bild.");
        leeren(leiste);
        leiste.appendChild(h("button", { type: "button", class: "knopf knopf-primaer", onclick: function () { schrittZeigen(5); } }, "Weiter: Fehlercodes", ikon("weiter", { groesse: 16 })));
        const k = leiste.querySelector(".knopf-primaer");
        if (k) k.focus();
        listeLaden();
      } catch (err) {
        if (z.weg) return;
        status.textContent = fehlerText(err, "Hochladen hat nicht geklappt.");
      } finally {
        z.uploadLaeuft = false;
        if (!z.weg) {
          beschaeftigt(start, false);
          zurueck.disabled = false;
          anhalten.hidden = true;
          leisteNeu();
        }
      }
    }

    /** Einen Teil senden; bei Prüfsummen-Fehler die Seite einmal frisch erzeugen. Netzfehler → Knopf am Teil. */
    async function teilSenden(t, i, n) {
      const zustand = t.zeile.querySelector(".hb-teil-status");
      const symbol = t.zeile.querySelector(".hb-teil-zustand");
      t.zeile.className = "hb-teil hb-teil-laeuft";
      zustand.textContent = "läuft …";
      leeren(symbol);
      symbol.appendChild(h("span", { class: "ab-kreisel" }));
      for (let versuch = 0; versuch < 2; versuch++) {
        try {
          const antwort = await ctx.api.handbuch("seiten", { dokument_id: z.dok.dokument_id, seiten: t.seiten });
          (antwort.gespeichert || []).forEach(function (g) { z.serverSeiten.set(g.pdf_seite, { seite: g.seite, bild: true }); });
          t.zeile.className = "hb-teil hb-teil-fertig";
          zustand.textContent = "fertig";
          leeren(symbol);
          symbol.appendChild(ikon("haken", { groesse: 14 }));
          t.seiten = []; // Speicher frei – die Bilder sind oben
          return true;
        } catch (err) {
          if (err && err.code === "pruefsumme" && versuch === 0 && err.inhalt && err.inhalt.pdf_seite) {
            const nr = err.inhalt.pdf_seite;
            const idx = t.nummern.indexOf(nr);
            if (idx !== -1) {
              t.seiten[idx] = await seiteFuerUpload(nr);
              continue;
            }
          }
          t.zeile.className = "hb-teil hb-teil-fehler";
          zustand.textContent = fehlerText(err, "Fehler");
          leeren(symbol);
          symbol.appendChild(ikon("achtung", { groesse: 14 }));
          const nochmal = h("button", {
            type: "button", class: "knopf knopf-rand knopf-klein",
          }, "Erneut versuchen");
          nochmal.addEventListener("click", function () {
            nochmal.remove();
            // Ganz neu starten: der Server-Stand sagt, was schon oben ist (idempotent).
            hochladen();
          });
          t.zeile.appendChild(nochmal);
          status.textContent = "Teil " + (i + 1) + " von " + n + " ist nicht angekommen. Was schon oben ist, bleibt oben.";
          return false;
        }
      }
      return false;
    }
  }

  async function serverStandHolen() {
    const antwort = await ctx.api.handbuecher(z.dok.dokument_id);
    z.serverSeiten = new Map();
    (antwort.seiten || []).forEach(function (s) { z.serverSeiten.set(s.pdf_seite, { seite: s.seite, bild: !!s.bild, zeichen: s.zeichen }); });
    if (antwort.dokument) z.dok = Object.assign({}, z.dok, antwort.dokument);
    z.codes = Array.isArray(antwort.codes) ? antwort.codes : z.codes;
    if (antwort.umfang) z.umfang = Object.assign({}, z.umfang, antwort.umfang);
    return antwort;
  }

  /** Text + PNG einer Seite mit Prüfsummen, fertig für den Upload. */
  async function seiteFuerUpload(nr) {
    let e = z.seiten.get(nr);
    if (!e || e.text === undefined) {
      await new Promise(function (r) { seiteVorbereiten(nr, false, r); });
      e = z.seiten.get(nr);
    }
    const s = await z.pdf.getPage(nr);
    try {
      let png;
      try {
        png = await seitenPng(s, z.umfang.grenzen.max_png_bytes || 450000);
      } catch (e) {
        // Welche Seite, steht dabei – sonst sucht der Meister in 40 Seiten.
        throw new Error("PDF-Seite " + nr + " (S. " + gedruckt(nr) + "): " + fehlerText(e, "Seitenbild nicht erzeugt.") + " Bitte diese Seite abwählen.");
      }
      const text = e.text;
      return {
        pdf_seite: nr,
        seite: gedruckt(nr),
        abschnitt: null,
        text: text,
        text_sha256: await sha256(new TextEncoder().encode(text)),
        png: base64url(png.bytes),
        png_sha256: await sha256(png.bytes),
      };
    } finally {
      try { s.cleanup(); } catch (x) { /* egal */ }
    }
  }

  // --- Schritt 5: Fehlercodes -------------------------------------------------------------
  function schritt5(karte) {
    kartenKopf(karte, 5, "Fehlercodes prüfen",
      "Die KI liest nur den Text der hochgeladenen Seiten und schlägt Codes vor – wörtlich, mit Seite. Der Server prüft jedes Zitat gegen die Seite, du entscheidest Zeile für Zeile.");
    const platz = h("div", { class: "hb-codes" });
    const status = h("div", { class: "ab-status", role: "alert" });
    karte.appendChild(platz);
    karte.appendChild(status);
    const weiter = h("button", { type: "button", class: "knopf knopf-primaer", onclick: function () { schrittZeigen(6); } }, "Weiter: Aktivieren", ikon("weiter", { groesse: 16 }));
    const leiste = h("div", { class: "leiste-unten ab-leiste" },
      h("button", { type: "button", class: "knopf knopf-leise", onclick: function () { schrittZeigen(z.pdf ? 3 : 1); } }, ikon("zurueck", { groesse: 16 }), "Seiten ändern"),
      weiter);
    karte.appendChild(leiste);

    let zeichen = 0;
    z.serverSeiten.forEach(function (s) { zeichen += s.zeichen || 0; });

    function offenZahl() {
      return z.codes.filter(function (c) { return c.status === "vorgeschlagen"; }).length;
    }
    function weiterNeu() {
      const n = offenZahl();
      weiter.disabled = n > 0;
      weiter.title = n > 0 ? "Noch " + n + " Fehlercodes ungeprüft" : "";
    }

    function vorschlagKnopf(erneut) {
      const knopf = h("button", { type: "button", class: erneut ? "knopf knopf-leise knopf-klein" : "knopf knopf-primaer" },
        ikon("assistent", { groesse: 16 }), erneut ? "Erneut vorschlagen lassen" : "Fehlercodes vorschlagen");
      knopf.addEventListener("click", async function () {
        if (erneut) {
          const ja = await ctx.bestaetigen("Ein neuer Lauf ersetzt alle offenen und verworfenen Vorschläge. Bestätigte Codes bleiben. Noch ein KI-Aufruf?", { ja: "Erneut vorschlagen", nein: "Abbrechen" });
          if (!ja) return;
        }
        status.textContent = "";
        beschaeftigt(knopf, true, "Die KI liest die Seiten …");
        try {
          const antwort = await ctx.api.handbuch("codes_vorschlagen", { dokument_id: z.dok.dokument_id });
          if (z.weg) return;
          z.vorschlag = antwort;
          await serverStandHolen();
          if (z.weg) return;
          ctx.geaendert({ freigaben: true });
          zeigen();
        } catch (err) {
          if (z.weg) return;
          beschaeftigt(knopf, false);
          status.textContent = fehlerText(err, "Der Vorschlag hat nicht geklappt.");
        }
      });
      return knopf;
    }

    function zeigen() {
      leeren(platz);
      const schonGelaufen = !!z.vorschlag || z.codes.length > 0 || !!(z.dok && z.dok.codes_vorgeschlagen_am);
      if (!schonGelaufen) {
        platz.appendChild(h("div", { class: "hb-vorschlag-start" },
          vorschlagKnopf(false),
          h("p", { class: "ab-satz-klein" }, "Ein KI-Aufruf über den Text der ausgewählten Seiten (≈ " + zahl(zeichen) + " Zeichen, etwa 0,02–0,30 USD). Nichts davon ist Quelle, bevor du es bestätigst."),
          h("button", { type: "button", class: "knopf knopf-leise knopf-klein", onclick: function () { schrittZeigen(6); } }, "Ohne Fehlercodes weiter")));
        weiterNeu();
        return;
      }
      const v = z.vorschlag;
      if (v) {
        const teile = [
          (v.codes || []).length + ((v.codes || []).length === 1 ? " Vorschlag" : " Vorschläge"),
          (v.verworfen_automatisch || []).length ? (v.verworfen_automatisch || []).length + " vom Prüfer aussortiert" : null,
          typeof v.kosten_usd === "number" ? zahl(v.kosten_usd, 3) + " USD" : null,
          typeof v.latenz_ms === "number" ? zahl(v.latenz_ms / 1000, 1) + " s" : null,
        ].filter(Boolean);
        platz.appendChild(h("p", { class: "hb-vorschlag-zeile" }, ikon("assistent", { groesse: 16 }), teile.join(" · ")));
      }
      const hb = Object.assign({}, z.dok, { codes: z.codes, seiten: z.serverSeiten.size });
      platz.appendChild(codePruefliste(ctx, hb, {
        ohneKopf: true,
        mitAktivieren: false,
        beiAenderung: function () {
          // Die Liste hält ihre Zeilen selbst; hier nur den Weiter-Knopf nachziehen.
          serverStandHolen().then(function () { if (!z.weg) weiterNeu(); }, function () {});
        },
      }));
      if (v && (v.verworfen_automatisch || []).length) {
        platz.appendChild(h("details", { class: "hb-aussortiert" },
          h("summary", null, "Vom Prüfer aussortiert (" + v.verworfen_automatisch.length + ")"),
          h("ul", null, v.verworfen_automatisch.map(function (x) {
            return h("li", null, h("span", { class: "mono", text: x.code || "?" }), " · PDF-Seite " + x.pdf_seite + ": " + (x.text || x.grund || ""));
          }))));
      }
      if (v && (v.bereits_vorhanden || []).length) {
        platz.appendChild(h("p", { class: "ab-hinweis" }, ikon("info", { groesse: 16 }),
          "Schon vorhanden und deshalb nicht noch einmal vorgeschlagen: " + v.bereits_vorhanden.map(function (x) {
            return x.code + " (" + x.dokument_id + (x.seite ? ", S. " + x.seite : "") + ")";
          }).join(", ") + "."));
      }
      platz.appendChild(h("div", { class: "hb-erneut" }, vorschlagKnopf(true)));
      weiterNeu();
    }
    zeigen();
  }

  // --- Schritt 6: Aktivieren --------------------------------------------------------------
  function schritt6(karte) {
    kartenKopf(karte, 6, "Aktivieren", "Ab der nächsten Frage ist das Handbuch Quelle – mit Seitenbild und Link zum Original an jeder Aussage.");
    const bestaetigt = z.codes.filter(function (c) { return c.status === "bestaetigt"; }).length;
    const verworfen = z.codes.filter(function (c) { return c.status === "verworfen"; }).length;
    const offen = z.codes.filter(function (c) { return c.status === "vorgeschlagen"; }).length;
    let zeichen = 0;
    z.serverSeiten.forEach(function (s) { zeichen += s.zeichen || 0; });
    const u = z.umfang;
    const tokens = Math.ceil((zeichen + (u.aufschlag_je_seite_zeichen || 120) * z.serverSeiten.size) / (u.zeichen_je_token || 1.8));
    const seitenNr = [];
    z.serverSeiten.forEach(function (s) { seitenNr.push(s.seite); });
    karte.appendChild(h("dl", { class: "ab-eigenschaften" },
      h("dt", { text: "Handbuch" }), h("dd", null, h("span", { class: "mono", text: z.dok.dokument_id }), " · ", z.dok.titel || ""),
      h("dt", { text: "Gerät" }), h("dd", { text: [z.dok.hersteller, z.dok.modell_serie].filter(Boolean).join(" · ") }),
      h("dt", { text: "Seiten" }), h("dd", { text: z.serverSeiten.size + " (S. " + bereiche(seitenNr) + "), alle mit Bild" }),
      h("dt", { text: "Fehlercodes" }), h("dd", { text: bestaetigt + " bestätigt" + (verworfen ? ", " + verworfen + " verworfen" : "") + (offen ? ", " + offen + " offen" : "") }),
      h("dt", { text: "Umfang" }), h("dd", { text: "≈ " + zahl(tokens) + " Tokens" })));
    karte.appendChild(tokenMeter(u, u.wissensbasis_tokens + tokens, tokens, false, 0, "Dieses Handbuch"));
    karte.appendChild(h("p", { class: "ab-hinweis" }, ikon("info", { groesse: 16 }),
      "Jede Änderung am Wissen legt den Zwischenspeicher der KI einmal neu an – die erste Frage danach kostet etwa 0,47 USD extra. Danach ist alles wie vorher."));
    const platz = h("div", { "aria-live": "polite" });
    const status = h("div", { class: "ab-status", role: "alert" });
    const aktivieren = h("button", { type: "button", class: "knopf knopf-primaer", disabled: true }, ikon("haken", { groesse: 16 }), "Handbuch aktivieren");
    const leiste = h("div", { class: "leiste-unten ab-leiste" },
      h("button", { type: "button", class: "knopf knopf-leise", onclick: function () { schrittZeigen(5); } }, ikon("zurueck", { groesse: 16 }), "Fehlercodes"),
      aktivieren);
    // Erst lesen, dann aktivieren: der GESPEICHERTE Seitentext, auch was das
    // Seitenbild nicht zeigt (Befund sicherheit-01).
    const lesen = textPruefung(ctx, z.dok.dokument_id, { beiAenderung: function (ok) { aktivieren.disabled = !ok || offen > 0; } });
    karte.appendChild(lesen.element);
    karte.appendChild(platz);
    karte.appendChild(status);
    karte.appendChild(leiste);
    if (offen) {
      status.textContent = "Noch " + offen + (offen === 1 ? " Fehlercode" : " Fehlercodes") + " ungeprüft – bitte erst in Schritt 5 entscheiden.";
      aktivieren.disabled = true;
    }
    aktivieren.addEventListener("click", async function () {
      if (!lesen.geprueft() || offen) return;
      status.textContent = "";
      beschaeftigt(aktivieren, true, "Wird aktiviert …");
      try {
        const antwort = await ctx.api.handbuch("aktivieren", { dokument_id: z.dok.dokument_id });
        if (z.weg) return;
        z.dok = Object.assign({}, z.dok, { status: "aktiv", aktiviert_am: antwort.aktiviert_am });
        if (antwort.umfang) z.umfang = Object.assign({}, z.umfang, antwort.umfang);
        ctx.geaendert({ freigaben: true });
        leeren(leiste);
        leiste.appendChild(h("button", {
          type: "button", class: "knopf knopf-rand",
          onclick: function () { neuAnfangen(); },
        }, ikon("plus", { groesse: 16 }), "Weiteres Handbuch hochladen"));
        platz.appendChild(aktiviertBox(ctx, antwort));
        meterNeu();
        listeLaden();
        const t = platz.querySelector(".fg-aktiv-titel");
        if (t) {
          t.setAttribute("tabindex", "-1");
          t.focus({ preventScroll: true });
        }
        inSicht(platz);
      } catch (err) {
        if (z.weg) return;
        beschaeftigt(aktivieren, false);
        status.textContent = fehlerText(err, "Aktivieren hat nicht geklappt.");
        if (err && err.code === "pruefung_offen") {
          status.appendChild(h("button", { type: "button", class: "knopf knopf-rand knopf-klein", onclick: function () { schrittZeigen(5); } }, "Zu den Fehlercodes"));
        }
      }
    });
  }

  // --- Fortsetzen, neu anfangen ---------------------------------------------------------------
  async function fortsetzen(id, pdfBehalten) {
    try {
      const antwort = await ctx.api.handbuecher(id);
      if (z.weg) return;
      const d = antwort.dokument || {};
      if (d.status === "aktiv") {
        ctx.toast(id + " ist schon aktiv.", "hinweis");
        return;
      }
      z.dok = Object.assign({ dokument_id: id }, d);
      z.serverSeiten = new Map();
      (antwort.seiten || []).forEach(function (s) { z.serverSeiten.set(s.pdf_seite, { seite: s.seite, bild: !!s.bild, zeichen: s.zeichen }); });
      z.codes = Array.isArray(antwort.codes) ? antwort.codes : [];
      z.vorschlag = null;
      if (antwort.umfang) z.umfang = Object.assign({}, z.umfang, antwort.umfang);
      const gleichesPdf = pdfBehalten && z.pdf && z.datei && z.datei.sha256 === d.datei_sha256;
      // Dasselbe PDF schon offen (409 „doppelt“): die eben getroffene Auswahl bleibt und kommt dazu.
      const vorher = gleichesPdf ? Array.from(z.auswahl) : [];
      z.auswahl = new Set(Array.from(z.serverSeiten.keys()).concat(vorher));
      const erste = antwort.seiten && antwort.seiten[0];
      if (erste) z.versatz = erste.pdf_seite - erste.seite;
      if (!gleichesPdf && z.pdf) {
        pdfSchliessen(z.pdf);
        z.pdf = null;
        z.datei = null;
      }
      listeLaden();
      const nochOffen = Array.from(z.auswahl).some(function (nr) { const s = z.serverSeiten.get(nr); return !s || !s.bild; });
      if (seitenVollstaendig() && !nochOffen) schrittZeigen(5);
      else schrittZeigen(z.pdf ? (gleichesPdf ? 4 : 3) : 1);
    } catch (err) {
      if (z.weg) return;
      ctx.toast(fehlerText(err, "Der Entwurf ließ sich nicht laden."), "fehler");
    }
  }

  function neuAnfangen() {
    if (z.pdf) pdfSchliessen(z.pdf);
    z.pdf = null;
    z.datei = null;
    z.dok = null;
    z.serverSeiten = new Map();
    z.codes = [];
    z.vorschlag = null;
    z.auswahl = new Set();
    z.seiten = new Map();
    z.vorschauen = new Map();
    z.meta = { titel: "", hersteller: "", modell_serie: "", version: "", typ: "installationsanleitung", quelle_url: "" };
    z.versatz = 0;
    schrittZeigen(1);
  }

  // --- Start ----------------------------------------------------------------------------------
  meterNeu();
  const geladen = listeLaden();
  const dokParam = String(p.dok || "").trim().toUpperCase();
  if (/^D-UP-\d{3}$/.test(dokParam)) {
    schrittZeigen(1, true);
    geladen.then(function () { if (!z.weg) fortsetzen(dokParam); });
  } else {
    schrittZeigen(1, true);
  }

  return {
    titel: "Handbuch hochladen",
    verlassen: function () {
      if (z.uploadLaeuft) {
        return ctx.bestaetigen("Der Upload läuft noch. Anhalten und verlassen? Der Entwurf bleibt und lässt sich über „Weiter“ fortsetzen.", { ja: "Verlassen", nein: "Bleiben", gefahr: true })
          .then(function (ja) {
            if (ja) z.anhalten = true;
            return ja;
          });
      }
      if (z.pdf && !z.dok && z.auswahl.size) {
        return ctx.bestaetigen("Die Seitenauswahl ist noch nicht hochgeladen. Trotzdem verlassen?", { ja: "Verlassen", nein: "Bleiben", gefahr: true });
      }
      return true;
    },
    aufraeumen: function () {
      z.weg = true;
      z.anhalten = true;
      z.aufgaben = [];
      if (z.beobachter) z.beobachter.disconnect();
      z.renderTasks.forEach(function (t) { try { t.cancel(); } catch (e) { /* egal */ } });
      z.renderTasks.clear();
      if (z.pdf) {
        pdfSchliessen(z.pdf);
      }
      z.pdf = null;
      z.vorschauen.forEach(function (c) { c.width = 0; c.height = 0; });
      z.vorschauen.clear();
      z.seiten.clear();
    },
  };
}

// --- Tokenzähler --------------------------------------------------------------------------

/**
 * „Diese Auswahl ≈ N Tokens · Wissensbasis gesamt ≈ M von empfohlen 90.000“ mit
 * Balken (Marke bis zur Empfehlung, darüber --achtung, über der Grenze --stopp).
 * kopf=true: nur der heutige Stand für die Kopfzeile.
 */
function tokenMeter(u, gesamt, auswahl, kopf, unbekannt, beschriftung) {
  const empf = u.empfohlen_tokens || 90000;
  const max = u.max_tokens || 150000;
  const stufe = gesamt > max ? "stopp" : gesamt > empf ? "achtung" : "gut";
  const balken = h("span", { class: "hb-meter-balken", "aria-hidden": "true" },
    h("span", { class: "hb-meter-basis" }),
    h("span", { class: "hb-meter-auswahl" }),
    h("span", { class: "hb-meter-marke", title: "empfohlen " + zahl(empf) }));
  const basisAnteil = Math.min(1, (gesamt - auswahl) / max);
  const auswahlAnteil = Math.min(1 - basisAnteil, auswahl / max);
  balken.querySelector(".hb-meter-basis").style.setProperty("width", (basisAnteil * 100).toFixed(2) + "%");
  balken.querySelector(".hb-meter-auswahl").style.setProperty("width", (auswahlAnteil * 100).toFixed(2) + "%");
  balken.querySelector(".hb-meter-auswahl").style.setProperty("left", (basisAnteil * 100).toFixed(2) + "%");
  balken.querySelector(".hb-meter-marke").style.setProperty("left", (Math.min(1, empf / max) * 100).toFixed(2) + "%");
  // „Platz im Wissen: 64 % belegt“ (Anteil am empfohlenen Umfang) – die
  // genauen Tokens stehen im title (Gegenprüfung 09.10.).
  const prozent = function (n) { return Math.round(n * 100 / Math.max(1, empf)); };
  const genau = (beschriftung || "Diese Auswahl") + " ≈ " + zahl(auswahl) + " Tokens · Wissensbasis gesamt ≈ " + zahl(gesamt) + " von empfohlen " + zahl(empf);
  const text = kopf
    ? h("p", { class: "hb-meter-text zahl", title: "Wissensbasis ≈ " + zahl(gesamt) + " Tokens von empfohlen " + zahl(empf) }, "Platz im Wissen: ", h("strong", { text: prozent(gesamt) + " %" }), " belegt")
    : h("p", { class: "hb-meter-text zahl", title: genau },
      "Platz im Wissen: ", h("strong", { text: prozent(gesamt) + " %" }), " belegt" +
      (auswahl ? " · " + (beschriftung ? beschriftung.toLowerCase() : "diese Auswahl") + " +" + Math.max(1, prozent(auswahl)) + " %" : "") +
      (unbekannt ? " (" + unbekannt + " Seiten werden noch gelesen)" : ""));
  const warnung = stufe === "stopp"
    ? h("p", { class: "hb-meter-warnung hb-meter-stopp" }, ikon("stopp", { groesse: 14 }), "Über der Grenze von " + zahl(max) + " Tokens – so lässt sich nicht hochladen. Bitte Seiten abwählen.")
    : stufe === "achtung"
    ? h("p", { class: "hb-meter-warnung hb-meter-achtung" }, ikon("achtung", { groesse: 14 }), "Über der Empfehlung: Jede Frage wird langsamer und teurer.")
    : null;
  return h("div", { class: "hb-meter hb-meter-" + stufe + (kopf ? " hb-meter-kopf" : ""), role: kopf ? null : "status", "aria-live": kopf ? null : "polite" },
    text, balken, warnung);
}
