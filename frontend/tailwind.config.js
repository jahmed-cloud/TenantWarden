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
      colors: Object.fromEntries(roles.map((r) => [r, role(r)])),
      fontFamily: {
        sans: ['Roboto', '"Segoe UI"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"Roboto Mono"', '"Cascadia Code"', 'Consolas', 'monospace'],
      },
      boxShadow: {
        e1: '0 1px 2px rgb(16 24 40 / 0.06), 0 1px 3px 1px rgb(16 24 40 / 0.06)',
        e2: '0 1px 2px rgb(16 24 40 / 0.08), 0 2px 6px 2px rgb(16 24 40 / 0.08)',
        e3: '0 4px 8px 3px rgb(16 24 40 / 0.10), 0 1px 3px rgb(16 24 40 / 0.14)',
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
