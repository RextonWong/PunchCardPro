# PunchCard Pro — Claude Guide

## Project Overview
PunchCard Pro digitizes manual paper punch cards for Malaysian heavy logistics and construction sectors (e.g., "Lori Hantu" earthworks). AI processes legacy punch cards and handwritten timesheets, eliminating manual data-entry bottlenecks.

## Tech Stack
- **Frontend:** React 19 + Vite, Tailwind CSS v4
- **Backend / Database:** Supabase (PostgreSQL) — configured but data currently in localStorage
- **Middleware:** Supabase Edge Functions (Deno) — live at `supabase/functions/ocr-scanner/`
- **AI / OCR:** Google Cloud Vision API (`DOCUMENT_TEXT_DETECTION`)
- **Key Libraries:** `xlsx` + `file-saver` for Excel export, `tesseract.js` (installed, not yet integrated)

## Repository Layout
```
src/
  App.jsx          # Entire frontend — monolithic, 617 lines
  main.jsx
supabase/
  functions/
    ocr-scanner/   # Deno edge function → calls Google Vision API
  config.toml
```
All frontend logic lives in `src/App.jsx`. There are no separate components, hooks, or utils directories yet.

## Data Persistence
Data is stored in `localStorage` under the key `punch-card-pro-v63`. Supabase is wired for OCR only; no database tables exist yet.

### Data Shape
```js
{
  workplaces: [{
    id, name, rate,          // RM/hour
    rainMin,                 // minimum billable hours on rain days
    lStart, lEnd, lTh,       // Mon–Thu lunch window + deduct threshold
    fStart, fEnd, fTh,       // Friday prayer window + deduct threshold
    entries: [{ id, date, loriId, timeRange, hours, rest, total, isRain }]
  }],
  fleet: ["LD", "LD2", ...]  // known Lorry IDs
}
```

## Core Architecture & Data Flow
1. Admin uploads/pastes image of physical punch card in the React frontend.
2. Image sent as Base64 to the Supabase Edge Function (`/functions/v1/ocr-scanner`).
3. Edge function calls Google Vision API and returns raw detected text.
4. Frontend parses text with Regex to extract Lorry ID, dates, time-in, time-out.
5. Parsed data lands in an editable batch preview grid.
6. Admin reviews, corrects OCR errors, then approves → data saved.

## Key Business Logic (Payroll Rules)

### Time Rounding
Clock-in/out times are rounded to the nearest 30 minutes before calculating billable hours.

### Rest / Lunch Deductions
A rest period is deducted **only if** clock-out time exceeds a configured threshold:
- **Mon–Thu:** uses `lStart`/`lEnd`/`lTh` from site config
- **Friday:** uses `fStart`/`fEnd`/`fTh` — accounts for Islamic prayer time (Jumaat)

### Rain Day Minimum
If `isRain` is true, billable hours cannot fall below `rainMin` (configured per site), regardless of actual clock-in/out.

### Fee Calculation
`fee = billableHours * site.rate`

## What Is Implemented
- OCR via Google Cloud Vision (edge function live)
- Manual 31-day batch entry grid
- Editable batch preview before posting
- Time calculation engine (rounding, rest deduction, Friday protocol, rain minimum)
- Per-site configuration modal (rate, lunch windows, rain minimum)
- Ledger view with monthly totals, tabbed by Lorry ID
- Excel export per Lorry ID
- Delete entry / delete site

## What Is Not Yet Implemented
- Supabase database tables (no schema, no inserts/selects)
- User authentication
- Real-time sync across devices
- Tesseract.js local OCR fallback

## Development Commands
```bash
npm run dev      # Start Vite dev server
npm run build    # Production build
npm run lint     # ESLint
```

## Environment Variables (Edge Function)
The `ocr-scanner` edge function reads `GOOGLE_VISION_API_KEY` from `Deno.env`. Set this in the Supabase dashboard → Edge Functions → Secrets.
