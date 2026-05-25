/**
 * Phase 6 design tokens — raw hex values mirror of tailwind.config.ts.
 *
 * Use this for SVG paths, three.js colors, canvas fills — anywhere
 * Tailwind class names don't reach. Keep in sync with the Tailwind config.
 */

export const TOKENS = {
  bg: {
    canvas:  '#0A0B0F',
    surface: '#13151C',
    hover:   '#1B1E26',
  },
  border: {
    default: '#262A33',
    subtle:  '#1B1E26',
    strong:  '#3A3F4B',
  },
  fg: {
    primary:   '#F2F3F5',
    secondary: '#A5A8B0',
    muted:     '#6B6F7A',
    dim:       '#43474F',
  },
  signal: {
    healthy: '#34D399',
    warn:    '#FBBF24',
    alert:   '#F87171',
    info:    '#22D3EE',
  },
  accent: {
    primary:     '#A78BFA',
    secondary:   '#F472B6',
    gradStart:   '#A78BFA',
    gradEnd:     '#22D3EE',
  },
  feed: {
    price:    '#34D399',
    news:     '#22D3EE',
    filings:  '#FB923C',
    insider:  '#F87171',
    holdings: '#34D399',
    hf:       '#FCD34D',
    grid:     '#FACC15',
    patents:  '#A78BFA',
    jobs:     '#F472B6',
  },
} as const

/** Hex string → 0xRRGGBB number for three.js MeshBasicMaterial colors etc. */
export const hexToNum = (hex: string): number => parseInt(hex.replace('#', ''), 16)
