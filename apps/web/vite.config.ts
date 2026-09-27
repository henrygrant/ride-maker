import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import viteBabel from "vite-plugin-babel";

const webOnlyExtensions = [".web.js", ".web.jsx", ".web.ts", ".web.tsx"];
const allExtensions = [
  ...webOnlyExtensions,
  ".mjs",
  ".js",
  ".mts",
  ".ts",
  ".jsx",
  ".tsx",
  ".json",
];

const babelInclude = [
  /[\\/]apps[\\/]web[\\/]src[\\/]/,
  /[\\/]packages[\\/]ui[\\/]src[\\/]/,
  /[\\/]node_modules[\\/]@ride-maker[\\/]ui[\\/]/,
  /[\\/]node_modules[\\/]react-strict-dom[\\/]/,
];

export default defineConfig({
  plugins: [
    viteReact(),
    viteBabel({
      include: babelInclude,
      filter: /\.[cm]?[jt]sx?$/,
    }),
  ],
  resolve: {
    tsconfigPaths: true,
    extensions: allExtensions,
  },
  optimizeDeps: {
    // MapLibre loads its worker as a sibling module. Vite 8's optimizer does not
    // currently retain that file in the prebundled dependency output.
    exclude: ["maplibre-gl"],
    rolldownOptions: {
      resolve: { extensions: allExtensions },
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8090",
    },
  },
});
