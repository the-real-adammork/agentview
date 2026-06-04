# StreamLogic Industrial Dashboard Inspiration Research

Date: 2026-06-02

## Source Scope

Primary reference:

- Dribbble: [StreamLogic Industrial Dashboard - Smart Pump Monitoring UI](https://dribbble.com/shots/27200805-StreamLogic-Industrial-Dashboard-Smart-Pump-Monitoring-UI), by Jack R. for RonDesignLab.

Supporting same-system reference:

- Dribbble: [StreamLogic Industrial Dashboard - Smart Pump Monitoring UI](https://dribbble.com/shots/27231820-StreamLogic-Industrial-Dashboard-Smart-Pump-Monitoring-UI), by RonDesignLab.

This document captures reusable design-system observations and implementation guidance. Reference images were inspected from public Dribbble/CDN assets, but image files were not copied into the repo.

## Source Facts

The primary dark dashboard shot exposes this palette:

- `#09090A` near black
- `#2E334B` blue-black slate
- `#5A5A5B` dark neutral gray
- `#969797` mid gray
- `#502C31` oxidized red-brown
- `#AF2519` industrial red
- `#DDDFDD` pale gray/white

The supporting light infographic shot exposes this palette:

- `#91959A` cool gray
- `#646569` dark gray
- `#838CC0` soft blue-violet
- `#896C63` muted clay
- `#4B3937` dark brown-gray
- `#353EE6` electric blue

Visible UI/product content:

- Tabs: Overview, Units, Diagnostics, Flowchart, Node System.
- Metrics: Station OEE 92.7%, efficiency +5.8%, vibration spectrum stable, deviation 0.23 in/s.
- Object/asset label: Pump 2.
- Supporting light card: PMP-03 Filtration, filtration rate 15 L/min, filter temp 90.5C, bacteria cleared 5,000,000 CFU, filtration in progress.

Dribbble case-study text frames the product as a real-time industrial SaaS for pump monitoring, analytics, alerts, and AI-driven insights. The stated business result is 32% operational-efficiency improvement and 2x faster failure response.

## High-Level Read

StreamLogic is the most directly applicable reference for an admin/monitoring UI. It is not primarily a marketing moodboard; it demonstrates a dense operational dashboard language:

- Dark control-room base.
- Modular grid with strong panel boundaries.
- Large live media/asset viewport.
- Left-side metric cards.
- Right-side icon/tool rail.
- Top horizontal mode tabs.
- Lower analytics modules partially visible.
- Scientific micro-graphs and gauges.
- Deliberate blur and perspective to suggest layered monitoring depth.

Compared with Petronex, StreamLogic is louder, darker, and more tactical. Compared with CityBldr, it is much more operational. The useful synthesis for AgentView is to extract its graph language, metric density, and monitoring hierarchy without copying the heavy cinematic tilt everywhere.

## Thematic Elements To Extract

### Control-Room Dashboard

The reference feels like a live industrial monitoring wall:

- Near-black panels.
- Low-saturation machine imagery.
- One high-saturation operational highlight.
- Compact health/status cards.
- Tool rails and mode tabs.
- Live-view targeting brackets.

AgentView translation:

- Good fit for live sessions, diagnostics, agent graph, and tool-call monitoring.
- Use the visual language for "currently running" or "watching" states.
- Avoid using full cinematic blur for every page; reserve it for live-monitoring mode or presentation surfaces.

### Machine Vision Layer

The central panel is a live industrial image with:

- Grayscale/desaturated environment.
- Orange-highlighted target asset.
- White corner brackets around the selected pump.
- Small overlay label.
- Red dot status marker in the lower area.

AgentView translation:

- Selected timeline event, agent node, or tool call can get a targeting-bracket treatment.
- Use one accent color to isolate the active object.
- Keep surrounding nodes/events neutral.
- For graph selection, use brackets or corner ticks instead of a heavy filled selection card.

### Instrument-Style Metrics

The left cards use instrument metaphors:

- Large percentage metric.
- Small delta indicator.
- Radial spoke chart.
- Dotted circular gauge.
- Single needle/line for stable vibration.

AgentView translation:

- Session health, token burn, rate-limit status, and live-tail freshness can be shown as instruments.
- Prefer one tiny graph per card.
- Keep the metric number primary; graph is supporting evidence.

### Scientific Infographic Overlay

The supporting light shot has a translucent card with:

- Large asset identifier.
- Tiny colored status dot.
- Scatter plot on faint grid.
- Highlighted vertical band.
- Three bottom metric triplets.
- Soft status pill.

AgentView translation:

- Great pattern for inspector overlays and analysis summaries.
- Use scatter/plot/band visuals for event timing, retries, errors, and token bursts.
- The bottom triplet pattern maps cleanly to "Tokens / Duration / Tool Calls" or "Input / Output / Cache".

## Typography Ideas

### Observed Direction

The typography appears to be a soft modern grotesk with:

- Rounded terminals and open counters.
- Light-to-regular weight for labels.
- Large, airy numerals.
- White text on dark panels.
- Muted gray labels.
- Minimal letter spacing.

It reads closer to SF Pro, Helvetica Neue, Inter, or Geist than to a condensed industrial typeface. This is important: the industrial feeling comes from layout, color, imagery, and graph marks, not from rugged typography.

Suggested stack:

```css
--font-sans: "Geist", "Inter", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif;
--font-mono: "JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
```

### Type Scale

Recommended admin adaptation:

- Top tab: 14-16px, 500, line-height 1.
- Panel label: 13-15px, 400/500, muted.
- Primary metric: 36-56px, 400/500, tabular numerals.
- Secondary metric: 18-24px, 400/500, tabular numerals.
- Graph axis label: 10-12px, 400, muted.
- Status word: 28-44px, 400, line-height 1.
- Inspector title: 20-28px, 500.
- Dense table/list row: 12-14px, 400/500.

Rules:

- Use tabular numerals everywhere metrics update.
- Keep labels sentence case or title case; avoid wide tracking.
- Use muted labels with strong metric numbers.
- Do not use ultra-bold headings inside cards.
- Preserve line-height tightness in metric modules, but keep table/list text readable.

## Color Ideas

### Dark Monitoring Palette

```css
--stream-bg: #09090a;
--stream-panel: #141517;
--stream-panel-raised: #1b1d22;
--stream-panel-soft: rgba(221, 223, 221, 0.05);
--stream-border: rgba(221, 223, 221, 0.08);
--stream-border-strong: rgba(221, 223, 221, 0.16);

--stream-ink: #dddffd;
--stream-ink-strong: #ffffff;
--stream-muted: rgba(221, 223, 221, 0.56);
--stream-faint: rgba(221, 223, 221, 0.28);

--stream-red: #af2519;
--stream-red-brown: #502c31;
--stream-blue: #5f9df7;
--stream-violet: #838cc0;
--stream-stable: #d8f5c4;
```

### Accent Discipline

- Red/orange: active machine, failure, heat, critical item.
- Blue: positive delta, selected telemetry point, digital/system indicator.
- Pale green: stable/healthy instrument state.
- White: primary metric/value.
- Gray: labels, inactive tabs, structural borders.

The shot succeeds because only the pump highlight is saturated. Most of the dashboard is black/gray/white. For AgentView, use the same restraint: one critical highlight per viewport.

## Spacing And Grid Layout

### Observed Grid

The dark dashboard appears to use:

- A top tab rail spanning the content.
- A left metric column of stacked cards.
- A central large live viewport.
- A right vertical icon/tool rail.
- Lower analytics cards in a continuation grid.
- Narrow gutters, likely 8-12px between modules.
- Panel padding around 20-28px for large cards.

Approximate desktop grid:

```text
| left metrics 24-28% | central live viewport 52-58% | tool rail 8-10% | right info 10-14% |
```

The image is presented in perspective, but the underlying UI is a strict rectangular grid. Do not infer that production UI should be tilted; the tilt is portfolio staging.

### AgentView Layout Translation

For a monitoring/admin surface:

- Header/tab rail: 52-64px.
- Left telemetry column: 280-360px.
- Main graph/timeline viewport: minmax(0, 1fr).
- Right inspector/tool rail: 64px rail plus optional 320-420px inspector.
- Gaps: 8-12px for dense monitoring; 16px for standard admin.
- Panel padding: 16-24px.
- Bottom status strip: 28-36px.

### Grid CSS Starting Point

```css
.monitoring-grid {
  display: grid;
  grid-template-columns: minmax(280px, 0.28fr) minmax(520px, 1fr) 56px;
  grid-template-rows: 56px minmax(0, 1fr) minmax(180px, 0.36fr);
  gap: 10px;
  min-height: 0;
}

.monitoring-tabs {
  grid-column: 1 / -1;
}

.monitoring-metrics {
  grid-row: 2 / 4;
}

.monitoring-main {
  grid-column: 2;
  grid-row: 2;
}

.monitoring-tools {
  grid-column: 3;
  grid-row: 2 / 4;
}

.monitoring-bottom {
  grid-column: 2;
  grid-row: 3;
}
```

For smaller desktop widths, collapse the tool rail into the top bar and let the metric cards become a horizontal strip.

## Graphs And Infographics

### Graph Vocabulary

Reusable primitives observed:

- Radial spoke chart with one highlighted endpoint.
- Dotted circular gauge with needle.
- Tiny delta icon plus percentage.
- Scatter plot on faint grid.
- Highlighted vertical band inside plot.
- Dotted baseline.
- Object detection brackets.
- Tiny colored status dots.
- Short metric triplets below chart.

### When To Use Each Primitive

- Radial spoke chart: distribution, agent/tool fan-out, latency by category.
- Dotted circular gauge: stability, health, live freshness, rate-limit headroom.
- Delta marker: change since previous run/session.
- Scatter plot: events over time, error bursts, model calls, retries.
- Highlighted plot band: selected time window or active phase.
- Object brackets: selected node/event/tool call.
- Status dot: source, health, live, queued, failed.
- Metric triplets: compact summary under a graph.

### Graph Styling Rules

```css
.telemetry-chart {
  color: var(--stream-muted);
}

.telemetry-chart__grid {
  stroke: rgba(221, 223, 221, 0.10);
  stroke-width: 1;
}

.telemetry-chart__axis {
  color: rgba(221, 223, 221, 0.46);
  font-size: 11px;
}

.telemetry-chart__point {
  fill: rgba(221, 223, 221, 0.82);
}

.telemetry-chart__point--active {
  fill: var(--stream-blue);
  filter: drop-shadow(0 0 8px rgba(95, 157, 247, 0.55));
}

.telemetry-chart__band {
  fill: rgba(131, 140, 192, 0.16);
  stroke: rgba(131, 140, 192, 0.22);
}
```

### Infographic Card Pattern

Use this anatomy for analysis cards:

```text
[status dot] Title / entity id
[chart area with faint grid and selected band]
[metric A] [metric B] [metric C]
[status pill or next action]
```

AgentView examples:

- `[blue dot] Session 8f42 analysis`
- Scatter plot of tool calls over time.
- Metrics: duration, tokens, errors.
- Status pill: live tailing / replay complete / requires attention.

## Blur And Depth

### Observed Blur Types

The reference uses several blur modes:

- Background defocus: surrounding panels and industrial scene fade into soft focus.
- Foreground depth blur: edges and lower panels are blurred to imply camera depth.
- Overlay blur: light infographic card sits over a blurred schematic.
- Motion/presentation blur: the entire mockup has a cinematic, angled presentation.

### Production Guidance

Use blur as a focus management tool, not as permanent decoration:

- Blur non-selected background content behind a modal/inspector.
- Slightly blur inactive live-view context while selected details stay sharp.
- Use soft backdrop blur behind floating telemetry cards.
- Do not blur dense text or logs.
- Do not apply global blur to the main app shell during normal use.

### CSS Patterns

Selected overlay on a live/canvas surface:

```css
.asset-viewport {
  position: relative;
  overflow: hidden;
  background: #111;
}

.asset-viewport__media {
  filter: saturate(0.35) contrast(1.04);
}

.asset-viewport__media--background-focus {
  filter: blur(3px) saturate(0.25) contrast(0.96);
  transform: scale(1.015);
}

.asset-target {
  position: absolute;
  border: 0;
  color: rgba(255, 255, 255, 0.9);
}
```

Floating blurred panel:

```css
.telemetry-float {
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(22, 24, 28, 0.72);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.36);
  backdrop-filter: blur(18px) saturate(110%);
  -webkit-backdrop-filter: blur(18px) saturate(110%);
}
```

Light infographic overlay:

```css
.telemetry-float--light {
  border-color: rgba(255, 255, 255, 0.46);
  background: rgba(230, 235, 238, 0.64);
  color: #09090a;
  backdrop-filter: blur(20px) saturate(105%);
  -webkit-backdrop-filter: blur(20px) saturate(105%);
}
```

### Performance Constraints

- Avoid animating `filter` and `backdrop-filter`.
- Animate `opacity` and `transform` instead.
- Keep blurred regions small.
- Use static blurred snapshots or CSS overlays for large background effects.
- Provide a no-blur fallback for low-power environments.

Fallback:

```css
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .telemetry-float,
  .telemetry-float--light {
    background: rgba(22, 24, 28, 0.94);
  }
}
```

## Component Ideas

### Tabs

The top navigation uses large dark rectangular tabs:

- Inactive tab: transparent/dark panel.
- Active tab: raised dark gray surface.
- Text: white active, muted inactive.
- Corners: slightly rounded in the reference; use 2px if aligning with square admin kit.
- Height: 48-56px.

### Metric Cards

Metric card anatomy:

- Muted label at top.
- Large metric number.
- Supporting graph on side or below.
- Small delta/status row.
- Strong internal spacing.

Suggested dimensions:

- Card min-height: 160-220px for major instruments.
- Padding: 20-24px.
- Gap: 12-16px.
- Border: 1px solid low-alpha white.
- Background: `rgba(255,255,255,0.04)` on dark.

### Tool Rail

Right tool rail:

- 48-56px wide.
- Square icon cells.
- 1px separators.
- Active icon gets slightly brighter panel.
- Use tooltip labels on hover.

### Target Brackets

Use corner-only brackets for selected entities:

```css
.target-bracket {
  position: absolute;
  width: 120px;
  height: 120px;
  pointer-events: none;
}

.target-bracket::before,
.target-bracket::after {
  position: absolute;
  width: 24px;
  height: 24px;
  content: "";
  border-color: rgba(255, 255, 255, 0.86);
}
```

In implementation, prefer SVG for exact bracket corners and responsive sizing.

## Fit With AgentView

StreamLogic is most useful for:

- Live monitoring mode.
- Diagnostics dashboard.
- Agent graph health view.
- Token and rate-limit instrumentation.
- Selected session inspector.
- Tool-call anomaly detection.

It should not be the whole everyday UI if the goal is "less loud and more refined." Use it as a focused monitoring layer on top of the calmer Petronex/CityBldr synthesis.

Recommended synthesis:

- Petronex refined: base square-corner admin system.
- CityBldr: glass overlay treatment for floating controls.
- StreamLogic: graph/telemetry grammar and live-monitoring components.

## Implementation Checklist

- Define telemetry graph tokens: grid, axis, point, active point, band, stable, danger.
- Build small SVG graph primitives before adding chart libraries for micro-instruments.
- Add metric-card layout with tabular numerals.
- Add selected-entity target bracket component.
- Add compact tool rail component.
- Add blur/backdrop utility classes with fallbacks.
- Test contrast on dark panels.
- Avoid global perspective/tilt in production UI.
- Keep one saturated accent per viewport.

## Design Recommendation

Use StreamLogic to make AgentView feel more like a serious live operations tool:

- More instrument-style metric cards.
- More compact graph marks.
- Clearer selected-object targeting.
- Better live-state hierarchy.
- Controlled blur for focus, not ambience.

The most valuable extraction is the data-visualization language, not the cinematic mockup angle.
