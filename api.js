// ============================================================================
// api.js  ·  Verbindung zu den Edge Functions (SPEC 4, 7, 8)
// ----------------------------------------------------------------------------
// Exporte laut Vertrag (SPEC 8):
//   anmelden(passcode, rolle)  frage(text, onEreignis) → Promise<letztesEreignis>
//   aktion(action, payload)    notiz(schritt, daten)    ladeBild(id)   sitzung()
// dazu: abmelden(), aktuelleSitzung(), leseNdjson(), istMock, ApiFehler.
//
// Mit ?mock=1 laufen dieselben Funktionen offline gegen web/mock/. Der Mock
// ersetzt NUR den Transport (fetch) – Kopfzeilen, Fehlerbehandlung, Sitzung
// und vor allem der NDJSON-Leser sind derselbe Code wie im Echtbetrieb. Sonst
// prüft der Offline-Lauf etwas anderes als das, was in der Demo läuft.
//
// Die Sitzung liegt in sessionStorage, nicht localStorage: pro Fenster eine
// eigene. Zwei Fenster mit zwei Rollen sind ein geplanter Teil der Demo
// (Plan Pos. 6, „Kundenbetreuer gegen Techniker“) – mit localStorage würde
// das zweite Login das erste überschreiben.
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
 * sicher „Verbindung tot“ und nicht „Modell denkt noch“. Ohne diese Grenze
 * hinge die Fortschrittsspur bei einer toten Mobilfunkverbindung ewig.
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
    // siehe oben: dann eben nur im Speicher
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
  return {
    token: r.token || a.token || null,
    rolle: r.rolle || s.rolle || a.rolle || "",
    anzeigename: r.anzeigename || z.anzeigename || a.anzeigename || "",
    rollen: Array.isArray(rollen) ? rollen : [],
    gueltig_bis: r.gueltig_bis || z.gueltig_bis || a.gueltig_bis || null,
    ist_admin: !!(r.ist_admin || z.ist_admin || a.ist_admin),
    // Laufender Fall nach einem Reload (GET anmelden); beim Anmelden gibt es keinen.
    fall: r.fall && r.fall.anlage_id
      ? { anlage_id: String(r.fall.anlage_id), kunde_alias: r.fall.kunde_alias ? String(r.fall.kunde_alias) : "" }
      : null,
  };
}

/** Die Sitzung dieses Fensters ohne Netzanfrage (oder null). */
export function aktuelleSitzung() {
  const s = gespeicherteSitzung();
  return s && s.token ? s : null;
}

// --- Transport ---------------------------------------------------------------

let mockLader = null;
function mockModul() {
  if (!mockLader) mockLader = import("./mock/mock.js");
  return mockLader;
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
  return fetch(SUPABASE_URL.replace(/\/+$/, "") + "/functions/v1/" + pfad, init);
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
  if (status === 429) return "Das Kontingent für heute ist aufgebraucht.";
  if (status >= 500) return "Der Server hat einen Fehler gemeldet. Bitte gleich noch einmal versuchen.";
  return "Die Anfrage wurde abgelehnt (HTTP " + status + ").";
}

function fehlerCode(status, inhalt) {
  if (inhalt && typeof inhalt.code === "string") return inhalt.code;
  if (status === 401) return "sitzung";
  if (status === 403) return "verboten";
  if (status === 429) return "deckel";
  if (status >= 500) return "server";
  return "http";
}

const NETZFEHLER = "Keine Verbindung zum Server. Bitte Netz prüfen und erneut versuchen.";

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

// --- Anmelden ----------------------------------------------------------------

/**
 * Zwei Schritte: erst nur der Passcode, dann – wenn der Zugang mehrere
 * Rollen hat – die Rolle (SPEC 8, „Rollenwahl nach erstem Schritt“).
 *
 * Rückgabe:
 *   { angemeldet: true,  token, rolle, anzeigename, rollen, gueltig_bis, ist_admin }
 *   { angemeldet: false, rollen, anzeigename }   → Rolle wählen, dann erneut
 *
 * Ohne Rolle darf der Server die Rollen mit 200 (ohne token) liefern oder mit
 * einem Fehlerstatus, solange `rollen` im Inhalt steht. Hat der Zugang nur
 * eine Rolle, darf er sofort eine Sitzung anlegen.
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
      // Gleiche Meldung für unbekannt und abgelaufen (SPEC 7) – kein Hinweis,
      // welcher Passcode „fast“ stimmt.
      throw new ApiFehler("passcode", "Passcode unbekannt oder abgelaufen.", 401);
    }
    throw e;
  }
  if (inhalt.token) {
    const info = normalisiere(inhalt, null);
    if (!info.rolle && rolle) info.rolle = rolle;
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

/**
 * Abmelden. Der Server kennt keinen Abmelde-Endpunkt (SPEC 7); die Sitzung
 * verfällt dort nach 12 h ohne Aktivität. Hier wird sie sofort vergessen.
 */
export function abmelden() {
  sitzungVergessen();
  bildCache.forEach(function (versprechen) {
    versprechen.then(function (url) {
      if (url && url.indexOf("blob:") === 0) URL.revokeObjectURL(url);
    }, function () {});
  });
  bildCache.clear();
}

// --- NDJSON ------------------------------------------------------------------

/**
 * NDJSON lesen: Bytes kommen in beliebigen Stücken, eine Zeile kann über
 * mehrere Stücke verteilt sein und ein Umlaut mitten in der Bytefolge
 * zerschnitten. Deshalb TextDecoder im stream-Modus und ein Zeilenpuffer;
 * erst eine vollständige Zeile wird weitergegeben.
 *
 * beiDaten() läuft bei jedem Stück – auch ohne vollständige Zeile – und hält
 * den Stille-Wächter wach.
 */
export async function leseNdjson(antwort, proZeile, beiDaten) {
  const melden = typeof beiDaten === "function" ? beiDaten : function () {};
  if (!antwort.body || typeof antwort.body.getReader !== "function") {
    // Ohne lesbaren Strom (sehr alte Browser): alles auf einmal. Dann gibt es
    // keine Vorab-Stufe, aber eine vollständige Antwort.
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
 * Frage stellen. onEreignis bekommt jedes Ereignis aus dem Strom
 * (fortschritt, vorab, antwort, fehler, puls). Das Versprechen löst immer
 * auf – nie mit Ausnahme – und zwar mit dem letzten Ereignis: `antwort` oder
 * `fehler`. Bricht die Verbindung ohne eines von beiden ab, wird ein
 * `fehler` erzeugt, damit die Oberfläche nie in „läuft …“ hängen bleibt.
 */
export async function frage(text, onEreignis) {
  const melde = function (ev) {
    if (typeof onEreignis !== "function") return;
    try {
      onEreignis(ev);
    } catch (e) {
      // Ein Fehler beim Darstellen darf das Lesen des Stroms nicht beenden –
      // sonst fehlt am Ende die eigentliche Antwort.
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
      body: JSON.stringify({ text: String(text) }),
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
          text: "Seit " + Math.round(STILLE_MAX_MS / 1000) + " s kam nichts mehr vom Server. Bitte erneut senden.",
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

// --- Aktion, Notiz, Bild -----------------------------------------------------

/** Aktion ausführen → { ok, bestaetigung: Block }. Wirft ApiFehler. */
export async function aktion(action, payload) {
  const inhalt = await jsonAnfrage("aktion", "POST", { action: action, payload: payload || {} });
  if (inhalt.ok === false) {
    throw new ApiFehler(inhalt.code || "aktion", serverText(inhalt) || "Aktion nicht ausgeführt.", 200, inhalt);
  }
  return inhalt;
}

/**
 * Wissen erfassen (nur Rolle Meister, SPEC 7):
 *   notiz('strukturieren', { text })            → Karte
 *   notiz('freigeben', { notiz: {...}, quelle }) → { kuerzel }
 */
export async function notiz(schritt, daten) {
  const inhalt = await jsonAnfrage("notiz", "POST", Object.assign({ schritt: schritt }, daten || {}));
  if (inhalt.ok === false) {
    throw new ApiFehler(inhalt.code || "notiz", serverText(inhalt) || "Notiz nicht verarbeitet.", 200, inhalt);
  }
  return inhalt;
}

/**
 * Abbildung laden → Blob-URL. <img src> kann keine x-sitzung mitschicken,
 * deshalb fetch + Blob (SPEC 7). Je Bild nur ein Abruf pro Fenster; ein
 * Fehlversuch wird nicht festgehalten, damit der nächste Block neu laden darf.
 */
const bildCache = new Map();

export function ladeBild(id) {
  const schluessel = String(id);
  if (bildCache.has(schluessel)) return bildCache.get(schluessel);
  const versprechen = (async function () {
    if (istMock) {
      const m = await mockModul();
      return m.bildDataUrl(id);
    }
    let antwort;
    try {
      antwort = await senden("bild?id=" + encodeURIComponent(schluessel), {
        method: "GET",
        headers: kopfzeilen(false),
      });
    } catch (e) {
      if (e instanceof ApiFehler) throw e;
      throw new ApiFehler("netz", NETZFEHLER);
    }
    if (!antwort.ok) throw new ApiFehler("bild", "Abbildung konnte nicht geladen werden.", antwort.status);
    const blob = await antwort.blob();
    return URL.createObjectURL(blob);
  })();
  bildCache.set(schluessel, versprechen);
  versprechen.then(null, function () {
    bildCache.delete(schluessel);
  });
  return versprechen;
}
