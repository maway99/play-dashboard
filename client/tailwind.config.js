/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0a0a0a',
        panel: '#111111',
        btn: '#1a1a1a',
        border: '#333333',
        muted: '#888888',
        amber: '#e05a00',
        ok: '#22c55e',
        bad: '#ef4444',
        info: '#3b82f6'
      },
      fontFamily: {
        sora: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif']
      },
      borderRadius: {
        ui: '6px'
      }
    }
  },
  plugins: []
};
