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
      },
      animation: {
        'fade-in': 'fade-in 0.5s ease-out',
        'slide-in': 'slide-in 0.5s ease-out',
        'scale-in': 'scale-in 0.3s ease-out',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
