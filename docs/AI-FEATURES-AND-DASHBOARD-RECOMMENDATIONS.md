# AI Feature Integration & Statistics Dashboard — Recommendations

Recommendations for the **Accessibility Test Suite** to add AI-powered features (for clients and developers) and presentation-grade graphs/statistics dashboards.

---

## 1. AI Features for Clients

| Feature | Benefit | Implementation idea |
|--------|---------|---------------------|
| **Plain-language executive summary** | Clients get a 2–3 sentence “so what?” without reading the full report. | After each run, call an LLM (e.g. OpenAI/Anthropic) with `reportData` (score, pass/fail/warn, top violations). Prompt: “Summarize this accessibility audit in 2–3 sentences for a non-technical stakeholder.” Store in report JSON and show at top of client presentation. |
| **Risk / priority explanation** | Clients understand why certain issues matter (legal, UX, inclusivity). | For each high-impact issue or axe violation, optionally generate 1–2 sentences: “Why this matters” (e.g. “Failing contrast can exclude users with low vision and may not meet legal requirements”). Use rule id + impact + WCAG refs as context. |
| **Phased plan in natural language** | Current phases are list-based; clients prefer narrative. | Generate a short paragraph per phase (Quick wins / Medium / Long-term) from `fixOrderItems`: “Phase 1 focuses on X, Y, Z. We recommend tackling these first because…” |
| **Accessibility statement drafting** | Speed up publishing a public statement. | Extend `generateAccessibilityStatement`: send tested URLs, known limitations, and conformance level to an LLM to produce a first-draft statement (with placeholders for contact and date). |
| **“What we tested” summary** | Clear scope for stakeholders. | AI-generated bullet list: “We tested N pages including homepage, contact, and key product pages. Testing covered structure, images, forms, and keyboard access.” |

---

## 2. AI Features for Developers

| Feature | Benefit | Implementation idea |
|--------|---------|---------------------|
| **Context-aware fix suggestions** | Snippets in `remediation-data.js` are generic; devs need page-specific guidance. | For each failure: send rule id, selector, snippet of DOM/html, and (optional) screenshot or HTML snippet to an LLM. Return: “For this page, change X to Y” plus optional code snippet. Cache by rule+selector hash to limit API calls. |
| **Auto-generated code patches** | Reduce copy-paste and guesswork. | For deterministic rules (e.g. missing `alt`, missing `lang`): LLM or small heuristic could suggest exact HTML/JSX diff. Show in developer guide as “Suggested fix” with copy button. |
| **Issue grouping and deduplication** | Same root cause often appears many times. | Cluster violations by rule + similar node (e.g. “all images in this carousel”). LLM or rules: “These 5 failures are the same fix: add alt to the carousel images.” Show one fix with “Applies to: 5 elements.” |
| **WCAG criterion explanation** | Developers understand the “why” behind each rule. | For each rule/SC in the report: one-time or cached LLM call to get a 2-sentence “Developer-friendly” explanation + link to W3C. Store in remediation or a small FAQ. |
| **CI / PR comment summary** | Integrate with GitHub/GitLab. | When running in CI, call LLM to turn `accessibility-results.json` into a short PR comment: “Accessibility: 3 new issues (2 contrast, 1 missing label). No regressions.” |

---

## 3. Presentation Graphs & Statistics Dashboard

### 3.1 Single-report view (current report page)

Add visualizations that use existing data (`accessibility-results.json`, `summary`, axe by chapter):

| Widget | Data source | Purpose |
|--------|-------------|--------|
| **Score gauge or donut** | `score`, `scoreClamp` | At-a-glance health (e.g. 0–100 with green/amber/red bands). |
| **Pass / Warn / Fail bar or stacked bar** | `summary.pass`, `summary.warn`, `summary.fail`, axe violation count | Show proportion of passed vs. failed checks. |
| **Issues by chapter (bar chart)** | `customResults` + axe `byChapter` | X-axis: Deque chapters (Semantics, Images, Forms, etc.); Y-axis: fail + warn count. Highlights which areas need the most work. |
| **Issues by WCAG level (pie or bar)** | Map rules to WCAG A / AA / AAA | Show conformance level distribution of failures (e.g. “12 A, 5 AA”). |
| **Impact by disability (horizontal bar or cards)** | `disabilityStats` (already in client presentation) | Keep or enhance as a small bar chart for “Who benefits from fixing these issues.” |
| **Top 5 rules (table or bar)** | Violations + custom results grouped by rule | “Most frequent issues” for prioritization. |
| **Per-URL breakdown (table + mini sparklines)** | `axeResults` per URL, `customResults` by URL | Rows = URLs; columns = pass/warn/fail/violations; optional tiny bar per row. |

### 3.2 Cross-run / trends dashboard (new)

If you persist multiple runs (e.g. by report id and timestamp):

| Widget | Data source | Purpose |
|--------|-------------|--------|
| **Score over time (line chart)** | Historical `score` per run (same site or same URL set) | Show improvement or regression. |
| **Issue trend (stacked area or line)** | Historical pass/warn/fail/violations per run | “Are we fixing more than we’re adding?” |
| **Run list** | Report IDs, dates, URL count, summary | Table or cards: click to open that report. |
| **Comparison view** | Two report IDs | Side-by-side or diff: “Run A vs Run B” (e.g. before/after a sprint). |

### 3.3 Implementation options

- **Charts**: Use a small client-side library (e.g. **Chart.js**, **ApexCharts**, or **D3**) in the report HTML, or generate **static SVG** in `generate-report.js` / `generate-deliverables.js` for PDF/print.
- **Data**: Single-report charts can be driven by the same JSON already loaded for the report. For trends, add an optional **history API** (e.g. `GET /api/reports` returning list of report ids + summary) and store `generatedAt` and `summary` per report.
- **Dashboard page**: New route, e.g. `/dashboard`, that:
  - Reads from `reports/*/accessibility-results.json` (or from a DB if you add one), and
  - Renders the cross-run widgets above.

---

## 4. Quick Wins (low effort, high value)

1. **Score gauge or donut** on the main report and client presentation (data already there).
2. **Bar chart “Issues by chapter”** from existing `byChapter` and custom results.
3. **Executive summary**: one LLM call per report with `score`, `summary`, and top 3 rule names; display at top of client view.
4. **Developer “Why this matters”**: one LLM call per unique rule id (cached) for the developer guide.

---

## 5. Data You Already Have (for AI and dashboards)

- **Per run**: `generatedAt`, `urls[]`, `summary{ pass, fail, warn }`, `axeResults[url]`, `customResults[]`, axe `byChapter`, screenshots.
- **Per deliverable**: `fixOrderItems` (rule, impact, effort, snippet), `disabilityStats`, `score`, `totalAxeViolations`.
- **Optional**: `accessibility-results-previous.json` for simple before/after (already used in report).

No new backend is strictly required for single-report charts and one-off AI summaries; for a full trends dashboard, consider persisting report metadata (id, timestamp, summary, URL count) in a JSON index file or a small database.

---

## 6. Summary Table

| Category | Feature | Client | Developer | Dashboard |
|----------|---------|--------|-----------|-----------|
| AI | Executive summary | ✅ | | |
| AI | “Why this matters” per issue | ✅ | ✅ | |
| AI | Context-aware fix suggestions | | ✅ | |
| AI | Accessibility statement draft | ✅ | | |
| AI | PR/CI summary | | ✅ | |
| Charts | Score gauge/donut | ✅ | | ✅ |
| Charts | Pass/warn/fail bars | ✅ | | ✅ |
| Charts | Issues by chapter | ✅ | ✅ | ✅ |
| Charts | Issues by WCAG level | ✅ | | ✅ |
| Charts | Score over time | | | ✅ |
| Charts | Run list & comparison | | | ✅ |

Use this document as a roadmap to pick the first set of AI features and dashboard widgets that best fit your clients and team.
