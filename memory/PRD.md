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

## Backlog
- P1: Barcode/label scan for positions (camera)
- P1: Daily arrivals overview / filters by stato and date
- P2: Export day report (PDF/CSV) to share with clients
