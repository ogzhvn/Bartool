# Bartool

Eine einfache, werkzeuglose Web-App mit Rechnern für Barkeeper:

- **Batching** – Rezepte auf mehr Portionen oder ein Ziel-Volumen hochrechnen, Rezepte im Browser speichern
- **Superjuice** – Säuremengen (Zitronensäure, Apfelsäure, Ascorbinsäure) und optional Zucker für Superjuice berechnen
- **Verdünnung & ABV** – Alkoholgehalt eines Drinks vor/nach Verdünnung durch Eis berechnen

## Nutzung

Reines HTML/CSS/JavaScript ohne Build-Schritt oder Server. Lokal starten, z. B.:

```bash
python3 -m http.server 8000
```

Dann `http://localhost:8000` im Browser öffnen.

Gespeicherte Rezepte liegen im `localStorage` des Browsers (kein Server, kein Login).

## Deployment

Da es eine statische Seite ist, kann sie direkt z. B. über GitHub Pages gehostet werden (Settings → Pages → Branch auswählen).
