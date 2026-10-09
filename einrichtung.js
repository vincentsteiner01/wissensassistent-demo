// ============================================================================
// einrichtung.js  ·  Einrichtung als Assistent (SPEC 13.3.11, nur Admin) [FA]
// ----------------------------------------------------------------------------
//   zeigeEinrichtung(container, ctx)   #/einrichtung
//
// Sechs Schritte: Logo und Name · Markenfarbe · Vorschau prüfen · Datenquellen
// (folgt) · Team & Zugänge (folgt) · Regeln & Freigaben (folgt). Die drei
// „folgt“-Schritte beantworten nebenbei die Frage des Interessenten nach dem
// Zendesk-Anschluss: Er ist eingeplant, nicht vergessen.
//
// Warum die Farben vom Server kommen: Eine Markenfarbe ist erst brauchbar,
// wenn Text darauf, Linien daneben und Markierungen darunter WCAG AA
// schaffen. Das rechnet _shared/branding.ts einmal richtig (21 Variablen als
// vorberechnetes Hex, Technik aus Entwurf C) – hier wird nur angezeigt und
// verglichen. color-mix im Browser könnte keinen Kontrast garantieren.
//
// Die Live-Vorschau setzt die Kandidaten-Variablen NUR auf ihren Container
// und baut echte Bausteine über ctx.bloecke.renderBlock – was hier richtig
// aussieht, sieht in der App genauso aus. Stopp bleibt rot, Nutzer-Blasen
// bleiben grau, egal welche Marke.
//
// Logo: nur als <img src="data:…"> (SPEC 12.6), nie inline als SVG, nie als HTML-Text.
// ============================================================================
import { h, leeren, typo, zahl } from "./dom.js";
import { einblenden, ruhig } from "./bewegung.js";
import { ikon } from "./ikonen.js";
import { beschaeftigt, feldGruppe, fehlerText, rechteVon, seitenKopf } from "./abgeben.js";

const VORSCHLAEGE = [
  { hex: "#1F5FAE", name: "Blau (Start)" },
  { hex: "#0F7B6C", name: "Petrol" },
  { hex: "#2E7D32", name: "Grün" },
  { hex: "#E0A800", name: "Gelb" },
  { hex: "#E8590C", name: "Orange" },
  { hex: "#C62828", name: "Rot" },
];

const STUFEN = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"];
const VARIABLE_OK = /^--(marke(-[a-z0-9]+)*|auf-marke)$/;
const HEX_OK = /^#[0-9A-F]{6}$/;
const MAX_LOGO = 300000;
const LOGO_TYPEN = /^data:image\/(png|svg\+xml|webp|jpeg);base64,/;

const SCHRITTE = [
  { nr: 1, titel: "Logo und Name" },
  { nr: 2, titel: "Markenfarbe" },
  { nr: 3, titel: "Vorschau prüfen" },
  { nr: 4, titel: "Datenquellen", folgt: true, symbol: "datenbank",
    text: "Anlagen und Tickets lesend aus eurem Ticketsystem, zum Beispiel Zendesk. In der Demo liegen fiktive Daten." },
  { nr: 5, titel: "Team & Zugänge", folgt: true, symbol: "team",
    text: "Ein Zugang je Mitarbeiter mit Rolle. Heute per Passcode." },
  { nr: 6, titel: "Regeln & Freigaben", folgt: true, symbol: "regel",
    text: "Regelwerk R01–R10 fachlich freigeben. Heute als Entwurf markiert." },
];

// --- Kontrast (WCAG 2.x), nur zur Anzeige; entscheiden tut branding.ts ---------------

function leuchtdichte(hex) {
  const k = [1, 3, 5].map(function (i) {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2];
}

function kontrast(a, b) {
  if (!HEX_OK.test(a) || !HEX_OK.test(b)) return 0;
  const la = leuchtdichte(a);
  const lb = leuchtdichte(b);
  return Math.floor((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05) * 100) / 100;
}

function verhaeltnis(n) {
  // Ohne Leerzeichen um den Doppelpunkt – so schreibt es auch branding.ts in den Hinweisen.
  return zahl(Math.floor(n * 10) / 10, 1) + ":1";
}

/**
 * Markenschrift auf der ungünstigsten hellen Fläche, auf der sie stehen kann:
 * #F2F2F7 und die getönten Markenflächen (Zitat-Leuchten, Hover, Login).
 * Gegen #F2F2F7 allein zeigte die Einrichtung bei Gelb „4,6:1 ✓“, obwohl
 * dieselbe Schrift auf --marke-flaeche-2 nur 4,3:1 hatte.
 */
function schriftKontrast(vars, hex) {
  const schrift = vars["--marke-text"] || hex;
  const flaechen = ["#F2F2F7", vars["--marke-flaeche"], vars["--marke-flaeche-2"], vars["--marke-100"]].filter(function (f) {
    return HEX_OK.test(String(f || ""));
  });
  return Math.min.apply(null, flaechen.map(function (f) { return kontrast(schrift, f); }));
}

/** 21 Variablen aus farben; ohne `variablen` (alter Server) die vier sicheren aus SPEC 12.1. */
function variablenAus(farben) {
  const f = farben || {};
  const aus = {};
  if (f.variablen && typeof f.variablen === "object") {
    Object.keys(f.variablen).forEach(function (k) {
      const v = String(f.variablen[k] || "").toUpperCase();
      if (VARIABLE_OK.test(k) && HEX_OK.test(v)) aus[k] = v;
    });
  }
  function setze(k, v) {
    const w = String(v || "").toUpperCase();
    if (!aus[k] && HEX_OK.test(w)) aus[k] = w;
  }
  setze("--marke", f.primaer);
  setze("--marke-knopf", f.primaer);
  setze("--auf-marke", f.text_auf_primaer);
  setze("--marke-text", f.akzent_auf_hell);
  setze("--marke-text-dunkel", f.akzent_auf_dunkel);
  return aus;
}

function varsSetzen(el, vars) {
  Object.keys(vars).forEach(function (k) { el.style.setProperty(k, vars[k]); });
}

function hexNormal(roh) {
  let s = String(roh || "").trim().toUpperCase();
  if (/^[0-9A-F]{6}$/.test(s)) s = "#" + s;
  if (/^#[0-9A-F]{3}$/.test(s)) s = "#" + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2) + s.charAt(3) + s.charAt(3);
  return HEX_OK.test(s) ? s : "";
}

// --- Fiktive Beispielblöcke für die Vorschau (Drahtformat 5.1) --------------------------

const BEISPIEL_FRAGEN = {
  type: "fragebaum",
  start: "ventil",
  knoten: [
    { id: "ventil", kurz: "Ventil", frage: "Tropft es am Sicherheitsventil?",
      antworten: [{ label: "tropft", weiter: "fertig" }, { label: "trocken", weiter: "fertig" }, { label: "weiß nicht", weiter: "fertig" }], freitext_weiter: "" },
  ],
};
const BEISPIEL_URSACHEN = {
  type: "causes",
  symptom_kategorie: "wp_druckverlust",
  items: [
    { key: "ausdehnungsgefaess_vordruck", title: "Vordruck am Ausdehnungsgefäß prüfen",
      why: "Das Ventil ist trocken.", check: "Vordruck am Ventil des Gefäßes messen.",
      evidence: { similar_cases: 11, matching: 7 }, source_ids: ["MN-07"] },
    { key: "sicherheitsventil_undicht", title: "Sicherheitsventil beobachten",
      why: "Manche Ventile öffnen nur kurz.", check: "Ablauf nach dem Heizen prüfen.",
      evidence: { similar_cases: 11, matching: 3 }, source_ids: ["MN-04"] },
  ],
};
const BEISPIEL_STOPP = {
  type: "warning", level: "stop", rule_id: "R01", entwurf: true,
  title: "Keine größere Sicherung als Abhilfe",
  content: "Der Leitungsschutzschalter schützt die Leitung. Größer gesetzt, kann sie überlasten, ohne dass etwas auslöst.",
  alternative: "Ursache des Auslösens suchen: Stromkreis, Verbraucher, Querschnitt.",
};

// --- Bildschirm ---------------------------------------------------------------------

export function zeigeEinrichtung(container, ctx) {
  const r = rechteVon(ctx);
  let weg = false;
  const seite = h("div", { class: "ab-seite ab-seite-breit ei-seite" });
  seite.appendChild(seitenKopf(ctx, {
    titel: "Einrichtung",
    satz: "Logo und eine Farbe – den Rest leitet das System ab, Stopp bleibt rot.",
  }));
  container.appendChild(seite);

  if (!r.einrichtung) {
    seite.appendChild(h("div", { class: "karte ab-karte leer" }, ikon("schild", { groesse: 28 }),
      h("p", { text: "Die Einrichtung ist dem Admin-Zugang vorbehalten." })));
    return { titel: "Einrichtung" };
  }

  // --- Zustand: gespeichert (Basis) und Entwurf ------------------------------------
  const start = (ctx.branding && ctx.branding.branding) || {};
  let basis = {
    firmenname: String(start.firmenname || ""),
    untertitel: start.untertitel ? String(start.untertitel) : "",
    primaerfarbe: hexNormal(start.primaerfarbe) || "#1F5FAE",
    logo_data_url: start.logo_data_url && LOGO_TYPEN.test(start.logo_data_url) ? String(start.logo_data_url) : null,
  };
  let entwurf = Object.assign({}, basis);
  let farben = (ctx.branding && ctx.branding.farben) || null;
  let farbenFuer = farben && farben.primaer ? hexNormal(farben.primaer) : "";
  let anfrageNr = 0;
  let entprellung = null;
  let aktiv = 1;

  // --- Gerüst: Schrittleiste · Inhalt · Vorschau ---------------------------------------
  const raster = h("div", { class: "ei-raster" });
  const schrittListe = h("ol", { class: "ei-schritte", "aria-label": "Schritte der Einrichtung" });
  const inhalt = h("div", { class: "ei-inhalt" });
  const vorschau = h("aside", { class: "ei-vorschau", "aria-label": "Live-Vorschau" });
  raster.appendChild(h("nav", { class: "ei-nav", "aria-label": "Einrichtung" }, schrittListe));
  raster.appendChild(inhalt);
  raster.appendChild(vorschau);
  seite.appendChild(raster);

  const leisteText = h("p", { class: "ei-leiste-text" });
  const zuruecksetzen = h("button", { type: "button", class: "knopf knopf-rand" }, "Zurücksetzen");
  const uebernehmen = h("button", { type: "button", class: "knopf knopf-primaer" }, ikon("haken", { groesse: 16 }), "Übernehmen");
  const leisteStatus = h("p", { class: "ab-status ei-leiste-status", role: "alert" });
  seite.appendChild(h("div", { class: "leiste-unten ei-leiste" },
    h("span", { class: "ei-leiste-symbol" }, ikon("team", { groesse: 18 })),
    leisteText, leisteStatus, zuruecksetzen, uebernehmen));

  SCHRITTE.forEach(function (s) {
    const knopf = h("button", {
      type: "button", class: "ei-schritt", "data-nr": String(s.nr),
      onclick: function () { schrittZeigen(s.nr, true); },
    },
    h("span", { class: "ei-schritt-nr", text: String(s.nr) }),
    h("span", { class: "ei-schritt-titel", text: s.titel }),
    s.folgt ? h("span", { class: "pille pille-neutral ei-folgt", text: "folgt" }) : null);
    schrittListe.appendChild(h("li", null, knopf));
  });

  // --- Vorschau ---------------------------------------------------------------------
  const buehne = h("div", { class: "ei-buehne", inert: true });
  const vorschauLogo = h("div", { class: "ei-vk-logo" });
  const vorschauName = h("p", { class: "ei-vk-name" });
  const vorschauUnter = h("p", { class: "ei-vk-unter" });
  vorschau.appendChild(h("div", { class: "ei-vorschau-kopf" },
    h("h2", { class: "ab-h2", text: "Live-Vorschau" }),
    h("span", { class: "ei-live" }, h("span", { class: "ei-live-punkt", "aria-hidden": "true" }), "live")));
  vorschau.appendChild(buehne);
  vorschau.appendChild(h("p", { class: "ei-vorschau-fuss", text: "Echte Bausteine der App. Ändert sich mit jeder Eingabe, gespeichert wird erst mit „Übernehmen“." }));

  const bctx = {
    rolle: ctx.rolle || "kundenbetreuer",
    pfad: "modell",
    akteDaneben: true,
    rueckfrageTasten: false,
    onAntworten: function () {},
    onAktion: function () { return Promise.resolve(null); },
    ladeBild: function () { return Promise.reject(new Error("Vorschau")); },
    ladeSeitenbild: function () { return Promise.reject(new Error("Vorschau")); },
    oeffneAkte: function () {},
    oeffneQuelle: function () {},
  };
  function block(b) {
    try {
      return ctx.bloecke && typeof ctx.bloecke.renderBlock === "function" ? ctx.bloecke.renderBlock(b, bctx) : null;
    } catch (e) {
      console.error("Vorschau-Baustein nicht darstellbar:", e);
      return null;
    }
  }
  buehne.appendChild(h("div", { class: "ei-vk-kopf" },
    vorschauLogo,
    h("div", { class: "ei-vk-text" }, vorschauName, vorschauUnter),
    h("span", { class: "ei-vk-avatar", text: "SH" })));
  // Dieselben Bausteine wie im Chat (SPEC 14.3.5): Stopp-Karte, Fragebaum, Lösungen.
  buehne.appendChild(h("div", { class: "ei-vk-chat" },
    h("div", { class: "ei-vk-blase" },
      h("p", { text: "Frau Petersen ruft an, ihre Wärmepumpe ist wieder in Störung. Anlage A-1042." })),
    h("div", { class: "ei-vk-antwort" },
      block(BEISPIEL_STOPP),
      block(BEISPIEL_FRAGEN),
      block(BEISPIEL_URSACHEN))));

  function logoBild(klasse) {
    return entwurf.logo_data_url
      ? h("img", { class: klasse, src: entwurf.logo_data_url, alt: entwurf.firmenname || "Logo" })
      : h("span", { class: klasse + " ei-logo-ohne", "aria-hidden": "true", text: monogramm(entwurf.firmenname) });
  }

  function vorschauNeu() {
    leeren(vorschauLogo);
    vorschauLogo.appendChild(logoBild("ei-vk-logo-bild"));
    vorschauName.textContent = entwurf.firmenname || "Firmenname";
    vorschauUnter.textContent = entwurf.untertitel || "";
    vorschauUnter.hidden = !entwurf.untertitel;
    varsSetzen(buehne, variablenAus(farben));
    leisteText.textContent = "Gilt nach „Übernehmen“ für alle Zugänge von " + (entwurf.firmenname || "eurem Betrieb") +
      ". Eine Instanz je Betrieb – eure Daten bleiben in eurem Projekt.";
    const geaendert = aenderungen();
    uebernehmen.disabled = !Object.keys(geaendert).length;
    zuruecksetzen.disabled = !Object.keys(geaendert).length;
  }

  function aenderungen() {
    const d = {};
    if (entwurf.firmenname.trim() !== basis.firmenname) d.firmenname = entwurf.firmenname.trim();
    if ((entwurf.untertitel || "").trim() !== (basis.untertitel || "")) d.untertitel = entwurf.untertitel.trim() ? entwurf.untertitel.trim() : null;
    if (entwurf.primaerfarbe !== basis.primaerfarbe) d.primaerfarbe = entwurf.primaerfarbe;
    if (entwurf.logo_data_url !== basis.logo_data_url) d.logo_data_url = entwurf.logo_data_url;
    return d;
  }

  // --- Farben holen (entprellt, veraltete Antworten verwerfen) ----------------------
  const farbBereich = { meldung: null, nachFarben: [] };
  function farbeAnfragen(hex) {
    clearTimeout(entprellung);
    entprellung = setTimeout(function () {
      const nr = ++anfrageNr;
      ctx.api.einrichtungFarben(hex).then(function (antwort) {
        if (weg || nr !== anfrageNr) return; // eine neuere Farbe ist schon unterwegs
        farben = antwort.farben || null;
        farbenFuer = hex;
        vorschauNeu();
        farbBereich.nachFarben.forEach(function (fn) { fn(); });
      }, function (err) {
        if (weg || nr !== anfrageNr) return;
        if (farbBereich.meldung) farbBereich.meldung.textContent = fehlerText(err, "Die Farbe konnte nicht berechnet werden.");
      });
    }, 250);
  }

  function farbeSetzen(hex, quelle) {
    const n = hexNormal(hex);
    if (!n) return;
    entwurf.primaerfarbe = n;
    vorschauNeu();
    farbBereich.nachFarben.forEach(function (fn) { fn(quelle); });
    if (n !== farbenFuer) farbeAnfragen(n);
  }

  // --- Schritte ---------------------------------------------------------------------
  function schrittZeigen(nr, mitFokus) {
    aktiv = nr;
    Array.prototype.forEach.call(schrittListe.querySelectorAll(".ei-schritt"), function (b) {
      const an = b.getAttribute("data-nr") === String(nr);
      if (an) b.setAttribute("aria-current", "step");
      else b.removeAttribute("aria-current");
    });
    farbBereich.nachFarben = [];
    farbBereich.meldung = null;
    leeren(inhalt);
    const s = SCHRITTE[nr - 1];
    const panel = h("section", { class: "karte ab-karte ei-panel", "aria-labelledby": "ei-panel-titel" },
      h("p", { class: "ei-panel-kicker" },
        h("span", { class: "ei-panel-nr", text: String(nr) }),
        h("span", { text: "Schritt " + nr + " von " + SCHRITTE.length })),
      h("h2", { class: "titel-serif ei-panel-titel", id: "ei-panel-titel", tabindex: "-1", text: s.titel }));
    if (nr === 1) panelLogo(panel);
    else if (nr === 2) panelFarbe(panel);
    else if (nr === 3) panelPruefen(panel);
    else panelFolgt(panel, s);
    const zurueck = nr > 1 ? h("button", { type: "button", class: "knopf knopf-leise", onclick: function () { schrittZeigen(nr - 1, true); } }, ikon("zurueck", { groesse: 16 }), "Zurück") : h("span");
    const weiter = nr < SCHRITTE.length ? h("button", { type: "button", class: "knopf knopf-rand", onclick: function () { schrittZeigen(nr + 1, true); } }, "Weiter", ikon("weiter", { groesse: 16 })) : null;
    panel.appendChild(h("div", { class: "ei-panel-fuss" }, zurueck, weiter));
    inhalt.appendChild(panel);
    einblenden(panel, 0, { y: 6 });
    if (mitFokus) {
      const t = panel.querySelector("#ei-panel-titel");
      if (t) t.focus({ preventScroll: true });
      if (window.matchMedia && window.matchMedia("(max-width: 1023.98px)").matches) {
        try { panel.scrollIntoView({ behavior: ruhig() ? "auto" : "smooth", block: "start" }); } catch (e) { panel.scrollIntoView(); }
      }
    }
  }

  function panelLogo(panel) {
    const kacheln = h("div", { class: "ei-logo-kacheln" });
    function kachelnNeu() {
      leeren(kacheln);
      kacheln.appendChild(h("figure", { class: "ei-logo-kachel" },
        h("div", { class: "ei-logo-flaeche ei-logo-weiss" }, logoBild("ei-logo-bild")), h("figcaption", { text: "auf Weiß" })));
      const marke = h("div", { class: "ei-logo-flaeche ei-logo-marke" },
        h("span", { class: "ei-logo-plakette" }, logoBild("ei-logo-bild")));
      varsSetzen(marke, variablenAus(farben));
      kacheln.appendChild(h("figure", { class: "ei-logo-kachel" }, marke, h("figcaption", { text: "auf der Marke" })));
      kacheln.appendChild(h("figure", { class: "ei-logo-kachel ei-logo-kachel-breit" },
        h("div", { class: "ei-logo-flaeche ei-logo-kopf" }, logoBild("ei-logo-bild ei-logo-klein"),
          h("span", { class: "ei-logo-kopf-text" },
            h("span", { class: "ei-logo-kopf-name", text: entwurf.firmenname || "Firmenname" }),
            entwurf.untertitel ? h("span", { class: "ei-logo-kopf-unter", text: entwurf.untertitel }) : null)),
        h("figcaption", { text: "im Kopf der App" })));
      entfernen.hidden = !entwurf.logo_data_url;
    }
    const datei = h("input", { type: "file", class: "sr-only", accept: "image/png,image/svg+xml,image/webp,image/jpeg", id: "ei-logo-datei" });
    const logoMeldung = h("p", { class: "feld-fehler", role: "alert" });
    const ablage = h("label", { class: "ei-ablage", for: "ei-logo-datei" },
      h("span", { class: "ei-ablage-symbol" }, ikon("hochladen", { groesse: 20 })),
      h("span", { class: "ei-ablage-text" },
        h("span", { class: "ei-ablage-titel", text: "Logo hierher ziehen oder klicken" }),
        h("span", { class: "ei-ablage-hilfe", text: "PNG, SVG, WebP oder JPEG, gern quadratisch oder als Wortbild. Höchstens etwa 220 KB." })));
    const entfernen = h("button", {
      type: "button", class: "knopf knopf-leise knopf-klein",
      onclick: function () {
        entwurf.logo_data_url = null;
        kachelnNeu();
        vorschauNeu();
      },
    }, ikon("muell", { groesse: 14 }), "Logo entfernen");

    function dateiLesen(f) {
      logoMeldung.textContent = "";
      if (!f) return;
      if (!/^image\/(png|svg\+xml|webp|jpeg)$/.test(f.type)) {
        logoMeldung.textContent = "Bitte ein Bild als PNG, SVG, WebP oder JPEG wählen.";
        return;
      }
      const leser = new FileReader();
      leser.onload = function () {
        const url = String(leser.result || "");
        if (!LOGO_TYPEN.test(url)) {
          logoMeldung.textContent = "Die Datei ließ sich nicht als Bild lesen.";
          return;
        }
        if (url.length > MAX_LOGO) {
          // Hinweis statt Anfrage (SPEC 12.6): der Server nähme es ohnehin nicht.
          logoMeldung.textContent = "Das Logo ist zu groß (" + zahl(url.length) + " Zeichen, höchstens " + zahl(MAX_LOGO) +
            "). Bitte eine kleinere Datei wählen, zum Beispiel als SVG oder als PNG unter 200 KB.";
          return;
        }
        entwurf.logo_data_url = url;
        kachelnNeu();
        vorschauNeu();
      };
      leser.onerror = function () { logoMeldung.textContent = "Die Datei ließ sich nicht lesen."; };
      leser.readAsDataURL(f);
    }
    datei.addEventListener("change", function () { dateiLesen(datei.files && datei.files[0]); datei.value = ""; });
    ablage.addEventListener("dragover", function (e) { e.preventDefault(); ablage.classList.add("ei-ablage-drueber"); });
    ablage.addEventListener("dragleave", function () { ablage.classList.remove("ei-ablage-drueber"); });
    ablage.addEventListener("drop", function (e) {
      e.preventDefault();
      ablage.classList.remove("ei-ablage-drueber");
      dateiLesen(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
    });

    const name = h("input", { class: "feld", type: "text", maxlength: "80", autocomplete: "organization" });
    name.value = entwurf.firmenname;
    const gName = feldGruppe({ feld: name, label: "Firmenname", pflicht: true, hilfe: "Steht im Kopf, auf der Anmeldung und im Browser-Tab." });
    const unter = h("input", { class: "feld", type: "text", maxlength: "120", autocomplete: "off" });
    unter.value = entwurf.untertitel;
    const gUnter = feldGruppe({ feld: unter, label: "Untertitel", hilfe: "Optional, z. B. „Wissensassistent für Service und Technik“." });
    name.addEventListener("input", function () {
      entwurf.firmenname = name.value;
      gName.fehler(/[<>]/.test(name.value) ? "Bitte ohne spitze Klammern." : !name.value.trim() ? "Der Firmenname darf nicht leer sein." : "");
      kachelnNeu();
      vorschauNeu();
    });
    unter.addEventListener("input", function () {
      entwurf.untertitel = unter.value;
      kachelnNeu();
      vorschauNeu();
    });

    panel.appendChild(h("p", { class: "ab-satz", text: "Das Logo erscheint auf der Anmeldung und im Kopf der App. Ohne Logo steht das Monogramm in eurer Farbe da." }));
    panel.appendChild(kacheln);
    panel.appendChild(datei);
    panel.appendChild(ablage);
    panel.appendChild(h("div", { class: "ei-logo-zeile" }, logoMeldung, entfernen));
    panel.appendChild(gName.wurzel);
    panel.appendChild(gUnter.wurzel);
    kachelnNeu();
  }

  function panelFarbe(panel) {
    const waehler = h("input", { type: "color", class: "ei-farbwaehler", "aria-label": "Farbe wählen" });
    waehler.value = entwurf.primaerfarbe.toLowerCase();
    const hexFeld = h("input", { class: "feld mono ei-hex", type: "text", maxlength: "7", autocomplete: "off", spellcheck: "false", inputmode: "text" });
    hexFeld.value = entwurf.primaerfarbe;
    const gHex = feldGruppe({ feld: hexFeld, label: "Hex-Wert", hilfe: "z. B. #E8590C" });
    const vorschlaege = h("div", { class: "ei-vorschlaege", role: "radiogroup", "aria-label": "Vorschläge" });
    VORSCHLAEGE.forEach(function (v) {
      const b = h("button", {
        type: "button", role: "radio", class: "ei-vorschlag", "aria-label": v.name + " " + v.hex, title: v.name + " " + v.hex,
        "data-hex": v.hex, onclick: function () { farbeSetzen(v.hex, "vorschlag"); },
      }, h("span", { class: "ei-vorschlag-farbe" }), ikon("haken", { groesse: 16, klasse: "ei-vorschlag-haken" }));
      b.querySelector(".ei-vorschlag-farbe").style.setProperty("background-color", v.hex);
      vorschlaege.appendChild(b);
    });
    const streifen = h("div", { class: "ei-streifen", role: "img", "aria-label": "Abgeleitete Stufen 50 bis 900" });
    const abgeleitet = h("div", { class: "ei-abgeleitet" });
    const karten = h("div", { class: "ei-kontraste", "aria-live": "polite" });
    const meldung = h("p", { class: "feld-fehler", role: "alert" });
    farbBereich.meldung = meldung;

    waehler.addEventListener("input", function () { farbeSetzen(waehler.value, "waehler"); });
    hexFeld.addEventListener("input", function () {
      const n = hexNormal(hexFeld.value);
      gHex.fehler("");
      if (n) farbeSetzen(n, "hex");
    });
    hexFeld.addEventListener("blur", function () {
      if (!hexNormal(hexFeld.value)) gHex.fehler("Bitte als #RRGGBB angeben, z. B. #E8590C.");
    });

    function anzeigeNeu(quelle) {
      const hex = entwurf.primaerfarbe;
      if (quelle !== "waehler") waehler.value = hex.toLowerCase();
      if (quelle !== "hex") hexFeld.value = hex;
      Array.prototype.forEach.call(vorschlaege.children, function (b) {
        b.setAttribute("aria-checked", b.getAttribute("data-hex") === hex ? "true" : "false");
      });
      // „Aktuell“ heißt: Die letzte Antwort gehört zu dieser Farbe – auch wenn der
      // Server (oder der Offline-Modus) eine Ersatzpalette schickt; dann sagt es ein Hinweis.
      const aktuell = !!farben && farbenFuer === hex;
      const vars = variablenAus(farben);
      leeren(streifen);
      STUFEN.forEach(function (st) {
        const wert = vars["--marke-" + st];
        const zelle = h("span", { class: "ei-stufe" + (st === "500" ? " ei-stufe-mitte" : ""), text: st });
        if (wert) {
          zelle.style.setProperty("background-color", wert);
          zelle.style.setProperty("color", kontrast(wert, "#FFFFFF") >= 4.5 ? "#FFFFFF" : "#23221F");
        }
        streifen.appendChild(zelle);
      });
      streifen.classList.toggle("ei-wartet", !aktuell);
      leeren(abgeleitet);
      function muster(titel, vorder, hinter, text, wertText) {
        const probe = h("span", { class: "ei-muster-probe", text: text });
        if (hinter) probe.style.setProperty("background-color", hinter);
        if (vorder) probe.style.setProperty("color", vorder);
        return h("div", { class: "ei-muster" }, probe,
          h("span", { class: "ei-muster-text" }, h("span", { class: "ei-muster-titel", text: titel }), h("span", { class: "mono ei-muster-wert", text: wertText })));
      }
      if (vars["--marke-knopf"]) {
        abgeleitet.appendChild(muster("Knopf", vars["--auf-marke"], vars["--marke-knopf"], "Aa", vars["--marke-knopf"]));
        abgeleitet.appendChild(muster("Schrift", vars["--marke-text"], vars["--marke-flaeche-2"] || "#F2F2F7", "Aa", vars["--marke-text"] || ""));
        abgeleitet.appendChild(muster("Fläche", "#23221F", vars["--marke-flaeche"] || "#FFFFFF", "", vars["--marke-flaeche"] || "–"));
        abgeleitet.appendChild(muster("Markierung", "#23221F", vars["--marke-markierung"] || "#FFFFFF", "Zitat", vars["--marke-markierung"] || "–"));
      }
      leeren(karten);
      if (!aktuell) {
        karten.appendChild(h("p", { class: "ei-rechnet" }, h("span", { class: "ab-kreisel", "aria-hidden": "true" }), "Farben werden abgeleitet …"));
        return;
      }
      const knopfK = kontrast(vars["--auf-marke"] || "#FFFFFF", vars["--marke-knopf"] || hex);
      const textK = schriftKontrast(vars, hex);
      karten.appendChild(kontrastKarte(knopfK >= 4.5, (vars["--auf-marke"] === "#000000" ? "Dunkle" : "Weiße") + " Schrift auf Knöpfen", verhaeltnis(knopfK) + (knopfK >= 4.5 ? " · AA" : "")));
      const basisFarbe = hexNormal(farben.primaer) || hex;
      karten.appendChild(kontrastKarte(textK >= 4.5, "Markenfarbe als Schrift und Link", verhaeltnis(textK) + (vars["--marke-text"] && vars["--marke-text"] !== basisFarbe ? " · nutzt die dunklere Variante " + vars["--marke-text"] : " · AA")));
      const hinweise = Array.isArray(farben.hinweise) ? farben.hinweise : [];
      hinweise.forEach(function (t) { karten.appendChild(kontrastKarte(false, typo(t), "")); });
      karten.appendChild(kontrastKarte(true, farben.nah_am_stopp ? "Stopp bleibt trotzdem erkennbar" : "Klar getrennt von Stopp-Rot",
        farben.nah_am_stopp ? "Stopp trägt immer Symbol und das Wort „Stopp“; der Fokusrahmen ist dunkel statt rot, damit er nicht wie ein Fehler aussieht." : "Stopp-Hinweise bleiben rot, unabhängig von der Marke."));
    }
    farbBereich.nachFarben.push(anzeigeNeu);

    panel.appendChild(h("p", { class: "ab-satz", text: "Eine Farbe reicht. Knöpfe, Links, Markierungen und Balken leitet das System so ab, dass alles lesbar bleibt." }));
    panel.appendChild(h("div", { class: "ei-farbe-reihe" },
      h("label", { class: "ei-farbwaehler-rahmen" }, waehler, h("span", { class: "sr-only", text: "Farbwähler" })),
      gHex.wurzel));
    panel.appendChild(h("p", { class: "feld-label", text: "Vorschläge" }));
    panel.appendChild(vorschlaege);
    panel.appendChild(h("p", { class: "feld-label ei-label-abstand", text: "Daraus abgeleitet" }));
    panel.appendChild(streifen);
    panel.appendChild(abgeleitet);
    panel.appendChild(karten);
    panel.appendChild(meldung);
    anzeigeNeu();
    if (entwurf.primaerfarbe !== farbenFuer) farbeAnfragen(entwurf.primaerfarbe);
  }

  function kontrastKarte(gut, titel, text) {
    return h("div", { class: "ei-kontrast " + (gut ? "ei-kontrast-gut" : "ei-kontrast-achtung") },
      h("span", { class: "ei-kontrast-symbol" }, ikon(gut ? "haken" : "achtung", { groesse: 16 })),
      h("span", { class: "ei-kontrast-text" },
        h("span", { class: "ei-kontrast-titel", text: titel }),
        text ? h("span", { class: "ei-kontrast-wert", text: text }) : null));
  }

  function panelPruefen(panel) {
    const vars = variablenAus(farben);
    const knopfK = kontrast(vars["--auf-marke"] || "#FFFFFF", vars["--marke-knopf"] || entwurf.primaerfarbe);
    panel.appendChild(h("p", { class: "ab-satz", text: "Die Vorschau zeigt echte Bausteine der App mit der neuen Farbe: Rückfragen, mögliche Ursachen mit Zahlen aus verifizierten Fällen und eine Stopp-Box." }));
    panel.appendChild(h("ul", { class: "ei-pruefliste" },
      pruefPunkt(knopfK >= 4.5, "Knöpfe lesbar", "Schrift auf der Markenfarbe " + verhaeltnis(knopfK)),
      pruefPunkt(true, "Stopp bleibt rot", "Regel-Hinweise nutzen nie die Markenfarbe – mit Symbol und dem Wort „Stopp“."),
      pruefPunkt(true, "Nachrichten neutral", "Was Mitarbeiter schreiben, steht in grauen Blasen, nie in der Marke."),
      pruefPunkt(true, "Zahlen in der Marke", "„7 von 11“ und die Evidenz-Punkte tragen die Markenfarbe."),
      pruefPunkt(!!entwurf.firmenname.trim(), "Name gesetzt", entwurf.firmenname.trim() ? entwurf.firmenname.trim() : "Bitte in Schritt 1 eintragen.")));
    const schmal = h("p", { class: "feld-hilfe ei-nur-schmal", text: "Die Vorschau steht unter diesem Schritt." });
    panel.appendChild(schmal);
  }

  function pruefPunkt(gut, titel, text) {
    return h("li", { class: "ei-pruefpunkt " + (gut ? "ei-kontrast-gut" : "ei-kontrast-achtung") },
      h("span", { class: "ei-kontrast-symbol" }, ikon(gut ? "haken" : "achtung", { groesse: 16 })),
      h("span", { class: "ei-kontrast-text" }, h("span", { class: "ei-kontrast-titel", text: titel }), h("span", { class: "ei-kontrast-wert", text: typo(text) })));
  }

  function panelFolgt(panel, s) {
    panel.appendChild(h("div", { class: "ei-folgt-box" },
      h("span", { class: "ei-folgt-symbol" }, ikon(s.symbol, { groesse: 24 })),
      h("div", null,
        h("p", { class: "ei-folgt-kopf" }, h("span", { class: "pille pille-neutral", text: "folgt" }), "Nach der Demo, beim Einrichten eurer Instanz"),
        h("p", { class: "ab-satz", text: s.text }))));
  }

  // --- Übernehmen / Zurücksetzen ------------------------------------------------------
  uebernehmen.addEventListener("click", function () {
    leisteStatus.textContent = "";
    const d = aenderungen();
    if (!Object.keys(d).length) return;
    if (d.firmenname !== undefined && (!d.firmenname || /[<>]/.test(d.firmenname))) {
      leisteStatus.textContent = "Bitte zuerst einen gültigen Firmennamen eintragen (Schritt 1).";
      return;
    }
    beschaeftigt(uebernehmen, true, "Wird übernommen …");
    zuruecksetzen.disabled = true;
    ctx.api.einrichtungSpeichern(d).then(function (antwort) {
      if (weg) return;
      const b = antwort.branding || {};
      basis = {
        firmenname: String(b.firmenname || entwurf.firmenname),
        untertitel: b.untertitel ? String(b.untertitel) : "",
        primaerfarbe: hexNormal(b.primaerfarbe) || entwurf.primaerfarbe,
        logo_data_url: b.logo_data_url && LOGO_TYPEN.test(b.logo_data_url) ? String(b.logo_data_url) : null,
      };
      entwurf = Object.assign({}, basis);
      if (antwort.farben) {
        farben = antwort.farben;
        farbenFuer = hexNormal(antwort.farben.primaer);
      }
      beschaeftigt(uebernehmen, false);
      ctx.geaendert({ branding: antwort });
      ctx.toast("Übernommen – gilt ab sofort für alle Zugänge.", "gut");
      vorschauNeu();
      schrittZeigen(aktiv, false);
    }, function (err) {
      if (weg) return;
      beschaeftigt(uebernehmen, false);
      vorschauNeu();
      leisteStatus.textContent = fehlerText(err, "Übernehmen hat nicht geklappt.");
    });
  });

  zuruecksetzen.addEventListener("click", function () {
    entwurf = Object.assign({}, basis);
    leisteStatus.textContent = "";
    vorschauNeu();
    schrittZeigen(aktiv, false);
    if (entwurf.primaerfarbe !== farbenFuer) farbeAnfragen(entwurf.primaerfarbe);
  });

  vorschauNeu();
  schrittZeigen(1, false);
  einblenden(vorschau, 1);

  // Frischen Stand holen (falls ein anderer Admin inzwischen etwas übernommen hat).
  ctx.api.einrichtung().then(function (antwort) {
    if (weg || Object.keys(aenderungen()).length) return;
    const b = antwort.branding || {};
    basis = {
      firmenname: String(b.firmenname || basis.firmenname),
      untertitel: b.untertitel ? String(b.untertitel) : "",
      primaerfarbe: hexNormal(b.primaerfarbe) || basis.primaerfarbe,
      logo_data_url: b.logo_data_url && LOGO_TYPEN.test(b.logo_data_url) ? String(b.logo_data_url) : null,
    };
    entwurf = Object.assign({}, basis);
    if (antwort.farben) {
      farben = antwort.farben;
      farbenFuer = hexNormal(antwort.farben.primaer);
    }
    vorschauNeu();
    schrittZeigen(aktiv, false);
  }, function () {
    // ohne frischen Stand weiter – ctx.branding reicht zum Arbeiten
  });

  return {
    titel: "Einrichtung",
    verlassen: function () {
      if (!Object.keys(aenderungen()).length) return true;
      return ctx.bestaetigen("Die Änderungen sind noch nicht übernommen. Trotzdem verlassen?", { ja: "Verlassen", nein: "Bleiben", gefahr: true });
    },
    aufraeumen: function () {
      weg = true;
      clearTimeout(entprellung);
    },
  };
}

function monogramm(name) {
  const w = String(name || "").replace(/\([^)]*\)/g, "").trim().split(/\s+/).filter(Boolean);
  return ((w[0] || "?").charAt(0) + (w[1] ? w[1].charAt(0) : "")).toUpperCase();
}
