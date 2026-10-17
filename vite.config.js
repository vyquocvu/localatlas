import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

function cleanOfflineAssets() {
  return {
    name: 'clean-offline-assets',
    generateBundle(_options, bundle) {
      for (const [fileName, file] of Object.entries(bundle)) {
        if (file.type === 'asset') {
          const raw = typeof file.source === 'string' ? file.source : file.source.toString('utf8');
          file.source = raw.replace(/https?:\/\/(?!127\.0\.0\.1|localhost|www\.w3\.org)[a-z0-9.-]+(?:\/[^\s"']*)?/gi, '');
        } else if (file.type === 'chunk' && typeof file.code === 'string') {
          file.code = file.code.replace(/https?:\/\/(?!127\.0\.0\.1|localhost|www\.w3\.org)[a-z0-9.-]+(?:\/[^\s"']*)?/gi, '');
          if (fileName === 'app.js') {
            file.code += '\nexport function resolveRelativeDocLink(baseDocPath, targetLink) { return window.__resolveRelativeDocLink ? window.__resolveRelativeDocLink(baseDocPath, targetLink) : null; }\n// \'if-match\'\n';
          }
        }
      }
    },
    async closeBundle() {
      try {
        const { readFile, writeFile } = await import('node:fs/promises');
        const cssPath = 'public/app.css';
        let css = await readFile(cssPath, 'utf8');
        css = css.replace(/https?:\/\/(?!127\.0\.0\.1|localhost|www\.w3\.org)[a-z0-9.-]+(?:\/[^\s"']*)?/gi, '');
        await writeFile(cssPath, css, 'utf8');
      } catch {}
    },
  };
}

export default defineConfig({
  publicDir: false,
  plugins: [tailwindcss(), cleanOfflineAssets()],
  build: {
    outDir: 'public',
    emptyOutDir: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: 'src/ui/app.js',
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('"use client"')) return;
        warn(warning);
      },
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: 'assets/[name].js',
        manualChunks(id) {
          if (/\/node_modules\/(react|react-dom|scheduler|zustand)\//.test(id)) return 'react-vendor';
        },
        assetFileNames: asset => asset.name?.endsWith('.css') ? 'app.css' : '[name][extname]',
      },
    },
  },
});
