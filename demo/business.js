"use strict";
// Jarvis Business: le parti del pannello che sono solo del prodotto (2026-10-05). Si carica PRIMA di app.js.
// Il resto del pannello (app.js, temi, Dots, barra, pagine) arriva dal Jarvis vero con strumenti/porta_su_business.py
// del venditore, sempre uguale: qui stanno le cose che il prodotto ha in più e che quel giro non deve toccare.
//
//  1. Cinque lingue: it (riferimento), en, es, fr, de. Il server mette nella pagina la lingua (window.CC_LINGUA) e il
//     dizionario (window.CC_TESTI, da static/lingue/<codice>.json): la chiave è il testo italiano, con i segnaposto
//     {nome}. Per il codice c'è t("testo") come prima; tutto il resto lo traduce da sola la pagina: ogni testo,
//     title, placeholder e aria-label che compare (anche dopo, con un MutationObserver) e che sta nel dizionario.
//     Una chiave con i segnaposto vale anche per i testi composti («Hai {n} agenti» traduce «Hai 3 agenti»).
//     Anche confirm, alert e prompt passano dal dizionario. Un testo che non c'è resta in italiano.
//  2. Accesso: sul computer vale il cookie di sessione (link monouso); dal telefono il codice del QR, che la pagina
//     tiene in localStorage e manda in X-Token (window.CC_TOKEN, che app.js usa per ogni richiesta).
//  3. Selettore della lingua in barra, box «Accesso dal telefono» (pagina Telefono) e box «Versione» (pagina Stato).
const LINGUE = { it: "Italiano", en: "English", es: "Español", fr: "Français", de: "Deutsch" };
const LINGUA = LINGUE[window.CC_LINGUA] ? window.CC_LINGUA : "it";
const TESTI = (window.CC_TESTI && typeof window.CC_TESTI === "object") ? window.CC_TESTI : {};
const LOCALE = { it: "it-IT", en: "en-GB", es: "es-ES", fr: "fr-FR", de: "de-DE" }[LINGUA];
function t(testo, valori) {
  const s = (LINGUA !== "it" && TESTI[testo]) || testo;
  return valori ? s.replace(/\{(\w+)\}/g, (m, k) => (k in valori && valori[k] != null ? String(valori[k]) : m)) : s;
}
// chi usa il pannello: l'appellativo scelto all'installazione, messo nella pagina dal server
const UTENTE = (window.CC_UTENTE && window.CC_UTENTE !== "__UTENTE__") ? window.CC_UTENTE : "Capo";
const DAL_TELEFONO = window.CC_DOVE === "rete";
window.CC_TOKEN = (() => {
  if (!DAL_TELEFONO) return "";
  const q = new URLSearchParams(location.search).get("t") || "";
  if (q) {
    try { localStorage.setItem("cc.token_telefono", q); } catch (e) { /* resta nell'indirizzo */ }
    history.replaceState(null, "", location.pathname + location.hash);
    return q;
  }
  try { return localStorage.getItem("cc.token_telefono") || ""; } catch (e) { return ""; }
})();

// ---------------------------------------------------------------- traduzione della pagina
const ATTR_TRADOTTI = ["title", "placeholder", "aria-label", "data-chiedi"];
const traduci = (() => {
  if (LINGUA === "it") return (s) => s;
  // le chiavi con {segnaposto} diventano espressioni: «Hai {n} agenti» → /^Hai (.+?) agenti$/
  const modelli = [];
  for (const [k, v] of Object.entries(TESTI)) {
    if (!/\{\w+\}/.test(k)) continue;
    const nomi = [];
    const rx = k.split(/(\{\w+\})/).map((p) => {
      const m = p.match(/^\{(\w+)\}$/);
      if (m) { nomi.push(m[1]); return "(.+?)"; }
      return p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("");
    const prima = k.split("{")[0];
    modelli.push({ rx: new RegExp("^" + rx + "$"), nomi, v, prima });
  }
  modelli.sort((a, b) => b.prima.length - a.prima.length);   // prima i più precisi
  const cache = new Map();
  return (s) => {
    if (!s) return s;
    if (TESTI[s]) return TESTI[s];
    if (cache.has(s)) return cache.get(s);
    let out = s;
    if (s.length < 400) {
      for (const m of modelli) {
        if (m.prima && !s.startsWith(m.prima)) continue;
        const r = s.match(m.rx);
        if (!r) continue;
        const valori = {};
        m.nomi.forEach((n, i) => { valori[n] = traduciPezzo(r[i + 1]); });
        out = m.v.replace(/\{(\w+)\}/g, (x, n) => (n in valori ? valori[n] : x));
        break;
      }
    }
    if (cache.size > 3000) cache.clear();
    cache.set(s, out);
    return out;
  };
  function traduciPezzo(p) { return TESTI[p.trim()] ? p.replace(p.trim(), TESTI[p.trim()]) : p; }
})();
const SALTA = "script,style,code,pre,textarea,[translate=no],[contenteditable],.messaggi .testo,.messaggi .md,.uscita";
function traduciNodoTesto(n) {
  const p = n.parentElement;
  if (!p || p.closest(SALTA)) return;
  const v = n.nodeValue;
  const chiave = v.replace(/\s+/g, " ").trim();
  if (!chiave || !/[A-Za-zÀ-ÿ]/.test(chiave)) return;
  const tr = traduci(chiave);
  if (tr === chiave) return;
  const [, prima, dopo] = v.match(/^(\s*)[\s\S]*?(\s*)$/);
  n.nodeValue = prima + tr + dopo;
}
function traduciAttributi(e) {
  if (e.closest && e.closest("script,style,[translate=no]")) return;
  for (const a of ATTR_TRADOTTI) {
    const v = e.getAttribute && e.getAttribute(a);
    if (!v || !v.trim()) continue;
    // un title fatto di più paragrafi (descrizione, riga vuota, «clic: chatta…») si traduce un paragrafo alla volta
    const tr = v.split(/(\n\s*\n)/).map((p, i) => (i % 2 ? p : (() => {
      const k = p.replace(/\s+/g, " ").trim();
      return k ? p.replace(p.trim(), traduci(k)) : p;
    })())).join("");
    if (tr !== v) e.setAttribute(a, tr);
  }
}
function traduciPagina(radice) {
  if (LINGUA === "it" || !radice) return;
  if (radice.nodeType === 3) { traduciNodoTesto(radice); return; }
  if (radice.nodeType !== 1 && radice.nodeType !== 9) return;
  const giro = document.createTreeWalker(radice, NodeFilter.SHOW_TEXT);
  const testi = [];
  while (giro.nextNode()) testi.push(giro.currentNode);
  for (const n of testi) traduciNodoTesto(n);
  if (radice.nodeType === 1) traduciAttributi(radice);
  for (const e of (radice.querySelectorAll ? radice.querySelectorAll("[title],[placeholder],[aria-label],[data-chiedi]") : [])) traduciAttributi(e);
}
document.documentElement.lang = LINGUA;
if (LINGUA !== "it") {
  // il testo della pagina man mano che compare: niente da cambiare nel codice che lo scrive
  const osserva = new MutationObserver((cambi) => {
    for (const c of cambi) {
      if (c.type === "characterData") traduciNodoTesto(c.target);
      else if (c.type === "attributes") traduciAttributi(c.target);
      else for (const n of c.addedNodes) traduciPagina(n);
    }
  });
  const parti = () => {
    traduciPagina(document.head);
    traduciPagina(document.body);
    osserva.observe(document.documentElement, { childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTR_TRADOTTI });
  };
  if (document.body) parti(); else document.addEventListener("DOMContentLoaded", parti, { once: true });
  // le finestre del browser non passano dalla pagina: si traducono qui
  const conferma = window.confirm.bind(window), avvisa = window.alert.bind(window), chiedi = window.prompt.bind(window);
  const tr = (s) => (typeof s === "string" ? s.split("\n\n").map((p) => traduci(p.trim()) === p.trim() ? p : traduci(p.trim())).join("\n\n") : s);
  window.confirm = (s) => conferma(tr(s));
  window.alert = (s) => avvisa(tr(s));
  window.prompt = (s, d) => chiedi(tr(s), d);
}

// ---------------------------------------------------------------- dopo app.js
document.addEventListener("DOMContentLoaded", () => {
  const $$ = (id) => document.getElementById(id);
  const chiama = (p, c, tetto) => window.api(p, c, tetto);                       // api() di app.js
  const breve = (testo, errore) => (typeof window.toast === "function" ? window.toast(testo, errore) : null);

  // ---- lingua del pannello: la scelta si salva sul server («lingua» in configurazione.json) e la pagina si ricarica
  const sel = $$("lingua");
  if (sel) {
    sel.value = LINGUA;
    sel.title = t("Lingua del pannello");
    sel.setAttribute("aria-label", t("Lingua del pannello"));
    if (DAL_TELEFONO) { sel.disabled = true; sel.title = t("La lingua si cambia dal computer"); }
    else sel.addEventListener("change", async () => {
      sel.disabled = true;
      try { await chiama("/api/azione", { tipo: "lingua", lingua: sel.value }, 20000); location.reload(); }
      catch (e) { breve(e.message, true); sel.value = LINGUA; sel.disabled = false; }
    });
  }

  // ---- versione di Jarvis (box nella pagina Stato): s.aggiornamento di /api/stato
  function disegnaVersione(a) {
    const testo = $$("ver-testo");
    if (!testo) return;
    if (!a) { testo.textContent = t("il server non dice la versione"); return; }
    const righe = [`Jarvis ${a.versione || "?"}`];
    if (a.in_corso) righe.push(t("aggiornamento in corso: lo segui in Squadra › Lavori"));
    else if (a.fallita) righe.push(t("l'aggiornamento alla {nuova} non è riuscito: sei rimasto alla {versione}, non hai perso niente", { nuova: a.fallita, versione: a.versione }));
    else if (a.nuova) righe.push(t("è uscita la {versione}", { versione: a.nuova }));
    else righe.push(t("è l'ultima versione"));
    if (!a.si_aggiorna) righe.push(t("questa copia non si aggiorna da qui"));
    testo.textContent = righe.join(" · ");
    testo.className = "ver-testo" + (a.fallita ? " attenzione" : a.nuova ? " nuova" : "");
    $$("ver-controllato").textContent = a.controllato ? t("controllato il {data}", { data: a.controllato }) : "";
    $$("ver-aggiorna").classList.toggle("nascosto", !(a.nuova && a.si_aggiorna));
    $$("ver-indietro").classList.toggle("nascosto", !(a.copie > 0 && a.si_aggiorna));
    for (const b of document.querySelectorAll("[data-aggiornamento]")) b.disabled = !!a.in_corso || !a.si_aggiorna;
  }
  let ultimaVersione = "";
  async function leggiVersione() {
    try {
      const s = await chiama("/api/stato?parti=aggiornamento");
      const firma = JSON.stringify(s.aggiornamento || null);
      if (firma !== ultimaVersione) { ultimaVersione = firma; disegnaVersione(s.aggiornamento); }
    } catch (e) { /* al giro dopo */ }
  }
  if ($$("box-versione")) {
    leggiVersione();
    setInterval(() => { if (!document.hidden && /^#home/.test(location.hash)) leggiVersione(); }, 60000);
    window.addEventListener("hashchange", () => { if (/^#home/.test(location.hash)) leggiVersione(); });
  }
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-aggiornamento]");
    if (!b) return;
    const cosa = b.dataset.aggiornamento;
    if (cosa === "torna-indietro" && !confirm(t("Tornare alla versione di prima? I tuoi dati non si toccano."))) return;
    b.disabled = true;
    try {
      const d = await chiama("/api/azione", { tipo: "aggiornamento", cosa }, 60000);
      if (d && d.lavoro) breve(t("{titolo}: lo segui in Squadra › Lavori", { titolo: d.lavoro.titolo }));
      leggiVersione();
    } catch (e) { breve(e.message, true); } finally { b.disabled = false; }
  });

  // ---- accesso dal telefono (pagina Telefono): QR con l'indirizzo della rete di casa e il codice, solo dal computer
  const ACCESSO_MOTIVO = {
    spento: t("Spento: il pannello risponde solo su questo computer."),
    errore: t("Acceso, ma la rete di casa non si apre"),
  };
  function disegnaAccesso(d) {
    const box = $$("accesso");
    if (!box) return;
    const btn = (cosa) => box.querySelector(`[data-accesso="${cosa}"]`);
    const qr = $$("accesso-qr");
    if (d.attivo) {
      $$("accesso-stato").textContent = t("Acceso: inquadra il codice con il telefono");
      $$("accesso-riga-indirizzo").classList.remove("nascosto");
      $$("accesso-indirizzo").textContent = String(d.indirizzo || "").split("?")[0];   // il codice sta solo nel QR
      qr.innerHTML = d.svg || "";                     // SVG disegnato dal server (qr.py), niente testo esterno
      qr.classList.remove("nascosto");
      $$("accesso-scadenza").textContent = d.scade ? t("Il codice vale fino al {data} ({giorni} giorni dalla creazione).", { data: d.scade, giorni: d.giorni }) : "";
    } else {
      $$("accesso-stato").textContent = (ACCESSO_MOTIVO[d.motivo] || "") + (d.errore ? ": " + d.errore : "");
      $$("accesso-riga-indirizzo").classList.add("nascosto");
      qr.replaceChildren();
      qr.classList.add("nascosto");
      $$("accesso-scadenza").textContent = "";
    }
    $$("accesso-riga-conferme").classList.toggle("nascosto", !d.acceso);
    $$("accesso-conferme").checked = !!d.conferme;
    btn("accendi").classList.toggle("nascosto", d.acceso);
    btn("spegni").classList.toggle("nascosto", !d.acceso);
    btn("nuovo_codice").classList.toggle("nascosto", !d.attivo);
  }
  async function caricaAccesso() {
    const box = $$("accesso");
    if (!box) return;
    if (DAL_TELEFONO) { box.remove(); return; }
    try { disegnaAccesso(await chiama("/api/accesso_telefono")); }
    catch (e) { $$("accesso-stato").textContent = e.message; }
  }
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-accesso]");
    if (!b) return;
    const cosa = b.dataset.accesso;
    if (cosa === "accendi" && !confirm(t("Accendo l'accesso dal telefono?\n\nIl pannello risponderà anche nella rete di casa (Wi-Fi), solo a chi ha il codice del QR. Da Internet non si raggiunge."))) return;
    if (cosa === "nuovo_codice" && !confirm(t("Faccio un codice nuovo?\n\nI telefoni che usano quello di adesso dovranno inquadrare di nuovo il QR."))) return;
    b.disabled = true;
    try {
      disegnaAccesso(await chiama("/api/accesso_telefono", { cosa }, 20000));
      breve(cosa === "accendi" ? t("Accesso dal telefono acceso") : cosa === "spegni" ? t("Accesso dal telefono spento") : t("Codice nuovo: inquadra di nuovo il QR"));
    } catch (e) { breve(e.message, true); }
    finally { b.disabled = false; }
  });
  const conferme = $$("accesso-conferme");
  if (conferme) conferme.addEventListener("change", async (ev) => {
    const c = ev.currentTarget, valore = c.checked;
    if (valore && !confirm(t("Dal telefono si potrà dire Sì alle azioni irreversibili delle missioni (cancellare, pubblicare, mandare messaggi). Accendo?"))) { c.checked = false; return; }
    c.disabled = true;
    try {
      disegnaAccesso(await chiama("/api/accesso_telefono", { cosa: "conferme", valore }, 20000));
      breve(valore ? t("Dal telefono il Sì alle conferme è acceso") : t("Dal telefono il Sì alle conferme è spento"));
    } catch (e) { c.checked = !valore; breve(e.message, true); }
    finally { c.disabled = false; }
  });
  caricaAccesso();
  setInterval(() => { if (!document.hidden && /^#telefono/.test(location.hash)) caricaAccesso(); }, 30000);
  window.addEventListener("hashchange", () => { if (/^#telefono/.test(location.hash)) caricaAccesso(); });
});
