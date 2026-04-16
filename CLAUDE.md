# Paseo Event Maker — Workflow

## Deployment & Auto-Merge

- Production site: `paseo-event-maker.vercel.app` — Vercel deploys from `main` branch
- Main app file: `paseo-proposal/public/index.html`
- **IMPORTANT**: Root `/index.html` must be kept in sync with `paseo-proposal/public/index.html` (Vercel's `vercel.json` sets `outputDirectory: "public"` but root file is also served). After every change to the main app file, copy it to root:
  ```
  cp paseo-proposal/public/index.html index.html
  ```

### Auto-merge after every change
The user wants every change to appear live immediately. After making changes:
1. Sync root `index.html` with `paseo-proposal/public/index.html`
2. Commit & push to the current feature branch
3. **Automatically open a PR to `main` and squash-merge it** (via `mcp__github__create_pull_request` + `mcp__github__merge_pull_request`)
4. Inform the user that changes are live; they just need to refresh the page

Do NOT wait for the user to ask — this is their standing preference.

## Tech Stack

- Single-file React 18 app (CDN + Babel standalone)
- Supabase: `irlynipejmilibumedwm.supabase.co` — tables `leads` and `submissions`
- RTL Hebrew, mobile-first
- Dark luxury theme: `#1a1a1a` bg, `#c8a96e` gold accent

## Syntax Check
Before committing JSX changes, verify Babel compiles cleanly:
```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('paseo-proposal/public/index.html', 'utf8');
const start = html.indexOf('<script type=\"text/babel\">');
const end = html.lastIndexOf('</script>');
const js = html.slice(start + '<script type=\"text/babel\">'.length, end);
const babel = require('/tmp/node_modules/@babel/standalone');
babel.transform(js, { presets: ['react'] });
console.log('OK');
"
```

## Key App Concepts

- Two event modes: `private` (80+, interactive stations menu) / tables (10-70, legacy menu types)
- `STATIONS_CONFIG`: 8 stations (פתיחים, בשר, באנים, סושי, סלטים, פסטות, ילדים, קינוחים) with `minSelect`/`maxSelect`
- Client-facing page: accessed via `?p=BASE64_JSON` URL param — no server lookup
- Client submissions: save silently to Supabase `submissions` table only (no WhatsApp popup, no mailto)
- Admin phone: `972543332696` (0543332696)
- User guideline: **never invent dish descriptions** — only use user-approved ones
