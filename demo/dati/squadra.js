// Dati finti della demo: il cliente, gli spazi, i progetti e la squadra degli agenti.
// Tutto inventato. finto.js li legge da qui e risponde come risponderebbe il server vero.
window.DATI_DEMO = window.DATI_DEMO || {};

DATI_DEMO.cliente = { nome: "Mario Rossi", appellativo: "Capo" };

// Uno spazio = un'area di lavoro. Un progetto = una cartella con la sua squadra.
// Il capogruppo divide il lavoro e verifica gli specialisti; «comunica» sono i fili del profilo.
DATI_DEMO.spazi = [
  {
    id: "negozio", nome: "Negozio online",
    memoria: "~/Jarvis/Memoria/Negozio online", report: "~/Jarvis/Report/Negozio online",
    progetti: [
      {
        id: "shop", nome: "Negozio online", cartella: "~/Progetti/Negozio online", capogruppo: "ceo-negozio",
        agenti: [
          { nome: "ceo-negozio", modello: "sonnet", capogruppo: true, tono: "diretto, da capo squadra", umorismo: 1,
            descrizione: "Capogruppo del negozio online: divide il lavoro, verifica gli specialisti e riferisce a Jarvis",
            strumenti: ["Read", "Grep", "Bash"], comunica: ["copywriter", "analista-vendite", "seo-catalogo", "revisore", "sviluppatore-web"] },
          { nome: "copywriter", modello: "sonnet", tono: "caldo e concreto", umorismo: 2,
            descrizione: "Scrive schede prodotto, pagine del sito e newsletter con la voce del marchio",
            strumenti: ["Read", "Write"], comunica: ["seo-catalogo", "revisore"] },
          { nome: "analista-vendite", modello: "sonnet", tono: "asciutto, parla coi numeri", umorismo: 0,
            descrizione: "Legge ordini, resi e scorte e dice cosa riordinare e quando",
            strumenti: ["Read", "Bash"], comunica: [] },
          { nome: "seo-catalogo", modello: "sonnet", tono: "pratico", umorismo: 1,
            descrizione: "Sceglie parole chiave, titoli e descrizioni perché il catalogo si trovi su Google",
            strumenti: ["Read", "WebSearch"], comunica: [] },
          { nome: "sviluppatore-web", modello: "opus", tono: "preciso", umorismo: 1,
            descrizione: "Modifica il tema del negozio, i moduli e i collegamenti con pagamenti e spedizioni",
            strumenti: ["Read", "Edit", "Bash"], comunica: [] },
          { nome: "revisore", modello: "sonnet", tono: "pignolo ma gentile", umorismo: 1,
            descrizione: "Controlla testi, prezzi e numeri prima che escano dal negozio",
            strumenti: ["Read", "Grep"], comunica: [] },
        ],
      },
      {
        id: "social", nome: "Social e newsletter", cartella: "~/Progetti/Social e newsletter", capogruppo: "ceo-social",
        agenti: [
          { nome: "ceo-social", modello: "sonnet", capogruppo: true, tono: "energico", umorismo: 2,
            descrizione: "Capogruppo dei social: calendario dei post, newsletter e risposte ai commenti",
            strumenti: ["Read", "Write"], comunica: ["social-media", "grafico", "newsletter"] },
          { nome: "social-media", modello: "sonnet", tono: "leggero, mai volgare", umorismo: 2,
            descrizione: "Prepara i post di Instagram e Facebook e le risposte ai commenti",
            strumenti: ["Read", "Write"], comunica: ["copywriter"] },
          { nome: "grafico", modello: "sonnet", tono: "visivo", umorismo: 1,
            descrizione: "Propone impaginazioni, formati e testi delle immagini dei post",
            strumenti: ["Read", "Write"], comunica: [] },
          { nome: "newsletter", modello: "haiku", tono: "cordiale", umorismo: 1,
            descrizione: "Monta la newsletter del mese dai testi approvati",
            strumenti: ["Read", "Write"], comunica: [] },
        ],
      },
    ],
  },
  {
    id: "studio", nome: "Studio",
    memoria: "~/Jarvis/Memoria/Studio", report: "~/Jarvis/Report/Studio",
    progetti: [
      {
        id: "studio", nome: "Studio professionale", cartella: "~/Progetti/Studio", capogruppo: "ceo-studio",
        agenti: [
          { nome: "ceo-studio", modello: "sonnet", capogruppo: true, tono: "formale ma chiaro", umorismo: 0,
            descrizione: "Capogruppo dello studio: pratiche, clienti e scadenze in ordine",
            strumenti: ["Read", "Grep"], comunica: ["contabile", "legale-contratti", "assistente-agenda", "ricercatore-bandi"] },
          { nome: "contabile", modello: "sonnet", tono: "preciso", umorismo: 0,
            descrizione: "Tiene fatture, incassi e prima nota; prepara il riepilogo per il commercialista",
            strumenti: ["Read", "Bash"], comunica: ["legale-contratti"] },
          { nome: "legale-contratti", modello: "sonnet", tono: "prudente", umorismo: 0,
            descrizione: "Rilegge contratti e condizioni di vendita e segnala le clausole da guardare",
            strumenti: ["Read"], comunica: [] },
          { nome: "assistente-agenda", modello: "haiku", tono: "cortese", umorismo: 1,
            descrizione: "Tiene l'agenda, propone gli orari e ricorda gli appuntamenti",
            strumenti: ["Read", "Write"], comunica: [] },
          { nome: "ricercatore-bandi", modello: "sonnet", tono: "curioso", umorismo: 1,
            descrizione: "Cerca bandi, contributi e agevolazioni adatti allo studio e al negozio",
            strumenti: ["WebSearch", "WebFetch"], comunica: [] },
        ],
      },
    ],
  },
  {
    id: "casa", nome: "Casa",
    memoria: "~/Jarvis/Memoria/Casa", report: "~/Jarvis/Report/Casa",
    progetti: [
      {
        id: "casa", nome: "Casa e famiglia", cartella: "~/Progetti/Casa", capogruppo: "",
        agenti: [
          { nome: "bollette", modello: "haiku", tono: "sbrigativo", umorismo: 1,
            descrizione: "Legge bollette e offerte di luce e gas e dice se conviene cambiare",
            strumenti: ["Read"], comunica: [] },
          { nome: "manutenzioni", modello: "haiku", tono: "pratico", umorismo: 1,
            descrizione: "Ricorda caldaia, auto e condominio e trova il tecnico",
            strumenti: ["Read"], comunica: [] },
          { nome: "viaggi", modello: "sonnet", tono: "entusiasta", umorismo: 2,
            descrizione: "Confronta voli, treni e alberghi per i weekend di famiglia",
            strumenti: ["WebSearch"], comunica: [] },
        ],
      },
    ],
  },
];

// Gli agenti di casa di Jarvis, fuori da ogni progetto
DATI_DEMO.diCasa = [
  { nome: "esecutore", modello: "haiku", descrizione: "Lancia comandi e script già scritti e riporta l'uscita com'è", strumenti: "Bash, Read", tono: "asciutto", umorismo: 0 },
  { nome: "ricercatore-web", modello: "sonnet", descrizione: "Cerca fonti su internet e restituisce fatti con link e data", strumenti: "WebSearch, WebFetch, Read", tono: "neutro", umorismo: 1 },
];
