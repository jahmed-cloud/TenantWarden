/** @type {import('tailwindcss').Config} */

// Material 3-style colour roles. Values live as RGB triplets in src/index.css (light on :root,
// dark on .dark), so one class such as `bg-surface-container` works in both themes.
const role = (name) => `rgb(var(--${name}) / <alpha-value>)`
const roles = [
  'primary', 'on-primary', 'primary-container', 'on-primary-container',
  'secondary-container', 'on-secondary-container',
  'surface', 'surface-dim', 'surface-container-lowest', 'surface-container-low', 'surface-container',
  'surface-container-high', 'surface-container-highest', 'on-surface', 'on-surface-variant',
  'outline', 'outline-variant', 'inverse-surface', 'inverse-on-surface',
  'error', 'on-error', 'error-container', 'on-error-container',
  'success', 'success-container', 'on-success-container',
  'warning', 'warning-container', 'on-warning-container',
  'info-container', 'on-info-container',
]

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ...Object.fromEntries(roles.map((r) => [r, role(r)])),
        // Fixed brand colours from tenantwarden.org, for surfaces that look the same in both themes
        brand: { navy: '#0b1220', panel: '#111c2d', panel2: '#152338', line: '#26374c', mint: '#7ce6c5', mint2: '#48cba9', ink: '#edf6f5', muted: '#92a2b5' },
      },
      // Same typefaces as the website, bundled through @fontsource (no calls to Google at runtime)
      fontFamily: {
        sans: ['"DM Sans Variable"', '"Segoe UI"', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Space Grotesk Variable"', '"DM Sans Variable"', 'system-ui', 'sans-serif'],
        mono: ['"DM Mono"', '"Cascadia Code"', 'Consolas', 'monospace'],
      },
      // Theme-aware: soft shadows in light mode, the website's hairline borders in dark mode (index.css)
      boxShadow: {
        e1: 'var(--shadow-e1)',
        e2: 'var(--shadow-e2)',
        e3: 'var(--shadow-e3)',
      },
      keyframes: {
        'fade-up':   { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        'fade-in':   { from: { opacity: '0' }, to: { opacity: '1' } },
        'scale-in':  { from: { opacity: '0', transform: 'scale(.96)' }, to: { opacity: '1', transform: 'none' } },
        'slide-in':  { from: { transform: 'translateX(32px)', opacity: '0' }, to: { transform: 'none', opacity: '1' } },
        float:       { '50%': { transform: 'translateY(-10px)' } },
      },
      animation: {
        'fade-up':  'fade-up .35s cubic-bezier(.2, 0, 0, 1) both',
        'fade-in':  'fade-in .2s ease-out both',
        'scale-in': 'scale-in .22s cubic-bezier(.2, 0, 0, 1) both',
        'slide-in': 'slide-in .3s cubic-bezier(.2, 0, 0, 1) both',
        float:      'float 6s ease-in-out infinite',
      },
      borderRadius: {
        xl: '12px',
        '2xl': '16px',
        '3xl': '28px',
      },
    },
  },
  plugins: [],
}
