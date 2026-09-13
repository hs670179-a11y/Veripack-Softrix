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
| OCR | Tesseract.js v5, runs **in the browser**; photos are auto-sized for the scanner first (shrunk from 12 MP, interpolated up if tiny — a small photo silently loses whole lines of print). The `eng` language model is **self-hosted** (`public/tesseract`, 2.9 MB) so a first scan pulls no third-party data host; only the engine WASM comes from the jsDelivr CDN by default, with an automatic fallback to it if our copy is missing. Your photo is never sent to either. See “Fully offline OCR”. |
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
npm test          # 127 tests, no network and no API key needed
npm run lint
npm run build
```

`npm test` runs: `rulesData` (legal text pinned), `rulesEngine` (prompt audit, verdict
normalisation, fail-gracefully), `authenticity` (date maths, lookups, check digits, plausibility),
`pipeline` (three complete labels end-to-end through a model stand-in that may only read the text
inside the prompt — and it asserts every ✅'s evidence really appears in the label text),
`ocrE2E` (**real OCR, real pipeline**: the three label photos go through Tesseract.js with the
same worker options the browser uses, then through both modules, asserting the exact verdicts),
`gemini` (the REST contract — URL, `inline_data` part for the photo, header-only key, empty/blocked
reply becomes an error — pinned offline against the documented shape, since the sandbox cannot reach
Google), `accessibility` (measured contrast ratios, tap-target and type sizes, focus ring,
reduced-motion, colour-not-alone status), `render` (the whole tree mounts through Vite's SSR
pipeline, so a crash on first paint is caught, and every `<label for>` is checked against the
rendered DOM),
`i18n` (the two string tables can never drift apart: same keys, same `{placeholders}`, and no
component may carry English prose the Hindi user would not get), plus
`governance` (the spec's non-negotiables: no counterfeit-detection wording, demo disclosure
rendered, key hygiene, allowed dependencies, only Section 8 statistics).

### Behaviour on real photographs

The generated fixtures are clean, so I also ran the pipeline against genuine product photos (front of
pack, held in hand, curved and shallow-focus). Two findings are now encoded in the code:

- **A photo that cannot be read cannot accuse a packet.** Tesseract returned 32–36 % confidence on
  those shots. Before this rule, tapping “Check anyway” produced `❌ 5 of 7 required label details
  are missing — ask the shopkeeper`, derived from garbage text. Now a low-confidence read downgrades
  every “missing” finding to ⚠️ *“this detail was not found, but the photo was too unclear to say it
  is missing”*, and the headline becomes “could not be confirmed”. A pass is still shown — with its
  quote on screen and an “unclear photo” tag — because a quote can be checked by eye, an absence
  cannot. It is enforced in code — `applyReadQuality()` for the legal checks and
  `capForReadQuality()` for Module 3, so a misread `BEST BEFORE` cannot shout “this pack is expired,
  do not buy” either; the vision row is exempt because it judges the photo, not the transcript.
  Both directions are covered (`tests/rulesEngine.test.mjs`, `tests/authenticity.test.mjs`): a *clear*
  photo still gets honest ❌, so the cap softens uncertainty and never real findings. The word-count
  gate also grew a character floor, because scanner noise like `. | - ,` clears a word count while
  containing nothing readable.

  Verified over all six images (three fixtures + three real photos), asserting the invariant “an
  unreadable photo cannot accuse a pack”:

  | Photo | read quality | report |
  | --- | --- | --- |
  | compliant fixture | clear, 92 % | ✅ 7/7, headline “all details printed” |
  | non-compliant fixture | clear, 87 % | ❌ 5 of 7 missing, headline “details are missing” |
  | expired fixture | clear, 93 % | ❌ expiry + FSSAI record, headline “expired” |
  | real atta pack, front only | LOW, 32 % | ⚠️ 7/7 “too unclear”, no accusation |
  | real granola pack, in hand | LOW, 32 % | ⚠️ 6/7 capped, no ❌ anywhere |
  | tiny cropped product image | not readable | app stops: “the photo could not be read” |
- The fixtures are judged by the app's own gate (`judgeOcr` in `src/lib/ocr.js`), not by a
  look-alike in the test helper, so a fixture that ever degrades fails the suite loudly.

### Manual end-to-end run

`docs/test-samples/` holds three generated label photos so you can test immediately:

| File | Expected report |
| --- | --- |
| `1-compliant-atta-500g.jpg` | 7/7 satisfied, FSSAI + barcode + dates ✅, quantity ✅ |
| `2-noncompliant-loose-pack.jpg` | 1/7 satisfied — MRP without "inclusive of all taxes", no generic name, no maker address, no consumer care, no MFD; ⚠️ on country of origin |
| `3-expired-milk-powder.jpg` | Headline "expiry date has already passed"; ❌ expiry (Dec 2024) and ❌ FSSAI record shown as lapsed |

Measured OCR confidence on these three is 87–93%, and `tests/ocrE2E.test.mjs` asserts the
verdicts above on the OCR'd text — so the OCR half of the checklist is verified automatically.
What still needs a human is the browser itself: open the preview, drag a file in, tap a button,
print. Then test a real packet from your kitchen — including a damaged or blurry photo, to see the
"photo could not be read" and "check anyway" paths. Regenerate the fixtures with
`bash docs/make-test-samples.sh` (needs ImageMagick).

### Fully offline OCR

`public/tesseract/eng.traineddata.gz` is a copy of `@tesseract.js-data/eng@1.0.0`
(`4.0.0_best_int` — the exact build tesseract.js downloads by default, so accuracy is unchanged).
`src/lib/ocr.js` points `langPath` at it; if that file is ever missing, `createOcrWorker` retries
with the CDN, so a partial deploy still works.

To also drop the CDN for the engine itself (e.g. a demo venue with no outside access), copy the
runtime next to it and pass the paths in:

```bash
mkdir -p public/tesseract/core
cp node_modules/tesseract.js/dist/worker.min.js          public/tesseract/
cp node_modules/tesseract.js-core/tesseract-core*lstm*   public/tesseract/core/
```

then add `workerPath: '/tesseract/worker.min.js'`, `corePath: '/tesseract/core'` to the
`createWorker` options in `src/lib/ocr.js`. That is deliberately **not** done here: it would add
~8 MB of WASM to the repo for a fallback path, and vendoring a data file but not code keeps the
supply-chain story honest and the download small.

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
7. **Absence needs legibility** — see “Behaviour on real photographs” above: `false` is only
   allowed from a read the scanner was confident about. This is the spec's “insufficient evidence,
   never a guessed pass/fail” rule applied to the *missing* direction too, which is where the real
   risk of wrongly accusing a small vendor lies.
8. **Hindi covers everything the user needs, not just the buttons** — including the “what this
   report cannot do” and privacy statements, which are the most important lines for a first-time
   user to read in their own language. A test fails if a component hardcodes prose instead of using
   the tables. Statistics are the one deliberate exception (Section 8 requires them verbatim).
9. **Logo & theme** — `public/logo.svg` (and `public/favicon.svg`) are a stand-in drawn for this
   build: a blue carton with a verification shield, saffron and green label strips. The palette in
   `src/styles/tokens.css` is sampled from it (`--saffron #FF9124`, `--navy #14276B`,
   `--green #0F7A3D`). Drop your real file in as `public/logo.svg` and update the four token values
   to match; nothing else needs changing.

## 8. Deployment (not done yet)

`vercel.json` pins the deployment shape: Vite framework, `npm ci` → `npm run build` → `dist/`,
and **Node 24** as the build runtime (the version the spec requires). No secrets are in that file
and nothing in the repo deploys anything automatically.

Before going live: set `VITE_GEMINI_API_KEY` in Vercel → Settings → Environment Variables for both
Production and Preview, then deploy. **Do not deploy until that key is in place** — otherwise every
rule row shows ⚠️ “check unavailable” to everyone who opens the link. `npm run preview` checks the
built bundle locally first.

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
