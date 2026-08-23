# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** CDAS Apple
**Generated:** 2026-08-23
**Category:** Productivity / LMS workbench
**Style:** iOS / macOS Human Interface Guidelines grouped UI
**Design Dials:** Variance 3/10 (Centered / Minimal) | Motion 3/10 (Subtle) | Density 7/10 (Compact)

UI UX Pro Max notes used: Bento Box Grid page color `#F5F5F7` and 12–20px radius; Spatial Computing OS notes for system blue `#007AFF` and destructive `#FF3B30`; Spatial Clear / system sans = Inter (SF Pro is not on Google Fonts).

**Rejected for this product:** Apple.com marketing Bento tiles (200px+ auto-rows), Liquid Glass / VisionOS frost, LMS aggregator teal `#0D9488` + orange `#EA580C`, Swiss 0-radius black table frames.

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#007AFF` | `--color-primary` |
| On Primary | `#FFFFFF` | `--color-on-primary` |
| Secondary | `#E5E5EA` | `--color-secondary` |
| On Secondary | `#1D1D1F` | `--color-on-secondary` |
| Accent | `#007AFF` | `--color-accent` |
| On Accent | `#FFFFFF` | `--color-on-accent` |
| Background | `#F5F5F7` | `--color-background` |
| Foreground | `#1D1D1F` | `--color-foreground` |
| Card | `#FFFFFF` | `--color-card` |
| Card Foreground | `#1D1D1F` | `--color-card-foreground` |
| Muted | `#F2F2F7` | `--color-muted` |
| Muted Foreground | `#6E6E73` | `--color-muted-foreground` |
| Border | `#D2D2D7` | `--color-border` |
| Hairline inside groups | `rgb(60 60 67 / 12%)` | (row separators only) |
| Destructive | `#FF3B30` | `--color-destructive` |
| On Destructive | `#FFFFFF` | `--color-on-destructive` |
| Ring | `#007AFF` | `--color-ring` |
| Success | `#34C759` | `--success` |
| Warning | `#FF9F0A` | `--warning` |

**Color notes:** Gray page, white grouped insets, system blue for filled buttons and chevron actions. Destructive uses Apple red. Do not use teal, mint, or orange CTAs. Primary buttons are blue, not black.

### Typography

- **Heading Font:** Inter
- **Body Font:** Inter
- **Load:** `next/font/google` variable Inter, `className` on `body`. No Google `<link>`.
- **CJK fallbacks:** `-apple-system`, `BlinkMacSystemFont`, `SF Pro Text`, PingFang SC, Microsoft YaHei
- **Weights:** 400 body, 600 UI labels, 700 large titles
- **Large title:** ~34px, tracking -0.03em
- **Section headers / captions:** 13px, `#6E6E73`, no uppercase tracking
- **Row titles:** 16–17px, 600
- **Filled buttons:** 17px, 600

### Spacing

*Compact grouped lists, not Swiss 2rem cells*

| Token | Value |
|-------|-------|
| `--space-xs` | 4px |
| `--space-sm` | 8px |
| `--space-md` | 12px |
| `--space-lg` | 16px |
| `--space-xl` | 20px |
| `--space-2xl` | 32px |
| `--space-3xl` | 48px |
| `--spacing` | 1.25rem |
| `--grid-gap` | 16px |
| `--base-unit` | 8px |
| `--content-width` | 980px |
| `--grid-columns` | 12 |
| `--toolbar-height` | 52px |

### Effects

| Token | Value |
|-------|-------|
| `--border-radius` | `12px` |
| Group radius | `14px` (`--radius-md`) |
| `--shadow-sm` | `0 1px 2px rgb(0 0 0 / 4%)` |
| `--shadow-md` | `0 4px 16px rgb(0 0 0 / 6%)` |
| `--gradient` | `none` |
| `--motion-fast` | `200ms ease` |
| Toolbar | `backdrop-filter: saturate(180%) blur(20px)` |

### Components

- **Grouped lists:** one white inset per section; hairline gray separators *inside* the group; last row has no bottom rule. Row min-height 56–72px. Do not put a frame around every row.
- **Overview / fact strips:** one grouped card with internal hairlines; cell min-height ~64px, not 100–280px.
- **Buttons:** filled system blue, 12px radius, 44px min-height. Secondary is gray fill + blue text, not outlined black.
- **Inputs:** muted fill `#F2F2F7`, 10px radius, no 1px black border. Focus: 3px `#E8F1FF` ring + 1px `#007AFF`.
- **Badges:** pill (`999px`), 12px, 600.
- **Dialogs:** 14px radius, dimmed backdrop `rgb(0 0 0 / 32%)`, centered 17px title.
- **Icons:** Phosphor outline, `weight: "regular"`, decorative `aria-hidden`.

### Anti-patterns

- Giant Bento tiles, hover scale, GSAP, Liquid Glass blur on content
- Swiss 0-radius black table posters and CSS counters `01` / `02`
- LMS teal/orange, Plus Jakarta, 2px radius
- Fake nav, extra product copy, `?visual=` switcher
