# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** CDAS Swiss
**Generated:** 2026-08-23
**Category:** Productivity / LMS workbench
**Style:** Minimalism & Swiss Style (parent) + Swiss Modernism 2.0 (grid/type)
**Design Dials:** Variance 3/10 (Centered / Minimal) | Motion 3/10 (Subtle) | Density 5/10 (Standard)

Style-search rules override aggregator component dumps: **radius 0**, **shadow none**, **no gradients**, **one chromatic accent**.

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#000000` | `--color-primary` |
| On Primary | `#FFFFFF` | `--color-on-primary` |
| Secondary | `#18181B` | `--color-secondary` |
| On Secondary | `#FFFFFF` | `--color-on-secondary` |
| Accent (single chromatic) | `#2563EB` | `--color-accent` |
| On Accent | `#FFFFFF` | `--color-on-accent` |
| Background | `#FFFFFF` | `--color-background` |
| Foreground | `#000000` | `--color-foreground` |
| Card | `#FFFFFF` | `--color-card` |
| Card Foreground | `#000000` | `--color-card-foreground` |
| Muted | `#F5F5F5` | `--color-muted` |
| Muted Foreground | `#3F3F46` | `--color-muted-foreground` |
| Border | `#000000` | `--color-border` |
| Destructive | `#DC2626` | `--color-destructive` |
| On Destructive | `#FFFFFF` | `--color-on-destructive` |
| Ring | `#000000` | `--color-ring` |

**Color notes:** International Typographic Style — black/white surfaces, hairline black rules, one blue for link/CTA text only. Primary buttons are black, not blue. No teal, mint, or orange.

### Typography

- **Heading Font:** Inter
- **Body Font:** Inter
- **Load:** `next/font/google` variable Inter, `className` on `body`. No Google `<link>`.
- **CJK fallbacks:** PingFang SC, Microsoft YaHei, Noto Sans SC
- **Weights:** 400 body, 500 headings and UI
- **Kickers:** 11px, uppercase, letter-spacing 0.18em
- **Home H1:** clamp 2.75rem–4.5rem, tracking -0.045em, line-height ~0.95

### Spacing

*Density 5 + Swiss `--spacing: 2rem` and `--grid-gap: 1rem`*

| Token | Value |
|-------|-------|
| `--space-xs` | 4px |
| `--space-sm` | 8px |
| `--space-md` | 16px |
| `--space-lg` | 24px |
| `--space-xl` | 32px |
| `--space-2xl` | 48px |
| `--space-3xl` | 64px |
| `--spacing` | 2rem |
| `--grid-gap` | 1rem |
| `--base-unit` | 8px |
| `--content-width` | 1200px |
| `--grid-columns` | 12 |

### Effects

| Token | Value |
|-------|-------|
| `--border-radius` | `0px` |
| `--shadow` / `--shadow-*` | `none` |
| `--gradient` | `none` |
| `--motion-fast` | `220ms ease` (200–250ms) |

No box-shadow. No border-radius. Hover is background or opacity only.

---

## Component Specs

### Buttons

```css
.primaryButton {
  background: #000000;
  color: #ffffff;
  border: 1px solid #000000;
  border-radius: 0;
  padding: 12px 24px;
  min-height: 44px;
  font-weight: 500;
  transition: background 220ms ease;
}
.secondaryButton {
  background: transparent;
  color: #000000;
  border: 1px solid #000000;
  border-radius: 0;
  padding: 12px 24px;
  min-height: 44px;
}
```

### Cards / rows

Hairline tables, not padded mint cards:

```css
.row {
  border: 0;
  border-bottom: 1px solid #000000;
  border-radius: 0;
  box-shadow: none;
  padding: 24px 0;
}
```

### Inputs

```css
input, textarea, select {
  border: 1px solid #000000;
  border-radius: 0;
  min-height: 44px;
  box-shadow: none;
}
```

### Dialogs

Square, 1px black rule, 48% black backdrop, no shadow, no blur.

---

## Style Guidelines

**Style:** Minimalism & Swiss Style

**Keywords:** Clean, spacious, high contrast, geometric, sans-serif, grid-based, essential only

**Do:** 12-column grid, Inter, mathematical spacing, uppercase tracked kickers, black hairlines, single accent for links

**Don't:** shadows, gradients, rounded corners, second chromatic (teal/orange), GSAP, product video on home

**Accessibility kept when it does not fight the look:** 2px black focus ring, `prefers-reduced-motion`, 4.5:1 text contrast, 44px targets, decorative Phosphor icons `aria-hidden`

---

## Anti-Patterns (Do NOT Use)

- LMS teal `#0D9488` / orange `#EA580C` / mint surfaces
- Aggregator 8px/12px radius or drop shadows
- Plus Jakarta Sans
- Emoji as icons
- Invisible focus
- Layout-shifting hover transforms
- GSAP / Framer / Magic UI
