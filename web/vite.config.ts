import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.MARKPORT_PORT || '3000');
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/',
  build: { outDir: fileURLToPath(new URL('../internal/web/dist', import.meta.url)), emptyOutDir: true },
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    allowedHosts: ['localhost', '127.0.0.1'],
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
    proxy: { '/api': { target: `http://127.0.0.1:${port}`, changeOrigin: true } }
  }
});
