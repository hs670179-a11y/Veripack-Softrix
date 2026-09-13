# VeriPack

**Smart India Hackathon 2026 — problem statement SIH26034**: *Software system to check compliance of
packaged commodities under the Legal Metrology (Packaged Commodities) Rules, 2011* (Ministry of
Consumer Affairs, Food & Public Distribution).

Point the phone camera at a packet's label. VeriPack reads the text on the device, checks it
against the seven Rule 6 declarations the law requires, separately verifies the credentials the
label declares (dates, FSSAI number, barcode, BIS mark, packaging condition in the photo), and
combines both into one cited Trust Report you can print or save as PDF.

It is a lean MVP: no login, no database, no analytics, one page, English + हिन्दी.

---

## 1. Run it

```bash
npm install
cp .env.example .env      # then paste your Gemini API key into VITE_GEMINI_API_KEY
npm run dev               # http://localhost:5173
```

| Need | Detail |
| --- | --- |
| Node.js | **24 (Active LTS)** per the build spec. The Vite 8 toolchain itself only requires ≥ 20.19, so the build also runs on Node 22 images. |
| OCR | Tesseract.js v5, runs **in the browser**. Its engine (WASM) and the `eng` language data are fetched from public CDNs on first scan; your photo is never sent to them. |
| LLM | Google **Gemini API**, `gemini-3.8-flash` — the default model was verified on 2026-09-14 against <https://ai.google.dev/gemini-api/docs> (note: `gemini-2.5-flash` shuts down in October 2026). Override with `VITE_GEMINI_MODEL` if the default moves. |
| HTTP | axios v1 |
| Deploy | Vercel (`npm run build` → `dist/`) |

### Without an API key

The app still runs: OCR, the extracted-text panel, and every offline authenticity check (dates,
demo-dataset lookups, quantity plausibility) all work. Only the two LLM-backed parts — the 7 rule
checks and the photo condition check — answer **"⚠️ could not confirm / check unavailable"**.

This is deliberate: *a check that did not run is never reported as a pass.*

## 2. Environment variables

Copy `.env.example` to `.env`:

```
VITE_GEMINI_API_KEY=        # never commit this file; blank here on purpose
VITE_GEMINI_MODEL=gemini-3.8-flash
```

Get a key at <https://aistudio.google.com/apikey>. Restart `npm run dev` after editing.

⚠️ **Vercel does not read your local `.env`.** After importing the project, add both variables in
*Vercel → Project → Settings → Environment Variables* (Production **and** Preview), then redeploy.
A key committed into Git is a leaked key: `.gitignore` contains `.env`, and
`tests/governance.test.mjs` fails the build if a key literal appears in the source or if
`import.meta.env` stops being the only place the key is read.

## 3. What gets checked

### Module 2 — Legal Metrology compliance (`src/data/rules.json`)

Exactly the 7 clauses from Rule 6, described verbatim as specified — no more, no fewer
(`tests/rulesData.test.mjs` fails on any drift):

| Rule | Section |
| --- | --- |
| Net Quantity Declaration | Rule 6 |
| Maximum Retail Price Declaration (inclusive of all taxes) | Rule 6(1)(f) |
| Manufacturer / Packer / Importer name and complete address | Rule 6(1)(a) |
| Consumer Care details | Rule 6(1)(a) |
| Month and year of manufacture / packing / import | Rule 6(1)(d) |
| Country of origin (imports) | Rule 6(1)(a) / LM Import Rules |
| Common or generic name of the commodity | Rule 6(1)(a) |

Each rule is checked by one Gemini call whose prompt contains **only** the rule text and the OCR
text, delimited as `<<<LABEL_TEXT … LABEL_TEXT>>>`, plus these instructions: quote the words you
relied on, never use general knowledge or what labels "usually" say, and answer
`insufficient_evidence` whenever the text is unclear. The response is
`{ ruleId, satisfied: true | false | "insufficient_evidence", evidence, reason }`.
Two extra guards: an API error/timeout/missing key becomes `check unavailable` (⚠️), and a `true`
with no quote is downgraded to ⚠️ — a pass must always carry evidence you can read on screen.
Tap **"Show the exact instruction sent for this rule"** on any row to see the real prompt.

### Module 3 — Authenticity & Quality Assurance (credential verification)

| # | Check | How | Needs network? |
| --- | --- | --- | --- |
| 1 | Expiry / freshness | Parses manufacture, expiry and "shelf life N months" patterns from the label text and does date arithmetic against today. Flags expired and nearing-expiry (≤ 90 days). | No |
| 2 | FSSAI licence number | Extracts the 14-digit number (solid or spaced) and looks it up in `src/data/fssaiSampleData.json`. | No |
| 3 | Declared quantity plausibility | Soft heuristic: unit-vs-commodity contradiction and magnitude band. Labelled "soft check" everywhere. | No |
| 4 | Packaging condition in the photo | One Gemini *vision* call: torn / punctured / leaking / bulging / broken seal → flag + one line, no score. | Yes |
| 5 | Barcode / GS1, BIS/ISI | EAN-13 check digit is real arithmetic; prefix range 890–899 = India (published); company/BIS records come from the demo files. | No |

## 4. ⚠️ Demo dataset disclosure

**FSSAI, GS1 and BIS do not expose a clean public API, so checks 2, 5 and 6 use small hardcoded
sample files.** The UI says so twice: a full note at the top of the Authenticity section and a
`⚠ Demo dataset — production version integrates live registries` badge on each affected row.

Honest provenance, stated in the data files themselves: the sandbox this MVP was built in had
**no network access** to `foscos.fssai.gov.in`, GS1 GEPIR or the BIS portal, so none of the sample
numbers could be checked against the registry. They are **illustrative demo records** that exercise
the lookup path — they are *not* verified live data, and printing them as such would be a
fabrication. Before any public deployment, either replace the three files with records a human
pulled from the registries, or swap `verifyFssaiLicense()` / `checkBarcode()` / `checkBisMark()`
for live calls.

A number that is **not** in the sample files returns *"not in the demo dataset, so this app cannot
verify it"* — never "invalid".

## 5. Privacy

- Your photo never reaches a server: Tesseract.js decodes and reads it inside the browser tab.
- No account, no database, no analytics, no third-party tracking script, nothing stored
  (`tests/governance.test.mjs` enforces both).
- Label text and the photo go **only** to the Gemini call that produces the verdicts.
- The only thing remembered on the device is your UI language choice (`localStorage`, `src/i18n/LangProvider.jsx`).
- The printed report's reference code is generated locally and never sent anywhere.

## 6. Tests

```bash
npm test          # 82 tests, no network and no API key needed
npm run lint
npm run build
```

`npm test` runs four suites: `rulesData` (legal text pinned), `rulesEngine` (prompt audit, verdict
normalisation, fail-gracefully), `authenticity` (date maths, lookups, check digits, plausibility),
`pipeline` (three complete labels end-to-end through a model stand-in that may only read the text
inside the prompt — and it asserts every ✅'s evidence really appears in the label text),
`render` (the whole tree mounts through Vite's SSR pipeline, so a crash on first paint is caught),
`i18n` (the two string tables can never drift apart: same keys, same `{placeholders}`), plus
`governance` (the spec's non-negotiables: no counterfeit-detection wording, demo disclosure
rendered, key hygiene, allowed dependencies, only Section 8 statistics).

### Manual end-to-end run

`docs/test-samples/` holds three generated label photos so you can test immediately:

| File | Expected report |
| --- | --- |
| `1-compliant-atta-500g.jpg` | 7/7 satisfied, FSSAI + barcode + dates ✅, quantity ✅ |
| `2-noncompliant-loose-pack.jpg` | 1/7 satisfied — MRP without "inclusive of all taxes", no generic name, no maker address, no consumer care, no MFD; ⚠️ on country of origin |
| `3-expired-milk-powder.jpg` | Headline "expiry date has already passed"; ❌ expiry (Dec 2024) and ❌ FSSAI record shown as lapsed |

Drag one into the app (or `npm run dev` → *Choose a photo*). Expect OCR confidence in the high 80s /
90s on these. Then test a real packet from your kitchen — including a damaged or blurry photo, to
see the "photo could not be read" and "check anyway" paths.

## 7. Decisions worth knowing about

1. **English/Hindi toggle** — Section 7 lists multi-language UI as out of scope; the human partner
   asked for it because the app is for rural consumers, so it exists as one flat string table in
   `src/i18n/strings.js` (no i18n library). **Legal text is never translated** — rule names, sections and
   descriptions stay verbatim English, and model-written reasons stay English because they quote the
   label.
2. **Rural-first UI** — one thing per screen, 19px type, 62px buttons, ✅/❌/⚠️ always with words
   (never colour alone), plain-word status copy, a big progress line, and a print/PDF button.
3. **Plausibility check** — the spec suggested comparing declared weight against package size from
   image dimensions. A single photo has no scale reference, so that would be a fabricated
   measurement; instead the check uses unit-vs-commodity contradiction plus a magnitude band and is
   labelled "soft check, not a legal finding" in the UI.
4. **Structured output** — `responseMimeType`/`responseSchema` currently differ between Google's
   `generateContent` and newer docs, so the client asks for JSON in the prompt and parses it
   defensively (`parseJsonObject` handles fences and prose) rather than hardcoding a field name
   that could silently break the demo.
5. **JSON import attributes** (`with { type: 'json' }`) — added so the same modules load in Vite and
   in plain Node for tests.
6. **FSSAI sample records are illustrative**, not "manually verified" — see §4.
7. **Logo & theme** — `public/logo.svg` (and `public/favicon.svg`) are a stand-in drawn for this
   build: a blue carton with a verification shield, saffron and green label strips. The palette in
   `src/styles/tokens.css` is sampled from it (`--saffron #FF9124`, `--navy #14276B`,
   `--green #0F7A3D`). Drop your real file in as `public/logo.svg` and update the four token values
   to match; nothing else needs changing.

## 8. Deployment (not done yet)

`npm run build` → `dist/`, Vercel auto-detects Vite. **Do not deploy until the Gemini key is ready
in Vercel's Environment Variables** (§2); otherwise the deployed demo shows ⚠️ on every rule.

## 9. Layout

```
index.html, vite.config.js
public/logo.svg, favicon.svg          brand assets (see §7.7)
docs/test-samples/*.jpg               three generated label photos
src/App.jsx                           one page: upload → read → report
src/components/                       Uploader, ProgressCard, Report, ReportSection, CheckRow,
                                      ExtractedTextPanel, Notice, Steps, AboutSheet
src/lib/ocr.js                        Tesseract.js v5 + photo/text quality gates
src/lib/gemini.js                     the only place the network is touched
src/lib/rulesEngine.js                prompt builder, verdict guards, summary counts
src/lib/authenticity.js               Modules 3.1–3.5, all pure logic but the vision call
src/lib/report.js                     headline precedence, stamp, local reference code
src/i18n/                             strings.js (EN/HI UI copy), LangProvider.jsx, context.js
src/data/                             rules.json + 3 demo registry files + approvedStats.json
src/styles/                           tokens.css (logo-derived palette), app.css (incl. print CSS)
tests/                                unit + governance tests (npm test)
```

Out of scope, as specified: auth, payments, native app, custom-trained models, admin CMS, other
Legal Metrology rules, other registries, databases, Docker, and any additional feature not in
Sections 2–5 of the build brief.
