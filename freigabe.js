// ============================================================================
// freigabe.js  ·  Freigaben: Beiträge und Fehlercodes prüfen (SPEC 13.3.4) [FA]
// ----------------------------------------------------------------------------
//   zeigeFreigabe(container, ctx)                 #/freigaben  (Recht `freigabe`)
//   codePruefliste(ctx, handbuch, opt) → Element  auch in handbuch.js (Schritt 5)
//
// Warum es diese Liste gibt (Vincents Entscheidung 2, 08.10.2026): Jeder darf
// Wissen abgeben, aber Quelle wird ein Beitrag von Technikern und
// Kundenbetreuern erst, wenn ein Meister oder Admin ihn bestätigt oder
// korrigiert. Dasselbe gilt für Fehlercodes, die die KI aus einem
// hochgeladenen Handbuch vorschlägt: Jede Zeile prüft ein Mensch gegen die
// Seite, bevor das Handbuch aktiv wird.
//
// Änderungen gegenüber dem Original bleiben sichtbar („Vorher: …“), damit
// der Prüfer nie aus Versehen etwas anderes freigibt, als eingereicht wurde.
// Entscheidungen sind endgültig (der Server antwortet bei einer zweiten mit
// 409) – deshalb bleibt eine entschiedene Karte als Ergebniszeile stehen,
// statt zu verschwinden.
// ============================================================================
import { h, initialen, leeren, typo } from "./dom.js";
import { einblenden } from "./bewegung.js";
import { ikon } from "./ikonen.js";
import {
  beschaeftigt,
  datumZeit,
  etikett,
  feldGruppe,
  fehlerText,
  gehtRaus,
  notizEditor,
  notizVorschau,
  rechteVon,
  ROLLEN_ANZEIGE,
  routenLink,
  schreiber,
  seitenKopf,
  zeichenZaehler,
  zeige,
} from "./abgeben.js";

// --- Fehlercodes: Prüfliste (auch für handbuch.js) ---------------------------------

const CODE_STATUS = {
  vorgeschlagen: null,
  bestaetigt: { text: "bestätigt", klasse: "pille-gut", symbol: "haken" },
  korrigiert: { text: "korrigiert und bestätigt", klasse: "pille-gut", symbol: "stift" },
  verworfen: { text: "verworfen", klasse: "pille-neutral", symbol: "schliessen" },
};

/** KI-Maßnahme steht nicht wörtlich auf der Seite (Server: massnahme_woertlich === false). */
function massnahmeNichtWoertlich(c) {
  return c.status === "vorgeschlagen" && !!c.massnahme_laut_handbuch && c.massnahme_woertlich === false;
}

function codeStatus(c) {
  if (c.status === "bestaetigt" && c.korrigiert) return CODE_STATUS.korrigiert;
  return CODE_STATUS[c.status] || null;
}

/**
 * Prüfliste der Fehlercode-Vorschläge eines Handbuch-Entwurfs.
 *
 * hb: { dokument_id, titel, hersteller, modell_serie, status, seiten, codes:[…] }
 * opt.mitAktivieren: „Handbuch aktivieren“ anbieten, sobald nichts mehr offen ist
 * opt.beiAenderung(offen): nach jeder Entscheidung
 * opt.beiAktiviert(antwort): nach dem Aktivieren
 * opt.ohneKopf: Titelzeile weglassen (in handbuch.js steht der Titel schon)
 */
export function codePruefliste(ctx, hb, opt) {
  const o = opt || {};
  const codes = Array.isArray(hb.codes) ? hb.codes.slice() : [];
  let seitenListe = null; // [{seite, pdf_seite}] – erst beim Korrigieren geladen
  const wurzel = h("section", { class: "fg-handbuch", "aria-label": "Fehlercodes aus " + (hb.titel || hb.dokument_id) });
  const fortschritt = h("span", { class: "fg-fortschritt-text zahl" });
  const balken = h("span", { class: "fg-balken-fuellung" });
  const aktivPlatz = h("div", { class: "fg-aktivieren" });
  const liste = h("ol", { class: "fg-codes" });

  if (!o.ohneKopf) {
    wurzel.appendChild(h("div", { class: "fg-hb-kopf" },
      h("span", { class: "fg-hb-symbol" }, ikon("buch", { groesse: 20 })),
      h("div", { class: "fg-hb-text" },
        h("h3", { class: "fg-hb-titel", text: hb.titel || hb.dokument_id }),
        h("p", { class: "fg-hb-meta" },
          h("span", { class: "mono", text: hb.dokument_id }),
          " · " + [hb.hersteller, hb.modell_serie].filter(Boolean).join(" · ") +
          (typeof hb.seiten === "number" ? " · " + hb.seiten + (hb.seiten === 1 ? " Seite" : " Seiten") : "") +
          " · " + (hb.status === "aktiv" ? "aktiv" : "Entwurf")))));
  }
  const auffaellig = Array.isArray(hb.seiten_hinweise) ? hb.seiten_hinweise : [];
  if (auffaellig.length && hb.status !== "aktiv") {
    wurzel.appendChild(h("p", { class: "fg-warnung fg-warnung-seiten" }, ikon("achtung", { groesse: 14 }),
      "Bitte lesen: Auf " + (auffaellig.length === 1 ? "S. " + auffaellig[0].seite : "S. " + auffaellig.map(function (x) { return x.seite; }).join(", ")) +
      " steht etwas, das wie eine Anweisung an die KI klingt. Der Seitentext steht vor dem Aktivieren zum Lesen da."));
  }
  wurzel.appendChild(h("div", { class: "fg-fortschritt" },
    h("span", { class: "fg-balken", "aria-hidden": "true" }, balken),
    fortschritt));
  if (!codes.length) {
    wurzel.appendChild(h("p", { class: "fg-keine", text: "Keine Fehlercodes vorgeschlagen. Das Handbuch kann trotzdem Quelle werden." }));
  }
  wurzel.appendChild(liste);
  wurzel.appendChild(aktivPlatz);

  function offen() {
    return codes.filter(function (c) { return c.status === "vorgeschlagen"; }).length;
  }

  function fortschrittNeu() {
    const n = codes.length;
    const fertig = n - offen();
    fortschritt.textContent = n ? fertig + " von " + n + " geprüft" : "nichts zu prüfen";
    balken.style.setProperty("transform", "scaleX(" + (n ? fertig / n : 1) + ")");
    aktivierenZeigen();
  }

  function seitenLaden() {
    if (seitenListe) return Promise.resolve(seitenListe);
    return ctx.api.handbuecher(hb.dokument_id).then(function (a) {
      seitenListe = (a.seiten || []).map(function (p) { return { seite: p.seite, pdf_seite: p.pdf_seite }; });
      return seitenListe;
    }, function () {
      // Rückfall: die Seiten, die in den Vorschlägen vorkommen
      const gesehen = {};
      seitenListe = [];
      codes.forEach(function (c) {
        if (!gesehen[c.seite]) {
          gesehen[c.seite] = true;
          seitenListe.push({ seite: c.seite, pdf_seite: c.pdf_seite });
        }
      });
      return seitenListe;
    });
  }

  function zeileBauen(c) {
    const li = h("li", { class: "fg-code" });
    const bildPlatz = h("div", { class: "fg-seitenbild", hidden: true });
    let bildGeladen = false;
    const seiteKnopf = h("button", {
      type: "button", class: "knopf knopf-rand knopf-klein fg-seite-knopf", "aria-expanded": "false",
      onclick: function () {
        const auf = bildPlatz.hidden;
        bildPlatz.hidden = !auf;
        seiteKnopf.setAttribute("aria-expanded", auf ? "true" : "false");
        if (auf && !bildGeladen) {
          bildGeladen = true;
          bildPlatz.appendChild(h("div", { class: "skelett fg-seitenbild-skelett", "aria-hidden": "true" }));
          ctx.api.ladeSeitenbild(hb.dokument_id, c.seite).then(function (url) {
            leeren(bildPlatz);
            bildPlatz.appendChild(h("img", { src: url, alt: "Seite " + c.seite + " aus " + (hb.titel || hb.dokument_id), class: "fg-seitenbild-bild" }));
          }, function (err) {
            bildGeladen = false;
            leeren(bildPlatz);
            bildPlatz.appendChild(h("p", { class: "feld-fehler", text: fehlerText(err, "Seitenbild nicht geladen.") }));
          });
        }
      },
    }, ikon("seite", { groesse: 14 }), "S. " + c.seite);

    const status = codeStatus(c);
    const kopf = h("div", { class: "fg-code-kopf" },
      h("span", { class: "fg-code-kennung mono" + (c.status === "verworfen" ? " fg-durch" : ""), text: c.code }),
      h("span", { class: "fg-code-bez" + (c.status === "verworfen" ? " fg-durch" : ""), text: typo(c.bezeichnung || "") }),
      seiteKnopf);
    const koerper = h("div", { class: "fg-code-koerper" },
      c.massnahme_laut_handbuch ? h("p", { class: "fg-code-mass" }, h("span", { class: "fg-label", text: "Maßnahme laut Handbuch: " }), typo(c.massnahme_laut_handbuch)) : null,
      c.beleg ? h("blockquote", { class: "fg-beleg" }, h("span", { class: "fg-label", text: "Beleg von S. " + c.seite + ": " }), "„" + c.beleg + "“") : null,
      c.bezeichnung_woertlich === false && c.status === "vorgeschlagen"
        ? h("p", { class: "fg-warnung" }, ikon("achtung", { groesse: 14 }), "Die Bezeichnung steht so nicht wörtlich auf der Seite – bitte am Seitenbild prüfen.")
        : null,
      massnahmeNichtWoertlich(c)
        ? h("p", { class: "fg-warnung" }, ikon("achtung", { groesse: 14 }), "Die Maßnahme steht so nicht auf S. " + c.seite + " – bitte am Seitenbild prüfen und korrigieren (oder die Maßnahme leeren).")
        : null);
    const aktionen = h("div", { class: "fg-code-aktionen" });
    const meldung = h("p", { class: "feld-fehler", role: "alert" });
    // Entscheidungsknöpfe direkt am Code; das (große) Seitenbild klappt darunter auf.
    li.appendChild(kopf);
    li.appendChild(koerper);
    li.appendChild(aktionen);
    li.appendChild(meldung);
    li.appendChild(bildPlatz);

    function entscheiden(entscheidung, knopf, code) {
      meldung.textContent = "";
      const knoepfe = aktionen.querySelectorAll("button");
      Array.prototype.forEach.call(knoepfe, function (b) { if (b !== knopf) b.disabled = true; });
      beschaeftigt(knopf, true, "…");
      const daten = { art: "code", id: c.id, entscheidung: entscheidung };
      if (code) daten.code = code;
      return ctx.api.freigabe(daten).then(function (antwort) {
        const neu = Object.assign({}, c, antwort.code || {});
        const i = codes.indexOf(c);
        if (i !== -1) codes[i] = neu;
        const ersatz = zeileBauen(neu);
        li.replaceWith(ersatz);
        einblenden(ersatz, 0, { y: 4 });
        fortschrittNeu();
        ctx.geaendert({ freigaben: true });
        if (typeof o.beiAenderung === "function") o.beiAenderung(typeof antwort.offen === "number" ? antwort.offen : offen());
        const naechste = liste.querySelector(".fg-code-offen .knopf-primaer");
        if (naechste && li.contains(document.activeElement) === false) {
          // Fokus wandert zur nächsten offenen Zeile – Prüfen mit der Tastatur geht so am Stück.
          try { naechste.focus({ preventScroll: false }); } catch (e) { naechste.focus(); }
        }
        return true;
      }, function (err) {
        beschaeftigt(knopf, false);
        Array.prototype.forEach.call(knoepfe, function (b) { b.disabled = false; });
        meldung.textContent = fehlerText(err, "Entscheidung nicht gespeichert.");
        return false;
      });
    }

    if (c.status === "vorgeschlagen" && hb.status !== "aktiv") {
      li.classList.add("fg-code-offen");
      // Steht die Maßnahme nicht auf der Seite, gibt es kein schnelles
      // „Bestätigen“: Die Zeile käme sonst unter „wörtlich aus den
      // Herstellerunterlagen“ in jede Antwort (Befund sicherheit-02).
      const nurKorrektur = massnahmeNichtWoertlich(c);
      const bestaetigen = nurKorrektur ? null : h("button", { type: "button", class: "knopf knopf-primaer knopf-klein" }, ikon("haken", { groesse: 14 }), "Bestätigen");
      const korrigieren = h("button", { type: "button", class: "knopf " + (nurKorrektur ? "knopf-primaer" : "knopf-rand") + " knopf-klein" }, ikon("stift", { groesse: 14 }), "Korrigieren");
      const verwerfen = h("button", { type: "button", class: "knopf knopf-leise knopf-klein" }, ikon("schliessen", { groesse: 14 }), "Verwerfen");
      if (bestaetigen) bestaetigen.addEventListener("click", function () { entscheiden("bestaetigen", bestaetigen); });
      verwerfen.addEventListener("click", function () { entscheiden("verwerfen", verwerfen); });
      korrigieren.addEventListener("click", function () { korrekturZeigen(); });
      if (bestaetigen) aktionen.appendChild(bestaetigen);
      aktionen.appendChild(korrigieren);
      aktionen.appendChild(verwerfen);
    } else if (status) {
      aktionen.appendChild(h("span", { class: "pille " + status.klasse }, ikon(status.symbol, { groesse: 13 }), status.text));
    }

    function korrekturZeigen() {
      leeren(aktionen);
      const fCode = h("input", { class: "feld mono", type: "text", maxlength: "20", autocomplete: "off" });
      fCode.value = c.code || "";
      const fBez = h("input", { class: "feld", type: "text", maxlength: "200", autocomplete: "off" });
      fBez.value = c.bezeichnung || "";
      const fMass = h("textarea", { class: "feld", rows: "2", maxlength: "800" });
      fMass.value = c.massnahme_laut_handbuch || "";
      const fSeite = h("select", { class: "feld" }, h("option", { value: String(c.seite), text: "S. " + c.seite }));
      seitenLaden().then(function (liste2) {
        leeren(fSeite);
        liste2.forEach(function (p) { fSeite.appendChild(h("option", { value: String(p.seite), text: "S. " + p.seite + (p.pdf_seite !== p.seite ? " (PDF-S. " + p.pdf_seite + ")" : "") })); });
        fSeite.value = String(c.seite);
      });
      const gCode = feldGruppe({ feld: fCode, label: "Code", pflicht: true });
      const gBez = feldGruppe({ feld: fBez, label: "Bezeichnung", pflicht: true, hilfe: "Wörtlich von der Seite." });
      const gMass = feldGruppe({ feld: fMass, label: "Maßnahme laut Handbuch" });
      const gSeite = feldGruppe({ feld: fSeite, label: "Seite" });
      const speichern = h("button", { type: "button", class: "knopf knopf-primaer knopf-klein" }, ikon("haken", { groesse: 14 }), "Korrigiert bestätigen");
      const abbrechen = h("button", {
        type: "button", class: "knopf knopf-leise knopf-klein",
        onclick: function () {
          const ersatz = zeileBauen(c);
          li.replaceWith(ersatz);
        },
      }, "Abbrechen");
      const formular = h("div", { class: "fg-korrektur" },
        h("div", { class: "fg-korrektur-reihe" }, gCode.wurzel, gSeite.wurzel),
        gBez.wurzel,
        gMass.wurzel,
        h("div", { class: "ab-knopfreihe" }, speichern, abbrechen));
      aktionen.appendChild(formular);
      speichern.addEventListener("click", function () {
        const code = fCode.value.trim();
        const bez = fBez.value.trim();
        let falsch = null;
        if (!code) { gCode.fehler("Bitte den Code angeben."); falsch = falsch || fCode; }
        if (!bez) { gBez.fehler("Bitte die Bezeichnung angeben."); falsch = falsch || fBez; }
        if (falsch) {
          falsch.focus();
          return;
        }
        entscheiden("korrigieren", speichern, {
          code: code,
          bezeichnung: bez,
          massnahme_laut_handbuch: fMass.value.trim() || null,
          seite: parseInt(fSeite.value, 10),
        });
      });
      fBez.focus();
    }
    return li;
  }

  function aktivierenZeigen() {
    leeren(aktivPlatz);
    if (!o.mitAktivieren || hb.status === "aktiv") return;
    if (offen() > 0) return;
    const knopf = h("button", { type: "button", class: "knopf knopf-primaer", disabled: true }, ikon("haken", { groesse: 16 }), "Handbuch aktivieren");
    const meldung = h("div", { class: "ab-status", role: "alert" });
    const lesen = textPruefung(ctx, hb.dokument_id, { beiAenderung: function (ok) { knopf.disabled = !ok; } });
    aktivPlatz.appendChild(h("div", { class: "fg-aktivieren-box" },
      h("p", { class: "fg-aktivieren-text" }, ikon("haken", { groesse: 16 }),
        codes.length ? "Alle Fehlercodes geprüft. Ab der nächsten Frage kann das Handbuch Quelle sein." : "Ab der nächsten Frage kann das Handbuch Quelle sein."),
      lesen.element, knopf, meldung));
    knopf.addEventListener("click", function () {
      if (!lesen.geprueft()) return;
      meldung.textContent = "";
      beschaeftigt(knopf, true, "Wird aktiviert …");
      ctx.api.handbuch("aktivieren", { dokument_id: hb.dokument_id }).then(function (antwort) {
        hb.status = "aktiv";
        ctx.geaendert({ freigaben: true });
        leeren(aktivPlatz);
        aktivPlatz.appendChild(aktiviertBox(ctx, antwort));
        if (typeof o.beiAktiviert === "function") o.beiAktiviert(antwort);
      }, function (err) {
        beschaeftigt(knopf, false);
        meldung.textContent = fehlerText(err, "Aktivieren hat nicht geklappt.");
      });
    });
  }

  codes.forEach(function (c) { liste.appendChild(zeileBauen(c)); });
  fortschrittNeu();
  return wurzel;
}

/**
 * Seitentext lesen, bevor ein Handbuch Quelle wird (Befund sicherheit-01).
 * Ein PDF kann Text enthalten, den das Seitenbild nicht zeigt (weiß auf weiß,
 * winzige Schrift) – pdf.js liest ihn trotzdem, und nach dem Aktivieren
 * stünde er in jeder Frage aller Zugänge. Deshalb zeigt diese Box den
 * GESPEICHERTEN Text (GET handbuch?dokument_id), klappt Seiten mit
 * auffälligen Sätzen auf und markiert sie; aktiviert wird erst nach dem Haken.
 * Rückgabe: { element, geprueft() }; opt.beiAenderung(ok) bei jeder Änderung.
 */
export function textPruefung(ctx, dokumentId, opt) {
  const o = opt || {};
  let ok = false;
  const haken = h("input", { type: "checkbox", id: "fg-text-gelesen-" + dokumentId, disabled: true });
  const liste = h("div", { class: "fg-text-liste" }, h("div", { class: "skelett fg-skelett-zeile", "aria-hidden": "true" }));
  const status = h("p", { class: "feld-hilfe", role: "status" });
  const wurzel = h("section", { class: "fg-text-pruefung", "aria-label": "Seitentext prüfen" },
    h("p", { class: "fg-text-titel" }, ikon("auge", { groesse: 16 }), "Seitentext lesen"),
    h("p", { class: "ab-satz-klein", text: "Dieser Text steht ab dem Aktivieren in jeder Frage – auch das, was das Seitenbild nicht zeigt. Seiten mit Sätzen, die wie eine Anweisung an die KI klingen, sind aufgeklappt und markiert." }),
    liste,
    status,
    h("label", { class: "haken-zeile fg-text-haken", for: "fg-text-gelesen-" + dokumentId }, haken,
      h("span", { text: "Ich habe den Seitentext gelesen – er enthält nur Herstellerwissen, keine Anweisungen." })));
  function melden() {
    ok = !!haken.checked && !haken.disabled;
    if (typeof o.beiAenderung === "function") o.beiAenderung(ok);
  }
  haken.addEventListener("change", melden);

  function laden() {
    leeren(liste).appendChild(h("div", { class: "skelett fg-skelett-zeile", "aria-hidden": "true" }));
    status.textContent = "";
    haken.disabled = true;
    melden();
    ctx.api.handbuecher(dokumentId).then(function (a) {
      const seiten = Array.isArray(a && a.seiten) ? a.seiten : [];
      leeren(liste);
      if (!seiten.length || seiten.some(function (p) { return typeof p.text !== "string"; })) {
        status.textContent = "Der Seitentext kam nicht mit – bitte erneut laden.";
        liste.appendChild(h("button", { type: "button", class: "knopf knopf-rand knopf-klein", onclick: laden }, "Erneut laden"));
        return;
      }
      let markiert = 0;
      seiten.forEach(function (p) {
        const hinweise = Array.isArray(p.hinweise) ? p.hinweise : [];
        if (hinweise.length) markiert += 1;
        const zeilen = String(p.text).split("\n");
        const pre = h("pre", { class: "fg-text", tabindex: "0" });
        zeilen.forEach(function (z, i) {
          const t = z.replace(/\s+/g, " ").trim();
          const auffaellig = hinweise.some(function (x) {
            const zeile = String(x.zeile || "").replace(/…$/, "");
            return zeile && t.indexOf(zeile) === 0;
          });
          if (auffaellig) pre.appendChild(h("mark", { class: "fg-text-markiert", text: z }));
          else pre.appendChild(document.createTextNode(z));
          if (i < zeilen.length - 1) pre.appendChild(document.createTextNode("\n"));
        });
        liste.appendChild(h("details", { class: "fg-text-seite" + (hinweise.length ? " ist-auffaellig" : ""), open: hinweise.length ? true : null },
          h("summary", null,
            h("span", { text: "S. " + p.seite + (p.pdf_seite !== p.seite ? " (PDF-Seite " + p.pdf_seite + ")" : "") }),
            h("span", { class: "fg-text-zeichen zahl", text: (p.zeichen || String(p.text).length).toLocaleString("de-DE") + " Zeichen" }),
            hinweise.length ? h("span", { class: "pille pille-achtung" }, ikon("achtung", { groesse: 12 }), "bitte lesen") : null),
          pre));
      });
      status.textContent = markiert
        ? markiert + (markiert === 1 ? " Seite ist" : " Seiten sind") + " markiert – im Zweifel die Seite in Schritt 3 abwählen und neu hochladen."
        : "Keine auffälligen Sätze gefunden. Ein Blick lohnt trotzdem.";
      haken.disabled = false;
      melden();
    }, function (err) {
      leeren(liste).appendChild(h("button", { type: "button", class: "knopf knopf-rand knopf-klein", onclick: laden }, "Erneut laden"));
      status.textContent = fehlerText(err, "Der Seitentext ließ sich nicht laden.");
    });
  }
  laden();
  return { element: wurzel, geprueft: function () { return ok; } };
}

/** „Ab jetzt Quelle: Q30–Q32“ + Hinweis des Servers (Kosten des Zwischenspeichers). */
export function aktiviertBox(ctx, antwort) {
  const q = Array.isArray(antwort.quellen) ? antwort.quellen : [];
  const bereich = q.length ? (q.length === 1 ? q[0].id : q[0].id + "–" + q[q.length - 1].id) : "";
  return h("div", { class: "fg-aktiv-box", role: "status" },
    h("p", { class: "fg-aktiv-titel" }, ikon("haken", { groesse: 18 }), "Ab jetzt Quelle" + (bereich ? ": " + bereich : "")),
    antwort.hinweis ? h("p", { class: "ab-satz-klein", text: typo(antwort.hinweis) }) : null,
    typeof antwort.codes_bestaetigt === "number"
      ? h("p", { class: "ab-satz-klein", text: antwort.codes_bestaetigt + (antwort.codes_bestaetigt === 1 ? " Fehlercode" : " Fehlercodes") + " bestätigt." })
      : null,
    h("div", { class: "ab-knopfreihe" },
      routenLink(ctx, "#/brauchen", null, "knopf knopf-primaer", [ikon("assistent", { groesse: 16 }), "Im Chat fragen"])));
}

// --- Beiträge ----------------------------------------------------------------------

function beitragKarte(ctx, b, beiEntschieden) {
  const notiz = b.notiz || {};
  const vorschau = h("p", { class: "geht-raus-text" });
  const korrekturHinweis = h("p", { class: "ab-geht-raus-fuss", hidden: true }, ikon("stift", { groesse: 14 }), "Mit deiner Korrektur – das Original bleibt gespeichert.");
  const editor = notizEditor(notiz, {
    original: notiz,
    beiAenderung: function () {
      vorschau.textContent = notizVorschau(editor.lesen());
      korrekturHinweis.hidden = !editor.geaendert();
    },
  });
  const grund = h("textarea", { class: "feld", rows: "2", maxlength: "300", placeholder: "z. B. „Danach die Taktung eine Woche beobachten“ ergänzt" });
  const gGrund = feldGruppe({ feld: grund, label: "Hinweis an " + vorname(b.eingereicht_von) + " (optional)", unter: h("div", { class: "ab-unter-feld" }, zeichenZaehler(grund, 300)) });
  const status = h("div", { class: "ab-status", role: "alert" });
  const freigeben = h("button", { type: "button", class: "knopf knopf-primaer" }, ikon("haken", { groesse: 16 }), "Freigeben");
  const ablehnen = h("button", { type: "button", class: "knopf knopf-gefahr" }, ikon("schliessen", { groesse: 16 }), "Ablehnen");
  const knoepfe = h("div", { class: "fg-knoepfe" }, ablehnen, freigeben);
  const ablehnPlatz = h("div", { class: "fg-ablehnen", hidden: true });

  const rolle = ROLLEN_ANZEIGE[b.eingereicht_rolle] || b.eingereicht_rolle || "";
  const name = String(b.eingereicht_von || "").replace(/\s*\([^)]*\)\s*$/, "");
  // Ab 1280 px zwei Spalten in der Karte: links Person, Felder, Hinweis;
  // rechts klebend „Wird Quelle als …“ und Freigeben/Ablehnen – die Knöpfe
  // lagen sonst bei einem einzelnen Beitrag erst nach ~400 px Scrollen
  // (Befund design-04). Darunter dieselbe Reihenfolge untereinander.
  const karte = h("article", { class: "karte ab-karte fg-beitrag", "aria-label": "Beitrag von " + name },
    h("div", { class: "karte-kopf" },
      etikett("akte", "notiz", "Beitrag", "wartet auf Freigabe"),
      h("span", { class: "fg-zeit", text: datumZeit(b.eingereicht_am) })),
    h("div", { class: "fg-beitrag-innen" },
      h("div", { class: "fg-beitrag-felder" },
        h("div", { class: "fg-person" },
          h("span", { class: "fg-initialen", "aria-hidden": "true", text: initialen(name) }),
          h("div", null,
            h("p", { class: "fg-person-name", text: name }),
            h("p", { class: "fg-person-meta", text: [rolle, b.quelle === "diktat" ? "per Diktat" : "getippt"].filter(Boolean).join(" · ") }))),
        editor.element,
        gGrund.wurzel),
      h("div", { class: "fg-beitrag-entscheidung" },
        gehtRaus("Wird Quelle als nächste Meister-Notiz:", [
          vorschau,
          korrekturHinweis,
          h("p", { class: "ab-geht-raus-fuss ab-leise", text: "Autor bleibt " + name + " · geprüft von " + schreiber(ctx) }),
        ]),
        ablehnPlatz,
        status,
        knoepfe)));
  vorschau.textContent = notizVorschau(editor.lesen());

  freigeben.addEventListener("click", function () {
    status.textContent = "";
    const falsch = editor.pruefen();
    if (falsch) {
      falsch.focus();
      return;
    }
    const daten = { art: "beitrag", id: b.id, entscheidung: "freigeben" };
    if (editor.geaendert()) daten.notiz = editor.lesen();
    if (grund.value.trim()) daten.grund = grund.value.trim();
    beschaeftigt(freigeben, true, "Wird freigegeben …");
    ablehnen.disabled = true;
    ctx.api.freigabe(daten).then(function (antwort) {
      entschieden(antwort, true);
    }, function (err) {
      beschaeftigt(freigeben, false);
      ablehnen.disabled = false;
      status.textContent = fehlerText(err, "Freigeben hat nicht geklappt.");
    });
  });

  ablehnen.addEventListener("click", function () {
    if (!ablehnPlatz.hidden) return;
    knoepfe.hidden = true;
    editor.sperren(true);
    const feld = h("textarea", { class: "feld", rows: "2", maxlength: "300", placeholder: "Warum wird der Beitrag nicht Quelle? Der Einreicher sieht den Grund." });
    const g = feldGruppe({ feld: feld, label: "Grund der Ablehnung", pflicht: true, unter: h("div", { class: "ab-unter-feld" }, zeichenZaehler(feld, 300)) });
    const senden = h("button", { type: "button", class: "knopf knopf-gefahr" }, "Ablehnung senden");
    const zurueck = h("button", {
      type: "button", class: "knopf knopf-leise",
      onclick: function () {
        leeren(ablehnPlatz);
        ablehnPlatz.hidden = true;
        knoepfe.hidden = false;
        editor.sperren(false);
        ablehnen.focus();
      },
    }, "Abbrechen");
    leeren(ablehnPlatz);
    ablehnPlatz.appendChild(g.wurzel);
    ablehnPlatz.appendChild(h("div", { class: "fg-knoepfe" }, zurueck, senden));
    ablehnPlatz.hidden = false;
    feld.addEventListener("input", function () { g.fehler(""); });
    feld.focus();
    senden.addEventListener("click", function () {
      const t = feld.value.trim();
      if (t.length < 3) {
        g.fehler("Bitte einen Grund angeben (mindestens 3 Zeichen).");
        feld.focus();
        return;
      }
      beschaeftigt(senden, true, "Wird gesendet …");
      zurueck.disabled = true;
      ctx.api.freigabe({ art: "beitrag", id: b.id, entscheidung: "ablehnen", grund: t }).then(function (antwort) {
        entschieden(Object.assign({ grund: t }, antwort), false);
      }, function (err) {
        beschaeftigt(senden, false);
        zurueck.disabled = false;
        g.fehler(fehlerText(err, "Ablehnen hat nicht geklappt."));
      });
    });
  });

  function entschieden(antwort, frei) {
    const zeile = h("article", { class: "karte ab-karte fg-entschieden", role: "status" },
      h("div", { class: "fg-entschieden-kopf" },
        // Kürzel (MN-09) nur im title – auf den ersten Blick zählt, dass der
        // Tipp ab jetzt hilft (Gegenprüfung 09.10.).
        h("span", { class: "pille " + (frei ? "pille-gut" : "pille-neutral"), title: frei && antwort.kuerzel ? "Quelle " + antwort.kuerzel : null },
          ikon(frei ? "haken" : "schliessen", { groesse: 13 }), frei ? "freigegeben" : "abgelehnt"),
        frei && antwort.korrigiert ? h("span", { class: "pille pille-neutral" }, ikon("stift", { groesse: 13 }), "mit Korrektur") : null),
      h("p", { class: "fg-entschieden-text", "data-kuerzel": frei && antwort.kuerzel ? String(antwort.kuerzel) : null, text: frei
        ? "Freigegeben – der Tipp von " + name + " hilft ab jetzt allen."
        : "Beitrag von " + name + " abgelehnt. Grund: " + (antwort.grund || "–") }),
      h("p", { class: "fg-entschieden-zitat", text: typo((antwort.notiz && antwort.notiz.fehlerbild) || notiz.fehlerbild || "") }));
    karte.replaceWith(zeile);
    einblenden(zeile, 0, { y: 4 });
    ctx.geaendert({ freigaben: true });
    if (typeof beiEntschieden === "function") beiEntschieden(zeile);
  }

  return karte;
}

function vorname(schreiberZeile) {
  const n = String(schreiberZeile || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  return n.split(/\s+/)[0] || "den Einreicher";
}

// --- Bildschirm ---------------------------------------------------------------------

export function zeigeFreigabe(container, ctx) {
  const r = rechteVon(ctx);
  let weg = false;
  const seite = h("div", { class: "ab-seite ab-seite-breit fg-seite" });
  const zahlenZeile = h("p", { class: "fg-zahlen", "aria-live": "polite" });
  // Der Einleitungssatz und die Abschnitte erscheinen nur, wenn etwas wartet –
  // „nichts zu tun“ braucht keine fünf Sätze (Gegenprüfung 09.10.).
  const kopf = seitenKopf(ctx, {
    titel: "Freigaben",
    satz: "Ein Tipp oder Fehlercode wird erst nach deiner Prüfung zur Quelle.",
    zusatz: zahlenZeile,
  });
  const einleitung = kopf.querySelector(".ab-satz");
  if (einleitung) einleitung.hidden = true;
  seite.appendChild(kopf);
  container.appendChild(seite);

  if (!r.freigabe) {
    seite.appendChild(h("div", { class: "karte ab-karte leer" }, ikon("schild", { groesse: 28 }), h("p", { text: "Freigaben sind Meistern und Admins vorbehalten." })));
    return { titel: "Freigaben" };
  }

  const beitragTeil = h("section", { class: "ab-abschnitt", "aria-labelledby": "fg-beitraege-titel" });
  const codeTeil = h("section", { class: "ab-abschnitt", "aria-labelledby": "fg-codes-titel" });
  const beitragZahl = h("span", { class: "pille pille-neutral zahl" });
  const codeZahl = h("span", { class: "pille pille-neutral zahl" });
  const beitragListe = h("div", { class: "fg-beitrag-raster" });
  const codeListe = h("div", { class: "fg-hb-liste" });
  beitragTeil.appendChild(h("div", { class: "ab-abschnitt-kopf" },
    h("h2", { class: "ab-h2", id: "fg-beitraege-titel" }, ikon("notiz", { groesse: 18 }), "Beiträge"), beitragZahl));
  beitragTeil.appendChild(beitragListe);
  codeTeil.appendChild(h("div", { class: "ab-abschnitt-kopf" },
    h("h2", { class: "ab-h2", id: "fg-codes-titel" }, ikon("buch", { groesse: 18 }), "Fehlercodes aus Handbüchern"), codeZahl));
  codeTeil.appendChild(codeListe);
  seite.appendChild(beitragTeil);
  seite.appendChild(codeTeil);

  function zahlenNeu(z) {
    const b = z.beitraege_offen || 0;
    const c = z.codes_offen || 0;
    beitragZahl.textContent = b + " offen";
    beitragZahl.className = "pille zahl " + (b ? "pille-achtung" : "pille-neutral");
    codeZahl.textContent = c + " offen";
    codeZahl.className = "pille zahl " + (c ? "pille-achtung" : "pille-neutral");
    zahlenZeile.textContent = b + c === 0 ? "Alles geprüft – nichts wartet auf dich." : b + c === 1 ? "1 Punkt wartet auf deine Prüfung." : (b + c) + " Punkte warten auf deine Prüfung.";
  }

  function laden() {
    leeren(beitragListe);
    leeren(codeListe);
    beitragListe.appendChild(h("div", { class: "skelett fg-skelett-karte", "aria-hidden": "true" }));
    codeListe.appendChild(h("div", { class: "skelett fg-skelett-zeile", "aria-hidden": "true" }));
    ctx.api.freigaben(false).then(function (antwort) {
      if (weg) return;
      leeren(beitragListe);
      leeren(codeListe);
      const zaehler = Object.assign({ beitraege_offen: 0, codes_offen: 0 }, antwort.zahlen || {});
      zahlenNeu(zaehler);
      const beitraege = Array.isArray(antwort.beitraege) ? antwort.beitraege : [];
      const handbuecher = Array.isArray(antwort.handbuecher) ? antwort.handbuecher : [];
      const wartet = beitraege.length > 0 || handbuecher.length > 0;
      if (einleitung) einleitung.hidden = !wartet;
      // Leere Abschnitte nicht zeigen – „Alles geprüft – nichts wartet auf dich.“ reicht.
      beitragTeil.hidden = !beitraege.length;
      codeTeil.hidden = !handbuecher.length;
      beitraege.forEach(function (b, i) {
        const k = beitragKarte(ctx, b, function () {
          zaehler.beitraege_offen = Math.max(0, zaehler.beitraege_offen - 1);
          zahlenNeu(zaehler);
        });
        beitragListe.appendChild(k);
        zeige(k, i);
      });
      handbuecher.forEach(function (hb, i) {
        const karte = h("div", { class: "karte ab-karte fg-hb-karte" });
        karte.appendChild(codePruefliste(ctx, hb, {
          mitAktivieren: true,
          beiAenderung: function () {
            // Gezählt wird, was auf dem Schirm noch offen ist – das ist nach jeder Entscheidung aktuell.
            zaehler.codes_offen = codeListe.querySelectorAll(".fg-code-offen").length;
            zahlenNeu(zaehler);
          },
        }));
        codeListe.appendChild(karte);
        zeige(karte, i);
      });
    }, function (err) {
      if (weg) return;
      leeren(beitragListe);
      leeren(codeListe);
      beitragListe.appendChild(h("div", { class: "ab-hinweis ab-hinweis-fehler", role: "alert" },
        h("p", { text: fehlerText(err, "Freigaben nicht geladen.") }),
        h("button", { type: "button", class: "knopf knopf-rand knopf-klein", onclick: laden }, "Erneut laden")));
    });
  }
  laden();

  return {
    titel: "Freigaben",
    verlassen: function () {
      // Begonnene Korrekturen fragen nach, bevor sie verloren gehen.
      const offeneKorrektur = seite.querySelector(".fg-korrektur, .fg-ablehnen:not([hidden])");
      const bearbeitet = Array.prototype.some.call(seite.querySelectorAll(".fg-beitrag .ab-feld-geaendert"), function () { return true; });
      if (!offeneKorrektur && !bearbeitet) return true;
      return ctx.bestaetigen("Deine Änderungen sind noch nicht entschieden. Trotzdem verlassen?", { ja: "Verlassen", nein: "Bleiben", gefahr: true });
    },
    aufraeumen: function () { weg = true; },
  };
}
