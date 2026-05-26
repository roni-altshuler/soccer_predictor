/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: {
        '2xl': '1280px',
      },
    },
    extend: {
      colors: {
        // Legacy brand palette (kept for backward compatibility)
        brand: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
        },
        slate: {
          850: '#1a2332',
          950: '#0f172a',
        },
        // shadcn/ui token bridge — read CSS variables so dark mode flips automatically
        border: 'var(--border-color)',
        input: 'var(--input-bg)',
        ring: 'var(--accent-primary)',
        background: 'var(--background)',
        foreground: 'var(--text-primary)',
        primary: {
          DEFAULT: 'var(--accent-primary)',
          foreground: '#04120a',
        },
        secondary: {
          DEFAULT: 'var(--card-bg)',
          foreground: 'var(--text-primary)',
        },
        destructive: {
          DEFAULT: 'var(--accent-loss)',
          foreground: '#fff',
        },
        muted: {
          DEFAULT: 'var(--muted-bg)',
          foreground: 'var(--text-tertiary)',
        },
        accent: {
          DEFAULT: 'var(--accent-ai)',
          foreground: '#041320',
        },
        popover: {
          DEFAULT: 'var(--card-bg)',
          foreground: 'var(--text-primary)',
        },
        card: {
          DEFAULT: 'var(--card-bg)',
          foreground: 'var(--text-primary)',
        },
      },
      backgroundColor: {
        primary: 'var(--background)',
        secondary: 'var(--background-secondary)',
        card: 'var(--card-bg)',
      },
      textColor: {
        primary: 'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        tertiary: 'var(--text-tertiary)',
      },
      borderColor: {
        primary: 'var(--border-color)',
        hover: 'var(--border-color-hover)',
      },
      borderRadius: {
        lg: '0.75rem',
        md: '0.5rem',
        sm: '0.375rem',
      },
      boxShadow: {
        card: '0 1px 3px var(--shadow-sm)',
        'card-lg': '0 4px 12px var(--shadow-md)',
        glow: '0 0 20px color-mix(in srgb, var(--accent-primary) 35%, transparent)',
        'glow-ai': '0 0 24px color-mix(in srgb, var(--accent-ai) 35%, transparent)',
        'glow-lg': '0 0 40px color-mix(in srgb, var(--accent-primary) 45%, transparent)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-sans)', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        // Tabular monospaced digits — scoreboards, minute counters. Wired
        // via next/font (JetBrains Mono) in src/app/layout.tsx.
        numeric: ['var(--font-mono-numeric)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Typography scale — every entry is [size, { lineHeight, letterSpacing, fontWeight? }]
        display: ['clamp(2.5rem, 5vw, 4rem)', { lineHeight: '1.05', letterSpacing: '-0.04em', fontWeight: '800' }],
        h1: ['clamp(2rem, 3.5vw, 2.75rem)', { lineHeight: '1.1', letterSpacing: '-0.03em', fontWeight: '700' }],
        h2: ['clamp(1.5rem, 2.5vw, 2rem)', { lineHeight: '1.2', letterSpacing: '-0.025em', fontWeight: '700' }],
        h3: ['1.25rem', { lineHeight: '1.3', letterSpacing: '-0.02em', fontWeight: '600' }],
        h4: ['1.125rem', { lineHeight: '1.4', letterSpacing: '-0.015em', fontWeight: '600' }],
        body: ['0.9375rem', { lineHeight: '1.55', letterSpacing: '-0.005em' }],
        small: ['0.8125rem', { lineHeight: '1.5', letterSpacing: '0' }],
        // `meta` — 13px non-uppercase. Use for chips, dates, venues, sources.
        // Replaces the dense 10–11px uppercase tracking labels used today.
        meta: ['0.8125rem', { lineHeight: '1.45', letterSpacing: '0', fontWeight: '500' }],
        // `caption` — 11px uppercase tracking. Reserved for chip/badge labels only.
        caption: ['0.6875rem', { lineHeight: '1.4', letterSpacing: '0.06em' }],
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          '0%': { opacity: '0', transform: 'translateX(-20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'live-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 color-mix(in srgb, var(--accent-loss) 60%, transparent)' },
          '50%': { boxShadow: '0 0 0 6px color-mix(in srgb, var(--accent-loss) 0%, transparent)' },
        },
        // magic-ui keyframes
        'shimmer-slide': {
          to: { transform: 'translate(calc(100cqw - 100%), 0)' },
        },
        'spin-around': {
          '0%': { transform: 'translateZ(0) rotate(0)' },
          '15%, 35%': { transform: 'translateZ(0) rotate(90deg)' },
          '65%, 85%': { transform: 'translateZ(0) rotate(270deg)' },
          '100%': { transform: 'translateZ(0) rotate(360deg)' },
        },
        marquee: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(calc(-100% - var(--gap)))' },
        },
        'marquee-vertical': {
          from: { transform: 'translateY(0)' },
          to: { transform: 'translateY(calc(-100% - var(--gap)))' },
        },
        gradient: {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        'neon-pulse': {
          '0%, 100%': { backgroundPosition: '0% 0%' },
          '50%': { backgroundPosition: '100% 100%' },
        },
        'pulse-ring': {
          '0%': { transform: 'translate(-50%, -50%) scale(1)', opacity: '0.5' },
          '80%, 100%': { transform: 'translate(-50%, -50%) scale(2.0)', opacity: '0' },
        },
        orbit: {
          '0%': { transform: 'rotate(0deg) translateY(calc(var(--radius) * 1px)) rotate(0deg)' },
          '100%': { transform: 'rotate(360deg) translateY(calc(var(--radius) * 1px)) rotate(-360deg)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.5s ease-out',
        'slide-in': 'slide-in 0.5s ease-out',
        'scale-in': 'scale-in 0.3s ease-out',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        shimmer: 'shimmer 1.6s linear infinite',
        'live-pulse': 'live-pulse 1.6s ease-out infinite',
        // magic-ui animations
        'shimmer-slide': 'shimmer-slide var(--speed) ease-in-out infinite alternate',
        'spin-around': 'spin-around calc(var(--speed) * 2) infinite linear',
        marquee: 'marquee var(--duration) linear infinite',
        'marquee-vertical': 'marquee-vertical var(--duration) linear infinite',
        gradient: 'gradient 8s linear infinite',
        'pulse-ring': 'pulse-ring var(--duration, 1.5s) ease-out infinite',
        orbit: 'orbit calc(var(--duration) * 1s) linear infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
