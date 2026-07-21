# PASEO Event Maker — Integration Guide for PaseoCRM

This document describes how an external app (PaseoCRM) can integrate with the
proposal generator at `https://paseo-event-maker.vercel.app/`.

## Shared Supabase

Both apps use the same Supabase project:

- URL: `https://irlynipejmilibumedwm.supabase.co`
- Tables:

### `leads`
Lead tracking, synced from the event-maker's built-in CRM (localStorage key `paseo_crm_leads`).

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | Format: `"L" + 12 base36 chars` |
| `clientName` | text | |
| `clientPhone` | text | |
| `clientEmail` | text | |
| `eventType` | text | e.g. `בר/בת מצווה`, `חתונה`, `אירוע חברה` |
| `eventDate` | text | `YYYY-MM-DD` |
| `guestCount` | text | |
| `pricePerGuest` | text | |
| `childCount` | text | |
| `pricePerChild` | text | |
| `source` | text | One of: אינסטגרם, המלצה, גוגל, פייסבוק, אתר, טלפון, אחר |
| `status` | text | `new` / `sent` / `followup` / `closed` / `cancelled` / `irrelevant` |
| `cancelReason` | text | |
| `notes` | text | |
| `followUpDate` | text | |
| `createdAt` | timestamptz | ISO string |
| `updatedAt` | timestamptz | ISO string |

### `proposals`
Saved proposals behind short client links.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | Short code: `"P" + up to 8 base36 chars` |
| `data` | jsonb | Compact proposal object (see schema below) |

### `submissions`
Client menu selections + signatures, written by the client-facing page.

## Proposal data schema (`proposals.data` / `?load=` / `?p=`)

```jsonc
{
  "n":  "שאבי",          // client name (required)
  "t":  "בר/בת מצווה",   // event type
  "d":  "2026-06-24",     // event date YYYY-MM-DD
  "tm": "20:30",          // event time
  "g":  "80",             // adult guest count
  "c":  "20",             // child count
  "mt": "meat",           // menu type: "dairy" | "meat"
  "pt": "deluxe",         // package tier: "classic" | "premium" | "deluxe"
  "sd": {                  // selected dish ids per category
    "starters": ["ms10", "ms9"],
    "rawBar":   ["mr1"],
    "mains":    ["mm3", "mm1"],
    "desserts": ["md3"]
  },
  "km": ["k1", "k2", "k3"],  // kids menu ids (נאגטס עוף, מיני המבורגרים, פיש אנד ציפס)
  "su": ["wine_beer"],       // upgrade ids: wine_beer | open_bar | cocktail_bar | sushi_station
  "sp2": "40",               // sushi station price per guest (only if != "35")
  "ppg": "319",              // price per adult
  "ppc": "140",              // price per child
  "vd": "7",                 // proposal valid days (only if != "7")
  "dp": "both",              // drink package: "none" | "soft" | "alcohol" | "both"
  "sp": "0",                 // service charge pct (omit when 0)
  "iv": false,               // include VAT (omit when true)
  "svc": [                   // services array (DB/load format)
    { "n": "דיג'יי", "i": true },                     // i = included
    { "n": "השכרת המקום", "i": false, "q": "1", "p": "3000" },  // q=qty, p=price
    { "n": "קוקטיילים", "i": true, "d": "20 קוקטיילים" }        // d=description
  ]
}
```

Omit any field that is empty/default — the app applies defaults.

## Entry points (URL params)

### 1. Prefill the admin form — `?load=`
Opens the admin app with the form pre-filled and jumps straight to the preview tab.

```
https://paseo-event-maker.vercel.app/?load=<BASE64>
```

Where `<BASE64>` is `encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(data)))))`
using the schema above. This is the main hook for a "צור הצעת מחיר" button in
PaseoCRM: build the JSON from the lead's fields, encode, open the URL.

Note: admin is behind a PIN gate (localStorage auth, 7-day expiry).

### 2. Client-facing proposal — `?p=`
- Short form: `?p=P<shortcode>` — looks up `proposals` table by id.
- Long form: `?p=<BASE64>` (same encoding as above) — no DB needed.

### 3. Diagnostics — `?diag=1` or `?diag=<proposalId>`
Runs Supabase connectivity tests in the browser.

## JS encode/decode reference

```js
// encode
const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
const url = `https://paseo-event-maker.vercel.app/?load=${encodeURIComponent(b64)}`;

// decode
const data = JSON.parse(decodeURIComponent(escape(atob(b64.replace(/ /g, "+")))));
```

## Integration plan

**Phase A (linking):** PaseoCRM reads/writes the shared `leads` table and adds a
"צור הצעת מחיר" button per lead that opens `?load=` with the lead's data.
Status updates (`sent`, `closed`...) happen in the CRM; both apps see the same rows.

**Phase B (embedding):** Port the proposal form + preview + PDF components into
PaseoCRM as an internal screen. The components live in
`paseo-proposal/public/index.html` (single-file React 18 + Babel standalone);
key pieces: `PACKAGE_MENUS`, `KIDS_MENU`, `DEFAULT_SERVICES`, `MenuPage`,
`PricingPage`, `TermsPage`, `generateClientLink`, `parseProposalData`.
