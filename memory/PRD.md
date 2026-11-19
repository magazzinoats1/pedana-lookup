# PRD — Gestione Logistica Antolini (pedanalookup)

## Original problem
User uploaded a KÖLLA transport-order PDF and a reference web app (GestioneLogistica.tsx, "questo è l'idea"). Build an Expo mobile app: Ufficio (password) registers orders with multiple pedane; Magazzino (open) searches by posizione pedana / numero ordine and marks arrival status. Choices: manual entry + AI PDF import, partial search, Italian UI, no user accounts.

## Architecture
- FastAPI + MongoDB (collections: pedane, settings, sessions). Shared office password bcrypt-hashed, Bearer session tokens.
- Gemini 3 Flash (Emergent LLM key) for PDF parsing (/api/import-pdf).
- Expo Router: index (splash + role choice), ufficio/index (list/search/settings), ufficio/form (new/edit + PDF import + duplicate checks), magazzino (search + detail + stato).

## Implemented (2026-10-14)
- Splash with Antolini logo, role selection, office password sheet
- Orders CRUD, multiple pedane per order, per-row mittente override, duplicate warnings, edit/delete, search, cooperativa setting, password change
- Warehouse search exact→partial, detail with big destination, arrival status attesa/parziale(note)/completo with timestamps
- AI PDF import tested on sample (6 pedane, order 25023467)
- Start screen changed to white background (user request)
- Drag & drop PDF import on web (drop anywhere on Nuovo Ordine screen); AI prompt tightened so mittente is company name only
- Mittente moved from order data to each pedana row (required). PDF import now uses the short position code printed below (e.g. 2619-019320) and the supplier name on the right (ORCHIDEA, BERTOLI FRUIT, MORANDO GRAZIANO); each PDF row becomes its own pedana
- Same posizione allowed on multiple pedane (no blocking); new per-pedana field 'Tipo merce' (form, list, magazzino results/detail, search, PDF import)
- Magazzino 'Cerca Pedana' shows the full list of all registered pedane/merce when the search is empty (GET /api/pedane/tutte, pull-to-refresh)
- Magazzino list (full list and search results) grouped by numero ordine: truck header with date, pedane count, total colli, progress 'Scaricate X/N'
- Magazzino status filter chips (Tutte / In attesa / Parziali / Scaricate) with live counts, combined with search; group progress always reflects the full order
- Magazzino date chips (Tutte le date / Oggi / Domani) combined with status chips and search
- 'Scarica ordine intero' button per order group with confirm sheet (POST /api/ordini/scarica, public)
- Nome magazziniere: list viewable by anyone; marking stato / scarica ordine only after entering worker name (saved on device); name recorded (arrivoCompletoDa / arrivoParzialeDa) and shown in Magazzino detail and Ufficio list
- Riepilogo Ufficio (/ufficio/riepilogo): live board per day (auto-refresh 15s), stats camion/pedane/scaricate/parziali/attesa, per-order progress with time + operatore (GET /api/riepilogo)
- Daily report: PDF via expo-print + share sheet (web: print dialog), per order table with stato, ora, operatore
- numeroPedane per position (PDF 'Pedane' column) everywhere incl. report
- Magazzino: fixed collapsed filter chips (two fixed rows: date / stato), simplified list, groups sorted by numero ordine asc
- PIN Magazzinieri: office manages workers (nome + PIN 4-6 cifre, bcrypt) in /ufficio/magazzinieri; worker login (5 wrong PIN -> 5 min lock) gives role=magazzino session; stato/scarica endpoints require worker session, name taken from session; worker tokens rejected on office endpoints
- Archivio automatico: orders fully completo with last dataConsegna > 30 days archived hourly (archiviato flag), hidden from lists; /ufficio/archivio with search, pagination, 'Archivia ora', 'Ripristina'
- Scansione etichette (Magazzino): camera button next to search → photo (expo-image-picker) → POST /api/scan-etichetta (Gemini reads printed codes) → fills search; choice sheet when several codes; permission flow with Apri impostazioni + gallery fallback; prompt tuned for HANDWRITTEN, different signs (verified on Il Galletto sign 2619-019331, 3/3 reads)
- Magazzino default view = 'Da scaricare' (pedane in attesa, not yet arrived) with banner count; typing/scanning a search switches to Tutte, clearing returns to Da scaricare
- Avviso ritardi: ONLY pedane in attesa due TODAY after 14:00 local (past days not highlighted), flagged 'In ritardo' (red pill + banner in Magazzino, stat + row label in Riepilogo) — src/ritardi.ts
- Trasportatore per order (default 'Antolini Trasporti', PDF top-left addressee); not Antolini => TRASBORDO badge in Ufficio list, Magazzino groups, detail, Riepilogo, report
- Same position + same order with different merce merged into ONE row in Magazzino ('N merci' pill); detail lists each merce; marking stato applies to all via PATCH /api/posizioni/stato
- Big 'Fotografa la posizione' button under Magazzino search (scan → detail with destination opens)
- Per-pedana dataArrivo/oraArrivo = 'Data/Ora di carico' (arrival at Antolini Verona) from PDF Luogo di carico; dataConsegna = customer delivery. Magazzino date filters, ritardi, Riepilogo and report use arrival date (fallback dataConsegna)
- PDF import: dataArrivo = Data di carico (partenza fornitore) + 1 giorno; oraArrivo left empty. Backend validates/strips dataArrivo (real date) and oraArrivo; 422 shown as 'Dati non validi'
- Live refresh: Magazzino list every 20s, Ufficio list every 30s (Riepilogo 15s); form save + back button fall back to /ufficio when no back history; Magazzino background refresh silent (keeps list on network error, paused when app in background); ora placeholder HH:MM
- Security audit run: SEC-001 default office password (change it), SEC-002 wildcard CORS, hardening: login rate limit, PDF size cap

## Backlog
- P1: Security fixes from audit (force password change on first login, login rate limit, PDF size limit, restrict CORS)
- P1: Barcode/label scan for positions (camera)
- P1: Daily arrivals overview / filters by stato and date
- P2: Export day report (PDF/CSV) to share with clients

## Update: PDF parsing deterministico
- /api/import-pdf ora usa prima un parser a regole fisse (PyMuPDF) per il formato KÖLLA: dataConsegna SOLO da "Luogo di scarico", destinazione = destinatario scarico (nome - città), mittente = fornitore in maiuscolo, dataArrivo = data di carico + 1. Risultato identico ogni volta e istantaneo.
- Se il layout non è riconosciuto, fallback su Gemini con prompt rafforzato.

## Update: Sito Ufficio (browser)
- GET /api/sito serves /app/backend/sito.html: office login, PDF drag&drop import, editable rows, save with overwrite confirm, "Arrivi in magazzino" tab auto-refresh 15s (stato + magazziniere). Production URL: https://pedana-lookup.emergent.host/api/sito
- Expo SDK upgraded to 58 (RN 0.88).

## Update: Magazzino front page only today
- Default date filter "Oggi" (search switches to Tutte, clearing returns to Oggi). Banners/chips/counts use real pallet sums (numeroPedane; empty=1, 0=0) + colli sums. Sito Arrivi shows pedane+colli.
- Sito: aggiunto Accesso Magazzino (nome+PIN): ricerca, filtri Oggi/Domani/Tutte + stato, ritardi, scarico posizione/parziale/annulla, scarica ordine intero, auto-refresh 15s. /api/privacy pagina informativa + link in app.
