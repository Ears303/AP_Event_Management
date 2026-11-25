/** @type {import('next').NextConfig} */
module.exports = {
  webpack: (config) => {
    // pdfjs-dist optionally requires node "canvas"; the browser build doesn't need it.
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },
};
