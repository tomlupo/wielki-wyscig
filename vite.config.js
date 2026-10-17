import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
export default defineConfig({
  plugins: [{ name: 'local-race-api', configureServer(server) {
    server.middlewares.use('/api/race', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(readFileSync(new URL('./data/race.json', import.meta.url), 'utf8'));
    });
  }}],
  build: { chunkSizeWarningLimit: 800 }
});
