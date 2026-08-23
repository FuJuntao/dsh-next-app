/**
 * PostCSS config: Tailwind v4 via its official plugin. Plugin names only -
 * Next resolves them at runtime, so Turbopack never bundles the native
 * bindings (oxide/lightningcss) into the build graph. Build-time only;
 * nothing reaches the bundle's runtime dependencies.
 */
module.exports = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
