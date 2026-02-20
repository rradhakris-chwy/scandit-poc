import path from 'path';
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  html: {
    title: 'Mobile Scanner',
    template: './index.html',
  },
  source: {
    entry: { index: './src/main.tsx' },
    define: {
      __SCANDIT_LICENSE_KEY__: JSON.stringify(
        process.env.SCANDIT_LICENSE_KEY || '-- ENTER YOUR SCANDIT LICENSE KEY HERE --'
      ),
    },
  },
  server: {
    port: 3002,
    strictPort: true,
  },
  output: {
    distPath: { root: 'dist' },
    copy: [
      { from: 'node_modules/@scandit/web-datacapture-core/sdc-lib', to: 'library/engine' },
      { from: 'node_modules/@scandit/web-datacapture-barcode/sdc-lib', to: 'library/engine' },
      { from: 'node_modules/@scandit/web-datacapture-label/sdc-lib', to: 'library/engine' },
    ],
  },
  performance: {
    chunkSplit: {
      override: {
        cacheGroups: {
          scandit: {
            test: /[\\/]node_modules[\\/]@scandit[\\/]/,
            name: 'scandit',
            chunks: 'async',
            enforce: true,
          },
        },
      },
    },
  },
  tools: {
    rspack: {
      resolve: {
        alias: {
          '@': path.resolve(__dirname, 'src'),
        },
      },
    },
  },
});
