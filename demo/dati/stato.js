// Dati finti della demo: lo stato del computer, del server, della memoria e le liste del pannello.
// I tempi sono scritti come «minuti fa» o «giorni da oggi»: finto.js li trasforma in date vere.
window.DATI_DEMO = window.DATI_DEMO || {};

DATI_DEMO.server = {
  nome: "Server del negozio",
  siti: { "Negozio online": "200", "Area clienti": "200", "Automazioni": "200", "Pannello ordini": "200" },
  contenitori: [
    { nome: "negozio-web", attivo: true, dettaglio: "Up 12 days" },
    { nome: "negozio-db", attivo: true, dettaglio: "Up 12 days (healthy)" },
    { nome: "automazioni", attivo: true, dettaglio: "Up 3 days" },
    { nome: "proxy-https", attivo: true, dettaglio: "Up 12 days" },
    { nome: "copie-notturne", attivo: true, dettaglio: "Up 12 days" },
  ],
  disco: 41, ram: 37,
};

// «Cosa succede»: minuti fa e testo
DATI_DEMO.eventi = [
  [1, "sentinella · giro regolare, nessuna anomalia"],
  [4, "Avviato: Chiedi a Jarvis · riassunto del negozio"],
  [6, "finito: Verifica catalogo (analista-vendite)"],
  [12, "missione Negozio online · attende conferma: Pubblica sul negozio"],
  [19, "copywriter: collegamenti aggiornati nel profilo (2)"],
  [27, "Nuova: missione «lancio collezione autunno» (Negozio online)"],
  [41, "finito: Briefing del mattino"],
  [58, "memoria: battito regolare, 4 progetti in ordine"],
  [95, "rientrata: la connessione del server è tornata dopo 40 s"],
  [130, "Command Center avviato"],
];

// Lavori: minuti fa di inizio, durata in secondi
DATI_DEMO.lavori = [
  { id: "l-briefing", titolo: "Briefing del mattino", chi: "Jarvis", tipo: "comando", dove: "~/Jarvis", fa: 41, durata: 46, turni: 4, costo: "0.04",
    richiesta: "Come siamo messi oggi? Negozio, studio e casa, in dieci righe.",
    testo: "Buongiorno Capo. Ecco il quadro di oggi:\n\n- Negozio: 23 ordini da ieri sera, 2 resi, incasso 1.842 €. Le taglie M e L dei maglioni stanno finendo.\n- Missione in corso: lancio della collezione autunno. Schede pronte, aspetta il tuo sì per pubblicare.\n- Studio: riepilogo fatture di settembre già pronto per il commercialista.\n- Casa: la revisione della caldaia scade tra 9 giorni.\n- Server: tutto verde, disco al 41%.\n\nDa decidere oggi: il corriere per novembre (due preventivi in Scadenze)." },
  { id: "l-catalogo", titolo: "Verifica catalogo: prezzi e giacenze", chi: "analista-vendite", tipo: "verifica", dove: "~/Progetti/Negozio online", fa: 6, durata: 83, turni: 7, costo: "0.09",
    richiesta: "Controlla che prezzi e giacenze del catalogo coincidano con il gestionale.",
    testo: "Controllati 148 prodotti.\n\n- 146 in ordine.\n- «Maglione lana merino, M»: il sito dice 4 pezzi, il magazzino 1. Corretto a 1.\n- «Sciarpa a coste, grigio»: prezzo 29 € sul sito, 32 € nel listino. Da decidere quale vale.\n\nNessun'altra differenza." },
  { id: "l-autocontrollo", titolo: "Autocontrollo di Jarvis", chi: "Jarvis", tipo: "verifica", dove: "~/Jarvis", fa: 88, durata: 21, turni: 2, costo: "0.01",
    richiesta: "Prova i pezzi di Jarvis e lo stato del sistema.",
    testo: "Memoria: leggibile, 1.240 note.\nAgenti: 18 profili validi, nessuno orfano.\nServer: raggiungibile, 5 contenitori attivi.\nCopie di sicurezza: ultima stanotte alle 03:10.\n\nTutto in ordine." },
  { id: "l-newsletter", titolo: "Bozza newsletter di ottobre", chi: "newsletter", tipo: "chat", dove: "~/Progetti/Social e newsletter", fa: 170, durata: 64, turni: 5, costo: "0.03",
    richiesta: "Prepara la bozza della newsletter di ottobre con la collezione nuova.",
    testo: "Oggetto: «L'autunno è arrivato (e ha le maniche lunghe)»\n\nTre blocchi: collezione nuova, guida alle taglie, spedizione gratuita sopra i 60 €.\nLa bozza è in «Social e newsletter/bozze/ottobre.md» e aspetta il revisore." },
];

// La memoria: numeri, la sincronia dei progetti e le cose da fare
DATI_DEMO.memoria = {
  note: 1240, sessioni: 86,
  progetti: [
    { progetto: "Negozio online", memoria_fa: 14, lavoro_fa: 6, da_fare: 7, errori: 3 },
    { progetto: "Social e newsletter", memoria_fa: 55, lavoro_fa: 170, da_fare: 4, errori: 1 },
    { progetto: "Studio professionale", memoria_fa: 300, lavoro_fa: 320, da_fare: 5, errori: 2 },
    { progetto: "Casa e famiglia", memoria_fa: 720, lavoro_fa: 760, da_fare: 3, errori: 0 },
  ],
  sviluppi: [
    { nome: "Collezione autunno", stato: "in corso", task: ["Pubblicare le 12 schede nuove", "Foto dei maglioni su sfondo chiaro", "Post di lancio per sabato"] },
    { nome: "Riordino magazzino", stato: "da iniziare", task: ["Contare le taglie M e L", "Chiedere il preventivo al fornitore di lana"] },
    { nome: "Studio: fatture elettroniche", stato: "in corso", task: ["Controllare le 3 fatture scartate", "Mandare il riepilogo al commercialista"] },
  ],
};

DATI_DEMO.telefono = {
  chiamate: [
    { fa: 150, numero: "+39 02 0000 0001", chi: "Ristorante Da Gino", tipo: "uscita", durata: 74,
      esito: "Prenotato un tavolo per quattro, sabato alle 21, a nome Rossi.", domande: [] },
    { fa: 1560, numero: "+39 02 0000 0002", chi: "Corriere Espresso", tipo: "entrata", durata: 102,
      esito: "Il ritiro di domani passa tra le 10 e le 12. Nessun costo in più.", domande: ["Serve la bolla stampata?"] },
  ],
};

// La chat a voce (la stessa conversazione della voce di Jarvis): minuti fa, chi, testo
DATI_DEMO.voce = [
  [38, "boss", "Jarvis, com'è andato il negozio ieri?"],
  [38, "jarvis", "Bene, Capo: 23 ordini e 1.842 euro. Due resi, tutti e due per la taglia."],
  [37, "boss", "Ricordami di chiamare il commercialista domani mattina."],
  [37, "jarvis", "Fatto, è nelle cose da ricordare per domani alle 9."],
  [12, "boss", "A che punto è il lancio della collezione?"],
  [12, "jarvis", "Schede, scorte e parole chiave pronte. Aspetto il tuo sì per pubblicare: lo trovi in Missioni."],
];

DATI_DEMO.catalogo = {
  verifiche: [
    { id: "autocontrollo", nome: "Autocontrollo di Jarvis", descrizione: "Prova i suoi pezzi e lo stato del sistema" },
    { id: "catalogo", nome: "Verifica catalogo", descrizione: "Prezzi e giacenze del sito contro il magazzino" },
    { id: "ordini", nome: "Ordini non spediti", descrizione: "Gli ordini pagati da più di 48 ore e non ancora partiti" },
  ],
  agenti: [
    { id: "analista-vendite", descrizione: "Ordini, resi e scorte del negozio" },
    { id: "contabile", descrizione: "Fatture e incassi dello studio" },
    { id: "revisore", descrizione: "Controllo di testi e numeri" },
  ],
  comandi: [
    { id: "briefing", nome: "Briefing", descrizione: "Jarvis riassume come siamo messi, in sola lettura" },
    { id: "incassi", nome: "Incassi di ieri", descrizione: "Ordini, resi e incasso del giorno prima" },
    { id: "agenda", nome: "Agenda della settimana", descrizione: "Appuntamenti e scadenze dei prossimi 7 giorni" },
    { id: "copie", nome: "Stato delle copie", descrizione: "Quando è stata fatta l'ultima copia di sicurezza" },
  ],
  comandi_claude_code: [
    { id: "brain_stato", nome: "📋 Brain → Stato", descrizione: "Leggi i fatti e lo stato del progetto", categoria: "memoria" },
    { id: "salva_memoria", nome: "💾 Salva in memoria", descrizione: "Scrive fatto, da fare ed errori del progetto", categoria: "memoria" },
    { id: "revisione", nome: "🔎 Revisione del codice", descrizione: "Controlla le modifiche in corso", categoria: "codice" },
  ],
  collegamenti: [{ id: "guida_telefono", nome: "Guida telefono" }, { id: "automazioni", nome: "Automazioni" }],
  skills: [
    { id: "/aggiorna-memoria", nome: "aggiorna-memoria", descrizione: "Salva fatto, da fare ed errori del progetto nella memoria", origine: "utente" },
    { id: "/report-pdf", nome: "report-pdf", descrizione: "Trasforma un resoconto in un PDF ordinato", origine: "utente" },
    { id: "/verifica", nome: "verifica", descrizione: "Prima di dire «fatto» lancia il controllo e ne legge l'uscita", origine: "utente" },
    { id: "/piano", nome: "piano", descrizione: "Divide un lavoro lungo in passi piccoli e verificabili", origine: "utente" },
  ],
  frequenti: [
    { testo: "Com'è andato il negozio ieri?", conta: 9 },
    { testo: "Cosa scade questa settimana?", conta: 6 },
    { testo: "Chi sta lavorando adesso?", conta: 4 },
  ],
};

// Il rapporto della sentinella
DATI_DEMO.sentinella = "Giro regolare · nessuna anomalia da riferire\n\n- 4 progetti con la memoria aggiornata\n- server raggiungibile, 5 contenitori attivi\n- nessuna presa fantasma, nessuna sessione ferma";

// Le risposte della chat in demo: se la domanda somiglia a una di queste, arriva la risposta pronta.
// Sotto ogni risposta finto.js aggiunge la riga «questa è la demo…» nella lingua del pannello.
DATI_DEMO.risposte = [
  { se: /negozio.*ieri|incass|ordini/i, testo: "Ieri il negozio ha fatto **23 ordini** per **1.842 €**.\n\n- 2 resi, tutti e due per la taglia (maglione merino, M → L)\n- prodotto più venduto: sciarpa a coste grigia (7 pezzi)\n- carrelli abbandonati: 11, di cui 4 sopra i 60 €\n\nSe vuoi, il copywriter prepara una mail per i carrelli abbandonati." },
  { se: /scad|settimana|oggi/i, testo: "Questa settimana:\n\n- **dopodomani**: scegliere il corriere di novembre (due preventivi)\n- **tra 3 giorni**: visita dal dentista, ore 17:30\n- **tra 5 giorni**: rinnovo del dominio del negozio (18 €)\n\nIl resto è in Scadenze." },
  { se: /chi.*lavor|lavorando|a che punto/i, testo: "Adesso lavora la squadra del **Negozio online** sulla missione «lancio collezione autunno»: copywriter, analista-vendite e seo-catalogo hanno consegnato, il revisore sta finendo. Poi il capogruppo verifica e ti chiede il sì per pubblicare." },
  { se: /stato|progetti|riassum/i, testo: "Quattro progetti, tutti in ordine:\n\n- **Negozio online**: lancio collezione in corso, aspetta il tuo sì\n- **Social e newsletter**: bozza di ottobre pronta\n- **Studio professionale**: fatture di settembre chiuse\n- **Casa e famiglia**: caldaia da revisionare entro 9 giorni" },
  { se: /errori|ripetere/i, testo: "Da non ripetere (dalla memoria del progetto):\n\n- non pubblicare prezzi senza il controllo del revisore\n- le foto vanno caricate prima delle schede, non dopo\n- il venerdì il corriere passa alle 11, non alle 15" },
  { se: /serve|bisogno/i, testo: "Mi serve il tuo sì per pubblicare le 12 schede nuove (in Missioni) e una scelta sul prezzo della sciarpa grigia: 29 € come sul sito o 32 € come nel listino?" },
];
