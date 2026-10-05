#!/usr/bin/env python3
"""Ricopia nella demo la pagina vera del Command Center e la adatta.

Uso: python3 strumenti/copia_pannello.py <cartella command-center/static del prodotto>

Copia app.js, app.css, mobile.js, mobile.css (sito per telefono, 05/10/2026), logo e icone senza modificarli; rifà demo/index.html dall'index.html del
prodotto (percorsi relativi, niente manifest, banner della demo, dati finti e finto.js prima di
app.js); rifà demo/lingue/<codice>.js dai dizionari JSON (da file:// un JSON non si legge con fetch).
I dati finti (demo/dati/*.js), finto.js e demo.css non si toccano.
"""
import json
import shutil
import sys
from pathlib import Path

RADICE = Path(__file__).resolve().parent.parent
DEMO = RADICE / "demo"
if len(sys.argv) < 2:
    sys.exit(__doc__)
STATIC = Path(sys.argv[1]).expanduser()
FILE = ["app.js", "app.css", "mobile.js", "mobile.css", "logo.svg", "icona-32.png", "icona-64.png", "icona-180.png", "icona-192.png", "icona-512.png"]

BANNER = ('<a class="demo-banner" id="demo-banner" href="https://github.com/sponsors/AndyTrust" target="_blank" '
          'rel="noopener" translate="no"><b>Jarvis Business</b><span>Demo · dati finti · Jarvis Business completo a 2 $/mese →</span></a>\n')
SCRIPT_DEMO = """<!-- DEMO: al posto del server, i dati finti (dati/*.js) e il server finto (finto.js), prima di app.js.
     finto.js mette token, appellativo, lingua e dizionario (lingue/<codice>.js) come farebbe il server vero. -->
<script src="dati/squadra.js"></script>
<script src="dati/stato.js"></script>
<script src="dati/missioni.js"></script>
<script src="finto.js"></script>"""


def sostituisci(testo, vecchio, nuovo):
    if vecchio not in testo:
        sys.exit(f"non trovo nell'index.html del prodotto: {vecchio[:70]!r}")
    return testo.replace(vecchio, nuovo)


def main():
    for f in FILE:
        shutil.copy2(STATIC / f, DEMO / f)
    h = (STATIC / "index.html").read_text(encoding="utf-8")
    h = sostituisci(h, '<html lang="__LANG__">', '<html lang="it">')
    h = sostituisci(h, "<title>Jarvis Command Center</title>", "<title>Jarvis Command Center · Demo</title>")
    h = sostituisci(h, '<link rel="manifest" href="/manifest.webmanifest">\n', "")
    # demo.css per ultimo, dopo mobile.css (sito per telefono): la striscia della demo vince sulle altezze del telefono
    h = sostituisci(h, '<link rel="stylesheet" href="/static/mobile.css">\n', "")
    h = sostituisci(h, '<link rel="stylesheet" href="/static/app.css">',
                    '<link rel="stylesheet" href="app.css">\n<link rel="stylesheet" href="mobile.css">\n<link rel="stylesheet" href="demo.css">')
    inizio = h.index("<!-- il server mette")   # «mette token» fino alla 0.5.1, «mette da dove» dalla 0.5.2
    fine = h.index("</script>", inizio) + len("</script>")
    h = h[:inizio] + SCRIPT_DEMO + h[fine:]
    h = sostituisci(h, "<body>\n", "<body>\n" + BANNER)
    h = h.replace('src="/static/', 'src="').replace('href="/static/', 'href="')
    if "/static/" in h or "__TOKEN__" in h or "__LANG__" in h:
        sys.exit("restano percorsi assoluti o segnaposto del server in index.html")
    (DEMO / "index.html").write_text(h, encoding="utf-8")
    for c in ("en", "es", "fr", "de"):
        d = json.loads((STATIC / "lingue" / f"{c}.json").read_text(encoding="utf-8"))
        d = {k: v for k, v in d.items() if isinstance(v, str) and v and not k.startswith("_")}
        (DEMO / "lingue" / f"{c}.js").write_text(
            f"// dizionario della pagina ({c}), generato da strumenti/copia_pannello.py\nwindow.CC_TESTI = "
            + json.dumps(d, ensure_ascii=False).replace("</", "<\\/") + ";\n", encoding="utf-8")
    print("demo aggiornata da", STATIC)


if __name__ == "__main__":
    main()
