# Pulizia dream

Con l'uso, la memoria di un assistente cresce: note vecchie, sessioni passate, appunti che dicono la stessa cosa in due posti diversi. Jarvis tiene questa crescita in ordine con lo stesso principio con cui lavora su tutto il resto: mai sovrascrivere alla cieca, mai cancellare senza il tuo sì esplicito.

## Come funziona oggi

Quando chiudi un lavoro o dici «salva», Jarvis aggiorna la memoria del progetto invece di aggiungerne una copia: corregge quello che non è più vero, non affianca una nota nuova a una vecchia che dice la stessa cosa. Gli errori già corretti restano scritti finché la causa che li rendeva possibili non esiste più: si toglie solo allora, non per «fare pulizia».

## La pulizia «dream» (dalla versione 0.5.0)

È ispirata a «Dream» di Anthropic, rifatta sul tuo computer. La chiedi a Jarvis con «consolida la memoria» o «pulizia memoria». Lavora in cinque passi, e ognuno si ferma prima di quello dopo.

1. **Inventario.** Jarvis conta cosa c'è: la memoria globale, quella dei progetti, gli appunti automatici di Claude Code e le sessioni passate di Claude Code e di Codex, con il loro peso. Non tocca niente.
2. **Bozza.** Rilegge le sessioni vecchie non ancora consolidate e ne tira fuori i fatti: decisioni, errori, cose fatte e da fare. Li scrive in una bozza a parte. La memoria resta com'è.
3. **Fusione.** Dopo averli verificati, porta i fatti nella memoria del progetto giusto. Se una nota dice già la stessa cosa la corregge, invece di aggiungerne un'altra.
4. **Proposta di pulizia.** Elenca le sessioni già consolidate e ferme da più di 30 giorni (il numero lo scegli tu), le copie identiche e le cartelle vuote, con quanto spazio liberano. Non propone mai la sessione in corso, l'ultima di ogni progetto, quelle delle ultime 24 ore, gli appunti automatici e i file di configurazione.
5. **Il tuo sì, due volte.** Con il primo sì le sessioni proposte vanno in un archivio (`~/.jarvis/archivio-sessioni/`), da cui un comando le rimette tutte al loro posto. La cancellazione definitiva dell'archivio è un secondo passo, con un secondo sì.

Le sessioni di Gemini CLI oggi si contano ma non si leggono: il loro formato cambia fra una versione e l'altra, e Jarvis non legge quello che non sa leggere bene.
