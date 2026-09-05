/**
 * Tailwind 4 runs as a PostCSS plugin here rather than through the Vite plugin
 * the design was authored against, because this app is Next.js. Same engine,
 * same `@theme` block in globals.css — only the build host differs.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
