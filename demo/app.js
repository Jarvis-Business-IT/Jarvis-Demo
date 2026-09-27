"use strict";
// ---------------------------------------------------------------- lingua
// Cinque lingue: it (riferimento e default), en, es, fr, de. Il server mette nella pagina la lingua
// scelta (window.CC_LINGUA) e il suo dizionario (window.CC_TESTI, da static/lingue/<codice>.json):
// la chiave è il testo italiano, con i segnaposto {nome}. Un testo che manca resta in italiano.
// Nel codice: t('testo italiano') o t('ciao {nome}', { nome }), sempre con le virgolette doppie
// (qui semplici solo perché l'estrattore di lingue.py non le prenda come testi). Per l'HTML statico basta scriverlo
// in italiano: traduciPagina() traduce testi, title, placeholder, aria-label e data-chiedi.
// Cambiare lingua (selettore in barra) salva la scelta sul server e ricarica la pagina.
const LINGUE = { it: "Italiano", en: "English", es: "Español", fr: "Français", de: "Deutsch" };
const LINGUA = LINGUE[window.CC_LINGUA] ? window.CC_LINGUA : "it";
const TESTI = (window.CC_TESTI && typeof window.CC_TESTI === "object") ? window.CC_TESTI : {};
const LOCALE = { it: "it-IT", en: "en-GB", es: "es-ES", fr: "fr-FR", de: "de-DE" }[LINGUA];
function t(testo, valori) {
  const s = (LINGUA !== "it" && TESTI[testo]) || testo;
  return valori ? s.replace(/\{(\w+)\}/g, (m, k) => (k in valori && valori[k] != null ? String(valori[k]) : m)) : s;
}
const ATTR_TRADOTTI = ["title", "placeholder", "aria-label", "data-chiedi"];
function traduciPagina(radice) {
  if (LINGUA === "it") return;
  const salta = (n) => n.closest && n.closest("script,style,code,pre,[translate=no]");
  const giro = document.createTreeWalker(radice, NodeFilter.SHOW_TEXT);
  const testi = [];
  while (giro.nextNode()) testi.push(giro.currentNode);
  for (const n of testi) {
    if (!n.parentElement || salta(n.parentElement)) continue;
    const chiave = n.nodeValue.replace(/\s+/g, " ").trim();
    if (!chiave || !TESTI[chiave]) continue;
    const [, prima, dopo] = n.nodeValue.match(/^(\s*)[\s\S]*?(\s*)$/);
    n.nodeValue = prima + TESTI[chiave] + dopo;
  }
  for (const e of radice.querySelectorAll("*")) {
    if (salta(e)) continue;
    for (const a of ATTR_TRADOTTI) {
      const v = e.getAttribute(a);
      const chiave = v && v.replace(/\s+/g, " ").trim();
      if (chiave && TESTI[chiave]) e.setAttribute(a, TESTI[chiave]);
    }
  }
}
document.documentElement.lang = LINGUA;
traduciPagina(document.head);
traduciPagina(document.body);

// ---------------------------------------------------------------- codice di accesso
// Sul computer il server mette il token nella pagina (cambia a ogni avvio). Dal telefono la pagina
// arriva senza: il codice di accesso sta nell'indirizzo del QR (?t=...), la pagina lo tiene in
// localStorage e lo toglie dall'indirizzo.
const DAL_TELEFONO = !window.CC_TOKEN || window.CC_TOKEN === "__TOKEN__";
const TOKEN = (() => {
  if (!DAL_TELEFONO) return window.CC_TOKEN;
  const q = new URLSearchParams(location.search).get("t") || "";
  if (q) {
    try { localStorage.setItem("cc.token_telefono", q); } catch (e) { /* resta nell'indirizzo */ }
    history.replaceState(null, "", location.pathname + location.hash);
    return q;
  }
  try { return localStorage.getItem("cc.token_telefono") || ""; } catch (e) { return ""; }
})();
// chi usa il pannello: l'appellativo scelto all'installazione (profilo), messo nella pagina dal server
const UTENTE = (window.CC_UTENTE && window.CC_UTENTE !== "__UTENTE__") ? window.CC_UTENTE : "Boss";
const $ = (id) => document.getElementById(id);
const HDR = { "X-Token": TOKEN, "Content-Type": "application/json" };
// gli stati dei lavori arrivano dal server in italiano: si mostrano tradotti da qui
const NOME_STATO = { "in corso": t("in corso"), finito: t("finito"), errore: t("errore") };
const VOCE = { idle: t("in attesa"), listening: t("ascolto"), thinking: t("sto pensando"), speaking: t("parlo") };
let lavoroScelto = null;
let agenti = [];

function el(tag, attrs = {}, ...figli) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;          // attributo assente (es. disabled: null)
    if (k === "class") n.className = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
  }
  for (const f of figli) n.append(f instanceof Node ? f : document.createTextNode(f ?? ""));
  return n;
}

function toast(testo, errore = false) {
  const t = $("toast");
  t.textContent = testo;
  t.className = "toast visibile" + (errore ? " errore" : "");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.className = "toast"), 4200);
}

// Ogni chiamata ha un tetto di tempo: se un gestore del server rallenta, le richieste non si
// accumulano aperte (ognuna tiene un thread del server). 10 s per le letture; le azioni che
// aspettano apposta (scegliere un file, il giro della memoria) hanno il loro tetto in azione().
const TETTO_API = 10000;
async function api(percorso, corpo, tetto = TETTO_API) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), tetto);
  let r;
  try {
    r = await fetch(percorso, corpo ? { method: "POST", headers: HDR, body: JSON.stringify(corpo), signal: ctl.signal }
      : { headers: HDR, signal: ctl.signal });
  } catch (e) {
    throw new Error(e.name === "AbortError" ? t("il Command Center non ha risposto entro {secondi} s", { secondi: Math.round(tetto / 1000) }) : t("Command Center non raggiungibile"));
  } finally {
    clearTimeout(timer);
  }
  const d = await r.json().catch(() => ({}));
  // Il token cambia a ogni avvio del server: una pagina aperta prima (anche l'app installata)
  // riceverebbe 403 per sempre. Si ricarica da sola, al massimo una volta ogni 15 secondi.
  if (r.status === 403 && d.token_scaduto && DAL_TELEFONO) {
    // dal telefono ricaricare non serve: il codice nuovo sta nel QR sul computer
    throw new Error(t("Codice di accesso non valido o scaduto: inquadra di nuovo il codice QR sul computer"));
  }
  if (r.status === 403 && d.token_scaduto) {
    const ultimo = Number(sessionStorage.getItem("cc.ricarica") || 0);
    if (Date.now() - ultimo > 15000) {
      sessionStorage.setItem("cc.ricarica", String(Date.now()));
      location.reload();
    }
    throw new Error(t("il Command Center è ripartito: ricarico la pagina"));
  }
  if (!r.ok) throw new Error(d.errore || t("errore {codice}", { codice: r.status }));
  return d;
}

// azioni che per natura aspettano a lungo sul server (tetto in ms)
const TETTO_AZIONE = { scegli_allegato: 130000, aggiornamento: 30000,
  interruttore: 45000, android: 40000, telefono: 100000, telegram_riaggancia: 40000, tecnico: 40000,
  aggiorna: 65000, sentinella: 120000, portiere: 30000 };   // aggiorna: il server aspetta il raccoglitore fino a 60 s

async function azione(corpo, bottone) {
  // il bottone resta spento e gira finché il server non risponde (↻ «aggiorna» può aspettare 60 s)
  if (bottone) { bottone.disabled = true; bottone.classList.add("in-attesa"); }
  try {
    const d = await api("/api/azione", corpo, TETTO_AZIONE[corpo.tipo] || 30000);
    if (d.errori && d.errori.length) toast((d.messaggio ? d.messaggio + " · " : "") + t("errori: {elenco}", { elenco: d.errori.join(", ") }), true);
    else if (d.messaggio) toast(d.messaggio);
    if (d.lavoro) { lavoroScelto = d.lavoro.id; firmaDettaglio = ""; toast(t("Avviato: {titolo}", { titolo: d.lavoro.titolo })); }
    setTimeout(aggiorna, 800);
    return d;
  } catch (e) {
    toast(e.message, true);
  } finally {
    if (bottone) { bottone.disabled = false; bottone.classList.remove("in-attesa"); }
  }
}

function pallino(colore) { return el("span", { class: "pallino " + colore }); }

function disegnaLocale(l) {
  for (const riga of document.querySelectorAll("[data-int]")) {
    if (riga.dataset.tg) continue;  // le righe di Telegram le disegna disegnaTelegram
    riga.querySelector(".switch").classList.toggle("on", !!l[riga.dataset.int]);
  }
  const chiede = $("ind-chiede").querySelector(".spia");
  chiede.className = "spia " + (l.chiede_prima ? "on" : "attenzione");
  $("ind-chiede-t").textContent = l.chiede_prima ? t("ti chiede il sì prima di cancellare, pubblicare, pagare, scrivere") : t("agisce senza chiedere");
  $("ind-alpc").querySelector(".spia").className = "spia " + (l.al_pc ? "on" : "");
  $("ind-alpc-t").textContent = l.al_pc ? t("può usare schermo, mouse e tastiera del PC") : t("lavora solo con comandi e file");
  $("avviso-fidata").classList.toggle("nascosto", l.fidata !== false);

  const sfera = $("sfera");
  const vs = l.voce ? (l.voce_stato || "idle") : "spenta";
  sfera.className = "sfera " + vs;
  const voceTesto = l.voce ? (VOCE[vs] || vs) : t("voce spenta");
  $("voce-stato").textContent = voceTesto;
  // lo stesso stato, nell'intestazione di ogni scheda (mockup 26/09/2026, idea 1)
  const aj = $("avatar-jarvis");
  if (aj) {
    aj.className = "avatar-jarvis " + vs;
    aj.title = t("Jarvis · {stato} — clic: scheda Stato", { stato: voceTesto });
    $("aj-testo").textContent = voceTesto;
  }
  vocePensa = l.voce && vs === "thinking";
  disegnaAttesaVoce();

  const a = l.android || {};
  if (a.spento) $("and-stato").textContent = t("non attivo in questa installazione");
  else if (!a.installato) $("and-stato").textContent = t("adb non installato");
  else if (!a.dispositivi.length) $("and-stato").textContent = t("nessun telefono collegato");
  else {
    // Si dice sempre **quale** apparecchio, e se ce n'è più d'uno si dicono
    // tutti: con un emulatore acceso accanto al telefono vero, mostrarne uno
    // solo fa credere di star guardando l'altro.
    const chi = a.dispositivi.map((d) => d.modello).join(" + ");
    const altri = a.dispositivi.length > 1 ? " · " + t("{n} collegati, i comandi vanno al primo", { n: a.dispositivi.length }) : "";
    $("and-stato").textContent = `● ${chi}` + (a.batteria != null ? " · " + t("batteria {n}%", { n: a.batteria }) : "") +
      (a.schermo ? " · " + t("schermo aperto") : "") + altri;
  }

  if (cambiato("vociAndroid", l.voci, l.android)) disegnaVociAndroid(l);
  if (cambiato("sessioni", l.agenti_sessioni)) disegnaSessioni(l.agenti_sessioni);
  if (l.mac) {
    $("mac-cpu").textContent = l.mac.cpu != null ? l.mac.cpu + "%" : "—";
    $("mac-ram").textContent = l.mac.ram != null ? l.mac.ram + "%" : "—";
  }

}

// Telegram: verde = bot agganciato, giallo = sta ripartendo, rosso = giù, grigio = spento da Boss.

// ---- Telefono: come parla Jarvis (dalla configurazione vera) e informazioni Android ----
function disegnaVociAndroid(l) {
  const v = l.voci || {}, lista = $("voci-lista");
  if (lista) {
    lista.replaceChildren();
    const riga = (titolo, dettaglio, stato, acceso) => el("li", { style: "cursor:default" },
      el("span", {}, titolo, el("br"), el("small", {}, dettaglio)),
      el("span", { class: "etichetta " + (acceso ? "in-corso" : "chiusa") }, stato));
    lista.append(riga(t("Ascolto") + " · " + ((v.ascolto || {}).nome || "Whisper"), ((v.ascolto || {}).dettaglio || "") + " · " + t("lingua {codice}", { codice: (v.ascolto || {}).lingua || "it" }), v.voce_accesa ? t("voce accesa") : t("voce spenta"), !!v.voce_accesa));
    lista.append(riga(t("Cervello") + " · Claude", t("capisce e risponde"), t("sempre"), true));
    for (const m of (v.motori || [])) {
      const ultimo = v.ultimo_motore === m.id;
      const quando = ultimo && v.ultimo_ts ? " · " + t("ha parlato per ultimo alle {ora}", { ora: new Date(v.ultimo_ts * 1000).toTimeString().slice(0, 5) }) : "";
      lista.append(riga(t("Voce") + " · " + m.nome, (m.nota || "") + quando, ultimo ? t("sta parlando") : (m.attivo ? t("attivo") : t("spento")), ultimo || m.attivo));
    }
    const s = $("voci-stato");
    if (s) s.textContent = v.ultimo_motore ? t("ultima frase detta da {motore}", { motore: v.ultimo_motore }) : t("ordine: Azure, poi Edge, poi Kokoro");
  }
  const a = l.android || {}, info = $("and-info");
  if (info) {
    info.replaceChildren();
    const p = a.ponte || {};
    const riga = (titolo, dettaglio, stato, acceso) => el("li", { style: "cursor:default" },
      el("span", {}, titolo, el("br"), el("small", {}, dettaglio)),
      el("span", { class: "etichetta " + (acceso ? "in-corso" : "chiusa") }, stato));
    info.append(riga(t("Collegamento al Mac (ADB)"), a.dispositivi && a.dispositivi.length ? a.dispositivi.map((d) => d.modello).join(" + ") : t("nessun telefono: serve il Debug wireless acceso sul telefono, come qui sotto in «Collega il telefono»"), a.dispositivi && a.dispositivi.length ? t("collegato") : t("non collegato"), !!(a.dispositivi && a.dispositivi.length)));
    info.append(riga(t("App Jarvis sul telefono"), p.raggiungibile ? (p.app_collegata ? t("l'app è collegata al ponte") : t("il ponte funziona ma l'app non è collegata: apri l'app Jarvis sul telefono")) : t("il ponte sulla VPS non risponde"), p.app_collegata ? t("collegata") : t("non collegata"), !!p.app_collegata));
    if (p.versione_offerta) info.append(riga(t("Versione offerta dal ponte"), p.versione_offerta + " " + t("(l'app si aggiorna da qui)"), t("info"), true));
  }
}

function disegnaTelegram(tg) {
  for (const riga of document.querySelectorAll("[data-tg]")) {
    const s = (tg || {})[riga.dataset.tg];
    // Telegram è facoltativo: senza guardiano (o senza il bot di quel posto) la riga non c'è
    riga.classList.toggle("nascosto", !s || (tg && tg.installato === false) || (!s.bot && !!s.errore));
    if (!s) continue;
    riga.querySelector(".switch").classList.toggle("on", !s.errore && !s.spento);
    let colore, testo;
    if (s.errore) { colore = "rosso"; testo = t("non risponde: {errore}", { errore: s.errore }); }
    else if (s.spento) { colore = "grigio"; testo = s.bot + " · " + t("spento"); }
    else if (s.occupato && !s.lettore) { colore = "giallo"; testo = s.bot + " · " + t("aspetta: il bot è ancora in mano a un'altra sessione Claude, si libera quando la chiudi"); }
    else if (s.lettore) { colore = "verde"; testo = s.bot + " · " + (s.avviato ? t("agganciato dalle {ora}", { ora: s.avviato.slice(11) }) : t("agganciato")); }
    else if (s.sessione) { colore = "giallo"; testo = s.bot + " · " + t("si sta agganciando"); }
    else { colore = "rosso"; testo = s.bot + " · " + (s.guardia === false ? t("giù, guardiano non installato") : t("giù, il guardiano lo riavvia entro un minuto")); }
    riga.querySelector(".tg-stato").replaceChildren(pallino(colore), " " + testo);
  }
}

// siti che si spengono apposta: non contano come «giù» né nello stato generale né nella spia di Server
const SITI_IGNORATI = [];

function disegnaVps(v) {
  if (!v || !("siti" in v)) return;
  if (v.nome) $("vps-titolo").firstChild.textContent = v.nome + " ";
  $("vps-letto").textContent = v.letto ? t("letto alle {ora}", { ora: v.letto }) : "";
  const siti = $("vps-siti");
  siti.replaceChildren();
  if (v.configurata === false) siti.append(el("div", { style: "cursor:default" }, el("span", {}, pallino("grigio"), " " + t("nessun server configurato")),
    el("small", {}, t("scrivi il server in configurazione.json («vps») per vederlo qui"))));
  else if (!v.raggiungibile) siti.append(el("div", {
    onclick: () => chiediJarvis(t("La VPS non risponde via SSH. Controlla perché e dimmi cosa sappiamo, senza riavviare niente senza il mio sì."), "vps"),
  }, el("span", {}, pallino("rosso"), " " + t("SSH non risponde")), el("small", {}, t("clic: chiedi a Jarvis di controllare"))));
  for (const [nome, codice] of Object.entries(v.siti || {})) {
    const ok = /^[23]/.test(codice);
    siti.append(el("div", {
      title: t("clic: chiedi a Jarvis di {nome}", { nome }),
      onclick: () => chiediJarvis(ok ? t("Verifica {nome} sulla VPS, il codice è {codice}: è tutto a posto?", { nome, codice })
        : t("{nome} sulla VPS non risponde (codice {codice}). Controlla perché, senza riavviare niente senza il mio sì.", { nome, codice }), "vps"),
    }, el("span", {}, pallino(ok ? "verde" : "rosso"), " " + nome), el("small", {}, codice === "000" ? t("non raggiungibile") : codice)));
  }
  const cont = $("vps-cont");
  cont.replaceChildren();
  const attivi = (v.contenitori || []).filter((c) => c.attivo).length;
  $("vps-conta").textContent = t("({attivi}/{totale} attivi)", { attivi, totale: (v.contenitori || []).length });
  for (const c of v.contenitori || []) cont.append(el("div", {
    title: t("clic: chiedi a Jarvis di {nome}", { nome: c.nome }),
    onclick: () => chiediJarvis(c.attivo ? t("Il contenitore {nome} sulla VPS è attivo: dimmi lo stato e i log recenti.", { nome: c.nome })
      : t("Il contenitore {nome} sulla VPS è giù. Controlla il log e dimmi perché, senza riavviarlo senza il mio sì.", { nome: c.nome }), "vps"),
  }, el("span", {}, pallino(c.attivo ? "verde" : "rosso"), " " + c.nome), el("small", {}, c.dettaglio)));
  for (const k of ["disco", "ram"]) {
    $("vps-" + k).value = v[k] ?? 0;
    $("vps-" + k + "-t").textContent = v[k] != null ? v[k] + "%" : "—";
  }
}

// Una riga per progetto: quando è stata scritta l'ultima nota di memoria, quante caselle aperte,
// quando si è lavorato l'ultima volta. È l'unica cosa che dice se la memoria è
// davvero aggiornata; i tre numeri qui sopra salgono comunque.
function disegnaBattito(b) {
  const corpo = $("mem-progetti").querySelector("tbody");
  const cap = $("mem-battito");
  if (!b || !b.quando) {
    cap.textContent = b && b.perche ? b.perche : t("il battito non è mai passato");
    cap.className = "battito no";
    corpo.replaceChildren(el("tr", {}, el("td", { colspan: 5 }, t("nessun giro registrato"))));
    return;
  }
  cap.textContent = t("ultimo giro {ora} · {minuti} min fa", { ora: b.quando.slice(11), minuti: b.minuti_fa }) +
    (b.acceso ? "" : " · " + t("fermo"));
  cap.className = "battito " + (b.acceso ? "ok" : "no");
  const ora = (t) => (t ? t.slice(11, 16) : "—");
  const giorno = (x) => (x && x.slice(0, 10) === oggiISO() ? t("oggi") : x ? x.slice(8, 10) + "/" + x.slice(5, 7) : "");
  corpo.replaceChildren(...(b.progetti || []).map((p) => {
    const tardi = p.ore_indietro != null && p.ore_indietro >= 6;
    const apriFile = (percorso) => percorso ? { onclick: (ev) => { ev.stopPropagation(); azione({ tipo: "apri_percorso_sincronia", percorso }, ev.currentTarget); }, class: "cliccabile" } : {};
    const riga = el("tr", { class: tardi ? "tardi" : "" },
      el("td", {}, (p.semaforo || "") + " " + p.progetto),
      el("td", { title: p.memoria_file ? t("clic: apri {file}", { file: p.memoria_file }) : (p.memoria || ""), ...apriFile(p.memoria_file) }, giorno(p.memoria) + " " + ora(p.memoria)),
      el("td", { title: t("{n} errori da non ripetere", { n: p.errori ?? "—" }) }, p.da_fare != null ? t("{n} da fare", { n: p.da_fare }) : "—"),
      el("td", { title: p.lavoro_file ? t("clic: apri {file}", { file: p.lavoro_file }) : "", ...apriFile(p.lavoro_file) }, ora(p.lavoro)),
      el("td", {}, p.esito || ""));
    if (tardi) {
      riga.lastChild.replaceChildren(
        el("button", {
          class: "icona",
          title: t("prepara il comando di salvataggio, senza lanciarlo"),
          onclick: async (ev) => {
            const d = await azione({ tipo: "sincronia_comando", progetto: p.progetto }, ev.target);
            if (d && d.comando) {
              const box = $("mem-comando");
              box.hidden = false;
              // un ✕ per richiuderlo (prima restava aperto fino alla ricarica)
              box.replaceChildren(el("span", {}, d.comando), " ",
                el("button", { type: "button", class: "icona", title: t("Chiudi"), onclick: () => { box.hidden = true; } }, "✕"));
            }
          },
        }, t("prepara il salvataggio")));
    }
    return riga;
  }));
  if (b.copie && b.copie.length) {
    corpo.append(el("tr", { class: "nota" },
      el("td", { colspan: 5 }, t("{n} copie di sicurezza dei vecchi MEMORIA.md", { n: b.copie.length }))));
  }
}

// Chiavi e anomalie del portiere, nella Squadra (26/09/2026). Il server nuovo manda
// s.portiere (contratto, punto 3): l'elenco intero, con pid, nome, cartella e comando.
// Il server vecchio lo teneva nel battito (memoria.battito.portiere, «note» al posto di
// «da_guardare»): si legge anche quello, così la pagina regge finché il server non riparte.
// Togliere una chiave a chi lavora resta un comando di Jarvis; da qui si ritirano solo le
// prese dei processi già morti (FANTASMA), che non rompono il lavoro di nessuno.
const TIPI_GUASTO = ["FANTASMA", "ABUSIVO"], TIPI_ATTENZIONE = ["MUTO", "SCADUTA", "LUNGA"];
// Le note del pannello stesso (del_pannello: un claude -p lanciato da qui) si mostrano in grigio e non contano.
function gravita(n) {
  if (n.del_pannello) return "";
  const t = String(n.tipo || "").toUpperCase();
  return TIPI_GUASTO.includes(t) ? "guasto" : TIPI_ATTENZIONE.includes(t) ? "attenzione" : "";
}
function portiereDi(s) {
  const p = s.portiere;
  if (p && Array.isArray(p.da_guardare)) return Object.assign({ vecchio: false }, p);
  const b = s.memoria && s.memoria.battito, v = b && b.portiere;
  if (!v) return null;
  return { vecchio: true, quando: b.quando || "", acceso: !!b.acceso, chiavi_in_giro: v.chiavi ?? 0,
    da_guardare: (v.note || []).map((n) => ({ tipo: n.tipo || "", chiavi: n.chiavi || [], perche: n.perche || "",
      pid: Number((String(n.perche || "").match(/\bpid (\d+)/) || [])[1]) || null })) };
}
function statoPortiere(p) {
  if (!p) return "grigia";
  const g = new Set((p.da_guardare || []).map(gravita));
  return g.has("guasto") ? "guasto" : g.has("attenzione") ? "attenzione" : "ok";
}

function disegnaChiavi(p, perche) {
  const cap = $("chiavi-quando");
  const lista = $("chiavi-note");
  if (!p) {
    cap.textContent = perche || t("il portiere non è ancora passato");
    cap.className = "battito no";
    $("chiavi-giro").textContent = "—";
    $("chiavi-guardare").textContent = "—";
    lista.replaceChildren();
    return;
  }
  cap.replaceChildren(p.quando_ts ? etaNodo(p.quando_ts, t("visto") + " ") : p.quando ? t("visto alle {ora}", { ora: p.quando.slice(11) }) : t("letto"));
  cap.className = "battito " + (p.vecchio && !p.acceso ? "no" : "ok");
  const voci = p.da_guardare || [];
  $("chiavi-giro").textContent = p.chiavi_in_giro ?? 0;
  $("chiavi-guardare").textContent = voci.length;
  if (!voci.length) { lista.replaceChildren(el("li", { class: "vuoto" }, t("niente da guardare"))); return; }
  lista.replaceChildren(...voci.map((n) => {
    const tipo = String(n.tipo || "—").toUpperCase();
    const etichetta = tipo;
    const motivo = n.perche || "";
    const chi = [n.nome, [n.agente, n.cosa].filter(Boolean).join(": ")].filter(Boolean).join(" · ");
    const domanda = n.pid
      ? t("Chi è il processo pid {pid}", { pid: n.pid }) + (n.comando ? ` («${n.comando}»)` : "") + (n.cwd ? " " + t("nella cartella {cartella}", { cartella: n.cwd }) : "") + "? " +
        t("Il portiere lo segna {tipo}: {perche}. Dimmi chi è, cosa sta facendo e se va fermato; non fermarlo senza il mio sì.", { tipo, perche: n.perche || "" })
      : t("Il portiere segna {tipo}: {perche}. Cosa vuol dire e cosa va fatto?", { tipo, perche: n.perche || "" });
    return el("li", { class: n.del_pannello ? "n-pannello" : "n-" + tipo.toLowerCase() },
      el("b", { class: "cn-tipo" }, etichetta),
      el("span", { class: "cn-pid" }, n.pid ? "pid " + n.pid : ""),
      el("div", { class: "cn-dettagli" },
        chi ? el("b", { class: "cn-chi" }, chi) : "",
        n.del_pannello ? el("small", { class: "cn-pannello" }, t("del pannello")) : "",
        el("span", {}, (n.chiavi && n.chiavi.length ? n.chiavi.join(", ") + " · " : "") + motivo),
        n.comando ? el("code", { class: "cn-cmd", title: n.comando }, n.comando) : "",
        n.cwd ? el("small", { class: "cn-cwd", title: n.cwd }, "📁 " + n.cwd) : ""),
      el("div", { class: "cn-azioni" },
        el("button", { class: "piccolo", type: "button", "data-chiedi": domanda, "data-box": "portiere" },
          n.pid ? t("Chiedi a Jarvis: chi è?") : t("Chiedi a Jarvis")),
        tipo === "FANTASMA" ? el("button", { class: "piccolo pericolo", type: "button", "data-ritira-fantasmi": "",
          disabled: p.vecchio ? "" : null,
          title: p.vecchio ? t("Serve il server nuovo del Command Center") : t("Toglie le prese dei processi già morti: nessuno perde il lavoro") },
        t("Ritira i fantasmi")) : ""));
  }));
}
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-ritira-fantasmi]");
  if (b) azione({ tipo: "portiere", cosa: "ritira_fantasmi" }, b);
});

// Una riga sola in «Claude adesso»: il dettaglio della sincronia sta in Memoria (unica fonte)
function disegnaSincroRiga(b) {
  const a = $("claude-sincro");
  const pr = (b && b.progetti) || [];
  if (!pr.length) { a.textContent = t("Sincronia: nessun giro registrato → Memoria"); a.className = "sincro-riga"; return; }
  let ok = 0, att = 0, gua = 0;
  for (const p of pr) { const s = p.semaforo || ""; if (s.includes("🔴")) gua++; else if (s.includes("🟡")) att++; else ok++; }
  a.textContent = t("Sincronia: {ok} in ordine · {att} attenzione · {gua} guasto → Memoria", { ok, att, gua });
  a.className = "sincro-riga " + (gua ? "guasto" : att ? "attenzione" : "ok");
}

function oggiISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function disegnaMemoria(m) {
  if (!m || !("note" in m)) return;
  $("mem-note").textContent = m.note;
  $("mem-sessioni").textContent = m.sessioni;
  $("mem-diario").textContent = m.diario_oggi ? "✓" : "—";
  disegnaBattito(m.battito);
  disegnaSincroRiga(m.battito);
  const lista = $("mem-task");
  lista.replaceChildren();
  if (!(m.sviluppi || []).length) lista.append(el("li", { class: "gruppo" }, t("nessuno sviluppo aperto in 02 Sviluppi")));
  for (const s of m.sviluppi || []) {
    lista.append(el("li", { class: "gruppo" }, `${s.nome} · ${s.stato}`));
    if (!s.task.length) lista.append(el("li", {}, t("nessun task aperto")));
    for (const t of s.task) lista.append(el("li", {}, t));
  }
}

// «Cosa succede» in cima a Stato (26/09/2026): gli ultimi 25 fatti, i finiti in verde, gli errori
// in rosso, quelli appena avviati con un pallino che pulsa.
function classeEvento(testo) {
  const t = String(testo || "");
  // gli eventi arrivano nella lingua del pannello: le parole chiave ci sono in tutte e cinque
  if (/errore|fallit|non risponde|non riesc|rifiutat|non mandat|giù\b|error|failed|rejected|fall[oó]|rechaz|erreur|échou|refus|fehler|fehlgeschlagen|abgelehnt/i.test(t)) return "ev-errore";
  if (/^finito\b|rientrata|^finished\b|^terminad|^terminé|^fertig\b|^beendet\b/i.test(t)) return "ev-finito";
  if (/^avviato\b|nuova:|^started\b|^iniciad|^lancé|^démarré|^gestartet\b/i.test(t)) return "ev-avviato";
  return "";
}
function disegnaEventi(eventi) {
  const voci = (eventi || []).slice(0, 25);
  if (!voci.length) { $("eventi").replaceChildren(el("li", { class: "vuoto" }, t("ancora niente"))); return; }
  $("eventi").replaceChildren(...voci.map((e) => el("li", { class: classeEvento(e.testo) },
    el("time", {}, e.ora), el("i", { class: "ev-punto", "aria-hidden": "true" }), el("span", {}, e.testo))));
}

// ---------------------------------------------------------------- lavori
// Lista a sinistra (filtri, ricerca, badge chi/durata), dettaglio a destra: richiesta
// intera, risultato grande, e le azioni sul singolo lavoro (26/09/2026).
let ultimiLavori = [];
let filtroLavori = "", cercaLavori = "";
let firmaDettaglio = "";

function durataLavoro(l) {
  if (!l || !l.inizio_ts) return "";
  const s = Math.max(0, Math.round((l.fine_ts || Date.now() / 1000) - l.inizio_ts));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
function badge(testo, classe = "", titolo = "") {
  return testo ? el("span", Object.assign({ class: "badge " + classe }, titolo ? { title: titolo } : {}), testo) : "";
}

function disegnaLavori(lavori) {
  ultimiLavori = lavori || [];
  const lista = $("lavori");
  const tutti = ultimiLavori;
  const q = cercaLavori.toLowerCase();
  const visti = tutti.filter((l) => (!filtroLavori || l.stato === filtroLavori) &&
    (!q || [l.titolo, l.chi, l.tipo, l.richiesta, l.dove].join(" ").toLowerCase().includes(q)));
  const conta = { "in corso": 0, finito: 0, errore: 0 };
  for (const l of tutti) conta[l.stato] = (conta[l.stato] || 0) + 1;
  $("lavori-conta").textContent = tutti.length ? `${tutti.length} · ` + t("{n} in corso", { n: conta["in corso"] }) : "";
  for (const b of document.querySelectorAll("#lavori-filtri button")) {
    const n = b.dataset.filtro ? conta[b.dataset.filtro] || 0 : tutti.length;
    b.dataset.n = n || "";
  }
  $("lavori-pulisci").disabled = !tutti.some((l) => l.stato !== "in corso");
  lista.replaceChildren();
  if (!tutti.length) {
    lista.append(el("li", { class: "vuoto-lavori" }, el("small", {},
      t("Nessun lavoro avviato. Un lavoro parte da qui: una verifica del CRM qui sotto, un comando rapido in") + " ", el("a", { href: "#home" }, t("Stato")),
      ", " + t("una domanda in") + " ", el("a", { href: "#chat" }, t("Chat")), ". " + t("Quando parte, lo vedi qui con lo stato in tempo reale."))));
  } else if (!visti.length) {
    lista.append(el("li", { class: "vuoto-lavori" }, el("small", {}, t("Nessun lavoro con questo filtro."))));
  }
  for (const l of visti) {
    const classe = l.stato.replace(" ", "-");
    const inCorso = l.stato === "in corso";
    const li = el("li", { class: "lavoro " + classe + (l.id === lavoroScelto ? " scelto" : ""), tabindex: "0", "data-lid": l.id,
      title: l.richiesta || l.titolo, onclick: () => scegliLavoro(l.id),
      onkeydown: (ev) => { if (ev.key === "Enter") scegliLavoro(l.id); } },
      // l'avatarino gira mentre il lavoro è in corso (mockup 26/09/2026, idea 2)
      el("span", { class: "lav-avatar " + classe, "aria-hidden": "true" }, el("b", {}, inizialeLavoro(l))),
      el("span", { class: "lavoro-titolo" }, l.titolo),
      el("span", { class: "etichetta " + classe }, NOME_STATO[l.stato] || l.stato),
      el("span", { class: "lavoro-badge" },
        badge(l.chi, "chi"), badge(l.tipo, "tipo"), badge("⏱ " + durataLavoro(l), "durata"),
        el("small", {}, l.inizio + (l.fine ? " → " + l.fine : ""))));
    if (inCorso) li.append(barraLavoro(l));
    if (inCorso) {
      li.append(el("button", { class: "icona ferma-lavoro", title: t("Ferma il lavoro"),
        onclick: (ev) => { ev.stopPropagation(); azione({ tipo: "ferma", id: l.id }, ev.currentTarget); } }, "■ " + t("ferma")));
    }
    lista.append(li);
  }
  // il lavoro scelto è sparito (tolto, o il server è ripartito): si torna al vuoto
  if (lavoroScelto && !tutti.some((l) => l.id === lavoroScelto)) mostraDettaglio(null);
}

function inizialeLavoro(l) {
  const n = String(l.chi || l.tipo || l.titolo || "?").trim();
  return (n.match(/[\p{L}\p{N}]/u) || ["?"])[0].toUpperCase();
}

// Barra di avanzamento: vera se il lavoro dice a che punto è (percentuale 0-100, oggi il
// server non la manda ancora), altrimenti indeterminata, va e viene.
function barraLavoro(l) {
  const p = Number(l.percentuale ?? l.progresso);
  const vera = Number.isFinite(p) && p >= 0;
  const pc = vera ? Math.min(100, Math.round(p)) : null;
  return el("span", Object.assign({ class: "lav-barra" + (vera ? "" : " indeterminata"), role: "progressbar",
    "aria-label": t("avanzamento") }, vera ? { "aria-valuenow": pc, "aria-valuemin": 0, "aria-valuemax": 100 } : {}),
  el("i", vera ? { style: `width:${pc}%` } : {}));
}

function scegliLavoro(id) {
  lavoroScelto = id;
  firmaDettaglio = "";
  disegnaLavori(ultimiLavori);
  caricaLavoro(true);
}

function mostraDettaglio(d) {
  const vista = $("blocco-lavori");
  vista.classList.toggle("con-scelto", !!d);
  $("ris-vuoto").classList.toggle("nascosto", !!d);
  $("ris-dettaglio").classList.toggle("nascosto", !d);
  if (!d) { lavoroScelto = null; firmaDettaglio = ""; vista.classList.remove("ris-intero"); }
}

const testoPulito = (d) => (d.testo || "").replace(/^\(cartella: [^\n]*\)\n\n?/, "");

async function caricaLavoro(primo = false) {
  if (!lavoroScelto) return;
  let d;
  try { d = await api("/api/lavoro/" + lavoroScelto); } catch (e) { mostraDettaglio(null); return; }
  if (d.id !== lavoroScelto) return;
  mostraDettaglio(d);
  $("ris-titolo").textContent = d.titolo;
  const st = $("ris-stato");
  st.className = "etichetta " + d.stato.replace(" ", "-");
  st.textContent = (NOME_STATO[d.stato] || d.stato) + (d.codice != null && d.stato === "errore" ? " · " + t("esito {codice}", { codice: d.codice }) : "");
  $("ris-meta").replaceChildren(
    badge(d.chi, "chi", t("chi ha lavorato")), badge(d.tipo, "tipo"), badge(d.dove, "dove", t("cartella di lavoro")),
    badge("⏱ " + durataLavoro(d), "durata", t("inizio {ora}", { ora: d.inizio }) + (d.fine ? " · " + t("fine {ora}", { ora: d.fine }) : "")),
    d.turni ? badge(t("{n} turni", { n: d.turni }), "tipo", t("passaggi di Claude Code")) : "",
    d.costo ? badge("$" + d.costo, "tipo", t("costo stimato da Claude Code")) : "");
  $("ris-richiesta").textContent = d.richiesta || t("(nessuna)");
  $("ris-richiesta-conta").textContent = d.richiesta ? t("{n} caratteri", { n: d.richiesta.length }) : "";
  if (primo) $("ris-richiesta-box").open = (d.richiesta || "").length < 400;
  const pre = $("ris-testo");
  const inFondo = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20;
  const testo = testoPulito(d);
  pre.textContent = testo || (d.stato === "in corso" ? t("In corso…") : t("(nessuna uscita)"));
  pre.classList.toggle("in-corso", d.stato === "in corso");
  $("ris-righe").textContent = testo ? t("{n} righe", { n: testo.split("\n").length }) : "";
  if (primo) pre.scrollTop = 0; else if (inFondo && d.stato === "in corso") pre.scrollTop = pre.scrollHeight;
  const firma = [d.id, d.stato, d.sessione, d.rilanciabile].join("|");
  if (firma !== firmaDettaglio) { firmaDettaglio = firma; disegnaAzioniLavoro(d); }
}

function disegnaAzioniLavoro(d) {
  const chiuso = d.stato !== "in corso";
  const puoContinuare = chiuso && d.sessione && d.interlocutore &&
    (d.interlocutore === "jarvis" || AGENTI.has(d.interlocutore));
  const b = (testo, attr, fn) => el("button", Object.assign({ class: "piccolo", type: "button" }, attr, { onclick: fn }), testo);
  $("ris-azioni").replaceChildren(
    b("⧉ " + t("Copia risultato"), { title: t("Copia il risultato negli appunti") }, async () => {
      const x = await api("/api/lavoro/" + d.id).catch(() => d);
      navigator.clipboard.writeText(testoPulito(x)).then(() => toast(t("Risultato copiato")));
    }),
    b("⧉ " + t("Copia richiesta"), {}, () => navigator.clipboard.writeText(d.richiesta || "").then(() => toast(t("Richiesta copiata")))),
    puoContinuare ? b("💬 " + t("Continua in chat"), { class: "piccolo primario", title: t("Riapre in Chat la stessa conversazione di Claude Code, con il filo") }, () => continuaInChat(d)) : "",
    !puoContinuare ? b("💬 " + t("Chiedi a Jarvis"), { title: t("Prepara in Chat una domanda su questo lavoro") }, () => {
      apriChat("jarvis");
      $("chiedi-testo").value = t("Sul lavoro «{titolo}» (log: {log}):", { titolo: d.titolo, log: d.log.replace(/^\/Users\/[^/]+/, "~") }) + " ";
      autoAltezza(); $("chiedi-testo").focus();
    }) : "",
    d.rilanciabile ? b("↻ " + t("Rilancia"), { disabled: chiuso ? null : "", title: t("Rifà lo stesso lavoro, con la stessa richiesta") },
      async (ev) => { const r = await azione({ tipo: "rilancia", id: d.id }, ev.currentTarget); if (r && r.lavoro) scegliLavoro(r.lavoro.id); }) : "",
    !chiuso ? b("■ " + t("Ferma"), { class: "piccolo pericolo" }, (ev) => azione({ tipo: "ferma", id: d.id }, ev.currentTarget)) : "",
    b("⌕ " + t("Log nel Finder"), { title: d.log }, (ev) => azione({ tipo: "mostra_log", id: d.id }, ev.currentTarget)),
    el("span", { class: "spazio" }),
    b("⤢", { class: "piccolo icona-q", title: t("Ingrandisci il risultato (Esc per tornare)"), "aria-pressed": "false" }, (ev) => {
      const v = $("blocco-lavori");
      v.classList.toggle("ris-intero");
      ev.currentTarget.setAttribute("aria-pressed", String(v.classList.contains("ris-intero")));
    }),
    b(t("Togli dalla lista"), { class: "piccolo pericolo", disabled: chiuso ? null : "", title: chiuso ? t("Toglie la voce dalla lista; il log resta in lavori/") : t("Prima fermalo") },
      async (ev) => {
        if (!confirm(t("Togliere «{titolo}» dalla lista dei lavori?\n\nIl log resta sul disco in lavori/.", { titolo: d.titolo }))) return;
        const r = await azione({ tipo: "togli_lavoro", id: d.id }, ev.currentTarget);
        if (r) { mostraDettaglio(null); disegnaLavori(ultimiLavori.filter((x) => x.id !== d.id)); }
      }));
}

// Riapre in Chat il filo di Claude Code di un lavoro: stessa sessione (--resume),
// con richiesta e risposta già in pagina, così si continua da lì.
function continuaInChat(d) {
  const k = d.interlocutore;
  const fl = filo(k);
  if (fl.sessione !== d.sessione) {
    if (fl.attesa) { toast(t("Quella chat sta aspettando una risposta: riprova tra poco"), true); return; }
    const nome = k === "jarvis" ? "Jarvis" : nomeDi(AGENTI.get(k));
    if (fl.messaggi.length && !confirm(t("La chat con {nome} ha già un'altra conversazione.\n\nLa sostituisco con il filo di questo lavoro? La vecchia resta in Claude Code, qui non si vede più.", { nome }))) return;
    THREADS[k] = { sessione: d.sessione, avviata: true, messaggi: [
      { chi: "io", testo: d.richiesta || d.titolo, ora: (d.inizio || "").slice(0, 5) },
      { chi: "lui", testo: testoPulito(d).trim() || t("(nessuna risposta)"), ora: (d.fine || "").slice(0, 5), errore: d.stato !== "finito" }] };
    salvaFili();
  }
  apriChat(k);
  toast(t("Conversazione ripresa: scrivi e continua"));
}

$("lavori-filtri").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-filtro]");
  if (!b) return;
  filtroLavori = b.dataset.filtro;
  for (const x of $("lavori-filtri").children) x.classList.toggle("attivo", x === b);
  disegnaLavori(ultimiLavori);
});
$("lavori-cerca").addEventListener("input", (ev) => { cercaLavori = ev.target.value.trim(); disegnaLavori(ultimiLavori); });
$("lavori-pulisci").addEventListener("click", async (ev) => {
  const n = ultimiLavori.filter((l) => l.stato !== "in corso").length;
  if (!n || !confirm(t("Togliere dalla lista {n} lavori chiusi?\n\nI log restano sul disco in lavori/.", { n }))) return;
  const r = await azione({ tipo: "pulisci_lavori" }, ev.currentTarget);
  if (r) { if (!ultimiLavori.some((l) => l.id === lavoroScelto && l.stato === "in corso")) mostraDettaglio(null); }
});
$("ris-acapo").addEventListener("change", (ev) => $("ris-testo").classList.toggle("senza-acapo", !ev.target.checked));
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") $("blocco-lavori")?.classList.remove("ris-intero");
});

function statoGenerale(s) {
  const problemi = [];
  const v = s.vps || {};
  if (v.raggiungibile === false) problemi.push(t("VPS non raggiungibile"));
  for (const [nome, c] of Object.entries(v.siti || {})) if (!/^[23]/.test(c) && !SITI_IGNORATI.includes(nome)) problemi.push(nome);
  for (const c of v.contenitori || []) if (!c.attivo) problemi.push(c.nome);
  if (s.locale && s.locale.fidata === false) problemi.push(t("cartella non fidata"));
  for (const dove of ["mac", "vps"]) {
    const g = (s.telegram || {})[dove];
    if (g && g.bot && !g.spento && !g.lettore && !g.occupato) problemi.push("Telegram " + (dove === "mac" ? t("computer") : t("server")));
  }
  const p = $("pallino-generale");
  if (!("siti" in v)) { p.className = "pallino grigio"; $("testo-generale").textContent = t("lettura in corso"); return; }
  p.className = "pallino " + (problemi.length ? "giallo" : "verde");
  $("testo-generale").textContent = problemi.length ? t("da guardare: {elenco}", { elenco: problemi.join(", ") }) : t("tutto regolare");
}

// Le liste si ridisegnano solo quando i loro dati cambiano (stesso schema di disegnaAgentiSpazi):
// ridisegnarle a ogni giro faceva perdere focus, hover e clic in corso. Le firme vanno azzerate
// quando si vuole un ridisegno forzato (firme = {}).
let firme = {};
function cambiato(chiave, ...dati) {
  const f = JSON.stringify(dati);
  if (firme[chiave] === f) return false;
  firme[chiave] = f;
  return true;
}

// Dati vecchi: ogni chiave dello stato porta letto_ts (quando il server l'ha letta davvero) ed
// errore_ts (quando l'ultima lettura è fallita). Oltre tre giri del suo intervallo, o dopo un
// errore, il riquadro si mostra in grigio invece che come fresco.
const INTERVALLO_S = { catena: 120, memoria: 120, telefono: 10, claude: 300 };
function datoVecchio(chiave, d, oraTs) {
  if (!d) return "";
  if (d.errore_ts && (!d.letto_ts || d.errore_ts >= d.letto_ts)) return t("ultima lettura fallita: {errore}", { errore: d.errore || "" });
  if (d.letto_ts && oraTs - d.letto_ts > 3 * INTERVALLO_S[chiave])
    return t("dato letto {minuti} min fa", { minuti: Math.round((oraTs - d.letto_ts) / 60) });
  return "";
}
function marcaVecchio(ids, perche) {
  for (const id of ids) {
    const n = $(id);
    if (!n) continue;
    n.classList.toggle("dato-vecchio", !!perche);
    if (perche) n.title = "⚠ " + perche; else if (n.title.startsWith("⚠ ")) n.title = "";
  }
}

// Un solo numero sulla voce «Squadra»: agenti al lavoro + lavori in corso.
const contaCatena = { agenti: 0, lavori: 0 };
function disegnaContaCatena() {
  const b = $("conta-catena");
  const n = contaCatena.agenti + contaCatena.lavori;
  b.textContent = n || "";
  b.title = t("{agenti} agenti al lavoro · {lavori} lavori in corso", { agenti: contaCatena.agenti, lavori: contaCatena.lavori });
}

// ---------------------------------------------------------------- l'ultimo dato di ogni box
// «Chiedi a Jarvis» da un box allega quello che il box sta mostrando (contratto, punto 5):
// ULTIMO[box] si riempie a ogni giro di aggiorna(). Solo il necessario: il server taglia a 4000 caratteri.
const ULTIMO = {};
const TITOLI_BOX = { locale: t("Interruttori"), vps: t("Server remoto"), memoria: t("Memoria"), portiere: t("Chiavi e da guardare"),
  lavori: t("Lavori"), missioni: t("Missioni"), claude_ora: t("Claude adesso"), catena: t("Catena"), salute: t("Salute del pannello"),
  telefono: t("Telefono"), sentinella: t("Sentinella"), tecnico: t("Tecnico"), agenti: t("Agenti e lavagna"), scadenze: t("Scadenze") };
function riempiUltimo(s, portiere) {
  const l = s.locale || {};
  ULTIMO.locale = { stato_generale: $("testo-generale").textContent, voce: l.voce, voce_stato: l.voce_stato, volto: l.volto,
    mani: l.mani, telefono: l.telefono, schermo_telefono: l.schermo_telefono, chiede_prima: l.chiede_prima, al_pc: l.al_pc,
    fidata: l.fidata, mac: l.mac, telegram: s.telegram };
  ULTIMO.vps = s.vps || null;
  const m = s.memoria || {}, b = m.battito || {};
  ULTIMO.memoria = { note: m.note, sessioni: m.sessioni, diario_oggi: m.diario_oggi,
    battito: { quando: b.quando, acceso: b.acceso, indietro: b.indietro,
      progetti: (b.progetti || []).map((p) => ({ progetto: p.progetto, semaforo: p.semaforo, esito: p.esito,
        memoria: p.memoria, lavoro: p.lavoro, da_fare: p.da_fare })) },
    sviluppi: (m.sviluppi || []).map((x) => ({ nome: x.nome, stato: x.stato, task_aperti: (x.task || []).length })) };
  ULTIMO.portiere = portiere;
  // dei lavori solo id, titolo e stato; il log solo per quelli in errore, perché Jarvis lo possa leggere
  ULTIMO.lavori = (s.lavori || []).map((x) => Object.assign({ id: x.id, titolo: x.titolo, stato: x.stato },
    x.stato === "errore" ? { log: x.log } : {}));
  ULTIMO.missioni = (s.missioni || []).map((x) => ({ id: x.id, stato: x.stato, chi: x.chi }));
  ULTIMO.claude_ora = s.claude_ora ? Object.assign({}, s.claude_ora, { agenti: (s.claude_ora.agenti || []).slice(-12) }) : null;
  ULTIMO.catena = s.catena || null;
  ULTIMO.salute = s.salute || null;
  ULTIMO.telefono = s.telefono ? Object.assign({}, s.telefono, { chiamate: (s.telefono.chiamate || []).slice(0, 5) }) : null;
  ULTIMO.sentinella = s.sentinella || null;
  ULTIMO.scadenze = SCAD.dati;
}

// ---------------------------------------------------------------- spie sulle schede e sui box
// Regole del contratto, punto 7 (26/09/2026). Una spia per scheda nella barra e un alone per box
// (data-stato sulla section.pannello). «grigia» vuol dire: il dato non c'è (server vecchio o non letto).
const TESTO_SPIA = { ok: t("in ordine"), attenzione: t("da guardare"), guasto: t("qualcosa è giù"), lavora: t("sta lavorando"), grigia: t("nessun dato") };
let ultimoStato = null;
function statoBox(id, stato) {
  const n = $(id);
  if (!n) return;
  if (!stato || stato === "grigia") delete n.dataset.stato; else n.dataset.stato = stato;
}
function statoServer(v) {
  v = v || {};
  if (!("siti" in v) || v.configurata === false) return "grigia";
  if (v.raggiungibile === false || (v.contenitori || []).some((c) => !c.attivo) ||
    Object.entries(v.siti || {}).some(([nome, c]) => !/^[23]/.test(c) && !SITI_IGNORATI.includes(nome))) return "guasto";
  return (v.disco ?? 0) > 85 || (v.ram ?? 0) > 85 ? "attenzione" : "ok";
}
function spieSchede(s) {
  const portiere = portiereDi(s);
  const st = {};
  st.chat = Object.values(THREADS).some((t) => t.attesa) ? "lavora" : "ok";
  const rac = s.salute && s.salute.raccoglitori;
  st.home = !Array.isArray(rac) ? "grigia" : rac.some((r) => r.errore) ? "guasto" : "ok";
  const lavoriInCorso = (s.lavori || []).some((l) => l.stato === "in corso");
  const alLavoro = (s.claude_ora && s.claude_ora.lavorando) || lavoriInCorso || (s.agenti_attivi || []).length > 0;
  const sp = statoPortiere(portiere);
  st.agenti = alLavoro ? "lavora" : sp === "grigia" ? "ok" : sp;
  const ms = (s.missioni || []).map((m) => m.stato);
  st.missioni = !s.missioni ? "grigia" : ms.some((x) => x === "in corso" || x === "in avvio") ? "lavora"
    : ms.some((x) => x === "attende conferma" || x === "attende istruzioni") ? "attenzione" : "ok";
  const b = s.memoria && s.memoria.battito;
  const sem = ((b && b.progetti) || []).map((p) => p.semaforo || "");
  st.memoria = !b ? "grigia" : sem.some((x) => x.includes("🔴")) ? "guasto"
    : sem.some((x) => x.includes("🟡")) || !b.acceso ? "attenzione" : "ok";
  st.server = statoServer(s.vps);
  const t = s.telefono;
  st.telefono = !t || !("centralino" in t) ? "grigia"
    : t.centralino && String(t.registrazione || "").toLowerCase() !== "registered" ? "attenzione" : "ok";
  st.tecnico = !ULTIMO.tecnico ? "grigia" : (ULTIMO.tecnico.telefono || {}).collegato ? "ok" : "attenzione";
  st.lavagna = panPronto ? "ok" : "grigia";
  st.scadenze = statoScadenze();
  for (const a of document.querySelectorAll(".menu a[data-vista]")) {
    const i = a.querySelector(".spia");
    if (!i) continue;
    const v = st[a.dataset.vista] || "grigia";
    i.className = "spia " + v;
    i.title = TESTO_SPIA[v];
  }
  // i box
  statoBox("box-claude-ora", !s.claude_ora ? "grigia" : s.claude_ora.lavorando ? "lavora" : "ok");
  statoBox("box-chiavi", sp);
  statoBox("box-lavori", lavoriInCorso ? "lavora" : (s.lavori || []).some((l) => l.stato === "errore") ? "attenzione" : "ok");
  statoBox("box-missioni", st.missioni);
  statoBox("box-memoria", st.memoria);
  statoBox("box-vps", st.server);
  statoBox("box-salute", st.home);
  const sent = s.sentinella;
  statoBox("box-sentinella", !sent ? "grigia" : (sent.anomalie || []).length ? "guasto" : "ok");
  statoBox("box-telefono", st.telefono);
  statoBox("box-scad-registro", SCAD.registro === false ? "grigia" : statoColonna(SCAD.dati && SCAD.dati.registro));
  statoBox("box-scad-personali", statoColonna(SCAD.dati && SCAD.dati.personali));
  statoBox("box-scad-task", statoColonna(SCAD.dati && SCAD.dati.task));
}
// la spia della Chat cambia appena parte o arriva una risposta, senza aspettare il giro dopo
function aggiornaSpie() { if (ultimoStato) spieSchede(ultimoStato); }

let aggiornaInCorso = false;
let aggiornaDiNuovo = false;
async function aggiorna(ripeti = false) {
  // il giro prima non è ancora tornato: il sondaggio salta questo, il flusso lo rimette in coda
  if (aggiornaInCorso) { if (ripeti === true) aggiornaDiNuovo = true; return; }
  aggiornaInCorso = true;
  try {
    const s = await api("/api/stato");
    if (s.versione != null) FLUSSO.versione = s.versione;
    disegnaLocale(s.locale || {});
    if (cambiato("vps", s.vps)) disegnaVps(s.vps);
    disegnaTelegram(s.telegram);
    if (cambiato("memoria", s.memoria)) disegnaMemoria(s.memoria);
    if (cambiato("eventi", s.eventi)) disegnaEventi(s.eventi);
    if (cambiato("lavori", s.lavori, lavoroScelto)) disegnaLavori(s.lavori); else aggiornaDurate();
    const missioniAttive = (s.missioni || []).some((m) => !["chiusa", "interrotta", "errore"].includes(m.stato));
    if (cambiato("missioni", s.missioni, missioniAttive ? Math.floor(Date.now() / 10000) : 0)) disegnaMissioni(s.missioni);
    if (cambiato("telefono", s.telefono)) disegnaTelefono(s.telefono);
    if (cambiato("attivi", s.agenti_attivi)) disegnaAgentiAttivi(s.agenti_attivi);
    const alLavoro = (s.claude_ora && s.claude_ora.lavorando) || (s.agenti_attivi || []).length;
    if (cambiato("claudeOra", s.claude_ora, s.catena, s.agenti_attivi, alLavoro ? Date.now() : 0))
      disegnaClaudeOra(s.claude_ora, s.catena, s.agenti_attivi);
    disegnaClaude(s.claude);
    const portiere = portiereDi(s);
    if (cambiato("portiere", portiere)) disegnaChiavi(portiere, s.memoria && s.memoria.battito && s.memoria.battito.perche);
    if (cambiato("salute", s.salute)) disegnaSalute(s.salute);
    if (cambiato("sentinella", s.sentinella)) disegnaSentinella(s.sentinella);
    if (cambiato("modoChat", s.modo_chat)) disegnaModoChat(s.modo_chat);
    if (cambiato("versione", s.aggiornamento)) disegnaVersione(s.aggiornamento);
    // sinapsi: si ridisegna solo quando cambia un id o uno stato
    if (cambiato("sinapsi", (s.comunicazioni || []).map((c) => c.id + "|" + c.stato))) aggiornaSinapsi(s.comunicazioni || []);
    const ora = s.ora_ts || Date.now() / 1000;
    marcaVecchio(["claude-sincro", "mem-progetti", "mem-note", "mem-sessioni", "mem-diario", "mem-task"], datoVecchio("memoria", s.memoria, ora));
    marcaVecchio(["tel-stato", "tel-chiamate"], datoVecchio("telefono", s.telefono, ora));
    const claudeVecchio = datoVecchio("claude", s.claude, ora);
    marcaVecchio(["mot-claude"], claudeVecchio);
    if (claudeVecchio) $("mot-claude").className = "pallino grigio";
    statoGenerale(s);
    caricaScadenze();
    riempiUltimo(s, portiere);
    ultimoStato = s;
    aggiornaAttivita(s);
    seguiCatenaGiro(s);
    spieSchede(s);
    $("conta-missioni").textContent = (s.missioni || []).filter((m) => ["in corso", "attende conferma", "attende istruzioni", "in avvio"].includes(m.stato)).length || "";
    contaCatena.lavori = (s.lavori || []).filter((l) => l.stato === "in corso").length;
    disegnaContaCatena();
    // il dettaglio del lavoro scelto si rilegge solo se è in corso o se il suo stato è cambiato
    const scelto = (s.lavori || []).find((l) => l.id === lavoroScelto);
    if (scelto && (scelto.stato === "in corso" || firmaDettaglio.split("|")[1] !== scelto.stato)) caricaLavoro();
    caricaMissione();
  } catch (e) {
    $("pallino-generale").className = "pallino rosso";
    $("testo-generale").textContent = t("Command Center non risponde");
  } finally {
    aggiornaInCorso = false;
    if (aggiornaDiNuovo) { aggiornaDiNuovo = false; setTimeout(() => aggiorna(), 0); }
  }
}

// ---------------------------------------------------------------- versione di Jarvis
// s.aggiornamento: {versione, nuova, controllato, copie, in_corso, fallita, si_aggiorna}. «Aggiorna»
// compare solo quando ne è uscita una nuova, «Torna indietro» solo se c'è una copia di prima.
// Il lavoro (aggiorna.py) si vede in Squadra › Lavori, riga per riga.
function disegnaVersione(a) {
  const testo = $("ver-testo");
  if (!a) { testo.textContent = t("il server non dice la versione"); return; }
  const righe = [`Jarvis ${a.versione || "?"}`];
  if (a.in_corso) righe.push(t("aggiornamento in corso: lo segui in Squadra › Lavori"));
  else if (a.fallita) righe.push(t("l'aggiornamento alla {nuova} non è riuscito: sei rimasto alla {versione}, non hai perso niente", { nuova: a.fallita, versione: a.versione }));
  else if (a.nuova) righe.push(t("è uscita la {versione}", { versione: a.nuova }));
  else righe.push(t("è l'ultima versione"));
  if (!a.si_aggiorna) righe.push(t("questa copia non si aggiorna da qui"));
  testo.textContent = righe.join(" · ");
  testo.className = "ver-testo" + (a.fallita ? " attenzione" : a.nuova ? " nuova" : "");
  $("ver-controllato").textContent = a.controllato ? t("controllato il {data}", { data: a.controllato }) : "";
  $("ver-aggiorna").classList.toggle("nascosto", !(a.nuova && a.si_aggiorna));
  $("ver-indietro").classList.toggle("nascosto", !(a.copie > 0 && a.si_aggiorna));
  for (const b of document.querySelectorAll("[data-aggiornamento]")) b.disabled = !!a.in_corso || !a.si_aggiorna;
}
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-aggiornamento]");
  if (!b) return;
  const cosa = b.dataset.aggiornamento;
  if (cosa === "torna-indietro" && !confirm(t("Tornare alla versione di prima? I tuoi dati non si toccano."))) return;
  const d = await azione({ tipo: "aggiornamento", cosa }, b);
  if (d && d.lavoro) toast(t("{titolo}: lo segui in Squadra › Lavori", { titolo: d.lavoro.titolo }));
});

// La durata dei lavori in corso avanza anche quando la lista non si ridisegna.
function aggiornaDurate() {
  for (const l of ultimiLavori) {
    if (l.stato !== "in corso") continue;
    const b = document.querySelector(`#lavori [data-lid="${CSS.escape(l.id)}"] .badge.durata`);
    if (b) b.textContent = "⏱ " + durataLavoro(l);
  }
}

let CAT = {};        // l'ultimo /api/catalogo: menu «/», spunti della chat vuota, verifiche
async function catalogo() {
  const c = await api("/api/catalogo");
  CAT = c;
  const box = $("verifiche");
  box.replaceChildren(...c.verifiche.map((v) =>
    el("button", { onclick: (ev) => azione({ tipo: "verifica", id: v.id }, ev.currentTarget) }, v.nome, el("small", {}, v.descrizione))));
  agenti = c.agenti;
  disegnaSpazi(c.spazi);
  api("/api/spazi").then((d) => disegnaGruppiArchiviati(d.gruppi_archiviati)).catch(() => {});
  disegnaComandi(c.comandi);
  disegnaComandClaudeCode(c.comandi_claude_code);
  disegnaCollegamenti(c.collegamenti);
  const sel = $("agente-scelto");
  sel.replaceChildren(...agenti.map((a) => el("option", { value: a.id }, a.id)));
  // onchange e non addEventListener: catalogo() ora gira anche dopo ogni risposta, i listener si sommavano
  const desc = () => { const a = agenti.find((x) => x.id === sel.value); $("agente-desc").textContent = (a ? a.descrizione : "") + " · " + t("lavora in sola lettura."); };
  sel.onchange = desc;
  desc();
  // gli spunti della chat vuota e il menu «/» seguono il catalogo nuovo
  if (!filo(chatCon).messaggi.length && !filo(chatCon).attesa) disegnaMessaggi();
  if (!$("suggerimenti").classList.contains("nascosto")) mostraSuggerimenti();
}

function orologio() {
  const d = new Date();
  $("ora").textContent = d.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
  $("data").textContent = d.toLocaleDateString(LOCALE, { weekday: "short", day: "numeric", month: "short" });
  aggiornaEta();
}

document.addEventListener("click", (ev) => {
  const riga = ev.target.closest("[data-int]");
  if (riga && ev.target.classList.contains("switch")) {
    azione({ tipo: "interruttore", nome: riga.dataset.int, acceso: !ev.target.classList.contains("on") }, ev.target);
  }
  if (riga && riga.dataset.tg && ev.target.classList.contains("riaggancia")) {
    azione({ tipo: "telegram_riaggancia", dove: riga.dataset.tg }, ev.target);
  }
  const b = ev.target.closest("[data-azione]");
  if (b) azione({ tipo: b.dataset.azione }, b);
  const a = ev.target.closest("[data-android]");
  if (a) azione({ tipo: "android", cosa: a.dataset.android,
    indirizzo: a.dataset.android === "associa" ? $("and-pair").value : $("and-conn").value, codice: $("and-codice").value }, a);
});
// Aggiornamento forzato (contratto, punto 6): il server rilancia subito il raccoglitore e risponde
// quando ha finito; azione() poi rilegge lo stato. «tutto» dal ↻ in alto, «memoria» da Verifica ora,
// una chiave sola dal ↻ di ogni riga di «Salute del pannello».
$("btn-aggiorna").addEventListener("click", (ev) => azione({ tipo: "aggiorna", cosa: "tutto" }, ev.currentTarget));
$("btn-verifica-memoria").addEventListener("click", (ev) => azione({ tipo: "aggiorna", cosa: "memoria" }, ev.currentTarget));
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-aggiorna]");
  if (b) azione({ tipo: "aggiorna", cosa: b.dataset.aggiorna }, b);
});
$("btn-agente")?.addEventListener("click", (ev) =>
  azione({ tipo: "agente", id: $("agente-scelto").value, richiesta: $("agente-richiesta").value }, ev.currentTarget));




// ---------------------------------------------------------------- missioni
// Dal 23/09/2026 una missione = uno spazio + uno o più progetti + un obiettivo.
// Un solo processo: l'orchestratore lancia gli esperti in parallelo (al massimo N),
// poi il capogruppo verifica. L'albero arriva da agenti.json della missione.
let spaziCat = [];
const aperte = new Set();        // le missioni con la scheda aperta
const registriAperti = new Set();
const schede = new Map();        // id missione -> nodi della scheda, per non perdere quello che scrivi
const ETICHETTE = { "in avvio": "in-avvio", "in corso": "in-corso", "attende conferma": "attende-conferma",
  "attende istruzioni": "attende-istruzioni", chiusa: "chiusa", interrotta: "interrotta", errore: "errore" };
const ICONA = { "in corso": "🟡", "attende conferma": "⚠", "attende istruzioni": "🔵", "in avvio": "⏳",
  chiusa: "🟢", interrotta: "🔴", errore: "🔴" };
const AG = { "in coda": ["⏳", t("in coda")], lavora: ["🟡", t("lavora")], consegnato: ["🟢", t("consegnato")], errore: ["🔴", t("errore")] };
// gli stati delle missioni arrivano in italiano dal server: si mostrano tradotti
const NOME_STATO_M = { "in avvio": t("in avvio"), "in corso": t("in corso"), "attende conferma": t("attende conferma"),
  "attende istruzioni": t("attende istruzioni"), chiusa: t("chiusa"), interrotta: t("interrotta"), errore: t("errore"),
  attivo: t("attivo"), finito: t("finito") };
const NOME_MODALITA = { lettura: t("lettura"), lavoro: t("lavoro") };

function disegnaSpazi(elenco) {
  spaziCat = elenco || [];
  const sel = $("missione-spazio");
  const prima = sel.value;
  sel.replaceChildren(...spaziCat.map((s) => el("option", { value: s.id }, s.nome)));
  if (prima && spaziCat.some((s) => s.id === prima)) sel.value = prima;
  disegnaProgettiSpazio();
  disegnaAgentiSpazi();
  const sc = $("lav-spazio-catena"), primaSc = sc.value;
  sc.replaceChildren(el("option", { value: "tutti" }, t("tutti gli spazi")), ...spaziCat.map((s) => el("option", { value: s.id }, s.nome)));
  sc.value = spaziCat.some((s) => s.id === primaSc) ? primaSc : "tutti";
  disegnaGruppi();      // la colonna di sinistra
}

function disegnaProgettiSpazio() {
  const s = spaziCat.find((x) => x.id === $("missione-spazio").value) || spaziCat[0];
  const box = $("missione-progetti");
  box.replaceChildren(...(s ? s.progetti : []).map((p, i) => el("label", { title: p.cartella },
    el("input", Object.assign({ type: "checkbox", value: p.id }, i === 0 ? { checked: "" } : {}, p.esiste ? {} : { disabled: "" })),
    " " + p.nome)));
}
$("missione-spazio")?.addEventListener("change", disegnaProgettiSpazio);

function minuti(da, a) {
  if (!da) return "";
  const s = Math.max(0, ((a ? new Date(a) : new Date()) - new Date(da)) / 1000);
  return s < 60 ? Math.round(s) + "s" : Math.round(s / 60) + "m";
}

function rigaAgente(m, a, ultimo) {
  const [ic, testo] = AG[a.stato] || ["·", a.stato];
  const riga = el("li", { class: "ag " + a.stato.replace(" ", "-") },
    el("span", { class: "ramo" }, ultimo ? "└─" : "├─"),
    el("span", { class: "nome" }, a.tipo + (a.capogruppo ? " (" + t("capogruppo") + ")" : "")),
    el("span", { class: "modello " + (a.modello || "") }, a.modello || "—"),
    el("span", { class: "st" }, `${ic} ${testo}`),
    el("small", { class: "dur" }, a.inizio ? minuti(a.inizio, a.fine) : ""),
    el("small", { class: "cosa", title: a.esito || a.ultima || a.descrizione || "" },
      a.stato === "lavora" ? (a.ultima || a.descrizione || "") : (a.esito || a.descrizione || "").split("\n")[0].replace(/^[#>*\s]+/, "")));
  if (a.stato === "consegnato" || a.stato === "errore") {
    riga.append(el("button", { class: "piccolo", onclick: () => apriEsito(m.id, a) }, t("apri")));
  }
  return riga;
}

function alberoMissione(m) {
  const orch = el("div", { class: "orch" }, el("span", { class: "nome" }, t("Orchestratore")),
    el("span", { class: "modello sonnet" }, "sonnet"),
    el("span", { class: "st" }, `${ICONA[m.stato] || "·"} ${NOME_STATO_M[m.stato] || m.stato}`),
    el("small", {}, m.modalita ? t("{modalita} · max {n} in parallelo", { modalita: NOME_MODALITA[m.modalita] || m.modalita, n: m.max_paralleli }) : ""));
  // a missione finita nessuno «lavora» più e nessun capogruppo è «in attesa»: un capogruppo restava
  // «⏳ dopo gli esperti» per sempre in una missione chiusa, e sembrava un'orchestrazione ancora aperta
  const finita = ["chiusa", "interrotta", "errore"].includes(m.stato);
  const righe = (m.agenti || []).map((a) => (finita && a.stato === "lavora"
    ? Object.assign({}, a, { stato: "errore", esito: a.esito || t("missione chiusa prima della consegna") }) : a));
  // il capogruppo che non è ancora partito: verifica dopo gli esperti
  for (const c of m.capogruppi || []) {
    if (!righe.some((a) => a.tipo === c)) righe.push({ tipo: c, capogruppo: true, modello: "", stato: finita ? "mai" : "attesa", descrizione: t("verifica dopo gli esperti") });
  }
  const ul = el("ul", { class: "albero" });
  righe.forEach((a, i) => {
    const ultimo = i === righe.length - 1;
    if (a.stato === "attesa" || a.stato === "mai") {
      ul.append(el("li", { class: "ag attesa" }, el("span", { class: "ramo" }, ultimo ? "└─" : "├─"),
        el("span", { class: "nome" }, a.tipo + " (" + t("capogruppo") + ")"),
        el("span", { class: "st" }, a.stato === "mai" ? t("— non partito") : "⏳ " + t("dopo gli esperti"))));
    } else ul.append(rigaAgente(m, a, ultimo));
  });
  if (!righe.length) ul.append(el("li", {}, el("small", {}, t("nessun esperto ancora lanciato"))));
  return [orch, ul];
}

function confermeMissione(m) {
  return (m.richieste || []).map((r) => {
    const nota = el("input", { placeholder: t("Motivo, se dici no (facoltativo)") });
    return el("div", { class: "conferma" },
      el("b", {}, "⚠ " + t("Conferma richiesta: {strumento}", { strumento: r.strumento })),
      el("div", {}, r.sintesi || ""),
      el("code", {}, r.dettaglio || ""),
      nota,
      el("div", { class: "azioni-riga" },
        el("button", { class: "si", onclick: (ev) => rispondi(ev, true) }, t("Sì")),
        el("button", { class: "no", onclick: (ev) => rispondi(ev, false) }, t("No")),
        el("small", {}, t("alle {ora}", { ora: r.ora || "" }))));
    // una risposta sola: dopo, i due pulsanti si spengono e dicono cosa è stato risposto
    async function rispondi(ev, ok) {
      const riga = ev.currentTarget.parentElement;
      const d = await azione(Object.assign({ tipo: "conferma", missione: m.id, richiesta: r.id, ok }, ok ? {} : { nota: nota.value }), ev.currentTarget);
      if (!d) return;
      riga.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      riga.append(el("b", {}, " · " + (ok ? t("risposto: sì") : t("risposto: no"))));
      nota.disabled = true;
    }
  });
}

function schedaMissione(m) {
  let s = schede.get(m.id);
  if (!s) {
    const testa = el("summary", {});
    const albero = el("div", { class: "albero-box" });
    const conferme = el("div", { class: "conferme" });
    const reg = el("pre", { class: "uscita alta" }, "…");
    const regBox = el("details", { class: "registro" }, el("summary", {}, t("Registro")), reg);
    regBox.addEventListener("toggle", () => { regBox.open ? registriAperti.add(m.id) : registriAperti.delete(m.id); caricaRegistri(); });
    const input = el("input", { placeholder: t("Scrivi all'orchestratore") });
    const form = el("form", { class: "azioni-riga istruzione" }, input, el("button", { type: "submit" }, t("Invia")));
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const d = await azione({ tipo: "istruzione", missione: m.id, testo: input.value }, ev.submitter);
      if (d && d.messaggio) input.value = "";
    });
    const report = el("small", { class: "report" });
    const chiudi = el("button", { type: "button", class: "piccolo", onclick: (ev) => azione({ tipo: "chiudi_missione", missione: m.id }, ev.currentTarget) }, "");
    const root = el("details", { class: "missione" }, testa, albero, conferme, regBox, form,
      el("div", { class: "azioni-riga" }, report, chiudi));
    root.addEventListener("toggle", () => { root.open ? aperte.add(m.id) : aperte.delete(m.id); });
    s = { root, testa, albero, conferme, reg, regBox, form, report, chiudi, chiavi: "" };
    schede.set(m.id, s);
  }
  const ora = (m.id.split("_")[1] || "").replace(/(\d\d)(\d\d).*/, "$1:$2");
  s.testa.replaceChildren(el("time", {}, ora),
    el("span", { class: "titolo" }, `${m.spazio ? m.spazio + " · " : ""}${m.progetto || ""} — «${(m.obiettivo || "").slice(0, 110)}»`),
    el("span", { class: "etichetta " + (ETICHETTE[m.stato] || "in-corso") }, `${ICONA[m.stato] || ""} ${NOME_STATO_M[m.stato] || m.stato}` + ((m.richieste || []).length ? ` · ${m.richieste.length}` : "")));
  s.albero.replaceChildren(...alberoMissione(m));
  const chiavi = (m.richieste || []).map((r) => r.id).join(",");
  if (chiavi !== s.chiavi) { s.conferme.replaceChildren(...confermeMissione(m)); s.chiavi = chiavi; }
  const finita = ["chiusa", "interrotta", "errore"].includes(m.stato);
  s.form.classList.toggle("nascosto", finita);
  s.chiudi.textContent = finita ? t("Togli dal pannello") : t("Chiudi missione");
  s.report.textContent = m.report ? t("Report: {file}", { file: m.report.split("/").slice(-2).join("/") }) : "";
  s.root.open = aperte.has(m.id);
  return s.root;
}

let idsMissioni = "";
const richiesteViste = new Set();
function disegnaMissioni(missioni) {
  const lista = $("missioni-lista");
  const tutte = missioni || [];
  // si apre da sola la prima volta la missione più recente e quella che chiede una conferma
  if (tutte.length && !schede.size) aperte.add(tutte[0].id);
  // si apre da sola solo quando arriva una richiesta NUOVA: se l'utente la chiude, resta chiusa
  for (const m of tutte) for (const r of m.richieste || []) if (!richiesteViste.has(m.id + ":" + r.id)) { richiesteViste.add(m.id + ":" + r.id); aperte.add(m.id); }
  if (!tutte.length) { idsMissioni = ""; lista.replaceChildren(el("small", {}, t("Nessuna missione. Scegli spazio e progetti, scrivi l'obiettivo e affidala."))); return; }
  const nodi = tutte.map(schedaMissione);          // aggiorna le schede sul posto
  const ids = tutte.map((m) => m.id).join(",");
  // si rimettono nella lista solo se l'elenco è cambiato: rimetterle ogni volta toglieva il
  // focus a chi stava scrivendo all'orchestratore
  if (ids !== idsMissioni) { lista.replaceChildren(...nodi); idsMissioni = ids; }
  for (const id of [...schede.keys()]) if (!tutte.some((m) => m.id === id)) schede.delete(id);
}

async function caricaRegistri() {
  for (const id of registriAperti) {
    const s = schede.get(id);
    if (!s) continue;
    try {
      const d = await api("/api/missione/" + id);
      const inFondo = s.reg.scrollTop + s.reg.clientHeight >= s.reg.scrollHeight - 30;
      s.reg.textContent = d.registro || t("(ancora niente)");
      if (inFondo) s.reg.scrollTop = s.reg.scrollHeight;
    } catch (e) { /* missione scomparsa */ }
  }
}
function caricaMissione() { caricaRegistri(); }

async function apriEsito(mid, a) {
  try {
    const d = await api(`/api/missione/${mid}/agente/${a.id}`);
    $("esito-titolo").textContent = t("Esito di {tipo}", { tipo: d.tipo }) + ` · ${d.descrizione || ""}`;
    $("esito-testo").textContent = d.esito_intero || t("(vuoto)");
    $("esito-box").classList.remove("nascosto");
    $("esito-box").scrollIntoView({ behavior: "smooth" });
  } catch (e) { toast(e.message, true); }
}

$("form-missione")?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const progetti = [...document.querySelectorAll("#missione-progetti input:checked")].map((x) => x.value);
  const modo = (document.querySelector("input[name=missione-modo]:checked") || {}).value || "lettura";
  const d = await azione({ tipo: "missione", spazio: $("missione-spazio").value, progetti, obiettivo: $("missione-obiettivo").value,
    max_paralleli: Number($("missione-max").value) || 5, modalita: modo }, ev.submitter);
  if (d && d.missione) { aperte.add(d.missione); $("missione-obiettivo").value = ""; }
});

// Agenti per spazio (ridisegnati il 26/09/2026): uno spazio = una sezione a tendina,
// un progetto = una card, il capogruppo in cima alla sua squadra. Niente intestazione di
// tabella ripetuta: ogni riga dice da sola chi è, cosa fa e con che modello. Se lo spazio
// ha un solo progetto con lo stesso nome («Sito» → «Sito web») il
// titolo compare una volta sola. Si ridisegna solo quando cambia qualcosa: così una
// tendina chiusa o il puntatore sopra una riga non si perdono ogni 4 secondi.
let firmaSpazi = "";
let filtroSpazi = "";
const spaziChiusi = new Set(mem_leggi("spaziChiusi", []));
function mem_leggi(k, d) { try { const v = localStorage.getItem("cc." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function mem_scrivi(k, v) { try { localStorage.setItem("cc." + k, JSON.stringify(v)); } catch (e) { /* pazienza */ } }
const normNome = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9àèéìòù]+/g, " ").trim();
function stessoNome(a, b) { const x = normNome(a), y = normNome(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); }

function rigaAgenteCatena(s, p, a) {
  const key = `${p.id}:${a.nome}`;
  const ag = (typeof AGENTI !== "undefined" && AGENTI.get(key)) || { key, nome: a.nome, spazio: s.id, capogruppo: a.capogruppo, modello: a.modello };
  const riga = el("div", { class: "riga-catena" + (a.capogruppo ? " capo" : ""), "data-agente": key, tabindex: "0", role: "button",
    title: (a.descrizione || "") + "\n\n" + t("clic: chatta · doppio clic: la scheda") },
    avatar(ag),
    el("div", { class: "riga-testo" },
      el("b", {}, nomeDi(ag), a.capogruppo ? el("span", { class: "badge capo" }, t("capogruppo")) : ""),
      el("small", {}, a.descrizione || "—")),
    el("span", { class: "modello " + (a.modello || "") }, a.modello || "—"),
    el("span", { class: "riga-azioni" },
      el("button", { class: "icona", type: "button", title: t("Chatta con {nome}", { nome: nomeDi(ag) }), onclick: (ev) => { ev.stopPropagation(); apriChat(key); } }, "💬"),
      el("button", { class: "icona", type: "button", title: t("Apri la scheda"), onclick: (ev) => { ev.stopPropagation(); apriScheda(key); } }, "ⓘ")));
  riga.addEventListener("click", () => apriChat(key));
  riga.addEventListener("dblclick", (ev) => { ev.preventDefault(); apriScheda(key); });
  riga.addEventListener("keydown", (ev) => { if (ev.key === "Enter") apriChat(key); if (ev.key === " ") { ev.preventDefault(); apriScheda(key); } });
  return riga;
}

function disegnaAgentiSpazi(forza = false) {
  const box = $("agenti-spazi");
  if (!box) return;
  const q = filtroSpazi.toLowerCase();
  const firma = JSON.stringify([spaziCat, (typeof PAN !== "undefined" && PAN.aspetto) || {}, q]);
  if (!forza && firma === firmaSpazi) { segnaAttivi(); return; }
  firmaSpazi = firma;
  const passa = (a) => !q || [a.nome, a.descrizione, a.modello].join(" ").toLowerCase().includes(q);
  let totale = 0, visti = 0;
  const sezioni = [];
  for (const s of spaziCat) {
    const colore = coloreSpazio(s.id);
    const nAgenti = s.progetti.reduce((n, p) => n + p.agenti.length, 0);
    totale += nAgenti;
    const modelli = {};
    for (const p of s.progetti) for (const a of p.agenti) modelli[a.modello || "—"] = (modelli[a.modello || "—"] || 0) + 1;
    const soloUno = s.progetti.length === 1 && stessoNome(s.nome, s.progetti[0].nome);
    const cards = [];
    for (const p of s.progetti) {
      const agenti = [...p.agenti].sort((x, y) => (y.capogruppo ? 1 : 0) - (x.capogruppo ? 1 : 0)).filter(passa);
      visti += agenti.length;
      if (q && !agenti.length) continue;
      const testa = soloUno ? "" : el("header", { class: "card-testa" },
        el("b", { title: p.cartella }, p.nome),
        el("small", {}, p.esiste ? t("{n} agenti", { n: p.agenti.length }) : t("cartella non trovata")));
      const corpo = agenti.length ? agenti.map((a) => rigaAgenteCatena(s, p, a))
        : [el("p", { class: "nota card-vuota" }, !p.esiste ? t("cartella del progetto non trovata") :
            p.agenti.length ? t("nessun agente con questo filtro") : t("nessun agente di progetto: lo segue direttamente Jarvis"))];
      cards.push(el("article", { class: "progetto-card" + (soloUno ? " solo" : "") },
        testa, el("div", { class: "card-righe" }, ...corpo),
        el("footer", { class: "card-piede", title: p.cartella }, "📁 " + p.cartella)));
    }
    if (q && !cards.length) continue;
    const aperto = q ? true : !spaziChiusi.has(s.id);
    const det = el("details", Object.assign({ class: "spazio-catena", style: `--c:${colore}`, "data-spazio": s.id }, aperto ? { open: "" } : {}),
      el("summary", {},
        el("span", { class: "spazio-emoji", "aria-hidden": "true" }, "◆"),
        el("div", { class: "spazio-titolo" }, el("h4", {}, s.nome),
          el("small", {}, soloUno ? t("{n} agenti", { n: nAgenti }) : t("{p} progetti · {n} agenti", { p: s.progetti.length, n: nAgenti }))),
        el("span", { class: "spazio-modelli" }, ...Object.entries(modelli).sort().map(([m, n]) =>
          el("span", { class: "modello " + m, title: t("{n} su {modello}", { n, modello: m }) }, `${m} ${n}`))),
        el("button", { class: "piccolo spazio-lavagna", type: "button", title: t("Apri lo spazio nella lavagna, capogruppo e squadra già collegati"),
          onclick: (ev) => { ev.preventDefault(); ev.stopPropagation();
            const gid = "spazio-" + s.id;
            if (gruppiEffettivi().some((g) => g.id === gid)) apriGruppoInLavagna(gid);
            else toast(t("Questo spazio non è più un gruppo nella colonna di sinistra"), true); } }, "▦ " + t("Lavagna")),
        el("span", { class: "freccia-spazio", "aria-hidden": "true" }, "›")),
      el("div", { class: "progetti-griglia" + (soloUno ? " uno" : "") }, ...cards));
    det.addEventListener("toggle", () => {
      if (q) return;
      det.open ? spaziChiusi.delete(s.id) : spaziChiusi.add(s.id);
      mem_scrivi("spaziChiusi", [...spaziChiusi]);
    });
    sezioni.push(det);
  }
  if (!sezioni.length) sezioni.push(el("p", { class: "nota" }, spaziCat.length ? t("Nessun agente con questo filtro.") : (CAT.skills ? t("nessun progetto con agenti: si aggiungono dall'installazione (installa/configura.py) o in spazi.json") : t("lettura degli agenti…"))));
  box.replaceChildren(...sezioni);
  $("spazi-conta").textContent = spaziCat.length ? (q ? t("{visti} di {totale} agenti", { visti, totale }) : t("{n} spazi · {totale} agenti", { n: spaziCat.length, totale })) : "";
  segnaAttivi();
}
$("spazi-cerca")?.addEventListener("input", (ev) => { filtroSpazi = ev.target.value.trim(); disegnaAgentiSpazi(); });
$("spazi-apri")?.addEventListener("click", () => { spaziChiusi.clear(); mem_scrivi("spaziChiusi", []); disegnaAgentiSpazi(true); });
$("spazi-chiudi")?.addEventListener("click", () => {
  for (const s of spaziCat) spaziChiusi.add(s.id);
  mem_scrivi("spaziChiusi", [...spaziChiusi]); disegnaAgentiSpazi(true);
});


// ---------------------------------------------------------------- scadenze
// GET /api/scadenze?chiuse=30: {registro, personali, task, chiuse, registro_configurato}, ogni voce {id, entro, testo,
// tipo, chi, eur, scaduta, giorni, fonte, nota}. Si rilegge a ogni aggiorna() e quando il flusso
// porta la chiave «scadenze». Il server vecchio risponde 404: allora «arriva col server nuovo».
const SCAD = { dati: null, stato: "", inCorso: false, annulla: null, timerAnnulla: null, chiuse: new Set(), registro: null,
  // controllo e pulizia: selezione, proposte di Jarvis, archivio
  pulizia: false, sel: new Set(), proposte: [], vista: "aperte", controllo: mem_leggi("scadControllo", null) };
const COLONNE_SCAD = [["registro", "scad-registro"], ["personali", "scad-personali"], ["task", "scad-task"]];
async function caricaScadenze() {
  if (SCAD.inCorso || SCAD.stato === "assente") return;
  SCAD.inCorso = true;
  try {
    const r = await fetch("/api/scadenze?chiuse=30", { headers: HDR });
    if (r.status === 404) { SCAD.stato = "assente"; disegnaScadenze(); return; }
    if (!r.ok) return;                                   // 403 e simili: ci pensa aggiorna() con api()
    const d = await r.json();
    SCAD.stato = "ok";
    SCAD.dati = { registro: d.registro || [], personali: d.personali || [], task: d.task || [] };
    SCAD.registro = d.registro_configurato !== false;
    // il server nuovo manda anche «chiuse» (archivio): è lui che sa fare controllo e chiusure in blocco
    SCAD.pulizia = Array.isArray(d.chiuse);
    SCAD.archivio = d.chiuse || [];
    if (cambiato("scadenze", SCAD.dati, SCAD.archivio, [...SCAD.chiuse])) { disegnaScadenze(); aggiornaSpie(); }
  } catch (e) { /* rete giù: il giro dopo riprova */ }
  finally { SCAD.inCorso = false; }
}
function giorniA(v) {
  if (typeof v.giorni === "number") return v.giorni;
  if (!v.entro) return null;
  return Math.round((new Date(v.entro + "T00:00:00") - new Date(oggiISO() + "T00:00:00")) / 86400000);
}
function gravitaScadenza(v) {
  const g = giorniA(v);
  return v.scaduta || (g != null && g < 0) ? "scaduta" : g != null && g <= 3 ? "vicina" : "";
}
function statoColonna(voci) {
  if (!Array.isArray(voci)) return "grigia";
  const g = voci.map(gravitaScadenza);
  return g.includes("scaduta") ? "guasto" : g.includes("vicina") ? "attenzione" : "ok";
}
function statoScadenze() {
  if (!SCAD.dati) return "grigia";
  return statoColonna([...SCAD.dati.registro, ...SCAD.dati.personali, ...SCAD.dati.task]);
}
function rigaScadenza(v, colonna) {
  const fonte = v.fonte || colonna;
  const g = giorniA(v), grav = gravitaScadenza(v);
  const data = v.entro ? v.entro.split("-").reverse().slice(0, 2).join("/") : "—";
  const quando = g == null ? "" : g < 0 ? t("scaduta da {n} g", { n: -g }) : g === 0 ? t("oggi") : g === 1 ? t("domani") : t("tra {n} g", { n: g });
  const soldi = typeof v.eur === "number" ? (v.eur ? `${v.eur.toLocaleString(LOCALE)} €` : "") : v.eur ? String(v.eur).slice(0, 90) : "";
  // la casella seleziona (per chiuderne tante insieme), il ✓ chiude subito questa
  const chiave = fonte + ":" + v.id;
  const casella = el("input", { type: "checkbox", "aria-label": t("Seleziona: {testo}", { testo: v.testo || "" }), title: t("Seleziona") });
  casella.checked = SCAD.sel.has(chiave);
  casella.addEventListener("change", () => { casella.checked ? SCAD.sel.add(chiave) : SCAD.sel.delete(chiave); contaSelezione(); });
  const fatto = el("button", { type: "button", class: "icona scad-fatto", title: t("Fatto: chiudi questa"), "aria-label": t("Chiudi: {testo}", { testo: v.testo || "" }) }, "✓");
  fatto.addEventListener("click", () => chiudiScadenza(v, fonte, fatto));
  return el("li", { class: "scad-riga " + grav + (SCAD.sel.has(chiave) ? " selezionata" : ""), title: v.id || "" },
    casella,
    el("time", { class: "scad-data" }, el("b", {}, data), el("small", {}, quando)),
    el("div", { class: "scad-testo" }, el("span", {}, v.testo || "—"),
      el("small", {}, [v.tipo === "DEC" ? t("decisione") : v.tipo === "DOM" ? t("domanda") : v.tipo, v.chi, soldi, v.nota].filter(Boolean).join(" · "))),
    fatto);
}
// le fonti arrivano come chiavi (registro, personali, task): si mostrano col loro nome
const NOME_FONTE = { registro: t("Registro di direzione"), personali: t("Personali"), task: t("Da ricordare") };
// i filtri della pulizia valgono per le tre colonne
function passaFiltri(v, fonte) {
  const g = giorniA(v);
  if ($("f-scadute").checked && !(v.scaduta || (g != null && g < 0))) return false;
  if ($("f-vecchie").checked && !(g != null && g < -30)) return false;
  if ($("f-tipo").value && v.tipo !== $("f-tipo").value) return false;
  if ($("f-fonte").value && fonte !== $("f-fonte").value) return false;
  return true;
}
function disegnaScadenze() {
  for (const [k, id] of COLONNE_SCAD) {
    const lista = $(id);
    if (SCAD.stato === "assente") { lista.replaceChildren(el("li", { class: "vuoto" }, t("arriva col server nuovo"))); continue; }
    if (!SCAD.dati) continue;
    if (k === "registro" && SCAD.registro === false) {
      lista.replaceChildren(el("li", { class: "vuoto" }, t("nessun registro di direzione: scrivi il percorso del tuo registro.json in configurazione.json, «registro_direzione»")));
      continue;
    }
    const tutte = SCAD.dati[k].filter((v) => !SCAD.chiuse.has((v.fonte || k) + ":" + v.id));
    const voci = tutte.filter((v) => passaFiltri(v, v.fonte || k));
    lista.replaceChildren(...(voci.length ? voci.map((v) => rigaScadenza(v, k))
      : [el("li", { class: "vuoto" }, tutte.length ? t("nessuna con questi filtri") : t("niente in scadenza"))]));
  }
  for (const f of document.querySelectorAll(".scad-aggiungi")) for (const x of f.elements) x.disabled = SCAD.stato === "assente";
  disegnaPulizia();
}

// ---- controllo e pulizia ----
function voceDi(chiave) {
  const [fonte, ...resto] = chiave.split(":"), id = resto.join(":");
  return ((SCAD.dati || {})[fonte] || []).find((v) => v.id === id) || null;
}
function contaSelezione() {
  // una voce selezionata che nel frattempo è stata chiusa non conta più
  for (const k of [...SCAD.sel]) if (!voceDi(k)) SCAD.sel.delete(k);
  $("scad-n-sel").textContent = SCAD.sel.size;
  $("scad-chiudi-sel").disabled = !SCAD.pulizia || !SCAD.sel.size;
  for (const r of document.querySelectorAll(".scad-riga")) {
    const c = r.querySelector("input[type=checkbox]");
    if (c) r.classList.toggle("selezionata", c.checked);
  }
}
function disegnaPulizia() {
  const nuovo = SCAD.pulizia;
  $("scad-nota-server").textContent = SCAD.stato === "assente" ? t("Le scadenze arrivano col server nuovo.")
    : nuovo ? "" : t("Controllo, chiusura in blocco e archivio arrivano col server nuovo.");
  $("scad-controllo").disabled = !nuovo || !!SCAD.controllo;
  $("scad-fonte").disabled = !nuovo;
  const d = SCAD.dati;
  if (d) {
    const tutte = [...d.registro, ...d.personali, ...d.task];
    const scadute = tutte.filter((v) => gravitaScadenza(v) === "scaduta").length;
    $("scad-riassunto").textContent = t("{n} aperte · {scadute} scadute", { n: tutte.length, scadute }) + (nuovo ? " · " + t("{n} chiuse in 30 giorni", { n: SCAD.archivio.length }) : "");
  }
  // proposte di Jarvis: solo quelle ancora aperte
  const prop = SCAD.proposte.filter((p) => voceDi(p.fonte + ":" + p.id));
  $("scad-proposte").classList.toggle("nascosto", (!prop.length && !SCAD.dubbi.length) || SCAD.vista !== "aperte");
  // «Da guardare tu»: le righe fuori dal blocco json, in grigio e senza casella
  let dubbi = $("scad-dubbi");
  if (!dubbi) { dubbi = el("div", { id: "scad-dubbi" }); $("scad-proposte").append(dubbi); }
  dubbi.replaceChildren(...(SCAD.dubbi.length ? [el("h3", {}, t("Da guardare tu")),
    ...SCAD.dubbi.map((x) => el("p", { class: "nota", style: "white-space:pre-wrap;margin:4px 0" }, x))] : []));
  $("scad-proposte-lista").replaceChildren(...prop.map((p) => {
    const chiave = p.fonte + ":" + p.id, v = voceDi(chiave);
    const c = el("input", { type: "checkbox", "aria-label": t("Seleziona: {testo}", { testo: v.testo }) });
    c.checked = SCAD.sel.has(chiave);
    c.addEventListener("change", () => { c.checked ? SCAD.sel.add(chiave) : SCAD.sel.delete(chiave); disegnaScadenze(); });
    return el("li", { class: "scad-riga proposta" }, c,
      el("time", { class: "scad-data" }, el("b", {}, v.entro ? v.entro.split("-").reverse().slice(0, 2).join("/") : "—"), el("small", {}, NOME_FONTE[p.fonte] || p.fonte)),
      el("div", { class: "scad-testo" }, el("span", {}, v.testo || "—"), el("small", { class: "scad-perche" }, t("perché: {motivo}", { motivo: p.perche || "—" }))));
  }));
  // archivio degli ultimi 30 giorni, con «riapri»
  $("scad-archivio").classList.toggle("nascosto", SCAD.vista !== "archivio");
  if (SCAD.vista === "archivio") {
    const arch = SCAD.archivio || [];
    $("scad-archivio-lista").replaceChildren(...(!nuovo ? [el("li", { class: "vuoto" }, t("arriva col server nuovo"))]
      : !arch.length ? [el("li", { class: "vuoto" }, t("nessuna chiusa negli ultimi 30 giorni"))]
      : arch.map((v) => el("li", { class: "scad-riga chiusa" },
        el("span", {}),
        el("time", { class: "scad-data" }, el("b", {}, v.entro ? v.entro.split("-").reverse().slice(0, 2).join("/") : "—"),
          el("small", {}, v.chiusa_ts ? t("chiusa il {data}", { data: new Date(v.chiusa_ts * 1000).toLocaleDateString(LOCALE, { day: "2-digit", month: "2-digit" }) }) : "")),
        el("div", { class: "scad-testo" }, el("span", {}, v.testo || "—"),
          el("small", {}, [NOME_FONTE[v.fonte] || v.fonte, v.chiusa_da, v.perche].filter(Boolean).join(" · "))),
        el("button", { type: "button", class: "piccolo", onclick: async (ev) => {
          const r = await azione({ tipo: "scadenze", cosa: "riapri", fonte: v.fonte, id: v.id }, ev.currentTarget);
          if (r) { firme.scadenze = undefined; caricaScadenze(); } } }, t("riapri"))))));
  }
  for (const b of document.querySelectorAll("[data-scad-vista]")) b.classList.toggle("attivo", b.dataset.scadVista === SCAD.vista);
  for (const id of ["box-scad-registro", "box-scad-personali", "box-scad-task"]) $(id).classList.toggle("nascosto", SCAD.vista !== "aperte");
  contaSelezione();
}
for (const id of ["f-scadute", "f-vecchie", "f-tipo", "f-fonte"]) $(id).addEventListener("change", disegnaScadenze);
for (const b of document.querySelectorAll("[data-scad-vista]")) b.addEventListener("click", () => { SCAD.vista = b.dataset.scadVista; disegnaScadenze(); });
$("scad-sel-visibili").addEventListener("click", () => {
  for (const [k] of COLONNE_SCAD) for (const v of (SCAD.dati || {})[k] || []) if (passaFiltri(v, v.fonte || k)) SCAD.sel.add((v.fonte || k) + ":" + v.id);
  disegnaScadenze();
});
$("scad-sel-nessuna").addEventListener("click", () => { SCAD.sel.clear(); disegnaScadenze(); });
$("scad-chiudi-sel").addEventListener("click", async (ev) => {
  const voci = [...SCAD.sel].map((k) => { const [fonte, ...r] = k.split(":"); return { fonte, id: r.join(":") }; });
  if (!voci.length) return;
  const daJarvis = SCAD.proposte.filter((p) => SCAD.sel.has(p.fonte + ":" + p.id));
  const perche = (daJarvis.length ? t("già fatta secondo Jarvis: {motivi}", { motivi: daJarvis.map((p) => p.perche).filter(Boolean).join("; ") }) : t("chiusa da {utente} nella pulizia", { utente: UTENTE })).slice(0, 200);
  if (!confirm(t("Chiudere {n} scadenze?\n\n{perche}\n\nLe ritrovi nell'Archivio e si possono riaprire.", { n: voci.length, perche }))) return;
  const d = await azione({ tipo: "scadenze", cosa: "chiudi_molte", voci, perche }, ev.currentTarget);
  if (d) {
    toast(t("Chiuse {n}", { n: d.chiuse ?? voci.length }) + (d.errori && d.errori.length ? " · " + t("{n} non chiuse", { n: d.errori.length }) : ""), !!(d.errori && d.errori.length));
    SCAD.sel.clear();
    SCAD.proposte = SCAD.proposte.filter((p) => !voci.some((x) => x.fonte === p.fonte && x.id === p.id));
    firme.scadenze = undefined; caricaScadenze();
  }
});
// «quali sono già fatte?»: un lavoro di Jarvis; si segue finché non chiude, poi si legge il blocco json
$("scad-controllo").addEventListener("click", async (ev) => {
  const d = await azione({ tipo: "scadenze", cosa: "controllo", fonte: $("scad-fonte").value }, ev.currentTarget);
  // su «registro» o «tutte» il server spezza il registro in più lavori (tetto di 12000 caratteri l'uno):
  // «lavori» li porta tutti, «lavoro» è il primo
  const ids = (d && (d.lavori || (d.lavoro ? [d.lavoro] : [])) || []).map((l) => l && l.id).filter(Boolean);
  if (ids.length) { SCAD.controllo = { ids, da: Date.now() }; mem_scrivi("scadControllo", SCAD.controllo); seguiControllo(); }
});
async function seguiControllo() {
  const c = SCAD.controllo;
  if (c && c.id && !c.ids) c.ids = [c.id];                     // un controllo salvato dalla versione di prima
  if (!c || !(c.ids || []).length) { SCAD.controllo = null; $("scad-controllo-stato").textContent = ""; disegnaPulizia(); return; }
  $("scad-controllo").disabled = true;
  let risposte;
  try { risposte = await Promise.all(c.ids.map((id) => api("/api/lavoro/" + id))); }
  catch (e) { SCAD.controllo = null; mem_scrivi("scadControllo", null); $("scad-controllo-stato").textContent = t("controllo perso: {errore}", { errore: e.message }); disegnaPulizia(); return; }
  const finiti = risposte.filter((d) => d.stato !== "in corso").length;
  if (finiti < risposte.length) {
    const quanti = risposte.length > 1 ? " · " + t("{finiti} di {n} finiti", { finiti, n: risposte.length }) : "";
    $("scad-controllo-stato").replaceChildren(el("span", { class: "scad-attesa" }), " " + t("Jarvis sta controllando · {s} s", { s: Math.round((Date.now() - c.da) / 1000) }) + quanti);
    setTimeout(seguiControllo, 3000);
    return;
  }
  SCAD.controllo = null; mem_scrivi("scadControllo", null);
  // si uniscono i blocchi ```json``` di tutte le risposte; una risposta illeggibile o in errore si dice
  const proposte = [], problemi = [], dubbi = [];
  risposte.forEach((d, i) => {
    const m = String(d.testo || "").match(/```json\s*([\s\S]*?)```/);
    // quello che sta fuori dal blocco json sono le voci su cui Jarvis non è sicuro: si mostrano com'è
    if (d.stato === "finito") String(d.testo || "").replace(/```json[\s\S]*?```/g, "").replace(/^\(cartella: [^\n]*\)/, "")
      .split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean).forEach((x) => dubbi.push(x));
    let lista = null;
    try { lista = m ? JSON.parse(m[1]) : null; } catch (e) { lista = null; }
    if (d.stato !== "finito") problemi.push(t("parte {n} in errore", { n: i + 1 }));
    else if (!Array.isArray(lista)) problemi.push(t("parte {n} senza un elenco leggibile", { n: i + 1 }));
    else proposte.push(...lista);
  });
  const viste = new Set();
  SCAD.proposte = proposte.filter((p) => p && p.fonte && p.id && !viste.has(p.fonte + ":" + p.id) && viste.add(p.fonte + ":" + p.id));
  SCAD.dubbi = dubbi;
  for (const p of SCAD.proposte) SCAD.sel.add(p.fonte + ":" + p.id);          // arrivano già spuntate
  $("scad-controllo-stato").textContent = (SCAD.proposte.length ? t("Jarvis propone di chiuderne {n}", { n: SCAD.proposte.length }) : t("Jarvis non ne ha trovate di già fatte")) +
    (problemi.length ? " · " + t("{problemi}: guarda i lavori in Squadra", { problemi: problemi.join(", ") }) : "");
  $("scad-proposte-quando").textContent = oraBreve();
  disegnaScadenze();
}
if (SCAD.controllo) seguiControllo();          // un controllo partito prima di ricaricare la pagina
// chiudere è ottimista: la riga sparisce subito, poi si rilegge; per 10 s si può annullare
async function chiudiScadenza(v, fonte, casella) {
  const chiave = fonte + ":" + v.id;
  SCAD.chiuse.add(chiave);
  disegnaScadenze();
  const d = await azione({ tipo: "scadenze", cosa: "chiudi", fonte, id: v.id }, casella);
  if (!d) { SCAD.chiuse.delete(chiave); disegnaScadenze(); return; }
  SCAD.annulla = { fonte, id: v.id, chiave };
  $("scad-annulla-testo").textContent = t("Chiusa «{testo}»", { testo: String(v.testo || "").slice(0, 60) });
  $("scad-annulla").classList.remove("nascosto");
  clearTimeout(SCAD.timerAnnulla);
  SCAD.timerAnnulla = setTimeout(() => { $("scad-annulla").classList.add("nascosto"); SCAD.annulla = null; }, 10000);
  firme.scadenze = undefined;
  await caricaScadenze();
  SCAD.chiuse.delete(chiave);          // il server ora non la manda più
}
$("scad-annulla-btn").addEventListener("click", async (ev) => {
  const a = SCAD.annulla;
  if (!a) return;
  const d = await azione({ tipo: "scadenze", cosa: "riapri", fonte: a.fonte, id: a.id }, ev.currentTarget);
  if (d) { SCAD.annulla = null; clearTimeout(SCAD.timerAnnulla); $("scad-annulla").classList.add("nascosto"); SCAD.chiuse.delete(a.chiave); firme.scadenze = undefined; caricaScadenze(); }
});
for (const f of document.querySelectorAll(".scad-aggiungi")) {
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const testo = f.elements.testo.value.trim();
    if (!testo) return;
    const corpo = { tipo: "scadenze", cosa: "aggiungi", fonte: f.dataset.fonte, testo };
    if (f.elements.entro && f.elements.entro.value) corpo.entro = f.elements.entro.value;   // «Da ricordare» non ha la data
    const d = await azione(corpo, ev.submitter);
    if (d) { f.reset(); firme.scadenze = undefined; caricaScadenze(); }
  });
}

// ---------------------------------------------------------------- telefono
function disegnaTelefono(t) {
  if (!t || !("centralino" in t)) return;
  const reg = (t.registrazione || "").toLowerCase();
  $("tel-stato").textContent = !t.centralino ? window.t("centralino spento")
    : reg === "registered" ? window.t("linea di casa agganciata")
    : window.t("centralino acceso, linea {stato}", { stato: t.registrazione || window.t("da verificare") });
  const valori = { centralino: t.centralino, ponte_locale: t.ponte_locale,
                   ponte_gemini: t.ponte_gemini, risposta: t.risposta_armata };
  for (const riga of document.querySelectorAll("[data-tel]")) {
    riga.querySelector(".switch").classList.toggle("on", !!valori[riga.dataset.tel]);
  }
  const lista = $("tel-chiamate");
  lista.replaceChildren();
  if (!t.chiamate || !t.chiamate.length) {
    lista.append(el("li", { class: "vuoto-lavori" }, el("small", {},
      window.t("Nessuna chiamata registrata. Una chiamata parte dal modulo qui sopra, o quando qualcuno chiama la linea di casa e Jarvis risponde."))));
    return;
  }
  for (const c of t.chiamate) {
    const quando = (c.quando || "").replace("T", " ").slice(0, 16);
    const li = el("li", {},
      el("span", {}, `${c.chi || c.numero || window.t("sconosciuto")} · ${quando}`),
      el("span", { class: "etichetta " + (c.tipo === "uscita" ? "finito" : "in-avvio") }, NOME_TIPO_CHIAMATA[c.tipo] || c.tipo || window.t("chiamata")),
      el("small", { class: "chiamata-esito" }, (c.esito || "").slice(0, 140) + (c.durata ? ` · ${c.durata}s` : "")));
    for (const d of c.domande || []) li.append(el("small", { class: "chiamata-domande" }, window.t("chiede: {domanda}", { domanda: d })));
    lista.append(li);
  }
}

const NOME_TIPO_CHIAMATA = { uscita: t("uscita"), entrata: t("entrata") };

function telefonoAzione(cosa, acceso, bottone) {
  const mappa = { centralino: acceso ? "centralino_avvia" : "centralino_ferma" };
  return azione({ tipo: "telefono", cosa: mappa[cosa] || cosa, acceso }, bottone);
}

document.addEventListener("click", (ev) => {
  const riga = ev.target.closest("[data-tel]");
  if (riga && ev.target.classList.contains("switch")) {
    telefonoAzione(riga.dataset.tel, !ev.target.classList.contains("on"), ev.target);
  }
});

// Tempi relativi che avanzano da soli: un nodo con data-da-ts si riscrive ogni secondo
// (lo fa orologio()), così «x s fa» resta vero anche fra un giro e l'altro.
function testoDurata(ts) {
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (s < 60) return s + " s";
  if (s < 3600) return Math.floor(s / 60) + " min";
  if (s < 86400) return Math.floor(s / 3600) + " h " + String(Math.floor(s % 3600 / 60)).padStart(2, "0") + " min";
  return t("{n} g", { n: Math.floor(s / 86400) });
}
const DOPO_FA = " " + t("fa");
function etaNodo(ts, prima = "", dopo = DOPO_FA) {
  return el("span", { "data-da-ts": ts, "data-prima": prima, "data-dopo": dopo }, prima + testoDurata(ts) + dopo);
}
function aggiornaEta() {
  for (const n of document.querySelectorAll("[data-da-ts]"))
    n.textContent = (n.dataset.prima || "") + testoDurata(Number(n.dataset.daTs)) + (n.dataset.dopo ?? DOPO_FA);
}

// ---------------------------------------------------------------- salute del pannello
// Contratto, punto 2: i raccoglitori del server, ogni quanto girano, l'ultimo giro andato
// bene, l'errore. ↻ su una riga rilancia solo quel raccoglitore (data-aggiorna).
// per nome del giro sul server, senza «raccogli_» (alcuni giri non hanno chiave: niente ↻ per loro)
const NOMI_RACCOGLITORI = { locale: t("Computer e interruttori"), locale_pesante: t("Computer, letture lente"), vps: t("Server"),
  memoria: t("Memoria e battito"), catena: t("Catena e scadenze"), claude: "Claude Code", telefono: t("Telefono"),
  telegram: "Telegram", agenti: t("Agenti e sessioni"), portiere: t("Portiere"), sentinella: t("Sentinella"),
  archivia_missioni_vecchie: t("Archivio delle missioni"),
  guardia_mac: t("Guardia di Telegram"), sorveglia_file: t("Sorveglianza dei file"),
  comunicazioni: t("Comunicazioni (sinapsi)"), rete_controlla: t("Accesso dal telefono") };
function disegnaSalute(x) {
  const lista = $("salute-lista");
  if (!x || !Array.isArray(x.raccoglitori)) {
    $("salute-server").textContent = "";
    lista.replaceChildren(el("li", { class: "vuoto" }, t("Il server non manda ancora la salute dei raccoglitori: arriva col server nuovo.")));
    return;
  }
  $("salute-server").replaceChildren(x.server_da_ts ? etaNodo(x.server_da_ts, t("server acceso da") + " ", "") : "", x.pid ? ` · pid ${x.pid}` : "");
  if (!x.raccoglitori.length) { lista.replaceChildren(el("li", { class: "vuoto" }, t("nessun raccoglitore"))); return; }
  const ora = Date.now() / 1000;
  lista.replaceChildren(...x.raccoglitori.map((r) => {
    const giro = String(r.nome || r.chiave || "?").replace(/^raccogli_/, "");
    const nome = NOMI_RACCOGLITORI[giro] || NOMI_RACCOGLITORI[r.chiave] || giro;
    const tardi = r.ultimo_ok_ts && r.ogni && ora - r.ultimo_ok_ts > 3 * r.ogni;
    const stato = r.errore ? "guasto" : !r.ultimo_ok_ts || tardi ? "attenzione" : "ok";
    return el("li", { class: "sal " + stato, title: r.nome || "" },
      el("i", { class: "spia " + stato }),
      el("div", { class: "sal-testo" },
        el("b", {}, nome),
        el("small", {}, r.ogni ? t("ogni {n} s", { n: r.ogni }) + " · " : "", r.ultimo_ok_ts ? etaNodo(r.ultimo_ok_ts, t("ultimo ok") + " ") : t("mai andato bene")),
        r.errore ? el("small", { class: "sal-errore" }, r.errore) : ""),
      r.chiave ? el("button", { class: "icona", type: "button", "data-aggiorna": r.chiave, title: t("Rilancia adesso: {nome}", { nome }) }, "↻") : "");
  }));
}

// ---------------------------------------------------------------- sentinella
// Richiesta di Boss del 26/09/2026: il giro di controllo del server (s.sentinella), le
// anomalie aperte e l'ultimo rapporto di Haiku. Senza il campo: «sentinella non attiva».
function classeAnomalia(tipo) {
  return /gi[uù]|error|guast|fermo|morto|down|rott|fall/i.test(String(tipo || "")) ? "guasto" : "attenzione";
}
function disegnaSentinella(x) {
  const sw = $("sent-interruttore").querySelector(".switch");
  const lista = $("sent-anomalie");
  if (!x) {
    sw.classList.remove("on"); sw.disabled = true; $("sent-giro").disabled = true;
    $("sent-quando").textContent = "";
    lista.replaceChildren(el("li", { class: "vuoto" }, t("sentinella non attiva")));
    $("sent-rapporto-box").classList.add("nascosto");
    return;
  }
  sw.disabled = false; $("sent-giro").disabled = false;
  sw.classList.toggle("on", !!x.acceso);
  $("sent-quando").replaceChildren(x.quando_ts ? etaNodo(x.quando_ts, t("ultimo giro") + " ") : t("nessun giro ancora"),
    x.nuove ? " · " + t("{n} nuove", { n: x.nuove }) : "", x.acceso ? "" : " · " + t("spenta"));
  const an = x.anomalie || [];
  lista.replaceChildren(...(an.length ? an.map((a) => el("li", { class: "n-" + classeAnomalia(a.tipo), title: a.chiave || "" },
    el("b", { class: "cn-tipo" }, String(a.tipo || "—").toUpperCase()),
    el("span", {}, a.testo || a.chiave || ""),
    a.da_ts ? el("small", {}, etaNodo(a.da_ts, t("da") + " ", "")) : "")) : [el("li", { class: "vuoto" }, t("nessuna anomalia"))]));
  const box = $("sent-rapporto-box");
  box.classList.toggle("nascosto", !x.ultimo_rapporto);
  if (x.ultimo_rapporto) {
    $("sent-rapporto").replaceChildren(markdown(x.ultimo_rapporto));
    $("sent-rapporto-quando").replaceChildren(x.ultimo_rapporto_ts ? etaNodo(x.ultimo_rapporto_ts) : "");
  }
}
$("sent-interruttore").querySelector(".switch").addEventListener("click", (ev) =>
  azione({ tipo: "sentinella", cosa: "acceso", valore: !ev.currentTarget.classList.contains("on") }, ev.currentTarget));
$("sent-giro").addEventListener("click", (ev) => azione({ tipo: "sentinella", cosa: "giro" }, ev.currentTarget));

function durata(ts) {
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

// La catena degli agenti (scheda «Schema agenti Jarvis»): Jarvis → i suoi agenti →
// un CEO per progetto → i suoi specialisti. Si accende chi sta lavorando adesso.
function disegnaClaude(c) {
  const p = $("mot-claude");
  if (!c) { p.className = "pallino grigio"; p.title = t("lettura in corso"); return; }
  p.className = "pallino " + (c.collegato ? "verde" : "rosso");
  p.title = c.collegato ? t("Claude Code collegato ({metodo})", { metodo: c.metodo }) : t("Claude Code non collegato: {motivo}", { motivo: c.errore || t("fai claude auth login") });
}

function disegnaClaudeOra(c, catena, missioni) {
  const p = $("claude-pallino"), t = $("claude-stato"), a = $("claude-azione"), r = $("claude-richiesta");
  const lista = $("claude-catena");
  if (!c) { p.className = "pallino grigio"; t.textContent = window.t("nessun segnale"); a.textContent = ""; r.textContent = ""; }
  else {
    p.className = "pallino " + (c.lavorando ? "verde" : "grigio");
    t.textContent = c.lavorando ? window.t("al lavoro") + (c.richiesta_ts ? " · " + durata(c.richiesta_ts) : "") : window.t("fermo");
    r.textContent = c.richiesta ? window.t("Richiesta: {testo}", { testo: c.richiesta }) : "";
    a.textContent = c.lavorando && c.azione ? window.t("Sta facendo: {azione}", { azione: c.azione }) + (c.dettaglio ? " · " + c.dettaglio : "") : "";
  }
  const attivi = {};
  for (const ag of (c && c.agenti) || []) {
    if (ag.stato === "attivo" && !attivi[ag.nodo || ag.tipo]) attivi[ag.nodo || ag.tipo] = ag;
  }
  // il CEO che guida una missione del Command Center lavora anche se la chat è ferma
  for (const m of missioni || []) {
    const chi = m.chi === "orchestratore" ? window.t("orchestratore") + ` · ${m.spazio || m.progetto}` : m.chi;
    if (chi && chi !== "Jarvis" && !attivi[chi]) attivi[chi] = { ts: m.ts, descrizione: window.t("missione, {stato}", { stato: NOME_STATO_M[m.stato] || m.stato }) + ((m.esperti || []).length ? " · " + window.t("{n} esperti al lavoro", { n: m.esperti.length }) : "") };
  }
  const usati = new Set();
  // una lettura della catena fallita prima della prima riuscita porta solo {errore, letto_ts}
  const cat = Object.assign({ jarvis: [], progetti: [], modelli: {} }, catena || {});
  const nodo = (liv, nome, nota, chiave, acceso) => {
    const ag = (chiave && attivi[chiave]) || (acceso ? { ts: 0 } : null);
    if (ag) usati.add(chiave);
    const testo = ag && ag.ts ? window.t("attivo {durata}", { durata: durata(ag.ts) }) + (ag.descrizione ? " · " + ag.descrizione : "") : nota;
    const mod = chiave && cat.modelli && cat.modelli[chiave];
    // avatar da 48 px (26/09/2026): Jarvis con la sua J, gli altri col volto «beam» del loro ruolo
    const av = liv === 0 ? el("span", { class: "avatar avatar-j", "aria-hidden": "true" }, "J")
      : avatar({ key: "catena:" + nome, nome, spazio: "" });
    av.classList.toggle("al-lavoro", !!ag);
    return el("li", { class: ag ? "attivo" : "", style: `--liv:${liv}` }, av,
      el("div", { class: "cat-testo" },
        el("span", { class: "cat-riga" }, el("span", { class: "nome" }, nome), mod ? el("span", { class: "modello " + mod }, mod) : ""),
        el("small", {}, testo || "")));
  };
  const righe = [nodo(0, "Jarvis", window.t("sessione principale"), null, c && c.lavorando)];
  for (const n of cat.jarvis) righe.push(nodo(1, n, window.t("fermo"), n));
  // i progetti con capogruppo ed esperti stanno sotto, in «Agenti per spazio» (da spazi.json)
  for (const [k, ag] of Object.entries(attivi)) {          // agenti fuori catena
    if (!usati.has(k)) righe.push(nodo(1, k || window.t("agente"), "", k));
  }
  lista.replaceChildren(...righe);
  contaCatena.agenti = Object.keys(attivi).length;
  disegnaContaCatena();
}



function disegnaSessioni(a) {
  const lista = $("sessioni-lista");
  if (!lista) return;
  const s = (a && a.sessioni) || [];
  const q = $("sessioni-quando");
  if (q) q.textContent = (a && a.aggiornato) ? t("aggiornato {ora}", { ora: new Date(a.aggiornato * 1000).toTimeString().slice(0, 8) }) : "";
  lista.replaceChildren();
  if (!s.length) {
    lista.append(el("li", {}, el("small", {}, t("Nessuna sessione di Claude aperta adesso."))));
    return;
  }
  for (const r of s) {
    const stato = r.lavora ? t("LAVORA") : t("FERMA");
    const riga = [
      el("span", {}, "pid " + r.pid + " · " + (r.dove || r.cosa || "—")),
      el("br"),
    ];
    if (r.nome) riga.push(el("small", { style: "font-weight:bold" }, r.nome), el("br"));
    riga.push(el("small", {}, t("acceso da {tempo} · processore {cpu}s", { tempo: r.acceso, cpu: r.cpu })));
    lista.append(el("li", { style: "cursor:default" },
      el("span", {}, ...riga),
      el("span", { class: "etichetta " + (r.lavora ? "in-corso" : "chiusa") }, stato)));
  }
  if (a && a.orfani) lista.append(el("li", {}, el("small", {}, t("{n} recapiti orfani (processi morti)", { n: a.orfani }))));
}

function disegnaAgentiAttivi(attivi) {
  const lista = $("agenti-attivi");
  lista.replaceChildren();
  if (!attivi || !attivi.length) {
    lista.append(el("li", { class: "gruppo" }, t("nessun agente al lavoro")));
    return;
  }
  for (const a of attivi) {
    lista.append(el("li", { class: "gruppo" }, `${a.chi} · ${a.spazio ? a.spazio + " · " : ""}${a.progetto} · ${NOME_STATO_M[a.stato] || a.stato}`));
    for (const e of a.esperti || []) lista.append(el("li", {}, `${e.nome} · ${minuti(e.inizio)} · ${e.ultima || e.descrizione || ""}`));
    if (a.ultimo && !(a.esperti || []).length) lista.append(el("li", {}, a.ultimo));
  }
}

function disegnaCollegamenti(collegamenti) {
  const nomi = { guida_telefono: t("Guida telefonate"), n8n: "n8n" };
  $("collegamenti").replaceChildren(...(collegamenti || []).map((c) =>
    el("button", { "data-apri": c.id }, nomi[c.id] || c.nome)));
}

function disegnaComandi(comandi) {
  $("comandi").replaceChildren(...(comandi || []).map((c) =>
    el("button", { onclick: (ev) => azione({ tipo: "comando", id: c.id }, ev.currentTarget) },
      c.nome, el("small", {}, c.descrizione))));
}

function disegnaComandClaudeCode(comandi) {
  $("comandi-claude").replaceChildren(...(comandi || []).map((c) =>
    el("button", { onclick: (ev) => azione({ tipo: "comando_claude_code", id: c.id }, ev.currentTarget),
                   title: c.descrizione },
      c.nome, el("small", {}, c.descrizione))));
}

document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-apri]");
  if (b) azione({ tipo: "apri", id: b.dataset.apri }, b);
  const d = ev.target.closest("[data-azione-diretta]");
  if (d) azione({ tipo: d.dataset.azioneDiretta }, d);
});

$("form-chiamata")?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const numero = $("tel-numero").value.trim();
  const chi = $("tel-chi").value.trim();
  const incarico = $("tel-incarico").value.trim();
  if (!confirm(t("Chiamo {numero}?\n\nIncarico: {incarico}", { numero: numero + (chi ? " (" + chi + ")" : ""), incarico }))) return;
  const d = await azione({ tipo: "telefono", cosa: "chiama", numero, chi, incarico, conferma: true }, ev.submitter);
  if (d && d.lavoro) { $("tel-numero").value = ""; $("tel-chi").value = ""; $("tel-incarico").value = ""; }
});

// ---- il banco tecnico dell'app Android ----
// Si legge solo quando si apre la sezione: interrogare il telefono con adb costa
// qualche secondo, e chi guarda il resto del pannello non lo deve pagare.

function disegnaTecnico(d) {
  const t = d.telefono || {};
  const schede = $("tec-schede");
  schede.replaceChildren();
  if (!t.collegato) {
    $("tec-stato").textContent = window.t("Telefono non collegato");
    schede.append(el("dt", {}, window.t("Perché")), el("dd", {}, t.perche || "—"));
    document.querySelector('[data-tec="debug"] .switch').classList.remove("on");
    return;
  }
  $("tec-stato").textContent = `${t.modello || window.t("telefono")} · app ${t.versione || "?"} (build ${t.codice || "?"})`;
  const voci = [
    ["Android", t.android || "?"],
    [window.t("Servizio Jarvis"), t.servizio ? window.t("acceso") : window.t("spento")],
    [window.t("Può usare il telefono"), t.accessibilita ? window.t("sì") : window.t("no")],
    [window.t("Batteria"), t.batteria == null ? "?" : t.batteria + "%"],
  ];
  for (const [k, v] of voci) schede.append(el("dt", {}, k), el("dd", {}, v));
  document.querySelector('[data-tec="debug"] .switch').classList.toggle("on", !!t.debug);
  $("tec-log").textContent = (d.log || []).join("\n") || window.t("Nessuna diagnosi. Col modo tecnico spento è normale: l'app non manda niente fuori.");
}

let tecnicoInCorso = false;
async function caricaTecnico() {
  if (tecnicoInCorso) return;
  tecnicoInCorso = true;
  $("tec-stato").textContent = t("lettura del telefono…");
  try {
    const d = await api("/api/tecnico", null, 30000);
    ULTIMO.tecnico = Object.assign({}, d, { log: (d.log || []).slice(-40) });
    disegnaTecnico(d);
    aggiornaSpie();
  } catch (e) {
    $("tec-stato").textContent = t("Non riesco a leggere il telefono: {errore}", { errore: e.message });
  } finally {
    tecnicoInCorso = false;
  }
}

document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-tec]");
  if (!b) return;
  if (b.dataset.tec === "debug" && ev.target.classList.contains("switch")) {
    await azione({ tipo: "tecnico", cosa: "debug", acceso: !ev.target.classList.contains("on") }, ev.target);
    caricaTecnico();
  } else if (b.dataset.tec === "riavvia") {
    await azione({ tipo: "tecnico", cosa: "riavvia" }, b);
    caricaTecnico();
  } else if (b.dataset.tec === "ricarica") {
    caricaTecnico();
  }
});

// ---- La conversazione a voce, dentro «Chat con Jarvis» (sola lettura) ----
// L'ultimo messaggio sta in cima: così si vede lo stato senza scorrere in fondo ogni volta.
let chatVoceUltima = "";
let chatVoceInCorso = false;
// «sto scrivendo» nella chat a voce: mentre la voce dice che Jarvis pensa, oppure dopo un
// messaggio mandato da qui finché non arriva una battuta nuova di Jarvis (tetto 2 minuti).
let vocePensa = false;
let voceAspetta = null;          // { da: ms, n: battute viste quando hai mandato }
let chatVoceConta = 0;
function disegnaAttesaVoce() {
  const box = $("chat-voce-attesa");
  if (!box) return;
  if (voceAspetta && Date.now() - voceAspetta.da > 120000) voceAspetta = null;
  const si = vocePensa || !!voceAspetta;
  if (si && !box.firstChild) box.append(el("small", {}, "Jarvis"), bollaScrive("Jarvis"));
  box.classList.toggle("nascosto", !si);
}
async function aggiornaChatVoce() {
  const box = $("chat-messages");
  // niente lettura se il riquadro non si vede o la chiamata di prima non è tornata
  if (!box || chatVoceInCorso || (box.offsetParent === null && chatVoceUltima)) return;
  chatVoceInCorso = true;
  let d;
  try { d = await api("/api/chat/storia"); } catch (e) { return; } finally { chatVoceInCorso = false; }
  const battute = (d && d.battute) || [];
  chatVoceConta = battute.length;
  if (voceAspetta && battute.length > voceAspetta.n && battute[battute.length - 1].chi !== "boss") voceAspetta = null;
  disegnaAttesaVoce();
  const firma = battute.length + "|" + (battute.length ? battute[battute.length - 1].ts + battute[battute.length - 1].testo : "");
  if (firma === chatVoceUltima) return;
  chatVoceUltima = firma;
  const inAlto = box.scrollTop < 40;
  box.replaceChildren();
  if (!battute.length) {
    box.append(el("div", { style: "color:var(--tenue);font-size:13px" }, t("La conversazione a voce compare qui appena parli con Jarvis (dopo l'avvio della voce con Talk to Jarvis).")));
    return;
  }
  // battute di Jarvis vicine (entro 25 secondi) stanno nello stesso fumetto
  const gruppi = [];
  let corrente = null, ultimoTs = 0;
  for (const b of battute) {
    const t = Date.parse(b.ts) || 0;
    if (corrente && corrente.chi === b.chi && t - ultimoTs < 25000) {
      corrente.testo += " " + b.testo;
    } else {
      corrente = { chi: b.chi, ts: b.ts, testo: b.testo };
      gruppi.push(corrente);
    }
    ultimoTs = t;
  }
  // solo gli ultimi 5 scambi, più recente per primo
  for (const g of gruppi.slice(-5).reverse()) {
    const tuo = g.chi === "boss";
    const nodo = el("div", { class: "chat-voce", style: "margin:6px 0;display:flex;flex-direction:column;align-items:" + (tuo ? "flex-end" : "flex-start") });
    nodo.append(
      el("small", { style: "color:var(--tenue);font-size:11px" }, (tuo ? UTENTE : "Jarvis") + " · " + (g.ts || "").slice(11, 16)),
      el("div", { style: "max-width:80%;padding:8px 12px;border-radius:12px;white-space:pre-wrap;" +
        (tuo ? "background:var(--rialzo-2);border:1px solid var(--linea-2)" : "background:var(--rialzo);border:1px solid var(--linea)") }, g.testo));
    box.append(nodo);
  }
  if (inAlto) box.scrollTop = 0;
}
aggiornaChatVoce();

// ---- Scrivere nella stessa chat della voce (arriva a Jarvis come se l'avesse sentito) ----
$("form-chat-voce")?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const campo = $("chat-voce-testo");
  const testo = campo.value.trim();
  if (!testo) return;
  const d = await azione({ tipo: "chat_voce_manda", testo }, ev.submitter);
  if (d) { campo.value = ""; voceAspetta = { da: Date.now(), n: chatVoceConta }; disegnaAttesaVoce(); aggiornaChatVoce(); }
});

// =====================================================================
// Layout a tre colonne
//   sinistra: agenti per spazio, gruppi a tendina, trascinabili
//   centro:   chat con Jarvis o con un agente (Claude Code, nel modo scelto)
//   destra:   lavagna (dipendenze), anche a pagina intera
// Lo stato della disposizione sta sul server in pannello.json (/api/pannello);
// la conversazione di ogni interlocutore sta nel browser (localStorage).
// =====================================================================

const mem = {
  leggi(k, d) { try { const v = localStorage.getItem("cc." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  scrivi(k, v) {
    try { localStorage.setItem("cc." + k, JSON.stringify(v)); return true; }
    catch (e) {
      if (!mem.avvisato) { mem.avvisato = true; console.warn(`Command Center: non riesco a salvare «${k}» nel browser (${e.name}): spazio pieno o bloccato`); }
      return false;
    }
  },
};
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g,
  (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

// ------------------------------------------------ pannello.json
// Una lavagna per gruppo (PAN.lavagne[id]), non più una sola: cliccare un
// gruppo apre solo la sua, senza mischiare tutti gli agenti insieme. "generale"
// è quella di chi arriva dal menu senza passare da un gruppo, e quella di
// «Tutta la catena». lav() è quella che si vede adesso (lavagnaAttiva).
const LAVAGNA_VUOTA = () => ({ nodi: [], fili: [], vista: { x: 0, y: 0, zoom: 1 } });
let PAN = { gruppi: [], aspetto: {}, lavagne: { generale: LAVAGNA_VUOTA() } };
let panPronto = false;
let salvaTimer = null;
let lavagnaAttiva = "generale";
let lavagnaTitolo = "";
function lav() {
  if (!PAN.lavagne) PAN.lavagne = {};
  if (!PAN.lavagne[lavagnaAttiva]) PAN.lavagne[lavagnaAttiva] = LAVAGNA_VUOTA();
  return PAN.lavagne[lavagnaAttiva];
}
function vaiALavagna(id, titolo) {
  if (id !== lavagnaAttiva) { LAV.sel = null; LAV.selFilo = null; }   // una scelta vale solo nella sua lavagna (27/09/2026)
  lavagnaAttiva = id;
  lavagnaTitolo = id === "generale" ? "" : (titolo || id);
  mem.scrivi("lavagnaAttiva", id);
  mem.scrivi("lavagnaTitolo:" + id, lavagnaTitolo);
  const t = $("lav-titolo");
  if (t) t.textContent = lavagnaTitolo;
  aggiornaAllineamento();
}
async function caricaPannello() {
  try {
    const d = await api("/api/pannello");
    let lavagne = d.lavagne;
    if (!lavagne) lavagne = { generale: Object.assign(LAVAGNA_VUOTA(), d.lavagna || {}) };   // dati vecchi: una sola lavagna, diventa "generale"
    PAN = { gruppi: d.gruppi || [], aspetto: d.aspetto || {}, lavagne };
    PAN_VER = Number.isInteger(d.versione) ? d.versione : null;
    PAN_SALVATO = JSON.parse(JSON.stringify(PAN));
  } catch (e) { toast(t("Non leggo la disposizione salvata: {errore}", { errore: e.message }), true); }
  lavagnaAttiva = mem.leggi("lavagnaAttiva", "generale");
  lavagnaTitolo = mem.leggi("lavagnaTitolo:" + lavagnaAttiva, "");
  panPronto = true;
  LAV.sel = null; LAV.selFilo = null;   // i fili ricaricati hanno altri indici: nessuna scelta vecchia
  pulisciSchedeOrfane();    // se il catalogo degli agenti è arrivato prima della disposizione
  disegnaGruppi();
  disegnaLavagna();
  aggiornaTestaChat();      // emoji e colore salvati valgono anche nella testa della chat
  disegnaMessaggi();
  aggiornaAllineamento();
}
// Modo dimostrazione (26/09/2026, per il video di Boss): la lavagna non scrive niente fuori dalla
// pagina. pannello.json si riscrive in blocco, quindi in dimostrazione parte una copia in cui tutto
// è come l'ultima volta letto o salvato dal server (PAN_SALVATO) e cambiano solo le lavagne «demo-».
let PAN_SALVATO = null;
let lavDemo = !!mem.leggi("lavDemo", false);
const eDemo = (id) => String(id || "").startsWith("demo-");
let PAN_VER = null;
function salvaPannello() {
  if (!panPronto) return;
  if (lavDemo && !eDemo(lavagnaAttiva)) { $("lav-stato").textContent = t("dimostrazione: non salvata"); return; }
  if (lavDemo && !PAN_SALVATO) { $("lav-stato").textContent = t("non salvata"); return; }
  $("lav-stato").textContent = t("salvo…");
  clearTimeout(salvaTimer);
  salvaTimer = setTimeout(async () => {
    const demo = lavDemo;
    const corpo = !demo ? PAN : Object.assign({}, PAN_SALVATO, { lavagne: Object.assign({}, PAN_SALVATO.lavagne,
      Object.fromEntries(Object.entries(PAN.lavagne || {}).filter(([k]) => eDemo(k)))) });
    try {
      // versione (27/09/2026): se un'altra scheda o il server hanno salvato nel frattempo, il server
      // risponde 409 e si ricarica il pannello attuale invece di cancellare il loro lavoro
      const r = await fetch("/api/pannello", { method: "POST", headers: HDR,
        body: JSON.stringify(PAN_VER == null ? corpo : Object.assign({}, corpo, { versione: PAN_VER })) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409) {
        $("lav-stato").textContent = t("ricaricata");
        toast(t("La lavagna era cambiata da un'altra parte: l'ho ricaricata. Rifai l'ultima mossa se non la vedi."), true);
        await caricaPannello(); disegnaLavagna();
        return;
      }
      if (!r.ok) throw new Error(d.errore || "HTTP " + r.status);
      if (Number.isInteger(d.versione)) PAN_VER = d.versione;
      PAN_SALVATO = JSON.parse(JSON.stringify(corpo));
      $("lav-stato").textContent = demo ? t("salvata (solo demo)") : t("salvata");
      aggiornaAllineamento();
    } catch (e) { $("lav-stato").textContent = t("non salvata"); toast(t("Disposizione non salvata: {errore}", { errore: e.message }), true); }
  }, 500);
}

// ------------------------------------------------ gli agenti (da spazi.json, via /api/catalogo)
// il colore di uno spazio viene dal suo id: sempre lo stesso, senza scriverlo a mano
const COLORI_SPAZI = ["#599ce7", "#d08770", "#4fb286", "#9386f2", "#e0a458", "#e06c9f", "#5fb3b3"];
function coloreSpazio(id) {
  if (!id) return "#599ce7";
  let h = 0;
  for (const c of String(id)) h = ((h << 5) - h + c.charCodeAt(0)) | 0;
  return COLORI_SPAZI[Math.abs(h) % COLORI_SPAZI.length];
}
// una riga per ruolo: emoji per il vecchio stile, categoria per il seed dell'avatar
// (stessa faccia per lo stesso ruolo ovunque, il colore cambia solo per spazio)
const RUOLI = [
  [/seo|google|search/, "seo", "🔎"], [/x-|social|linkedin|post/, "social", "📣"], [/legal|avvoc|contratt|norm/, "legale", "⚖️"],
  [/fisc|contab|bilanc|finanz|cost|prezz/, "finanza", "📊"], [/dati|sql|erp|crm/, "dati", "🗄️"], [/design|grafic|ui|ux/, "design", "🎨"],
  [/android|app|mobile/, "mobile", "📱"], [/web|sito|front/, "web", "🌐"], [/test|verific|qa|revis/, "revisione", "✅"], [/ricerc|analist/, "ricerca", "🔬"],
  [/person|hr|turn|staff/, "persone", "👥"], [/cucina|menu|chef|food/, "cucina", "🍳"], [/market|vend|commerc/, "commerciale", "💼"], [/dev|code|svilupp|backend/, "sviluppo", "🛠️"],
  [/manuten/, "manutenzione", "🔧"],
];
function ruoloDi(a) {
  const n = a.nome.toLowerCase();
  if (a.capogruppo) return { cat: "capogruppo", emoji: "🧭" };
  for (const [re, cat, e] of RUOLI) if (re.test(n)) return { cat, emoji: e };
  return { cat: a.modello || "generico", emoji: { opus: "🛠️", haiku: "⚡" }[a.modello] || "🧠" };
}
function emojiDi(a) { return ruoloDi(a).emoji; }

// ---- Avatar "beam" — stesso algoritmo di Boring Avatars (MIT), riscritto qui in
// vanilla JS: niente servizio esterno, gira anche senza internet. Il seed è il
// ruolo (non il nome): stessa faccia per «avvocato» ovunque, cambia solo il colore.
function hashCode(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; } return Math.abs(h); }
const _digit = (n, i) => Math.floor(n / 10 ** i) % 10;
const _bool = (n, i) => _digit(n, i) % 2 === 0;
const _unit = (n, range, i) => { const v = n % range; return i && _digit(n, i) % 2 === 0 ? -v : v; };
function contrastoDi(hex) {
  hex = hex.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 128 ? "#000000" : "#ffffff";
}
function hslAHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const t = (x) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${t(f(0))}${t(f(8))}${t(f(4))}`;
}
// 5 tonalità a partire dal colore dello spazio: varietà senza perdere l'identità del progetto
function paletteDaColore(hex) {
  hex = hex.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16) / 255, g = parseInt(hex.slice(2, 4), 16) / 255, b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l0 = (max + min) / 2, d = max - min;
  let h = 0, s0 = d === 0 ? 0 : d / (1 - Math.abs(2 * l0 - 1));
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  s0 *= 100; const l = l0 * 100;
  const mk = (dh, ds, dl) => hslAHex((h + dh + 360) % 360, Math.max(25, Math.min(85, s0 + ds)), Math.max(22, Math.min(78, l + dl)));
  return [mk(-25, -5, -10), mk(0, 15, 6), mk(20, -20, 22), mk(-45, 10, -14), mk(40, 5, 12)];
}
function svgBeam(seed, colori) {
  const SZ = 36, n = hashCode(seed), range = colori.length;
  const wrapperColor = colori[n % range], faceColor = contrastoDi(wrapperColor), backgroundColor = colori[(n + 13) % range];
  const preX = _unit(n, 10, 1), wrapperTranslateX = preX < 5 ? preX + SZ / 9 : preX;
  const preY = _unit(n, 10, 2), wrapperTranslateY = preY < 5 ? preY + SZ / 9 : preY;
  const wrapperRotate = _unit(n, 360), wrapperScale = 1 + _unit(n, SZ / 12) / 10;
  const isMouthOpen = _bool(n, 2), isCircle = _bool(n, 1), eyeSpread = _unit(n, 5), mouthSpread = _unit(n, 3);
  const faceRotate = _unit(n, 10, 3);
  const faceTranslateX = wrapperTranslateX > SZ / 6 ? wrapperTranslateX / 2 : _unit(n, 8, 1);
  const faceTranslateY = wrapperTranslateY > SZ / 6 ? wrapperTranslateY / 2 : _unit(n, 7, 2);
  const bocca = isMouthOpen
    ? `<path d="M15 ${19 + mouthSpread}c2 1 4 1 6 0" stroke="${faceColor}" fill="none" stroke-linecap="round"/>`
    : `<path d="M13,${19 + mouthSpread} a1,0.75 0 0,0 10,0" fill="${faceColor}"/>`;
  return `<svg viewBox="0 0 ${SZ} ${SZ}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
    <rect width="${SZ}" height="${SZ}" fill="${backgroundColor}"/>
    <rect x="0" y="0" width="${SZ}" height="${SZ}" fill="${wrapperColor}" rx="${isCircle ? SZ : SZ / 6}"
      transform="translate(${wrapperTranslateX} ${wrapperTranslateY}) rotate(${wrapperRotate} ${SZ / 2} ${SZ / 2}) scale(${wrapperScale})"/>
    <g transform="translate(${faceTranslateX} ${faceTranslateY}) rotate(${faceRotate} ${SZ / 2} ${SZ / 2})">
      ${bocca}
      <rect x="${14 - eyeSpread}" y="14" width="1.5" height="2" rx="1" fill="${faceColor}"/>
      <rect x="${20 + eyeSpread}" y="14" width="1.5" height="2" rx="1" fill="${faceColor}"/>
    </g>
  </svg>`;
}
function tuttiAgenti() {
  const out = [];
  for (const s of spaziCat || []) for (const p of s.progetti || []) for (const a of p.agenti || []) {
    out.push({ key: `${p.id}:${a.nome}`, nome: a.nome, progetto: p.id, progettoNome: p.nome, spazio: s.id, spazioNome: s.nome,
      modello: a.modello, capogruppo: a.capogruppo, descrizione: a.descrizione || "", cartella: p.cartella,
      file: a.file, strumenti: a.strumenti || [],
      // punto 13 del contratto: il server nuovo li manda; col vecchio restano ai valori di sempre
      nuovo: "attivo" in a, tono: a.tono || "", umorismo: Number.isFinite(+a.umorismo) ? +a.umorismo : 1,
      attivo: a.attivo !== false, comunica: Array.isArray(a.comunica) ? a.comunica : null, aggiornato_ts: a.aggiornato_ts || 0,
      riporta_a: a.riporta_a || "" });          // punto 14: il sotto-agente riporta a uno specialista (terzo livello)
  }
  return out;
}
let AGENTI = new Map();
function aspettoDi(a) {
  const x = PAN.aspetto[a.key] || {};
  return { emoji: x.emoji || emojiDi(a), colore: x.colore || coloreSpazio(a.spazio) };
}
// Nomi e note li decide Boss dal pannello (aspetto in pannello.json); il nome del profilo
// resta quello vero e serve solo a chiamare l'agente.
const nomeDi = (a) => (a && (PAN.aspetto[a.key] || {}).nome) || (a ? a.nome : "Jarvis");
const notaDi = (a) => (a && (PAN.aspetto[a.key] || {}).nota) || "";
const progettoDi = (a) => (a && (PAN.aspetto["progetto:" + a.progetto] || {}).nome) || (a ? a.progettoNome : "");
function rinominaProgetto(nodo, pid) {
  nodo.contentEditable = "true"; nodo.focus();
  document.getSelection().selectAllChildren(nodo);
  nodo.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter") { ev.preventDefault(); nodo.blur(); } if (ev.key === "Escape") { nodo.dataset.annulla = "1"; nodo.blur(); } });
  nodo.addEventListener("blur", () => {
    nodo.contentEditable = "false";
    const k = "progetto:" + pid, t = nodo.textContent.trim().slice(0, 60);
    if (!nodo.dataset.annulla) { if (t) PAN.aspetto[k] = { ...(PAN.aspetto[k] || {}), nome: t }; else delete PAN.aspetto[k]; salvaPannello(); }
    disegnaGruppi(); disegnaLavagna(); aggiornaTestaChat();
  }, { once: true });
}
function avatar(a, classe = "avatar") {
  const s = aspettoDi(a);
  const span = el("span", { class: classe, style: `--c:${s.colore}`, "aria-hidden": "true" });
  const personalizzata = a && (PAN.aspetto[a.key] || {}).emoji;
  if (a && a.nome && !personalizzata) span.innerHTML = svgBeam(ruoloDi(a).cat, paletteDaColore(s.colore));
  else span.textContent = s.emoji;
  return span;
}

// ------------------------------------------------ colonna di sinistra: gruppi
function gruppiPredefiniti() {
  return (spaziCat || []).map((s) => ({ id: "spazio-" + s.id, nome: s.nome, chiuso: false,
    agenti: s.progetti.flatMap((p) => p.agenti.map((a) => `${p.id}:${a.nome}`)) }));
}
// I gruppi salvati, più gli agenti nuovi (arrivati dopo il salvataggio) nel gruppo del loro spazio
function gruppiEffettivi() {
  if (!PAN.gruppi.length) return gruppiPredefiniti();
  const gruppi = PAN.gruppi.map((g) => ({ ...g, agenti: g.agenti.filter((k) => AGENTI.has(k)) }));
  const messi = new Set(gruppi.flatMap((g) => g.agenti));
  for (const a of AGENTI.values()) {
    if (messi.has(a.key)) continue;
    let g = gruppi.find((x) => x.id === "spazio-" + a.spazio);
    if (!g) { g = { id: "spazio-" + a.spazio, nome: a.spazioNome, chiuso: false, agenti: [] }; gruppi.push(g); }
    g.agenti.push(a.key);
  }
  return gruppi;
}
function fissaGruppi() { PAN.gruppi = gruppiEffettivi(); }

let filtro = "";
function disegnaGruppi() {
  AGENTI = new Map(tuttiAgenti().map((a) => [a.key, a]));
  const box = $("gruppi");
  if (!box) return;
  if (!AGENTI.size) { box.replaceChildren(el("p", { class: "vuoto nota" }, spaziCat.length ? t("nessun agente nei progetti") : (CAT.skills ? t("nessun progetto con agenti: si aggiungono dall'installazione (installa/configura.py) o in spazi.json") : t("lettura degli agenti…")))); return; }
  const f = filtro.toLowerCase();
  box.replaceChildren(...gruppiEffettivi().map((g) => {
    const agenti = g.agenti.map((k) => AGENTI.get(k)).filter((a) => a &&
      (!f || [a.nome, nomeDi(a), progettoDi(a), a.descrizione, notaDi(a)].join(" ").toLowerCase().includes(f)));
    if (f && !agenti.length) return document.createComment("");
    const custom = !g.id.startsWith("spazio-");
    const nome = el("span", { class: "nome-gruppo", title: t("Doppio clic o ✎ per rinominare") }, g.nome);
    const testa = el("div", { class: "gruppo-testa", role: "button", tabindex: "0", "aria-expanded": String(!g.chiuso) },
      el("span", { class: "freccia" }, "▼"), nome, el("span", { class: "quanti" }, String(agenti.length)),
      el("button", { class: "icona azione-g", title: t("Scheda del gruppo: progetti, squadra, azioni"),
        onclick: (ev) => { ev.stopPropagation(); apriSchedaGruppo(g.id); } }, "ℹ"),
      el("button", { class: "icona azione-g", title: t("Apri il gruppo nella lavagna: capogruppo e squadra, già collegati"),
        onclick: (ev) => { ev.stopPropagation(); apriGruppoInLavagna(g.id); } }, "▦"),
      el("button", { class: "icona azione-g", title: t("Nuovo agente in questo gruppo"),
        onclick: (ev) => { ev.stopPropagation(); apriNuovoAgente(g.id.startsWith("spazio-") ? g.id.slice(7) : null); } }, "＋"),
      el("button", { class: "icona azione-g", title: t("Rinomina il gruppo"),
        onclick: (ev) => { ev.stopPropagation(); rinominaGruppo(nome, g.id); } }, "✎"),
      custom ? el("button", { class: "icona azione-g", title: t("Togli il gruppo (gli agenti tornano al loro spazio)"),
        onclick: (ev) => { ev.stopPropagation(); smontaGruppo(g.id); } }, "✕") : "");
    // il clic apre/chiude dopo 250 ms: un doppio clic sul nome lo annulla e rinomina
    testa.addEventListener("click", (ev) => {
      clearTimeout(testa.__t);
      if (ev.detail > 1) return;
      testa.__t = setTimeout(() => { fissaGruppi(); const x = PAN.gruppi.find((y) => y.id === g.id); x.chiuso = !x.chiuso; salvaPannello(); disegnaGruppi(); },
        ev.target.closest(".nome-gruppo") ? 250 : 0);
    });
    testa.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target === testa) testa.click(); });
    nome.addEventListener("dblclick", (ev) => { ev.stopPropagation(); clearTimeout(testa.__t); rinominaGruppo(nome, g.id); });
    const lista = el("div", { class: "gruppo-lista" });
    let progettoPrima = null;
    for (const a of agenti) {
      // nei gruppi degli spazi, una riga per progetto quando lo spazio ne ha più d'uno
      if (!custom && a.progetto !== progettoPrima && new Set(agenti.map((x) => x.progetto)).size > 1) {
        const sp = el("div", { class: "sotto-progetto", "data-progetto": a.progetto, title: t("Doppio clic per rinominare il progetto") }, progettoDi(a));
        sp.addEventListener("dblclick", () => rinominaProgetto(sp, a.progetto));
        lista.append(sp);
      }
      progettoPrima = a.progetto;
      lista.append(rigaAgenteLato(a, g.id));
    }
    if (!agenti.length) lista.append(el("div", { class: "vuoto-gruppo" }, t("trascina qui gli agenti")));
    // gli agenti tolti (archiviati) dello spazio, in grigio, con «Ripristina»
    if (!custom && !f) for (const x of archiviatiDi(g.id.slice(7))) lista.append(el("div", { class: "agente archiviato", title: t("Archiviato: il profilo sta in .claude/agents/_archivio") },
      el("span", { class: "avatar" }, "⌫"), el("div", { class: "testo" }, el("b", {}, x.nome), el("small", {}, t("archiviato · {progetto}", { progetto: x.progettoNome }))),
      el("button", { class: "piccolo", type: "button", onclick: async (ev) => { ev.stopPropagation();
        const d = await azione({ tipo: "agente", cosa: "ripristina", progetto: x.progetto, nome: x.nome }, ev.currentTarget); if (d) caricaSpazi(); } }, t("Ripristina"))));
    const gruppo = el("section", { class: "gruppo" + (g.chiuso && !f ? " chiuso" : ""), "data-gruppo": g.id },
      testa, el("div", { class: "gruppo-corpo" }, lista));
    // si può lasciare un agente anche sulla testa o sullo spazio vuoto del gruppo
    gruppo.addEventListener("dragover", (ev) => { if (trascinoAgente) { ev.preventDefault(); gruppo.classList.add("sopra"); } });
    gruppo.addEventListener("dragleave", (ev) => { if (!gruppo.contains(ev.relatedTarget)) gruppo.classList.remove("sopra"); });
    gruppo.addEventListener("drop", (ev) => {
      ev.preventDefault(); gruppo.classList.remove("sopra");
      const k = ev.dataTransfer.getData("text/x-agente");
      if (k) spostaAgente(k, g.id, null);
    });
    return gruppo;
  }));
  disegnaAgentiSpazi();
  segnaAttivi();
}

function rigaAgenteLato(a, gid) {
  const riga = el("div", { class: "agente" + (chatCon === a.key ? " scelto" : "") + (a.attivo === false ? " spento" : ""), draggable: "true", tabindex: "0",
    "data-agente": a.key, title: notaDi(a) || a.descrizione, style: `--c:${aspettoDi(a).colore}` },
    avatar(a),
    el("div", { class: "testo" }, el("b", {}, nomeDi(a)), el("small", {}, (a.capogruppo ? t("capogruppo") + " · " : "") + progettoDi(a))),
    el("span", { class: "mod" }, a.modello));
  riga.addEventListener("click", () => apriChat(a.key));
  riga.addEventListener("dblclick", () => apriScheda(a.key));
  riga.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") apriChat(a.key);
    if (ev.key === " ") { ev.preventDefault(); apriScheda(a.key); }
  });
  riga.addEventListener("contextmenu", (ev) => { ev.preventDefault(); apriScheda(a.key); });
  riga.addEventListener("dragstart", (ev) => {
    trascinoAgente = a.key;
    ev.dataTransfer.setData("text/x-agente", a.key);
    ev.dataTransfer.setData("text/plain", a.nome);
    ev.dataTransfer.effectAllowed = "copyMove";
    requestAnimationFrame(() => riga.classList.add("trascinato"));
  });
  riga.addEventListener("dragend", () => { trascinoAgente = null; riga.classList.remove("trascinato"); document.querySelectorAll(".sopra,.inserisci-sopra").forEach((x) => x.classList.remove("sopra", "inserisci-sopra")); });
  riga.addEventListener("dragover", (ev) => { if (trascinoAgente && trascinoAgente !== a.key) { ev.preventDefault(); riga.classList.add("inserisci-sopra"); } });
  riga.addEventListener("dragleave", () => riga.classList.remove("inserisci-sopra"));
  riga.addEventListener("drop", (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    riga.classList.remove("inserisci-sopra");
    document.querySelectorAll(".gruppo.sopra").forEach((x) => x.classList.remove("sopra"));
    const k = ev.dataTransfer.getData("text/x-agente");
    if (k && k !== a.key) spostaAgente(k, gid, a.key);
  });
  return riga;
}
let trascinoAgente = null;

function spostaAgente(k, gid, prima) {
  fissaGruppi();
  for (const g of PAN.gruppi) g.agenti = g.agenti.filter((x) => x !== k);
  const g = PAN.gruppi.find((x) => x.id === gid);
  if (!g) return;
  const i = prima ? g.agenti.indexOf(prima) : -1;
  if (i >= 0) g.agenti.splice(i, 0, k); else g.agenti.push(k);
  g.chiuso = false;
  salvaPannello();
  disegnaGruppi();
}
function nuovoGruppo() {
  fissaGruppi();
  const g = { id: "g-" + Date.now().toString(36), nome: t("Nuovo gruppo"), chiuso: false, agenti: [] };
  PAN.gruppi.unshift(g);
  salvaPannello();
  disegnaGruppi();
  const nome = document.querySelector(`[data-gruppo="${g.id}"] .nome-gruppo`);
  if (nome) rinominaGruppo(nome, g.id);
}
function rinominaGruppo(nodo, gid) {
  nodo.contentEditable = "true";
  nodo.focus();
  document.getSelection().selectAllChildren(nodo);
  const fine = (salva) => {
    nodo.contentEditable = "false";
    const testo = nodo.textContent.trim().slice(0, 60);
    if (salva && testo) { fissaGruppi(); PAN.gruppi.find((x) => x.id === gid).nome = testo; salvaPannello(); }
    disegnaGruppi();
  };
  nodo.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); nodo.blur(); }
    if (ev.key === "Escape") { nodo.textContent = ""; fine(false); }
    ev.stopPropagation();
  });
  nodo.addEventListener("click", (ev) => ev.stopPropagation());
  nodo.addEventListener("blur", () => fine(true), { once: true });
}
function smontaGruppo(gid) {
  fissaGruppi();
  PAN.gruppi = PAN.gruppi.filter((g) => g.id !== gid);   // gli agenti tornano da soli al loro spazio
  salvaPannello();
  disegnaGruppi();
  toast(t("Gruppo tolto: gli agenti sono tornati nel loro spazio"));
}
// ---- scheda gruppo: un solo posto per vedere tutto il gruppo. Un agente si
// modifica sempre dalla sua scheda (qui solo un rimando), per non tenere due copie degli stessi campi.
let schedaGruppoId = null;
function rigaSquadraGruppo(a) {
  const riga = el("div", { class: "agente", style: `--c:${aspettoDi(a).colore}` },
    avatar(a),
    el("div", { class: "testo" }, el("b", {}, nomeDi(a)), el("small", {}, (a.capogruppo ? t("capogruppo") + " · " : "") + progettoDi(a))),
    el("span", { class: "mod" }, a.modello));
  riga.addEventListener("click", () => { $("scheda-gruppo").close(); apriScheda(a.key); });
  return riga;
}
function apriSchedaGruppo(gid) {
  fissaGruppi();
  const g = PAN.gruppi.find((x) => x.id === gid);
  if (!g) return;
  schedaGruppoId = gid;
  // se il gruppo è anche uno spazio vero (spazi.json), si vedono le cartelle vere e la memoria
  const spazioVero = gid.startsWith("spazio-") && (spaziCat || []).find((s) => s.id === gid.slice(7));
  const cartellaDi = (pid) => spazioVero && (spazioVero.progetti.find((p) => p.id === pid) || {}).cartella;
  const agenti = g.agenti.map((k) => AGENTI.get(k)).filter(Boolean);
  const perProgetto = new Map();
  for (const a of agenti) { if (!perProgetto.has(a.progetto)) perProgetto.set(a.progetto, []); perProgetto.get(a.progetto).push(a); }
  $("sg-nome").value = g.nome;
  $("sg-sotto").textContent = (perProgetto.size === 1 ? t("1 progetto") : t("{n} progetti", { n: perProgetto.size })) + " · " + (agenti.length === 1 ? t("1 agente") : t("{n} agenti", { n: agenti.length }));
  $("sg-memoria").replaceChildren(...(spazioVero ? [
    el("div", {}, t("Memoria") + ": ", el("code", {}, spazioVero.memoria)),
    el("div", {}, t("Report") + ": ", el("code", {}, spazioVero.report)),
  ] : []));
  $("sg-progetti").replaceChildren(...[...perProgetto.entries()].map(([pid, lista]) => {
    const capo = lista.find((a) => a.capogruppo);
    const primo = capo || lista[0];
    const specialisti = lista.filter((a) => a !== capo);
    const cartella = cartellaDi(pid);
    return el("div", { class: "agente", style: `--c:${aspettoDi(primo).colore}` },
      avatar(primo),
      el("div", { class: "testo" }, el("b", {}, capo ? nomeDi(capo) : progettoDi(primo)),
        el("small", {}, (capo ? t("capogruppo") : t("senza capogruppo")) + " · " + progettoDi(primo) +
          (specialisti.length ? " · " + t("{n} specialisti", { n: specialisti.length }) : "")),
        cartella ? el("small", {}, el("code", {}, cartella)) : ""),
      el("button", { class: "piccolo", type: "button", onclick: () => { $("scheda-gruppo").close(); apriScheda(primo.key); } }, t("Apri")));
  }));
  $("sg-quanti").textContent = `(${agenti.length})`;
  $("sg-squadra").replaceChildren(...agenti.map(rigaSquadraGruppo));
  $("sg-togli").style.display = gid.startsWith("spazio-") ? "none" : "";
  $("scheda-gruppo").showModal();
}
$("sg-lavagna").addEventListener("click", () => { $("scheda-gruppo").close(); apriGruppoInLavagna(schedaGruppoId); location.hash = "#lavagna"; });
$("sg-nuovo-agente").addEventListener("click", () => { $("scheda-gruppo").close();
  apriNuovoAgente(schedaGruppoId.startsWith("spazio-") ? schedaGruppoId.slice(7) : null); });
$("sg-togli").addEventListener("click", () => {
  const g = PAN.gruppi.find((x) => x.id === schedaGruppoId);
  if (!g || !confirm(t("Togliere il gruppo {nome}?\n\nGli agenti tornano al loro spazio: i profili non si toccano.", { nome: g.nome }))) return;
  $("scheda-gruppo").close();
  smontaGruppo(schedaGruppoId);
});
$("form-scheda-gruppo").addEventListener("submit", (ev) => {
  if (!ev.submitter || ev.submitter.value !== "salva") return;
  const g = PAN.gruppi.find((x) => x.id === schedaGruppoId);
  const nome = $("sg-nome").value.trim().slice(0, 60);
  if (g && nome && nome !== g.nome) { g.nome = nome; salvaPannello(); disegnaGruppi(); }
});
$("btn-nuovo-gruppo").addEventListener("click", nuovoGruppo);
$("btn-ripristina-gruppi").addEventListener("click", () => {
  if (!confirm(t("Tornare ai gruppi per spazio? I gruppi creati da te spariscono (emoji, colori e lavagna restano)."))) return;
  PAN.gruppi = [];
  salvaPannello();
  disegnaGruppi();
});
$("cerca-agenti").addEventListener("input", (ev) => { filtro = ev.target.value.trim(); disegnaGruppi(); });

// ------------------------------------------------ chi lavora DAVVERO adesso (26/09/2026, richiesta di Boss)
// Una sola fonte, attivita(s), calcolata a ogni giro di aggiorna() (col flusso: in tempo reale).
// Sorgenti: gli agenti «attivo» della sessione di Claude, gli esperti e il capo delle missioni, i
// lavori in corso (interlocutore «progetto:agente» o «jarvis»), le sessioni di Claude che lavorano
// dentro la cartella di un progetto, le chat di questa pagina che aspettano una risposta.
// segnaAttivi() la mette in pagina: colonna sinistra, catena, lavagna, testa della chat.
let ATTIVITA = { agenti: new Set(), progetti: new Set(), jarvis: false, boss_ts: 0 };
let firmaAttivita = "";
let timerBoss = null;
function trovaAgente(nome) {
  const n = String(nome || "").trim();
  if (!n) return null;
  const tutti = [...AGENTI.values()];
  return tutti.find((a) => a.nome === n || nomeDi(a) === n) || (n.length >= 5 ? tutti.find((a) => stessoNome(a.nome, n)) : null) || null;
}
// ~/… e /Users/<utente>/… sono la stessa cartella; basta anche lo stesso nome dell'ultima cartella
function stessaCartella(dove, cartella) {
  const norm = (x) => String(x || "").replace(/^\/Users\/[^/]+/, "~").replace(/\/+$/, "");
  const d = norm(dove), c = norm(cartella);
  return !!d && !!c && (d === c || d.startsWith(c + "/") || d.split("/").pop() === c.split("/").pop());
}
function attivita(s) {
  const agenti = new Set(), progetti = new Set();
  let jarvis = !!(s.claude_ora && s.claude_ora.lavorando);
  const perNome = (n) => { const a = trovaAgente(n); if (a) agenti.add(a.key); return !!a; };
  for (const g of (s.claude_ora && s.claude_ora.agenti) || []) if (g.stato === "attivo") perNome(g.nodo || g.tipo);
  for (const m of s.agenti_attivi || []) {
    for (const e of m.esperti || []) perNome(e.nome);
    if (m.chi) perNome(m.chi);
  }
  for (const l of s.lavori || []) {
    if (l.stato !== "in corso") continue;
    const k = l.interlocutore || (l.info || {}).interlocutore || "";
    if (k === "jarvis" || /^jarvis$/i.test(l.chi || "")) jarvis = true;
    else if (AGENTI.has(k)) agenti.add(k);
    else if (l.chi) perNome(l.chi);
  }
  for (const [k, t] of Object.entries(THREADS)) if (t.attesa) { if (k === "jarvis") jarvis = true; else if (AGENTI.has(k)) agenti.add(k); }
  if (CATENA_GIRO && CATENA_GIRO.coinvolti) for (const k of CATENA_GIRO.coinvolti) agenti.add(k);
  const sessioni = ((s.locale || {}).agenti_sessioni || {}).sessioni || [];
  for (const x of sessioni) if (x.lavora && x.dove)
    for (const sp of spaziCat || []) for (const p of sp.progetti || []) if (stessaCartella(x.dove, p.cartella)) progetti.add(p.id);
  for (const k of agenti) { const a = AGENTI.get(k); if (a) progetti.add(a.progetto); }
  const rt = s.claude_ora && s.claude_ora.richiesta_ts;
  const boss_ts = rt && Date.now() / 1000 - rt < 8 ? rt : 0;
  return { agenti, progetti, jarvis, boss_ts };
}
function aggiornaAttivita(s) {
  ATTIVITA = attivita(s);
  const firma = JSON.stringify([[...ATTIVITA.agenti].sort(), [...ATTIVITA.progetti].sort(), ATTIVITA.jarvis, !!ATTIVITA.boss_ts]);
  // Boss resta acceso 8 s dopo la richiesta: poi si ricalcola da solo, anche senza un giro nuovo
  clearTimeout(timerBoss);
  if (ATTIVITA.boss_ts) timerBoss = setTimeout(() => { if (ultimoStato) aggiornaAttivita(ultimoStato); }, Math.max(200, (ATTIVITA.boss_ts + 8) * 1000 - Date.now()));
  if (firma === firmaAttivita) return;             // si ridisegna solo quando cambia qualcosa
  firmaAttivita = firma;
  segnaAttivi();
}
// la nota della lavagna che rappresenta Jarvis, Boss, uno spazio o un progetto senza capogruppo
function notaAccesa(n) {
  const x = String(n.testo || "");
  if (/^Jarvis\b/.test(x)) return ATTIVITA.jarvis;
  if (x === UTENTE) return !!ATTIVITA.boss_ts;
  for (const s of spaziCat || []) {
    if (x === s.nome) return s.progetti.some((p) => ATTIVITA.progetti.has(p.id));
    // la nota può essere nata in italiano o nella lingua di adesso
    for (const p of s.progetti) if (x === p.nome + " · senza capogruppo" || x === p.nome + " · " + t("senza capogruppo")) return ATTIVITA.progetti.has(p.id);
  }
  return false;
}
function segnaAttivi() {
  const A = ATTIVITA;
  // righe con un agente (colonna sinistra, Agenti per spazio): anello attorno all'avatar e alone
  for (const r of document.querySelectorAll("[data-agente]:not(.nodo)")) r.classList.toggle("attivo", A.agenti.has(r.dataset.agente));
  // gruppi della colonna sinistra: si accendono anche chiusi, con «N al lavoro»
  for (const g of gruppiEffettivi()) {
    const box = document.querySelector(`.gruppo[data-gruppo="${CSS.escape(g.id)}"]`);
    if (!box) continue;
    const n = g.agenti.filter((k) => A.agenti.has(k)).length;
    const progetto = g.agenti.some((k) => A.progetti.has((AGENTI.get(k) || {}).progetto));
    box.classList.toggle("acceso", n > 0 || progetto);
    const testa = box.querySelector(".gruppo-testa");
    let vivo = testa && testa.querySelector(".al-lavoro-n");
    if (testa && !vivo) { vivo = el("small", { class: "al-lavoro-n" }); testa.querySelector(".quanti").before(vivo); }
    if (vivo) vivo.textContent = n ? t("{n} al lavoro", { n }) : progetto ? t("al lavoro") : "";
  }
  for (const sp of document.querySelectorAll(".sotto-progetto[data-progetto]")) sp.classList.toggle("acceso", A.progetti.has(sp.dataset.progetto));
  // lavagna (tutte tranne la dimostrazione, che si accende da sola)
  if (!eDemo(lavagnaAttiva)) {
    for (const n of document.querySelectorAll("#lav-mondo .nodo")) {
      const nodo = nodoDi(n.dataset.id);
      if (!nodo) continue;
      n.classList.toggle("al-lavoro", nodo.tipo === "agente" ? A.agenti.has(nodo.agente) : notaAccesa(nodo));
    }
    marcaFili();
  }
  // testa della chat: l'interlocutore al lavoro
  const av = $("chat-avatar");
  if (av) av.classList.toggle("al-lavoro", !!(THREADS[chatCon] && THREADS[chatCon].attesa) ||
    (chatCon === "jarvis" ? A.jarvis : A.agenti.has(chatCon)));
  applicaSinapsi();
}
// ------------------------------------------------ sinapsi: chi comunica con chi
// s.comunicazioni: le ultime 60, più recenti prima, {ts, da, a, testo, tipo, stato, id}. Chiavi: boss (l'utente),
// jarvis, sentinella, «progetto:nome» o il solo nome. Sulla lavagna attiva il filo da → a scorre nel
// verso giusto (se il filo non c'è, uno temporaneo tratteggiato per 20 s) e una bolla col testo sta
// sopra la scheda di arrivo finché la comunicazione è in corso («finito» la spegne, «errore» è rossa).
// In colonna la riga di chi riceve dice «← da chi: testo» per 15 s. Il pannello «Sinapsi» tiene le 60.
const SINAPSI = { lista: [], timer: null, chiave: "", chiuse: new Set(), trascino: null };
function agenteDaChiave(k) {
  k = String(k || "");
  if (AGENTI.has(k)) return AGENTI.get(k);
  // boss, jarvis e sentinella non sono agenti: «jarvis» somiglierebbe a «x-ricerca-jarvis»
  if (/^(boss|jarvis|sentinella|memoria)$/i.test(k) || /:orchestratore$/i.test(k)) return null;
  return trovaAgente(k.includes(":") ? k.split(":").pop() : k);
}
// «<progetto>:orchestratore» (missioni): il progetto, per mostrarlo e per trovargli una scheda
function progettoOrchestratore(k) {
  const m = String(k || "").match(/^([^:]+):orchestratore$/i);
  return m ? (spaziCat || []).flatMap((s) => s.progetti).find((p) => p.id === m[1]) || { id: m[1], nome: m[1], agenti: [] } : null;
}
function nomeChiave(k) {
  const x = String(k || "").toLowerCase();
  const orch = progettoOrchestratore(k);
  if (orch) return t("orchestratore") + " · " + orch.nome;
  if (x === "boss") return UTENTE;
  if (x === "jarvis") return "Jarvis";
  if (x === "sentinella") return t("Sentinella");
  if (x === "memoria") return t("Memoria");
  const a = agenteDaChiave(k);
  return a ? nomeDi(a) : String(k || "?").split(":").pop();
}
function aggiornaSinapsi(lista) {
  SINAPSI.lista = (lista || []).filter((c) => c && c.id);
  const ol = $("sinapsi-lista");
  $("sinapsi-conta").textContent = SINAPSI.lista.length ? t("{n} · ultima {ora}", { n: SINAPSI.lista.length, ora: oraDi(SINAPSI.lista[0].ts) }) : t("nessuna comunicazione ancora");
  ol.replaceChildren(...SINAPSI.lista.map((c) => el("li", { class: "sin-" + String(c.stato || "").replace(" ", "-") },
    el("time", {}, oraDi(c.ts)),
    el("b", {}, nomeChiave(c.da) + " → " + nomeChiave(c.a)),
    el("span", {}, c.testo || ""),
    el("small", {}, [NOME_TIPO_COM[c.tipo] || c.tipo, NOME_STATO_COM[c.stato] || c.stato].filter(Boolean).join(" · ")))));
  applicaSinapsi();
}
// tipo e stato delle comunicazioni arrivano dal server in italiano: si mostrano tradotti
const NOME_STATO_COM = { "in corso": t("in corso"), finito: t("finito"), errore: t("errore") };
const NOME_TIPO_COM = { lancio: t("lancio"), risposta: t("risposta"), richiesta: t("richiesta"), sentinella: t("sentinella") };
const oraDi = (ts) => ts ? new Date(ts * 1000).toTimeString().slice(0, 8) : "--:--";
// la scheda della lavagna per una chiave: agenti per chiave, Boss e Jarvis per le loro note
function schedaDiChiave(k) {
  const x = String(k || "").toLowerCase();
  const nodi = lav().nodi;
  let n = null;
  if (x === "boss") n = nodi.find((z) => z.tipo === "nota" && (z.testo === UTENTE || /^(Boss|Umano)\b/.test(z.testo || "") || String(z.testo || "").startsWith(t("Umano"))));
  else if (x === "jarvis") n = nodi.find((z) => z.tipo === "nota" && /^Jarvis\b/.test(z.testo || ""));
  else if (x === "sentinella") n = nodi.find((z) => z.tipo === "nota" && (/^Sentinella/i.test(z.testo || "") || String(z.testo || "").startsWith(t("Sentinella"))));
  else if (x === "memoria") n = nodi.find((z) => z.tipo === "nota" && (/^Memoria$/i.test(z.testo || "") || z.testo === t("Memoria")));
  else if (progettoOrchestratore(k)) {
    // l'orchestratore di una missione non ha una scheda: si usa il capogruppo del progetto, o la sua etichetta
    const p = progettoOrchestratore(k);
    const capo = [...AGENTI.values()].find((a) => a.progetto === p.id && a.capogruppo);
    n = (capo && nodi.find((z) => z.agente === capo.key)) || nodi.find((z) => z.tipo === "nota" && (z.testo === p.nome + " · senza capogruppo" || z.testo === p.nome + " · " + t("senza capogruppo")));
  } else {
    const a = agenteDaChiave(k);
    if (a) n = nodi.find((z) => z.agente === a.key);
    // gli agenti di casa di Jarvis (esecutore, ricercatore-web…) sono note accanto a lui nella catena
    const nome = String(k || "").split(":").pop();
    if (!n) n = nodi.find((z) => z.tipo === "nota" && (z.testo === nome || String(z.testo || "").startsWith(nome + " · ")));
  }
  return n ? document.querySelector(`#lav-mondo .nodo[data-id="${CSS.escape(n.id)}"]`) : null;
}
// «Sentinella» e «Memoria» possono mancare in una lavagna: se servono si mettono solo in pagina, accanto a Jarvis
function schedaTemporanea(nome, dx, dy) {
  const classe = nome.toLowerCase();
  let d = document.querySelector(`#lav-mondo .nodo.sinapsi-tmp.${classe}`);
  if (d) return d;
  const j = schedaDiChiave("jarvis");
  if (!j) return null;
  d = el("div", { class: `nodo nota sinapsi-tmp ${classe}`, title: t(nome) }, el("div", { class: "testo-nota" }, t(nome)));
  d.style.left = (j.offsetLeft + dx) + "px"; d.style.top = (j.offsetTop + dy) + "px";
  $("lav-mondo").append(d);
  return d;
}
const schedaSpeciale = (k) => { const x = String(k || "").toLowerCase();
  if (x === "sentinella") return schedaDiChiave(k) || schedaTemporanea("Sentinella", -230, 0);
  if (x === "memoria") return schedaDiChiave(k) || schedaTemporanea("Memoria", -230, 80);
  return schedaDiChiave(k); };
function rettDom(d) { const x = d.offsetLeft, y = d.offsetTop, w = d.offsetWidth, h = d.offsetHeight; return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 }; }
// ---- le bolle sono schede flottanti della tela
// Stanno nel «mondo» (seguono zoom e scorrimento), si trascinano come le schede e ricordano dove le
// metti: scostamento (dx, dy) dalla scheda di arrivo, per agente, in lav().bolle (pannello.json). Il server
// oggi tiene della lavagna solo nodi, fili e vista: una copia resta nel browser finché non tiene anche «bolle».
function chiaveBolla(B) { return B.dataset.agente || "nota:" + (B.dataset.id || [...B.classList].find((x) => x !== "nodo" && x !== "nota" && x !== "sinapsi-tmp") || "?"); }
function bolleSalvate() {
  const L = lav();
  if (!L.bolle) L.bolle = mem.leggi("bolle:" + lavagnaAttiva, {}) || {};
  return L.bolle;
}
function salvaBolle() {
  mem.scrivi("bolle:" + lavagnaAttiva, lav().bolle || {});
  salvaPannello();
}
// il rettangolo del foglio che si vede adesso, in coordinate del mondo
function vistaMondo() {
  const r = $("lavagna").getBoundingClientRect(), v = vista();
  return { x: -v.x / v.zoom, y: -v.y / v.zoom, w: r.width / v.zoom, h: r.height / v.zoom };
}
function posaBolla(B, c) {
  const r = rettDom(B), chiave = chiaveBolla(B);
  const bolla = el("div", { class: "sinapsi-tmp sinapsi-bolla" + (c.stato === "errore" ? " errore" : "") + (B.classList.contains("sinapsi-tmp") ? " temporanea" : ""),
    title: (c.testo || "") + "\n\n" + t("trascina per spostarla: la posizione resta per le prossime") },
    el("div", { class: "bolla-comandi" },
      el("button", { type: "button", class: "icona", title: t("Rimettila al posto di partenza"), onpointerdown: (ev) => ev.stopPropagation(), onclick: (ev) => { ev.stopPropagation();
        delete bolleSalvate()[chiave]; salvaBolle(); applicaSinapsi(); } }, "⌖"),
      el("button", { type: "button", class: "icona", title: t("Chiudi questa bolla"), onpointerdown: (ev) => ev.stopPropagation(), onclick: (ev) => { ev.stopPropagation();
        SINAPSI.chiuse.add(c.id); bolla.remove(); } }, "×")),
    el("b", {}, nomeChiave(c.da) + " → "), (c.testo || "").slice(0, 90));
  bolla.__arrivo = B;
  $("lav-mondo").append(bolla);
  const inv = Math.min(1.8, 1 / vista().zoom), bw = bolla.offsetWidth * inv, bh = bolla.offsetHeight * inv;
  const salvata = bolleSalvate()[chiave];
  let x, y;
  if (salvata) { x = r.x + salvata.dx; y = r.y + salvata.dy; }
  else {
    // partenza: sopra la scheda e spostata a destra, così non copre le schede vicine; dentro la parte visibile
    const vm = vistaMondo();
    x = r.x + r.w + 16; y = r.y - bh - 10;
    if (x + bw > vm.x + vm.w - 10) x = r.x - bw - 16;
    x = Math.max(vm.x + 10, Math.min(x, vm.x + vm.w - bw - 10));
    y = Math.max(vm.y + 10, Math.min(y, vm.y + vm.h - bh - 10));
  }
  bolla.style.left = Math.round(x) + "px"; bolla.style.top = Math.round(y) + "px";
  // si trascina come una scheda; lasciandola si salva lo scostamento dalla scheda di arrivo
  bolla.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 || ev.target.closest("button")) return;
    ev.stopPropagation();
    const m = puntoMondo(ev.clientX, ev.clientY);
    SINAPSI.trascino = { bolla, dx: m.x - parseFloat(bolla.style.left), dy: m.y - parseFloat(bolla.style.top), mosso: false };
    bolla.classList.add("trascina");
  });
}
addEventListener("pointermove", (ev) => {
  const g = SINAPSI.trascino;
  if (!g) return;
  const m = puntoMondo(ev.clientX, ev.clientY);
  g.bolla.style.left = Math.round(m.x - g.dx) + "px"; g.bolla.style.top = Math.round(m.y - g.dy) + "px";
  g.mosso = true;
});
addEventListener("pointerup", () => {
  const g = SINAPSI.trascino;
  if (!g) return;
  SINAPSI.trascino = null;
  g.bolla.classList.remove("trascina");
  if (!g.mosso) return;
  const B = g.bolla.__arrivo;
  if (!B) return;
  const r = rettDom(B);
  bolleSalvate()[chiaveBolla(B)] = { dx: Math.round(parseFloat(g.bolla.style.left) - r.x), dy: Math.round(parseFloat(g.bolla.style.top) - r.y) };
  salvaBolle();
});

// forza=false (dal timer): si ridisegna solo se cambia cosa va mostrato, così le animazioni non ripartono
function applicaSinapsi(forza = true) {
  clearTimeout(SINAPSI.timer);
  // mentre si trascina una bolla non si ridisegna: si riprova fra poco
  if (SINAPSI.trascino) { SINAPSI.timer = setTimeout(() => applicaSinapsi(forza), 500); return; }
  const adesso = Date.now() / 1000;
  const chiave = lavagnaAttiva + "|" + SINAPSI.chiuse.size + "|" + SINAPSI.lista.filter((c) => c.stato === "in corso" || adesso - (c.ts || 0) < 20)
    .map((c) => [c.id, c.stato, adesso - c.ts < 8, adesso - c.ts < 15].join(":")).join(",");
  if (!forza && chiave === SINAPSI.chiave) { if (chiave.includes(":")) SINAPSI.timer = setTimeout(() => applicaSinapsi(false), 1000); return; }
  SINAPSI.chiave = chiave;
  // via quello che la volta prima era solo delle sinapsi
  document.querySelectorAll(".sinapsi-tmp").forEach((n) => n.remove());
  document.querySelectorAll("#lav-fili path.sinapsi").forEach((p) => p.classList.remove("sinapsi", "inverso", "errore"));
  document.querySelectorAll(".agente.riceve").forEach((r) => r.classList.remove("riceve"));
  document.querySelectorAll(".gruppo.sinapsi").forEach((g) => g.classList.remove("sinapsi"));
  const ora = Date.now() / 1000;
  // chi l'utente ha chiuso con la × resta chiuso (prima il Set si riempiva ma non si leggeva mai)
  const vive = SINAPSI.lista.filter((c) => !SINAPSI.chiuse.has(c.id) && (c.stato === "in corso" || ora - (c.ts || 0) < 20));
  if (!vive.length) return;
  // lavagna (non la dimostrazione, che ha la sua animazione)
  if (!eDemo(lavagnaAttiva)) {
    const bolle = new Map();                                // una bolla per scheda: la comunicazione più recente
    for (const c of [...vive].reverse()) {                  // le più recenti per ultime: vincono
      const A = schedaSpeciale(c.da), B = schedaSpeciale(c.a);
      const errore = c.stato === "errore";
      if (A && B && A !== B) {
        const idA = A.dataset.id, idB = B.dataset.id;
        const dritto = idA && idB && document.querySelector(`#lav-fili path.filo[data-da="${CSS.escape(idA)}"][data-a="${CSS.escape(idB)}"]`);
        const rovescio = !dritto && idA && idB && document.querySelector(`#lav-fili path.filo[data-da="${CSS.escape(idB)}"][data-a="${CSS.escape(idA)}"]`);
        const p = dritto || rovescio;
        if (p) { p.classList.add("sinapsi"); p.classList.toggle("inverso", !!rovescio); p.classList.toggle("errore", errore); }
        else {                                              // nessun filo: uno temporaneo, tratteggiato
          const ra = rettDom(A), rb = rettDom(B);
          const q = document.createElementNS("http://www.w3.org/2000/svg", "path");
          q.setAttribute("d", curva(puntoVersoAltro(ra, rb.cx, rb.cy), puntoVersoAltro(rb, ra.cx, ra.cy)));
          q.setAttribute("class", "sinapsi-tmp filo-temp sinapsi" + (errore ? " errore" : ""));
          $("lav-fili").append(q);
        }
      }
      if (B && (c.stato === "in corso" || errore || ora - (c.ts || 0) < 8) && !SINAPSI.chiuse.has(c.id)) bolle.set(B, c);
    }
    for (const [B, c] of bolle) posaBolla(B, c);
  }
  // colonna sinistra: chi riceve, per 15 s
  for (const c of vive) {
    if (ora - (c.ts || 0) >= 15) continue;
    const a = agenteDaChiave(c.a);
    if (!a) continue;
    for (const r of document.querySelectorAll(`.agente[data-agente="${CSS.escape(a.key)}"]`)) {
      if (r.classList.contains("riceve")) continue;           // una riga, la comunicazione più recente
      r.classList.add("riceve");
      const small = r.querySelector(".testo");
      if (small) small.append(el("small", { class: "sinapsi-tmp sinapsi-riga" + (c.stato === "errore" ? " errore" : "") },
        "← " + t("da {chi}: {testo}", { chi: nomeChiave(c.da), testo: (c.testo || "").slice(0, 80) })));
      const g = r.closest(".gruppo");
      if (g) g.classList.add("sinapsi");
    }
  }
  // finché qualcosa è vivo si ricontrolla ogni secondo: le scadenze (15 s, 20 s) passano col tempo
  SINAPSI.timer = setTimeout(() => applicaSinapsi(false), 1000);
}

// i fili che arrivano a una scheda accesa scorrono (stessa classe della dimostrazione)
function marcaFili() {
  if (eDemo(lavagnaAttiva)) return;
  const accesi = new Set([...document.querySelectorAll("#lav-mondo .nodo.al-lavoro")].map((n) => n.dataset.id));
  for (const p of document.querySelectorAll("#lav-fili path.filo")) p.classList.toggle("acceso", accesi.has(p.dataset.a));
}

// ------------------------------------------------ scheda di un agente
let schedaKey = null;
async function apriScheda(k) {
  const a = AGENTI.get(k);
  if (!a) return;
  schedaKey = k;
  const s = aspettoDi(a);
  $("sa-avatar").replaceWith(Object.assign(avatar(a, "avatar grande"), { id: "sa-avatar" }));
  $("sa-nome").textContent = nomeDi(a);
  $("sa-dove").textContent = t("profilo {nome}", { nome: a.nome }) + ` · ${a.spazioNome} · ${progettoDi(a)} · ${a.modello}` + (a.capogruppo ? " · " + t("capogruppo") : "");
  $("sa-vdescr").value = a.descrizione || "";   // la versione troncata, finché non arriva quella intera
  $("sa-vmodello").value = a.modello;
  $("sa-vstrumenti").value = (a.strumenti || []).join(", ");
  // tono, umorismo, attivo, «comunica con» (punto 13): dal server nuovo; col vecchio si vedono ma non si scrivono
  const nuovo = a.nuovo;
  $("sa-vtono").value = a.tono || "";
  $("sa-vumor").value = a.umorismo; $("sa-vumor-t").textContent = UMORISMO[a.umorismo] || "";
  disegnaAttivoScheda(a.attivo);
  for (const id of ["sa-vtono", "sa-vumor", "sa-attivo", "sa-togli", "sa-sotto", "sa-togli-gruppo"]) $(id).disabled = !nuovo;
  $("sa-togli-gruppo").classList.toggle("nascosto", !a.capogruppo);
  $("sa-nota-server").textContent = nuovo ? "" : t("Tono, umorismo, attivo e archivio si scrivono col server nuovo.");
  SA_COMUNICA = a.comunica ? [...a.comunica] : [];
  $("sa-comunica-nomi").replaceChildren(...[...AGENTI.values()].filter((x) => x.key !== k)
    .sort((x, y) => (y.progetto === a.progetto) - (x.progetto === a.progetto)).map((x) => el("option", { value: x.nome }, x.progettoNome)));
  disegnaComunicaScheda();
  $("sa-alias").value = (PAN.aspetto[k] || {}).nome || "";
  $("sa-alias").placeholder = a.nome;
  $("sa-nota").value = notaDi(a);
  $("sa-emoji").value = s.emoji;
  $("sa-colore").value = s.colore;
  const gruppi = gruppiEffettivi();
  const dentro = gruppi.find((g) => g.agenti.includes(k));
  $("sa-gruppo").replaceChildren(...gruppi.map((g) => el("option", { value: g.id }, g.nome)));
  if (dentro) $("sa-gruppo").value = dentro.id;
  disegnaDipendenzeScheda();
  schedaProfilo = null;
  $("scheda-agente").showModal();
  if (a.file) {
    try {
      const p = await api("/api/agente-profilo?file=" + encodeURIComponent(a.file));
      if (schedaKey === k) {
        $("sa-vdescr").value = p.description; $("sa-vmodello").value = p.model; $("sa-vstrumenti").value = p.tools;
        // Il confronto per «Salva» si fa con quello che i campi mostrano ADESSO, con la descrizione
        // intera: prima si confrontava con la versione tagliata a 160 caratteri e ogni apertura e
        // chiusura della scheda riscriveva il file .md anche senza nessuna modifica.
        // «comunica con»: dal campo del server nuovo, altrimenti dal blocco scritto nel corpo del profilo
        if (!a.comunica) { SA_COMUNICA = nomiComunica(p.corpo); disegnaComunicaScheda(); }
        schedaProfilo = { k, descr: $("sa-vdescr").value.trim(), modello: $("sa-vmodello").value, strumenti: $("sa-vstrumenti").value.trim(),
          tono: $("sa-vtono").value.trim(), umorismo: +$("sa-vumor").value, comunica: SA_COMUNICA.join(",") };
      }
    } catch (e) { /* resta la versione troncata già mostrata: il profilo vero in quel caso non si salva */ }
  }
}
let schedaProfilo = null;   // i valori del profilo vero come sono stati letti, per sapere se sono cambiati
function dipendenzeDi(k) {
  const nodi = lav().nodi, suoi = new Set(nodi.filter((n) => n.agente === k).map((n) => n.id));
  const out = new Map();
  for (const f of lav().fili) if (suoi.has(f.da)) {
    const n = nodi.find((x) => x.id === f.a);
    if (n) out.set(n.agente || n.id, n);
  }
  return [...out.values()];
}
function disegnaDipendenzeScheda() {
  const box = $("sa-dipende");
  const dip = dipendenzeDi(schedaKey);
  if (!dip.length) { box.replaceChildren(el("small", { class: "nota" }, t("Nessuna. In lavagna tira il pallino di questa scheda su un'altra."))); return; }
  box.replaceChildren(...dip.map((n) => {
    const a = AGENTI.get(n.agente);
    return el("span", { class: "chip" }, a ? nomeDi(a) : (n.testo || t("nota")).slice(0, 24),
      el("button", { type: "button", title: t("Togli la dipendenza"), onclick: () => {
        const suoi = new Set(lav().nodi.filter((x) => x.agente === schedaKey).map((x) => x.id));
        lav().fili = lav().fili.filter((f) => !(suoi.has(f.da) && f.a === n.id));
        salvaPannello(); disegnaLavagna(); disegnaDipendenzeScheda();
      } }, "✕"));
  }));
}
$("form-scheda").addEventListener("submit", async (ev) => {
  if (ev.submitter && ev.submitter.value !== "salva") return;
  const a = AGENTI.get(schedaKey);
  if (!a) return;
  PAN.aspetto[schedaKey] = { emoji: $("sa-emoji").value.trim().slice(0, 8), colore: $("sa-colore").value,
    nome: $("sa-alias").value.trim().slice(0, 60), nota: $("sa-nota").value.trim().slice(0, 400) };
  const gid = $("sa-gruppo").value;
  const ora = gruppiEffettivi().find((g) => g.agenti.includes(schedaKey));
  if (!ora || ora.id !== gid) spostaAgente(schedaKey, gid, null); else salvaPannello();
  disegnaGruppi(); disegnaLavagna(); aggiornaTestaChat();
  // il profilo vero: solo se qualcosa nella scheda di Claude Code è cambiato davvero
  const descr = $("sa-vdescr").value.trim(), modello = $("sa-vmodello").value, strumenti = $("sa-vstrumenti").value.trim();
  const tono = $("sa-vtono").value.trim(), umorismo = +$("sa-vumor").value;
  const base = schedaProfilo && schedaProfilo.k === schedaKey ? schedaProfilo : null;
  // «comunica con» ha la sua strada, quella dei fili della lavagna (/api/agente-comunica)
  if (a.file && base && SA_COMUNICA.join(",") !== base.comunica) {
    try { await api("/api/agente-comunica", { file: a.file, comunica: SA_COMUNICA }); base.comunica = SA_COMUNICA.join(","); a.comunica = [...SA_COMUNICA]; }
    catch (e) { toast(t("«Comunica con» non salvato: {errore}", { errore: e.message }), true); }
  }
  if (a.file && base && a.nuovo && (tono !== base.tono || umorismo !== base.umorismo)) {
    try { await api("/api/agente-profilo", Object.assign({ file: a.file }, tono !== base.tono ? { tono } : {}, umorismo !== base.umorismo ? { umorismo } : {}));
      base.tono = tono; base.umorismo = umorismo; a.tono = tono; a.umorismo = umorismo; }
    catch (e) { toast(t("Tono e umorismo non salvati: {errore}", { errore: e.message }), true); }
  }
  if (a.file && !base) {
    toast(t("Aspetto salvato; il profilo vero non l'ho toccato perché non sono riuscito a leggerlo"), true);
  } else if (a.file && (descr !== base.descr || modello !== base.modello || strumenti !== base.strumenti)) {
    // si mandano solo i campi cambiati: il server riscrive solo quelle righe del frontmatter
    const corpo = { file: a.file };
    if (descr !== base.descr) corpo.description = descr;
    if (modello !== base.modello) corpo.model = modello;
    if (strumenti !== base.strumenti) corpo.tools = strumenti;
    try {
      await api("/api/agente-profilo", corpo);
      if (descr !== base.descr) a.descrizione = descr.split(". ")[0].slice(0, 160);
      if (modello !== base.modello) a.modello = modello;
      if (strumenti !== base.strumenti) a.strumenti = strumenti.split(",").map((x) => x.trim()).filter(Boolean);
      schedaProfilo = { k: schedaKey, descr, modello, strumenti };
      toast(t("Salvato: aspetto e profilo di Claude Code"));
    } catch (e) { toast(t("Aspetto salvato, ma il profilo vero no: {errore}", { errore: e.message }), true); return; }
  } else toast(t("Salvato"));
});
$("sa-chiedi").addEventListener("click", () => { $("scheda-agente").close(); apriChat(schedaKey); });
// ---- scheda agente: attivo (interruttore che scorre), «comunica con» a chip, togli (archivia)
let SA_COMUNICA = [];
function disegnaAttivoScheda(acceso) {
  const b = $("sa-attivo");
  b.classList.toggle("on", !!acceso);
  b.setAttribute("aria-pressed", String(!!acceso));
  $("sa-attivo-t").textContent = acceso ? t("lavora nelle missioni") : t("spento: le missioni non lo lanciano");
  $("scheda-agente").classList.toggle("spento", !acceso);
}
$("sa-attivo").addEventListener("click", async (ev) => {
  const a = AGENTI.get(schedaKey);
  if (!a) return;
  const valore = !ev.currentTarget.classList.contains("on");
  disegnaAttivoScheda(valore);                                   // l'interruttore scorre subito
  const d = await azione({ tipo: "agente", cosa: "attivo", progetto: a.progetto, nome: a.nome, valore }, ev.currentTarget);
  if (!d) { disegnaAttivoScheda(!valore); return; }
  a.attivo = valore;
  disegnaGruppi(); disegnaLavagna();
});
$("sa-vumor").addEventListener("input", (ev) => { $("sa-vumor-t").textContent = UMORISMO[+ev.target.value]; });
function disegnaComunicaScheda() {
  const box = $("sa-comunica");
  box.replaceChildren(...(SA_COMUNICA.length ? SA_COMUNICA.map((nome, i) => el("span", { class: "chip" }, nome,
    el("button", { type: "button", title: t("Togli"), onclick: () => { SA_COMUNICA.splice(i, 1); disegnaComunicaScheda(); } }, "✕")))
    : [el("small", { class: "nota" }, t("Nessuno. Aggiungilo qui sotto o tira un filo in lavagna."))]));
}
$("sa-comunica-aggiungi").addEventListener("click", () => {
  const nome = $("sa-comunica-nuovo").value.trim();
  if (nome && !SA_COMUNICA.includes(nome)) SA_COMUNICA.push(nome);
  $("sa-comunica-nuovo").value = "";
  disegnaComunicaScheda();
});
$("sa-sotto").addEventListener("click", () => {
  const a = AGENTI.get(schedaKey);
  if (!a) return;
  $("scheda-agente").close();
  apriNuovoAgente(a.spazio, a.progetto, a.nome);
});
$("sa-togli-gruppo").addEventListener("click", async (ev) => togliGruppo(AGENTI.get(schedaKey), ev.currentTarget));
async function togliGruppo(a, bottone) {
  if (!a || !confirm(t("Togliere il gruppo {progetto}?", { progetto: a.progettoNome }) + "\n\n" + t("Gli agenti del progetto vanno in un archivio dentro il progetto e il progetto esce dagli spazi. La cartella del progetto e la sua memoria restano dove sono."))) return;
  const d = await azione({ tipo: "agente", cosa: "togli_gruppo", progetto: a.progetto }, bottone);
  if (d) { if ($("scheda-agente").open) $("scheda-agente").close(); caricaSpazi(); }
}
$("sa-togli").addEventListener("click", async (ev) => {
  const a = AGENTI.get(schedaKey);
  if (!a || !confirm(t("Togliere {nome} da {progetto}?", { nome: nomeDi(a), progetto: a.progettoNome }) + "\n\n" + t("Il profilo va in .claude/agents/_archivio (non si cancella) ed esce dai «Comunica con» degli altri. Si ripristina dalla colonna di sinistra."))) return;
  const d = await azione({ tipo: "agente", cosa: "togli", progetto: a.progetto, nome: a.nome }, ev.currentTarget);
  if (d) { $("scheda-agente").close(); caricaSpazi(); }
});

// ---- «Aggiorna agenti → Jarvis» (richiesta di Boss, 26/09/2026): la mappa degli agenti la tiene
// Jarvis, non la pagina. La pagina gli manda quello che vede: spazi, progetti e agenti veri
// (da /api/catalogo), i fili della lavagna aperta e, dalla scheda, l'agente scelto.
function datiAgenti(k) {
  const nome = (n) => (n ? (n.tipo === "nota" ? "«" + (n.testo || "nota").slice(0, 30) + "»" : (n.agente || "").split(":").pop()) : "?");
  const a = k && AGENTI.get(k);
  return {
    spazi: (spaziCat || []).map((s) => ({ spazio: s.nome, progetti: s.progetti.map((p) => ({ progetto: p.nome, cartella: p.cartella,
      agenti: p.agenti.map((x) => (x.capogruppo ? "★" : "") + x.nome) })) })),
    lavagna: lavagnaTitolo || lavagnaAttiva,
    fili: lav().fili.map((f) => nome(nodoDi(f.da)) + " → " + nome(nodoDi(f.a))),
    agente: a ? { nome: a.nome, progetto: a.progettoNome, spazio: a.spazioNome, modello: a.modello, capogruppo: !!a.capogruppo,
      file: a.file, collegati: chiaviCollegate(k).map((x) => x.split(":").pop()) } : null,
  };
}
// ================================================ la lavagna come motore degli agenti
// Fonte di verità è il file di profilo di ogni agente; la lavagna è solo la disposizione. Col server
// vecchio (profili senza «attivo») tono, umorismo, attivo, crea, togli e allineamento restano spenti.
const UMORISMO = [t("nessuno"), t("misurato"), t("vivace"), t("sfacciato")];
const profiliNuovi = () => [...AGENTI.values()].some((a) => a.nuovo);
function archiviatiDi(spazioId) {
  const s = (spaziCat || []).find((x) => x.id === spazioId);
  if (!s) return [];
  return s.progetti.flatMap((p) => (p.archiviati || []).map((x) => ({ nome: typeof x === "string" ? x : x.nome, progetto: p.id, progettoNome: p.nome })))
    .filter((x) => x.nome);
}
// la chiave «spazi» del flusso (un profilo è cambiato): si rilegge /api/spazi e si ridisegna, le posizioni restano
let spaziInCorso = false;
async function caricaSpazi() {
  if (spaziInCorso) return;
  spaziInCorso = true;
  try {
    const d = await api("/api/spazi");
    disegnaSpazi(d.spazi || []);
    disegnaGruppiArchiviati(d.gruppi_archiviati);
    pulisciSchedeOrfane();
    disegnaLavagna();
    posaNuovoAgente();
    posaNuovoGruppo();
    caricaModifiche();
    aggiornaAllineamento();
  } catch (e) { /* il giro dopo riprova */ }
  finally { spaziInCorso = false; }
}
// Un agente tolto (archiviato) o sparito dai profili esce da TUTTE le lavagne, e con lui i suoi fili
// da sole. Prima la scheda restava
// nei dati, nascosta, e i fili puntavano a una scheda invisibile. Prudenza: se il catalogo arriva
// monco (meno di 10 agenti, o sparirebbe più di metà di una lavagna) non si tocca niente.
function pulisciSchedeOrfane() {
  if (AGENTI.size < 10 || !PAN || !PAN.lavagne) return;
  let tolti = 0;
  for (const [id, L] of Object.entries(PAN.lavagne)) {
    if (eDemo(id) || !L || !L.nodi) continue;
    const agenti = L.nodi.filter((n) => n.tipo === "agente");
    const via = new Set(agenti.filter((n) => !AGENTI.has(n.agente)).map((n) => n.id));
    const ids = new Set(L.nodi.map((n) => n.id));
    const filiRotti = (L.fili || []).filter((f) => !ids.has(f.da) || !ids.has(f.a) || via.has(f.da) || via.has(f.a) || f.da === f.a);
    if (via.size > Math.max(3, agenti.length / 2)) continue;
    if (!via.size && !filiRotti.length) continue;
    L.nodi = L.nodi.filter((n) => !via.has(n.id));
    L.fili = (L.fili || []).filter((f) => !filiRotti.includes(f));
    tolti += via.size + filiRotti.length;
  }
  if (tolti) { if (LAV.sel && !nodoDi(LAV.sel)) LAV.sel = null; LAV.selFilo = null; salvaPannello(); }
}
// ---- nuovo agente: modulo, poi la scheda nasce sulla lavagna sotto il suo capogruppo
let NASCITA = null;
function apriNuovoAgente(spazioId, progettoId, capoNome) {
  if (!profiliNuovi()) { toast(t("Creare agenti dal pannello arriva col server nuovo"), true); return; }
  const sel = $("na-progetto");
  sel.replaceChildren(...(spaziCat || []).map((s) => el("optgroup", { label: s.nome },
    ...s.progetti.filter((p) => p.esiste).map((p) => el("option", { value: p.id }, p.nome)))));
  const sp = (spaziCat || []).find((s) => s.id === spazioId);
  if (sp && sp.progetti[0]) sel.value = sp.progetti[0].id;
  if (progettoId) sel.value = progettoId;
  riempiCapi();
  if (capoNome) $("na-capo").value = capoNome;
  $("na-nome").value = ""; $("na-descr").value = ""; $("na-tono").value = ""; $("na-umor").value = 1; $("na-umor-t").textContent = UMORISMO[1];
  $("na-nota").textContent = "";
  $("nuovo-agente").showModal();
}
function riempiCapi() {
  const p = $("na-progetto").value;
  const agenti = [...AGENTI.values()].filter((a) => a.progetto === p);
  $("na-capo").replaceChildren(el("option", { value: "" }, t("nessuno")), ...agenti.map((a) => el("option", { value: a.nome }, nomeDi(a))));
  const capo = agenti.find((a) => a.capogruppo);
  $("na-capo").value = capo ? capo.nome : "";
}
$("na-progetto").addEventListener("change", riempiCapi);
$("na-umor").addEventListener("input", (ev) => { $("na-umor-t").textContent = UMORISMO[+ev.target.value]; });
$("lav-nuovo-agente").addEventListener("click", () => apriNuovoAgente(null));
// ---- nuovo gruppo (punto 14): progetto, cartella, memoria e capogruppo; nasce una colonna nuova nella piramide
let NASCITA_GRUPPO = null, idToccato = false;
const inKebab = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
// La cartella si può scegliere fra quelle già presenti nella cartella dei progetti dello spazio, non
// solo nascerne sempre una nuova dal nome. L'elenco dipende dallo spazio scelto.
async function aggiornaCartelleGruppo() {
  const sel = $("ng-cartella");
  sel.replaceChildren(el("option", { value: "" }, t("nuova, dal nome qui sopra")));
  $("ng-cartella-nota").textContent = "";
  const spazio = $("ng-spazio").value;
  if (!spazio) return;
  try {
    const r = await fetch("/api/cartelle-progetto?spazio=" + encodeURIComponent(spazio), { headers: HDR });
    const d = await r.json();
    for (const c of d.cartelle || []) sel.append(el("option", { value: c.nome }, c.nome + (c.usata_da ? " (" + t("già di {nome}", { nome: c.usata_da }) + ")" : "")));
  } catch (e) { /* elenco vuoto: resta solo «nuova» */ }
}
$("ng-cartella").addEventListener("change", () => {
  const scelta = [...$("ng-cartella").options].find((o) => o.value === $("ng-cartella").value);
  $("ng-cartella-nota").textContent = $("ng-cartella").value ? t("Il capogruppo nasce dentro questa cartella già esistente.") : "";
});
$("lav-nuovo-progetto").addEventListener("click", () => {
  if (!profiliNuovi()) { toast(t("Creare gruppi dal pannello arriva col server nuovo"), true); return; }
  $("ng-spazio").replaceChildren(...(spaziCat || []).map((s) => el("option", { value: s.id }, s.nome)));
  for (const id of ["ng-nome", "ng-id", "ng-capo", "ng-descr", "ng-tono"]) $(id).value = "";
  $("ng-umor").value = 1; $("ng-umor-t").textContent = UMORISMO[1]; $("ng-nota").textContent = ""; idToccato = false;
  aggiornaCartelleGruppo();
  $("nuovo-gruppo").showModal();
});
$("ng-spazio").addEventListener("change", aggiornaCartelleGruppo);
$("ng-nome").addEventListener("input", () => { if (!idToccato) $("ng-id").value = inKebab($("ng-nome").value); $("ng-capo").placeholder = "ceo-" + ($("ng-id").value || "…"); });
$("ng-id").addEventListener("input", () => { idToccato = true; $("ng-capo").placeholder = "ceo-" + ($("ng-id").value || "…"); });
$("ng-umor").addEventListener("input", (ev) => { $("ng-umor-t").textContent = UMORISMO[+ev.target.value]; });
$("form-nuovo-gruppo").addEventListener("submit", async (ev) => {
  if (!ev.submitter || ev.submitter.value !== "crea") return;
  ev.preventDefault();
  const id = $("ng-id").value.trim(), capo = $("ng-capo").value.trim() || "ceo-" + id;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(capo)) { $("ng-nota").textContent = t("Id e capogruppo in minuscolo, con i trattini: eventi-privati, ceo-eventi-privati"); return; }
  if ((spaziCat || []).some((s) => s.progetti.some((p) => p.id === id))) { $("ng-nota").textContent = t("Questo id è già di un altro progetto"); return; }
  const d = await azione({ tipo: "agente", cosa: "crea_gruppo", spazio: $("ng-spazio").value, nome: $("ng-nome").value.trim(), id, capogruppo: capo,
    cartella_esistente: $("ng-cartella").value,
    description: $("ng-descr").value.trim(), model: $("ng-modello").value, tono: $("ng-tono").value.trim(), umorismo: +$("ng-umor").value }, ev.submitter);
  if (!d) return;
  NASCITA_GRUPPO = { id, capo: `${id}:${capo}`, nome: $("ng-nome").value.trim() };
  $("nuovo-gruppo").close();
  caricaSpazi();
});
function posaNuovoGruppo() {
  const g = NASCITA_GRUPPO;
  if (!g || !(spaziCat || []).some((s) => s.progetti.some((p) => p.id === g.id))) return;
  NASCITA_GRUPPO = null;
  // in colonna: il gruppo del suo spazio si apre e la riga del progetto nasce
  const spazio = (spaziCat || []).find((s) => s.progetti.some((p) => p.id === g.id));
  const gr = document.querySelector(`.gruppo[data-gruppo="spazio-${CSS.escape(spazio.id)}"]`);
  if (gr && gr.classList.contains("chiuso")) gr.querySelector(".gruppo-testa").click();
  if (!eDemo(lavagnaAttiva) && lavagnaAttiva === "generale") popolaCatenaCompleta().then(() => {});
  animaNascita([g.capo], [g.nome + " · " + SENZA_CAPO]);
  setTimeout(() => { const sp = document.querySelector(`.sotto-progetto[data-progetto="${CSS.escape(g.id)}"]`); if (sp) { sp.classList.add("nasce-riga"); setTimeout(() => sp.classList.remove("nasce-riga"), 1600); } }, 200);
  toast(t("Gruppo {nome} nato: cartella, memoria e capogruppo pronti", { nome: g.nome }));
}
$("form-nuovo-agente").addEventListener("submit", async (ev) => {
  if (!ev.submitter || ev.submitter.value !== "crea") return;
  ev.preventDefault();
  const nome = $("na-nome").value.trim().toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(nome)) { $("na-nota").textContent = t("Il nome va scritto in minuscolo, con i trattini: analista-vendite"); return; }
  const progetto = $("na-progetto").value, capogruppo = $("na-capo").value;
  const d = await azione({ tipo: "agente", cosa: "crea", progetto, nome, description: $("na-descr").value.trim(), model: $("na-modello").value,
    tools: "", tono: $("na-tono").value.trim(), umorismo: +$("na-umor").value, capogruppo }, ev.submitter);
  if (!d) return;
  NASCITA = { key: `${progetto}:${nome}`, capo: capogruppo ? `${progetto}:${capogruppo}` : null };
  $("nuovo-agente").close();
  caricaSpazi();
});
function animaNascita(chiavi, note) {
  setTimeout(() => {
    for (const k of chiavi) for (const d of document.querySelectorAll(`[data-agente="${CSS.escape(k)}"]`)) { d.classList.add("nasce"); setTimeout(() => d.classList.remove("nasce"), 1400); }
    for (const t of note || []) for (const d of document.querySelectorAll("#lav-mondo .nodo.nota")) if (d.textContent.trim() === t) { d.classList.add("nasce"); setTimeout(() => d.classList.remove("nasce"), 1400); }
  }, 150);
}
function posaNuovoAgente() {
  if (!NASCITA || !AGENTI.has(NASCITA.key) || eDemo(lavagnaAttiva)) return;
  if (lavagnaAttiva === "generale") {                       // la catena intera: la piramide si ridisegna coi livelli giusti
    const k = NASCITA.key; NASCITA = null;
    popolaCatenaCompleta().then(() => {}); animaNascita([k]);
    toast(t("{nome} è nato: profilo scritto e collegato a chi riporta", { nome: nomeDi(AGENTI.get(k)) }));
    return;
  }
  const L = lav();
  let n = L.nodi.find((z) => z.agente === NASCITA.key);
  if (!n) {
    const capo = NASCITA.capo && L.nodi.find((z) => z.agente === NASCITA.capo);
    // sotto il capogruppo, dopo l'ultima scheda della sua colonna
    // sotto un capogruppo: in fondo alla sua colonna; sotto uno specialista: rientrato, subito sotto di lui
    const padreSpecialista = capo && !(AGENTI.get(capo.agente) || {}).capogruppo;
    const x = capo ? capo.x + (padreSpecialista ? 16 : 0) : 40, sotto = capo ? L.nodi.filter((z) => Math.abs(z.x - x) < 10 && z.y > capo.y) : [];
    const y = capo ? Math.max(capo.y + (padreSpecialista ? 70 : 100), ...sotto.map((z) => z.y + 70)) : 40;
    n = { id: "n" + Date.now().toString(36), tipo: "agente", agente: NASCITA.key, x, y };
    L.nodi.push(n);
    if (capo) L.fili.push({ da: capo.id, a: n.id });
    salvaPannello();
    disegnaLavagna();
  }
  const d = document.querySelector(`#lav-mondo .nodo[data-id="${CSS.escape(n.id)}"]`);
  if (d) { d.classList.add("nasce"); setTimeout(() => d.classList.remove("nasce"), 1200); }
  toast(t("{nome} è nato: profilo scritto e collegato al capogruppo", { nome: nomeDi(AGENTI.get(NASCITA.key)) }));
  NASCITA = null;
}
// ---- allineamento fra i fili della lavagna e i «Comunica con» dei profili
const ALLINEA = { differenze: [], assente: false, timer: null };
function aggiornaAllineamento() {
  clearTimeout(ALLINEA.timer);
  ALLINEA.timer = setTimeout(async () => {
    const b = $("lav-allineamento");
    if (eDemo(lavagnaAttiva)) { b.textContent = t("Profili: dimostrazione"); b.disabled = true; b.className = "piccolo"; return; }
    try {
      const r = await fetch("/api/agenti/allineamento?lavagna=" + encodeURIComponent(lavagnaAttiva), { headers: HDR });
      if (r.status === 404) { ALLINEA.assente = true; b.textContent = t("Profili: arriva col server nuovo"); b.disabled = true; b.className = "piccolo"; return; }
      if (!r.ok) return;
      const d = await r.json();
      ALLINEA.differenze = d.differenze || [];
      const n = ALLINEA.differenze.length;
      b.disabled = false;
      b.textContent = n ? t("Profili: {n} differenze", { n }) : t("Profili: allineati");
      b.className = "piccolo " + (n ? "allinea-no" : "allinea-ok");
    } catch (e) { /* riprova al prossimo cambio */ }
  }, 400);
}
$("lav-allineamento").addEventListener("click", () => {
  const nomi = { "filo-senza-profilo": t("sulla lavagna, non nei profili"), "profilo-senza-filo": t("nei profili, non sulla lavagna") };
  $("al-lista").replaceChildren(...(ALLINEA.differenze.length ? ALLINEA.differenze.map((x) => el("li", {},
    el("b", { class: "cn-tipo" }, x.tipo === "filo-senza-profilo" ? t("LAVAGNA") : t("PROFILO")),
    el("span", {}, `${nomeChiave(x.da)} → ${nomeChiave(x.a)} · ${nomi[x.tipo] || x.tipo}`))) : [el("li", { class: "vuoto" }, t("nessuna differenza"))]));
  $("allineamento").showModal();
});
for (const [id, verso] of [["al-profili", "profili"], ["al-lavagna", "lavagna"]]) $(id).addEventListener("click", async (ev) => {
  const d = await azione({ tipo: "agente", cosa: "allinea", lavagna: lavagnaAttiva, verso }, ev.currentTarget);
  if (!d) return;
  $("allineamento").close();
  if (verso === "lavagna") await caricaPannello(); else caricaSpazi();
  aggiornaAllineamento();
});
// ---- «Aggiorna ultime modifiche»: le modifiche fatte da lavagna e
// scheda dopo l'ultimo aggiornamento aspettano una verifica; la missione lavora solo sugli agenti coinvolti.
const MODIFICHE = { pendenti: [], coinvolti: [], assente: false, inCorso: false };
async function caricaModifiche() {
  if (MODIFICHE.inCorso || MODIFICHE.assente) return;
  MODIFICHE.inCorso = true;
  try {
    const r = await fetch("/api/agenti/modifiche", { headers: HDR });
    if (r.status === 404) { MODIFICHE.assente = true; disegnaModifiche(); return; }
    if (!r.ok) return;
    const d = await r.json();
    MODIFICHE.pendenti = d.pendenti || [];
    MODIFICHE.coinvolti = d.agenti_coinvolti || [];
    disegnaModifiche();
  } catch (e) { /* riprova al prossimo avviso del flusso */ }
  finally { MODIFICHE.inCorso = false; }
}
function disegnaModifiche() {
  const n = MODIFICHE.pendenti.length, b = $("lav-aggiorna-ultime");
  $("lav-n-mod").textContent = n;
  b.disabled = MODIFICHE.assente || !n || !!CATENA_GIRO;
  b.title = MODIFICHE.assente ? t("Arriva col server nuovo") : n ? t("Una missione sui {a} agenti toccati da {n} modifiche", { a: MODIFICHE.coinvolti.length, n }) : t("Nessuna modifica da verificare");
  const badge = $("lav-mod-badge");
  badge.classList.toggle("nascosto", MODIFICHE.assente || !n || eDemo(lavagnaAttiva));
  badge.textContent = n === 1 ? t("1 modifica non ancora aggiornata") : t("{n} modifiche non ancora aggiornate", { n });
  $("mod-nota").textContent = MODIFICHE.assente ? t("arriva col server nuovo") : n ? "" : t("nessuna");
  $("mod-lista").replaceChildren(...MODIFICHE.pendenti.slice().reverse().map((m) => el("li", {},
    el("time", {}, oraDi(m.ts)),
    el("b", {}, `${m.tipo || "?"} · ${nomeChiave(m.progetto && m.agente ? m.progetto + ":" + m.agente : m.agente || m.progetto)}`),
    el("span", {}, (m.con || []).length ? t("con") + " " + m.con.map((x) => nomeChiave(String(x).includes(":") || !m.progetto ? x : m.progetto + ":" + x)).join(", ") : ""),
    el("small", {}, m.da || ""))));
}
$("lav-aggiorna-ultime").addEventListener("click", async (ev) => {
  const prima = new Map([...AGENTI.values()].map((a) => [a.key, a.aggiornato_ts]));
  const coinvolti = MODIFICHE.coinvolti.map((k) => (agenteDaChiave(k) || {}).key).filter(Boolean);
  const d = await azione({ tipo: "agente", cosa: "aggiorna_catena", ambito: "ultime", spazio: "tutti" }, ev.currentTarget);
  if (!d) return;
  CATENA_GIRO = { missione: d.missione || (d.lavoro && d.lavoro.id) || null, da: Date.now() / 1000, prima, quanti: coinvolti.length || MODIFICHE.coinvolti.length, coinvolti };
  contaCatenaGiro(); disegnaModifiche();
  if (ultimoStato) aggiornaAttivita(ultimoStato);           // le schede coinvolte si accendono subito
});

// ---- aggiorna catena: la missione dei capigruppo; contatore e, alla fine, le schede cambiate lampeggiano
let CATENA_GIRO = null;
function contaCatenaGiro() {
  const n = $("lav-catena-conta");
  if (!CATENA_GIRO) { n.textContent = ""; return; }
  // verificato = un agente che ha già risposto nella missione (comunicazioni «risposta» finite)
  const visti = new Set();
  for (const c of SINAPSI.lista) if ((c.ts || 0) >= CATENA_GIRO.da && c.stato === "finito") { const a = agenteDaChiave(c.da); if (a) visti.add(a.key); }
  n.textContent = t("{n} agenti verificati / {totale}", { n: visti.size, totale: CATENA_GIRO.quanti });
}
function seguiCatenaGiro(s) {
  if (!CATENA_GIRO) return;
  contaCatenaGiro();
  const m = CATENA_GIRO.missione && (s.missioni || []).find((x) => x.id === CATENA_GIRO.missione);
  const finita = m ? ["chiusa", "interrotta", "errore"].includes(m.stato) : Date.now() / 1000 - CATENA_GIRO.da > 1800;
  if (!finita) return;
  const giro = CATENA_GIRO;
  CATENA_GIRO = null;
  api("/api/spazi").then((d) => {
    disegnaSpazi(d.spazi || []);
    disegnaLavagna();
    const cambiati = [...AGENTI.values()].filter((a) => a.aggiornato_ts && a.aggiornato_ts !== giro.prima.get(a.key));
    for (const a of cambiati) for (const x of document.querySelectorAll(`[data-agente="${CSS.escape(a.key)}"]`)) {
      x.classList.add("lampeggia"); setTimeout(() => x.classList.remove("lampeggia"), 1600);
    }
    // il riepilogo è la risalita jarvis → utente della missione, se c'è («boss» è la chiave interna delle sinapsi)
    const riepilogo = SINAPSI.lista.find((c) => (c.ts || 0) >= giro.da && String(c.da).toLowerCase() === "jarvis" && String(c.a).toLowerCase() === "boss");
    toast(riepilogo ? riepilogo.testo : t("Aggiornamento della catena finito: {n} profili cambiati", { n: cambiati.length }));
    caricaModifiche();
    if (ultimoStato) aggiornaAttivita(ultimoStato);
    $("lav-catena-conta").textContent = t("finito · {n} profili cambiati", { n: cambiati.length });
    if ($("scheda-agente").open && schedaKey) apriScheda(schedaKey);
  }).catch(() => {});
}

// ---- dimostrazione: la squadra finta, fatta solo di note (nessun profilo vero si tocca) ----
const DEMO = { id: "demo-squadra", titolo: t("Squadra dimostrativa"),
  colori: { jarvis: "#599ce7", claude: "#9386f2", codex: "#9386f2", gemini: "#9386f2", cursor: "#9386f2", sceglie: "#9386f2",
    capogruppo: "#3fa266", analista: "#3fa266", ricercatore: "#3fa266", programmatore: "#3fa266", revisore: "#3fa266",
    verificatore: "#3fa266", redattore: "#3fa266", report: "#e5b454" } };
const DEMO_SQUADRA = ["analista", "ricercatore", "programmatore", "revisore", "verificatore"];
const NOME_DEMO = { analista: t("analista"), ricercatore: t("ricercatore"), programmatore: t("programmatore"),
  revisore: t("revisore"), verificatore: t("verificatore") };
function disegnaModoDemo() {
  document.body.classList.toggle("lav-demo", lavDemo);
  $("lav-demo").setAttribute("aria-pressed", String(lavDemo));
  $("lav-demo").classList.toggle("attivo", lavDemo);
}
$("lav-demo").addEventListener("click", async () => {
  lavDemo = !lavDemo;
  mem.scrivi("lavDemo", lavDemo);
  disegnaModoDemo();
  // uscendo si butta quello che la dimostrazione ha cambiato solo in pagina
  if (!lavDemo) { if (eDemo(lavagnaAttiva)) vaiALavagna("generale", ""); await caricaPannello(); }
  toast(lavDemo ? t("Dimostrazione: la lavagna non manda niente fuori dalla pagina") : t("Dimostrazione spenta: lavagna di nuovo vera"));
});
function costruisciSquadraDemo() {
  vaiALavagna(DEMO.id, DEMO.titolo);
  const L = lav();
  L.nodi = []; L.fili = [];
  const LARG = 212, centro = 5 * LARG / 2;          // la riga più larga ha 5 schede
  const nota = (id, testo, x, y) => L.nodi.push({ id: "demo-" + id, tipo: "nota", testo, x: Math.round(x), y: Math.round(y) });
  const filo = (a, b) => L.fili.push({ da: "demo-" + a, a: "demo-" + b });
  const riga = (ids, y) => ids.forEach(([id, testo], i) => nota(id, testo, centro - ids.length * LARG / 2 + i * LARG + 10, y));
  nota("umano", t("Umano ({utente})", { utente: UTENTE }), centro - 96, 0);
  nota("jarvis", "Jarvis · harness", centro - 140, 110);
  nota("sceglie", t("sceglie il migliore per il compito"), centro + 170, 122);
  riga([["claude", "Claude Code"], ["codex", "Codex"], ["gemini", "Gemini"], ["cursor", "Cursor"]], 250);
  nota("capogruppo", t("capogruppo"), centro - 96, 390);
  riga(DEMO_SQUADRA.map((x) => [x, NOME_DEMO[x]]), 530);
  nota("redattore", t("redattore del report"), centro - 96, 670);
  nota("report", t("Report finale → Jarvis → Umano"), centro - 96, 800);
  filo("umano", "jarvis");
  for (const m of ["claude", "codex", "gemini", "cursor"]) filo("jarvis", m);
  filo("claude", "capogruppo");
  for (const x of DEMO_SQUADRA) filo("capogruppo", x);
  filo("capogruppo", "redattore");
  filo("verificatore", "revisore");
  for (const x of DEMO_SQUADRA) filo(x, "redattore");
  filo("redattore", "report");
  filo("report", "jarvis");
  filo("jarvis", "umano");
  LAV.sel = null; LAV.selFilo = null;
  salvaPannello();
  location.hash = "#lavagna";
  requestAnimationFrame(() => { disegnaLavagna(); centraLavagna(); });
}
$("lav-demo-squadra").addEventListener("click", costruisciSquadraDemo);
// «Fai partire la dimostrazione»: si accendono in fila, ogni 900 ms, chi lavora e i fili che portano
// a lui; alla fine la risposta risale fino all'Umano e si spegne tutto. Serve a registrare la GIF.
let demoInCorso = false;
async function faiPartireDemo() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { toast(t("Animazione spenta: il sistema chiede meno movimento"), true); return; }
  if (demoInCorso) return;
  if (lavagnaAttiva !== DEMO.id || !lav().nodi.some((n) => n.id === "demo-umano")) { costruisciSquadraDemo(); await new Promise((r) => setTimeout(r, 400)); }
  demoInCorso = true;
  $("lav-demo-via").disabled = true;
  const accesi = new Set();
  const pausa = () => new Promise((r) => setTimeout(r, 900));
  const accendi = (ids) => {
    for (const id of ids) {
      const nodo = document.querySelector(`.nodo[data-id="demo-${id}"]`);
      if (nodo) nodo.classList.add("al-lavoro");
      for (const p of document.querySelectorAll(`#lav-fili path.filo[data-a="demo-${id}"]`))
        if (accesi.has(p.dataset.da.slice(5))) p.classList.add("acceso");
    }
    ids.forEach((id) => accesi.add(id));
  };
  try {
    for (const passo of [["umano"], ["jarvis"], ["claude"], ["capogruppo"], ...DEMO_SQUADRA.map((x) => [x]),
      ["redattore"], ["report"], ["jarvis"], ["umano"]]) { accendi(passo); await pausa(); }
    await pausa();
  } finally {
    document.querySelectorAll(".nodo.al-lavoro").forEach((n) => n.classList.remove("al-lavoro"));
    document.querySelectorAll("#lav-fili path.acceso").forEach((p) => p.classList.remove("acceso"));
    demoInCorso = false;
    $("lav-demo-via").disabled = false;
  }
}
$("lav-demo-via").addEventListener("click", faiPartireDemo);
disegnaModoDemo();

$("lav-aggiorna-agenti").addEventListener("click", async (ev) => {
  // server nuovo: una missione vera (punto 13), con le sinapsi orchestratore → capogruppo → specialisti
  const spazio = $("lav-spazio-catena").value;
  if (profiliNuovi()) {
    const prima = new Map([...AGENTI.values()].map((a) => [a.key, a.aggiornato_ts]));
    const d = await azione({ tipo: "agente", cosa: "aggiorna_catena", ambito: "tutti", spazio }, ev.currentTarget);
    if (d) {
      const quanti = [...AGENTI.values()].filter((a) => spazio === "tutti" || a.spazio === spazio).length;
      CATENA_GIRO = { missione: d.missione || (d.missioni && d.missioni[0]) || null, da: Date.now() / 1000, prima, quanti, coinvolti: null };
      contaCatenaGiro();
    }
    return;
  }
  // server vecchio: come prima, una domanda a Jarvis con la mappa degli agenti
  ULTIMO.agenti = datiAgenti(null);
  chiediJarvis(t("Aggiorna la mappa degli agenti: rileggi i profili reali di ogni progetto, verifica che ogni progetto abbia i suoi agenti collegati fra loro e al capogruppo, segnala quelli scollegati o doppi e aggiorna la nota degli agenti nella memoria. Riferisci cosa hai cambiato."), "agenti");
});
$("sa-aggiorna").addEventListener("click", () => {
  const a = AGENTI.get(schedaKey);
  if (!a) return;
  ULTIMO.agenti = datiAgenti(schedaKey);
  $("scheda-agente").close();
  chiediJarvis(t("Aggiorna il profilo e la scheda dell'agente {nome} del progetto {progetto} secondo la lavagna e la memoria; verifica i collegamenti e riferisci.", { nome: a.nome, progetto: a.progettoNome }), "agenti");
});
$("sa-lavagna").addEventListener("click", () => { $("scheda-agente").close(); mettiInLavagna(schedaKey); location.hash = "#lavagna"; });

// ------------------------------------------------ chat al centro
// Un filo per interlocutore («jarvis» o la chiave dell'agente), ognuno con la sua
// sessione di Claude Code: la prima domanda la crea, le altre la riprendono.
const THREADS = mem.leggi("fili", {});
let chatCon = mem.leggi("chatCon", "jarvis");
function filo(k) {
  if (!THREADS[k]) THREADS[k] = { sessione: uuid(), avviata: false, messaggi: [] };
  return THREADS[k];
}
// Le chat stanno nel localStorage del browser, che tiene circa 5 MB in tutto: 56 interlocutori
// per 120 messaggi da fino a 40 KB l'uno ci stanno stretti, e oltre il salvataggio falliva in
// silenzio. Tetto in caratteri: se si supera, si tengono meno messaggi per filo (i più vecchi escono).
const TETTO_FILI = 2500000;
function salvaFili() {
  let per = 120;
  for (const t of Object.values(THREADS)) if (t.messaggi.length > per) t.messaggi = t.messaggi.slice(-per);
  let testo = JSON.stringify(THREADS);
  while (testo.length > TETTO_FILI && per > 4) {
    per = Math.floor(per / 2);
    for (const t of Object.values(THREADS)) if (t.messaggi.length > per) t.messaggi = t.messaggi.slice(-per);
    testo = JSON.stringify(THREADS);
  }
  if (per < 120) console.warn(`Command Center: chat oltre ${TETTO_FILI} caratteri, tengo gli ultimi ${per} messaggi per interlocutore`);
  // l'attesa resta: dopo un ricaricamento la risposta si va a prendere lo stesso
  if (!mem.scrivi("fili", THREADS) && !salvaFili.avvisato) {
    salvaFili.avvisato = true;
    toast(t("Le chat non si salvano più nel browser: spazio pieno. Svuota le conversazioni vecchie."), true);
  }
}
function apriChat(k) {
  chatCon = AGENTI.has(k) ? k : "jarvis";
  mem.scrivi("chatCon", chatCon);
  if (location.hash !== "#chat") location.hash = "#chat";
  chiudiCassetti();
  aggiornaTestaChat();
  disegnaMessaggi();
  document.querySelectorAll(".agente").forEach((r) => r.classList.toggle("scelto", r.dataset.agente === chatCon));
  $("chiedi-testo").focus();
}

// Comando diretto da una sezione qualunque verso la chat di Jarvis: apre la chat
// con Jarvis (mai con un agente scelto per un'altra ragione) e manda subito la
// domanda già pronta, come i «spunti» della chat vuota. Con il box (data-box) la
// domanda porta con sé quello che il box mostrava (contratto, punto 5): Jarvis legge
// i dati e, se serve lavoro su più progetti, lo distribuisce ai capigruppo.
let contestoProssimo = null;
function chiediJarvis(testo, box) {
  if (THREADS.jarvis && THREADS.jarvis.attesa) { toast(t("Jarvis sta già rispondendo, aspetta un attimo"), true); return; }
  apriChat("jarvis");
  $("chiedi-testo").value = testo;
  contestoProssimo = box ? { box, titolo: TITOLI_BOX[box] || box, dati: ULTIMO[box] ?? null } : null;
  invia();
}
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-chiedi]");
  if (b) chiediJarvis(b.dataset.chiedi, b.dataset.box || "");
});

// ---- modo della chat: lavoro o lettura (contratto, punto 4, decisione di Boss del 26/09/2026)
// Il server vecchio non manda modo_chat e risponde sempre in plan mode: allora «lavoro» è spento.
const TESTO_MODO = { lavoro: t("lavora davvero: la guardia blocca l'irreversibile"), lettura: t("legge e riferisce, non cambia niente") };
const NOME_MODO = { lavoro: t("lavoro"), lettura: t("lettura") };
let modoChat = null;
const modoEffettivo = () => modoChat || "lettura";
function disegnaModoChat(m) {
  modoChat = m === "lavoro" || m === "lettura" ? m : null;
  const eff = modoEffettivo(), box = $("modo-chat");
  for (const b of box.querySelectorAll("[data-modo]")) {
    const si = b.dataset.modo === eff;
    b.classList.toggle("attivo", si);
    b.setAttribute("aria-pressed", String(si));
    b.disabled = !modoChat && b.dataset.modo === "lavoro";
    b.title = modoChat ? TESTO_MODO[b.dataset.modo] : t("Il server non conosce ancora il modo: risponde sempre in sola lettura");
  }
  box.dataset.modo = eff;
  $("nota-modo").textContent = TESTO_MODO[eff];
  aggiornaTestaChat();
  if (!THREADS[chatCon] || !THREADS[chatCon].messaggi.length) disegnaMessaggi();   // il benvenuto dice il modo
}
$("modo-chat").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-modo]");
  if (!b || b.classList.contains("attivo")) return;
  const d = await azione({ tipo: "modo_chat", modo: b.dataset.modo }, b);
  if (d && d.modo) { firme.modoChat = undefined; disegnaModoChat(d.modo); }
});

function aggiornaTestaChat() {
  const a = AGENTI.get(chatCon);
  const av = a ? avatar(a) : el("span", { class: "avatar avatar-j", "aria-hidden": "true" }, "J");
  av.id = "chat-avatar";
  av.classList.toggle("al-lavoro", !!(THREADS[chatCon] && THREADS[chatCon].attesa) ||
    (chatCon === "jarvis" ? ATTIVITA.jarvis : ATTIVITA.agenti.has(chatCon)));
  $("chat-avatar").replaceWith(av);
  $("chat-chi").textContent = nomeDi(a);
  $("chat-dove").textContent = (a ? `${progettoDi(a)} · ${a.cartella} · ${a.modello}` : t("la chat principale")) + " · " + NOME_MODO[modoEffettivo()];
  $("chiedi-testo").placeholder = t("Scrivi a {nome}, oppure / per i comandi", { nome: nomeDi(a) });
}

// 🔴 Fino al 26/09/2026 markdown() costruiva una stringa HTML per innerHTML e non scappava le
// virgolette: un link con `"onmouseover="…` diventava un attributo vero, e da lì uno script con
// il token della pagina arrivava al terminale del Mac. Ora la risposta diventa solo nodi DOM:
// testo come testo, link creati con createElement dopo aver controllato che siano http/https.
function linkSicuro(indirizzo) {
  let u;
  try { u = new URL(indirizzo); } catch (e) { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const a = document.createElement("a");
  a.href = u.href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = indirizzo;
  return a;
}
function nodiInLinea(testo, dove) {
  const re = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|(https?:\/\/[^\s<>"'`)]+)/g;
  let i = 0, m;
  while ((m = re.exec(testo))) {
    if (m.index > i) dove.append(testo.slice(i, m.index));
    if (m[1] != null) dove.append(el("code", {}, m[1]));
    else if (m[2] != null) dove.append(el("b", {}, m[2]));
    else {
      const url = m[3].replace(/[.,;:!?]+$/, "");          // la punteggiatura in fondo non fa parte del link
      dove.append(linkSicuro(url) || url);
      re.lastIndex = m.index + url.length;
    }
    i = re.lastIndex;
  }
  if (i < testo.length) dove.append(testo.slice(i));
}
function markdown(testo) {
  const frag = document.createDocumentFragment();
  String(testo || "").split(/```[\w-]*\n?/).forEach((p, i) => {
    if (i % 2) frag.append(el("pre", {}, el("code", {}, p.replace(/\n$/, ""))));
    else nodiInLinea(p, frag);
  });
  return frag;
}

// La bolla «sto scrivendo» (mockup 26/09/2026, idea 5): tre puntini che saltano in fila
// dentro una bolla scura, con una scia di luce che corre sotto. Serve alla chat scritta
// e alla chat a voce della scheda Stato.
function bollaScrive(chi) {
  return el("div", { class: "bolla-scrive", role: "status", "aria-label": t("{chi} sta scrivendo", { chi: chi || "Jarvis" }) },
    el("i"), el("i"), el("i"));
}

function disegnaMessaggi() {
  const box = $("messaggi");
  const fl = filo(chatCon);
  const a = AGENTI.get(chatCon);
  if (!fl.messaggi.length && !fl.attesa) {
    // spunti (26/09/2026): con Jarvis prima le domande frequenti di Boss (catalogo, «frequenti»),
    // poi quelli fissi finché le frequenti sono meno di 5; con un agente restano i suoi tre
    const fissi = a ? [t("A che punto sei?"), t("Cosa ti serve da me?"), t("Quali errori non devo ripetere?")]
      : [t("Cosa c'è da fare oggi?"), t("Riassumi lo stato dei progetti"), t("Chi sta lavorando adesso?")];
    const frequenti = a ? [] : (CAT.frequenti || []).filter((f) => f && f.testo);
    const manda = (testo) => { $("chiedi-testo").value = testo; invia(); };
    const spunti = [
      ...frequenti.map((f) => el("span", { class: "spunto-freq" },
        el("button", { type: "button", title: f.testo, onclick: () => manda(f.testo) },
          f.testo.length > 60 ? f.testo.slice(0, 58) + "…" : f.testo, f.conta ? el("small", {}, " ×" + f.conta) : ""),
        el("button", { type: "button", class: "togli", title: t("Togli dalle frequenti"), "aria-label": t("Togli dalle frequenti"),
          onclick: async (ev) => { const d = await azione({ tipo: "frequenti", cosa: "togli", testo: f.testo }, ev.currentTarget); if (d) catalogo().catch(() => {}); } }, "×"))),
      ...(frequenti.length < 5 ? fissi.map((s) => el("button", { type: "button", onclick: () => manda(s) }, s)) : []),
    ];
    box.replaceChildren(el("div", { class: "benvenuto" },
      el("b", {}, a ? `${aspettoDi(a).emoji} ${nomeDi(a)}` : t("Ciao {utente}, su cosa lavoriamo oggi?", { utente: UTENTE })),
      el("span", {}, a ? notaDi(a) || a.descrizione : t("Scrivi qui: risponde Claude Code, in modo {modo} ({nota}). I comandi con / partono subito.", { modo: NOME_MODO[modoEffettivo()], nota: TESTO_MODO[modoEffettivo()] })),
      el("div", { class: "spunti" }, ...spunti)));
    return;
  }
  box.replaceChildren(...fl.messaggi.map((m, i) => bollaMessaggio(m, i, a)));
  if (fl.attesa) {
    box.append(el("div", { class: "msg" }, a ? avatar(a) : el("span", { class: "avatar", style: "--c:#f0f0f0" }, "J"),
      el("div", { class: "corpo" }, el("div", { class: "chi" }, nomeDi(a) + " · " + t("sta lavorando") + " ",
        el("span", { class: "durata", id: "durata-attesa" }, "")), bollaScrive(nomeDi(a)))));
  }
  box.scrollTop = box.scrollHeight;
}
function bollaMessaggio(m, i, a) {
  const mio = m.chi === "io";
  const testo = el("div", { class: "testo" });
  if (mio || m.tipo === "comando") testo.textContent = m.testo; else testo.replaceChildren(markdown(m.testo));
  const azioni = el("span", { class: "azioni-msg" },
    el("button", { class: "icona", title: t("Copia"), onclick: () => navigator.clipboard.writeText(m.testo).then(() => toast(t("Copiato"))) }, "⧉"),
    mio ? el("button", { class: "icona", title: t("Modifica e rimanda"), onclick: () => { $("chiedi-testo").value = m.testo; autoAltezza(); $("chiedi-testo").focus(); } }, "✎") : "",
    el("button", { class: "icona", title: t("Togli dalla chat"), onclick: () => { filo(chatCon).messaggi.splice(i, 1); salvaFili(); disegnaMessaggi(); } }, "✕"));
  const chi = (mio ? UTENTE : m.tipo === "comando" ? m.titolo || t("comando") : nomeDi(a)) + (m.box ? " · " + t("dal box «{box}»", { box: m.box }) : "");
  return el("div", { class: "msg" + (mio ? " mio" : "") + (m.errore ? " errore" : "") + (m.tipo === "comando" ? " comando" : "") },
    mio ? "" : (m.tipo === "comando" ? el("span", { class: "avatar", style: "--c:#5a5a5a" }, "/") : a ? avatar(a) : el("span", { class: "avatar", style: "--c:#f0f0f0" }, "J")),
    el("div", { class: "corpo" }, el("div", { class: "chi" }, chi + " · " + (m.ora || ""), azioni), testo));
}

const COMANDI = [
  { nome: "memoria", arg: "parole", descr: t("cerca nella memoria") },
  { nome: "brain", arg: "", descr: t("a che punto è il progetto dell'interlocutore") },
  { nome: "lavori", arg: "", descr: t("chi sta lavorando adesso (lavori.py chi)") },
  { nome: "verifica", arg: "", descr: t("quadro di sincronia di tutti i progetti") },
];
const oraBreve = () => new Date().toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });

async function invia() {
  const campo = $("chiedi-testo");
  const testo = campo.value.trim();
  if (!testo) return;
  const k = chatCon, fl = filo(k), a = AGENTI.get(k);
  const ctx = contestoProssimo;          // il box da cui arriva la domanda vale solo per questa
  contestoProssimo = null;
  if (fl.attesa) { toast(t("Aspetta la risposta in corso"), true); return; }
  campo.value = ""; autoAltezza(); nascondiSuggerimenti();
  fl.messaggi.push(Object.assign({ chi: "io", testo, ora: oraBreve() }, ctx ? { box: ctx.titolo } : {}));
  let corpo;
  const cmd = testo.match(/^\/([\w:.-]+)\s*(.*)$/s);
  // «/verifica:<id>» e «/rapido:<id>» scritti a mano valgono come scelti dal menu
  const daMenu = cmd && /^(verifica|rapido):/.test(cmd[1]) && vociMenu("").find((v) => v.id === cmd[1]);
  if (daMenu) { salvaFili(); lanciaDaMenu(daMenu); return; }
  if (cmd) {
    corpo = { tipo: "comando_diretto", nome: cmd[1].toLowerCase(), arg: cmd[2].trim(), progetto: a ? a.progetto : "" };
  } else {
    // le dipendenze disegnate in lavagna viaggiano con la domanda
    const dip = a ? dipendenzeDi(k).map((n) => (AGENTI.get(n.agente) || {}).nome || n.testo).filter(Boolean) : [];
    const contesto = dip.length ? "\n\n" + t("(Sulla lavagna di {utente} dipendi da: {elenco}.)", { utente: UTENTE, elenco: dip.join(", ") }) : "";
    corpo = { tipo: "chiedi", testo: testo + contesto, sessione: fl.sessione, continua: fl.avviata,
      agente: a ? a.nome : "", progetto: a ? a.progetto : "" };
    if (ctx) corpo.contesto = ctx;
  }
  try {
    const d = await api("/api/azione", corpo, 30000);
    fl.attesa = { id: d.lavoro.id, inizio: Date.now(), comando: !!cmd, titolo: cmd ? "/" + cmd[1] : "" };
  } catch (e) {
    fl.messaggi.push({ chi: "lui", testo: e.message, errore: true, ora: oraBreve() });
  }
  salvaFili();
  if (k === chatCon) disegnaMessaggi();
  segnaAttivi();
  aggiornaInvia();
}

// Le risposte arrivano come «lavori» del server: si leggono finché non sono chiusi.
let seguiInCorso = false;
async function seguiRisposte() {
  if (seguiInCorso) return;
  seguiInCorso = true;
  try { await seguiRisposteGiro(); } finally { seguiInCorso = false; }
}
async function seguiRisposteGiro() {
  for (const [k, fl] of Object.entries(THREADS)) {
    if (!fl.attesa) continue;
    try {
      const d = await api("/api/lavoro/" + fl.attesa.id);
      if (d.stato === "in corso") continue;
      const testo = (d.testo || "").replace(/^\(cartella: [^\n]*\)\n\n?/, "").trim() || t("(nessuna risposta)");
      const ok = d.stato === "finito";
      if (!fl.attesa.comando && ok) fl.avviata = true;          // la sessione ora esiste: le prossime la riprendono
      if (!fl.attesa.comando && !ok && !fl.avviata) fl.sessione = uuid();   // sessione mai nata: si riparte pulita
      fl.messaggi.push({ chi: "lui", testo, ora: oraBreve(), errore: !ok, tipo: fl.attesa.comando ? "comando" : "", titolo: fl.attesa.titolo });
      catalogo().catch(() => {});          // le domande frequenti cambiano dopo ogni risposta
      fl.attesa = null;
      salvaFili();
      if (k === chatCon) disegnaMessaggi();
      segnaAttivi();
      aggiornaInvia();
    } catch (e) {
      // il server è ripartito e il lavoro non c'è più
      if (/non trovato/.test(e.message)) { fl.attesa = null; fl.messaggi.push({ chi: "lui", testo: t("Risposta persa: il Command Center è ripartito. Rimanda la domanda."), errore: true, ora: oraBreve() }); salvaFili(); if (k === chatCon) disegnaMessaggi(); aggiornaInvia(); }
    }
  }
  const fl = THREADS[chatCon], dur = $("durata-attesa");
  if (fl && fl.attesa && dur) dur.textContent = Math.round((Date.now() - fl.attesa.inizio) / 1000) + "s";
}

function aggiornaInvia() {
  const attesa = !!(THREADS[chatCon] && THREADS[chatCon].attesa);
  $("btn-invia").disabled = attesa;
  aggiornaSpie();
  if (ultimoStato) aggiornaAttivita(ultimoStato); else segnaAttivi();
}
function autoAltezza() { const c = $("chiedi-testo"); c.style.height = "auto"; c.style.height = Math.min(200, c.scrollHeight) + "px"; }

// Il menu «/» (26/09/2026, richiesta di Boss): tutti i comandi, in gruppi. Diretti (i quattro di
// sempre), skill e comandi di Claude Code (catalogo, «skills»: il server accetta «/nome …»), le
// verifiche («/verifica:<id>», lanciano l'azione verifica) e i comandi rapidi («/rapido:<id>»).
// Si filtra su nome e descrizione con quello che si scrive dopo la barra.
let sugScelto = 0;
let MENU = [];
function vociMenu(q) {
  q = String(q || "").toLowerCase();
  const gruppi = [
    [t("Diretti"), COMANDI.map((c) => ({ id: c.nome, descr: c.descr, arg: !!c.arg, tipo: "diretto" }))],
    [t("Skill e comandi di Claude Code"), (CAT.skills || []).map((s) => ({ id: String(s.id || s.nome || "").replace(/^\//, ""),
      descr: s.descrizione || s.nome || "", etichetta: s.origine || "", arg: true, tipo: "skill" }))],
    [t("Verifiche"), (CAT.verifiche || []).map((v) => ({ id: "verifica:" + v.id, nome: v.nome, rif: v.id,
      descr: v.nome + (v.descrizione ? " · " + v.descrizione : ""), tipo: "verifica" }))],
    [t("Comandi rapidi"), (CAT.comandi || []).map((c) => ({ id: "rapido:" + c.id, nome: c.nome, rif: c.id,
      descr: c.nome + (c.descrizione ? " · " + c.descrizione : ""), tipo: "rapido" }))],
  ];
  const out = [];
  for (const [gruppo, voci] of gruppi) for (const v of voci)
    if (v.id && (!q || v.id.toLowerCase().includes(q) || String(v.descr || "").toLowerCase().includes(q))) out.push(Object.assign({ gruppo }, v));
  return out;
}
function nascondiSuggerimenti() { $("suggerimenti").classList.add("nascosto"); }
function mostraSuggerimenti() {
  const box = $("suggerimenti");
  const m = $("chiedi-testo").value.match(/^\/(\S*)$/);
  if (!m) return nascondiSuggerimenti();
  MENU = vociMenu(m[1]);
  if (!MENU.length) return nascondiSuggerimenti();
  sugScelto = Math.max(0, Math.min(sugScelto, MENU.length - 1));
  const nodi = [];
  let gruppo = null;
  MENU.forEach((c, i) => {
    if (c.gruppo !== gruppo) { gruppo = c.gruppo; nodi.push(el("div", { class: "sug-gruppo" }, gruppo)); }
    nodi.push(el("button", { type: "button", "data-i": i, class: i === sugScelto ? "scelto" : "", onclick: () => scegliComando(c) },
      el("b", {}, "/" + c.id + (c.arg ? " …" : "")), el("small", {}, c.descr || ""),
      c.etichetta ? el("span", { class: "sug-etichetta" }, c.etichetta) : ""));
  });
  box.replaceChildren(...nodi);
  box.classList.remove("nascosto");
  const scelto = box.querySelector(`[data-i="${sugScelto}"]`);
  if (scelto) scelto.scrollIntoView({ block: "nearest" });
}
function scegliComando(c) {
  nascondiSuggerimenti();
  if (c.tipo === "verifica" || c.tipo === "rapido") { $("chiedi-testo").value = ""; autoAltezza(); lanciaDaMenu(c); return; }
  $("chiedi-testo").value = "/" + c.id + " ";
  autoAltezza();
  if (c.tipo === "diretto" && !c.arg) invia(); else $("chiedi-testo").focus();
}
// verifiche e comandi rapidi non rispondono in chat: partono come lavori, e la chat lo dice
async function lanciaDaMenu(c) {
  const fl = filo(chatCon);
  const d = await azione(c.tipo === "verifica" ? { tipo: "verifica", id: c.rif } : { tipo: "comando", id: c.rif });
  fl.messaggi.push({ chi: "lui", tipo: "comando", titolo: "/" + c.id, errore: !d, ora: oraBreve(),
    testo: d ? t("Avviato: {nome}. Il risultato arriva in Squadra › Lavori.", { nome: c.nome }) : t("Non è partito: {nome}.", { nome: c.nome }) });
  salvaFili();
  disegnaMessaggi();
}
$("chiedi-testo").addEventListener("input", () => { autoAltezza(); sugScelto = 0; mostraSuggerimenti(); });
$("chiedi-testo").addEventListener("keydown", (ev) => {
  const aperti = !$("suggerimenti").classList.contains("nascosto");
  if (aperti && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) {
    ev.preventDefault();
    const n = MENU.length;
    sugScelto = (sugScelto + (ev.key === "ArrowDown" ? 1 : n - 1)) % n;
    mostraSuggerimenti();
    return;
  }
  if (aperti && (ev.key === "Tab" || (ev.key === "Enter" && !ev.shiftKey))) {
    const b = $("suggerimenti").querySelector(`[data-i="${sugScelto}"]`);
    const v = $("chiedi-testo").value.trim();
    // «/lavori» già scritto per intero parte con Invio; altrimenti si completa
    if (b && !(ev.key === "Enter" && COMANDI.some((c) => "/" + c.nome === v))) { ev.preventDefault(); b.click(); return; }
  }
  if (ev.key === "Escape") nascondiSuggerimenti();
  if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); invia(); }
});
$("form-chiedi").addEventListener("submit", (ev) => { ev.preventDefault(); invia(); });
$("comandi-diretti").addEventListener("click", (ev) => {
  if (ev.target.closest("[data-cmd-tutti]")) {           // «/ tutti»: apre il menu intero
    $("chiedi-testo").value = "/"; sugScelto = 0; autoAltezza(); mostraSuggerimenti(); $("chiedi-testo").focus(); return;
  }
  const b = ev.target.closest("[data-cmd]");
  if (!b) return;
  const c = COMANDI.find((x) => x.nome === b.dataset.cmd);
  if (c.arg) { $("chiedi-testo").value = "/" + c.nome + " "; $("chiedi-testo").focus(); autoAltezza(); }
  else { $("chiedi-testo").value = "/" + c.nome; invia(); }
});
$("btn-svuota-chat").addEventListener("click", () => {
  const fl = filo(chatCon);
  if (fl.attesa) { toast(t("Aspetta la risposta in corso"), true); return; }
  if (fl.messaggi.length && !confirm(t("Ricominciare da zero con questo interlocutore? La conversazione sparisce da qui."))) return;
  THREADS[chatCon] = { sessione: uuid(), avviata: false, messaggi: [] };
  salvaFili(); disegnaMessaggi(); aggiornaInvia();
});
$("btn-nuova-chat").addEventListener("click", () => apriChat("jarvis"));

// ------------------------------------------------ lavagna
const LAV = { sel: null, selFilo: null };
function nodoDi(id) { return lav().nodi.find((n) => n.id === id); }
function vista() { return lav().vista || (lav().vista = { x: 0, y: 0, zoom: 1 }); }
function applicaVista() {
  const v = vista();
  $("lav-mondo").style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
  // le bolle delle sinapsi restano leggibili a ogni zoom: si ingrandiscono al contrario del foglio
  $("lav-mondo").style.setProperty("--inv", String(Math.min(1.8, 1 / v.zoom)));
  $("lavagna").style.backgroundPosition = `${v.x}px ${v.y}px`;
  $("lavagna").style.backgroundSize = `${18 * v.zoom}px ${18 * v.zoom}px`;
}
function puntoMondo(clientX, clientY) {
  const r = $("lavagna").getBoundingClientRect(), v = vista();
  return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
}
function disegnaLavagna() {
  const mondo = $("lav-mondo");
  if (!mondo) return;
  if ($("lav-titolo")) $("lav-titolo").textContent = lavagnaTitolo;
  for (const n of [...mondo.querySelectorAll(".nodo")]) n.remove();
  for (const n of lav().nodi) {
    if (n.tipo === "agente" && !AGENTI.has(n.agente) && AGENTI.size) continue;   // agente sparito dai profili
    mondo.append(schedaNodo(n));
  }
  $("lav-vuota").classList.toggle("nascosto", lav().nodi.length > 0);
  applicaVista();
  disegnaFili();
  segnaAttivi();
  $("lav-togli").disabled = !(LAV.sel || LAV.selFilo != null);   // il filo 0 è un filo vero
}
// una nota della lavagna che è anche uno spazio vero (col nome dello spazio): il suo gruppo
// nella colonna a sinistra è sempre "spazio-<id>", trovato per nome (le note non portano l'id).
function gruppoDiNota(testo) {
  const s = (spaziCat || []).find((x) => x.nome === testo);
  return s ? "spazio-" + s.id : null;
}
// note che non sono spazi ma sono comunque reali: Memoria (una cartella), esecutore e ricercatore-web
// (agenti fissi di Jarvis, fuori da ogni progetto): il tasto destro verifica il collegamento vero
const NOTE_DI_CASA = new Set(["memoria", "esecutore", "ricercatore-web"]);
// il nome della nota di casa dal testo: «Memoria» è tradotta nella lingua del pannello, gli agenti possono
// avere il modello dopo il nome («esecutore · haiku»)
function notaDiCasa(testo) {
  const x = String(testo || "").trim();
  if (x.toLowerCase() === "memoria" || x === t("Memoria")) return "memoria";
  const nome = x.split(" · ")[0].trim().toLowerCase();
  return NOTE_DI_CASA.has(nome) && nome !== "memoria" ? nome : null;
}
let schedaCasaNome = null;
async function apriNotaDiCasa(nome) {
  try {
    const r = await fetch("/api/nota-di-casa?nome=" + encodeURIComponent(nome), { headers: HDR });
    const d = await r.json();
    if (!r.ok) { toast(d.errore || t("non trovata"), true); return; }
    if (d.tipo === "cartella") { toast(t("Cartella vera, non ha altro da modificare: {percorso}", { percorso: d.percorso })); return; }
    schedaCasaNome = nome;
    $("sc-avatar").textContent = nome[0].toUpperCase();
    $("sc-nome").textContent = nome;
    $("sc-percorso").textContent = d.percorso;
    $("sc-descr").value = d.descrizione || "";
    $("sc-modello").value = d.modello || "sonnet";
    $("sc-strumenti").value = d.strumenti || "";
    $("sc-tono").value = d.tono || "";
    $("sc-umor").value = d.umorismo == null ? 1 : d.umorismo;
    $("sc-umor-t").textContent = UMORISMO[$("sc-umor").value];
    $("scheda-casa").showModal();
  } catch (e) { toast(t("Non sono riuscito a verificarla: {errore}", { errore: e.message }), true); }
}
$("sc-umor").addEventListener("input", (ev) => { $("sc-umor-t").textContent = UMORISMO[+ev.target.value]; });
$("form-scheda-casa").addEventListener("submit", async (ev) => {
  if (!ev.submitter || ev.submitter.value !== "salva") return;
  const d = await azione({ tipo: "agente", cosa: "salva_casa", nome: schedaCasaNome,
    description: $("sc-descr").value.trim(), model: $("sc-modello").value, tools: $("sc-strumenti").value.trim(),
    tono: $("sc-tono").value.trim(), umorismo: +$("sc-umor").value }, ev.submitter);
  if (d) toast(d.messaggio || t("salvato"));
});
function schedaNodo(n) {
  let d;
  if (n.tipo === "nota") {
    const tn = el("div", { class: "testo-nota" }, n.testo || t("Nota"));
    const colore = coloreNota(n);
    const gid = gruppoDiNota(n.testo);
    const casa = notaDiCasa(n.testo);
    d = el("div", { class: "nodo nota" + (colore ? " colorata" : "") + (n.id === "demo-jarvis" ? " grande" : ""), "data-id": n.id,
      title: gid ? t("Doppio clic per scrivere · tasto destro: scheda dello spazio")
        : casa ? t("Doppio clic per scrivere · tasto destro: verifica il collegamento vero") : t("Doppio clic per scrivere"),
      style: colore ? `--c:${colore}` : null }, tn);
    d.addEventListener("dblclick", (ev) => { ev.stopPropagation(); modificaNota(tn, n); });
    if (gid) d.addEventListener("contextmenu", (ev) => { ev.preventDefault(); apriSchedaGruppo(gid); });
    else if (casa) d.addEventListener("contextmenu", (ev) => { ev.preventDefault(); apriNotaDiCasa(casa); });
  } else {
    const a = AGENTI.get(n.agente) || { key: n.agente, nome: n.agente.split(":").pop(), progettoNome: "", modello: "", spazio: "" };
    d = el("div", { class: "nodo" + (a.attivo === false ? " spento" : ""), "data-id": n.id, "data-agente": n.agente, title: t("Doppio clic: chatta · tasto destro: scheda"),
      style: `--c:${aspettoDi(a).colore}` }, avatar(a),
      el("div", { class: "testo" }, el("b", {}, nomeDi(a)), el("small", {}, [progettoDi(a), a.modello].filter(Boolean).join(" · "))));
    d.addEventListener("dblclick", (ev) => { ev.stopPropagation(); apriChat(n.agente); });
    d.addEventListener("contextmenu", (ev) => { ev.preventDefault(); apriScheda(n.agente); });
  }
  d.append(el("span", { class: "porta", title: t("Tira su un'altra scheda: «dipende da»") }));
  d.style.left = n.x + "px"; d.style.top = n.y + "px";
  d.classList.toggle("scelto", LAV.sel === n.id);
  return d;
}
function modificaNota(t, n) {
  t.contentEditable = "true"; t.focus();
  document.getSelection().selectAllChildren(t);
  t.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Escape") t.blur(); });
  t.addEventListener("blur", () => { t.contentEditable = "false"; n.testo = t.innerText.trim().slice(0, 2000); salvaPannello(); disegnaFili(); }, { once: true });
}
function centroNodo(n, lato) {
  const d = document.querySelector(`.nodo[data-id="${CSS.escape(n.id)}"]`);
  const w = d ? d.offsetWidth : 192, h = d ? d.offsetHeight : 44;
  return lato === "uscita" ? { x: n.x + w, y: n.y + h / 2 } : { x: n.x, y: n.y + h / 2 };
}
function rettNodo(n) {
  const d = document.querySelector(`.nodo[data-id="${CSS.escape(n.id)}"]`);
  const w = d ? d.offsetWidth : 192, h = d ? d.offsetHeight : 44;
  return { x: n.x, y: n.y, w, h, cx: n.x + w / 2, cy: n.y + h / 2 };
}
// il lato del rettangolo r più naturale per andare verso (altroCx, altroCy):
// sopra o sotto se il salto verticale conta di più, altrimenti destra o sinistra.
// Così un filo verso una scheda più in basso esce dal basso, non sempre da destra.
function puntoVersoAltro(r, altroCx, altroCy) {
  const dx = altroCx - r.cx, dy = altroCy - r.cy;
  if (Math.abs(dy) > Math.abs(dx) * .6) return dy >= 0 ? { x: r.cx, y: r.y + r.h, lato: "s" } : { x: r.cx, y: r.y, lato: "n" };
  return dx >= 0 ? { x: r.x + r.w, y: r.cy, lato: "e" } : { x: r.x, y: r.cy, lato: "o" };
}
function curva(p, q) {
  if (!p.lato || !q.lato) {   // filo provvisorio mentre si trascina: sempre orizzontale, come prima
    const dx = Math.max(40, Math.abs(q.x - p.x) / 2);
    return `M${p.x},${p.y} C${p.x + dx},${p.y} ${q.x - dx},${q.y} ${q.x},${q.y}`;
  }
  const scarto = { n: [0, -1], s: [0, 1], e: [1, 0], o: [-1, 0] }, d = 40;
  const [ox1, oy1] = scarto[p.lato], [ox2, oy2] = scarto[q.lato];
  return `M${p.x},${p.y} C${p.x + ox1 * d},${p.y + oy1 * d} ${q.x + ox2 * d},${q.y + oy2 * d} ${q.x},${q.y}`;
}
function disegnaFili() {
  const svg = $("lav-fili");
  for (const p of [...svg.querySelectorAll("path.filo, path.filo-presa")]) p.remove();
  const visibile = (n) => n && !(n.tipo === "agente" && AGENTI.size && !AGENTI.has(n.agente));
  lav().fili.forEach((f, i) => {
    const a = nodoDi(f.da), b = nodoDi(f.a);
    if (!visibile(a) || !visibile(b)) return;
    const ra = rettNodo(a), rb = rettNodo(b);
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const forma = formaFilo(a, b);
    p.dataset.da = f.da; p.dataset.a = f.a;
    p.setAttribute("d", forma ? percorsoOrtogonale(forma, ra, rb)
      : curva(puntoVersoAltro(ra, rb.cx, rb.cy), puntoVersoAltro(rb, ra.cx, ra.cy)));
    p.setAttribute("class", "filo" + (LAV.selFilo === i ? " scelto" : ""));
    const tn = document.createElementNS("http://www.w3.org/2000/svg", "title");
    tn.textContent = t("{a} dipende da {b} · clic: sceglilo e compare ✕ · doppio clic: toglilo", { a: etichettaNodo(a), b: etichettaNodo(b) });
    // il filo visibile è sottile (1,6 px): una seconda traccia trasparente larga 16 px lo rende facile da prendere
    const presa = p.cloneNode(false);
    presa.setAttribute("class", "filo-presa");
    presa.removeAttribute("data-da"); presa.removeAttribute("data-a");
    presa.append(tn);
    presa.addEventListener("pointerenter", () => p.classList.add("sopra"));
    presa.addEventListener("pointerleave", () => p.classList.remove("sopra"));
    presa.addEventListener("pointerdown", (ev) => { if (ev.button !== 0) return; ev.stopPropagation(); scegliFilo(i); });
    presa.addEventListener("dblclick", (ev) => { ev.stopPropagation(); LAV.selFilo = i; LAV.sel = null; togliScelto(); });
    presa.addEventListener("contextmenu", (ev) => { ev.preventDefault(); ev.stopPropagation(); scegliFilo(i); });
    svg.append(p, presa);
  });
  marcaFili();
  applicaSinapsi();
  posaXFilo();
}
function scegliFilo(i) {
  LAV.selFilo = i; LAV.sel = null;
  document.querySelectorAll(".nodo.scelto").forEach((x) => x.classList.remove("scelto"));
  document.querySelectorAll("#lav-fili path.filo.scelto").forEach((x) => x.classList.remove("scelto"));
  const f = lav().fili[i];
  const p = f && document.querySelector(`#lav-fili path.filo[data-da="${CSS.escape(f.da)}"][data-a="${CSS.escape(f.a)}"]`);
  if (p) p.classList.add("scelto");
  $("lav-togli").disabled = false;
  posaXFilo();
  $("lavagna").focus({ preventScroll: true });
}
// il ✕ sta a metà del filo scelto: un clic e il collegamento se ne va
function posaXFilo() {
  let x = $("lav-x-filo");
  if (!x) {
    x = el("button", { class: "lav-x-filo nascosto", id: "lav-x-filo", type: "button", title: t("Togli questo collegamento") }, "✕");
    x.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    x.addEventListener("click", (ev) => { ev.stopPropagation(); togliScelto(); });
    $("lav-mondo").append(x);
  }
  const f = LAV.selFilo != null && lav().fili[LAV.selFilo];
  const p = f && document.querySelector(`#lav-fili path.filo[data-da="${CSS.escape(f.da)}"][data-a="${CSS.escape(f.a)}"]`);
  if (!p) { x.classList.add("nascosto"); return; }
  const m = p.getPointAtLength(p.getTotalLength() / 2);
  x.style.left = m.x + "px"; x.style.top = m.y + "px";
  x.classList.remove("nascosto");
}
// I fili della gerarchia disegnata da «Tutta la catena» (26/09/2026): niente raggiera.
// pannello.json tiene dei fili solo da/a (il server scarta il resto): la forma si ricava qui, solo
// nella lavagna generale e solo quando la scheda di arrivo sta più in basso.
function formaFilo(a, b) {
  if (lavagnaAttiva === DEMO.id) return a.id === "demo-report" ? "ritorno" : "";
  if (lavagnaAttiva !== "generale" || b.y <= a.y + 40) return "";
  const testaRamo = a.tipo === "nota" ? String(a.testo || "").endsWith(" · " + SENZA_CAPO) : !!(AGENTI.get(a.agente) || {}).capogruppo ||
    (b.tipo === "agente" && (AGENTI.get(b.agente) || {}).riporta_a === (AGENTI.get(a.agente) || {}).nome);
  if (testaRamo && b.tipo === "agente" && b.x >= a.x - 4 && b.x <= a.x + CATENA.LARG + 4) return "ramo";
  return a.tipo === "nota" ? "giu" : "";
}
// il colore di un'etichetta della catena: quello dello spazio che nomina (anche questo non si salva)
function coloreNota(n) {
  if (eDemo(n.id)) return DEMO.colori[n.id.split("-")[1]] || "";
  const t = String(n.testo || "");
  for (const s of spaziCat || []) {
    if (t === s.nome) return coloreSpazio(s.id);
    if (s.progetti.some((p) => t === p.nome + " · " + SENZA_CAPO)) return coloreSpazio(s.id);
  }
  return "";
}
// «giu»: scende dal centro, corre in orizzontale poco sopra la scheda di sotto, scende sul suo centro.
// «ramo»: esce dal basso a sinistra, corre su un tronco a sinistra della colonna, entra dal lato.
function percorsoOrtogonale(forma, ra, rb) {
  if (forma === "ritorno") {        // la risposta risale lungo il lato sinistro, fuori dalla piramide
    const xt = Math.min(ra.x, rb.x) - 70;
    return `M${ra.x},${ra.cy} H${xt} V${rb.cy} H${rb.x}`;
  }
  if (forma === "ramo") {
    const xt = rb.x - 12, y0 = ra.y + ra.h;
    return `M${ra.x + 20},${y0} V${y0 + 12} H${xt} V${rb.cy} H${rb.x}`;
  }
  const ym = rb.y - 26;
  return `M${ra.cx},${ra.y + ra.h} V${ym} H${rb.cx} V${rb.y}`;
}
function etichettaNodo(n) { return n.tipo === "nota" ? "«" + (n.testo || t("nota")).slice(0, 30) + "»" : nomeDi(AGENTI.get(n.agente) || { key: n.agente, nome: n.agente.split(":").pop() }); }

function mettiInLavagna(k, punto) {
  let n = lav().nodi.find((x) => x.agente === k);
  if (n) { LAV.sel = n.id; LAV.selFilo = null; disegnaLavagna(); toast(t("È già in lavagna: l'ho evidenziato")); return; }
  const r = $("lavagna").getBoundingClientRect();
  const p = punto || puntoMondo(r.left + 30 + (lav().nodi.length % 5) * 30, r.top + 30 + (lav().nodi.length % 8) * 56);
  n = { id: "n" + Date.now().toString(36), tipo: "agente", agente: k, x: Math.round(p.x), y: Math.round(p.y) };
  lav().nodi.push(n);
  LAV.sel = n.id;
  salvaPannello(); disegnaLavagna();
}
// Apre un gruppo della colonna di sinistra nella lavagna, con capogruppo e squadra
// già disposti in gerarchia (un progetto per colonna) e collegati. Chi è già in
// lavagna non si sposta: il pulsante riporta lì e completa solo quello che manca.
function posizionaNodoSeNuovo(k, x, y) {
  if (lav().nodi.some((n) => n.agente === k)) return false;
  lav().nodi.push({ id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), tipo: "agente", agente: k, x, y });
  return true;
}
function collegaSeManca(daKey, aKey) {
  const nDa = lav().nodi.find((n) => n.agente === daKey), nA = lav().nodi.find((n) => n.agente === aKey);
  if (!nDa || !nA || lav().fili.some((f) => f.da === nDa.id && f.a === nA.id)) return false;
  lav().fili.push({ da: nDa.id, a: nA.id });
  return true;
}
// Dispone gli agenti di un gruppo in piramidi (una per progetto, dall'alto in
// basso: capogruppo in cima, poi la squadra su righe centrate sotto di lui),
// affiancate una accanto all'altra a partire da xIniziale. Non sposta chi è già
// in lavagna: completa solo quello che manca. Ritorna quanto spazio ha occupato
// e la chiave di ogni capogruppo di primo livello, per collegarli a un nodo sopra.
function posizionaGruppoPiramide(agentiGruppo, xIniziale, yIniziale) {
  const PER_RIGA = 5, LARG = 200, ALT = 140;
  const progetti = new Map();
  for (const a of agentiGruppo) { if (!progetti.has(a.progetto)) progetti.set(a.progetto, []); progetti.get(a.progetto).push(a); }
  let colX = xIniziale, tocco = false, altezza = ALT;
  const capiPrimoLivello = [];
  for (const lista of progetti.values()) {
    const capo = lista.find((a) => a.capogruppo);
    const specialisti = lista.filter((a) => a !== capo);
    const righe = [];
    for (let i = 0; i < specialisti.length; i += PER_RIGA) righe.push(specialisti.slice(i, i + PER_RIGA));
    const larghMax = Math.max(1, ...righe.map((r) => r.length)) * LARG;
    if (capo) { if (posizionaNodoSeNuovo(capo.key, Math.round(colX + larghMax / 2 - 88), yIniziale)) tocco = true; capiPrimoLivello.push(capo.key); }
    let yr = capo ? yIniziale + ALT : yIniziale;
    for (const riga of righe) {
      const offset = (larghMax - riga.length * LARG) / 2;
      riga.forEach((a, i) => { if (posizionaNodoSeNuovo(a.key, Math.round(colX + offset + i * LARG), yr)) tocco = true; });
      yr += ALT;
    }
    if (capo) specialisti.forEach((a) => { if (collegaSeManca(capo.key, a.key)) tocco = true; });
    else specialisti.forEach((a) => capiPrimoLivello.push(a.key));   // nessun capogruppo: ognuno si collega direttamente a chi chiama
    colX += larghMax + 60;
    altezza = Math.max(altezza, yr - yIniziale);
  }
  return { tocco, largh: colX - xIniziale, altezza, capiPrimoLivello };
}
function apriGruppoInLavagna(gid) {
  fissaGruppi();
  const g = PAN.gruppi.find((x) => x.id === gid);
  const agentiGruppo = (g ? g.agenti : []).map((k) => AGENTI.get(k)).filter(Boolean);
  if (!agentiGruppo.length) { toast(t("Il gruppo non ha agenti da mettere in lavagna"), true); return; }
  vaiALavagna(gid, g.nome);   // la sua lavagna dedicata, non quella generale: un gruppo alla volta, non tutto mescolato
  const r = posizionaGruppoPiramide(agentiGruppo, 40, 30);
  if (r.tocco) salvaPannello();
  location.hash = "#lavagna";
  requestAnimationFrame(() => { disegnaLavagna(); centraLavagna(); });
}
// Trova o crea una nota ferma (non entra in modifica): serve per i nodi radice
// «Boss» e «Jarvis» che stanno sopra a tutta la catena.
function trovaOCreaNota(testo, x, y) {
  let n = lav().nodi.find((z) => z.tipo === "nota" && z.testo === testo);
  if (n) return { n, nuovo: false };
  n = { id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), tipo: "nota", testo, x, y };
  lav().nodi.push(n);
  return { n, nuovo: true };
}
// Con chi è collegato questo agente, guardando in TUTTE le lavagne (non solo
// quella aperta ora: un agente può stare in più gruppi). Serve a scrivere
// davvero nel suo profilo con chi si deve coordinare, appena Boss lo collega
// a qualcuno nella lavagna — non solo un disegno, un aggiornamento vero.
function chiaviCollegate(agenteKey) {
  const trovati = new Set();
  for (const lg of Object.values(PAN.lavagne || {})) {
    const miei = new Set(lg.nodi.filter((n) => n.agente === agenteKey).map((n) => n.id));
    if (!miei.size) continue;
    for (const f of lg.fili) {
      const altroId = miei.has(f.da) ? f.a : miei.has(f.a) ? f.da : null;
      if (altroId == null) continue;
      const altro = lg.nodi.find((n) => n.id === altroId);
      if (altro && altro.tipo === "agente" && altro.agente !== agenteKey) trovati.add(altro.agente);
    }
  }
  return [...trovati];
}
async function sincronizzaComunicazioni(agenteKey) {
  if (lavDemo) return;                     // dimostrazione: i profili veri non si toccano
  const a = AGENTI.get(agenteKey);
  if (!a || !a.file) return;
  // il nome VERO del profilo, non quello da mostrare: nel «Comunica con» serve il nome del file (27/09/2026)
  const nomi = chiaviCollegate(agenteKey).map((k) => (AGENTI.get(k) || {}).nome || k.split(":").pop());
  try { await api("/api/agente-comunica", { file: a.file, comunica: nomi }); }
  catch (e) { toast(t("Non ho aggiornato il profilo di {nome}: {errore}", { nome: nomeDi(a), errore: e.message }), true); }
}
// Un collegamento fatto o tolto a mano nella lavagna arriva a Boss su
// Telegram, non solo nel registro eventi: Jarvis dice cosa è cambiato.
function notificaBoss(testo) { if (!lavDemo) api("/api/notifica-boss", { testo }).catch(() => {}); }   // negli eventi del pannello; in dimostrazione niente
// «Tutta la catena» (rifatta il 26/09/2026, richiesta di Boss): una piramide dall'alto in basso.
//   livello 0 Boss · livello 1 Jarvis, con i suoi agenti di casa accanto (esecutore, ricercatore-web)
//   livello 2 i capigruppo, raggruppati per spazio sotto un'etichetta del colore dello spazio
//   sotto ogni capogruppo la sua squadra IN COLONNA (due colonne affiancate oltre le 6 schede).
// Così la larghezza resta di una dozzina di colonne e cresce l'altezza: a vista adattata i nomi si
// leggono. Solo agenti che esistono come file di profilo (da /api/catalogo); un progetto senza
// capogruppo ha in testa un'etichetta col suo nome. I fili della gerarchia sono ortogonali (formaFilo:
// «giu» scende, corre in orizzontale, scende; «ramo» è un tronco a sinistra della colonna); gli
// altri, come i «comunica con» dei profili (/api/agente-profilo), restano curvi.
// il testo delle etichette dei progetti senza capogruppo: lo stesso in creazione e nel riconoscimento
const SENZA_CAPO = t("senza capogruppo");
const CATENA = { LARG: 212, SCHEDA: 192, PASSO: 70, PER_COLONNA: 6, GRUPPO: 56, PROGETTO: 24,
  Y_BOSS: 0, Y_JARVIS: 110, Y_SPAZIO: 220, Y_CAPI: 330, Y_SQUADRA: 430 };
function alberoCatena() {
  const spazi = [];
  for (const s of spaziCat || []) {
    const rami = [];
    for (const p of s.progetti || []) {
      const ag = (p.agenti || []).map((a) => AGENTI.get(`${p.id}:${a.nome}`)).filter(Boolean);
      if (!ag.length) continue;
      const capo = ag.find((a) => a.capogruppo) || null;
      rami.push({ progetto: p, capo, squadra: ag.filter((a) => a !== capo) });
    }
    if (rami.length) spazi.push({ spazio: s, rami });
  }
  return spazi;
}
function nodoAgente(k, x, y) {
  let n = lav().nodi.find((z) => z.agente === k);
  if (!n) { n = { id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), tipo: "agente", agente: k, x, y }; lav().nodi.push(n); }
  n.x = Math.round(x); n.y = Math.round(y);
  return n;
}
// una nota «di servizio» della catena (Boss, Jarvis, etichette): la ritrova dal testo e la rimette a posto
function notaCatena(testo, x, y) {
  const { n } = trovaOCreaNota(testo, x, y);
  n.x = Math.round(x); n.y = Math.round(y);
  return n;
}
function filoSeManca(da, a) {
  if (!da || !a || da.id === a.id) return;
  if (!lav().fili.some((x) => (x.da === da.id && x.a === a.id) || (x.da === a.id && x.a === da.id))) lav().fili.push({ da: da.id, a: a.id });
}
// «comunica con A, B.» dentro il blocco che scrive la lavagna nel profilo
function nomiComunica(corpo) {
  const m = String(corpo || "").match(/<!-- comunica-con:inizio[\s\S]*?comunica con ([^\n]*?)\.?\s*\n<!-- comunica-con:fine -->/);
  return m ? m[1].split(",").map((x) => x.trim()).filter(Boolean) : [];
}
async function filiDaiProfili(agenti) {
  const trovati = [];
  const coda = agenti.filter((a) => a.file);
  const lavora = async () => {
    for (let a = coda.shift(); a; a = coda.shift()) {
      try {
        const p = await api("/api/agente-profilo?file=" + encodeURIComponent(a.file));
        for (const nome of nomiComunica(p.corpo)) {
          // il nome può essere quello del profilo o quello mostrato; prima nello stesso progetto
          const tutti = [...AGENTI.values()];
          const b = tutti.find((x) => x.progetto === a.progetto && (x.nome === nome || nomeDi(x) === nome)) ||
            tutti.find((x) => x.nome === nome || nomeDi(x) === nome);
          if (b && b.key !== a.key) trovati.push([a.key, b.key]);
        }
      } catch (e) { /* profilo illeggibile: restano i fili della gerarchia */ }
    }
  };
  await Promise.all(Array.from({ length: 6 }, lavora));
  return trovati;
}
// l'ordine della squadra in colonna: ogni agente seguito da chi riporta a lui, con il suo livello
function ordinaRamo(r) {
  const capo = r.capo ? r.capo.nome : "";
  const nomi = new Set(r.squadra.map((a) => a.nome));
  const padre = (a) => (a.riporta_a && a.riporta_a !== capo && nomi.has(a.riporta_a) && a.riporta_a !== a.nome ? a.riporta_a : "");
  const out = [], visti = new Set();
  const giu = (nome, livello) => {
    for (const a of r.squadra) if (padre(a) === nome && !visti.has(a.key)) { visti.add(a.key); out.push([a, livello]); giu(a.nome, livello + 1); }
  };
  giu("", 1);
  for (const a of r.squadra) if (!visti.has(a.key)) out.push([a, 1]);           // cicli o padri spariti: al primo livello
  return out;
}
async function popolaCatenaCompleta() {
  vaiALavagna("generale", t("Tutta la catena"));
  const C = CATENA, L = lav();
  const spazi = alberoCatena();
  if (!spazi.length) { toast(t("Nessun agente da mettere in lavagna: il catalogo non è ancora arrivato"), true); return; }
  // via i nodi di agenti che non esistono più, e i loro fili
  if (AGENTI.size) {
    const via = new Set(L.nodi.filter((n) => n.tipo === "agente" && !AGENTI.has(n.agente)).map((n) => n.id));
    L.nodi = L.nodi.filter((n) => !via.has(n.id));
    L.fili = L.fili.filter((f) => !via.has(f.da) && !via.has(f.a));
  }
  // colonne di ogni ramo: una, due se la squadra supera PER_COLONNA
  const colonne = (r) => (r.squadra.length > C.PER_COLONNA ? 2 : 1);
  const largRamo = (r) => colonne(r) * C.LARG;
  const largSpazio = (g) => g.rami.reduce((w, r) => w + largRamo(r), 0) + C.PROGETTO * (g.rami.length - 1);
  const totale = spazi.reduce((w, g) => w + largSpazio(g), 0) + C.GRUPPO * (spazi.length - 1);
  const xCentro = totale / 2 - C.SCHEDA / 2;
  const nBoss = notaCatena(UTENTE, xCentro, C.Y_BOSS);
  const nJarvis = notaCatena(t("Jarvis — orchestratore, risponde a {utente}", { utente: UTENTE }), xCentro, C.Y_JARVIS);
  filoSeManca(nBoss, nJarvis);
  // la memoria, a sinistra di Jarvis: le ricerche (/memoria, /brain) scorrono verso di lei
  filoSeManca(nJarvis, notaCatena(t("Memoria"), xCentro - 2 * C.LARG, C.Y_JARVIS));
  // gli agenti di casa di Jarvis (~/.claude/agents), accanto a lui: vengono dalla catena del server
  const diCasa = ((ultimoStato && ultimoStato.catena && ultimoStato.catena.jarvis) || []);
  diCasa.forEach((nome, i) => {
    const mod = ultimoStato.catena.modelli && ultimoStato.catena.modelli[nome];
    const n = notaCatena(nome + (mod ? " · " + mod : ""), xCentro + (i + 1) * C.LARG, C.Y_JARVIS);
    filoSeManca(nJarvis, n);
  });
  let x = 0;
  for (const g of spazi) {
    notaCatena(g.spazio.nome, x, C.Y_SPAZIO);
    for (const r of g.rami) {
      // in testa al ramo il capogruppo; senza capogruppo un'etichetta col nome del progetto
      const testa = r.capo ? nodoAgente(r.capo.key, x, C.Y_CAPI) : notaCatena(r.progetto.nome + " · " + SENZA_CAPO, x, C.Y_CAPI);
      filoSeManca(nJarvis, testa);
      const perColonna = Math.ceil(r.squadra.length / colonne(r));
      // punto 14: chi «riporta a» uno specialista sta subito sotto di lui, rientrato (terzo livello e oltre)
      const nodiRamo = new Map();
      ordinaRamo(r).forEach(([a, livello], i) => {
        const col = Math.floor(i / perColonna), riga = i % perColonna;
        const n = nodoAgente(a.key, x + col * C.LARG + (livello - 1) * 16, C.Y_SQUADRA + riga * C.PASSO);
        nodiRamo.set(a.nome, n);
        filoSeManca(livello > 1 ? nodiRamo.get(a.riporta_a) || testa : testa, n);
      });
      x += largRamo(r) + C.PROGETTO;
    }
    x += C.GRUPPO - C.PROGETTO;
  }
  salvaPannello();
  location.hash = "#lavagna";
  requestAnimationFrame(() => { disegnaLavagna(); centraLavagna(); });
  // poi i fili scritti nei profili veri
  const tutti = spazi.flatMap((g) => g.rami.flatMap((r) => (r.capo ? [r.capo] : []).concat(r.squadra)));
  const coppie = await filiDaiProfili(tutti);
  if (lavagnaAttiva !== "generale") return;          // Boss nel frattempo ha aperto un'altra lavagna
  const prima = lav().fili.length;
  for (const [a, b] of coppie) filoSeManca(lav().nodi.find((n) => n.agente === a), lav().nodi.find((n) => n.agente === b));
  const nuovi = lav().fili.length - prima;
  if (nuovi) { salvaPannello(); disegnaLavagna(); }
  toast(t("Catena disegnata: {agenti} agenti in {spazi} spazi", { agenti: tutti.length, spazi: spazi.length }) + " · " +
    (coppie.length ? t("{n} fili nuovi dai «comunica con» dei profili", { n: nuovi }) : t("nessun «comunica con» nei profili")));
}
function nuovaNota(p) {
  if (!p) { const r = $("lavagna").getBoundingClientRect(); p = puntoMondo(r.left + r.width / 2 - 80, r.top + r.height / 2 - 20); }
  const n = { id: "n" + Date.now().toString(36), tipo: "nota", testo: "", x: Math.round(p.x), y: Math.round(p.y) };
  lav().nodi.push(n);
  LAV.sel = n.id;
  salvaPannello(); disegnaLavagna();
  const t = document.querySelector(`.nodo[data-id="${n.id}"] .testo-nota`);
  if (t) modificaNota(t, n);
}
function togliScelto() {
  const agentiDaRisincronizzare = new Set();
  const segna = (nodoId) => { const n = nodoDi(nodoId); if (n && n.tipo === "agente") agentiDaRisincronizzare.add(n.agente); };
  if (LAV.selFilo != null) {
    const f = lav().fili[LAV.selFilo];
    if (!f) { LAV.selFilo = null; disegnaLavagna(); return; }   // filo sparito nel frattempo: non si toglie un altro
    segna(f.da); segna(f.a);
    lav().fili.splice(LAV.selFilo, 1); LAV.selFilo = null;
  } else if (LAV.sel) {
    for (const f of lav().fili) if (f.da === LAV.sel || f.a === LAV.sel) { segna(f.da); segna(f.a); }
    lav().nodi = lav().nodi.filter((n) => n.id !== LAV.sel);
    lav().fili = lav().fili.filter((f) => f.da !== LAV.sel && f.a !== LAV.sel);
    LAV.sel = null;
  } else return;
  salvaPannello(); disegnaLavagna();
  for (const k of agentiDaRisincronizzare) sincronizzaComunicazioni(k);
  if (agentiDaRisincronizzare.size === 2) {
    const nomi = [...agentiDaRisincronizzare].map((k) => nomeDi(AGENTI.get(k)));
    notificaBoss("✂️ " + t("Tolto un collegamento nella lavagna: {a} ↔ {b}. Aggiornato il profilo di entrambi.", { a: nomi[0], b: nomi[1] }));
  }
}
// Calamita: trascinando una scheda,
// se il suo bordo sinistro, il centro o il bordo destro (e in verticale alto, centro, basso) arriva a
// 10 px da quello di un'altra scheda, si aggancia e compare una guida tratteggiata. Alt la spegne.
function calamita(n) {
  const r = rettNodo(n), soglia = 10 / (vista().zoom || 1);
  let bx = null, by = null;
  for (const o of lav().nodi) {
    if (o.id === n.id) continue;
    const q = rettNodo(o);
    for (const [mio, suo] of [[r.x, q.x], [r.cx, q.cx], [r.x + r.w, q.x + q.w], [r.x, q.x + q.w + 20], [r.x + r.w, q.x - 20]]) {
      const d = suo - mio;
      if (Math.abs(d) <= soglia && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, linea: suo, q };
    }
    for (const [mio, suo] of [[r.y, q.y], [r.cy, q.cy], [r.y + r.h, q.y + q.h]]) {
      const d = suo - mio;
      if (Math.abs(d) <= soglia && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, linea: suo, q };
    }
  }
  if (bx) n.x = Math.round(n.x + bx.d);
  if (by) n.y = Math.round(n.y + by.d);
  const g = [];
  if (bx) { const lo = Math.min(n.y, bx.q.y) - 20, hi = Math.max(n.y + r.h, bx.q.y + bx.q.h) + 20; g.push(`M${bx.linea},${lo} V${hi}`); }
  if (by) { const lo = Math.min(n.x, by.q.x) - 20, hi = Math.max(n.x + r.w, by.q.x + by.q.w) + 20; g.push(`M${lo},${by.linea} H${hi}`); }
  guide(g);
}
function guide(tratti) {
  const svg = $("lav-fili");
  for (const p of [...svg.querySelectorAll("path.guida")]) p.remove();
  for (const d of tratti) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("class", "guida"); p.setAttribute("d", d);
    svg.append(p);
  }
}
// «Ordina» (rifatto il 27/09/2026): nella lavagna generale ridisegna la catena intera; in quella di un
// gruppo mette una piramide per progetto (capogruppo in cima, squadra sotto), come «Apri il gruppo».
// Prima faceva una colonna per SPAZIO, e due progetti dello stesso spazio finivano mischiati.
// I fili restano quelli che ci sono: Ordina sposta le schede, non aggiunge né toglie collegamenti.
function ordinaLavagna() {
  if (eDemo(lavagnaAttiva)) return ordinaColonne();
  if (lavagnaAttiva === "generale") return popolaCatenaCompleta();
  const L = lav(), filiPrima = L.fili.slice();
  const agenti = L.nodi.filter((n) => n.tipo === "agente" && AGENTI.has(n.agente));
  if (!agenti.length) return ordinaColonne();
  const idDi = new Map(agenti.map((n) => [n.agente, n.id]));
  L.nodi = L.nodi.filter((n) => !idDi.has(n.agente));
  const r = posizionaGruppoPiramide(agenti.map((n) => AGENTI.get(n.agente)), 40, 30);
  for (const n of L.nodi) if (idDi.has(n.agente)) n.id = idDi.get(n.agente);   // stesso id: i fili restano attaccati
  L.fili = filiPrima;
  L.nodi.filter((n) => n.tipo === "nota").forEach((n, j) => { n.x = 40 + j * 212; n.y = 30 + r.altezza + 40; });
  salvaPannello(); disegnaLavagna();
  requestAnimationFrame(centraLavagna);
}
function ordinaColonne() {
  // una colonna per spazio, capogruppo in cima; le note in fondo a destra
  const colonne = new Map();
  for (const n of lav().nodi) {
    const a = AGENTI.get(n.agente);
    const c = n.tipo === "nota" ? "~note" : a ? a.spazio : "~altro";
    if (!colonne.has(c)) colonne.set(c, []);
    colonne.get(c).push(n);
  }
  [...colonne.keys()].sort().forEach((c, i) => {
    colonne.get(c).sort((p, q) => {
      const a = AGENTI.get(p.agente) || {}, b = AGENTI.get(q.agente) || {};
      return (b.capogruppo ? 1 : 0) - (a.capogruppo ? 1 : 0) || (a.progetto || "").localeCompare(b.progetto || "") || (a.nome || "").localeCompare(b.nome || "");
    }).forEach((n, j) => { n.x = 20 + i * 220; n.y = 20 + j * 64; });
  });
  lav().vista = { x: 0, y: 0, zoom: 1 };
  salvaPannello(); disegnaLavagna();
}
// «Centra» adatta la vista al contenuto (26/09/2026): il rettangolo di tutte le schede, con le
// misure vere, sta nella tela con 40 px di margine; zoom fra 0,3 e 1. Se a 0,3 non ci sta tutto
// si parte dall'alto, centrati in orizzontale: la testa della piramide resta in vista.
function centraLavagna() {
  const nodi = lav().nodi;
  const r = $("lavagna").getBoundingClientRect();
  if (!nodi.length || !r.width) { lav().vista = { x: 0, y: 0, zoom: 1 }; applicaVista(); return; }
  const rr = nodi.map(rettNodo), M = 40;
  const minX = Math.min(...rr.map((q) => q.x)), maxX = Math.max(...rr.map((q) => q.x + q.w));
  const minY = Math.min(...rr.map((q) => q.y)), maxY = Math.max(...rr.map((q) => q.y + q.h));
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  const zoom = Math.max(.3, Math.min(1, Math.min((r.width - 2 * M) / w, (r.height - 2 * M) / h)));
  const x = (r.width - w * zoom) / 2 - minX * zoom;
  const y = h * zoom <= r.height - 2 * M ? (r.height - h * zoom) / 2 - minY * zoom : M - minY * zoom;
  lav().vista = { zoom, x, y };
  applicaVista(); salvaPannello();
}

// mouse e dita sulla lavagna: sposta schede, tira fili, sposta il foglio
(function lavagnaInterazioni() {
  // 🔴 Fino al 26/09/2026 questa si chiamava «lav» e nascondeva la funzione lav() (la lavagna
  // attiva): lasciando un filo su una scheda partiva «lav is not a function» e il collegamento
  // non si salvava mai. Il foglio ora si chiama «tela».
  const tela = $("lavagna");
  let gesto = null;
  tela.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    const porta = ev.target.closest(".porta"), nodo = ev.target.closest(".nodo");
    if (nodo && nodo.querySelector("[contenteditable=true]")) return;
    if (nodo && !nodo.dataset.id) return;   // Sentinella e Memoria provvisorie: solo disegno, non si spostano né collegano
    // niente setPointerCapture: sposterebbe sulla lavagna anche il clic e il doppio
    // clic, e le schede non si aprirebbero più. Movimento e rilascio si seguono sulla finestra.
    if (porta && nodo) {
      const n = nodoDi(nodo.dataset.id);
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("class", "provvisorio");
      $("lav-fili").append(p);
      gesto = { tipo: "filo", n, p };
    } else if (nodo) {
      const n = nodoDi(nodo.dataset.id), m = puntoMondo(ev.clientX, ev.clientY);
      LAV.sel = n.id; LAV.selFilo = null;
      document.querySelectorAll(".nodo.scelto").forEach((x) => x.classList.remove("scelto"));
      nodo.classList.add("scelto");
      document.querySelectorAll("#lav-fili path.filo.scelto").forEach((x) => x.classList.remove("scelto"));
      posaXFilo();
      $("lav-togli").disabled = false;
      gesto = { tipo: "nodo", n, d: nodo, dx: m.x - n.x, dy: m.y - n.y, mosso: false };
    } else {
      const v = vista();
      gesto = { tipo: "foglio", sx: ev.clientX - v.x, sy: ev.clientY - v.y, mosso: false };
      tela.classList.add("muove");
    }
  });
  addEventListener("pointermove", (ev) => {
    if (!gesto) return;
    if (gesto.tipo === "nodo") {
      const m = puntoMondo(ev.clientX, ev.clientY);
      gesto.n.x = Math.round(m.x - gesto.dx); gesto.n.y = Math.round(m.y - gesto.dy);
      if (!ev.altKey) calamita(gesto.n); else guide([]);
      gesto.d.style.left = gesto.n.x + "px"; gesto.d.style.top = gesto.n.y + "px";
      if (!gesto.mosso) { gesto.mosso = true; gesto.d.classList.add("trascina"); }
      disegnaFili();
    } else if (gesto.tipo === "foglio") {
      const v = vista();
      v.x = ev.clientX - gesto.sx; v.y = ev.clientY - gesto.sy; gesto.mosso = true;
      applicaVista();
    } else if (gesto.tipo === "filo") {
      gesto.p.setAttribute("d", curva(centroNodo(gesto.n, "uscita"), puntoMondo(ev.clientX, ev.clientY)));
      document.querySelectorAll(".nodo.bersaglio").forEach((x) => x.classList.remove("bersaglio"));
      const sotto = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".nodo");
      if (sotto && sotto.dataset.id !== gesto.n.id) sotto.classList.add("bersaglio");
    }
  });
  const fine = (ev) => {
    if (!gesto) return;
    tela.classList.remove("muove");
    if (gesto.tipo === "nodo") { guide([]); gesto.d.classList.remove("trascina"); if (gesto.mosso) salvaPannello(); }
    else if (gesto.tipo === "foglio") { if (gesto.mosso) salvaPannello(); else { LAV.sel = null; LAV.selFilo = null; disegnaLavagna(); } }
    else if (gesto.tipo === "filo") {
      gesto.p.remove();
      document.querySelectorAll(".nodo.bersaglio").forEach((x) => x.classList.remove("bersaglio"));
      const sotto = ev.type === "pointerup" && document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".nodo[data-id]");
      if (sotto && sotto.dataset.id !== gesto.n.id && nodoDi(sotto.dataset.id)) {
        const a = gesto.n.id, b = sotto.dataset.id;
        if (lav().fili.some((f) => f.da === a && f.a === b)) toast(t("Collegamento già presente"));
        else {
          lav().fili.push({ da: a, a: b }); salvaPannello();
          const nb = nodoDi(b);
          toast(t("{a} dipende da {b}", { a: etichettaNodo(gesto.n), b: etichettaNodo(nb) }) + " · " + (lavDemo ? t("dimostrazione: i profili non si toccano") : t("aggiorno i profili…")));
          if (gesto.n.tipo === "agente") sincronizzaComunicazioni(gesto.n.agente);
          if (nb && nb.tipo === "agente") sincronizzaComunicazioni(nb.agente);
          if (gesto.n.tipo === "agente" && nb && nb.tipo === "agente") {
            notificaBoss("🔗 " + t("Collegati nella lavagna: {a} ↔ {b}. Aggiornato il profilo di entrambi: ora sanno con chi comunicare.", { a: etichettaNodo(gesto.n), b: etichettaNodo(nb) }));
          }
        }
        disegnaFili();
      }
    }
    gesto = null;
  };
  addEventListener("pointerup", fine);
  addEventListener("pointercancel", fine);
  tela.addEventListener("dblclick", (ev) => { if (!ev.target.closest(".nodo")) nuovaNota(puntoMondo(ev.clientX, ev.clientY)); });
  tela.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const v = vista(), r = tela.getBoundingClientRect();
    const z = Math.max(.2, Math.min(2.5, v.zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)));
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    v.x = mx - (mx - v.x) * z / v.zoom; v.y = my - (my - v.y) * z / v.zoom; v.zoom = z;
    applicaVista(); salvaPannello();
  }, { passive: false });
  tela.addEventListener("keydown", (ev) => {
    if ((ev.key === "Delete" || ev.key === "Backspace") && !ev.target.isContentEditable) { ev.preventDefault(); togliScelto(); }
  });
  // agenti trascinati dalla colonna di sinistra
  tela.addEventListener("dragover", (ev) => { if (trascinoAgente) { ev.preventDefault(); ev.dataTransfer.dropEffect = "copy"; tela.classList.add("sopra"); } });
  tela.addEventListener("dragleave", (ev) => { if (!tela.contains(ev.relatedTarget)) tela.classList.remove("sopra"); });
  tela.addEventListener("drop", (ev) => {
    ev.preventDefault(); tela.classList.remove("sopra");
    const k = ev.dataTransfer.getData("text/x-agente");
    if (k) { const p = puntoMondo(ev.clientX, ev.clientY); mettiInLavagna(k, { x: p.x - 88, y: p.y - 20 }); }
  });
  $("lav-nota").addEventListener("click", () => nuovaNota());
  $("lav-tutta-catena").addEventListener("click", popolaCatenaCompleta);
  $("lav-ordina").addEventListener("click", ordinaLavagna);
  $("lav-centra").addEventListener("click", centraLavagna);
  $("lav-togli").addEventListener("click", togliScelto);
})();

// ------------------------------------------------ colonna di destra: la lavagna
// La lavagna non è un cassetto apribile a fianco: ha la sua pagina a piena
// larghezza (#lavagna), raggiunta dal menu in alto.
const PANNELLI = ["lavagna"];
function scegliPannello(quale) {
  if (!PANNELLI.includes(quale)) quale = "lavagna";
  for (const p of document.querySelectorAll(".pannello-destra")) p.classList.toggle("attivo", p.dataset.pannello === quale);
  mem.scrivi("destra", quale);
  if (quale === "lavagna") requestAnimationFrame(disegnaFili);
  return quale;
}
const pannelloAttivo = () => location.hash.slice(1);
function chiudiCassetti() { $("app").classList.remove("lato-aperto"); }

let ultimaVista = "chat";
function paginaIntera(si) {
  $("app").classList.toggle("destra-intera", si);
  $("app").classList.toggle("senza-destra", !si);   // fuori dalla Lavagna la colonna destra resta sempre chiusa
  // la Lavagna a pagina intera lascia comunque lo spazio della barra in alto:
  // è una pagina come le altre, si torna indietro cliccando un'altra voce del menu.
  $("destra").style.top = si ? document.querySelector(".barra").getBoundingClientRect().height + "px" : "";
  requestAnimationFrame(disegnaFili);
}
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape" || document.querySelector("dialog[open]") || ev.target.isContentEditable) return;
  chiudiCassetti();
});
$("apri-lato").addEventListener("click", () => $("app").classList.add("lato-aperto"));
document.querySelector("[data-chiudi-lato]").addEventListener("click", chiudiCassetti);
$("velo").addEventListener("click", chiudiCassetti);

// ------------------------------------------------ sezioni (dall'indirizzo: #chat, #missioni, #lavagna…)
const TITOLI = { chat: t("Chat"), home: t("Stato"), agenti: t("Squadra"), missioni: t("Missioni"), scadenze: t("Scadenze"), telefono: t("Telefono"),
  server: t("Server"), memoria: t("Memoria"), tecnico: t("Tecnico"), lavagna: t("Lavagna") };
function mostraVista() {
  // #lavori era una scheda a sé fino al 26/09/2026: i vecchi segnalibri portano ai lavori dentro la Squadra
  if (location.hash === "#lavori") {
    history.replaceState(null, "", "#agenti");
    requestAnimationFrame(() => $("blocco-lavori").scrollIntoView({ block: "start" }));
  }
  const v = (location.hash || "#chat").slice(1);
  const nome = TITOLI[v] ? v : "chat";
  const intera = PANNELLI.includes(nome);
  if (!intera) ultimaVista = nome;
  for (const s of document.querySelectorAll(".vista")) s.classList.toggle("attiva", s.dataset.vista === ultimaVista);
  for (const a of document.querySelectorAll(".menu a")) a.classList.toggle("attiva", a.dataset.vista === nome);
  $("vista-titolo").textContent = TITOLI[nome];
  document.title = `${TITOLI[nome]} · Jarvis`;
  // arancione nel banco tecnico: il collaudo non si scambia per il pannello di tutti i giorni
  document.body.classList.toggle("modo-tecnico", nome === "tecnico");
  if (intera) { scegliPannello(nome); paginaIntera(true); return; }
  paginaIntera(false);
  if (nome === "tecnico") caricaTecnico();
  if (nome === "chat") { disegnaMessaggi(); aggiornaInvia(); }
}
window.addEventListener("hashchange", () => { mostraVista(); $("app").querySelector("main").scrollTop = 0; });

// ------------------------------------------------ motore
// Quale CLI/API risponde alla prossima chat rapida: Claude Code, Gemini, Cursor, Codex
// (quelli non installati si vedono ma sono bloccati). Stato sul server, via /api/motore:
// un solo file, non duplicarlo qui.
async function caricaMotore() {
  const stato = await api("/api/motore");
  const elenco = $("motore-elenco");
  elenco.innerHTML = "";
  for (const m of stato.motori) {
    elenco.append(el("button", {
      class: "motore-voce" + (m.id === stato.attivo ? " attivo" : ""),
      disabled: !m.pronto,
      title: m.pronto ? "" : t("da installare"),
      onclick: () => sceltaMotore(m.id),
    },
      el("span", { class: "pallino " + (m.id === stato.attivo ? "verde" : "grigio") }),
      el("span", {}, m.nome),
      el("small", {}, m.pronto ? "" : t("da installare")),
    ));
  }
}
async function sceltaMotore(id) {
  try {
    await api("/api/motore", { motore: id });
    caricaMotore();
  } catch (e) { toast(e.message, true); }
}

// ------------------------------------------------ avvio
scegliPannello("lavagna");
aggiornaTestaChat();
mostraVista();
orologio();
setInterval(orologio, 1000);
catalogo().then(() => { disegnaGruppi(); aggiornaTestaChat(); disegnaMessaggi(); caricaModifiche(); return caricaPannello(); })
  .catch((e) => toast(e.message, true));
caricaMotore().catch((e) => toast(e.message, true));
// I giri di lettura: veloci con la pagina davanti, quasi fermi con la scheda nascosta (prima
// giravano sempre, anche in background). Tornando visibile si rilegge subito.
// «visibile» può essere una funzione: il ritmo di aggiorna() cambia col flusso (qui sotto).
function ogni(fn, visibile, nascosta) {
  let timer = null;
  const giro = async () => {
    clearTimeout(timer);
    try { await fn(); } catch (e) { /* il giro dopo riprova */ }
    finally {
      clearTimeout(timer);
      timer = setTimeout(giro, document.hidden ? nascosta : typeof visibile === "function" ? visibile() : visibile);
    }
  };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) giro(); });
  giro();
}

// ------------------------------------------------ tempo reale (contratto, punto 1, 26/09/2026)
// Il server manda un evento a ogni cambio di stato su /api/flusso (Server-Sent Events): la pagina
// rilegge /api/stato subito, con 300 ms di attesa per raccogliere gli eventi vicini. Con il flusso
// vivo il sondaggio scende a uno ogni 15 s (rete di sicurezza); se il flusso cade resta a 15 s e
// si ricollega con attesa crescente, da 2 a 30 s. Il server vecchio non ha /api/flusso (404):
// allora resta il sondaggio di prima, ogni 4 s. EventSource non manda intestazioni: il token va
// nell'indirizzo, e il server lo accetta solo lì.
const FLUSSO = { stato: "sondaggio", es: null, versione: null, attesa: 2000, timer: null, rimbalzo: null, provato: false };
let ritmoAggiorna = 4000;
function flussoSegna(stato) {
  FLUSSO.stato = stato;
  const n = $("flusso"), vivo = stato === "live";
  n.textContent = vivo ? "● " + t("live") : "○ " + t("sondaggio");
  n.className = "flusso" + (vivo ? " vivo" : "");
  n.title = vivo ? t("Aggiornamenti in tempo reale dal server")
    : stato === "assente" ? t("Il server non ha il flusso in tempo reale: rileggo lo stato ogni 4 s")
    : t("Flusso in tempo reale caduto: rileggo ogni 15 s e riprovo a collegarmi");
}
function chiediAggiorna() {
  clearTimeout(FLUSSO.rimbalzo);
  FLUSSO.rimbalzo = setTimeout(() => aggiorna(true), 300);
}
async function flussoApri() {
  if (FLUSSO.es || FLUSSO.stato === "assente") return;
  if (!("EventSource" in window)) { flussoSegna("assente"); return; }
  const url = "/api/flusso?token=" + encodeURIComponent(TOKEN);
  // EventSource non dice il codice di risposta: una prova sola, all'avvio, per riconoscere il 404
  if (!FLUSSO.provato) {
    FLUSSO.provato = true;
    const ctl = new AbortController();
    const tetto = setTimeout(() => ctl.abort(), 5000);
    try {
      const r = await fetch(url, { headers: { "X-Token": TOKEN }, signal: ctl.signal, cache: "no-store" });
      if (r.status === 404) { flussoSegna("assente"); return; }
    } catch (e) { /* rete giù o prova troppo lenta: ci pensa la riconnessione */ }
    finally { clearTimeout(tetto); ctl.abort(); }
  }
  const es = new EventSource(url);
  FLUSSO.es = es;
  es.onopen = () => { FLUSSO.attesa = 2000; ritmoAggiorna = 15000; flussoSegna("live"); chiediAggiorna(); };
  es.onmessage = (ev) => {
    let d;
    try { d = JSON.parse(ev.data); } catch (e) { return; }
    if (d.versione != null && d.versione === FLUSSO.versione) return;
    if (d.versione != null) FLUSSO.versione = d.versione;
    if ((d.chiavi || []).includes("scadenze")) caricaScadenze();
    if ((d.chiavi || []).includes("spazi")) caricaSpazi();
    if ((d.chiavi || []).includes("modifiche")) caricaModifiche();
    if ((d.chiavi || []).includes("pannello")) aggiornaAllineamento();
    chiediAggiorna();
  };
  es.onerror = () => {
    es.close();
    FLUSSO.es = null;
    ritmoAggiorna = 15000;
    flussoSegna("caduto");
    clearTimeout(FLUSSO.timer);
    FLUSSO.timer = setTimeout(flussoApri, FLUSSO.attesa);
    FLUSSO.attesa = Math.min(30000, FLUSSO.attesa * 2);
  };
}

ogni(aggiorna, () => ritmoAggiorna, 60000);
flussoApri();
ogni(seguiRisposte, 1500, 15000);           // una risposta che arriva a scheda nascosta si prende lo stesso
ogni(aggiornaChatVoce, 2000, 5 * 60000);
addEventListener("resize", () => requestAnimationFrame(disegnaFili));

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

// ------------------------------------------------ lingua del pannello
// Il selettore in barra: la scelta si salva sul server («lingua» in configurazione.json) e la
// pagina si ricarica, così ogni testo (anche quelli già disegnati) passa alla lingua nuova.
(function selettoreLingua() {
  const sel = $("lingua");
  if (!sel) return;
  sel.value = LINGUA;
  sel.title = t("Lingua del pannello");
  sel.setAttribute("aria-label", t("Lingua del pannello"));
  // dal telefono la lingua si legge ma si sceglie sul computer: è una voce di configurazione.json
  if (DAL_TELEFONO) { sel.disabled = true; sel.title = t("La lingua si cambia dal computer"); return; }
  sel.addEventListener("change", async () => {
    sel.disabled = true;
    const d = await azione({ tipo: "lingua", lingua: sel.value });
    if (d) location.reload(); else { sel.value = LINGUA; sel.disabled = false; }
  });
})();

// ------------------------------------------------ accesso dal telefono
// Il box nella scheda Telefono: stato, codice QR con l'indirizzo della rete di casa e il codice di
// accesso, fino a quando vale, e i pulsanti per accendere, spegnere e cambiare il codice.
// Si vede solo sul computer: dal telefono il server risponde 403 e il box sparisce.
const ACCESSO_MOTIVO = {
  spento: t("Spento: il pannello risponde solo su questo computer."),
  errore: t("Acceso, ma la rete di casa non si apre"),
};
function disegnaAccesso(d) {
  const box = $("accesso");
  if (!box) return;
  const btn = (cosa) => box.querySelector(`[data-accesso="${cosa}"]`);
  const qr = $("accesso-qr");
  if (d.attivo) {
    $("accesso-stato").textContent = t("Acceso: inquadra il codice con il telefono");
    $("accesso-riga-indirizzo").classList.remove("nascosto");
    // l'indirizzo senza il codice: il codice sta solo nel QR
    $("accesso-indirizzo").textContent = String(d.indirizzo || "").split("?")[0];
    qr.innerHTML = d.svg || "";          // SVG disegnato dal server (qr.py), niente testo esterno
    qr.classList.remove("nascosto");
    $("accesso-scadenza").textContent = d.scade ? t("Il codice vale fino al {data} ({giorni} giorni dalla creazione).", { data: d.scade, giorni: d.giorni }) : "";
  } else {
    $("accesso-stato").textContent = (ACCESSO_MOTIVO[d.motivo] || "") + (d.errore ? ": " + d.errore : "");
    $("accesso-riga-indirizzo").classList.add("nascosto");
    qr.replaceChildren();
    qr.classList.add("nascosto");
    $("accesso-scadenza").textContent = "";
  }
  btn("accendi").classList.toggle("nascosto", d.acceso);
  btn("spegni").classList.toggle("nascosto", !d.acceso);
  btn("nuovo_codice").classList.toggle("nascosto", !d.attivo);
}
async function caricaAccesso() {
  const box = $("accesso");
  if (!box) return;
  if (DAL_TELEFONO) { box.remove(); return; }
  try { disegnaAccesso(await api("/api/accesso_telefono")); }
  catch (e) { $("accesso-stato").textContent = e.message; }
}
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-accesso]");
  if (!b) return;
  const cosa = b.dataset.accesso;
  if (cosa === "accendi" && !confirm(t("Accendo l'accesso dal telefono?\n\nIl pannello risponderà anche nella rete di casa (Wi-Fi), solo a chi ha il codice del QR. Da Internet non si raggiunge."))) return;
  if (cosa === "nuovo_codice" && !confirm(t("Faccio un codice nuovo?\n\nI telefoni che usano quello di adesso dovranno inquadrare di nuovo il QR."))) return;
  b.disabled = true;
  try {
    disegnaAccesso(await api("/api/accesso_telefono", { cosa }, 20000));
    toast(cosa === "accendi" ? t("Accesso dal telefono acceso") : cosa === "spegni" ? t("Accesso dal telefono spento") : t("Codice nuovo: inquadra di nuovo il QR"));
  } catch (e) { toast(e.message, true); }
  finally { b.disabled = false; }
});
caricaAccesso();
setInterval(() => { if (!document.hidden && location.hash === "#telefono") caricaAccesso(); }, 30000);
window.addEventListener("hashchange", () => { if (location.hash === "#telefono") caricaAccesso(); });
// ✕ delle schede (27/09/2026): ora sono type="button", così Invio salva invece di chiudere e perdere tutto
document.addEventListener("click", (ev) => {
  const x = ev.target.closest("dialog .chiudi-dialog");
  if (x) x.closest("dialog").close("chiudi");
});
$("sa-comunica-nuovo").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") { ev.preventDefault(); $("sa-comunica-aggiungi").click(); }
});
$("esito-chiudi").addEventListener("click", () => $("esito-box").classList.add("nascosto"));

// «Togli gruppo» archivia un progetto intero: da qui si riporta indietro
function disegnaGruppiArchiviati(lista) {
  const box = $("gruppi-archiviati");
  if (!Array.isArray(lista) || !lista.length) { box.classList.add("nascosto"); return; }
  box.classList.remove("nascosto");
  box.querySelector("summary").textContent = `${t("Gruppi archiviati")} (${lista.length})`;
  $("gruppi-archiviati-lista").replaceChildren(...lista.map((g) => el("li", {},
    el("span", {}, g.nome || g.progetto), " ",
    el("button", { type: "button", class: "piccolo", title: t("Rimette progetto e agenti com'erano"),
      onclick: async (ev) => {
        if (!confirm(t("Ripristinare il gruppo {nome}? Profili e voce negli spazi tornano com'erano.", { nome: g.nome || g.progetto }))) return;
        const d = await azione({ tipo: "agente", cosa: "ripristina_gruppo", progetto: g.progetto }, ev.currentTarget);
        if (d) caricaSpazi();
      } }, t("Ripristina")))));
}
