import { readFileSync } from 'node:fs';
const race = JSON.parse(readFileSync(new URL('../data/race.json', import.meta.url), 'utf8'));
export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
  return res.status(200).json(race);
}
