import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Bind IPv4 explicitly — Node otherwise picks IPv6-only (::1) here, which
    // some tools can't reach. strictPort stops Vite drifting to 5174+ when the
    // port is busy: a different port means a different localStorage origin,
    // which would look like all saved data had vanished.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  },
});
