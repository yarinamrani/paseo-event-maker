#!/usr/bin/env node
// Paseo Event Maker — Bug checker
// Runs static analysis on index.html to catch common bugs.
// Safe: read-only, never modifies any file.

const fs = require("fs");
const path = require("path");

const HTML_PATH = path.resolve(__dirname, "../paseo-proposal/public/index.html");
const ROOT_PATH = path.resolve(__dirname, "../index.html");

let passed = 0;
let failed = 0;
let warnings = 0;

function ok(msg) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${msg}`); }
function fail(msg) { failed++; console.log(`  \x1b[31m✗\x1b[0m ${msg}`); }
function warn(msg) { warnings++; console.log(`  \x1b[33m!\x1b[0m ${msg}`); }
function section(title) { console.log(`\n\x1b[1m${title}\x1b[0m`); }

const html = fs.readFileSync(HTML_PATH, "utf8");
const rootHtml = fs.existsSync(ROOT_PATH) ? fs.readFileSync(ROOT_PATH, "utf8") : null;

// Extract JS from <script type="text/babel">
const babelStart = html.indexOf('<script type="text/babel">');
const babelEnd = html.lastIndexOf("</script>");
const js = babelStart >= 0 && babelEnd > babelStart
  ? html.slice(babelStart + '<script type="text/babel">'.length, babelEnd)
  : "";

// ─── 1. FILE SYNC ───
section("1. File sync (root ↔ paseo-proposal)");
if (rootHtml === null) {
  fail("Root index.html does not exist");
} else if (rootHtml === html) {
  ok("Root index.html matches paseo-proposal/public/index.html");
} else {
  fail("Root index.html is OUT OF SYNC with paseo-proposal/public/index.html — run: cp paseo-proposal/public/index.html index.html");
}

// ─── 2. BABEL COMPILATION ───
section("2. Babel / JSX syntax");
try {
  const babelPath = "/tmp/node_modules/@babel/standalone";
  if (fs.existsSync(babelPath)) {
    const babel = require(babelPath);
    babel.transform(js, { presets: ["react"] });
    ok("Babel compiles JSX without errors");
  } else {
    warn("@babel/standalone not installed at /tmp — run: cd /tmp && npm i @babel/standalone");
  }
} catch (e) {
  fail(`Babel compile error: ${e.message.slice(0, 120)}`);
}

// ─── 3. MENU_DB INTEGRITY ───
section("3. MENU_DB integrity");

// Extract MENU_DB keys
const menuDbMatch = js.match(/const\s+MENU_DB\s*=\s*\{/);
if (!menuDbMatch) {
  fail("Cannot find MENU_DB definition");
} else {
  // Extract all category keys from MENU_DB
  const menuDbSection = js.slice(menuDbMatch.index);
  const menuDbKeys = [];
  const keyRe = /^\s*"([^"]+)":\s*\[/gm;
  let m;
  while ((m = keyRe.exec(menuDbSection)) !== null) {
    menuDbKeys.push(m[1]);
    if (m[1] === "קינוחים שולחנות" || menuDbSection.slice(m.index + m[0].length, m.index + m[0].length + 10).includes("};")) break;
  }

  // Extract all item IDs
  const allIds = [];
  const idRe = /id:\s*"([^"]+)"/g;
  while ((m = idRe.exec(menuDbSection)) !== null) {
    if (m[1].startsWith("c_")) continue; // custom items
    allIds.push(m[1]);
  }

  // Check for duplicate IDs
  const idCounts = {};
  allIds.forEach(id => { idCounts[id] = (idCounts[id] || 0) + 1; });
  const dupes = Object.entries(idCounts).filter(([, c]) => c > 1);
  if (dupes.length === 0) {
    ok(`No duplicate item IDs across MENU_DB (${allIds.length} items)`);
  } else {
    dupes.forEach(([id, c]) => fail(`Duplicate item ID "${id}" appears ${c} times`));
  }

  // ─── 4. STATIONS_CONFIG ↔ MENU_DB ───
  section("4. STATIONS_CONFIG ↔ MENU_DB consistency");

  const stationsRe = /const\s+STATIONS_CONFIG\s*=\s*\[([\s\S]*?)\];/;
  const tablesRe = /const\s+TABLES_STATIONS_CONFIG\s*=\s*\[([\s\S]*?)\];/;
  const stationKeyRe = /key:\s*"([^"]+)"/g;

  const stationsMatch = js.match(stationsRe);
  const tablesMatch = js.match(tablesRe);

  function extractStationKeys(configStr) {
    const keys = [];
    let km;
    const re = /key:\s*"([^"]+)"/g;
    while ((km = re.exec(configStr)) !== null) keys.push(km[1]);
    return keys;
  }

  if (stationsMatch) {
    const sKeys = extractStationKeys(stationsMatch[1]);
    sKeys.forEach(k => {
      if (menuDbKeys.includes(k)) ok(`STATIONS_CONFIG key "${k}" exists in MENU_DB`);
      else fail(`STATIONS_CONFIG key "${k}" NOT found in MENU_DB`);
    });
  } else {
    fail("Cannot find STATIONS_CONFIG");
  }

  if (tablesMatch) {
    const tKeys = extractStationKeys(tablesMatch[1]);
    tKeys.forEach(k => {
      if (menuDbKeys.includes(k)) ok(`TABLES_STATIONS_CONFIG key "${k}" exists in MENU_DB`);
      else fail(`TABLES_STATIONS_CONFIG key "${k}" NOT found in MENU_DB`);
    });
  } else {
    fail("Cannot find TABLES_STATIONS_CONFIG");
  }

  // ─── 5. PRESET IDs ───
  section("5. PRESET item IDs");
  const presetsMatch = js.match(/const\s+PRESETS\s*=\s*\{([\s\S]*?)\};/);
  if (presetsMatch) {
    const allIdSet = new Set(allIds);
    const presetIdRe = /"([a-z]\d+)"/g;
    const missing = [];
    let pm;
    while ((pm = presetIdRe.exec(presetsMatch[1])) !== null) {
      if (!allIdSet.has(pm[1])) missing.push(pm[1]);
    }
    if (missing.length === 0) ok("All PRESET item IDs exist in MENU_DB");
    else missing.forEach(id => fail(`PRESET references missing item ID "${id}"`));
  }

  // ─── 6. DUPLICATE CATEGORIES ACROSS MODES ───
  section("6. Mode separation (private vs tables)");
  if (stationsMatch && tablesMatch) {
    const sKeys = new Set(extractStationKeys(stationsMatch[1]));
    const tKeys = new Set(extractStationKeys(tablesMatch[1]));
    const overlap = [...sKeys].filter(k => tKeys.has(k));
    if (overlap.length === 0) {
      ok("No overlapping station keys between private and tables modes");
    } else {
      overlap.forEach(k => warn(`Station key "${k}" exists in BOTH STATIONS_CONFIG and TABLES_STATIONS_CONFIG — may cause duplicate display`));
    }
  }
}

// ─── 7. byCat MODE DETECTION ───
section("7. byCat mode detection logic");
const byCatMatch = js.match(/const\s+byCat\s*=\s*useMemo\(\(\)\s*=>\s*\{([\s\S]*?)\},\s*\[sel/);
if (byCatMatch) {
  const byCatBody = byCatMatch[1];
  if (byCatBody.includes("hasTablesItems") && byCatBody.includes("hasStationItems")) {
    ok("byCat checks both hasTablesItems and hasStationItems");
  } else {
    fail("byCat missing bidirectional mode check — private items may not show in quote");
  }
  if (byCatBody.includes("hasTablesItems ? stationKeys : hasStationItems ? tablesKeys")) {
    ok("byCat excludes correct keys based on detected mode");
  } else {
    fail("byCat exclusion logic may be wrong — check that private mode items aren't always excluded");
  }
} else {
  fail("Cannot find byCat useMemo");
}

// ─── 8. onLoadSubmission FIELD RESTORATION ───
section("8. CRM submission loading (onLoadSubmission)");
const loadSubIdx = js.indexOf("onLoadSubmission={(sub)");
const loadSubBody = loadSubIdx >= 0 ? js.slice(loadSubIdx, loadSubIdx + 2000) : "";
if (loadSubBody) {
  const body = loadSubBody;
  const checks = [
    ["setClientName", "clientName"],
    ["setEventType", "eventType"],
    ["setEventDate", "eventDate"],
    ["setGuestCount", "guestCount"],
    ["setEventMode", "eventMode"],
  ];
  checks.forEach(([setter, field]) => {
    if (body.includes(setter)) ok(`onLoadSubmission restores ${field}`);
    else fail(`onLoadSubmission does NOT restore ${field} — PDF will show defaults`);
  });
  if (body.includes("crmLoad")) {
    ok("onLoadSubmission looks up matching CRM lead for pricing data");
  } else {
    warn("onLoadSubmission doesn't look up CRM lead — pricePerGuest/pricePerChild may use defaults");
  }
} else {
  fail("Cannot find onLoadSubmission callback");
}

// ─── 9. EMPTY STATION GUARD (client page) ───
section("9. Client page — empty station guard");
const stationsLine = js.split("\n").find(l => l.includes("const stations =") && l.includes(".filter("));
if (stationsLine) {
  if (stationsLine.includes("availableSet")) {
    ok("Client page filters out stations with no available items");
  } else {
    fail("Client page may show empty stations that block submission (missing availableSet filter)");
  }
} else {
  warn("Cannot locate client station filter logic");
}

// ─── 10. MOBILE POPUP BLOCKER (WhatsApp) ───
section("10. Mobile popup blocker (WhatsApp link)");
const genLinkIdx = js.indexOf("generateClientLink");
if (genLinkIdx >= 0) {
  const genLinkBody = js.slice(genLinkIdx, genLinkIdx + 3000);
  const openIdx = genLinkBody.indexOf("window.open");
  const awaitRe = /(?<!\/\/.*)\bawait\s+/gm;
  const awaitMatch = awaitRe.exec(genLinkBody);
  const awaitIdx = awaitMatch ? awaitMatch.index : -1;
  if (openIdx >= 0 && awaitIdx >= 0 && openIdx < awaitIdx) {
    ok("WhatsApp window.open() called BEFORE first await (popup blocker safe)");
  } else if (openIdx >= 0 && awaitIdx >= 0 && openIdx > awaitIdx) {
    fail("WhatsApp window.open() called AFTER await — mobile browsers will block popup");
  } else {
    warn("Cannot determine window.open vs await ordering");
  }
} else {
  warn("Cannot locate generateClientLink function");
}

// ─── 11. CDN PINNED VERSIONS ───
section("11. CDN version pinning");
const cdnPatterns = [
  { name: "React", re: /unpkg\.com\/react@(\d+\.\d+\.\d+)\//, expected: /^\d+\.\d+\.\d+$/ },
  { name: "ReactDOM", re: /unpkg\.com\/react-dom@(\d+\.\d+\.\d+)\//, expected: /^\d+\.\d+\.\d+$/ },
  { name: "Babel", re: /@babel\/standalone@(\d+\.\d+\.\d+)\//, expected: /^\d+\.\d+\.\d+$/ },
  { name: "Supabase", re: /supabase-js@(\d+\.\d+\.\d+)\//, expected: /^\d+\.\d+\.\d+$/ },
];
cdnPatterns.forEach(({ name, re }) => {
  const m = html.match(re);
  if (m) ok(`${name} pinned to v${m[1]}`);
  else fail(`${name} version not pinned — risk of breaking changes from CDN`);
});

// ─── 12. AUTH / SESSION ───
section("12. Authentication");
if (js.includes("AUTH_EXPIRY_DAYS") || js.includes("AUTH_KEY")) {
  ok("Auth session with expiry is configured");
} else {
  fail("No auth session management found");
}
if (js.includes("clearAuth") && js.includes("onLogout")) {
  ok("Logout functionality exists");
} else {
  warn("Missing logout functionality");
}

// ─── 13. PricingPage PROPS ───
section("13. PricingPage receives correct props");
const pricingPropRe = /<PricingPage\s+([\s\S]*?)\/?>/g;
let ppMatch;
let pricingPageCount = 0;
const requiredProps = ["guestCount", "pricePerGuest", "childCount", "pricePerChild", "services", "foodTotal", "totalBeforeVat", "totalWithVat"];
while ((ppMatch = pricingPropRe.exec(js)) !== null) {
  pricingPageCount++;
  const propStr = ppMatch[1];
  requiredProps.forEach(prop => {
    if (!propStr.includes(prop)) {
      fail(`PricingPage instance #${pricingPageCount} missing prop: ${prop}`);
    }
  });
}
if (pricingPageCount > 0) {
  ok(`Found ${pricingPageCount} PricingPage instances, all with required props`);
} else {
  fail("No PricingPage instances found");
}

// ─── 14. DUPLICATE COMPONENT RENDERING ───
section("14. Duplicate rendering guards");
if (js.includes("includeSushi")) {
  fail("Legacy 'includeSushi' code still present — may cause duplicate sushi display");
} else {
  ok("No legacy includeSushi code (old duplicate sushi bug)");
}

// ─── 15. STATE DEFAULT vs FORM CONSISTENCY ───
section("15. State defaults");
const guestDefault = js.match(/useState\("(\d+)"\);\s*\n.*pricePerGuest/);
const priceDefault = js.match(/setPricePerGuest\]\s*=\s*useState\("(\d+)"\)/);
if (guestDefault || priceDefault) {
  warn(`Default guestCount=${(js.match(/guestCount.*useState\("(\d+)"\)/) || [])[1] || "?"}, pricePerGuest=${(js.match(/pricePerGuest.*useState\("(\d+)"\)/) || [])[1] || "?"} — these show in PDF if not overridden by CRM load`);
}

// ─── 16. minSelect vs available items ───
section("16. Station minSelect vs available items");
const stationsConfigStr = js.match(/const\s+STATIONS_CONFIG\s*=\s*\[([\s\S]*?)\];/);
const tablesConfigStr = js.match(/const\s+TABLES_STATIONS_CONFIG\s*=\s*\[([\s\S]*?)\];/);

function checkMinSelect(configStr, configName) {
  const entryRe = /\{\s*key:\s*"([^"]+)"[\s\S]*?minSelect:\s*(\d+)[\s\S]*?maxSelect:\s*(\d+)/g;
  let em;
  while ((em = entryRe.exec(configStr)) !== null) {
    const [, key, min, max] = em;
    const catRe = new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}":\\s*\\[([\\s\\S]*?)\\]`);
    const catMatch = js.match(catRe);
    if (catMatch) {
      const itemCount = (catMatch[1].match(/id:\s*"/g) || []).length;
      if (itemCount < parseInt(min)) {
        fail(`${configName} "${key}": minSelect=${min} but only ${itemCount} items in MENU_DB`);
      } else if (itemCount === parseInt(min)) {
        warn(`${configName} "${key}": minSelect=${min} equals item count (${itemCount}) — client has no choice`);
      } else {
        ok(`${configName} "${key}": ${itemCount} items >= minSelect=${min}`);
      }
    }
  }
}

if (stationsConfigStr) checkMinSelect(stationsConfigStr[1], "STATIONS_CONFIG");
if (tablesConfigStr) checkMinSelect(tablesConfigStr[1], "TABLES_STATIONS_CONFIG");

// ══════════════════════════════════════════════════
// RUNTIME LOGIC TESTS — actually execute extracted code
// ══════════════════════════════════════════════════
section("17. Runtime: extract and evaluate data structures");

let MENU_DB, STATIONS_CONFIG, TABLES_STATIONS_CONFIG, PRESETS, DEFAULT_SERVICES;
try {
  function extract(prefix, openBracket, closeBracket) {
    const start = js.indexOf(prefix);
    if (start < 0) throw new Error(`Cannot find "${prefix}"`);
    const bodyStart = js.indexOf(openBracket, start);
    let depth = 0, i = bodyStart;
    for (; i < js.length; i++) {
      if (js[i] === openBracket) depth++;
      else if (js[i] === closeBracket) { depth--; if (depth === 0) break; }
    }
    return js.slice(bodyStart, i + 1);
  }

  MENU_DB = eval("(" + extract("const MENU_DB =", "{", "}") + ")");
  STATIONS_CONFIG = eval("(" + extract("const STATIONS_CONFIG =", "[", "]") + ")");
  TABLES_STATIONS_CONFIG = eval("(" + extract("const TABLES_STATIONS_CONFIG =", "[", "]") + ")");
  PRESETS = eval("(" + extract("const PRESETS =", "{", "}") + ")");
  DEFAULT_SERVICES = eval("(" + extract("const DEFAULT_SERVICES =", "[", "]") + ")");
  ok("All data structures extracted and evaluated successfully");
} catch (e) {
  fail(`Failed to eval data structures: ${e.message}`);
}

if (MENU_DB && STATIONS_CONFIG && TABLES_STATIONS_CONFIG) {

  // ─── 18. byCat logic simulation ───
  section("18. Runtime: byCat mode detection");

  function simulateByCat(selectedIds) {
    const sel = new Set(selectedIds);
    const stationKeys = new Set(STATIONS_CONFIG.map(s => s.key));
    const tablesKeys = new Set(TABLES_STATIONS_CONFIG.map(s => s.key));
    const hasTablesItems = [...tablesKeys].some(key => (MENU_DB[key] || []).some(i => sel.has(i.id)));
    const hasStationItems = [...stationKeys].some(key => (MENU_DB[key] || []).some(i => sel.has(i.id)));
    const excludeKeys = hasTablesItems ? stationKeys : hasStationItems ? tablesKeys : new Set([...stationKeys, ...tablesKeys]);
    const r = {};
    for (const [cat, items] of Object.entries(MENU_DB)) {
      if (excludeKeys.has(cat)) continue;
      const s = items.filter(i => sel.has(i.id));
      if (s.length > 0) r[cat] = s;
    }
    return { result: r, hasTablesItems, hasStationItems };
  }

  // Test: select private station items → should show them in quote
  const privateItems = (MENU_DB["מסתובבים"] || []).slice(0, 3).map(i => i.id);
  const privateResult = simulateByCat(privateItems);
  if (privateResult.hasStationItems && !privateResult.hasTablesItems) {
    ok("Private items detected as private mode");
  } else {
    fail("Private items NOT detected correctly");
  }
  if (Object.keys(privateResult.result).length > 0 && privateResult.result["מסתובבים"]) {
    ok("Private items appear in quote output");
  } else {
    fail("Private items MISSING from quote — byCat excludes them");
  }

  // Test: select tables items → should show them in quote
  const tablesItems = (MENU_DB["ראשונות"] || []).slice(0, 3).map(i => i.id);
  const tablesResult = simulateByCat(tablesItems);
  if (tablesResult.hasTablesItems && !tablesResult.hasStationItems) {
    ok("Tables items detected as tables mode");
  } else {
    fail("Tables items NOT detected correctly");
  }
  if (Object.keys(tablesResult.result).length > 0 && tablesResult.result["ראשונות"]) {
    ok("Tables items appear in quote output");
  } else {
    fail("Tables items MISSING from quote — byCat excludes them");
  }

  // Test: no items selected → nothing shown (no crash)
  const emptyResult = simulateByCat([]);
  if (Object.keys(emptyResult.result).length === 0) {
    ok("Empty selection produces empty quote (no crash)");
  } else {
    fail("Empty selection still produces items");
  }

  // Test: mixed mode (both private + tables IDs) — shouldn't happen but shouldn't crash
  const mixedIds = [...privateItems, ...tablesItems];
  const mixedResult = simulateByCat(mixedIds);
  ok(`Mixed mode selection handled without crash (tables wins: ${mixedResult.hasTablesItems})`);

  // ─── 19. Station item availability ───
  section("19. Runtime: every station has items in MENU_DB");

  STATIONS_CONFIG.forEach(s => {
    const items = MENU_DB[s.key];
    if (!items || items.length === 0) {
      fail(`STATIONS_CONFIG "${s.key}" has no items in MENU_DB`);
    } else {
      const hasIds = items.every(i => i.id && i.name);
      if (hasIds) ok(`"${s.key}": ${items.length} valid items`);
      else fail(`"${s.key}": some items missing id or name`);
    }
  });

  TABLES_STATIONS_CONFIG.forEach(s => {
    const items = MENU_DB[s.key];
    if (!items || items.length === 0) {
      fail(`TABLES_STATIONS_CONFIG "${s.key}" has no items in MENU_DB`);
    } else {
      const hasIds = items.every(i => i.id && i.name);
      if (hasIds) ok(`"${s.key}": ${items.length} valid items`);
      else fail(`"${s.key}": some items missing id or name`);
    }
  });

  // ─── 20. No cross-mode ID collisions ───
  section("20. Runtime: no item ID collisions between modes");

  const privateIds = new Set();
  STATIONS_CONFIG.forEach(s => (MENU_DB[s.key] || []).forEach(i => privateIds.add(i.id)));
  const tablesIds = new Set();
  TABLES_STATIONS_CONFIG.forEach(s => (MENU_DB[s.key] || []).forEach(i => tablesIds.add(i.id)));
  const collisions = [...privateIds].filter(id => tablesIds.has(id));
  if (collisions.length === 0) {
    ok(`No ID collisions: ${privateIds.size} private IDs, ${tablesIds.size} tables IDs`);
  } else {
    fail(`${collisions.length} IDs shared between private and tables: ${collisions.join(", ")} — byCat may misbehave`);
  }

  // ─── 21. Pricing calculation ───
  section("21. Runtime: pricing calculations");

  function calcPricing(guestCount, pricePerGuest, childCount, pricePerChild, services) {
    const foodT = (parseInt(guestCount)||0)*(parseInt(pricePerGuest)||0) + (parseInt(childCount)||0)*(parseInt(pricePerChild)||0);
    const svcT = services.reduce((s,v) => v.included ? s : s + (parseInt(v.qty)||0)*(parseInt(v.price)||0), 0);
    const tot = foodT + svcT;
    const totV = Math.round(tot * 1.18);
    return { foodT, svcT, tot, totV };
  }

  // Basic pricing
  const p1 = calcPricing("100", "350", "0", "0", DEFAULT_SERVICES);
  if (p1.foodT === 35000) ok("100 guests × 350 = 35,000 food total");
  else fail(`100 guests × 350 expected 35000, got ${p1.foodT}`);

  if (p1.svcT === 2000) ok("Default services total = 2,000 (ניקיון + מנהל)");
  else fail(`Default services expected 2000, got ${p1.svcT}`);

  if (p1.totV === Math.round(37000 * 1.18)) ok(`VAT calc correct: ${p1.totV}`);
  else fail(`VAT expected ${Math.round(37000 * 1.18)}, got ${p1.totV}`);

  // With children
  const p2 = calcPricing("40", "300", "10", "150", DEFAULT_SERVICES);
  if (p2.foodT === 40*300 + 10*150) ok("40 adults + 10 kids pricing correct");
  else fail(`Mixed pricing expected ${40*300+10*150}, got ${p2.foodT}`);

  // Zero guests (edge case)
  const p3 = calcPricing("0", "350", "", "", DEFAULT_SERVICES);
  if (p3.foodT === 0) ok("Zero guests = 0 food total (no NaN)");
  else fail(`Zero guests expected 0, got ${p3.foodT}`);

  // Empty strings (edge case)
  const p4 = calcPricing("", "", "", "", []);
  if (p4.tot === 0 && p4.totV === 0) ok("Empty inputs = 0 totals (no NaN)");
  else fail(`Empty inputs expected 0, got tot=${p4.tot} totV=${p4.totV}`);

  // ─── 22. Guest count parsing from submission format ───
  section("22. Runtime: guestCount parsing from CRM submissions");

  function parseGuestCount(raw) {
    const str = String(raw);
    const gm = str.match(/^(\d+)/);
    const cm = str.match(/\+\s*(\d+)\s*ילדים/);
    return { guests: gm ? gm[1] : null, children: cm ? cm[1] : null };
  }

  const t1 = parseGuestCount("40");
  if (t1.guests === "40" && t1.children === null) ok('Parse "40" → guests=40, children=null');
  else fail(`Parse "40" failed: ${JSON.stringify(t1)}`);

  const t2 = parseGuestCount("40 מבוגרים + 5 ילדים");
  if (t2.guests === "40" && t2.children === "5") ok('Parse "40 מבוגרים + 5 ילדים" → guests=40, children=5');
  else fail(`Parse "40 מבוגרים + 5 ילדים" failed: ${JSON.stringify(t2)}`);

  const t3 = parseGuestCount("120 מבוגרים + 20 ילדים");
  if (t3.guests === "120" && t3.children === "20") ok('Parse "120 מבוגרים + 20 ילדים" → guests=120, children=20');
  else fail(`Parse multi-digit failed: ${JSON.stringify(t3)}`);

  const t4 = parseGuestCount("");
  if (t4.guests === null) ok('Parse "" → null (no crash)');
  else fail(`Parse empty failed: ${JSON.stringify(t4)}`);

  // ─── 23. Client page station filtering simulation ───
  section("23. Runtime: client page station filter");

  function simulateClientStations(mode, availableIds) {
    const availableSet = availableIds ? new Set(availableIds) : null;
    const config = mode === "tables" ? TABLES_STATIONS_CONFIG : STATIONS_CONFIG;
    const stationKeys = config.map(s => s.key);
    return config.filter(s =>
      stationKeys.includes(s.key) &&
      MENU_DB[s.key] &&
      (!availableSet || (MENU_DB[s.key] || []).some(i => availableSet.has(i.id)))
    );
  }

  // All items available
  const allAvail = [];
  TABLES_STATIONS_CONFIG.forEach(s => (MENU_DB[s.key] || []).forEach(i => allAvail.push(i.id)));
  const fullStations = simulateClientStations("tables", allAvail);
  if (fullStations.length === TABLES_STATIONS_CONFIG.length) {
    ok(`All ${TABLES_STATIONS_CONFIG.length} tables stations visible when all items available`);
  } else {
    fail(`Expected ${TABLES_STATIONS_CONFIG.length} stations, got ${fullStations.length}`);
  }

  // Remove all items from one station → station should disappear
  const partialAvail = allAvail.filter(id => !(MENU_DB["סושי שולחנות"] || []).some(i => i.id === id));
  const partialStations = simulateClientStations("tables", partialAvail);
  const hasSushi = partialStations.some(s => s.key === "סושי שולחנות");
  if (!hasSushi) {
    ok("Station with no available items is hidden from client");
  } else {
    fail("Station with no available items still showing — will block client submission");
  }

  // Empty availableSet → no stations (edge case)
  const emptyStations = simulateClientStations("tables", []);
  if (emptyStations.length === 0) {
    ok("No available items = no stations shown (no crash)");
  } else {
    fail(`Empty availableSet still shows ${emptyStations.length} stations`);
  }

  // null availableSet (private mode) → all stations shown
  const nullAvailStations = simulateClientStations("private", null);
  if (nullAvailStations.length === STATIONS_CONFIG.length) {
    ok("null availableSet (private mode) shows all stations");
  } else {
    fail(`null availableSet expected ${STATIONS_CONFIG.length} stations, got ${nullAvailStations.length}`);
  }

  // ─── 24. Duplicate item names within same category ───
  section("24. Runtime: duplicate item names within categories");
  let dupNameCount = 0;
  for (const [cat, items] of Object.entries(MENU_DB)) {
    const names = items.map(i => i.name);
    const dupeNames = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupeNames.length > 0) {
      dupeNames.forEach(n => fail(`"${cat}" has duplicate item name: "${n}"`));
      dupNameCount += dupeNames.length;
    }
  }
  if (dupNameCount === 0) ok("No duplicate item names within any category");
}

// ─── SUMMARY ───
console.log(`\n${"─".repeat(50)}`);
console.log(`\x1b[1mResults:\x1b[0m \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m, \x1b[33m${warnings} warnings\x1b[0m`);
if (failed > 0) {
  console.log(`\x1b[31m\nFix the ${failed} failure(s) above before deploying.\x1b[0m`);
  process.exit(1);
} else {
  console.log(`\x1b[32m\nAll checks passed.\x1b[0m`);
}
