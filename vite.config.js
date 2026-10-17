import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// Dev and preview serve the same /api/race contract as api/race.js on Vercel.
const serveRace = (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(readFileSync(new URL('./data/race.json', import.meta.url), 'utf8'));
};

export default defineConfig({
  plugins: [{
    name: 'local-race-api',
    configureServer(server) { server.middlewares.use('/api/race', serveRace); },
    configurePreviewServer(server) { server.middlewares.use('/api/race', serveRace); },
  }],
  build: {
    target: 'es2022',
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
});
