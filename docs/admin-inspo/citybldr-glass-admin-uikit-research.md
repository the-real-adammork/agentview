# CityBldr Admin UI Kit Inspiration Research

Date: 2026-06-02

## Source Scope

Primary reference:

- Dribbble: [CityBldr Mobile App - Real Estate Investment Platform](https://dribbble.com/shots/27262351-CityBldr-Mobile-App-Real-Estate-Investment-Platform), by Jack R. for RonDesignLab, published 2026.

Supporting same-system reference:

- Dribbble: [CityBldr Dashboard - Real Estate Investment Platform](https://dribbble.com/shots/27142214-CityBldr-Dashboard-Real-Estate-Investment-Platform), by Jack R. for RonDesignLab.

This document captures reusable visual-system and implementation ideas. Reference images were inspected from public CDN assets, but image files were not copied into the repo.

## Source Facts

The mobile shot exposes this Dribbble palette:

- `#A0A2A8` cool mid gray
- `#C4C5C9` light gray
- `#93959A` dark gray
- `#ADAFB3` neutral gray
- `#CBCDCF` pale gray
- `#B7B9BD` soft gray
- `#7D7E82` text gray
- `#09090A` near black

The dashboard shot exposes a warmer version of the system:

- `#D3C0A6` warm beige
- `#CC9C48` muted gold
- `#C3AC69` olive gold
- `#E1C874` pale yellow
- `#2D2B27` charcoal
- `#6D6955` warm gray
- `#98816D` clay gray
- `#B2AEA1` neutral taupe

Visible product UI content:

- Location: Seattle, WA.
- Filter controls: "Property Type: Apartments" and "Score: 100+".
- Dashboard metrics: neighborhood score, efficiency ratio, monthly rent, ROI potential.
- CTA/action treatment: black rounded pill in the dashboard shot.

## High-Level Read

CityBldr is a more consumer-polished sibling to Petronex. Petronex feels like an industrial operations surface; CityBldr feels like a premium investment product using real-estate imagery, soft glass, and expensive whitespace.

The strongest transferable idea is the glass overlay system:

- Translucent panels sit over architectural imagery.
- Backgrounds behind the panels are already blurred/desaturated.
- Panels have almost no visible border, but their edges appear through tint, internal glow, and shadow.
- Text is oversized, light-weight, and low-contrast in the mobile shot.
- The dashboard shot improves readability with darker text and a warm translucent panel.

For an admin UI kit, the CityBldr glass style should be used selectively. It is best for overlays, inspectors, command palettes, search/filter trays, and summary cards over graph or timeline canvases. It should not be the default treatment for every table or dense log row.

## Thematic Elements To Extract

### Premium Real Estate Minimalism

The shot uses:

- Architectural 3D forms as the main background.
- Monochrome/cool gray treatment.
- Very large negative space.
- Soft focus and depth-of-field.
- Large touch controls.
- Minimal visible chrome.

Admin translation:

- Use glass only when there is a meaningful layer behind it.
- Prefer quiet surfaces and one clear focus layer.
- Keep interactive chrome sparse and intentional.

### Soft Spatial Depth

The reference creates depth through:

- Foreground phone frame blur.
- Middle-layer glass controls.
- Background building geometry.
- Blur radius changes across layers.
- Shadows that are broad and diffused, not hard.

Admin translation:

- Main content can remain crisp.
- Secondary controls can float above with blur.
- Modal/drawer backgrounds can get a controlled backdrop blur.
- Avoid making every layer transparent; one glass layer over one stable base layer is enough.

### Large Filter Controls

The mobile controls are large horizontal glass rectangles:

- Long label and value in one line.
- Chevron on the right.
- Broad tap target.
- Soft white text in the mobile version.
- Slightly separated adjacent filters.

Admin translation:

- Use for high-level filters: source, status, timeframe, model, repo.
- Use compact versions in desktop admin: 36-44px high, not the giant mobile scale.
- Keep the value readable and the label short.

### Warm Analytics Glass

The desktop dashboard shot shows a more usable variant:

- Warm yellow translucent analytics card.
- Black text and black CTA.
- Rounded corners.
- Large metric hierarchy.
- Chart and metric content inside the same glass plane.

Admin translation:

- Use darker text on warm or white glass when readability matters.
- Use warm tint for summary/insight panels.
- Reserve rounded pill actions for true CTAs; use square or 2px-radius controls elsewhere if aligning with the Petronex refined kit.

## Typography Ideas

The visible type direction is a light, modern grotesk with generous spacing and large sizes. It reads closer to Helvetica/Neue Haas/SF Pro than to a condensed dashboard face.

Suggested stack:

```css
--font-sans: "Helvetica Neue", "SF Pro Display", Inter, system-ui, sans-serif;
--font-mono: "JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
```

Admin scale:

- Overlay hero/filter value: 18-24px, 300/400, line-height 1.15.
- Desktop filter text: 13-15px, 400/500.
- Metric number: 32-56px, 400/500, tabular numerals.
- Metric label: 13-16px, 400, muted.
- Inspector title: 18-24px, 500.
- Dense UI text: 12-14px, 400/500.

Rules:

- Use light weights only on large text.
- Do not use low-contrast white text on glass for dense admin data.
- Use tabular numerals for metrics.
- Keep letter spacing at 0.
- Avoid all-caps except tiny labels.

## Color Ideas

### Cool Mobile Palette

Use for neutral overlays and search/filter surfaces:

```css
--city-bg: #e5e7ea;
--city-panel: rgba(196, 197, 201, 0.34);
--city-panel-strong: rgba(203, 205, 207, 0.48);
--city-ink: #09090a;
--city-ink-muted: rgba(9, 9, 10, 0.58);
--city-ink-inverse: rgba(255, 255, 255, 0.86);
--city-rule: rgba(255, 255, 255, 0.42);
--city-shadow: rgba(20, 20, 24, 0.18);
```

### Warm Analytics Palette

Use for insight cards and "recommendation" overlays:

```css
--city-warm-panel: rgba(225, 200, 116, 0.34);
--city-warm-panel-strong: rgba(211, 192, 166, 0.46);
--city-warm-ink: #2d2b27;
--city-warm-muted: rgba(45, 43, 39, 0.62);
--city-gold: #cc9c48;
```

### Admin Adaptation

For AgentView, keep the Petronex refined base as the quieter square-corner admin system, then layer CityBldr glass as a component treatment:

- Default surfaces: matte gray/charcoal, opaque.
- Floating controls: glass.
- Inspector drawers: optional glass when over graph/timeline canvas.
- Summary metrics: warm glass.
- Danger/error states: opaque, not glass.

## Layout Ideas

### Mobile Reference Pattern

- Full-screen architectural or city scene.
- Top navigation over the scene.
- Location title centered.
- Search and back controls as simple icons.
- Filter controls floating across the middle.
- Background is intentionally defocused.

### Admin Translation

Use glass where the user expects temporary or secondary UI:

- Command palette.
- Filter tray.
- Search suggestions.
- Floating graph controls.
- Selected node/session overlay.
- Quick metric summary.
- Bottom sheet on small screens.

Avoid glass for:

- Long log output.
- Dense tables.
- Error messages that must be unambiguous.
- Primary navigation labels.
- Anything rendered over high-contrast uncontrolled content.

## Glass Overlay Feature

### What The Reference Is Doing

The CityBldr glass effect appears to combine four layers:

1. A desaturated, high-key background scene.
2. A background blur or depth-of-field pass.
3. A translucent rectangle with gray or warm tint.
4. A soft edge/highlight treatment plus broad shadow.

The important point: `backdrop-filter` alone is not the whole effect. The panel works because the underlying image is curated, the panel has a tint, and the text contrast is tuned for the tint.

### Base CSS Implementation

Use a reusable glass primitive:

```css
.glass {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.38);
  background:
    linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.46),
      rgba(255, 255, 255, 0.22)
    );
  box-shadow:
    0 24px 70px rgba(15, 18, 24, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.58),
    inset 0 -1px 0 rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(22px) saturate(120%);
  -webkit-backdrop-filter: blur(22px) saturate(120%);
}
```

### Square-Corner Admin Variant

The Dribbble reference uses rounded modern consumer glass. For the new admin UIKit, keep the glass but square it off:

```css
[data-ui-kit="citybldr-glass"] .glass-panel {
  border-radius: 2px;
  border: 1px solid rgba(255, 255, 255, 0.36);
  background:
    linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.48),
      rgba(190, 194, 201, 0.28)
    );
  color: #09090a;
  box-shadow:
    0 18px 44px rgba(9, 9, 10, 0.16),
    inset 0 1px 0 rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(18px) saturate(115%);
  -webkit-backdrop-filter: blur(18px) saturate(115%);
}
```

### Warm Analytics Variant

Use for summary cards and AI/insight recommendations:

```css
[data-ui-kit="citybldr-glass"] .glass-panel--warm {
  border-color: rgba(255, 244, 188, 0.42);
  background:
    linear-gradient(
      135deg,
      rgba(255, 236, 150, 0.42),
      rgba(211, 192, 166, 0.28)
    );
  color: #2d2b27;
  backdrop-filter: blur(20px) saturate(118%);
  -webkit-backdrop-filter: blur(20px) saturate(118%);
}
```

### Glass Filter Control

For source/status/model filters:

```css
.glass-filter {
  display: inline-flex;
  min-width: 180px;
  height: 40px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 14px;
  border-radius: 2px;
  border: 1px solid rgba(255, 255, 255, 0.36);
  background: rgba(196, 197, 201, 0.32);
  color: rgba(9, 9, 10, 0.82);
  box-shadow:
    0 12px 30px rgba(9, 9, 10, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.52);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.glass-filter:hover {
  background: rgba(203, 205, 207, 0.44);
}

.glass-filter:focus-visible {
  outline: 2px solid rgba(9, 9, 10, 0.72);
  outline-offset: 2px;
}
```

### Text Contrast Rule

The mobile shot uses white text on gray glass. That is visually attractive but risky for real admin text. Use this rule:

- White text is allowed only for oversized decorative or preview labels.
- Black/charcoal text is required for dense filters, metrics, menus, and tables.
- If glass sits over uncontrolled content, add a local scrim behind the panel.

Example local scrim:

```css
.glass-panel::before {
  position: absolute;
  inset: 0;
  z-index: -1;
  content: "";
  background: rgba(245, 247, 250, 0.30);
}
```

### Progressive Fallback

Not every browser or environment handles `backdrop-filter` consistently. Provide a fallback:

```css
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass-panel,
  .glass-filter {
    background: rgba(242, 243, 245, 0.92);
    box-shadow: 0 12px 28px rgba(9, 9, 10, 0.14);
  }
}
```

For Electron, `backdrop-filter` should generally work in Chromium, but it still has performance costs when the glass layer is large or animated.

### Performance Constraints

Use glass sparingly:

- Keep blurred surfaces small or medium sized.
- Avoid fullscreen glass with live charts underneath.
- Avoid animating `backdrop-filter` directly.
- Animate opacity/transform instead.
- Use `contain: paint;` on floating glass panels when possible.
- Use a static blurred background layer for large hero/backdrop effects.

For large overlays:

```css
.glass-overlay {
  contain: paint;
  will-change: transform, opacity;
}
```

Avoid keeping `will-change` on many persistent elements.

### Accessibility Constraints

Glass can fail contrast quickly. For production UI:

- Check contrast against the actual backdrop, not just the CSS token.
- Provide an opaque fallback mode.
- Increase tint opacity when content scrolls behind a sticky glass header.
- Use focus-visible rings outside the glass edge.
- Never place critical error text on transparent glass without a solid backing.

### React Component Shape

Small primitive:

```tsx
import type { ComponentPropsWithoutRef, ReactNode } from "react";

interface GlassPanelProps extends ComponentPropsWithoutRef<"section"> {
  children: ReactNode;
  variant?: "neutral" | "warm";
}

export function GlassPanel({ children, className = "", variant = "neutral", ...props }: GlassPanelProps) {
  const variantClass = variant === "warm" ? "glass-panel--warm" : "";

  return (
    <section className={`glass-panel ${variantClass} ${className}`.trim()} {...props}>
      {children}
    </section>
  );
}
```

Use it only where the parent has a meaningful backdrop. For normal layout sections, keep `Panel`.

## Fit With AgentView

CityBldr should not replace the whole app shell. It should become a glass overlay layer that can coexist with the Petronex refined admin direction.

Recommended targets:

- Timeline filter bar.
- Graph mode toolbar.
- Selected node details.
- Command palette/search.
- Live-session summary overlay.
- Mobile bottom sheet.

Recommended non-targets:

- Timeline event rows.
- Raw log renderers.
- Diagnostics error panels.
- Navigation rail.
- Dense table/list bodies.

### Integration Path

1. Add shared glass tokens to a future kit file.
2. Create a `GlassPanel` or CSS-only `.glass-panel` primitive.
3. Apply it to one contained overlay first, preferably graph controls or search filters.
4. Verify contrast with screenshots over light, dark, and busy content.
5. Add fallback styles with `@supports not`.

### Suggested Kit Relationship

Use:

```text
petronex-refined
```

for the base square-corner admin system, then:

```text
citybldr-glass
```

as an optional overlay treatment or modifier.

This avoids turning the entire app into a translucent interface while still capturing the strongest CityBldr effect.

## Implementation Checklist

- Define `--glass-bg`, `--glass-border`, `--glass-shadow`, `--glass-blur`, `--glass-ink`.
- Add `.glass-panel`, `.glass-panel--warm`, `.glass-filter`.
- Add `@supports not` fallback.
- Add a high-contrast mode or opaque fallback class.
- Test over graph canvas, timeline rows, and empty state background.
- Check focus rings and keyboard navigation.
- Avoid blur animation; animate transform/opacity only.
- Keep glass panels out of dense data rows.

## Design Recommendation

Use CityBldr glass as a premium overlay feature, not as the whole admin kit. The best synthesis is:

- Petronex refined: square, matte, operational base UI.
- CityBldr: soft glass for temporary controls, filters, inspectors, and insight cards.

This preserves the square-corner admin direction while adding one refined high-touch interaction layer.
