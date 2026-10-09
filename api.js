// ============================================================================
// api.js  ·  Verbindung zu den Edge Functions (SPEC 4, 7, 8, 12, 13.3.9)
// ----------------------------------------------------------------------------
// Bestehend (Vertrag SPEC 8, unverändert):
//   anmelden(passcode, rolle)  sitzung()  abmelden()  aktuelleSitzung()
//   frage(text, onEreignis) → Promise<letztesEreignis>   leseNdjson()
//   aktion(action, payload)    notiz(schritt, daten)    ladeBild(id)
//   istMock, ApiFehler
// Neu (SPEC 13.3.9): einrichtung, einrichtungFarben, einrichtungSpeichern,
//   akte, quelle, ladeSeitenbild, beitraege, einsatzListen, einsatz,
//   freigaben, freigabe, handbuecher, handbuch, roh, rechteFuer.
// Neu (SPEC 14.3.14): frage(text, onEreignis, { anlage_id }) – Body bekommt
//   anlage_id nur, wenn gesetzt; akteListe() → GET akte?liste=1 (Fallsuche).
// anmelden/sitzung liefern zusätzlich `rechte` (vom Server; ein alter Server
// ohne das Feld bekommt dieselbe Tabelle aus rechteFuer()).
//
// Mit ?mock=1 laufen dieselben Funktionen offline gegen web/mock/. Der Mock
// ersetzt NUR den Transport (fetch) – Kopfzeilen, Fehlerbehandlung, Sitzung
// und der NDJSON-Leser sind derselbe Code wie im Echtbetrieb. Sonst prüft der
// Offline-Lauf etwas anderes als das, was in der Demo läuft.
//
// Die Sitzung liegt in sessionStorage, nicht localStorage: pro Fenster eine
// eigene. Zwei Fenster mit zwei Rollen sind ein geplanter Teil der Demo.
// ============================================================================
import { PUBLISHABLE_KEY, SUPABASE_URL } from "./config.js";

export const istMock = (function () {
  try {
    return new URLSearchParams(window.location.search).get("mock") === "1";
  } catch (e) {
    return false;
  }
})();

const SPEICHER = istMock ? "wa.sitzung.mock" : "wa.sitzung";

/**
 * So lange darf der Strom von `frage` schweigen, bevor wir abbrechen.
 * Der Server schickt alle 5 s ein `puls` (SPEC 4); 25 s Stille heißt also
 * sicher „Verbindung tot“ und nicht „Modell denkt noch“.
 */
const STILLE_MAX_MS = 25000;

export class ApiFehler extends Error {
  constructor(code, text, status, inhalt) {
    super(text);
    this.name = "ApiFehler";
    this.code = code;
    this.status = status || 0;
    this.inhalt = inhalt || null;
  }
}

// --- Rechte (SPEC 13.2.1) ----------------------------------------------------

const RANG = { kundenbetreuer: 1, standortleiter: 1, techniker: 2, meister: 3, ingenieur: 3 };
const RECHTE_NAMEN = ["erfahrung", "einsatz", "freigabe", "handbuch", "einrichtung", "modus_wahl"];

/**
 * Dieselbe Tabelle wie _shared/rollen.ts rechteFuer() – nur für einen Server,
 * der `rechte` noch nicht mitschickt. Entscheiden tut immer der Server; hier
 * geht es nur darum, keine Knöpfe zu zeigen, die mit 403 enden.
 */
export function rechteFuer(rolle, istAdmin) {
  const r = RANG[rolle] || 0;
  const admin = !!istAdmin;
  return {
    erfahrung: r >= 1,
    einsatz: r >= 2,
    freigabe: r >= 3 || admin,
    handbuch: r >= 3 || admin,
    einrichtung: admin,
    modus_wahl: r >= 2,
  };
}

function rechteLesen(roh, rolle, istAdmin) {
  if (roh && typeof roh === "object") {
    const r = {};
    RECHTE_NAMEN.forEach(function (n) {
      r[n] = roh[n] === true;
    });
    return r;
  }
  return rechteFuer(rolle, istAdmin);
}

// --- Sitzung -----------------------------------------------------------------

/**
 * sessionStorage kann werfen (Safari privat, gesperrte Website-Daten). Dann
 * gilt die Sitzung nur im Speicher dieser Seite – ein Reload meldet ab, aber
 * nichts stürzt ab.
 */
let sitzungImSpeicher = null;

function gespeicherteSitzung() {
  try {
    const roh = window.sessionStorage.getItem(SPEICHER);
    return roh ? JSON.parse(roh) : sitzungImSpeicher;
  } catch (e) {
    return sitzungImSpeicher;
  }
}

function speichereSitzung(info) {
  sitzungImSpeicher = info;
  try {
    window.sessionStorage.setItem(SPEICHER, JSON.stringify(info));
  } catch (e) {
    // dann eben nur im Speicher
  }
}

function sitzungVergessen() {
  sitzungImSpeicher = null;
  try {
    window.sessionStorage.removeItem(SPEICHER);
  } catch (e) {
    // nichts zu tun
  }
}

/**
 * Antwort von `anmelden` (POST und GET) in eine feste Form bringen. Der
 * Server darf die Felder flach liefern oder als {sitzung, zugang} wie
 * `sitzung_laden` (SPEC 2.1) – beides wird verstanden.
 */
function normalisiere(roh, alt) {
  const r = roh || {};
  const s = r.sitzung || {};
  const z = r.zugang || {};
  const a = alt || {};
  const rollen = r.rollen || z.rollen || a.rollen;
  const rolle = r.rolle || s.rolle || a.rolle || "";
  const istAdmin = !!(r.ist_admin || z.ist_admin || a.ist_admin);
  return {
    token: r.token || a.token || null,
    rolle: rolle,
    anzeigename: r.anzeigename || z.anzeigename || a.anzeigename || "",
    rollen: Array.isArray(rollen) ? rollen : [],
    gueltig_bis: r.gueltig_bis || z.gueltig_bis || a.gueltig_bis || null,
    ist_admin: istAdmin,
    rechte: rechteLesen(r.rechte || null, rolle, istAdmin),
    // Laufender Fall nach einem Reload (GET anmelden); beim Anmelden gibt es keinen.
    fall: r.fall && r.fall.anlage_id
      ? { anlage_id: String(r.fall.anlage_id), kunde_alias: r.fall.kunde_alias ? String(r.fall.kunde_alias) : "" }
      : null,
  };
}

/** Die Sitzung dieses Fensters ohne Netzanfrage (oder null). */
export function aktuelleSitzung() {
  const s = gespeicherteSitzung();
  if (!s || !s.token) return null;
  if (!s.rechte) s.rechte = rechteFuer(s.rolle, s.ist_admin);
  return s;
}

// --- Transport ---------------------------------------------------------------

let mockLader = null;
function mockModul() {
  if (!mockLader) mockLader = import("./mock/mock.js");
  return mockLader;
}

function basisUrl() {
  return SUPABASE_URL.replace(/\/+$/, "") + "/functions/v1/";
}

async function senden(pfad, init) {
  if (istMock) {
    const m = await mockModul();
    return m.mockFetch(pfad, init);
  }
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) {
    throw new ApiFehler(
      "konfiguration",
      "config.js ist noch nicht ausgefüllt (SUPABASE_URL, PUBLISHABLE_KEY). Für einen Offline-Test ?mock=1 an die Adresse hängen.",
    );
  }
  return fetch(basisUrl() + pfad, init);
}

/**
 * Genau die drei Kopfzeilen, die die CORS-Freigabe der Functions erlaubt
 * (SPEC 7: apikey, content-type, x-sitzung). Ein zusätzlicher Header – etwa
 * Authorization – ließe schon den Preflight scheitern.
 */
function kopfzeilen(mitJson) {
  const h = { apikey: PUBLISHABLE_KEY };
  const s = gespeicherteSitzung();
  if (s && s.token) h["x-sitzung"] = s.token;
  if (mitJson) h["content-type"] = "application/json";
  return h;
}

/** Antworttext lesen; JSON, sonst letzte NDJSON-Zeile, sonst null. */
async function leseInhalt(antwort) {
  let text = "";
  try {
    text = await antwort.text();
  } catch (e) {
    return null;
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    const zeilen = text.split("\n").map(function (z) {
      return z.trim();
    }).filter(Boolean);
    for (let i = zeilen.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(zeilen[i]);
      } catch (e2) {
        // weiter suchen
      }
    }
    return { text: text.slice(0, 300) };
  }
}

/** Meldungstext aus einer Server-Antwort, egal unter welchem Feldnamen. */
function serverText(inhalt) {
  const i = inhalt || {};
  const t = i.text || i.fehler || i.message || i.meldung || i.error;
  return typeof t === "string" ? t : "";
}

function fehlerText(status, inhalt) {
  const vomServer = serverText(inhalt);
  if (vomServer) return vomServer;
  if (status === 401) return "Die Sitzung ist abgelaufen oder ungültig. Bitte neu anmelden.";
  if (status === 403) return "Diese Aktion ist für deine Rolle oder von dieser Adresse aus nicht freigegeben.";
  if (status === 404) return "Nicht gefunden.";
  if (status === 413) return "Die Anfrage ist zu groß.";
  if (status === 429) return "Das Kontingent für heute ist aufgebraucht.";
  if (status >= 500) return "Der Server hat einen Fehler gemeldet. Bitte gleich noch einmal versuchen.";
  return "Die Anfrage wurde abgelehnt (HTTP " + status + ").";
}

function fehlerCode(status, inhalt) {
  if (inhalt && typeof inhalt.code === "string") return inhalt.code;
  if (status === 401) return "sitzung";
  if (status === 403) return "verboten";
  if (status === 404) return "nicht_gefunden";
  if (status === 429) return "deckel";
  if (status >= 500) return "server";
  return "http";
}

const NETZFEHLER = "Keine Verbindung zum Server. Bitte Netz prüfen und erneut versuchen.";

function queryText(query) {
  if (!query) return "";
  if (typeof query === "string") return query.charAt(0) === "?" ? query : "?" + query;
  const teile = [];
  Object.keys(query).forEach(function (k) {
    const v = query[k];
    if (v === null || v === undefined || v === "") return;
    teile.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v)));
  });
  return teile.length ? "?" + teile.join("&") : "";
}

async function jsonAnfrage(pfad, methode, daten) {
  let antwort;
  try {
    antwort = await senden(pfad, {
      method: methode,
      headers: kopfzeilen(daten !== undefined),
      body: daten !== undefined ? JSON.stringify(daten) : undefined,
      cache: "no-store",
    });
  } catch (e) {
    if (e instanceof ApiFehler) throw e;
    throw new ApiFehler("netz", NETZFEHLER);
  }
  const inhalt = await leseInhalt(antwort);
  if (!antwort.ok) {
    throw new ApiFehler(fehlerCode(antwort.status, inhalt), fehlerText(antwort.status, inhalt), antwort.status, inhalt);
  }
  return inhalt || {};
}

/** JSON-Anfrage, bei der auch {ok:false} mit 200 als Fehler gilt. */
async function jsonOk(pfad, methode, daten, standardText) {
  const inhalt = await jsonAnfrage(pfad, methode, daten);
  if (inhalt && inhalt.ok === false) {
    throw new ApiFehler(inhalt.code || "fehler", serverText(inhalt) || standardText || "Nicht ausgeführt.", 200, inhalt);
  }
  return inhalt;
}

// --- Anmelden ----------------------------------------------------------------

/**
 * Zwei Schritte: erst nur der Passcode, dann – wenn der Zugang mehrere
 * Rollen hat – die Rolle (SPEC 8).
 *
 * Rückgabe:
 *   { angemeldet: true,  token, rolle, anzeigename, rollen, gueltig_bis, ist_admin, rechte, fall }
 *   { angemeldet: false, rollen, anzeigename }   → Rolle wählen, dann erneut
 */
export async function anmelden(passcode, rolle) {
  const daten = { passcode: String(passcode || "") };
  if (rolle) daten.rolle = rolle;
  let inhalt;
  try {
    inhalt = await jsonAnfrage("anmelden", "POST", daten);
  } catch (e) {
    if (!rolle && e.inhalt && Array.isArray(e.inhalt.rollen) && e.inhalt.rollen.length) {
      return { angemeldet: false, rollen: e.inhalt.rollen, anzeigename: e.inhalt.anzeigename || "" };
    }
    if (e.status === 401) {
      // Gleiche Meldung für unbekannt und abgelaufen (SPEC 7).
      throw new ApiFehler("passcode", "Passcode unbekannt oder abgelaufen.", 401);
    }
    throw e;
  }
  if (inhalt.token) {
    const info = normalisiere(inhalt, null);
    if (!info.rolle && rolle) {
      info.rolle = rolle;
      if (!inhalt.rechte) info.rechte = rechteFuer(rolle, info.ist_admin);
    }
    speichereSitzung(info);
    return Object.assign({ angemeldet: true }, info);
  }
  if (Array.isArray(inhalt.rollen) && inhalt.rollen.length) {
    return { angemeldet: false, rollen: inhalt.rollen, anzeigename: inhalt.anzeigename || "" };
  }
  throw new ApiFehler("antwort", "Unerwartete Antwort beim Anmelden.", 0, inhalt);
}

/**
 * Sitzung nach einem Reload wiederherstellen (GET anmelden mit x-sitzung).
 * null = nicht (mehr) angemeldet. Bei einem Netzfehler bleibt die
 * gespeicherte Sitzung gültig – die nächste Anfrage zeigt dann ehrlich, was
 * los ist, statt den Nutzer grundlos abzumelden.
 */
export async function sitzung() {
  const s = aktuelleSitzung();
  if (!s) return null;
  try {
    const info = normalisiere(await jsonAnfrage("anmelden", "GET"), s);
    speichereSitzung(info);
    return info;
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      sitzungVergessen();
      return null;
    }
    return s;
  }
}

/** Abmelden: Der Server kennt keinen Abmelde-Endpunkt (SPEC 7). */
export function abmelden() {
  sitzungVergessen();
  [bildCache, seitenCache].forEach(function (cache) {
    cache.forEach(function (versprechen) {
      versprechen.then(function (url) {
        if (url && url.indexOf("blob:") === 0) URL.revokeObjectURL(url);
      }, function () {});
    });
    cache.clear();
  });
}

// --- NDJSON ------------------------------------------------------------------

/**
 * NDJSON lesen: Bytes kommen in beliebigen Stücken, eine Zeile kann über
 * mehrere Stücke verteilt sein und ein Umlaut mitten in der Bytefolge
 * zerschnitten. Deshalb TextDecoder im stream-Modus und ein Zeilenpuffer.
 * beiDaten() läuft bei jedem Stück und hält den Stille-Wächter wach.
 */
export async function leseNdjson(antwort, proZeile, beiDaten) {
  const melden = typeof beiDaten === "function" ? beiDaten : function () {};
  if (!antwort.body || typeof antwort.body.getReader !== "function") {
    const text = await antwort.text();
    melden();
    text.split("\n").forEach(function (z) {
      const zeile = z.trim();
      if (zeile) proZeile(zeile);
    });
    return;
  }
  const leser = antwort.body.getReader();
  const dekoder = new TextDecoder("utf-8");
  let puffer = "";
  for (;;) {
    const stueck = await leser.read();
    if (stueck.done) break;
    melden();
    puffer += dekoder.decode(stueck.value, { stream: true });
    let pos = puffer.indexOf("\n");
    while (pos !== -1) {
      const zeile = puffer.slice(0, pos).trim();
      puffer = puffer.slice(pos + 1);
      if (zeile) proZeile(zeile);
      pos = puffer.indexOf("\n");
    }
  }
  puffer += dekoder.decode();
  const rest = puffer.trim();
  if (rest) proZeile(rest);
}

// --- Frage -------------------------------------------------------------------

const BEKANNTE_EREIGNISSE = { fortschritt: 1, vorab: 1, antwort: 1, fehler: 1, puls: 1 };

/**
 * Frage stellen. onEreignis bekommt jedes Ereignis aus dem Strom. Das
 * Versprechen löst immer auf – nie mit Ausnahme – und zwar mit dem letzten
 * Ereignis: `antwort` oder `fehler`. Bricht die Verbindung ohne eines von
 * beiden ab, wird ein `fehler` erzeugt, damit die Oberfläche nie hängt.
 */
export async function frage(text, onEreignis, optionen) {
  // anlage_id (SPEC 14.2.7): Anlage aus der Fallsuche oder der Auswahl –
  // „diese Anlage, falls der Text keine nennt“. Nur mitschicken, wenn gesetzt,
  // damit ein alter Server dasselbe Body sieht wie bisher.
  const o = optionen || {};
  const body = { text: String(text) };
  const anlageId = typeof o.anlage_id === "string" ? o.anlage_id.trim().toUpperCase() : "";
  if (/^A-\d{4}$/.test(anlageId)) body.anlage_id = anlageId;
  const melde = function (ev) {
    if (typeof onEreignis !== "function") return;
    try {
      onEreignis(ev);
    } catch (e) {
      // Ein Fehler beim Darstellen darf das Lesen des Stroms nicht beenden.
      console.error("Ereignis „" + (ev && ev.t) + "“ konnte nicht dargestellt werden:", e);
    }
  };
  const steuerung = typeof AbortController === "function" ? new AbortController() : null;
  let letztes = null;
  let stille = null;
  let zeitUeber = false;
  const wecker = function () {
    clearTimeout(stille);
    stille = setTimeout(function () {
      zeitUeber = true;
      if (steuerung) steuerung.abort();
    }, STILLE_MAX_MS);
  };

  try {
    wecker();
    const antwort = await senden("frage", {
      method: "POST",
      headers: kopfzeilen(true),
      body: JSON.stringify(body),
      signal: steuerung ? steuerung.signal : undefined,
      cache: "no-store",
    });
    if (!antwort.ok) {
      const inhalt = await leseInhalt(antwort);
      if (antwort.status === 401) sitzungVergessen();
      letztes = inhalt && inhalt.t === "fehler"
        ? inhalt
        : { t: "fehler", code: fehlerCode(antwort.status, inhalt), text: fehlerText(antwort.status, inhalt) };
      melde(letztes);
      return letztes;
    }
    await leseNdjson(
      antwort,
      function (zeile) {
        let ev;
        try {
          ev = JSON.parse(zeile);
        } catch (e) {
          console.warn("NDJSON-Zeile nicht lesbar, übersprungen:", zeile.slice(0, 200));
          return;
        }
        if (!ev || typeof ev.t !== "string") return;
        if (!BEKANNTE_EREIGNISSE[ev.t]) {
          console.warn("Unbekanntes Ereignis übersprungen:", ev.t);
          return;
        }
        if (ev.t === "antwort" || ev.t === "fehler") letztes = ev;
        melde(ev);
      },
      wecker,
    );
  } catch (e) {
    if (!letztes) {
      if (zeitUeber) {
        letztes = {
          t: "fehler",
          code: "zeit",
          text: "Seit " + Math.round(STILLE_MAX_MS / 1000) + " s kam nichts mehr vom Server. Bitte erneut senden.",
        };
      } else if (e instanceof ApiFehler) {
        letztes = { t: "fehler", code: e.code, text: e.message };
      } else {
        letztes = { t: "fehler", code: "netz", text: "Die Verbindung ist abgebrochen. Bitte Netz prüfen und erneut senden." };
      }
      melde(letztes);
    }
  } finally {
    clearTimeout(stille);
  }
  if (!letztes) {
    letztes = {
      t: "fehler",
      code: "abbruch",
      text: "Die Verbindung wurde beendet, bevor die Antwort vollständig war. Bitte erneut senden.",
    };
    melde(letztes);
  }
  return letztes;
}

// --- Aktion, Notiz -------------------------------------------------------------

/** Aktion ausführen → { ok, bestaetigung: Block }. Wirft ApiFehler. */
export async function aktion(action, payload) {
  return jsonOk("aktion", "POST", { action: action, payload: payload || {} }, "Aktion nicht ausgeführt.");
}

/**
 * Wissen festhalten (SPEC 7, 13.2.2):
 *   notiz('strukturieren', { text })                 → { ok, karte }
 *   notiz('einreichen', { notiz: {...}, quelle })    → { ok, status, id, kuerzel, notiz, text }
 *   notiz('freigeben', { notiz: {...}, quelle })     → { ok, kuerzel, ... } (alter Weg, nur Meister)
 */
export async function notiz(schritt, daten) {
  return jsonOk("notiz", "POST", Object.assign({ schritt: schritt }, daten || {}), "Notiz nicht verarbeitet.");
}

/** Eigene Beiträge des Zugangs (GET notiz) → { ok, beitraege }. */
export async function beitraege() {
  return jsonOk("notiz", "GET", undefined, "Beiträge nicht geladen.");
}

// --- Einrichtung (Branding) ----------------------------------------------------

/** GET einrichtung – ohne Sitzung (die Login-Seite braucht das Branding). */
export async function einrichtung() {
  return jsonOk("einrichtung", "GET", undefined, "Einrichtung nicht geladen.");
}

/** GET einrichtung?farbe=#RRGGBB → { ok, farben } für die Live-Vorschau (speichert nichts). */
export async function einrichtungFarben(hex) {
  return jsonOk("einrichtung" + queryText({ farbe: String(hex || "") }), "GET", undefined, "Farbe nicht berechnet.");
}

/** POST einrichtung (nur Admin) → { ok, branding, farben }. */
export async function einrichtungSpeichern(daten) {
  return jsonOk("einrichtung", "POST", daten || {}, "Einrichtung nicht gespeichert.");
}

// --- Akte, Quelle ----------------------------------------------------------------

export async function akte(anlageId) {
  return jsonOk("akte" + queryText({ anlage_id: String(anlageId || "") }), "GET", undefined, "Akte nicht geladen.");
}

/**
 * Alle Anlagen mit Adresse für die Fallsuche (SPEC 14.2.7, GET akte?liste=1)
 * → { ok, anlagen: [{id, kunde_alias, strasse, hausnummer, plz, ort, offene_tickets}] }.
 * Einmal je Sitzung laden; gefiltert wird im Browser (app.js).
 */
export async function akteListe() {
  return jsonOk("akte?liste=1", "GET", undefined, "Anlagenliste nicht geladen.");
}

export async function quelle(id) {
  return jsonOk("quelle" + queryText({ id: String(id || "") }), "GET", undefined, "Quelle nicht geladen.");
}

// --- Einsatz, Freigabe, Handbuch -------------------------------------------------

/** GET einsatz[?anlage_id=…] – Listen für das Formular (anlageId optional). */
export async function einsatzListen(anlageId) {
  return jsonOk("einsatz" + queryText(anlageId ? { anlage_id: String(anlageId) } : null), "GET", undefined, "Listen nicht geladen.");
}

/** POST einsatz {schritt: 'anlegen' | 'nachtragen', ...daten} */
export async function einsatz(schritt, daten) {
  return jsonOk("einsatz", "POST", Object.assign({ schritt: schritt }, daten || {}), "Einsatz nicht gespeichert.");
}

/** GET freigabe[?nur=zahlen] */
export async function freigaben(nurZahlen) {
  return jsonOk("freigabe" + (nurZahlen ? "?nur=zahlen" : ""), "GET", undefined, "Freigaben nicht geladen.");
}

/** POST freigabe {art, id, entscheidung, …} */
export async function freigabe(daten) {
  return jsonOk("freigabe", "POST", daten || {}, "Entscheidung nicht gespeichert.");
}

/** GET handbuch[?dokument_id=…] */
export async function handbuecher(dokumentId) {
  return jsonOk("handbuch" + queryText(dokumentId ? { dokument_id: String(dokumentId) } : null), "GET", undefined, "Handbücher nicht geladen.");
}

/** POST handbuch {schritt, ...daten} */
export async function handbuch(schritt, daten) {
  return jsonOk("handbuch", "POST", Object.assign({ schritt: schritt }, daten || {}), "Handbuch-Schritt nicht ausgeführt.");
}

/**
 * Rohe Anfrage für die Prüfseite und die Abnahme (13.4.1): wirft nie,
 * wechselt keine Sitzung, liefert {status, typ, json|null}.
 * fn: Name der Function; query: Objekt oder "a=b"; body: Objekt (→ POST, wenn keine methode).
 */
export async function roh(fn, optionen) {
  const o = optionen || {};
  const methode = o.methode || (o.body !== undefined ? "POST" : "GET");
  let antwort;
  try {
    antwort = await senden(String(fn) + queryText(o.query), {
      method: methode,
      headers: kopfzeilen(o.body !== undefined),
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      cache: "no-store",
    });
  } catch (e) {
    return { status: 0, typ: "", json: null, fehler: e && e.message ? e.message : String(e) };
  }
  let typ = "";
  try {
    typ = (antwort.headers && antwort.headers.get && antwort.headers.get("content-type")) || "";
  } catch (e) {
    typ = "";
  }
  let json = null;
  if (/json/i.test(typ) || !typ) {
    json = await leseInhalt(antwort);
  } else {
    try {
      await antwort.blob();
    } catch (e) {
      // Körper verwerfen
    }
  }
  return { status: antwort.status, typ: typ, json: json };
}

// --- Bilder ----------------------------------------------------------------------

/**
 * Abbildung bzw. Seitenbild laden → Blob-URL. <img src> kann keine x-sitzung
 * mitschicken, deshalb fetch + Blob (SPEC 7). Je Bild nur ein Abruf pro
 * Fenster; ein Fehlversuch wird nicht festgehalten, damit es erneut gehen darf.
 */
const bildCache = new Map();
const seitenCache = new Map();

function bildHolen(cache, schluessel, pfad, mockHolen) {
  if (cache.has(schluessel)) return cache.get(schluessel);
  const versprechen = (async function () {
    if (istMock) {
      const m = await mockModul();
      return mockHolen(m);
    }
    let antwort;
    try {
      antwort = await senden(pfad, { method: "GET", headers: kopfzeilen(false) });
    } catch (e) {
      if (e instanceof ApiFehler) throw e;
      throw new ApiFehler("netz", NETZFEHLER);
    }
    if (!antwort.ok) throw new ApiFehler("bild", "Bild konnte nicht geladen werden.", antwort.status);
    const blob = await antwort.blob();
    return URL.createObjectURL(blob);
  })();
  cache.set(schluessel, versprechen);
  versprechen.then(null, function () {
    cache.delete(schluessel);
  });
  return versprechen;
}

/** Abbildung (bild?id=N) → Blob-URL. */
export function ladeBild(id) {
  return bildHolen(bildCache, String(id), "bild?id=" + encodeURIComponent(String(id)), function (m) {
    return m.bildDataUrl(id);
  });
}

/** Seitenbild (bild?dok=…&seite=…) → Blob-URL. */
export function ladeSeitenbild(dokumentId, seite) {
  const schluessel = String(dokumentId) + "|" + String(seite);
  return bildHolen(seitenCache, schluessel, "bild" + queryText({ dok: String(dokumentId), seite: String(seite) }), function (m) {
    return m.seitenbildDataUrl(dokumentId, seite);
  });
}
