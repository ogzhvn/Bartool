# Produktfoto-Pipeline

Nur lokal/Scratchpad ausführen, Bilder nie ins Repo.

1. venv: `pip install "rembg[cpu]" pillow onnxruntime`
2. Originale nach `<S>/orig/<slug>.jpg`
3. `python -I cut.py <S>/orig <S>/out` – freistellen, zuschneiden, 900×1200 transparent, WebP q85
4. `manifest.py` (Vorlage: `manifest_whisky.py`: slug, Name, uuid, Seite, Bild-URL, Konfidenz, Notiz) nach `<S>/scripts/` kopieren, dann `python -I sheet.py <S>/scripts <S>` → `<S>/contactsheet.html`
5. Nach Freigabe: Upload per Storage-API nach `bilder/produkte/<uuid>.webp` (contentType image/webp, x-upsert), dann `update products set image_path = 'produkte/' || id || '.webp' where id in (...)`.
