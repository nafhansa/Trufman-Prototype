/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    // Gunakan plugin PostCSS yang benar sesuai paket terpasang
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};

export default config;