# Bartool – Hinweise für Claude Code

## Daten: Rezepte & Produkte gehören in Supabase

Wichtige Nutzervorgabe: **Neue Rezepte und Produkte sollen immer in die
Supabase-Datenbank geschrieben werden**, nicht (nur) als statische Einträge
in den JS-Dateien (`js/classicsData.js`, `js/houseRecipes.js`,
`js/productsData.js`) ergänzt werden.

Hintergrund/Architektur (Stand jetzt):

- `js/storage.js` liest/schreibt Rezepte über die Supabase-Tabelle
  `recipes` (`saveRecipe()` → `supabase.from("recipes").upsert(...)`) und
  Produkte über die Tabelle `products`.
- `js/recipeLibrary.js` führt beim Anzeigen drei Quellen zusammen:
  eigene/DB-Rezepte (`loadRecipes()`) > `HOUSE_RECIPES` (statisch,
  `js/houseRecipes.js`) > `CLASSIC_RECIPES` (statisch, `js/classicsData.js`).
  Ein DB-Rezept mit gleichem Namen überschreibt die statische Version.
- Bisher lag die große Klassiker-/Hausrezept-Sammlung rein statisch im
  Code (kein DB-Eintrag nötig, damit sie in der App erscheint).

**Für zukünftige Aufgaben:** Wenn neue Rezepte oder Produkte hinzugefügt
werden sollen, diese direkt in die Supabase-Tabellen `recipes` bzw.
`products` schreiben (z. B. über die Supabase-MCP-Tools oder die App
selbst), statt sie nur in die statischen JS-Dateien einzutragen. Das
Zutaten-/Ingredient-Namensschema muss dabei weiterhin exakt mit den
Produktnamen aus `products` (bzw. `js/productsData.js`) übereinstimmen,
damit Aromenmatrix/Verkaufsmatrix/Empfehlungssystem korrekt zuordnen
können. Bei fehlenden Original-Zutaten im Sortiment: sinnvolle Annäherung
wählen und das in der `history`/Beschreibung transparent vermerken.
