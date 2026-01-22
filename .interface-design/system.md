# findthisthread Design System

## Direction

**Intent:** A monitoring dashboard for a Reddit link-finding bot. Users glance at it to check status — is it working? Did it find anything? Dense, functional, utilitarian.

**Feel:** Warm but professional. Like a well-worn desk, not a sterile terminal. Functional without being cold.

**Signature:** The hunting/finding metaphor — requests come in, the bot searches, results are hits or misses. Progress bar feels like scanning. Reddit orange only appears on success actions.

---

## Palette

### Foundation (Warm Neutrals)

Light mode uses cream/sand undertones (hue 30-40), not pure gray.

```css
/* Light mode */
--background: 40 20% 98%;      /* warm off-white */
--foreground: 30 10% 12%;      /* warm near-black */
--card: 40 15% 99%;            /* barely elevated */
--muted-foreground: 30 6% 45%; /* warm gray text */
--border: 30 8% 88%;           /* warm border */

/* Dark mode */
--background: 30 8% 8%;        /* warm dark */
--foreground: 35 15% 92%;      /* warm light text */
--card: 30 6% 11%;             /* subtle elevation */
--border: 30 4% 20%;           /* low-contrast border */
```

### Accent

Reddit orange (`#FF4500`) reserved exclusively for:
- Primary CTA ("go to reddit" button)
- Progress bar fill

No other accent colors. Everything else is grayscale with warm undertones.

### Semantic

```css
--success: green-600 (light) / green-500 (dark)
--destructive: red-500
```

Used sparingly for status indicators only.

---

## Typography

- **Headlines:** `text-lg font-semibold tracking-tight`
- **Body:** `text-xs` or `text-sm`
- **Metadata:** `text-[10px] text-muted-foreground`
- **Data (subreddits, usernames, timestamps):** `font-mono-data` (tabular-nums, monospace)

All text lowercase for this product's personality.

---

## Spacing

Base unit: 4px

- Micro: 4px (gap-1)
- Component: 12px (p-3, gap-3)
- Section: 16px (py-4, mb-4)

Max content width: `max-w-2xl` (512px) — mobile-first, readable on all devices.

---

## Depth Strategy

**Borders only.** No shadows.

```css
border border-border  /* default */
hover:border-border/80  /* hover state */
```

Surfaces distinguished by subtle background shifts, not elevation shadows.

---

## Border Radius

`rounded-md` (6px) throughout. Technical but not harsh.

---

## Components

### Cards (Link Request Items)

```jsx
<article className="flex gap-3 p-3 rounded-md border border-border bg-card hover:border-border/80 transition-colors">
  {/* thumbnail: w-14 h-14 sm:w-16 sm:h-16 */}
  {/* content: flex-1 min-w-0 */}
  {/* action: flex-shrink-0 */}
</article>
```

### Buttons

Primary (Reddit CTA):
```jsx
className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[#FF4500] hover:bg-[#E03D00] text-white transition-colors"
```

Secondary:
```jsx
className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-secondary hover:bg-secondary/80 disabled:opacity-50 transition-colors"
```

Icon-only (retry):
```jsx
className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-border hover:bg-secondary transition-colors"
```

### Progress Bar

```jsx
<div className="h-1 bg-secondary rounded-full overflow-hidden">
  <div className="h-full bg-[#FF4500] rounded-full transition-all duration-300 ease-linear" style={{ width }} />
</div>
```

### Status Indicators

Found:
```jsx
<span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-600 dark:text-green-500">
  <Check className="h-3 w-3" /> found
</span>
```

Failed:
```jsx
<span className="inline-flex items-center gap-1 text-[10px] font-medium text-red-500">
  <X className="h-3 w-3" /> {result}
</span>
```

---

## Layout

### Header (Sticky)

```jsx
<header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
  <div className="px-4 py-3 max-w-2xl mx-auto">
    {/* title + action row */}
    {/* progress bar row */}
  </div>
</header>
```

### Main Content

```jsx
<main className="px-4 py-4 max-w-2xl mx-auto">
  {/* section header */}
  {/* card list with space-y-2 */}
</main>
```

---

## Mobile Considerations

- Thumbnails: 56px on mobile, 64px on sm+
- Button labels: hidden on mobile (icon-only), visible on sm+
- Max width constrained — no horizontal scroll
- Touch targets: minimum 32px

---

## Animation

- Transitions: `transition-colors` (150ms default)
- Progress bar: `duration-300 ease-linear`
- Spinner: `animate-spin`

No bouncy/spring effects. Fast and functional.
