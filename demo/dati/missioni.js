// Dati finti della demo: le missioni già presenti, le sinapsi (chi parla con chi) e le scadenze.
window.DATI_DEMO = window.DATI_DEMO || {};

// «fa» = minuti fa. Gli agenti: stato, minuti di inizio e fine rispetto all'inizio della missione.
DATI_DEMO.missioni = [
  {
    chiave: "lancio", spazio: "negozio", progetto: "shop", fa: 27, modalita: "lavoro", max: 5,
    obiettivo: "Prepara il lancio della collezione autunno: schede prodotto, scorte e parole chiave, poi pubblica",
    stato: "attende conferma",
    richiesta: { strumento: "Pubblica sul negozio", sintesi: "Pubblicare le 12 schede nuove della collezione autunno sul negozio online, visibili a tutti da subito.",
      dettaglio: "negozio pubblica --collezione autunno --schede 12 --visibili", fa: 12 },
    agenti: [
      { nome: "copywriter", stato: "consegnato", da: 1, a: 9, descrizione: "schede delle 12 novità",
        esito: "12 schede scritte, una per prodotto.\n\nOgni scheda ha titolo, tre righe di descrizione, materiali e guida alle taglie. Tono caldo, frasi corte. I file sono in «Negozio online/schede/autunno»." },
      { nome: "analista-vendite", stato: "consegnato", da: 1, a: 7, descrizione: "scorte per taglia",
        esito: "L'anno scorso le taglie M e L dei maglioni sono finite in 9 giorni.\n\nProposta: +30% di scorta su M e L, invariato il resto. Costo stimato del riordino: 1.260 €." },
      { nome: "seo-catalogo", stato: "consegnato", da: 2, a: 10, descrizione: "parole chiave e titoli",
        esito: "Parole chiave principali: «maglione lana merino uomo», «sciarpa a coste», «cardigan donna lana».\n\nTitoli riscritti su 12 schede; nessuna scheda supera i 60 caratteri di titolo." },
      { nome: "revisore", stato: "lavora", da: 11, descrizione: "controllo di testi e prezzi", ultima: "Read: schede/autunno/cardigan-donna.md" },
    ],
    registro: [
      [0, "orchestratore: missione ricevuta da Jarvis, 4 esperti in parallelo, modo lavoro"],
      [1, "lancio copywriter: schede delle 12 novità"],
      [1, "lancio analista-vendite: scorte per taglia"],
      [2, "lancio seo-catalogo: parole chiave e titoli"],
      [7, "consegnato analista-vendite"],
      [9, "consegnato copywriter"],
      [10, "consegnato seo-catalogo"],
      [11, "lancio revisore: controllo di testi e prezzi"],
      [15, "conferma chiesta: Pubblica sul negozio (aspetta il sì di Capo)"],
    ],
    // dopo il Sì: il revisore consegna, il capogruppo verifica e la missione si chiude
    dopo: {
      revisore: "Controllate 12 schede: due refusi corretti, prezzi uguali al listino. Si può pubblicare.",
      capogruppo: "Verificato il lavoro della squadra.\n\n- 12 schede pubblicate\n- scorte M e L: riordino proposto (+30%)\n- titoli e parole chiave a posto\n\nLa collezione autunno è online.",
    },
  },
  {
    chiave: "fatture", spazio: "studio", progetto: "studio", fa: 1500, modalita: "lettura", max: 3,
    obiettivo: "Controlla le fatture di settembre e prepara il riepilogo per il commercialista",
    stato: "chiusa", durata: 14,
    report: "~/Jarvis/Report/Studio/Riepilogo fatture settembre.pdf",
    agenti: [
      { nome: "contabile", stato: "consegnato", da: 1, a: 8, descrizione: "fatture di settembre",
        esito: "41 fatture emesse, 27 ricevute.\n\n- Totale emesso: 18.420 € + IVA\n- Totale ricevuto: 6.905 € + IVA\n- 3 fatture scartate dallo SdI per un codice destinatario sbagliato: già rimandate." },
      { nome: "legale-contratti", stato: "consegnato", da: 2, a: 9, descrizione: "contratti in scadenza",
        esito: "Due contratti si rinnovano da soli a novembre: l'assistenza del gestionale (disdetta entro il 31/10) e il noleggio della stampante." },
      { nome: "ceo-studio", capogruppo: true, stato: "consegnato", da: 10, a: 14, descrizione: "verifica e riepilogo",
        esito: "Riepilogo per il commercialista pronto.\n\nSettembre in breve:\n- 41 fatture emesse (18.420 € + IVA), 27 ricevute (6.905 € + IVA)\n- 3 scarti SdI corretti e rimandati\n- da decidere entro il 31/10: disdetta dell'assistenza del gestionale\n\nIl PDF è in Report › Studio. Nessuna modifica fatta: missione in sola lettura." },
    ],
    registro: [
      [0, "orchestratore: missione ricevuta da Jarvis, 2 esperti in parallelo, modo lettura"],
      [1, "lancio contabile: fatture di settembre"],
      [2, "lancio legale-contratti: contratti in scadenza"],
      [8, "consegnato contabile"],
      [9, "consegnato legale-contratti"],
      [10, "lancio ceo-studio (capogruppo): verifica e riepilogo"],
      [14, "consegnato ceo-studio · report scritto · missione chiusa"],
    ],
  },
  {
    chiave: "bollette", spazio: "casa", progetto: "casa", fa: 4320, modalita: "lettura", max: 2,
    obiettivo: "Confronta le offerte di luce e gas con le bollette degli ultimi 12 mesi",
    stato: "chiusa", durata: 9,
    report: "~/Jarvis/Report/Casa/Luce e gas.pdf",
    agenti: [
      { nome: "bollette", stato: "consegnato", da: 1, a: 9, descrizione: "confronto offerte",
        esito: "Consumo annuo: 2.150 kWh e 780 Smc.\n\nL'offerta attuale costa circa 1.480 € l'anno. Due offerte a prezzo fisso costano tra 1.330 e 1.370 €: risparmio di circa 120 € l'anno. Nessuna penale per cambiare." },
    ],
    registro: [
      [0, "orchestratore: missione ricevuta da Jarvis, 1 esperto, modo lettura"],
      [1, "lancio bollette: confronto offerte"],
      [9, "consegnato bollette · missione chiusa"],
    ],
  },
];

// Le sinapsi: una comunicazione ogni pochi secondi, in giro continuo. Chiavi: boss (l'utente),
// jarvis, memoria, sentinella o «progetto:agente».
DATI_DEMO.sinapsi = [
  { da: "boss", a: "jarvis", tipo: "richiesta", testo: "Come va il lancio della collezione?" },
  { da: "jarvis", a: "shop:ceo-negozio", tipo: "richiesta", testo: "A che punto è il lancio? Il Capo chiede." },
  { da: "shop:ceo-negozio", a: "shop:revisore", tipo: "richiesta", testo: "Ti mancano molte schede da controllare?" },
  { da: "shop:revisore", a: "shop:copywriter", tipo: "richiesta", testo: "Nel cardigan manca la composizione: 70% lana, 30% cashmere?" },
  { da: "shop:copywriter", a: "shop:revisore", tipo: "risposta", testo: "Sì, corretto. Aggiunta anche la guida lavaggio." },
  { da: "shop:ceo-negozio", a: "shop:analista-vendite", tipo: "richiesta", testo: "Le scorte di M e L arrivano per sabato?" },
  { da: "shop:analista-vendite", a: "shop:ceo-negozio", tipo: "risposta", testo: "Il fornitore consegna venerdì: 40 pezzi in più." },
  { da: "shop:seo-catalogo", a: "shop:copywriter", tipo: "richiesta", testo: "Metti «lana merino» nelle prime tre parole del titolo." },
  { da: "jarvis", a: "memoria", tipo: "richiesta", testo: "Salvo la decisione: +30% di scorta su M e L." },
  { da: "shop:ceo-negozio", a: "jarvis", tipo: "risposta", testo: "Pronto: schede, scorte e SEO. Serve il sì per pubblicare." },
  { da: "jarvis", a: "boss", tipo: "risposta", testo: "Il lancio è pronto: aspetto il tuo sì in Missioni." },
  { da: "jarvis", a: "social:ceo-social", tipo: "lancio", testo: "Prepara tre post per il lancio di sabato." },
  { da: "social:ceo-social", a: "social:social-media", tipo: "richiesta", testo: "Tre post: teaser giovedì, lancio sabato, dietro le quinte domenica." },
  { da: "social:ceo-social", a: "social:grafico", tipo: "richiesta", testo: "Formato quadrato e storie, colori caldi." },
  { da: "social:social-media", a: "shop:copywriter", tipo: "richiesta", testo: "Mi passi le tre frasi migliori delle schede?" },
  { da: "social:grafico", a: "social:ceo-social", tipo: "risposta", testo: "Tre bozze pronte, la seconda è la mia preferita." },
  { da: "jarvis", a: "studio:ceo-studio", tipo: "richiesta", testo: "Il riepilogo fatture è partito per il commercialista?" },
  { da: "studio:ceo-studio", a: "studio:contabile", tipo: "richiesta", testo: "Controlla che le 3 fatture scartate siano state accettate." },
  { da: "studio:contabile", a: "studio:ceo-studio", tipo: "risposta", testo: "Accettate tutte e tre stamattina." },
  { da: "sentinella", a: "jarvis", tipo: "sentinella", testo: "Giro regolare: nessuna anomalia." },
  { da: "jarvis", a: "casa:manutenzioni", tipo: "richiesta", testo: "Trova due tecnici per la revisione della caldaia." },
  { da: "casa:manutenzioni", a: "jarvis", tipo: "risposta", testo: "Due disponibili giovedì: 80 € e 95 €." },
];

// Le scadenze: «tra» = giorni da oggi (negativo = passata)
DATI_DEMO.scadenze = {
  registro: [
    { id: "DEC-0927-01", tra: 2, tipo: "DEC", testo: "Scegliere il corriere per le spedizioni di novembre", chi: "ceo-negozio", eur: "4,90 € contro 5,60 € a pacco" },
    { id: "DOM-0927-02", tra: 5, tipo: "DOM", testo: "Rinnovare il dominio del negozio per due anni invece di uno?", chi: "sviluppatore-web", eur: 36 },
    { id: "DEC-0926-03", tra: 21, tipo: "DEC", testo: "Sconto di fine novembre: 15% o 20%?", chi: "ceo-negozio", eur: "" },
    { id: "DOM-0925-04", tra: 40, tipo: "DOM", testo: "Serve un aiuto in magazzino per dicembre?", chi: "analista-vendite", eur: 1400 },
  ],
  personali: [
    { id: "p-dentista", tra: 3, testo: "Visita dal dentista, ore 17:30", eur: 0 },
    { id: "p-caldaia", tra: 9, testo: "Revisione della caldaia", eur: 90 },
    { id: "p-bollo", tra: 12, testo: "Bollo dell'auto", eur: 186 },
    { id: "p-assicurazione", tra: 26, testo: "Rata dell'assicurazione di casa", eur: 240 },
  ],
  task: [
    { id: "t-commercialista", testo: "Chiamare il commercialista per l'F24", aperta: 0 },
    { id: "t-foto", testo: "Foto nuove dei maglioni su sfondo chiaro", aperta: 1 },
    { id: "t-pec", testo: "Rinnovare la PEC dello studio", aperta: 3 },
  ],
  chiuse: [
    { id: "t-listino", fonte: "task", testo: "Aggiornare il listino dei cardigan", chiusa: 1, perche: "fatto dal copywriter" },
    { id: "p-tagliando", fonte: "personali", testo: "Tagliando dell'auto", chiusa: 4, tra: -4 },
    { id: "DEC-0915-09", fonte: "registro", testo: "Spedizione gratuita sopra i 60 €?", chiusa: 9, tra: -8, perche: "decisa: sì" },
  ],
  // cosa risponde «Chiedi a Jarvis: quali sono già fatte?»
  controllo: {
    proposte: [{ fonte: "task", id: "t-foto", perche: "le foto nuove sono già nella cartella del negozio da ieri" }],
    dubbi: "Sul rinnovo della PEC non sono sicuro: la mail di conferma non l'ho trovata. Guardala tu.",
  },
};
