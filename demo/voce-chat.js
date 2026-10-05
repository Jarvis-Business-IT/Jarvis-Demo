// I tasti del riquadro «Chat a voce» della scheda Stato (2026-10-05, l'utente: «mancano i tasti per parlare che ci
// sono nella chat principale»).
//
//  🎤  dettato nel campo, lo stesso codice del microfono della chat (CCDettato.avvia di dettato.js): il testo
//      non parte da solo, si rilegge e si preme Manda.
//  📞  parla con la voce di Jarvis. Dipende dalla macchina che risponde (campo «macchina» di /api/chat/storia):
//      - Mac: azione chat_voce_parla → backtalk ascolta UNA frase come dopo «Hey Jarvis» (accende la voce se è
//        spenta); risponde backtalk a voce, la battuta arriva nel riquadro da chat.jsonl.
//      - VPS (sito): conversazione dal browser. Ascolto continuo col dettato; dopo 1,5 s di silenzio la frase
//        parte con chat_voce_manda (jarvis-agent, la stessa sessione del telefono); la risposta nuova di Jarvis
//        si legge con speechSynthesis (voce-sintetica.js la accorcia) e poi si torna ad ascoltare. Un altro
//        tocco chiude tutto. Il microfono è spento mentre Jarvis parla.
// Le battute arrivano da app.js con l'evento «cc:chat-voce» (aggiornaChatVoce): niente letture in più, tranne
// una spinta ogni 1,5 s mentre si aspetta la risposta.
// Per le prove: window.__VOCE_CHAT = { silenzio, tetto } accorcia i tempi; window.__VOCE_CHAT_STATO() dice lo stato.
(function voceChat() {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const T = () => Object.assign({ silenzio: 1500, tetto: 180000, ascoltoMac: 15000 }, window.__VOCE_CHAT || {});
  const S = {
    macchina: "", voce: false, battute: [],
    det: null,                  // il dettato del 🎤
    conv: false,                // la conversazione dal browser (sito) è aperta
    fase: "",                   // ascolto | pensa | parla
    rec: null, timerSil: null, attesa: null, spinta: null, timerMac: null, letti: [],
  };
  let campo, mic, parla, nota;

  function dici(testo, errore) {
    if (!nota) return;
    nota.textContent = testo || "";
    nota.hidden = !testo;
    nota.classList.toggle("errore", !!errore);
  }
  // il segno da cui contare le risposte nuove: l'ora dell'ultima battuta (la storia è una finestra di 150 righe
  // che scorre, quindi contare le battute non basta)
  const segnoOra = (b) => (b.length ? String(b[b.length - 1].ts || "") : "");
  // solo le risposte della voce che ha ricevuto la domanda: sul computer «mac», sul sito telefono e sito
  const dellaMiaVoce = (x) => (S.macchina === "vps" ? x.origine !== "mac" : x.origine === "mac" || !x.origine);
  const risposteDopo = (b, segno) => b.filter((x) => x.chi !== "boss" && dellaMiaVoce(x) && String(x.ts || "") > segno);

  // ------------------------------------------------------------------ 🎤 dettato
  function dettato() {
    if (S.det) { try { S.det.stop(); } catch (e) { /* già fermo */ } return; }
    if (S.conv) chiudiConv();
    const r = window.CCDettato && window.CCDettato.avvia(campo, {
      onErrore: (testo, e) => dici(testo, e !== "no-speech"),
      onFine: () => { S.det = null; segna(mic, false); if (nota && !nota.classList.contains("errore")) dici(""); },
    });
    if (!r) return;
    S.det = r;
    segna(mic, true);
    dici("Ti ascolto… tocca di nuovo il microfono per fermare. Il messaggio non parte da solo.");
  }
  function segna(b, si) {
    if (!b) return;
    b.classList.toggle("attivo", !!si);
    b.setAttribute("aria-pressed", String(!!si));
  }

  // ------------------------------------------------------------------ 📞 parla
  async function tocco() {
    if (S.det) { try { S.det.stop(); } catch (e) { /* niente */ } }
    if (S.macchina === "vps") { S.conv ? chiudiConv() : apriConv(); return; }
    // Mac: la voce di Jarvis ascolta una frase
    if (typeof azione !== "function") return;          // eslint-disable-line no-undef
    const d = await azione({ tipo: "chat_voce_parla" }, parla);    // eslint-disable-line no-undef
    if (!d) return;
    if (d.browser) { S.macchina = "vps"; apriConv(); return; }
    segna(parla, true);
    dici(d.accesa ? "Accendo la voce del computer: quando è pronta senti un suono e ti ascolta." : "Ti ascolto dal microfono del computer: parla, la frase parte dopo un attimo di silenzio.");
    clearTimeout(S.timerMac);
    S.timerMac = setTimeout(() => { segna(parla, false); dici(""); }, d.accesa ? 45000 : T().ascoltoMac);
    S.attesa = { segno: segnoOra(S.battute), da: Date.now() };
    spingi();
  }

  function apriConv() {
    if (!(window.CCDettato && window.CCDettato.riconoscitore())) {
      dici("La conversazione a voce non è disponibile in questo browser: usa il microfono della tastiera.", true);
      return;
    }
    S.conv = true;
    segna(parla, true);
    parla.setAttribute("aria-label", "Chiudi la conversazione a voce");
    ascolta();
  }
  function chiudiConv() {
    S.conv = false;
    S.fase = "";
    clearTimeout(S.timerSil);
    fermaRec();
    taci();
    S.attesa = null;
    fermaSpinta();
    segna(parla, false);
    parla.classList.remove("pensa");
    parla.setAttribute("aria-label", "Parla con Jarvis a voce");
    dici("");
  }
  function fermaRec() {
    const r = S.rec;
    S.rec = null;
    if (r) { try { r.abort ? r.abort() : r.stop(); } catch (e) { /* niente */ } }
  }
  function taci() { try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* niente */ } }

  function ascolta() {
    if (!S.conv) return;
    S.fase = "ascolto";
    parla.classList.remove("pensa");
    campo.value = "";
    dici("Ti ascolto… parla: la frase parte dopo un attimo di silenzio. Tocca 📞 per chiudere.");
    let questo = null;
    questo = window.CCDettato.avvia(campo, {
      onTesto: () => {
        clearTimeout(S.timerSil);
        S.timerSil = setTimeout(() => { if (S.rec === questo) manda(); }, T().silenzio);
      },
      onErrore: (testo, e) => {
        if (e === "no-speech") return;              // silenzio: si riparte da onFine
        dici(testo, true);
        if (e === "not-allowed" || e === "service-not-allowed" || e === "audio-capture" || e === "start") { const m = nota.textContent; chiudiConv(); dici(m, true); }
      },
      onFine: () => {
        if (S.rec !== questo) return;                 // fermato da qui
        S.rec = null;
        // il browser chiude il riconoscimento da solo dopo un po' di silenzio: se c'è testo parte, se no si riascolta
        if (!S.conv || S.fase !== "ascolto") return;
        if (campo.value.trim()) manda(); else setTimeout(ascolta, 300);
      },
    });
    S.rec = questo;
    if (!questo) chiudiConv();
  }

  async function manda() {
    const testo = campo.value.trim();
    clearTimeout(S.timerSil);
    fermaRec();
    if (!S.conv) return;
    if (!testo) { ascolta(); return; }
    S.fase = "pensa";
    parla.classList.add("pensa");
    dici("«" + testo + "» · Jarvis sta pensando…");
    S.attesa = { segno: segnoOra(S.battute), da: Date.now() };
    campo.value = "";
    if (typeof azione !== "function") return;        // eslint-disable-line no-undef
    const d = await azione({ tipo: "chat_voce_manda", testo });    // eslint-disable-line no-undef
    if (!d) { S.attesa = null; if (S.conv) ascolta(); return; }
    spingi();
  }

  // mentre si aspetta la risposta la storia si rilegge ogni 1,5 s (app.js la rilegge già al flusso)
  function spingi() {
    fermaSpinta();
    S.spinta = setInterval(() => {
      if (!S.attesa) { fermaSpinta(); return; }
      if (Date.now() - S.attesa.da > T().tetto) {
        S.attesa = null;
        fermaSpinta();
        if (S.conv) { dici("Nessuna risposta in 3 minuti: riprova.", true); ascolta(); }
        return;
      }
      if (typeof aggiornaChatVoce === "function") aggiornaChatVoce();    // eslint-disable-line no-undef
    }, 1500);
  }
  function fermaSpinta() { clearInterval(S.spinta); S.spinta = null; }

  function nuoveBattute(det) {
    S.battute = det.battute || [];
    if (det.macchina) S.macchina = det.macchina;
    S.voce = !!det.voce;
    if (!S.attesa) return;
    const r = risposteDopo(S.battute, S.attesa.segno);
    if (!r.length) return;
    // le battute nuove di Jarvis (anche più d'una, backtalk spezza le frasi)
    const nuove = r.map((x) => x.testo).join(" ");
    S.attesa = null;
    fermaSpinta();
    if (S.macchina !== "vps") {                       // sul computer la risposta la dice backtalk
      clearTimeout(S.timerMac);
      segna(parla, false);
      dici("");
      return;
    }
    if (!S.conv) return;
    leggi(nuove);
  }

  function leggi(testo) {
    S.fase = "parla";
    parla.classList.remove("pensa");
    dici("Jarvis parla… tocca 📞 per chiudere.");
    S.letti.push(testo);
    const dopo = () => { if (S.conv && S.fase === "parla") setTimeout(ascolta, 700); };   // 700 ms di coda per l'eco
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined" || !testo) { dopo(); return; }
    taci();
    const u = new SpeechSynthesisUtterance(testo);
    u.lang = "it-IT";
    u.rate = 1.05;
    try {
      const it = (speechSynthesis.getVoices() || []).find((v) => /^it([-_]|$)/i.test(v.lang || ""));
      if (it) u.voice = it;
    } catch (e) { /* voce di sistema */ }
    u.onend = dopo;
    u.onerror = dopo;
    speechSynthesis.speak(u);
  }

  function monta() {
    campo = $("chat-voce-testo"); mic = $("chat-voce-mic"); parla = $("chat-voce-parla"); nota = $("chat-voce-nota");
    if (!campo || !parla) return;
    if (mic && window.CCDettato && window.CCDettato.riconoscitore()) {
      mic.hidden = false;
      mic.addEventListener("click", dettato);
    }
    parla.addEventListener("click", tocco);
    window.addEventListener("cc:chat-voce", (ev) => nuoveBattute(ev.detail || {}));
    window.addEventListener("pagehide", () => { if (S.conv) chiudiConv(); });
    // il riquadro nascosto non si rilegge (app.js): appena torna visibile si rilegge subito, non al giro dopo (15 s)
    const subito = () => setTimeout(() => { if (typeof aggiornaChatVoce === "function") aggiornaChatVoce(); }, 60);   // eslint-disable-line no-undef
    window.addEventListener("hashchange", subito);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) subito(); });
    if (typeof aggiornaChatVoce === "function") aggiornaChatVoce();    // eslint-disable-line no-undef
  }
  window.__VOCE_CHAT_STATO = () => ({ macchina: S.macchina, voce: S.voce, conv: S.conv, fase: S.fase, attesa: !!S.attesa,
    dettato: !!S.det, letti: S.letti.slice(-5), n: S.battute.length });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", monta); else monta();
})();
