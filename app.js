// ============================================================================
// app.js  ·  App-Shell: Anmelden, Chat, Wissen erfassen (SPEC 8, Plan Pos. 6)
// ----------------------------------------------------------------------------
// Zweistufiges Rendern (Plan Pos. 8): Was aus SQL kommt (Stopp-Box,
// Steckbrief, Wiederholungs-Alarm), steht nach zwei Sekunden als `vorab` da,
// darunter eine wahrheitsgemäße Fortschrittsspur. Kommt `antwort`, ersetzt sie
// die Vorab-Ansicht vollständig – der Server liefert die Vorab-Blöcke darin an
// ihrer endgültigen Stelle mit (SPEC 4). Kommt `fehler`, bleiben die
// Vorab-Blöcke stehen: Sie stammen aus der Datenbank und sind gültig.
// ============================================================================
import * as api from "./api.js";
import { el, leeren, renderAntwort, ROLLEN_NAMEN, ROLLEN_RANG, typo, zahl } from "./bloecke.js";

function $(id) {
  return document.getElementById(id);
}

/**
 * Beispiel-Eingaben je Rolle. Sie füllen nur das Eingabefeld und schicken
 * nichts ab: Der Interessent soll sehen, was er gleich fragt, und darf es
 * ändern. Bewusst nur Fälle, die ohne Vorgeschichte im Gespräch tragen –
 * „Ticket kann zu“ braucht eine gemerkte Anlage und steht deshalb nicht hier.
 */
const BEISPIELE = {
  kundenbetreuer: [
    "Frau Petersen ruft an, ihre Wärmepumpe ist wieder in Störung. Anlage A-1042.",
    "Herr Brandt fragt, ob wir nicht einfach eine größere Sicherung reinmachen können, die fliegt ständig. A-2177.",
    "Kunde kommt nicht mehr in die App.",
  ],
  techniker: [
    "Frau Petersen ruft an, ihre Wärmepumpe ist wieder in Störung. Anlage A-1042.",
    "Bin bei A-1042 vor Ort, was soll ich prüfen?",
    "Herr Brandt fragt, ob wir nicht einfach eine größere Sicherung reinmachen können, die fliegt ständig. A-2177.",
  ],
};

const ROLLEN_TEXT = {
  kundenbetreuer: "Telefon und Ticketannahme: Rückfragen stellen, an die Technik übergeben.",
  standortleiter: "Überblick über Fälle und Übergaben.",
  techniker: "Vor Ort: Prüfschritte, Ursache dokumentieren, Tickets schließen.",
  meister: "Wie Techniker, dazu Wissen erfassen und freigeben.",
  ingenieur: "Third Level: Herstellersysteme im Detail.",
};

const FEHLER_TITEL = {
  deckel: "Kontingent erreicht",
  modell: "Antwort nicht erzeugt",
  sitzung: "Sitzung abgelaufen",
  netz: "Verbindung unterbrochen",
  zeit: "Verbindung unterbrochen",
  abbruch: "Verbindung unterbrochen",
  konfiguration: "Nicht eingerichtet",
};

/** Pfade ohne Modellaufruf – das ist im Termin ein Argument, also steht es da. */
const PFAD_TEXT = {
  abschluss: "Ohne Modellaufruf – direkt aus Tickets und Regeln berechnet",
  trennung: "Feste Antwort ohne Modellaufruf",
  anlage_fehlt: "Ohne Modellaufruf – Anlage nicht in der Datenbank",
  deckel: "Ohne Modellaufruf",
};

let angemeldet = null; // Sitzungsinfo aus api.js
let laeuft = false; // Doppel-Senden verhindern
let fall = null; // {anlage_id, kunde_alias} – die Anlage, die sich die Sitzung merkt
let passcodeZwischen = ""; // nur zwischen Passcode und Rollenwahl, nie gespeichert

// --- Hilfen ------------------------------------------------------------------

/**
 * Etwas ausführen, wenn die Höhen feststehen.
 *
 * Zwei Frames, weil eine frisch eingefügte lange Antwort ihre Zeilenumbrüche
 * erst im nächsten Layout-Durchlauf bekommt. Dazu ein Zeitgeber als zweites
 * Bein: requestAnimationFrame feuert in einem verdeckten Tab GAR NICHT und
 * schlägt erst zu, wenn man zurückkommt – mitten in einer Antwort, die man
 * gerade liest (bezahlter Fehler aus dem Matari-Widget). Bei geteiltem
 * Bildschirm und zweitem Fenster ist das in der Demo genau die Lage.
 * Was zuerst kommt, gewinnt.
 */
function nachDemZeichnen(tuWas) {
  let erledigt = false;
  const einmal = function () {
    if (erledigt) return;
    erledigt = true;
    tuWas();
  };
  window.requestAnimationFrame(function () {
    window.requestAnimationFrame(einmal);
  });
  window.setTimeout(einmal, 60);
}

/**
 * Ein Element so einblenden, dass sein ANFANG oben steht – nicht ans Ende
 * scrollen. Antworten sind lang (Steckbrief, Zeitleiste, Ursachen); wer ans
 * Ende springt, landet bei den Quellen und muss erst hochscrollen, um mit dem
 * Lesen anfangen zu können.
 */
function scrolleNach(ziel) {
  const y = Math.max(0, Math.round(ziel));
  if (Math.abs(window.pageYOffset - y) < 4) return;
  const ruhig = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  try {
    window.scrollTo({ top: y, behavior: document.hidden || ruhig ? "auto" : "smooth" });
  } catch (e) {
    window.scrollTo(0, y);
  }
}

function zumAnfang(knoten) {
  nachDemZeichnen(function () {
    if (!knoten.isConnected) return;
    const kopf = $("kopf").getBoundingClientRect().bottom;
    scrolleNach(knoten.getBoundingClientRect().top + window.pageYOffset - kopf - 12);
  });
}

/**
 * Nur scrollen, wenn das Element nicht schon sichtbar ist – für die
 * Fehlerbox: Die Vorab-Blöcke darüber sollen stehen bleiben, die Meldung
 * darunter darf aber nicht unter der Eingabezeile verschwinden.
 */
function insSichtfeld(knoten) {
  nachDemZeichnen(function () {
    if (!knoten.isConnected) return;
    const r = knoten.getBoundingClientRect();
    const oben = $("kopf").getBoundingClientRect().bottom;
    const eingabe = $("form-frage");
    const unten = eingabe && !eingabe.closest("[hidden]") ? eingabe.getBoundingClientRect().top : window.innerHeight;
    if (r.top >= oben && r.bottom <= unten) return;
    const passt = r.height <= unten - oben - 24;
    scrolleNach(window.pageYOffset + (passt ? r.bottom - unten + 12 : r.top - oben - 12));
  });
}

/**
 * Gemessene Höhen von Kopf und Eingabezeile als CSS-Variablen. Fest
 * angenommene 57 px stimmten auf dem Handy nicht (zweizeiliger Kopf), und
 * scroll-padding braucht die echte Höhe der klebenden Eingabe – sonst liegen
 * fokussierte Felder dahinter.
 */
function hoehenMerken() {
  const wurzel = document.documentElement.style;
  const kopf = $("kopf");
  const eingabe = $("form-frage");
  if (kopf) wurzel.setProperty("--kopf-h", kopf.offsetHeight + "px");
  if (eingabe && eingabe.offsetHeight) wurzel.setProperty("--eingabe-h", eingabe.offsetHeight + "px");
}

function hoehenBeobachten() {
  hoehenMerken();
  if (typeof window.ResizeObserver === "function") {
    const beobachter = new window.ResizeObserver(hoehenMerken);
    beobachter.observe($("kopf"));
    beobachter.observe($("form-frage"));
  } else {
    window.addEventListener("resize", hoehenMerken);
  }
}

/**
 * Den obersten sichtbaren Block merken (Typ und wievielter seiner Art), um
 * ihn nach dem Austausch Vorab → Antwort an derselben Bildschirmstelle zu
 * halten. Live sprang die Seite sonst mitten in der Zeitleiste nach oben.
 */
function ankerMerken(container) {
  const oben = $("kopf").getBoundingClientRect().bottom;
  const bloecke = container.querySelectorAll(".b-antwort > [data-block]");
  for (let i = 0; i < bloecke.length; i++) {
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
  const gleiche = Array.prototype.filter.call(container.querySelectorAll(".b-antwort > [data-block]"), function (b) {
    return b.getAttribute("data-block") === anker.typ;
  });
  const neu = gleiche[anker.n];
  if (neu) window.scrollBy(0, neu.getBoundingClientRect().top - anker.top);
}

function istZeigegeraet() {
  return !!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches);
}

function beschaeftigt(knopf, an, text) {
  if (an) {
    knopf.dataset.text = knopf.textContent;
    knopf.textContent = text || "Bitte warten …";
    knopf.disabled = true;
  } else {
    if (knopf.dataset.text) knopf.textContent = knopf.dataset.text;
    knopf.disabled = false;
  }
}

function zeige(id) {
  ["ansicht-laden", "ansicht-login", "ansicht-chat", "ansicht-wissen"].forEach(function (x) {
    $(x).hidden = x !== id;
  });
}

// --- Anmelden ----------------------------------------------------------------

function loginFehler(text) {
  $("login-fehler").textContent = text || "";
}

function zeigeLogin() {
  angemeldet = null;
  passcodeZwischen = "";
  $("nutzer").hidden = true;
  $("reiter").hidden = true;
  $("form-passcode").hidden = false;
  $("rollenwahl").hidden = true;
  zeige("ansicht-login");
  $("passcode").value = "";
  $("passcode").focus();
}

async function passcodeAbschicken(e) {
  e.preventDefault();
  const code = $("passcode").value.trim();
  if (!code) {
    loginFehler("Bitte den Passcode eingeben.");
    $("passcode").focus();
    return;
  }
  loginFehler("");
  const knopf = $("passcode-weiter");
  beschaeftigt(knopf, true, "Wird geprüft …");
  try {
    let r = await api.anmelden(code, null);
    if (!r.angemeldet && r.rollen.length === 1) r = await api.anmelden(code, r.rollen[0]);
    if (r.angemeldet) {
      $("passcode").value = "";
      zeigeApp(r);
      return;
    }
    passcodeZwischen = code;
    zeigeRollenwahl(r);
  } catch (err) {
    loginFehler(err && err.message ? err.message : "Anmelden fehlgeschlagen.");
    $("passcode").select();
  } finally {
    beschaeftigt(knopf, false);
  }
}

function zeigeRollenwahl(r) {
  $("form-passcode").hidden = true;
  $("rollenwahl").hidden = false;
  $("rollen-hallo").textContent = r.anzeigename ? "Zugang: " + r.anzeigename : "";
  const liste = leeren($("rollen-liste"));
  const rollen = r.rollen.slice().sort(function (a, b) {
    return (ROLLEN_RANG[a] || 9) - (ROLLEN_RANG[b] || 9);
  });
  rollen.forEach(function (rolle) {
    const knopf = el("button", { type: "button", class: "rollen-knopf" }, [
      el("span", { class: "rollen-name", text: ROLLEN_NAMEN[rolle] || rolle }),
      ROLLEN_TEXT[rolle] ? el("span", { class: "rollen-text", text: ROLLEN_TEXT[rolle] }) : null,
    ]);
    knopf.addEventListener("click", function () {
      rolleWaehlen(rolle, knopf);
    });
    liste.appendChild(knopf);
  });
  const erster = liste.querySelector("button");
  if (erster) erster.focus();
}

async function rolleWaehlen(rolle, knopf) {
  const alle = $("rollen-liste").querySelectorAll("button");
  alle.forEach(function (k) {
    k.disabled = true;
  });
  knopf.classList.add("rollen-knopf-laeuft");
  loginFehler("");
  try {
    const r = await api.anmelden(passcodeZwischen, rolle);
    if (!r.angemeldet) throw new Error("Anmelden mit dieser Rolle nicht möglich.");
    passcodeZwischen = "";
    $("passcode").value = "";
    zeigeApp(r);
  } catch (err) {
    loginFehler(err && err.message ? err.message : "Anmelden fehlgeschlagen.");
    alle.forEach(function (k) {
      k.disabled = false;
    });
    knopf.classList.remove("rollen-knopf-laeuft");
  }
}

function abmelden() {
  api.abmelden();
  // Neu laden statt Zustand von Hand zurückzusetzen: Eine noch laufende
  // Antwort, offene Formulare und Blob-URLs sind damit sicher weg.
  window.location.reload();
}

// --- App ---------------------------------------------------------------------

function zeigeApp(info) {
  angemeldet = info;
  document.body.setAttribute("data-rolle", info.rolle || "");
  $("nutzer").hidden = false;
  $("nutzer-rolle").textContent = ROLLEN_NAMEN[info.rolle] || info.rolle || "";
  $("nutzer-name").textContent = info.anzeigename || "";
  if (info.gueltig_bis) {
    const d = new Date(info.gueltig_bis);
    if (!isNaN(d.getTime())) $("nutzer").title = "Zugang gültig bis " + d.toLocaleDateString("de-DE");
  }
  $("reiter").hidden = info.rolle !== "meister";
  beispieleFuellen(info.rolle);
  zeigeFall(info.fall || null);
  zeigeBereich("fragen");
  hoehenMerken();
  // Auf dem Handy nicht sofort fokussieren: Das klappt die Tastatur auf und
  // verdeckt die Beispiele, bevor man sie gelesen hat.
  if (istZeigegeraet()) $("frage-text").focus();
}

function zeigeBereich(name) {
  const wissen = name === "wissen" && angemeldet && angemeldet.rolle === "meister";
  zeige(wissen ? "ansicht-wissen" : "ansicht-chat");
  $("reiter-fragen").setAttribute("aria-pressed", wissen ? "false" : "true");
  $("reiter-wissen").setAttribute("aria-pressed", wissen ? "true" : "false");
}

function beispieleFuellen(rolle) {
  const liste = leeren($("leer-beispiele"));
  const texte = BEISPIELE[rolle] || BEISPIELE[(ROLLEN_RANG[rolle] || 1) >= 2 ? "techniker" : "kundenbetreuer"];
  texte.forEach(function (t) {
    const knopf = el("button", { type: "button", class: "beispiel", text: t });
    knopf.addEventListener("click", function () {
      const feld = $("frage-text");
      feld.value = t;
      hoeheAnpassen();
      feld.focus();
    });
    liste.appendChild(el("li", null, knopf));
  });
}

// --- Laufender Fall ------------------------------------------------------------

/**
 * Über der Eingabe steht, welche Anlage sich die Sitzung merkt. Live 08.10.:
 * Wer das nicht sieht, schließt mit „Ticket kann zu“ das Ticket der zuletzt
 * genannten Anlage, und nach einem Reload baut die nächste Frage unsichtbar
 * auf dem alten Fall auf. „Neuer Fall“ leert die Sitzung und den Verlauf.
 */
function zeigeFall(f) {
  fall = f && f.anlage_id ? f : null;
  $("fall-zeile").hidden = !fall;
  $("fall-meldung").textContent = "";
  if (!fall) return;
  $("fall-anlage").textContent = fall.anlage_id;
  $("fall-kunde").textContent = fall.kunde_alias ? " · " + fall.kunde_alias : "";
}

function verlaufLeeren() {
  const verlauf = $("verlauf");
  Array.prototype.slice.call(verlauf.querySelectorAll(".runde")).forEach(function (r) {
    verlauf.removeChild(r);
  });
  const leer = $("leer");
  if (leer) leer.hidden = false;
}

async function neuerFall() {
  if (laeuft) return;
  const knopf = $("fall-neu");
  knopf.disabled = true;
  try {
    await api.aktion("fall_beenden", {});
    zeigeFall(null);
    verlaufLeeren();
    window.scrollTo(0, 0);
    if (istZeigegeraet()) $("frage-text").focus();
  } catch (err) {
    $("fall-meldung").textContent = "Neuer Fall nicht möglich: " + (err && err.message ? err.message : "unbekannter Fehler");
  } finally {
    knopf.disabled = false;
  }
}

// --- Chat --------------------------------------------------------------------

function hoeheAnpassen() {
  const feld = $("frage-text");
  feld.style.height = "auto";
  const max = Math.round(window.innerHeight * 0.4);
  feld.style.height = Math.min(feld.scrollHeight + 2, max) + "px";
}

function setzeLaeuft(an) {
  laeuft = an;
  $("frage-senden").disabled = an;
  $("form-frage").setAttribute("aria-busy", an ? "true" : "false");
}

function antwortCtx() {
  return {
    rolle: angemeldet ? angemeldet.rolle : null,
    onAktion: function (item) {
      return api.aktion(item.action, item.payload || {}).then(function (r) {
        return r && r.bestaetigung ? r.bestaetigung : null;
      });
    },
    onAntworten: function (text) {
      return sende(text);
    },
    ladeBild: api.ladeBild,
  };
}

/**
 * Frage absenden. Gibt false zurück, wenn gerade eine Antwort läuft oder der
 * Text leer ist – dann passiert nichts (Doppel-Senden, auch über die
 * Rückfrage-Chips). Sonst true; der Ablauf läuft asynchron weiter.
 */
function sende(text) {
  const t = String(text || "").trim();
  if (!t || laeuft || !angemeldet) return false;
  setzeLaeuft(true);
  runde(t).then(null, function (e) {
    console.error("Unerwarteter Fehler im Ablauf:", e);
  }).then(function () {
    setzeLaeuft(false);
  });
  return true;
}

async function runde(text) {
  const leer = $("leer");
  if (leer) leer.hidden = true;
  const verlauf = $("verlauf");
  const vorige = verlauf.querySelector(".runde-letzte");
  if (vorige) vorige.classList.remove("runde-letzte");

  const frageEl = el("div", { class: "msg-frage" }, [
    el("span", { class: "unsichtbar", text: "Deine Frage: " }),
    el("p", { class: "msg-frage-text", text: text }),
  ]);
  const vorabEl = el("div", { class: "vorab", hidden: true });
  const spur = el("ol", { class: "spur", "aria-label": "Fortschritt", "aria-live": "polite" });
  const fehlerEl = el("div", { class: "fehlerbox", role: "alert", hidden: true });
  // Die Spur steht ÜBER den Vorab-Blöcken: Darunter lag „Frage geht an das
  // Modell · 10 s“ live unterhalb des Sichtfelds, und 10 bis 20 s bewegte
  // sich scheinbar nichts. Sobald Vorab-Blöcke da sind, schrumpfen die
  // erledigten Schritte auf eine Zeile, der laufende bleibt sichtbar.
  const antwortEl = el("article", { class: "antwort", "aria-busy": "true", "aria-label": "Antwort" }, [
    spur,
    vorabEl,
    fehlerEl,
  ]);
  const rundeEl = el("div", { class: "runde runde-letzte" }, [frageEl, antwortEl]);
  verlauf.appendChild(rundeEl);
  zumAnfang(frageEl);

  // Fortschrittsspur: nur, was wirklich passiert. Der erste Schritt ist der
  // einzige vom Browser selbst – abgeschickt ist die Anfrage ja wirklich.
  const start = Date.now();
  let aktiv = null;
  const erledigt = [];
  const summe = el("li", { class: "spur-fertig spur-summe", hidden: true });
  spur.appendChild(summe);
  function schritt(text) {
    if (aktiv) {
      aktiv.classList.remove("spur-aktiv");
      aktiv.classList.add("spur-fertig");
      const z = aktiv.querySelector(".spur-zeit");
      if (z) aktiv.removeChild(z);
      erledigt.push(aktiv.textContent);
      summe.textContent = (erledigt.length === 1 ? "1 Schritt" : erledigt.length + " Schritte") + " erledigt";
      summe.title = erledigt.join(" · ");
    }
    aktiv = el("li", { class: "spur-aktiv" }, [
      el("span", { class: "spur-text", text: typo(text) }),
      el("span", { class: "spur-zeit", "aria-hidden": "true" }),
    ]);
    spur.appendChild(aktiv);
  }
  schritt("Anfrage gesendet");
  const uhr = window.setInterval(function () {
    const z = aktiv && aktiv.querySelector(".spur-zeit");
    const s = Math.floor((Date.now() - start) / 1000);
    if (z && s >= 3) z.textContent = " · " + s + " s";
  }, 1000);

  let vorabHinweis = null;
  // Hat der Nutzer während der Wartezeit selbst gescrollt (etwa zur
  // Zeitleiste), bleibt sein Ausschnitt stehen, statt an den Antwortanfang zu
  // springen. Nur echte Eingaben zählen, nicht das eigene Scrollen.
  let nutzerScrollt = false;
  const merke = function () {
    nutzerScrollt = true;
  };
  const tasten = function (e) {
    const ziel = e.target && e.target.tagName;
    if (ziel === "INPUT" || ziel === "TEXTAREA" || ziel === "SELECT") return;
    if (["PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End", " "].indexOf(e.key) !== -1) nutzerScrollt = true;
  };
  window.addEventListener("wheel", merke, { passive: true });
  window.addEventListener("touchmove", merke, { passive: true });
  window.addEventListener("keydown", tasten);

  await api.frage(text, function (ev) {
    if (ev.t === "fortschritt") {
      if (ev.text) schritt(String(ev.text));
    } else if (ev.t === "vorab") {
      leeren(vorabEl);
      vorabHinweis = el("span", { text: " – die Antwort des Assistenten folgt." });
      vorabEl.appendChild(el("p", { class: "vorab-hinweis" }, ["Sofort aus der Datenbank", vorabHinweis]));
      vorabEl.appendChild(renderAntwort({ blocks: Array.isArray(ev.blocks) ? ev.blocks : [] }, antwortCtx()));
      vorabEl.hidden = false;
      spur.classList.add("spur-kurz");
      summe.hidden = erledigt.length === 0;
    } else if (ev.t === "antwort") {
      const anker = nutzerScrollt ? ankerMerken(antwortEl) : null;
      leeren(antwortEl);
      antwortEl.removeAttribute("aria-busy");
      antwortEl.appendChild(renderAntwort(ev.antwort, antwortCtx()));
      const meta = metaZeile(ev.meta);
      if (meta) antwortEl.appendChild(meta);
      if (ev.meta && Object.prototype.hasOwnProperty.call(ev.meta, "fall")) zeigeFall(ev.meta.fall);
      if (anker) ankerHalten(antwortEl, anker);
      else if (!nutzerScrollt) zumAnfang(antwortEl);
    } else if (ev.t === "fehler") {
      spur.hidden = true;
      antwortEl.removeAttribute("aria-busy");
      if (vorabHinweis) vorabHinweis.textContent = " – diese Daten sind gültig.";
      zeigeFehler(fehlerEl, ev, text);
      insSichtfeld(fehlerEl);
    }
  });
  window.clearInterval(uhr);
  window.removeEventListener("wheel", merke);
  window.removeEventListener("touchmove", merke);
  window.removeEventListener("keydown", tasten);
}

function metaZeile(meta) {
  if (!meta || typeof meta !== "object") return null;
  const teile = [];
  if (PFAD_TEXT[meta.pfad]) teile.push(PFAD_TEXT[meta.pfad]);
  if (typeof meta.latenz_ms === "number") {
    teile.push("Antwort nach " + zahl(Math.round(meta.latenz_ms / 100) / 10) + " s");
  }
  if (Array.isArray(meta.regeltreffer) && meta.regeltreffer.length) {
    teile.push("Regeln: " + meta.regeltreffer.join(", "));
  }
  return teile.length ? el("p", { class: "antwort-meta", text: teile.join(" · ") }) : null;
}

function zeigeFehler(box, ev, text) {
  leeren(box);
  box.hidden = false;
  const code = ev.code || "fehler";
  box.appendChild(el("p", { class: "fehlerbox-titel", text: FEHLER_TITEL[code] || "Das hat nicht geklappt" }));
  box.appendChild(el("p", { class: "fehlerbox-text", text: ev.text || "Unbekannter Fehler." }));
  const knoepfe = el("div", { class: "fehlerbox-knoepfe" });
  if (code === "sitzung") {
    const k = el("button", { type: "button", class: "knopf knopf-primaer", text: "Neu anmelden" });
    k.addEventListener("click", abmelden);
    knoepfe.appendChild(k);
  } else if (code !== "deckel" && code !== "konfiguration") {
    const k = el("button", { type: "button", class: "knopf knopf-sekundaer", text: "Erneut senden" });
    k.addEventListener("click", function () {
      if (sende(text)) k.disabled = true;
    });
    knoepfe.appendChild(k);
  }
  if (knoepfe.childNodes.length) box.appendChild(knoepfe);
}

// --- Wissen erfassen ---------------------------------------------------------

const NOTIZ_FELDER = [
  { key: "geraet", label: "Gerät", lang: false },
  { key: "hersteller", label: "Hersteller", lang: false },
  { key: "modell_serie", label: "Modell / Serie", lang: false },
  { key: "fehlerbild", label: "Fehlerbild", lang: true },
  { key: "ursache", label: "Ursache", lang: true },
  { key: "loesung", label: "Lösung", lang: true },
];

/**
 * Getippt oder diktiert? Das Betriebssystem-Diktat fügt ganze Wörter und
 * Sätze in einem Rutsch ein, Tippen ein Zeichen je Ereignis. Mehr braucht es
 * nicht, um `quelle` ehrlich zu füllen (SPEC 7: 'diktat' | 'text') – eine
 * eigene Audioaufnahme ist bewusst gestrichen (Plan, P0-9).
 */
const eingabeArt = { diktiert: 0, getippt: 0 };

function notizStatus(text) {
  $("notiz-status").textContent = text || "";
}

async function strukturieren(e) {
  e.preventDefault();
  const text = $("notiz-text").value.trim();
  if (text.length < 20) {
    notizStatus("Bitte etwas ausführlicher: Gerät, Fehlerbild, Ursache und Lösung in ein paar Sätzen.");
    $("notiz-text").focus();
    return;
  }
  notizStatus("");
  const knopf = $("notiz-strukturieren");
  beschaeftigt(knopf, true, "Wird strukturiert …");
  try {
    const r = await api.notiz("strukturieren", { text: text });
    const karte = r && (r.karte || r.notiz) ? r.karte || r.notiz : r;
    zeigeNotizKarte(karte || {}, eingabeArt.diktiert > eingabeArt.getippt ? "diktat" : "text");
  } catch (err) {
    notizStatus(err && err.message ? err.message : "Strukturieren fehlgeschlagen.");
  } finally {
    beschaeftigt(knopf, false);
  }
}

function vereinfacht(s) {
  return String(s).toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
}

/** Welche Felder nennt die unklar-Liste? Über Schlüssel oder Bezeichnung. */
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
 * Editierbare Freigabe-Karte. Editierbar ist der Kern, kein Trostpflaster:
 * Wenn das Diktat „Schnellentlüfter“ verreißt und der Meister es sichtbar
 * korrigiert, ist das die beste Antwort auf „Wie bleibt die Datenbank
 * aktuell?“ (Plan Pos. 12).
 */
function zeigeNotizKarte(karte, quelle) {
  const ziel = leeren($("notiz-karte"));
  const unklar = Array.isArray(karte.unklar) ? karte.unklar.filter(Boolean).map(String) : [];
  const markiert = unklareFelder(unklar);
  const eingaben = {};

  const formular = el("form", { class: "notizkarte", novalidate: true, "aria-labelledby": "notizkarte-titel" });
  formular.appendChild(el("h2", { class: "notizkarte-titel", id: "notizkarte-titel", text: "So habe ich dich verstanden" }));
  formular.appendChild(
    el("p", { class: "notizkarte-text", text: "Bitte prüfen und korrigieren. Freigegeben wird genau das, was hier steht." }),
  );
  if (unklar.length) {
    formular.appendChild(
      el("div", { class: "unklar-box" }, [
        el("p", { class: "unklar-titel", text: "Unklare Punkte" }),
        el("ul", null, unklar.map(function (u) {
          return el("li", { text: u });
        })),
      ]),
    );
  }

  const raster = el("div", { class: "notizkarte-felder" });
  NOTIZ_FELDER.forEach(function (f) {
    const wert = karte[f.key] === null || karte[f.key] === undefined ? "" : String(karte[f.key]);
    const id = "nk-" + f.key;
    // Dieselben Grenzen wie notizFreigabeBereinigen (800 bzw. 80 Zeichen):
    // Was hier passt, kommt auf dem Server ungekürzt an.
    const feld = f.lang
      ? el("textarea", { class: "feld", id: id, rows: "3", maxlength: "800" })
      : el("input", { class: "feld", id: id, type: "text", maxlength: "80", autocomplete: "off" });
    feld.value = wert;
    eingaben[f.key] = feld;
    const istUnklar = !!markiert[f.key];
    const fehlt = !wert.trim();
    const marke = istUnklar
      ? el("span", { class: "feld-marke feld-marke-unklar", text: "unklar" })
      : fehlt
      ? el("span", { class: "feld-marke", text: "nicht genannt" })
      : null;
    raster.appendChild(
      el("div", { class: "notizfeld" + (f.lang ? " notizfeld-lang" : "") + (istUnklar ? " notizfeld-unklar" : "") }, [
        el("label", { class: "feld-label", for: id }, [f.label, marke ? " " : null, marke]),
        feld,
      ]),
    );
  });
  formular.appendChild(raster);

  formular.appendChild(
    el("p", {
      class: "notizkarte-quelle",
      text: "Erfasst per " + (quelle === "diktat" ? "Diktat" : "Texteingabe") +
        (angemeldet && angemeldet.anzeigename ? " · Autor: " + angemeldet.anzeigename : ""),
    }),
  );

  const freigeben = el("button", { type: "submit", class: "knopf knopf-primaer", text: "Freigeben" });
  const verwerfen = el("button", { type: "button", class: "knopf knopf-leise", text: "Verwerfen" });
  const status = el("p", { class: "formular-status", role: "status" });
  formular.appendChild(el("div", { class: "formular-knoepfe" }, [freigeben, verwerfen]));
  formular.appendChild(status);

  verwerfen.addEventListener("click", function () {
    leeren(ziel);
    $("notiz-text").focus();
  });

  formular.addEventListener("submit", async function (e) {
    e.preventDefault();
    const notiz = {};
    NOTIZ_FELDER.forEach(function (f) {
      const v = eingaben[f.key].value.trim();
      notiz[f.key] = v ? v : null;
    });
    // Dieselbe Pflicht wie in der Function notiz (notizFreigabeBereinigen):
    // Fehlerbild und Lösung. Eine Notiz ohne Lösung ist als Quelle wertlos –
    // und eine Prüfung, die hier lockerer ist als auf dem Server, endete erst
    // nach dem Klick auf „Freigeben“ in einer Fehlermeldung.
    if (!notiz.fehlerbild || !notiz.loesung) {
      status.textContent = "Bitte mindestens Fehlerbild und Lösung ausfüllen.";
      (notiz.fehlerbild ? eingaben.loesung : eingaben.fehlerbild).focus();
      return;
    }
    status.textContent = "";
    beschaeftigt(freigeben, true, "Wird freigegeben …");
    verwerfen.disabled = true;
    try {
      const r = await api.notiz("freigeben", { notiz: notiz, quelle: quelle });
      zeigeFreigabe(r && r.kuerzel ? String(r.kuerzel) : "");
    } catch (err) {
      status.textContent = err && err.message ? err.message : "Freigeben fehlgeschlagen.";
      beschaeftigt(freigeben, false);
      verwerfen.disabled = false;
    }
  });

  ziel.appendChild(formular);
  zumAnfang(formular);
  const erstesUnklar = formular.querySelector(".notizfeld-unklar .feld");
  if (erstesUnklar && istZeigegeraet()) erstesUnklar.focus();
}

function zeigeFreigabe(kuerzel) {
  const ziel = leeren($("notiz-karte"));
  $("notiz-text").value = "";
  eingabeArt.diktiert = 0;
  eingabeArt.getippt = 0;
  const weiter = el("button", { type: "button", class: "knopf knopf-sekundaer", text: "Weitere Notiz erfassen" });
  const zuFragen = el("button", { type: "button", class: "knopf knopf-primaer", text: "Zu den Fragen" });
  weiter.addEventListener("click", function () {
    leeren(ziel);
    $("notiz-text").focus();
  });
  zuFragen.addEventListener("click", function () {
    zeigeBereich("fragen");
    $("frage-text").focus();
  });
  const box = el("div", { class: "notiz-erfolg", role: "status" }, [
    el("p", { class: "notiz-erfolg-titel", text: (kuerzel || "Die Notiz") + " ist ab jetzt Quelle." }),
    el("p", { text: "Die nächste Antwort im Bereich „Fragen“ kann sie zitieren." }),
    el("div", { class: "formular-knoepfe" }, [zuFragen, weiter]),
  ]);
  ziel.appendChild(box);
  zumAnfang(box);
}

// --- Verdrahten und Start ----------------------------------------------------

function verdrahten() {
  $("form-passcode").addEventListener("submit", passcodeAbschicken);
  $("rolle-zurueck").addEventListener("click", zeigeLogin);
  $("abmelden").addEventListener("click", abmelden);
  $("fall-neu").addEventListener("click", neuerFall);
  $("reiter-fragen").addEventListener("click", function () {
    zeigeBereich("fragen");
  });
  $("reiter-wissen").addEventListener("click", function () {
    zeigeBereich("wissen");
  });

  const feld = $("frage-text");
  $("form-frage").addEventListener("submit", function (e) {
    e.preventDefault();
    if (sende(feld.value)) {
      feld.value = "";
      hoeheAnpassen();
    }
  });
  feld.addEventListener("keydown", function (e) {
    // isComposing/229: Bei Eingabehilfen (z. B. Akzente, IME) bestätigt
    // Enter die Komposition – das darf nicht absenden.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      if (sende(feld.value)) {
        feld.value = "";
        hoeheAnpassen();
      }
    }
  });
  feld.addEventListener("input", hoeheAnpassen);

  $("form-notiz").addEventListener("submit", strukturieren);
  $("notiz-text").addEventListener("input", function (e) {
    const n = typeof e.data === "string" ? e.data.length : 0;
    if (e.inputType === "insertFromDictation" || ((e.inputType === "insertText" || e.inputType === "insertReplacementText") && n > 3)) {
      eingabeArt.diktiert += Math.max(n, 1);
    } else if (n > 0) {
      eingabeArt.getippt += n;
    }
  });
}

async function start() {
  if (api.istMock) {
    // Im Mock-Modus sichtbar sagen, dass nichts davon vom Server kommt – eine
    // Attrappe, die nicht als Attrappe erkennbar ist, ist genau das, was die
    // Demo nie zeigen darf (Plan Pos. 16).
    $("banner-zusatz").textContent = " · Offline-Modus (Mock), Antworten vorbereitet";
    document.title = document.title + " (Mock)";
  }
  verdrahten();
  hoehenBeobachten();
  let info = null;
  try {
    info = await api.sitzung();
  } catch (e) {
    info = null;
  }
  if (info && info.rolle) zeigeApp(info);
  else zeigeLogin();
}

start();
