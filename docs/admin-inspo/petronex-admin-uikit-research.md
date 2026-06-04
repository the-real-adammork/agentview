# Petronex Admin UI Kit Inspiration Research

Date: 2026-06-02

## Source Scope

Primary reference:

- Dribbble: [Petronex Dashboard - Oil & Gas Monitoring UX](https://dribbble.com/shots/26841274-Petronex-Dashboard-Oil-Gas-Monitoring-UX), by Jack R. for RonDesignLab.
- Behance case study: [Petronex Oil & Gas - SaaS Dashboard & UX UI Design](https://www.behance.net/gallery/241989129/Petronex-Oil-Gas-Dashboard-UX-UI-Design), published January 18, 2026.

Secondary context:

- Dribbble related shot: [Petronex Dashboard - Oil & Gas Monitoring UX Analytics UI Trading](https://dribbble.com/shots/27248377-Petronex-Dashboard-Oil-Gas-Monitoring-UX-Analytics-UI-Tradin), useful mainly as a contrast point because it pushes the concept toward darker glassmorphism and louder gradients.

Images were inspected from the public portfolio/case-study modules. Image assets were not copied into the repo; this document captures reusable design observations, not the source artwork.

## Source Facts

Dribbble exposes the main palette for the Petronex shot:

- `#FC2003` hot orange-red
- `#9D9C9C` mid gray
- `#737373` dark gray
- `#CECDCD` light gray
- `#DC613B` muted clay orange
- `#120E0E` near black
- `#C18971` warm tan
- `#CEAFA2` pale clay

The Behance typography and color boards add:

- Typeface: Helvetica Now Display
- Weights: regular, medium, bold
- Display levels shown: heading 1 at 88px, heading 2 at 64px, body at 16px
- Brand colors shown in the case study:
  - `#2E2E2E` "Light Black"
  - `#FAF5B2` pale alert yellow
  - `#FE5E0E` "Super Orange"

Product framing from the case study:

- Problem: spreadsheet-based portfolio data caused slow reporting, fragmented operations, and poor production/financial visibility.
- Product goal: one SaaS dashboard for wells, leases, production analytics, maps, and decision control.
- UX priority: map-first navigation, real-time metrics, production tracking, financial visibility, asset scaling.

## High-Level Read

Petronex is less a conventional SaaS dashboard and more an "industrial command surface" with a premium editorial wrapper. The strongest transferable ideas are not the blurred portfolio presentation shots, but the underlying UI language:

- Square, almost architectural geometry.
- Thin hairline borders instead of heavy cards.
- Pale industrial gray surfaces with black typography.
- Sparse, high-signal orange used for selected geographies, primary status, and critical detail panels.
- Dense operational data presented in compact modules, not decorative charts.
- Map/canvas as the main context layer, with panels attached to locations or selected assets.
- Toolbars as small square icon cells, sometimes grouped into a black active strip.
- Status chips that feel mechanical: tiny labels, tiny colored squares, and low-friction metadata.

For a new admin UI kit, the refined direction should keep the square-corner control language and industrial clarity, but reduce the loudness by making orange a rare semantic signal rather than a general theme color.

## Thematic Elements To Extract

### Industrial Calm

The reference uses oil/gas subject matter without becoming visually dirty or heavy. It does this with:

- Pale terrain/map textures.
- Technical line illustrations of rigs and wells.
- Mostly grayscale photography and renderings.
- Small colored operational markers.
- Large quiet fields of neutral background.

Admin UIKit translation:

- Use a calm, matte workbench surface instead of a dark sci-fi shell.
- Let data density and precise alignment create authority.
- Reserve dramatic visual texture for empty states, diagrams, or map/graph backgrounds.

### Map-First Operations

The most important screen pattern is a large geospatial canvas with detail panels overlaid or docked around it:

- Left utility rail.
- Top search and scale controls.
- Central map/canvas.
- Right asset detail panel.
- Floating asset cards pinned to selected locations.
- Bottom or inline tool clusters for map modes.

AgentView translation:

- Treat the timeline/agent graph as the "map" layer.
- Use side panels for session, agent, or tool-call details.
- Keep filters and mode controls compact and adjacent to the data surface.
- Avoid making every content block a card; let the page read as a single operational surface.

### Operational Metadata

The reference repeatedly uses short, structured metadata:

- Lease/asset IDs.
- Latitude/longitude.
- Ownership and production tags.
- Daily production, OPEX, uptime, wells, investments, royalties.
- Status labels with tiny color squares.

Admin UIKit translation:

- Prefer compact rows of label/value pairs.
- Use tabular numerals for metrics.
- Use tiny semantic squares or dots for state, not large badges.
- Use uppercase only for very short labels, not full paragraphs.

### Editorial Restraint

The portfolio pages use oversized type and lots of negative space. That should not be copied directly into the admin app, but the discipline is useful:

- Strong alignment.
- Hairline section labels.
- Small index text.
- Minimal copy.
- Clear distinction between primary content and supporting metadata.

Admin UIKit translation:

- Use quiet top-level hierarchy, not giant marketing headers.
- Let view titles be 24-32px, panel titles 14-18px, body/data 12-14px.
- Maintain generous page gutters only where they do not reduce operational scan speed.

## Typography Ideas

### Primary Direction

Use Helvetica Now Display as the reference mood: neutral, precise, slightly premium, and less expressive than the current condensed display styling.

Practical stack:

```css
--font-sans: "Helvetica Now Display", "Helvetica Neue", Arial, system-ui, sans-serif;
--font-mono: "JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
```

If Helvetica Now is not licensed or bundled, use:

- Inter Tight for headings plus Inter for UI.
- Geist Sans for a similar crisp SaaS feel.
- IBM Plex Sans for a more technical enterprise feel.

### Type System For Admin Surfaces

Suggested refined scale:

- App title: 20-24px, 600, line-height 1.1.
- View title: 28-32px, 600, line-height 1.1.
- Section title: 16-18px, 600, line-height 1.2.
- Panel title: 13-15px, 600, line-height 1.2.
- Body/UI text: 13-14px, 400/500, line-height 1.45.
- Dense table text: 12-13px, 400/500, line-height 1.35.
- Micro labels: 10-11px, 500, line-height 1.2.
- Numeric metrics: 24-40px, 500/600, tabular numerals.

Rules:

- Use zero letter spacing for normal text.
- Avoid condensed all-caps headers in the refined kit.
- Use tabular numerals for counters, durations, token counts, timestamps, and rates.
- Keep body copy short. The Petronex UI works because labels are terse.
- Do not use hero-scale type inside operational panels.

## Color Ideas

### What To Keep

- Warm gray industrial background.
- Charcoal text.
- Pale yellow as a selected tool or low-severity alert.
- Orange as a rare action/selection/danger-adjacent signal.
- Small blue/green/red squares for metadata states.

### What To Reduce

- Do not make every border, shadow, and text element orange.
- Do not use orange glow.
- Avoid heavy gradients, bokeh, and loud branded backgrounds.
- Avoid full-screen black/orange hazard styling for the refined kit.

### Refined Light Palette Draft

```css
:root[data-ui-kit="petronex-refined"] {
  --bg-0: #dededb;
  --bg-1: #e8e8e5;
  --bg-2: #f3f3f0;
  --bg-3: #ffffff;

  --ink: #2e2e2e;
  --ink-strong: #151515;
  --ink-dim: rgba(46, 46, 46, 0.62);
  --ink-faint: rgba(46, 46, 46, 0.38);
  --ink-ghost: rgba(46, 46, 46, 0.12);

  --rule: rgba(46, 46, 46, 0.18);
  --rule-strong: rgba(46, 46, 46, 0.32);
  --rule-soft: rgba(46, 46, 46, 0.10);

  --primary: #c9542a;
  --primary-bright: #fe5e0e;
  --selected: #faf5b2;

  --good: #4ec76a;
  --info: #3158e8;
  --warn: #d9a622;
  --danger: #b94032;
}
```

### Refined Dark Palette Draft

Use dark mode as a quieter charcoal interface, not the current neon command-line treatment:

```css
:root[data-ui-kit="petronex-refined-dark"] {
  --bg-0: #120e0e;
  --bg-1: #191615;
  --bg-2: #211e1d;
  --bg-3: #2a2624;

  --ink: #d9d7d2;
  --ink-strong: #f4f2ed;
  --ink-dim: rgba(217, 215, 210, 0.64);
  --ink-faint: rgba(217, 215, 210, 0.40);
  --ink-ghost: rgba(217, 215, 210, 0.14);

  --rule: rgba(217, 215, 210, 0.14);
  --rule-strong: rgba(217, 215, 210, 0.28);
  --rule-soft: rgba(217, 215, 210, 0.08);

  --primary: #dc613b;
  --selected: #48442b;
}
```

### Semantic Color Discipline

- Orange: selected map/graph regions, active destructive-adjacent operations, critical focus.
- Yellow: selected tool, active mode, low-severity warning, "watch" state.
- Green: healthy/live/production-ready.
- Blue: source/tool identity or informational linkage.
- Red: error/destructive state only.
- Gray: default state, separators, inactive controls, disabled controls.

## Layout Ideas

### Shell

Reference layout pattern:

- Large center canvas.
- Left utility rail.
- Right detail panel.
- Small top search/control strip.
- Floating cards anchored to data points.
- Bottom tool strip for mode switches.

UIKit shell proposal:

- 44-52px left rail for primary view icons.
- 48-56px top bar for app identity, source selector, search, live state.
- Main area as a full-height grid:
  - canvas/content column: minmax(0, 1fr)
  - optional inspector: 320-420px
- Bottom status bar: 28-36px for connection state, active source, selected session, last refresh.

### Panels

Petronex panels are sharp and thin:

- Radius: 0-2px.
- Border: 1px hairline.
- Surface: slightly lighter than page background.
- Shadow: very subtle or none.
- Header: tight label/title row.
- Body: data-dense, aligned to a grid.

Panel guidance:

```css
.panel {
  border: 1px solid var(--rule);
  border-radius: 2px;
  background: var(--bg-2);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.35) inset;
}
```

### Cards

Use cards only for repeated entities or floating details:

- Session card.
- Agent card.
- Tool-call card.
- Asset/detail popover.
- Alert row.

Avoid nested cards. A panel can contain rows, tables, charts, and controls, but not a stack of decorative cards.

### Tables And Lists

The Petronex details imply data tables without showing heavy table chrome:

- Thin row separators.
- Sparse vertical rules only where useful.
- Status column with tiny square.
- Compact action column with icon-only square buttons.
- Selected row uses pale yellow or faint orange, not a full saturated fill.

For AgentView:

- Sessions list: compact rows with title, source, last event, token count, status.
- Timeline rows: left timestamp/actor rail, main event text, right tool/result metadata.
- Diagnostics: grouped rows with status squares and precise labels.

### Data Visuals

Petronex visualizes metrics with small bars, dotted series, and sparklines:

- Micro chart first, not dashboard spectacle.
- Thin bars with one highlighted segment.
- Dotted trend lines.
- Numeric value stays primary.
- Chart ink is subdued unless selected.

For AgentView:

- Token charts should use thin muted bars with a single accent highlight.
- Agent graph nodes should have neutral fills and semantic outlines.
- Timeline scrubber should feel like a technical scale, not a decorative slider.

## Component Ideas

### Buttons

- Square or rectangular with 0-2px radius.
- Icon-only where the action is familiar.
- Text buttons for primary verbs only.
- 32-36px compact height for dense UI.
- 40-44px height where touch support matters.
- Active state: pale yellow fill or charcoal fill with light icon.
- Focus: visible 2px ring using muted orange or blue.

### Toolbars

Use grouped icon cells:

- Light toolbar for neutral modes.
- Charcoal toolbar for active contextual tool clusters.
- 1px separators between cells.
- Tooltip on hover for unfamiliar icons.

### Status Chips

Recommended chip anatomy:

- Label text, 10-12px.
- Tiny square/dot state marker.
- Very light gray fill or no fill.
- No pill radius; keep chips rectangular.

Example:

```text
Active [green square]
Codex [blue square]
Error [red square]
```

### Inspector Panels

Right-side inspector should mirror the Petronex asset panel:

- Large selected entity title.
- Secondary ID/subtitle below.
- 2-4 key metric cells.
- Action menu in a black compact button.
- Detailed metadata in rows below.
- Strong accent block only for truly selected/critical content.

### Floating Detail Cards

Use when a graph/timeline/map selection needs context:

- 240-320px width.
- 1px border.
- White or light gray surface.
- Title, ID, tiny status chip.
- 2-3 key metrics.
- Icon buttons in top-right.

## Square-Corner Refinement Rules

Keep:

- Square cards and controls.
- Tiny geometric markers.
- Hairline separators.
- Monochrome map/graph backgrounds.
- Compact metadata.

Refine:

- Radius max 2px, but not all elements need explicit radius.
- Use 1px borders more than shadows.
- Remove glow, scanlines, hazard stripes, and heavy vignette in this kit.
- Replace current condensed display typography with a neutral sans.
- Lower accent saturation in normal states.
- Keep orange for focus and critical selection only.

Avoid:

- Glassmorphism panels.
- Large orange fills for regular panels.
- Thick borders.
- Decorative gradients.
- Oversized marketing type in the app shell.
- Multiple nested cards.

## Fit With Current AgentView UI

The current base kit in `src/frontend/styles/kits/agentview.css` is intentionally loud:

- Dark background.
- Orange/red palette.
- Scanline and CRT overlays.
- Hazard strip.
- Condensed display type.
- High letter spacing.

The Petronex-inspired kit should be a separate override rather than a replacement. The existing `styles/kits/README.md` already points future kits toward `[data-ui-kit="<kit-name>"]` selectors, token overrides, and stable class names.

Suggested kit name:

```text
petronex-refined
```

Primary implementation posture:

- Import after `agentview.css`.
- Override tokens first.
- Suppress decorative overlays for this kit.
- Keep component placement stable.
- Change typography, controls, states, borders, and background treatments.

Early target overrides:

```css
[data-ui-kit="petronex-refined"] .plate,
[data-ui-kit="petronex-refined"] .grid-bg,
[data-ui-kit="petronex-refined"] .scanlines,
[data-ui-kit="petronex-refined"] .crt-vignette {
  display: none;
}

[data-ui-kit="petronex-refined"] .top-hazard {
  height: 0;
  min-height: 0;
  border: 0;
  overflow: hidden;
}

[data-ui-kit="petronex-refined"] .app-shell {
  background: var(--bg-0);
  color: var(--ink);
}
```

## Admin UIKit Direction

### Name Candidates

- Quarry
- Coreline
- Strata
- Ledger Map
- Control Plain

### Design Principles

1. Operational first: the UI should feel built for repeated monitoring and decision-making.
2. Square but not harsh: use geometric controls and hairlines, not heavy boxed chrome.
3. Accent scarcity: the accent should mean something every time it appears.
4. Data over decoration: metrics, rows, and graph states create the visual rhythm.
5. Calm density: fit more information through alignment and type scale, not visual noise.

### First Screen Composition

Recommended admin screen structure:

- Left rail: views, source state, settings.
- Header: selected workspace/repo, search, live indicator, palette/kit selector.
- Main canvas: timeline, graph, or session list depending on route.
- Inspector: selected session/agent/tool-call summary.
- Bottom bar: source, tailing status, event count, token total, last update.

### Visual Tone

Keywords:

- precise
- matte
- industrial
- gridded
- quiet
- geospatial
- controlled
- rectangular
- low-glare
- high-signal

## Open Design Questions

- Should the refined kit default to light mode, or should it preserve the app's dark-mode-first posture?
- Should orange remain the brand accent, or should source identity colors become the primary accents?
- Should AgentView's existing Japanese/EV-style motifs remain available only in the current kit?
- Should the UI kit include map-like background texture, or should that be limited to empty states and graph canvases?
- Should the inspector panel become a first-class shared component before creating the kit?

## Recommended Next Step

Create a small `petronex-refined.css` kit that changes only:

- Root tokens.
- Typography stack.
- Decorative overlay visibility.
- Header/nav/panel/control treatments.
- Row, chip, and toolbar states.

Do not restructure routes in the first pass. The reference direction is strong enough to validate through visual treatment alone before touching component layout.
