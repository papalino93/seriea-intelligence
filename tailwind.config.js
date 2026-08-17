/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0A0F0C',
        surface: '#121915',
        'surface-hover': '#182019',
        border: '#223028',
        'text-primary': '#ECF2EE',
        'text-secondary': '#8FA096',
        'accent-pitch': '#3FA66B',
        'accent-gold': '#C9A24B',
        'accent-danger': '#C1584B',
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
    },
  },
  plugins: [],
}
