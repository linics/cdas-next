# Home Page Overrides

> **PROJECT:** CDAS Swiss
> **Generated:** 2026-08-23
> **Page Type:** Workspace chooser (not a marketing landing)

> Rules here **override** `design-system/cdas-swiss/MASTER.md`.

---

## Page-Specific Rules

### Layout Overrides

- **Max Width:** 1200px
- **Grid:** 12-column editorial grid. Intro spans 8 columns. Workspace cells span 6+6 inside a 12-wide hairline frame.
- **No product video.** Do not use the Enterprise Gateway “Hero (Video/Mission)” pattern.

### Spacing Overrides

- Section rhythm: `2rem` (`--spacing`). Column gap: `1rem`.
- Workspace cells: min-height ~280px, padding `2rem`.

### Typography Overrides

- Kicker: uppercase, 11px, tracking 0.2em, black
- H1: Inter 500, clamp 2.75rem–4.5rem, tracking -0.045em
- Cell index via CSS counters (`01` / `02`), not extra copy in the DOM

### Color Overrides

- Surfaces white, rules black
- Single accent `#2563EB` only on “进入教师端 / 进入学生端”

### Component Overrides

- Two square-bordered workspace cells sharing a 1px black frame (table, not cards)
- Brand mark: 32px black square, white “CD”, radius 0
- Toolbar: full-bleed hairline, inner 12-col alignment

---

## Recommendations

- Hover 220ms background `#F5F5F5` only
- No shadows, no radius, no gradients, no GSAP
