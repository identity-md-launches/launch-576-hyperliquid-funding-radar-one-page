# hl-radar design

## Overview

hl-radar is a read-only funding and open-interest monitor for Hyperliquid traders. The interface uses a dense trading-terminal layout: restrained borders, compact controls, aligned numeric columns, and a single mint/teal accent. Green and red carry signed market values. The page puts market-wide summaries above filters and the market list; detailed history is disclosed in a side panel.

The implementation is React and TypeScript. [src/styles.css](src/styles.css) is the canonical design source; [src/App.tsx](src/App.tsx) contains the page and shared display patterns, and [src/DetailPanel.tsx](src/DetailPanel.tsx) contains the modal and charts. The favicon is the local [public/favicon.svg](public/favicon.svg). There are no stock images, remote fonts, or external icon dependencies.

## Colors

Colors are semantic CSS custom properties in `:root` and `:root[data-theme='light']`. Dark is the CSS fallback. The initial theme follows the operating system; the header button cycles System → Dark → Light → System, saving the preference when local storage is available. An initial script in [index.html](index.html) applies the preference before React mounts.

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--bg` | `#0d1114` | `#f4f6f5` | Page, fields, mobile cards, detail panel |
| `--surface` | `#141a1e` | `#ffffff` | Summary cards, table rows, toolbar, charts |
| `--surface-raised` | `#192126` | `#edf1f0` | Table headers, selected neutral segments, avatars |
| `--hover` | `#1c272b` | `#e6eeeb` | Row and control hover surface |
| `--text` | `#e7edee` | `#172c28` | Main copy, headings, neutral values |
| `--muted` | `#94a4ac` | `#546761` | Labels, explanatory text, chart axes |
| `--subtle` | `#86979f` | `#586963` | Secondary annotations and decorative icons |
| `--line` | `#2a353b` | `#d5dfdb` | Structural separators and chart grid lines |
| `--control-line` | `#687b84` | `#74867e` | Interactive control boundaries |
| `--accent` | `#7ce5d1` | `#117562` | Brand, active sort, primary action, price line |
| `--accent-soft` | `#203a36` | `#dceee7` | Selected All funding segment and status halo |
| `--accent-ink` | `#092d25` | `#ffffff` | Text on solid accent fills |
| `--positive` | `#75dba4` | `#116b3b` | Positive values; longs pay shorts |
| `--negative` | `#ff929f` | `#a82740` | Negative values and failure states |
| `--positive-bg` | `#192f25` | `#e8f5eb` | Top-five badge background |
| `--negative-bg` | `#36242a` | `#fbecef` | Bottom-five badges and error backgrounds |
| `--focus` | `#9aeedc` | `#09634f` | Keyboard focus perimeter |
| `--overlay` | `#050a0dcc` | `#142d2870` | Modal backdrop |

The `Funding` pattern in `App.tsx` maps absolute APR to a 5–22% mix of the corresponding status color against `--surface`; intensity saturates at 200% APR. The printed sign and explanatory legend retain meaning independently of color. Top-five and bottom-five labels are calculated across the complete active market universe, before filters.

Declared-token contrast was calculated with the WCAG sRGB formula. Across page, surface, raised, and hover backgrounds, the lowest normal text-role ratios are 5.05:1 in dark mode and 4.75:1 in light mode. Maximum-intensity funding backgrounds give 6.22:1 / 5.38:1 for positive/negative dark values and 4.69:1 / 4.78:1 in light mode. Control borders remain at least 3.46:1 dark and 3.26:1 light across those backgrounds. These are calculations from declared colors; rendered checks and their scope are recorded in [artifacts/validation.md](artifacts/validation.md).

## Typography

The sans stack is `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`; the monospace stack is `'SFMono-Regular', Consolas, 'Liberation Mono', monospace`. These are installed/system font choices, with no downloaded font files. The exact available face and weight depend on the host. `font-synthesis: none` and root font smoothing are declared.

| Role | Implementation |
| --- | --- |
| Page heading | 34px, weight 600, line-height 1.2, letter-spacing −1.2px; 32px on phones |
| Section heading | 17px, weight 600, letter-spacing −0.25px; 16px on phones |
| Detail heading | 28px, line-height 1.2, letter-spacing −1px |
| Main body | `--text-base: .875rem` (14px at the default root size), line-height 1.5 |
| Coin labels | `--text-sm: .8125rem` (13px); 14px on phones, weight 600 |
| Table numbers and controls | `--text-xs: .75rem` (12px); compact desktop table numbers become 11px below 1150px |
| Supporting labels | Usually 10–12px; compact badges and some mobile annotations use 9px |
| Summary values | 30px monospace, line-height 1.2, letter-spacing −1.2px; 27px at the compact desktop breakpoint and 25px on phones |
| Detail values | 22px monospace, line-height 1.3; 23px on phones |
| Mobile text fields and selects | 16px to avoid focus zoom caused by smaller control text |

Prices, table figures, detail statistics, and summary figures use `font-variant-numeric: tabular-nums`. Numeric columns align to the trailing edge. Chart readouts, timestamps, and counts use the monospace stack. Headings use `text-wrap: balance`; coin names and detailed values can break long strings. Funding badges stay on one line. Methodology copy has an 85ch maximum width. Text remains selectable.

## Layout

The main content is centered with a 1440px maximum width and 32px desktop inline padding. The header and footer align with the page margins. Shared spacing is declared directly in CSS: 6–12px within compact controls and labels, 14–20px in cards and toolbars, and 24–36px between major groups. No separate spacing-token API is implemented.

| Width | Declared behavior |
| --- | --- |
| Above 1150px | Four summary columns, eight-column sortable table, single-row toolbar |
| 961–1150px | 24px page margins, tighter table cells and toolbar gaps |
| 601–960px | Two summary columns; table is hidden and replaced by two columns of market cards; separate sort select and direction button; wrapping toolbar |
| 320–600px | 16px page margins; two compact summary columns; one market-card column; search occupies a full row; funding segments occupy a full row; footer stacks |

Desktop rows show all requested measures. Each mobile card repeats those measures in a two-column definition list and puts APR next to the coin. Table and cards share the same filtering, sorting, and 20-item pagination state. The hidden representation uses `display: none`.

The detail panel is at most 660px wide, positioned against the trailing viewport edge, with `100dvh` height and its own vertical scrolling. It becomes full width on narrower screens. Detail statistics use three columns on larger widths; on phones the price spans a row above the two funding statistics. Mobile panel padding respects the bottom safe area. Charts use a ResizeObserver to resize their SVG coordinate system.

These behaviors were observed in Chromium at 1440, 1024, 960, 768, 390 and 320 CSS-pixel widths, with no measured horizontal overflow. Browser screenshots, detailed reflow checks, and unperformed device checks are recorded in [artifacts/validation.md](artifacts/validation.md).

## Elevation & Depth

The dashboard is mostly flat: 1px borders separate table rows, cards, fields, and grouped controls. `--surface` and `--surface-raised` establish shallow layers without card shadows. The selected neutral segment has a 1px inset-like shadow outline. Status dots use a 3px soft halo.

The detail dialog is the only strongly elevated surface: `box-shadow: -20px 0 70px #0003` with a theme-specific backdrop. The browser's native modal top layer handles its stacking. The skip link uses z-index 10 and appears when focused.

## Shapes

Summary cards and table group corners use a 7px radius; charts and detail summary groups use 6px; mobile cards and icon/theme buttons use 5px; inputs and ordinary buttons use 4px; badges use 3px. Coin avatars and small status dots are circular. Charts clip within their bordered shell. Structural and control boundaries use their distinct border tokens.

## Components

| Component or pattern | Source and behavior |
| --- | --- |
| `Icon` | Exported from `App.tsx`; local SVG paths selected with `name`, optional `size`; `currentColor`, 1.6px stroke, decorative `aria-hidden` |
| `Coin` | Internal `App.tsx` pattern used in both table and cards; native button labeled with its coin and any funding rank, small avatar, optional `top`/`bottom` badge, opens details |
| `Funding` | Internal `App.tsx` pattern; signed percent, shared green/red classes, APR-dependent heat background |
| Summary cards | `.summary-grid` / `.summary-card`; totals and threshold counts cover all active native and builder-deployed markets independently of current filters |
| Search and volume controls | Bound visible labels; search filters by coin substring; volume defaults to $1M; Clear filters exposes every volume |
| Funding segments | Native buttons within a labeled fieldset; All funding, Positive, Negative; selected state is announced with `aria-pressed` |
| Table and card list | Sortable native table headers expose `aria-sort`; cards supply a labeled sort select and direction action; loading, empty, retained stale data, and API failure states are explicit |
| Action styles | Neutral bordered icon/secondary buttons, subdued clear action, and filled primary action for the empty-state recovery; native disabled states remain visible |
| `DetailPanel` | Exported with `market`, `onClose`, and optional `stale`; native dialog, close button, Escape handling, background inertness from `showModal()`, and trigger focus restoration |
| `HistoryChart` | Internal to `DetailPanel.tsx`; hourly APR bars or price-close line, UTC readout, pointer inspection, and a labeled native range input with arrow-key operation and `aria-valuetext` |
| History states | Independent funding/price failures preserve the available chart; Retry history reloads; empty history is described; average uses available hourly observations |
| Methodology disclosure | Native `details`/`summary`; formulas, payment direction, universe coverage, missing values, and history caveats |

The global `:focus-visible` outline is 2px with a 3px offset. Search uses a 2px outline on its surrounding field. Forced-colors mode switches outlines to `Highlight` and provides explicit funding/selected-state borders. Hover styles are restricted to hover-capable devices. The only motion is a 100ms `transform` press transition and scale to 0.96, enabled only when reduced motion is not requested; themes change without color transitions.

## Do's and Don'ts

- Reuse semantic tokens and signed formatting when adding a market measure. Preserve visible signs and text explanations alongside color.
- Keep changing figures monospace and tabular; label units in context. Preserve exchange-prefixed names such as `xyz:TSLA`.
- Keep table and card content equivalent, including sorting and filter behavior. Put new controls within the existing margin and label patterns.
- Use native buttons, inputs, details, and dialogs with visible keyboard focus. Represent unavailable data with an em dash and show recoverable errors.
- Extend this one-page structure with another section using the existing main width, section heading, surface, and spacing rules. A separately hosted route would require a deliberate static export strategy; the current app uses one page.
- Avoid new decorative imagery, extra accent families, decorative animation, remote runtime assets, or wallet/transaction controls. They do not serve this read-only monitor.

Design review used the pinned Better Interface guidance by Jakub Krehel (MIT, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`). This implementation-specific document follows the documentation method adapted from Paul Bakaus's Impeccable (Apache-2.0, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`). No guide text is included in the runtime site.
