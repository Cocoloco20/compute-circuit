import type { Config } from "tailwindcss";

/**
 * Phase 6 design-system tokens.
 *
 * Synthesized from Stitch variants A (Bloomberg HUD), B (Linear-Vercel),
 * C (Stripe Analytical). Aesthetic = "Stripe Atlas running a Bloomberg
 * terminal" — trustworthy + modern, calm + dense.
 *
 * Token rules:
 *   - bg-*       backgrounds (canvas / surface / hover / overlay)
 *   - border-*   1px hairlines (default / subtle / strong)
 *   - fg-*       foreground text (primary / secondary / muted / dim)
 *   - signal-*   semantic status (healthy / warn / alert / info)
 *   - accent-*   brand purple + cyan + the purple→cyan gradient combo
 *   - feed-*     per-feed accent (price / news / 8-K / insider / etc.)
 *
 * Resolves to Tailwind-classnames like:
 *   bg-bg-canvas, border-border-default, text-fg-primary, text-signal-healthy,
 *   text-feed-news, bg-gradient-to-r from-accent-grad-start to-accent-grad-end
 *
 * Mirror this file in src/lib/design-tokens.ts when you need the raw hex
 * values for SVG/three.js code.
 */

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",

        // ----- Surfaces -----
        "bg-canvas":   "#0A0B0F",
        "bg-surface":  "#13151C",
        "bg-hover":    "#1B1E26",
        "bg-overlay":  "#0F1117CC", // 80% opacity for floating chrome

        // ----- Borders -----
        "border-default": "#262A33",
        "border-subtle":  "#1B1E26",
        "border-strong":  "#3A3F4B",

        // ----- Foreground -----
        "fg-primary":   "#F2F3F5",
        "fg-secondary": "#A5A8B0",
        "fg-muted":     "#6B6F7A",
        "fg-dim":       "#43474F",

        // ----- Semantic signal -----
        "signal-healthy": "#34D399", // emerald-400
        "signal-warn":    "#FBBF24", // amber-400
        "signal-alert":   "#F87171", // red-400
        "signal-info":    "#22D3EE", // cyan-400

        // ----- Brand accents (use sparingly) -----
        "accent-primary":      "#A78BFA",
        "accent-secondary":    "#F472B6",
        "accent-grad-start":   "#A78BFA",
        "accent-grad-end":     "#22D3EE",

        // ----- Per-feed accents -----
        "feed-price":    "#34D399",
        "feed-news":     "#22D3EE",
        "feed-filings":  "#FB923C",
        "feed-insider":  "#F87171",
        "feed-holdings": "#34D399",
        "feed-hf":       "#FCD34D",
        "feed-github":   "#E879F9", // fuchsia-400 — open source / dev velocity
        "feed-grid":     "#FACC15",
        "feed-patents":  "#A78BFA",
        "feed-jobs":     "#F472B6",
      },
      boxShadow: {
        "card":     "0 1px 2px 0 rgba(0,0,0,.20), 0 1px 1px 0 rgba(0,0,0,.06)",
        "card-lg":  "0 4px 12px -2px rgba(0,0,0,.35), 0 2px 4px -2px rgba(0,0,0,.20)",
        "panel":    "0 8px 24px -4px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.04)",
      },
      borderRadius: {
        "card": "0.875rem",  // 14px
      },
      fontSize: {
        // Phase 6 type scale
        "stat-lg":   ["1.75rem",   { lineHeight: "2rem",     letterSpacing: "-0.01em",  fontWeight: "600" }],
        "stat":      ["1.25rem",   { lineHeight: "1.5rem",   letterSpacing: "-0.005em", fontWeight: "600" }],
        "headline":  ["2rem",      { lineHeight: "2.25rem",  letterSpacing: "-0.02em",  fontWeight: "700" }],
        "title":     ["0.9375rem", { lineHeight: "1.375rem", fontWeight: "600" }],
        "body":      ["0.8125rem", { lineHeight: "1.25rem",  fontWeight: "400" }],
        "label":     ["0.6875rem", { lineHeight: "1rem",     letterSpacing: "0.075em",  fontWeight: "600" }],
        "meta":      ["0.625rem",  { lineHeight: "0.875rem", fontWeight: "400" }],
      },
    },
  },
  plugins: [],
};
export default config;
