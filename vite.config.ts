import fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { defineConfig, type Connect, type Plugin } from 'vite';

/** Plan names become file names, so keep them to a safe character set. */
const NAME_RE = /^[\w\- ]{1,80}$/;

/**
 * Small REST API over the project's `plans/` folder, available while `npm run dev`
 * (or `npm run preview`) is running:
 *   GET  /api/plans         -> [{ name, updated }]
 *   GET  /api/plans/:name   -> plan JSON
 *   PUT  /api/plans/:name   <- plan JSON
 */
function plansApi(): Plugin {
  let dir = '';

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };

  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });

  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/plans')) return next();
    try {
      await fs.mkdir(dir, { recursive: true });
      const rest = decodeURIComponent(url.pathname.slice('/api/plans'.length).replace(/^\//, ''));

      if (!rest) {
        if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
        const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
        const plans = await Promise.all(
          files.map(async (f) => ({ name: f.slice(0, -5), updated: (await fs.stat(path.join(dir, f))).mtimeMs })),
        );
        return send(res, 200, plans.sort((a, b) => b.updated - a.updated));
      }

      if (!NAME_RE.test(rest)) return send(res, 400, { error: 'invalid plan name' });
      const file = path.join(dir, `${rest}.json`);

      if (req.method === 'GET') {
        try {
          return send(res, 200, JSON.parse(await fs.readFile(file, 'utf8')));
        } catch {
          return send(res, 404, { error: 'not found' });
        }
      }
      if (req.method === 'PUT') {
        const plan = JSON.parse(await readBody(req));
        // write-then-rename so a crash never leaves a half-written file
        const tmp = `${file}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(plan, null, 2) + '\n');
        await fs.rename(tmp, file);
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: 'method not allowed' });
    } catch (e) {
      return send(res, 500, { error: String(e) });
    }
  };

  return {
    name: 'plans-api',
    configResolved(config) {
      dir = path.resolve(config.root, 'plans');
    },
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [plansApi()],
  server: {
    // saving a plan shouldn't trigger a page reload
    watch: { ignored: ['**/plans/**'] },
  },
  build: {
    // three.js alone is ~600 kB; one bundle is fine for a local tool
    chunkSizeWarningLimit: 1000,
  },
});
