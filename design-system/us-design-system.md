# Us Design System — build rules

Source of truth: Figma file **Us - Design System** (`ObyTQ40kofwt9Ve44lzAQv`).
Token values live in `us-tokens.css`, generated from that file. This document
holds the rules the tokens cannot express.

If this document and Figma disagree, Figma wins. Regenerate the tokens rather
than editing values by hand.

**Default for Cursor and digital work:** use the **Web profile** (Owners,
IvyPresto Display, Public Sans). Presentation rules (Archivo, decks, `.pptx`) apply
**only when the user explicitly asks** for a presentation, pitch deck, or similar
deliverable — do not load presentation fonts or `data-us-fonts="presentation"` by
default.

---

## 0. Token-only policy

**Every project that uses this design system must use only what is defined here.
Nothing else.**

This applies to all UI work: web, mobile, presentations, PDFs, emails, and
AI-generated output. There are no exceptions unless a designer explicitly
approves them outside this system.

### Allowed sources

| Need | Use |
|---|---|
| Colours, spacing, radii, shadows, typography sizes | CSS variables in `us-tokens.css` only |
| Font families | `--typography-font-*` tokens and the loading instructions in §3 |
| Semantic UI colours | 02 tokens (`--content-body`, `--button-default-state-*`, etc.) — never primitives |
| Layout, casing, component behaviour | Rules in this document |

### Forbidden without approval

Do **not** introduce any of the following in a Us project:

- Raw hex, `rgb()`, `hsl()`, or named CSS colours
- Hard-coded `px`, `rem`, or `%` for spacing, type, or radius (use tokens)
- Font families not listed in `us-tokens.css` (no Inter, Roboto, Arial, system
  defaults as a design choice, no Google Fonts outside the documented stacks)
- Tailwind/theme values not mapped from `us-tokens.css`
- Custom shadows, borders, gradients, or animations not defined in the tokens
- Letter-spacing, synthetic bold on Archivo Black, or other styles this document
  explicitly forbids

### When something is missing — stop and ask

If the design system does **not** define what you need (a new component variant,
a colour pairing, an eyebrow style, a chart palette, a third-party widget skin):

1. **Do not invent a value** and do not approximate with “close enough” tokens.
2. **Do not continue building** the affected screen, component, or page until
   the gap is resolved.
3. **Tell the user clearly** what is missing and ask whether to:
   - extend the Figma file and regenerate `us-tokens.css`, or
   - get a designer decision, or
   - descope the feature for now.

A plausible wrong value is worse than an obvious gap. Agents and developers must
treat “undefined in the design system” as a **blocker**, not a licence to improvise.

### Project setup requirement

New projects must include before any UI is built:

1. `us-tokens.css` imported at the app root
2. **Web profile font loading** from §3 (Adobe kits `dbo7deg` + `rgx8kmt`, plus
   Material Symbols and Public Sans as needed). Presentation fonts only if the
   project is explicitly a deck or presentation deliverable.
3. `.cursor/rules/us-token-enforcement.mdc` from this repository (always-on)

See `PROJECT_SETUP.md` for the full bootstrap checklist.

---

## 1. Non-negotiables

Read these before anything else. Most bad output comes from breaking one of them.

1. **Never write a raw hex, px or font name.** Use a token from `us-tokens.css`.
   If no token fits, the design does not support what you are building. **Stop
   and ask** — do not invent a value or continue the affected UI.
2. **Never use a primitive colour directly.** `--color-primary-lavender` is a
   palette entry, not a UI colour. Components use the 02 tokens
   (`--button-default-state-button-bg-default`, `--content-body`,
   `--page-page-background`).
3. **Buttons are black, not purple.** Primary button is Shark `#191A1B` with
   white label. The brand pastels are decoration, never interface chrome.
4. **Uppercase is for large headings only.** H1, H2 and H3 and CTA banners are
   uppercase. H4 down, card titles, eyebrows, labels and all body text are
   sentence case. In presentations this tightens further: only the main slide
   title is uppercase.
5. **Spacing comes from the scale.** 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64,
   80, 96, 112. Nothing between those steps. No 10px, no 15px, no 30px.
6. **Never apply letter-spacing.** All 46 text styles in Figma are set to 0.
   Tracking is not part of this system, at any size, in any weight, including
   small uppercase labels and eyebrows.
7. **Content maxes out at 1180px inside a 1440px canvas, and is fluid below
   that.** Never build a fixed-width page. Full-bleed backgrounds may cross the
   container, content may not.
8. **One typeface per role, and one profile per output.** Owners for headings
   and UI, IvyPresto for quotes and alt headings, Public Sans for body, on web.
   Archivo replaces both brand faces in presentations. Never mix profiles inside
   one deliverable.

---

## 2. Token naming

Variable names mirror the Figma token path. The transform is mechanical:
lowercase, slashes and spaces become hyphens, underscores are preserved.

| Figma | CSS |
|---|---|
| `Content/Heading` | `--content-heading` |
| `Page/Page-Background` | `--page-page-background` |
| `Button/Default State/Button-Bg-Default` | `--button-default-state-button-bg-default` |
| `Color/Primary/Lavender` | `--color-primary-lavender` |
| `Spacing/1,5 rem` | `--spacing-1-5-rem` |
| `Margins/Row_Indent-Large (Default)` | `--margins-row_indent-large-default` |
| `Typography/Font-Size/H1/Default` | `--typography-font-size-h1-default` |

CSS custom properties cannot contain slashes or spaces, so this is as close to
the Figma string as the language allows. Anyone can go from a Figma layer
inspector to a CSS variable without a lookup table.

---

## 3. Typefaces

Two profiles. Same sizes, same spacing, same colours. Only the families differ.

### Default: Web profile

**Cursor and typical digital web projects use Web only.** Load Owners and
IvyPresto from Adobe Fonts, Public Sans for body, Material Symbols for UI icons.
Do not switch to the presentation profile unless the user explicitly requests a
deck, `.pptx`, PDF slide export, or other presentation deliverable.

| | Web / digital product *(default)* | Presentation *(explicit request only)* |
|---|---|---|
| Headings, nav, buttons, card titles | **Owners** (XWide, Wide, Regular, Narrow, XNarrow) | **Archivo** / Archivo Black / Archivo Narrow |
| Quotes, alt headings | **IvyPresto Display** | **Archivo** (Thin / Light) |
| Body copy | **Public Sans** | **Public Sans** |
| UI icons | **Material Symbols Outlined**, weight 300 | same |
| Brand / social marks | Font Awesome 6 Brands | same |

Web is the default in `us-tokens.css`. **Do not** set `data-us-fonts="presentation"`
unless building a presentation. Switch to presentation only when the user asks.
Archivo trails every web stack as a fallback so a page still renders sensibly
before the Owners webfont files are hosted.

### Why the split

Owners and IvyPresto are licensed for digital products, where the fonts are
self-hosted and the rendering environment is controlled. A deck is not a
controlled environment: it opens on a client's laptop, gets exported to PDF,
gets pasted into someone else's template. Archivo and Public Sans are Google
Fonts, so a deck built on them renders correctly everywhere with nothing
installed.

### Widths

| Owners width | Web (family name) | Presentation (`font-stretch`) |
|---|---|---|
| XNarrow | `owners-xnarrow` (not in kit) | 62% |
| Narrow | `owners-narrow` (not in kit) | 75% |
| Regular | `owners` | 100% |
| Wide | `owners-wide` | 112% |
| XWide | `owners-xwide` | 125% |

The two profiles handle width by different mechanisms. On web the Adobe kit
serves static faces, so width is a family name and `font-stretch` does nothing.
In the presentation profile there is no "Archivo Wide" family, so width comes
from Archivo's variable width axis via the `--font-stretch-*` tokens.

PowerPoint and Word cannot render variable axes at all. In a real deck, use the
static families (`--typography-font-static-*`), accept regular width, and do
not fake Wide with letter-spacing.

**Archivo Black is single-weight (400).** Never apply `font-weight: 700` on top
of it. The renderer synthesises a fake bold over an already-heavy face and the
result looks smeared.

### Tracking

There is none. Every text style in Figma is set to letter-spacing 0, all 46 of
them, across both typefaces and every size and weight.

Do not add tracking to compensate for a small size, a heavy weight, or an
uppercase label. Loosened small caps read as a different brand.

- CSS: do not set `letter-spacing`. If a reset or component library adds it,
  override with `letter-spacing: normal`.
- pptxgenjs: never set `charSpacing`.
- PowerPoint by hand: character spacing stays Normal.

### Icons

UI icons are **Material Symbols Outlined at weight 300**. Same in both profiles,
since Material Symbols is a Google Font and works everywhere.

Note the family name. "Material Icons" is the legacy static font and has no
weight axis, so weight 300 is not expressible in it. Weight 300 requires
**Material Symbols**, the variable version.

Four axes, always set together:

| Axis | Range | Us value |
|---|---|---|
| `wght` | 100 to 700 | **300** |
| `FILL` | 0 to 1 | 0 default, 1 for active or selected states |
| `GRAD` | -50 to 200 | 0 default, **-50 on dark backgrounds** |
| `opsz` | 20 to 48 | match the rendered size |

```css
.icon {
  font-family: var(--typography-font-icons);
  font-size: var(--typography-font-size-icons-24);
  color: var(--icon-icon-10);
  font-variation-settings:
    "FILL" var(--typography-icon-fill),
    "wght" var(--typography-icon-weight),
    "GRAD" var(--typography-icon-grade),
    "opsz" var(--typography-icon-opsz);
}
```

The grade override is already wired into the colour modes: `dark` and
`color-dark` set `--typography-icon-grade` to -50, which is the recommended
correction for light icons on a dark field. Nobody has to remember it.

Three things to watch:

1. **The style is Outlined.** Confirmed, not an assumption. Material Symbols
   also ships Rounded and Sharp. Never mix them in one product.
2. **The 12px and 16px sizes sit below the optical size floor.** The `opsz`
   axis bottoms out at 20, so small icons cannot be optically corrected and
   weight 300 will look thin at 12px. Only 20px and 24px are drawn on a perfect
   pixel grid. Prefer 16px as the smallest, and check 12px against a real
   screen before using it.
3. **Font Awesome is for brand marks only.** Material Symbols has no logos,
   so LinkedIn, Instagram and YouTube come from Font Awesome 6 Brands at 12,
   16, 24 and 32px, matching the `Brand/` text styles in Figma. Font Awesome is
   never used for UI icons.

### Loading

Web, from two Adobe Fonts kits. Load both before the tokens file:

```html
<link rel="stylesheet" href="https://use.typekit.net/dbo7deg.css">
<link rel="stylesheet" href="https://use.typekit.net/rgx8kmt.css">
```

Family names are Adobe's, lowercase and hyphenated. Use `"owners-wide"`, not
`"Owners Wide"`.

Two properties of these kits to design around:

**The faces are static, not variable.** Every `@font-face` declares a single
weight and `font-stretch: normal`. Do not apply `font-stretch` on web, it will
select nothing. Width comes from the family name.

**Adobe kits are domain-restricted.** They only serve fonts on domains
registered in their settings, and this applies to both kits separately. Add
`localhost` and any preview or staging domain to each, or the fonts silently
fall through to Archivo in local development while working fine in production.
That failure mode is easy to miss.

### What the kits contain

**`dbo7deg` — Owners.** Seven widths, all with the same weight set:

| Family | |
|---|---|
| `owners-xxnarrow`, `owners-xnarrow`, `owners-narrow` | narrower than regular |
| `owners` | regular |
| `owners-wide`, `owners-xwide`, `owners-xxwide` | wider than regular |

Weights per width: **200, 300, 400, 500, 700, 800, 900**, roman and italic.
No 100, no 600.

**`rgx8kmt` — IvyPresto Display.** One family, `ivypresto-display`, at weights
**100, 300, 400, 600, 700**, roman and italic. No 200, 500, 800 or 900.

Together these cover the entire type ramp. Every heading, nav item, button,
card title, alt heading and quote resolves to a real face. Nothing falls back
to Archivo on web.

Available but unused by the system: `owners-xxnarrow`, `owners-xxwide`, and the
full italic sets in both families. No Figma variable points at any of them.
Adding them is a design decision, not a technical one.

Minor housekeeping: these are two separate kits, so two requests and two domain
allowlists to maintain. Merging them into one kit in Adobe would remove both.

Presentation, from Google Fonts:

```html
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=Archivo+Black&family=Archivo+Narrow:wght@400..700&family=Public+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

Icons, both profiles:

```html
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet">
```

That URL loads the full axis ranges, which is a large file. Once the icon set
is settled, pin the axes to the values actually used
(`@20..48,300,0..1,-50..0`) or self-host via the `material-symbols` npm
package.

Axis order in the Archivo URL matters: registered axes are listed
alphabetically with `wght` always last. `wdth,wght` is correct, `wght,wdth`
will not load.

---

## 4. Type ramp

Values are desktop / mobile. Line heights are fixed pixel values, not multipliers.

| Style | Web face | Weight | Size | Line height | Case |
|---|---|---|---|---|---|
| H1 | Owners Wide | 700 | 56 / 40 | 80 / 64 | UPPER |
| H1 small | Owners Wide | 700 | 48 / 40 | 64 / 56 | UPPER |
| H1 XL (hero) | Owners XWide | 700 | 112 / 64 | 136 / 80 | UPPER |
| H2 | Owners Wide | 700 | 40 / 32 | 56 / 56 | UPPER |
| H3 | Owners Wide | 700 | 24 / 20 | 40 / 32 | UPPER |
| H4 | Owners | 500 | 24 / 20 | 32 / 32 | Sentence |
| H5 | Owners | 500 | 20 / 20 | 32 / 32 | Sentence |
| H6 | Owners | 300 | 20 / 20 | 32 / 32 | Sentence |
| H1 alt | IvyPresto Display | 100 | 56 / 40 | 80 / 64 | UPPER |
| H2 alt | IvyPresto Display | 300 | 40 / 32 | 56 / 56 | UPPER |
| H3 alt | IvyPresto Display | 300 | 24 / 20 | 40 / 32 | UPPER |
| Quote small | IvyPresto Display | 100 | 32 / 24 | 48 / 32 | Sentence |
| Quote large | IvyPresto Display | 100 | 64 / 40 | 80 / 48 | Sentence |
| Nav | Owners | 500 | 16 | 24 | Sentence |
| Button | Owners | 500 | 18 / 16 | 24 / 20 | Sentence |
| Card title L | Owners | 500 | 24 | 38 | Sentence |
| Card title S | Owners | 500 | 20 | 32 | Sentence |
| CTA banner | Owners Wide | 700 | 32 / 32 | 48 | UPPER |
| Body | Public Sans | 300 | 16 / 16 | 28 / 24 | Sentence |
| Body large | Public Sans | 300 | 20 / 20 | 32 / 32 | Sentence |
| Body small | Public Sans | 300 | 14 / 16 | 24 / 24 | Sentence |
| Body bold | Public Sans | 600 | 16 | 28 / 24 | Sentence |

In the presentation profile every Owners row becomes Archivo at the matching
width, every IvyPresto row becomes Archivo at the same weight, and Public Sans
is unchanged. Sizes and line heights never change between profiles.

Narrow and XNarrow widths exist as tokens for headings that need to fit a tight
column. They are an exception, not a default.

Body copy is **Light 300**. This is deliberate and easy to get wrong. Do not
default to Regular 400.

---

## 5. Colour

### The rule that matters

The interface is monochrome. Shark `#191A1B`, white, and the neutral ramp carry
almost all of the UI. The five brand colours appear as backgrounds, graphic
shapes, gradients and illustration, not as buttons, links or labels.

If a build has purple buttons, it is wrong.

### Brand palette

| Name | Hex | Where it belongs |
|---|---|---|
| Lavender | `#BDB4FF` | Section backgrounds, graphic elements, gradients |
| Perfume | `#F3AAFF` | Section backgrounds, graphic elements |
| Mint Green | `#8DFFB7` | Section backgrounds, graphic elements, gradients |
| Rajah | `#FFB985` | Section backgrounds, graphic elements |
| Shark | `#191A1B` | Text, buttons, dark sections. The workhorse |

Light tints (Titan White, Selago, Hint of Green, Seashell Peach) are the pastel
section backgrounds. Medium and dark secondaries (Royal, Electric Violet,
Watercourse, Hawaiian Tan, East Bay, Disco, Green Pea, Pablo) exist for accent
and contrast where a pastel needs a readable partner.

### Themes

Figma collection **06. Theme** holds four tokens across four modes. This is the
mechanism for coloured surfaces, and it replaces picking colours by hand.

| Token | Purple | Pink | Green | Orange |
|---|---|---|---|---|
| `Theme-Light` | Titan White `#F2F0FF` | Selago `#FBE3FF` | Hint of Green `#E6FFEF` | Seashell Peach `#FFF3EB` |
| `Theme-Primary` | Lavender `#BDB4FF` | Perfume `#F3AAFF` | Mint Green `#8DFFB7` | Rajah `#FFB985` |
| `Theme-Medium` | Royal `#6257E8` | Electric Violet `#B20CCC` | Watercourse `#048255` | Hawaiian Tan `#B35610` |
| `Theme-Dark` | East Bay `#423A75` | Disco `#7E1C74` | Green Pea `#1E625A` | Pablo `#872012` |

**Build against the tokens, not the colours.** A card written as `Theme-Light`
background with `Theme-Dark` text works in all four themes without being
rewritten. Switch with `data-us-theme="purple | pink | green | orange"` on a
page or section wrapper.

**The pairing rule:** a coloured surface takes its text from `Theme-Dark` of
the same theme. Light or Primary for the fill, Dark for the content. Medium is
for accents, icons and small marks.

Every Light+Dark and Primary+Dark pairing meets WCAG AA. The Light+Dark
pairings reach AAA. Lavender on East Bay is 5.32, Titan White on East Bay 8.92,
Mint Green on Green Pea 5.80, Rajah on Pablo 5.58.

One theme per surface. A slide or section commits to one; it never mixes two.

**Worth knowing:** the `Color - light` and `Color-dark` modes in the 02 Color
Tokens collection still reference the green primitives directly rather than the
Theme tokens. So switching theme does not currently change those two modes.
Wiring 02 to 06 would make the whole system theme-aware in one step.

### Gradients

Five gradient styles exist. The four tint gradients (Titan White, Selago, Hint
of Green, Seashell Peach) fade a single colour from full opacity to 10% alpha —
they fade to transparent, not to white, so they layer over what sits behind
them. Green-Purple is a two-colour blend from Mint Green to Perfume. Use is
deliberately limited. Never behind body copy.

### Colour modes

The system ships five modes: **Light**, **Dark**, **Grey**, **Color-light**,
**Color-dark**. A section, not just a page, can carry a mode. Set
`data-us-mode` on the section wrapper and every 02 token inside resolves
correctly. Never hand-pick a dark variant of a colour.

### System colours

Error `#DF2020`, Info `#3C81E7`, Success `#41BD73`, Warning `#EB8916`. These are
for feedback states only. Do not repurpose Success green as a brand accent, the
brand green is Mint Green and they are different.

---

## 6. Layout

The system is **fluid, not breakpointed**. Figma defines two modes, Mobile at
360 and Desktop at 1440. Every dimensional token interpolates linearly between
them with `clamp()`, so a 900px viewport gets a value partway between rather
than snapping to one or the other.

| | at 360 | at 1440 |
|---|---|---|
| Page margin | 20 | 130 |
| Content width (max) | 320 | 1180 |
| Grid column width | 40 | 80 |
| Gutter | 16 | 20 |
| Max column text width | 320 | 330 |

**Do not use `--margins-maxcols` as paragraph `max-width`.** In Figma this value
is a layout helper (right-margin / column boundary for designing non-full-width
content), not the readable width for body copy. At ~330px it is too narrow for
normal paragraphs.

For body text and intros, use a prose width derived from the content area until a
dedicated token exists in Figma (e.g. `--content-prose-max-width`):

```css
.prose-width {
  max-width: min(100%, calc(var(--page-content-width) * 0.62));
}
```

That yields ~732px at the 1180px content max — readable without spanning the full
container. Adjust the ratio in Figma if designers want a different measure; then
regenerate tokens rather than hand-editing.

Below 360 and above 1440 the values clamp. 1440 is the design canvas, so the
layout stops growing there and centres.

**One discrete breakpoint exists, at 768px, and it only switches grid column
count from 12 to 6.** A grid cannot be 9.4 columns. Everything else is
continuous.

### The container

Do not build a fixed 1440 page. The standard container is:

```css
.container {
  width: 100%;
  max-width: var(--page-content-width);
  margin-inline: auto;
  padding-inline: var(--margins-page-margin);
}
```

Full-bleed backgrounds sit outside this; content sits inside it.

### Reading the token values

A consequence worth knowing before someone opens the file and panics: the
numbers no longer read as the plain Figma values. `--typography-font-size-h1-default`
is `clamp(40px, 34.667px + 1.4815vw, 56px)`, not `56px`. The endpoints are
exact, 40 at mobile and 56 at desktop, but the middle is interpolated. Change
the variable in Figma and regenerate, never hand-edit a clamp.

### Vertical rhythm

Space between page sections uses the row indent scale, fluid across the range:

- Small 24 to 32
- Medium 48 to 64
- **Large 64 to 96 (default)**
- XLarge 112 to 128

### Spacing inside a block

Three of these run backwards, larger on mobile than desktop, which is
deliberate and comes straight from Figma:

- Heading to content (large): 24 to 32
- Heading to content (medium): **24 down to 16**
- Content to button (small): **20 down to 16**
- Content to button (large): 32 to 48
- Between two adjacent buttons: 16 to 20

The pattern to internalise: outer containers get more space than inner
elements. If a nested gap is larger than its parent gap, the hierarchy reads
backwards.

### Radius

None 0, XS 2, S 4, M 8, L 24, XL 32, Round 500. Images 12. Cards 24 large.
Small cards run 24 on mobile down to 12 on desktop, the only fluid radius.

Buttons are pill-shaped (Round). Cards are 24, and that is a visible, generous
curve — not a hint of a corner. Do not invent 8, 12 or 16 for a card.

---

## 7. Components

The Figma library has 26 component pages: Accordion, Breadcrumb, Buttons,
Cards, Content, Elements, Stickers, FAQ, Feedback Messages, Filter, Footer,
Form elements, Graphic Elements, Icons, Imagery, List, Logo, Menu, Modal,
Navigation, Pagination, Progress, Slider, Search, Tabs, Tag.

**Before building anything, check whether a component already exists.** If it
does, match its structure. Building a bespoke accordion when the library has one
is the most common way a design system rots.

### Buttons

Three levels, all defined as 02 tokens:

- **Primary**: solid Shark background, white label, no stroke
- **Secondary**: transparent background, Shark stroke, Shark label
- **Tertiary**: text only, no background, no stroke

Hover darkens to Neutral 80 `#494949` (primary), or fills solid (secondary).
Disabled uses Neutral 40 background with Neutral 70 label. All three states are
tokenised, never compute a hover colour.

### Elevation

One shadow style exists: Dropshadow/Soft — blur 20, no offset, no spread, black
at 8%. There is no elevation scale. If something needs to lift off the page, it
uses that shadow or none at all.

### Icons in code

- **UI icons:** Material Symbols **Outlined**, weight **300** only. Never Material Icons (legacy).
- **Load:** Google Fonts URL from §3, or self-host via `material-symbols` npm package.
- **Never mix** Rounded or Sharp with Outlined in one product.
- **Font Awesome 6 Brands:** social/brand marks only — never UI icons.

Implement a reusable `Icon` component (or equivalent) that sets all four axes together:

| Axis | Us value |
|------|----------|
| `wght` | 300 (`--typography-icon-weight`) |
| `FILL` | 0 default, 1 for active/selected |
| `GRAD` | 0 default; -50 on dark backgrounds (`--typography-icon-grade`) |
| `opsz` | match rendered size (min 20 for optical correction) |

Use tokenized sizes only: `--typography-font-size-icons-12|16|24|32`.
Use icon colours from `--icon-icon-10` / `--icon-icon-50` on light UI, or system/semantic tokens where appropriate.

**Do not use emoji** (✅❌⚠️ etc.) for pass/fail, actions, or status in product UI when a Material Symbol exists (e.g. `check_circle`, `cancel`, `warning`, `info`, `error`).

### Feedback messages

Use system colours **for feedback only** — never as brand accents:

| Type | Primitive token | Typical icon |
|------|-----------------|--------------|
| Success | `--color-system-success` | `check_circle` |
| Error | `--color-system-error` | `error` |
| Warning | `--color-system-warning` | `warning` |
| Info | `--color-system-info` | `info` |

Until Figma exports dedicated Feedback Message semantic tokens (background, border, label per type), use this interim pattern:

- **Background:** `--color-neutrals-10` or `--page-page-background`
- **Accent:** system colour on icon + left border (4px / `--spacing-0-25-rem`)
- **Text:** `--content-body` / `--content-heading`
- **Border:** `--borders-border-01`
- **Radius:** `--radius-radius-m`
- **Role:** `role="alert"` for errors; `role="status"` for success/info/warning

Do not invent feedback background tints or hex values. When the Figma Feedback Messages component is tokenised, regenerate `us-tokens.css` and replace the interim pattern.

**Badges** for compact pass/fail may use system colour backgrounds with white label (`--color-neutrals-00`) and a matching Material Symbol at 16px.

---

## 8. Using this in Cursor

Put these files in every project that uses the design system:

```
/design-system/us-tokens.css
/design-system/us-design-system.md
/.cursor/rules/us-token-enforcement.mdc    ← required; stop-and-ask policy
/.cursor/rules/us-design-system.mdc        ← optional; full rules (this document)
```

**`us-token-enforcement.mdc`** is the short always-on rule: tokens only, documented
fonts only, stop and ask if something is undefined. Copy it from this repository
(see `PROJECT_SETUP.md`). Do not skip it.

The `.mdc` full rule file is this document with frontmatter at the top:

```
---
description: Us design system rules. Apply to all UI work.
alwaysApply: true
---
```

Import `us-tokens.css` once at the app root. Cursor then has both the values and
the rules on every request, without anyone pasting anything.

Reference implementations for `Icon`, `FeedbackMessage`, and `PassFailStatus` live
in consuming apps (e.g. wcag-contrast-matrix demo). Copy patterns, not hex values.

For Tailwind projects, map the tokens rather than duplicating them:

```js
// tailwind.config.js
theme: {
  extend: {
    colors: {
      'page-background': 'var(--page-page-background)',
      'content-heading': 'var(--content-heading)',
      'content-body': 'var(--content-body)',
      'button-bg': 'var(--button-default-state-button-bg-default)',
      'button-label': 'var(--button-default-state-button-prim_label)',
      'border-01': 'var(--borders-border-01)',
    },
    fontFamily: {
      h1: 'var(--typography-font-headings-default-h1-wide)',
      h4: 'var(--typography-font-headings-default-h4)',
      body: 'var(--typography-font-body)',
      quote: 'var(--typography-font-quote)',
    },
    borderRadius: {
      card: 'var(--radius-radius-cards-lg)',
      pill: 'var(--radius-radius-round)',
    },
  },
}
```

Mapping means one place to change when Figma changes.

---

## 9. Using this in Claude for presentations

Replace the body of the existing `aboutus-brand-guidelines` skill with this
document. That skill is currently wrong on almost every specific: it names
Bricolage Grotesque as the heading font, gives Rajah as `#F4B860` (it is
`#FFB985`), Perfume as `#D4A5FF` (it is `#F3AAFF`), and tells Claude to make
buttons Lavender. Leaving it in place means every generated deck is off-brand.

Slide-specific rules:

**Casing.** Only the main slide title is uppercase. Everything smaller is
sentence case: eyebrows, card titles, column headers, labels, body. A card
headed "Zekerheid" is sentence case, not "ZEKERHEID". Uppercasing small
headings is the most common error in generated decks.

**Weight.** Slide titles are heavy. Use Archivo Black, or Archivo at 700 to
900. A title set at 500 or 600 reads as a subheading and flattens the whole
slide. If a title does not look noticeably heavier than everything else on the
slide, it is wrong.

**The eyebrow.** Reference slides do place a short line above an uppercase
title, and it is set in sentence case, with no tracking. That much is settled.
Its typeface, size, colour and vertical spacing are NOT defined in Figma and
NOT measurable from the screenshots. Do not invent them: use an existing body
style and flag that the eyebrow still needs a real spec.

**No tracking.** Never letter-space anything, and least of all the eyebrow.
Small uppercase labels with tracking are a generic deck convention, not this
system. Figma defines every style at 0.

**Corners.** Cards and panels use the large card radius, 24px. Not 8, not 12.
Small radii make the deck look like a default template. Only images use 12.

**Colour is required.** A slide in nothing but black, white and grey is
reserved for dense data: tables, dashboards, anything where colour would
compete with the numbers. Every other slide carries at least one element of
colour, whether that is a tinted card set, a coloured panel, or one of the
brand graphic elements. An all-grey card row is not the house style.

**Coloured surfaces use a theme.** Pick one theme per slide — Purple, Pink,
Green or Orange — fill from Theme-Light or Theme-Primary, and take the text
from Theme-Dark of that same theme. Never two themes on one slide.

Other slide rules:

- Title slides: Shark background, white heading, one brand colour as accent
- Content slides: white or one pastel tint background, never two tints together
- Headings on slides: **Archivo Black**, uppercase, matching the H1 or H2 ramp
- Quotes and alt headings: **Archivo Thin 100 or Light 300**, not a serif
- Body: Public Sans Light
- Chart series order is NOT specified in Figma. The order in the old brand
  skill was never sourced. Ask a designer before charting multiple series.
- Keep the 1180 of 1440 content ratio. On a 16:9 slide that is roughly a 10%
  margin each side

Presentations always run the Archivo profile. Owners and IvyPresto are for
digital products only, because a deck opens on machines nobody controls.

Two consequences to expect in a deck. Wide headings are not reproducible,
PowerPoint cannot render variable axes, so use Archivo Black at regular width
and do not fake Wide with letter-spacing. And quotes lose the serif contrast
they have on web, so the difference between an alt heading and a default one
rests entirely on weight.

### Fonts in a .pptx do not travel with the file

A `.pptx` stores font *names*. PowerPoint resolves them against fonts installed
on whatever machine opens the deck. Archivo being a free Google Font means it
is free to install, not that it is present. On a client laptop without it, every
heading falls back to Calibri and the deck stops being branded at the exact
moment it matters.

Two things to do about it:

1. **Install Archivo, Archivo Black, Archivo Narrow and Public Sans on every
   machine that opens or edits these decks.** Free, one-time, and it makes the
   source file correct internally.
2. **Send PDF, not .pptx.** A PDF embeds its fonts, so it renders identically
   everywhere. For a pitch deck this is normal practice anyway, and it removes
   the problem completely.

Send an editable `.pptx` outside the agency only when the client genuinely needs
to edit it. In that case accept that the typography will degrade on their
machine, or build that specific deck in Arial and Calibri and treat it as an
unbranded working file.

### Fallback fonts, and why a .pptx has no chain

CSS falls through a list. **A .pptx cannot.** A text run stores exactly one
font name, and the theme stores one major (heading) and one minor (body) font.
When that font is missing, the operating system substitutes something, and you
do not get to say what.

So "fallback font" in PowerPoint is not a chain. It is a decision about which
font to write into the file:

| | Heading | Body |
|---|---|---|
| Machines with the fonts installed | Archivo / Archivo Black | Public Sans |
| Anything else | **Franklin Gothic** | **Aptos** |

That means two template variants rather than one clever file. A branded one for
decks that stay on machines you control, and a safe one for anything leaving
the agency in editable form. Presenting from your own laptop and sending a PDF
avoids the question entirely, which is why that stays the default advice.

**One caveat on Aptos.** It became the Office default in 2023 and ships with
Microsoft 365, so most corporate clients have it. Older perpetual Office
installs (2019, 2021) do not, and there it substitutes again to something
neither of you chose. Franklin Gothic does not have this problem, it has
shipped with Windows and Office for years.

If you want the body fallback to be genuinely bulletproof, use Calibri instead
of Aptos: it has been in Office since 2007 and is present everywhere Aptos is,
plus everywhere Aptos is not. It costs nothing and removes the only remaining
soft spot. Your call, and Aptos is what the tokens currently say.

A last consequence: automated visual checks render through LibreOffice, which
substitutes fonts it does not have. Text-fit checks on Archivo are approximate,
so leave roughly 10% slack in any container where overflow would be visible.
The same applies to Aptos, which has no metric-compatible substitute in most
preview environments.

---

## 10. Known gaps

Honest list of what this document does not yet cover.

1. **Section-level composition.** The Us Website 2.0 file uses generic frame
   names (`Frame 1812`, `Frame 1826`), so section patterns could not be
   extracted automatically. Naming those frames semantically (Hero, Logo wall,
   Service grid, Testimonial, CTA band) would let this document carry a page
   recipe library, which is the layer non-designers need most.
2. **Component anatomy.** Only buttons are documented in detail here. Cards,
   forms, navigation and modals have components in Figma but no written rules.
   Worth adding once the naming above is fixed.
3. **Deck fidelity.** A slide will never match a page exactly: no Wide widths,
   no serif quotes. That is accepted, not a bug. Worth putting one page and its
   slide equivalent side by side once so everyone has seen the gap.
4. **Figma icon styles are still stale.** As of the latest check the `Icons/`
   text styles in the design system file remain bound to Font Awesome 6 Free
   Solid at 12, 16, 24 and 32px. Icons are Material Symbols Outlined 300, so
   those four styles need repointing. Until then a designer and a developer
   ship different icon sets. The `Brand/` styles are correct and should stay
   on Font Awesome.
5. **Slide layouts.** The reference set gives design intent but not
   measurements. A `.potx` template needs exact geometry, which means either the
   source deck or a designer building the masters once.
6. **Readable body prose width.** `--margins-maxcols` is a layout helper in
   Figma, not paragraph max-width. Propose a dedicated token
   (`--content-prose-max-width`) so projects do not rely on the interim CSS
   pattern `min(100%, calc(var(--page-content-width) * 0.62))` long term. Until
   then, document and use `.prose-width` in consuming apps (see §6).
7. **Feedback Messages — semantic tokens missing.** Figma has a Feedback Messages
   component page, but `us-tokens.css` only exports primitive `--color-system-*`
   colours. Background, border, and label tokens per feedback type need to be
   added in Figma and regenerated before projects can drop the interim neutral-surface
   + system-accent pattern (see §7).
