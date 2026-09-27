// finto.js — il server finto della demo di Jarvis Business.
//
// Si carica PRIMA di app.js (la pagina vera del Command Center, copiata senza modifiche). Fa tre cose:
//  1. mette nella pagina quello che il server vero ci scriverebbe: token, appellativo, lingua, dizionario;
//  2. sostituisce fetch() per gli indirizzi /api/… e risponde con i dati finti di dati/*.js,
//     tenendo lo stato in memoria: i clic funzionano (fili, schede, missioni, conferme, scadenze);
//  3. sostituisce EventSource (/api/flusso, il tempo reale) con un flusso finto che avvisa la pagina
//     a ogni cambio, e fa girare le «sinapsi»: comunicazioni fra agenti ogni pochi secondi.
// Nessuna chiamata di rete vera. Quello che nel prodotto lavora davvero (chat con Claude, telefonate,
// server, terminale, aggiornamenti) qui risponde con un avviso: «nella versione completa…».
(function () {
  "use strict";
  const D = window.DATI_DEMO;
  const ABBONATI = "https://github.com/sponsors/AndyTrust";

  // ------------------------------------------------------------ lingua
  const LINGUE = ["it", "en", "es", "fr", "de"];
  const leggiLS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const scriviLS = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* pazienza */ } };
  const leggiSS = (k) => { try { return JSON.parse(sessionStorage.getItem(k) || "null"); } catch (e) { return null; } };
  const scriviSS = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* pazienza */ } };
  const dalIndirizzo = new URLSearchParams(location.search).get("lang");
  let lingua = LINGUE.includes(dalIndirizzo) ? dalIndirizzo : leggiLS("demo.lingua", "");
  if (!LINGUE.includes(lingua)) {
    const b = String(navigator.language || "").slice(0, 2).toLowerCase();
    lingua = LINGUE.includes(b) ? b : "en";
  }
  if (dalIndirizzo === lingua) scriviLS("demo.lingua", lingua);

  // quello che il server vero scrive nella pagina
  window.CC_TOKEN = "demo";
  window.CC_UTENTE = D.cliente.appellativo;
  window.CC_LINGUA = lingua;
  window.CC_TESTI = {};
  document.documentElement.lang = lingua;
  // il dizionario della lingua scelta (lingue/<codice>.js imposta window.CC_TESTI): da file:// un
  // fetch di JSON non si può fare, uno <script> sì
  if (lingua !== "it") document.write('<script src="lingue/' + lingua + '.js"><\/script>');
  const tr = (s, v) => {
    const x = (lingua !== "it" && window.CC_TESTI && window.CC_TESTI[s]) || s;
    return v ? x.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)) : x;
  };

  // i testi della demo, nelle cinque lingue del pannello
  const TXT = {
    banner: { it: "Demo · dati finti · Jarvis Business completo a 2 $/mese →", en: "Demo · sample data · the full Jarvis Business for $2/month →",
      es: "Demo · datos de ejemplo · Jarvis Business completo por 2 $/mes →", fr: "Démo · données fictives · Jarvis Business complet à 2 $/mois →",
      de: "Demo · Beispieldaten · das komplette Jarvis Business für 2 $/Monat →" },
    pieno: { it: "Nella versione completa qui Jarvis lavora davvero: abbonati per usarlo", en: "In the full version Jarvis really does this: subscribe to use it",
      es: "En la versión completa Jarvis lo hace de verdad: suscríbete para usarlo", fr: "Dans la version complète, Jarvis le fait vraiment : abonne-toi pour l'utiliser",
      de: "In der Vollversion erledigt Jarvis das wirklich: abonniere, um es zu nutzen" },
    chat: { it: "Questa è la demo, con risposte preparate. Nella versione completa qui risponde Claude Code sul tuo computer, con la tua memoria e i tuoi agenti: abbonati a 2 $/mese su " + ABBONATI,
      en: "This is the demo, with prepared answers. In the full version Claude Code answers here, on your computer, with your memory and your agents: subscribe for $2/month at " + ABBONATI,
      es: "Esta es la demo, con respuestas preparadas. En la versión completa responde aquí Claude Code en tu ordenador, con tu memoria y tus agentes: suscríbete por 2 $/mes en " + ABBONATI,
      fr: "Ceci est la démo, avec des réponses préparées. Dans la version complète, c'est Claude Code qui répond ici, sur ton ordinateur, avec ta mémoire et tes agents : abonne-toi pour 2 $/mois sur " + ABBONATI,
      de: "Das ist die Demo mit vorbereiteten Antworten. In der Vollversion antwortet hier Claude Code auf deinem Computer, mit deinem Gedächtnis und deinen Agenten: abonniere für 2 $/Monat unter " + ABBONATI },
    salvato: { it: "Salvato (demo: resta in questa pagina)", en: "Saved (demo: it stays in this page)", es: "Guardado (demo: se queda en esta página)",
      fr: "Enregistré (démo : reste dans cette page)", de: "Gespeichert (Demo: bleibt auf dieser Seite)" },
    missione: { it: "Missione affidata: guarda gli agenti lavorare (demo)", en: "Mission assigned: watch the agents work (demo)", es: "Misión asignada: mira trabajar a los agentes (demo)",
      fr: "Mission confiée : regarde les agents travailler (démo)", de: "Mission vergeben: sieh den Agenten bei der Arbeit zu (Demo)" },
    fatto: { it: "Fatto", en: "Done", es: "Hecho", fr: "Fait", de: "Erledigt" },
  };
  const T = (k) => (TXT[k] && (TXT[k][lingua] || TXT[k].it)) || k;
  const toastDopo = (testo, errore) => setTimeout(() => { if (typeof window.toast === "function") window.toast(testo, !!errore); }, 60);

  // niente service worker nella demo: /sw.js non esiste (e da file:// non si può registrare)
  try { if (window.ServiceWorkerContainer) ServiceWorkerContainer.prototype.register = () => Promise.resolve(null); } catch (e) { /* pazienza */ }

  // ------------------------------------------------------------ tempo
  const ora = () => Date.now() / 1000;
  const due = (n) => String(n).padStart(2, "0");
  const data = (ts) => new Date(ts * 1000);
  const hhmm = (ts) => { const d = data(ts); return due(d.getHours()) + ":" + due(d.getMinutes()); };
  const hhmmss = (ts) => { const d = data(ts); return hhmm(ts) + ":" + due(d.getSeconds()); };
  const giornoISO = (ts) => { const d = data(ts); return d.getFullYear() + "-" + due(d.getMonth() + 1) + "-" + due(d.getDate()); };
  const isoLocale = (ts) => giornoISO(ts) + "T" + hhmmss(ts);
  const dataOra = (ts) => giornoISO(ts) + " " + hhmm(ts);
  const traGiorni = (n) => giornoISO(ora() + n * 86400);
  const clona = (x) => JSON.parse(JSON.stringify(x));
  const AVVIO = ora();

  // ------------------------------------------------------------ lo stato del server finto
  const S = {
    versione: 1, nCom: 0, nId: 0,
    spazi: clona(D.spazi).map((s) => Object.assign(s, { progetti: s.progetti.map((p) => Object.assign(p, {
      esiste: true, archiviati: [],
      agenti: p.agenti.map((a) => profilo(a, p)) })) })),
    gruppiArch: [],
    eventi: D.eventi.map(([fa, testo]) => ({ ts: AVVIO - fa * 60, testo })),
    comunicazioni: [],
    modifiche: [],
    motore: "claude", modo: "lavoro", sentinella: true, voceStato: "idle", richiestaTs: 0,
    voce: D.voce.map(([fa, chi, testo]) => ({ chi, testo, ts: isoLocale(AVVIO - fa * 60) })),
    frequenti: clona(D.catalogo.frequenti),
    diCasa: clona(D.diCasa),
    pannello: leggiSS("demo.pannello"),
    panVer: 1,
  };
  function profilo(a, p) {
    return Object.assign({ capogruppo: false, tono: "", umorismo: 1, attivo: true, comunica: [], riporta_a: "", strumenti: [] }, a, {
      file: p.cartella + "/.claude/agents/" + a.nome + ".md", aggiornato_ts: AVVIO - 86400 * 2 });
  }
  const nuovoId = (pre) => pre + (++S.nId) + Date.now().toString(36).slice(-4);
  function evento(testo) { S.eventi.unshift({ ts: ora(), testo }); S.eventi.length = Math.min(S.eventi.length, 25); }
  const tuttiAg = () => S.spazi.flatMap((s) => s.progetti.flatMap((p) => p.agenti.map((a) => ({ s, p, a }))));
  const trovaAg = (progetto, nome) => tuttiAg().find((x) => x.p.id === progetto && x.a.nome === nome) || null;
  const trovaFile = (file) => tuttiAg().find((x) => x.a.file === file) || null;
  const progettoDi = (id) => { for (const s of S.spazi) for (const p of s.progetti) if (p.id === id) return { s, p }; return null; };

  // i lavori (Squadra › Lavori, e le risposte della chat)
  S.lavori = D.lavori.map((l) => {
    const inizio = AVVIO - l.fa * 60;
    return { id: l.id, titolo: l.titolo, stato: "finito", chi: l.chi, tipo: l.tipo, dove: l.dove,
      inizio: hhmmss(inizio), fine: hhmmss(inizio + l.durata), inizio_ts: inizio, fine_ts: inizio + l.durata,
      richiesta: l.richiesta, log: "~/Jarvis/lavori/" + l.id + ".log", interlocutore: l.chi === "Jarvis" ? "jarvis" : "",
      sessione: "", rilanciabile: true, turni: l.turni, costo: l.costo, codice: 0, _testo: l.testo };
  });

  // le scadenze, con le date vere
  const scad = D.scadenze;
  S.scadenze = {
    registro: scad.registro.map((v) => ({ id: v.id, entro: traGiorni(v.tra), testo: v.testo, tipo: v.tipo, chi: v.chi, eur: v.eur, fonte: "registro", nota: "aperta" })),
    personali: scad.personali.map((v) => ({ id: v.id, entro: traGiorni(v.tra), testo: v.testo, tipo: "", chi: "", eur: v.eur, fonte: "personali", nota: "" })),
    task: scad.task.map((v) => ({ id: v.id, entro: null, testo: v.testo, tipo: "", chi: "", eur: null, fonte: "task",
      nota: "aperta il " + traGiorni(-v.aperta) })),
    chiuse: scad.chiuse.map((v) => ({ id: v.id, entro: v.tra != null ? traGiorni(v.tra) : null, testo: v.testo, tipo: "", chi: "", eur: null,
      fonte: v.fonte, nota: "", chiusa_ts: AVVIO - v.chiusa * 86400, chiusa_da: D.cliente.appellativo, perche: v.perche || "" })),
  };
  function conGiorni(v) {
    const g = v.entro ? Math.round((new Date(v.entro + "T00:00:00") - new Date(giornoISO(ora()) + "T00:00:00")) / 86400000) : null;
    return Object.assign({}, v, { giorni: g, scaduta: g != null && g < 0 });
  }

  // ------------------------------------------------------------ missioni
  const idMissione = (ts) => { const d = data(ts); return giornoISO(ts) + "_" + due(d.getHours()) + due(d.getMinutes()) + due(d.getSeconds()); };
  const inizioMissione = (ts) => { const d = data(ts); return due(d.getDate()) + "/" + due(d.getMonth() + 1) + " " + hhmm(ts); };
  S.missioni = [];
  for (const x of D.missioni) {
    const t0 = AVVIO - x.fa * 60;
    const pr = progettoDi(x.progetto);
    const capi = pr.p.agenti.filter((a) => a.capogruppo).map((a) => a.nome);
    const m = { id: idMissione(t0), progetto: pr.p.nome, ceo: capi[0] || null, spazio: pr.s.nome, capogruppi: capi, modalita: x.modalita,
      max_paralleli: x.max, obiettivo: x.obiettivo, inizio: inizioMissione(t0), stato: x.stato, richieste: [], agenti: [],
      report: x.report || "", _pid: pr.p.id, _t0: t0, _chiave: x.chiave, _dopo: x.dopo || null, _piano: [],
      _reg: x.registro.map(([min, testo]) => hhmmss(t0 + min * 60 + 2) + " " + testo) };
    x.agenti.forEach((a, i) => {
      const prof = pr.p.agenti.find((z) => z.nome === a.nome) || {};
      m.agenti.push({ id: "g" + x.chiave + i, tipo: a.nome, descrizione: a.descrizione, modello: prof.modello || "sonnet", capogruppo: !!a.capogruppo,
        stato: a.stato, chiesto: isoLocale(t0 + a.da * 60), inizio: isoLocale(t0 + a.da * 60), fine: a.a != null ? isoLocale(t0 + a.a * 60) : "",
        esito: a.esito || "", ultima: a.ultima || "" });
    });
    if (x.richiesta) m.richieste.push({ id: "r1", strumento: x.richiesta.strumento, sintesi: x.richiesta.sintesi, dettaglio: x.richiesta.dettaglio,
      ora: hhmm(AVVIO - x.richiesta.fa * 60) });
    S.missioni.push(m);
  }
  const reg = (m, testo) => m._reg.push(hhmmss(ora()) + " " + testo);
  const passo = (m, secondi, fn) => m._piano.push({ quando: ora() + secondi, fn });
  function nuovoAgenteMissione(m, a, compito) {
    const ag = { id: nuovoId("g"), tipo: a.nome, descrizione: compito, modello: a.modello, capogruppo: !!a.capogruppo, stato: "lavora",
      chiesto: isoLocale(ora()), inizio: isoLocale(ora()), fine: "", esito: "", ultima: "Read: " + (a.capogruppo ? "esiti/" : "") + compito.split(" ")[0].toLowerCase() + ".md" };
    m.agenti.push(ag);
    return ag;
  }
  function consegna(m, ag, esito) { ag.stato = "consegnato"; ag.fine = isoLocale(ora()); ag.esito = esito; ag.ultima = ""; reg(m, "consegnato " + ag.tipo); }
  const esitoFinto = (compito) => "Consegnato (demo): " + compito + ".\n\nNella versione completa qui c'è il lavoro vero dell'agente: cosa ha letto, cosa ha trovato, cosa ha cambiato e cosa aspetta il tuo sì.";
  // una missione nuova: gli esperti partono sfalsati, consegnano, il capogruppo verifica, la missione si chiude
  function nuovaMissione({ spazio, progetti, obiettivo, modalita, max, soloChiavi, titolo, fine }) {
    const sp = S.spazi.find((s) => s.id === spazio) || S.spazi[0];
    let prog = sp.progetti.filter((p) => (progetti || []).includes(p.id));
    if (!prog.length && !soloChiavi) prog = [sp.progetti[0]];
    if (soloChiavi) prog = S.spazi.flatMap((s) => s.progetti).filter((p) => soloChiavi.some((k) => k.startsWith(p.id + ":")));
    const capi = prog.flatMap((p) => p.agenti.filter((a) => a.capogruppo && a.attivo !== false).map((a) => ({ a, p })));
    let esperti = prog.flatMap((p) => p.agenti.filter((a) => !a.capogruppo && a.attivo !== false).map((a) => ({ a, p })));
    if (soloChiavi) esperti = esperti.filter(({ a, p }) => soloChiavi.includes(p.id + ":" + a.nome));
    esperti = esperti.slice(0, Math.max(1, Math.min(10, max || 5)));
    let t0 = ora();
    while (S.missioni.some((x) => x.id === idMissione(t0))) t0 += 1;
    const pid = (prog[0] || sp.progetti[0]).id;
    const orch = pid + ":orchestratore";
    const m = { id: idMissione(t0), progetto: prog.map((p) => p.nome).join(" + ") || sp.nome, ceo: capi.length ? capi[0].a.nome : null,
      spazio: soloChiavi ? "" : sp.nome, capogruppi: capi.map((c) => c.a.nome), modalita: modalita || "lettura", max_paralleli: max || 5,
      obiettivo, inizio: inizioMissione(t0), stato: "in avvio", richieste: [], agenti: [], report: "", _pid: pid, _t0: t0, _piano: [], _reg: [] };
    reg(m, "orchestratore: missione ricevuta da Jarvis, " + esperti.length + " esperti, modo " + m.modalita);
    S.missioni.unshift(m);
    evento("Nuova: missione «" + obiettivo.slice(0, 60) + "» (" + (m.spazio || m.progetto) + ")");
    sinapsi("jarvis", orch, "lancio", obiettivo.slice(0, 90));
    passo(m, 1.5, () => { m.stato = "in corso"; });
    let fineEsperti = 3;
    esperti.forEach(({ a, p }, i) => {
      const compito = a.descrizione.split(/[:,.]/)[0].toLowerCase();
      const parte = 2.5 + i * 1.6, consegnaT = parte + 5 + (i % 3) * 2;
      fineEsperti = Math.max(fineEsperti, consegnaT);
      let ag = null;
      passo(m, parte, () => { ag = nuovoAgenteMissione(m, a, compito); reg(m, "lancio " + a.nome + ": " + compito); sinapsi(orch, p.id + ":" + a.nome, "lancio", compito); });
      passo(m, consegnaT, () => {
        consegna(m, ag, esitoFinto(compito));
        const capo = p.agenti.find((z) => z.capogruppo);
        sinapsi(p.id + ":" + a.nome, capo ? p.id + ":" + capo.nome : "jarvis", "risposta", T("fatto") + ": " + compito, "finito");
      });
    });
    let t = fineEsperti + 1;
    for (const { a, p } of capi) {
      let ag = null;
      passo(m, t, () => { ag = nuovoAgenteMissione(m, a, "verifica il lavoro della squadra"); reg(m, "lancio " + a.nome + " (capogruppo): verifica"); sinapsi(orch, p.id + ":" + a.nome, "lancio", "verifica il lavoro della squadra"); });
      passo(m, t + 4, () => { consegna(m, ag, "Verificato il lavoro di " + esperti.length + " esperti (demo).\n\nObiettivo: " + obiettivo);
        sinapsi(p.id + ":" + a.nome, "jarvis", "risposta", "Verificato: " + obiettivo.slice(0, 70), "finito"); });
      t += 5;
    }
    passo(m, t + 1, () => {
      m.stato = "chiusa";
      m.report = "~/Jarvis/Report/" + (sp.nome) + "/" + (titolo || obiettivo.slice(0, 40)).replace(/[\\/:*?"<>|]/g, "") + ".pdf";
      reg(m, "report scritto · missione chiusa");
      evento("finito: missione «" + obiettivo.slice(0, 50) + "»");
      sinapsi("jarvis", "boss", "risposta", (titolo ? titolo + ": " : "") + "missione chiusa, report pronto", "finito");
      if (fine) fine(m);
    });
    return m;
  }
  // la missione del lancio aspetta il Sì: dopo la risposta si chiude da sola
  function dopoConferma(m, ok, nota) {
    m.richieste = [];
    m.stato = "in corso";
    reg(m, ok ? "conferma: Capo ha detto sì" : "conferma: Capo ha detto no" + (nota ? " (" + nota + ")" : ""));
    const pid = m._pid, orch = pid + ":orchestratore";
    const rev = m.agenti.find((a) => a.stato === "lavora");
    const capo = progettoDi(pid).p.agenti.find((a) => a.capogruppo);
    passo(m, 2.5, () => {
      if (rev) { consegna(m, rev, (m._dopo && m._dopo.revisore) || esitoFinto("controllo finale")); sinapsi(pid + ":" + rev.tipo, pid + ":" + capo.nome, "risposta", "Controllo finito: si può pubblicare.", "finito"); }
    });
    let ag = null;
    passo(m, 3.5, () => { ag = nuovoAgenteMissione(m, capo, "verifica e pubblicazione"); reg(m, "lancio " + capo.nome + " (capogruppo): verifica"); sinapsi(orch, pid + ":" + capo.nome, "lancio", ok ? "pubblica e verifica" : "tieni le schede in bozza"); });
    passo(m, 8, () => {
      consegna(m, ag, ok ? ((m._dopo && m._dopo.capogruppo) || esitoFinto("verifica")) :
        "Pubblicazione annullata come chiesto. Le 12 schede restano in bozza, pronte per quando dici sì.");
      sinapsi(pid + ":" + capo.nome, "jarvis", "risposta", ok ? "Collezione online: 12 schede pubblicate." : "Schede lasciate in bozza.", "finito");
    });
    passo(m, 9, () => {
      m.stato = "chiusa";
      m.report = "~/Jarvis/Report/Negozio online/Lancio collezione autunno.pdf";
      reg(m, "report scritto · missione chiusa");
      evento("finito: missione «lancio collezione autunno»");
      sinapsi("jarvis", "boss", "risposta", ok ? "Il lancio è fatto: la collezione è online." : "Lancio fermato: schede in bozza.", "finito");
    });
  }
  function missionePubblica(m) {
    const o = {};
    for (const [k, v] of Object.entries(m)) if (!k.startsWith("_")) o[k] = v;
    return o;
  }
  function agentiAttivi() {
    return S.missioni.filter((m) => ["in avvio", "in corso", "attende conferma", "attende istruzioni"].includes(m.stato)).map((m) => ({
      chi: "orchestratore", spazio: m.spazio, progetto: m.progetto, stato: m.stato, ts: m._t0,
      esperti: m.agenti.filter((a) => a.stato === "lavora").map((a) => ({ nome: a.tipo, inizio: a.inizio, ultima: a.ultima, descrizione: a.descrizione })),
      ultimo: m._reg[m._reg.length - 1] || "" }));
  }

  // ------------------------------------------------------------ sinapsi e flusso finto
  function sinapsi(da, a, tipo, testo, stato) {
    const c = { id: "c" + (++S.nCom), ts: ora(), da, a, testo, tipo: tipo || "richiesta", stato: stato || "in corso" };
    S.comunicazioni.unshift(c);
    if (S.comunicazioni.length > 60) S.comunicazioni.length = 60;
    if (da === "boss") S.richiestaTs = c.ts;
    return c;
  }
  const FLUSSI = new Set();
  function tocca(chiavi) {
    S.versione++;
    const msg = { data: JSON.stringify({ versione: S.versione, chiavi: chiavi || ["stato"], ts: ora() }) };
    for (const es of FLUSSI) if (typeof es.onmessage === "function") { try { es.onmessage(msg); } catch (e) { /* la pagina se la cava */ } }
  }
  class FlussoFinto {
    constructor(url) {
      this.url = String(url); this.readyState = 0; this.withCredentials = false;
      this.onopen = null; this.onmessage = null; this.onerror = null;
      FLUSSI.add(this);
      setTimeout(() => { if (this.readyState === 2) return; this.readyState = 1; if (typeof this.onopen === "function") this.onopen({ type: "open" }); }, 250);
    }
    close() { this.readyState = 2; FLUSSI.delete(this); }
    addEventListener() { /* la pagina usa onopen / onmessage */ }
    removeEventListener() { /* idem */ }
  }
  FlussoFinto.CONNECTING = 0; FlussoFinto.OPEN = 1; FlussoFinto.CLOSED = 2;
  window.EventSource = FlussoFinto;

  // il giro delle sinapsi: una comunicazione nuova ogni pochi secondi, le vecchie si chiudono
  let giroSinapsi = 0;
  function battito() {
    const t = ora();
    for (const c of S.comunicazioni) if (c.stato === "in corso" && t - c.ts > 5.5) c.stato = "finito";
    const s = D.sinapsi[giroSinapsi % D.sinapsi.length];
    giroSinapsi++;
    sinapsi(s.da, s.a, s.tipo, s.testo);
    if (s.a === "jarvis" || s.da === "jarvis") S.voceStato = s.a === "boss" ? "speaking" : "thinking";
    else S.voceStato = "idle";
    tocca(["stato"]);
  }
  function avanzaMissioni() {
    let cambiato = false;
    for (const m of S.missioni) {
      m._piano.sort((a, b) => a.quando - b.quando);
      while (m._piano.length && ora() >= m._piano[0].quando) { const p = m._piano.shift(); try { p.fn(m); } catch (e) { /* passo saltato */ } cambiato = true; }
    }
    if (cambiato) tocca(["stato"]);
  }
  let inPausa = false;
  setInterval(() => { if (!document.hidden && !inPausa) battito(); }, 3200);
  setInterval(avanzaMissioni, 700);
  // qualche sinapsi già in corso all'apertura, così la lavagna è viva da subito
  for (let i = 0; i < 3; i++) { const s = D.sinapsi[giroSinapsi++]; const c = sinapsi(s.da, s.a, s.tipo, s.testo); c.ts -= (3 - i) * 1.5; }

  // ------------------------------------------------------------ lo stato come lo manda /api/stato
  function claudeOra() {
    const t = ora();
    const vive = S.comunicazioni.filter((c) => c.stato === "in corso" || t - c.ts < 4);
    const agenti = [];
    for (const c of vive) for (const k of [c.da, c.a]) {
      if (/^(boss|jarvis|memoria|sentinella)$/.test(k) || /:orchestratore$/.test(k)) continue;
      const nome = k.split(":").pop();
      if (!agenti.some((g) => g.nodo === nome)) agenti.push({ stato: "attivo", nodo: nome, tipo: nome, ts: c.ts, descrizione: c.testo.slice(0, 60) });
    }
    const lavora = vive.some((c) => c.da === "jarvis" || c.a === "jarvis");
    const ultimaBoss = S.comunicazioni.find((c) => c.da === "boss");
    return { lavorando: lavora, richiesta: ultimaBoss ? ultimaBoss.testo : "", richiesta_ts: S.richiestaTs || (ultimaBoss ? ultimaBoss.ts : 0),
      azione: lavora ? "coordina la squadra" : "", dettaglio: "", agenti };
  }
  const RACCOGLITORI = [["raccogli_locale", "locale", 5], ["raccogli_locale_pesante", "", 15], ["raccogli_vps", "vps", 60], ["raccogli_memoria", "memoria", 120],
    ["raccogli_catena", "catena", 120], ["raccogli_claude", "claude", 300], ["raccogli_telefono", "telefono", 10], ["raccogli_telegram", "telegram", 20],
    ["raccogli_agenti", "agenti", 20], ["raccogli_portiere", "portiere", 20], ["sentinella", "sentinella", 60], ["raccogli_comunicazioni", "", 2],
    ["archivia_missioni_vecchie", "", 300], ["sorveglia_file", "", 2]];
  function stato() {
    const t = ora();
    const mem = D.memoria;
    const modelli = {};
    for (const { a } of tuttiAg()) modelli[a.nome] = a.modello;
    for (const a of S.diCasa) modelli[a.nome] = a.modello;
    const inCorsoLav = S.lavori.filter((l) => l.stato === "in corso");
    return {
      locale: {
        voce: true, voce_stato: S.voceStato, volto: true, mani: false, telefono: true, schermo_telefono: false,
        chiede_prima: true, al_pc: false, fidata: true,
        mac: { cpu: 9 + Math.round(Math.random() * 12), ram: 52 + Math.round(Math.random() * 5) },
        android: { installato: true, dispositivi: [{ modello: "Pixel 8" }], batteria: 78, schermo: false, controllo: true,
          ponte: { raggiungibile: true, app_collegata: true, versione_offerta: "1.0.1" } },
        voci: { voce_accesa: true, ascolto: { nome: "Whisper", dettaglio: "large-v3-turbo", lingua: "it" }, cervello: { nome: "Claude" },
          motori: [{ id: "gemini", nome: "Gemini", attivo: true, nota: "la prima voce, finché c'è credito" },
            { id: "kokoro", nome: "Kokoro", attivo: true, nota: "locale, parla quando Gemini non risponde" }],
          ultimo_motore: "gemini", ultimo_ts: t - 720 },
        agenti_sessioni: { aggiornato: t - 3, orfani: 0, sessioni: [
          { pid: 4312, lavora: true, cpu: 3.4, acceso: "00:27:10", dove: "~/Progetti/Negozio online", cosa: "claude", nome: "negozio-lancio-collezione" },
          { pid: 3981, lavora: false, cpu: 0.2, acceso: "02:10:44", dove: "~/Jarvis", cosa: "claude", nome: "jarvis-chat" }] },
        letto_ts: t - 2, errore: "",
      },
      vps: Object.assign(clona(D.server), { raggiungibile: true, configurata: true, letto: hhmm(t - 30), letto_ts: t - 30, errore: "" }),
      memoria: {
        note: mem.note, sessioni: mem.sessioni, diario_oggi: true, sviluppi: mem.sviluppi,
        battito: { quando: dataOra(t - 180), acceso: true, minuti_fa: 3, perche: "", indietro: [], copie: [],
          progetti: mem.progetti.map((p) => ({ progetto: p.progetto, semaforo: "🟢", esito: "in ordine",
            memoria: dataOra(AVVIO - p.memoria_fa * 60) + ":00", memoria_file: p.progetto + "/.claude/memoria/MEMORIA.md",
            da_fare: p.da_fare, errori: p.errori, lavoro: dataOra(AVVIO - p.lavoro_fa * 60) + ":00", lavoro_file: "", ore_indietro: 0 })) },
        letto_ts: t - 40, errore: "",
      },
      telefono: { centralino: false, registrazione: "", risposta_armata: false, ponte_locale: true, ponte_gemini: false,
        chiamate: D.telefono.chiamate.map((c) => Object.assign({}, c, { quando: isoLocale(AVVIO - c.fa * 60) })), letto_ts: t - 4, errore: "" },
      telegram: { mac: { macchina: "mac", sessione: true, lettore: 4411, token: true, spento: false, avviato: dataOra(AVVIO - 7200), guardia: true, occupato: null, bot: "@RossiJarvis_bot" },
        letto_ts: t - 5, errore: "" },
      claude: { collegato: true, metodo: "claude.ai", errore: "", letto_ts: t - 60 },
      portiere: { quando_ts: t - 25, chiavi_in_giro: 1, da_guardare: [], fantasmi: 0, sessioni: 2, lavori_vivi: inCorsoLav.length, letto_ts: t - 25, errore: "" },
      catena: { jarvis: S.diCasa.map((a) => a.nome), progetti: [], modelli, letto_ts: t - 50, errore: "" },
      sentinella: { acceso: S.sentinella, quando_ts: t - 35, anomalie: [], nuove: 0, ogni_azione_min: 15, modello: "",
        ultimo_rapporto: dataOra(t - 900) + " · " + D.sentinella, ultimo_rapporto_ts: t - 900, letto_ts: t - 35, errore: "" },
      eventi: S.eventi.slice(0, 25).map((e) => ({ ora: hhmmss(e.ts), testo: e.testo })),
      lavori: S.lavori.slice().sort((a, b) => b.inizio_ts - a.inizio_ts).slice(0, 20).map(lavoroPubblico),
      missioni: S.missioni.map(missionePubblica),
      agenti_attivi: agentiAttivi(),
      claude_ora: claudeOra(),
      ora: isoLocale(t), ora_ts: t, versione: S.versione,
      salute: { server_da_ts: AVVIO - 3 * 3600 - 1260, pid: 4242, raccoglitori: RACCOGLITORI.map(([nome, chiave, ogni], i) => ({
        nome, chiave, ogni, ultimo_ok_ts: t - ((i * 7) % Math.max(2, Math.round(ogni * 0.8))) - 1, errore: "" })) },
      comunicazioni: S.comunicazioni.slice(),
      modo_chat: S.modo,
      aggiornamento: { versione: "0.4.0", nuova: null, controllato: giornoISO(t), copie: 1, in_corso: false, fallita: null, si_aggiorna: true },
    };
  }
  function lavoroPubblico(l) {
    const o = {};
    for (const [k, v] of Object.entries(l)) if (!k.startsWith("_")) o[k] = v;
    return o;
  }

  // ------------------------------------------------------------ catalogo e spazi
  function spaziPubblici() {
    return S.spazi.map((s) => ({ id: s.id, nome: s.nome, memoria: s.memoria, report: s.report,
      progetti: s.progetti.map((p) => ({ id: p.id, nome: p.nome, cartella: p.cartella, capogruppo: p.capogruppo, esiste: true,
        archiviati: p.archiviati.map((a) => ({ nome: a.nome })),
        agenti: p.agenti.map((a) => ({ nome: a.nome, modello: a.modello, capogruppo: !!a.capogruppo, file: a.file, strumenti: a.strumenti,
          tono: a.tono, umorismo: a.umorismo, attivo: a.attivo !== false, comunica: a.comunica.slice(), riporta_a: a.riporta_a || "",
          aggiornato_ts: a.aggiornato_ts, descrizione: a.descrizione })) })) }));
  }
  function catalogo() {
    const c = clona(D.catalogo);
    c.spazi = spaziPubblici();
    c.frequenti = S.frequenti;
    return c;
  }
  function gruppiArchiviati() {
    return S.gruppiArch.map((g) => ({ progetto: g.p.id, nome: g.p.nome, spazio: g.spazio, ts: g.ts }));
  }
  function corpoProfilo(a) {
    const riga = a.comunica.length ? "\n\n<!-- comunica-con:inizio (scritto dalla lavagna) -->\nQuesto agente comunica con " + a.comunica.join(", ") + ".\n<!-- comunica-con:fine -->\n" : "";
    return "# " + a.nome + "\n\n" + a.descrizione + ".\n\nTono: " + (a.tono || "—") + "." + riga;
  }

  // ------------------------------------------------------------ la lavagna generale, già a piramide
  // Stesso disegno di «Tutta la catena» in app.js (popolaCatenaCompleta): capo, Jarvis con la memoria e
  // gli agenti di casa, gli spazi, i capigruppo e la squadra in colonna; poi i fili dei «comunica con».
  function lavagnaGenerale() {
    const C = { LARG: 212, SCHEDA: 192, PASSO: 70, PER_COLONNA: 6, GRUPPO: 56, PROGETTO: 24, Y_BOSS: 0, Y_JARVIS: 110, Y_SPAZIO: 220, Y_CAPI: 330, Y_SQUADRA: 430 };
    const nodi = [], fili = [];
    let n = 0;
    const nota = (testo, x, y) => { const o = { id: "d" + (++n), tipo: "nota", testo, x: Math.round(x), y: Math.round(y) }; nodi.push(o); return o; };
    const ag = (k, x, y) => { const o = { id: "d" + (++n), tipo: "agente", agente: k, x: Math.round(x), y: Math.round(y) }; nodi.push(o); return o; };
    const filo = (a, b) => { if (a && b && a.id !== b.id && !fili.some((f) => (f.da === a.id && f.a === b.id) || (f.da === b.id && f.a === a.id))) fili.push({ da: a.id, a: b.id }); };
    const utente = D.cliente.appellativo;
    const senzaCapo = tr("senza capogruppo");
    const spazi = S.spazi.map((s) => ({ s, rami: s.progetti.filter((p) => p.agenti.length).map((p) => ({ p,
      capo: p.agenti.find((a) => a.capogruppo) || null, squadra: p.agenti.filter((a) => !a.capogruppo) })) })).filter((g) => g.rami.length);
    const colonne = (r) => (r.squadra.length > C.PER_COLONNA ? 2 : 1);
    const largRamo = (r) => colonne(r) * C.LARG;
    const largSpazio = (g) => g.rami.reduce((w, r) => w + largRamo(r), 0) + C.PROGETTO * (g.rami.length - 1);
    const totale = spazi.reduce((w, g) => w + largSpazio(g), 0) + C.GRUPPO * (spazi.length - 1);
    const xCentro = totale / 2 - C.SCHEDA / 2;
    const nBoss = nota(utente, xCentro, C.Y_BOSS);
    const nJarvis = nota(tr("Jarvis — orchestratore, risponde a {utente}", { utente }), xCentro, C.Y_JARVIS);
    filo(nBoss, nJarvis);
    filo(nJarvis, nota(tr("Memoria"), xCentro - 2 * C.LARG, C.Y_JARVIS));
    S.diCasa.forEach((a, i) => filo(nJarvis, nota(a.nome + " · " + a.modello, xCentro + (i + 1) * C.LARG, C.Y_JARVIS)));
    const perChiave = new Map();
    let x = 0;
    for (const g of spazi) {
      nota(g.s.nome, x, C.Y_SPAZIO);
      for (const r of g.rami) {
        const testa = r.capo ? ag(r.p.id + ":" + r.capo.nome, x, C.Y_CAPI) : nota(r.p.nome + " · " + senzaCapo, x, C.Y_CAPI);
        if (r.capo) perChiave.set(r.p.id + ":" + r.capo.nome, testa);
        filo(nJarvis, testa);
        const perColonna = Math.ceil(r.squadra.length / colonne(r));
        r.squadra.forEach((a, i) => {
          const col = Math.floor(i / perColonna), riga = i % perColonna;
          const nd = ag(r.p.id + ":" + a.nome, x + col * C.LARG, C.Y_SQUADRA + riga * C.PASSO);
          perChiave.set(r.p.id + ":" + a.nome, nd);
          filo(testa, nd);
        });
        x += largRamo(r) + C.PROGETTO;
      }
      x += C.GRUPPO - C.PROGETTO;
    }
    // i «comunica con» dei profili: prima nello stesso progetto, poi negli altri
    for (const { p, a } of tuttiAg()) for (const nome of a.comunica) {
      const b = tuttiAg().find((z) => z.p.id === p.id && z.a.nome === nome) || tuttiAg().find((z) => z.a.nome === nome);
      if (b) filo(perChiave.get(p.id + ":" + a.nome), perChiave.get(b.p.id + ":" + b.a.nome));
    }
    return { nodi, fili, vista: { x: 0, y: 0, zoom: 1 } };
  }
  function pannello() {
    if (!S.pannello) S.pannello = { gruppi: [], aspetto: {}, lavagne: { generale: lavagnaGenerale() } };
    return Object.assign(clona(S.pannello), { aggiornato: dataOra(ora()), versione: S.panVer });
  }
  // la prima volta che si apre la lavagna generale, la vista si adatta alle schede (il tasto «Centra»)
  function centraAllaPrimaVisita() {
    if (location.hash !== "#lavagna" || leggiSS("demo.centrata")) return;
    let tentativi = 0;
    const prova = () => {
      const lav = document.getElementById("lavagna"), bottone = document.getElementById("lav-centra");
      const pronta = lav && lav.getBoundingClientRect().width > 100 && document.querySelector("#lav-mondo .nodo");
      const titolo = document.getElementById("lav-titolo");
      if (pronta && bottone && titolo && !titolo.textContent) { scriviSS("demo.centrata", true); bottone.click(); return; }
      if (pronta && titolo && titolo.textContent) return;          // è aperta un'altra lavagna: si lascia com'è
      if (++tentativi < 40) setTimeout(prova, 150);
    };
    setTimeout(prova, 200);
  }
  addEventListener("hashchange", centraAllaPrimaVisita);
  addEventListener("DOMContentLoaded", centraAllaPrimaVisita);

  // ------------------------------------------------------------ il banner
  addEventListener("DOMContentLoaded", () => {
    const b = document.getElementById("demo-banner");
    if (b) { b.querySelector("span").textContent = T("banner"); b.href = ABBONATI; }
    document.body.classList.add("con-banner-demo");
  });

  // ------------------------------------------------------------ le azioni
  const PESANTI = new Set(["chat", "interruttore", "telegram_riaggancia", "android", "telefono", "tecnico", "aggiornamento", "apri", "mostra_log",
    "verifica", "comando", "comando_claude_code", "portiere", "sincronia_comando", "apri_percorso_sincronia", "rilancia"]);
  function modifica(tipo, progetto, agente, extra) {
    S.modifiche.push(Object.assign({ ts: ora(), tipo, progetto, agente, da: "lavagna" }, extra || {}));
    tocca(["modifiche"]);
  }
  function rispostaChat(testo, agenteNome) {
    const r = D.risposte.find((x) => x.se.test(testo));
    const corpo = r ? r.testo : (agenteNome ? "Sono **" + agenteNome + "**. Nella versione completa rispondo io, con il mio profilo, la memoria del progetto e i file veri." : "");
    return (corpo ? corpo + "\n\n" : "") + "— " + T("chat");
  }
  function lavoroChat(titolo, chi, interlocutore, richiesta, testo, tipo) {
    const t = ora();
    const l = { id: nuovoId("c"), titolo: titolo.slice(0, 80), stato: "in corso", chi, tipo: tipo || "chat", dove: "~/Jarvis",
      inizio: hhmmss(t), fine: "", inizio_ts: t, fine_ts: null, richiesta, log: "~/Jarvis/lavori/chat.log", interlocutore,
      sessione: "", rilanciabile: false, turni: 1, costo: "", codice: null, _testo: testo, _pronto: t + 2.2 + Math.random() * 1.5 };
    S.lavori.push(l);
    return l;
  }
  function chiudiLavoriPronti() {
    let cambiato = false;
    for (const l of S.lavori) if (l.stato === "in corso" && l._pronto && ora() >= l._pronto) {
      l.stato = "finito"; l.fine_ts = ora(); l.fine = hhmmss(l.fine_ts); l.codice = 0; cambiato = true;
      if (l.tipo === "chat") evento("finito: " + l.titolo);
    }
    if (cambiato) tocca(["stato"]);
  }
  setInterval(chiudiLavoriPronti, 500);

  function azione(c) {
    const tipo = c.tipo;
    if (PESANTI.has(tipo) || (tipo === "agente" && !c.cosa)) return { messaggio: T("pieno") };
    switch (tipo) {
      case "chiedi": {
        const ag = c.agente ? (trovaAg(c.progetto, c.agente) || {}).a : null;
        const k = ag ? c.progetto + ":" + ag.nome : "jarvis";
        sinapsi("boss", k === "jarvis" ? "jarvis" : k, "richiesta", String(c.testo).split("\n")[0].slice(0, 90));
        const l = lavoroChat(String(c.testo).split("\n")[0], ag ? ag.nome : "Jarvis", k, c.testo, rispostaChat(String(c.testo), ag ? ag.nome : ""));
        toastDopo(T("pieno"));
        tocca(["stato"]);
        return { messaggio: "", lavoro: { id: l.id, titolo: l.titolo } };
      }
      case "comando_diretto": {
        const risposte = {
          memoria: "Nella memoria, per «" + (c.arg || "…") + "»:\n\n- Negozio online › decisioni › «+30% di scorta su M e L»\n- Negozio online › errori › «le foto vanno caricate prima delle schede»\n- Studio › clienti › «riepilogo fatture: il commercialista lo vuole entro il 10»",
          brain: "**A che punto siamo** (Negozio online)\n\n- fatto: schede della collezione, scorte, parole chiave\n- da fare: pubblicare (aspetta il tuo sì), post di lancio\n- errori da non ripetere: 3",
          lavori: "Chi lavora adesso: la squadra del Negozio online (missione «lancio collezione autunno»). Chiavi prese: nessuna risorsa condivisa bloccata.",
          verifica: "Sincronia: 4 progetti in ordine, nessuno indietro. Ultimo giro della memoria 3 minuti fa.",
        };
        const l = lavoroChat("/" + c.nome + (c.arg ? " " + c.arg : ""), "Jarvis", "jarvis", "/" + c.nome, (risposte[c.nome] || "") + "\n\n— " + T("chat"), "comando");
        tocca(["stato"]);
        return { lavoro: { id: l.id, titolo: l.titolo } };
      }
      case "chat_voce_manda": {
        S.voce.push({ chi: "boss", testo: String(c.testo || ""), ts: isoLocale(ora()) });
        setTimeout(() => { S.voce.push({ chi: "jarvis", testo: T("pieno") + ".", ts: isoLocale(ora()) }); tocca(["stato"]); }, 2200);
        toastDopo(T("pieno"));
        return { messaggio: "" };
      }
      case "missione": {
        const obiettivo = String(c.obiettivo || "").trim();
        if (!obiettivo) throw new Error(tr("Scrivi l'obiettivo della missione"));
        const m = nuovaMissione({ spazio: c.spazio, progetti: c.progetti, obiettivo, modalita: c.modalita, max: Number(c.max_paralleli) || 5 });
        tocca(["stato"]);
        return { messaggio: T("missione"), missione: m.id };
      }
      case "conferma": {
        const m = S.missioni.find((x) => x.id === c.missione);
        if (!m || !m.richieste.some((r) => r.id === c.richiesta)) throw new Error(tr("richiesta non trovata"));
        dopoConferma(m, !!c.ok, c.nota || "");
        sinapsi("boss", m._pid + ":orchestratore", "risposta", c.ok ? "Sì: pubblica." : "No: " + (c.nota || "aspetta"), "finito");
        tocca(["stato"]);
        return { messaggio: c.ok ? tr("risposto: sì") : tr("risposto: no") };
      }
      case "istruzione": {
        const m = S.missioni.find((x) => x.id === c.missione);
        if (!m || !String(c.testo || "").trim()) throw new Error(tr("messaggio vuoto"));
        reg(m, "istruzione da Capo: " + c.testo);
        sinapsi("boss", m._pid + ":orchestratore", "richiesta", String(c.testo).slice(0, 90));
        tocca(["stato"]);
        return { messaggio: T("salvato") };
      }
      case "chiudi_missione": {
        const i = S.missioni.findIndex((x) => x.id === c.missione);
        if (i < 0) throw new Error(tr("missione non trovata"));
        const m = S.missioni[i];
        if (["chiusa", "interrotta", "errore"].includes(m.stato)) S.missioni.splice(i, 1);
        else { m._piano = []; m.richieste = []; m.stato = "chiusa"; for (const a of m.agenti) if (a.stato === "lavora") consegna(m, a, "Fermato: missione chiusa da Capo."); reg(m, "missione chiusa da Capo"); }
        tocca(["stato"]);
        return { messaggio: T("fatto") };
      }
      case "scadenze": return azioneScadenze(c);
      case "agente": return azioneAgente(c);
      case "modo_chat": S.modo = c.modo === "lettura" ? "lettura" : "lavoro"; tocca(["stato"]); return { modo: S.modo, messaggio: T("fatto") };
      case "lingua": if (LINGUE.includes(c.lingua)) scriviLS("demo.lingua", c.lingua); return { messaggio: "" };
      case "frequenti": S.frequenti = S.frequenti.filter((f) => f.testo !== c.testo); return { messaggio: T("fatto") };
      case "aggiorna": tocca(["stato"]); return { messaggio: T("fatto") };
      case "sentinella":
        if (c.cosa === "acceso") { S.sentinella = !!c.valore; tocca(["stato"]); return { messaggio: T("fatto") }; }
        sinapsi("sentinella", "jarvis", "sentinella", "Giro regolare: nessuna anomalia.", "finito");
        tocca(["stato"]);
        return { messaggio: T("fatto") };
      case "ferma": {
        const l = S.lavori.find((x) => x.id === c.id);
        if (l && l.stato === "in corso") { l.stato = "errore"; l.codice = -15; l.fine_ts = ora(); l.fine = hhmmss(l.fine_ts); l._testo = (l._testo || "") + "\n\n(fermato)"; }
        tocca(["stato"]);
        return { messaggio: T("fatto") };
      }
      case "togli_lavoro": S.lavori = S.lavori.filter((l) => l.id !== c.id); tocca(["stato"]); return { messaggio: T("fatto") };
      case "pulisci_lavori": S.lavori = S.lavori.filter((l) => l.stato === "in corso"); tocca(["stato"]); return { messaggio: T("fatto") };
      default: return { messaggio: T("pieno") };
    }
  }
  function azioneScadenze(c) {
    const lista = (f) => S.scadenze[f];
    const togli = (fonte, id, perche) => {
      const L = lista(fonte) || [];
      const i = L.findIndex((v) => v.id === id);
      if (i < 0) return false;
      const [v] = L.splice(i, 1);
      S.scadenze.chiuse.unshift(Object.assign({}, v, { chiusa_ts: ora(), chiusa_da: D.cliente.appellativo, perche: perche || "" }));
      return true;
    };
    let risposta;
    if (c.cosa === "chiudi") { if (!togli(c.fonte, c.id, "")) throw new Error(tr("non trovata")); risposta = { messaggio: T("fatto") }; }
    else if (c.cosa === "chiudi_molte") {
      let n = 0; const errori = [];
      for (const v of c.voci || []) { if (togli(v.fonte, v.id, c.perche)) n++; else errori.push(v.id); }
      risposta = { chiuse: n, errori, messaggio: "" };
    } else if (c.cosa === "riapri") {
      const i = S.scadenze.chiuse.findIndex((v) => v.id === c.id && v.fonte === c.fonte);
      if (i < 0) throw new Error(tr("non trovata"));
      const [v] = S.scadenze.chiuse.splice(i, 1);
      delete v.chiusa_ts; delete v.chiusa_da; delete v.perche;
      (lista(v.fonte) || S.scadenze.task).push(v);
      risposta = { messaggio: T("fatto") };
    } else if (c.cosa === "aggiungi") {
      const testo = String(c.testo || "").trim();
      if (!testo) throw new Error(tr("messaggio vuoto"));
      const f = c.fonte === "personali" ? "personali" : "task";
      lista(f).push({ id: nuovoId(f[0] + "-"), entro: c.entro || null, testo, tipo: "", chi: "", eur: null, fonte: f,
        nota: f === "task" ? "aperta il " + giornoISO(ora()) : "" });
      risposta = { messaggio: T("salvato") };
    } else if (c.cosa === "controllo") {
      // «quali sono già fatte?»: un lavoro di Jarvis che risponde col blocco json che la pagina sa leggere
      const k = D.scadenze.controllo;
      const aperte = k.proposte.filter((p) => (lista(p.fonte) || []).some((v) => v.id === p.id));
      const testo = "```json\n" + JSON.stringify(aperte, null, 2) + "\n```\n\n" + k.dubbi;
      const l = lavoroChat("Controllo delle scadenze", "Jarvis", "jarvis", "Quali scadenze sono già fatte?", testo, "controllo");
      tocca(["stato"]);
      return { lavoro: { id: l.id, titolo: l.titolo }, messaggio: "" };
    } else throw new Error(tr("non trovato"));
    tocca(["scadenze"]);
    return risposta;
  }
  function azioneAgente(c) {
    const cosa = c.cosa;
    if (cosa === "attivo") {
      const x = trovaAg(c.progetto, c.nome); if (!x) throw new Error(tr("agente non trovato"));
      x.a.attivo = !!c.valore; x.a.aggiornato_ts = ora(); modifica("attivo", c.progetto, c.nome);
      return { messaggio: T("salvato") };
    }
    if (cosa === "crea") {
      const pr = progettoDi(c.progetto); if (!pr) throw new Error(tr("non trovato"));
      if (pr.p.agenti.some((a) => a.nome === c.nome)) throw new Error("Esiste già un agente con questo nome");
      const capo = pr.p.agenti.find((a) => a.nome === c.capogruppo);
      const a = profilo({ nome: c.nome, modello: c.model || "sonnet", descrizione: c.description || c.nome, tono: c.tono || "", umorismo: +c.umorismo || 1,
        riporta_a: capo && !capo.capogruppo ? capo.nome : "", strumenti: ["Read"] }, pr.p);
      a.aggiornato_ts = ora();
      pr.p.agenti.push(a);
      if (capo && !capo.comunica.includes(a.nome)) capo.comunica.push(a.nome);
      evento("profilo creato: " + a.nome + " (" + pr.p.nome + ")");
      modifica("nuovo", pr.p.id, a.nome);
      return { messaggio: T("salvato") };
    }
    if (cosa === "crea_gruppo") {
      const sp = S.spazi.find((s) => s.id === c.spazio) || S.spazi[0];
      if (progettoDi(c.id)) throw new Error("Questo id è già di un altro progetto");
      const p = { id: c.id, nome: c.nome || c.id, cartella: "~/Progetti/" + (c.nome || c.id), capogruppo: c.capogruppo, esiste: true, archiviati: [], agenti: [] };
      p.agenti.push(profilo({ nome: c.capogruppo, modello: c.model || "sonnet", capogruppo: true, descrizione: c.description || "Capogruppo", tono: c.tono || "", umorismo: +c.umorismo || 1 }, p));
      sp.progetti.push(p);
      evento("gruppo creato: " + p.nome + " (" + sp.nome + ")");
      return { messaggio: T("salvato") };
    }
    if (cosa === "togli") {
      const x = trovaAg(c.progetto, c.nome); if (!x) throw new Error(tr("agente non trovato"));
      x.p.agenti = x.p.agenti.filter((a) => a !== x.a);
      x.p.archiviati.push(x.a);
      for (const { a } of tuttiAg()) a.comunica = a.comunica.filter((n) => n !== x.a.nome);
      evento("archiviato: " + x.a.nome);
      return { messaggio: T("fatto") };
    }
    if (cosa === "ripristina") {
      const pr = progettoDi(c.progetto); if (!pr) throw new Error(tr("non trovato"));
      const i = pr.p.archiviati.findIndex((a) => a.nome === c.nome); if (i < 0) throw new Error(tr("agente non trovato"));
      pr.p.agenti.push(pr.p.archiviati.splice(i, 1)[0]);
      return { messaggio: T("fatto") };
    }
    if (cosa === "togli_gruppo") {
      const pr = progettoDi(c.progetto); if (!pr) throw new Error(tr("non trovato"));
      pr.s.progetti = pr.s.progetti.filter((p) => p !== pr.p);
      S.gruppiArch.unshift({ p: pr.p, spazioId: pr.s.id, spazio: pr.s.nome, ts: ora() });
      return { messaggio: T("fatto") };
    }
    if (cosa === "ripristina_gruppo") {
      const i = S.gruppiArch.findIndex((g) => g.p.id === c.progetto); if (i < 0) throw new Error(tr("non trovato"));
      const [g] = S.gruppiArch.splice(i, 1);
      (S.spazi.find((s) => s.id === g.spazioId) || S.spazi[0]).progetti.push(g.p);
      return { messaggio: T("fatto") };
    }
    if (cosa === "allinea") return { messaggio: T("fatto") };
    if (cosa === "salva_casa") {
      const a = S.diCasa.find((x) => x.nome === c.nome);
      if (a) Object.assign(a, { descrizione: c.description, modello: c.model, strumenti: c.tools, tono: c.tono, umorismo: c.umorismo });
      return { messaggio: T("salvato") };
    }
    if (cosa === "aggiorna_catena") {
      // una missione dei capigruppo: rileggono i profili (tutti, o solo quelli toccati) e li verificano
      const soloUltime = c.ambito === "ultime";
      const chiavi = soloUltime ? [...new Set(S.modifiche.map((x) => x.progetto + ":" + x.agente))] : null;
      const spazio = c.spazio && c.spazio !== "tutti" ? c.spazio : null;
      const sp = spazio ? S.spazi.find((s) => s.id === spazio) : null;
      const m = nuovaMissione({ spazio: sp ? sp.id : S.spazi[0].id, progetti: sp ? sp.progetti.map((p) => p.id) : S.spazi[0].progetti.map((p) => p.id),
        soloChiavi: chiavi && chiavi.length ? chiavi : null, obiettivo: soloUltime ? "Verifica le ultime modifiche agli agenti" : "Aggiorna i profili della squadra",
        modalita: "lavoro", max: 6, titolo: "Catena aggiornata",
        fine: (mm) => {
          for (const a of mm.agenti) { const x = tuttiAg().find((z) => z.a.nome === a.tipo); if (x) x.a.aggiornato_ts = ora(); }
          S.modifiche = [];
          tocca(["spazi", "modifiche"]);
        } });
      tocca(["stato"]);
      return { messaggio: T("missione"), missione: m.id };
    }
    return { messaggio: T("pieno") };
  }

  // ------------------------------------------------------------ le altre POST
  function post(percorso, corpo) {
    if (percorso === "/api/azione") return azione(corpo || {});
    if (percorso === "/api/pannello") {
      const c = Object.assign({}, corpo);
      delete c.versione;
      S.pannello = { gruppi: c.gruppi || [], aspetto: c.aspetto || {}, lavagne: c.lavagne || {} };
      S.panVer++;
      scriviSS("demo.pannello", S.pannello);
      return { messaggio: T("salvato"), versione: S.panVer };
    }
    if (percorso === "/api/motore") {
      if (MOTORI.some((m) => m.id === corpo.motore && m.pronto)) S.motore = corpo.motore;
      return motori();
    }
    if (percorso === "/api/agente-profilo") {
      const x = trovaFile(corpo.file); if (!x) throw Object.assign(new Error(tr("agente non trovato")), { codice: 404 });
      const cambiate = [];
      const campi = { description: "descrizione", model: "modello", tono: "tono", umorismo: "umorismo" };
      for (const [k, dove] of Object.entries(campi)) if (k in corpo && corpo[k] !== x.a[dove]) { x.a[dove] = k === "umorismo" ? +corpo[k] : corpo[k]; cambiate.push(k); }
      if ("tools" in corpo) { x.a.strumenti = String(corpo.tools).split(",").map((s) => s.trim()).filter(Boolean); cambiate.push("tools"); }
      if (cambiate.length) { x.a.aggiornato_ts = ora(); modifica("profilo", x.p.id, x.a.nome); evento("profilo aggiornato: " + x.a.nome + " (" + cambiate.join(", ") + ")"); }
      return { messaggio: T("salvato"), cambiate };
    }
    if (percorso === "/api/agente-comunica") {
      const x = trovaFile(corpo.file); if (!x) throw Object.assign(new Error(tr("agente non trovato")), { codice: 404 });
      const nomi = [...new Set((corpo.comunica || []).map((s) => String(s).trim()).filter(Boolean))].slice(0, 30);
      const diversi = nomi.filter((n) => !x.a.comunica.includes(n)).concat(x.a.comunica.filter((n) => !nomi.includes(n)));
      x.a.comunica = nomi;
      if (diversi.length) { modifica("filo", x.p.id, x.a.nome, { con: diversi }); evento(x.a.nome + ": collegamenti aggiornati nel profilo (" + nomi.length + ")"); tocca(["stato"]); }
      return { messaggio: T("salvato") };
    }
    if (percorso === "/api/notifica-boss") { if (corpo.testo) evento(String(corpo.testo).slice(0, 300)); tocca(["stato"]); return { messaggio: T("fatto") }; }
    if (percorso === "/api/accesso_telefono") { toastDopo(T("pieno")); return accesso(); }
    if (percorso === "/api/chat" || percorso === "/api/claude-code") return { risposta: T("chat"), successo: true, output: T("chat"), codice: 0 };
    throw Object.assign(new Error(tr("non trovato")), { codice: 404 });
  }
  const MOTORI = [
    { id: "claude", nome: "Claude Code", installato: true, pronto: true, motivo: "" },
    { id: "gemini", nome: "Gemini", installato: true, pronto: true, motivo: "" },
    { id: "codex", nome: "Codex", installato: true, pronto: true, motivo: "" },
    { id: "cursor", nome: "Cursor", installato: false, pronto: false, motivo: "da installare" },
  ];
  const motori = () => ({ attivo: S.motore, motori: MOTORI });
  const accesso = () => ({ attivo: false, acceso: false, motivo: "spento" });

  // ------------------------------------------------------------ le GET
  function get(percorso, q) {
    if (percorso === "/api/stato") return stato();
    if (percorso === "/api/catalogo") return catalogo();
    if (percorso === "/api/spazi") return { spazi: spaziPubblici(), gruppi_archiviati: gruppiArchiviati() };
    if (percorso === "/api/pannello") return pannello();
    if (percorso === "/api/motore") return motori();
    if (percorso === "/api/lingua") return { lingua, lingue: { it: "Italiano", en: "English", es: "Español", fr: "Français", de: "Deutsch" }, testi: window.CC_TESTI };
    if (percorso === "/api/accesso_telefono") return accesso();
    if (percorso === "/api/scadenze") {
      const sc = S.scadenze;
      return { letto_ts: ora(), errori: {}, registro_configurato: true, registro: sc.registro.map(conGiorni), personali: sc.personali.map(conGiorni),
        task: sc.task.map(conGiorni), chiuse: sc.chiuse.filter((v) => ora() - v.chiusa_ts < 30 * 86400).map(conGiorni) };
    }
    if (percorso === "/api/agenti/modifiche") {
      return { ultimo_aggiornamento_ts: AVVIO - 3600, pendenti: S.modifiche.slice(),
        agenti_coinvolti: [...new Set(S.modifiche.map((m) => m.progetto + ":" + m.agente))] };
    }
    if (percorso === "/api/agenti/allineamento") return { lavagna: q.get("lavagna") || "generale", differenze: [], allineata: true };
    if (percorso === "/api/nota-di-casa") {
      const nome = q.get("nome");
      if (nome === "memoria") return { tipo: "cartella", percorso: "~/Jarvis/Memoria" };
      const a = S.diCasa.find((x) => x.nome === nome);
      if (!a) throw Object.assign(new Error(tr("non trovata")), { codice: 404 });
      return { tipo: "agente", percorso: "~/.claude/agents/" + a.nome + ".md", descrizione: a.descrizione, modello: a.modello, strumenti: a.strumenti, tono: a.tono, umorismo: a.umorismo };
    }
    if (percorso === "/api/cartelle-progetto") {
      const sp = S.spazi.find((s) => s.id === q.get("spazio"));
      return { cartelle: (sp ? sp.progetti : []).map((p) => ({ nome: p.cartella.split("/").pop(), usata_da: p.nome })).concat([{ nome: "Archivio vecchio", usata_da: "" }]) };
    }
    if (percorso === "/api/agente-profilo") {
      const x = trovaFile(q.get("file"));
      if (!x) throw Object.assign(new Error(tr("agente non trovato")), { codice: 404 });
      return { description: x.a.descrizione, model: x.a.modello, tools: x.a.strumenti.join(", "), corpo: corpoProfilo(x.a) };
    }
    let m = percorso.match(/^\/api\/missione\/([\w-]+)\/agente\/(\w+)$/);
    if (m) {
      const mi = S.missioni.find((x) => x.id === m[1]);
      const a = mi && mi.agenti.find((x) => x.id === m[2]);
      if (!a) throw Object.assign(new Error(tr("sottoagente non trovato")), { codice: 404 });
      return Object.assign({}, a, { esito_intero: a.esito || "" });
    }
    m = percorso.match(/^\/api\/missione\/([\w-]+)$/);
    if (m) {
      const mi = S.missioni.find((x) => x.id === m[1]);
      if (!mi) throw Object.assign(new Error(tr("missione non trovata")), { codice: 404 });
      return Object.assign(missionePubblica(mi), { registro: mi._reg.join("\n") });
    }
    if (percorso === "/api/tecnico") {
      return { telefono: { collegato: true, modello: "Pixel 8", versione: "1.0.1", codice: 12, android: "15", servizio: true, accessibilita: true, batteria: 78, debug: false },
        log: [hhmmss(ora() - 600) + " app: collegata al ponte", hhmmss(ora() - 420) + " voce: frase riconosciuta (1,2 s)", hhmmss(ora() - 60) + " app: battito regolare"] };
    }
    if (percorso === "/api/chat/storia") return { battute: S.voce.slice(-150) };
    m = percorso.match(/^\/api\/lavoro\/([\w-]+)$/);
    if (m) {
      let l = S.lavori.find((x) => x.id === m[1]);
      // una chat rimasta in attesa da un'altra visita: le si risponde comunque
      if (!l && /^c/.test(m[1])) l = { id: m[1], titolo: "Chat", stato: "finito", chi: "Jarvis", tipo: "chat", dove: "~/Jarvis", inizio: "", fine: "", richiesta: "", log: "", _testo: "— " + T("chat") };
      if (!l) throw Object.assign(new Error("lavoro non trovato"), { codice: 404 });
      return Object.assign(lavoroPubblico(l), { testo: l.stato === "in corso" ? "" : l._testo || "" });
    }
    throw Object.assign(new Error(tr("non trovato")), { codice: 404 });
  }

  // ------------------------------------------------------------ fetch finto
  const attesa = (ms) => new Promise((r) => setTimeout(r, ms));
  const risposta = (corpo, codice) => new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    { status: codice || 200, headers: { "Content-Type": typeof corpo === "string" ? "text/event-stream" : "application/json" } });
  window.fetch = async function (input, init) {
    const indirizzo = typeof input === "string" ? input : (input && input.url) || String(input);
    const u = new URL(indirizzo, "http://demo.invalid/");
    const percorso = indirizzo.startsWith("/api/") ? u.pathname : (u.pathname.match(/\/api\/.*$/) || [""])[0];
    // niente rete vera: tutto quello che non è /api/ risponde 404 da qui
    if (!percorso) return risposta({ errore: "demo: niente rete" }, 404);
    const metodo = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    await attesa(40 + Math.random() * 120);
    if (init && init.signal && init.signal.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      if (percorso === "/api/flusso") return risposta(": demo\n\n");
      if (metodo === "POST") {
        let corpo = {};
        try { corpo = JSON.parse((init && init.body) || "{}"); } catch (e) { corpo = {}; }
        return risposta(post(percorso, corpo));
      }
      return risposta(get(percorso, u.searchParams));
    } catch (e) {
      return risposta({ errore: e.message || String(e) }, e.codice || 400);
    }
  };

  // per chi apre la console: lo stato del server finto
  window.JARVIS_DEMO = { stato: () => S, tocca,
    pausa(si) { inPausa = si !== false; if (inPausa) { S.comunicazioni.forEach((c) => { c.stato = "finito"; c.ts -= 60; }); tocca(["stato"]); } } };
})();
