import { execFileSync } from 'node:child_process';
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
 *
 * A production build also copies the plans into dist/plans/ with an index.json, so a
 * static deploy (GitHub Pages) can browse them read-only.
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

  /** Last commit time of a file (ms), falling back to its mtime outside git. */
  const updatedAt = async (file: string) => {
    try {
      const out = execFileSync('git', ['log', '-1', '--format=%ct', '--', file], { cwd: dir, encoding: 'utf8' }).trim();
      if (out) return Number(out) * 1000;
    } catch {
      /* not a git checkout */
    }
    return (await fs.stat(file)).mtimeMs;
  };

  return {
    name: 'plans-api',
    configResolved(config) {
      dir = path.resolve(config.root, 'plans');
    },
    async generateBundle() {
      const files = await fs.readdir(dir).catch(() => [] as string[]);
      const index: { name: string; updated: number }[] = [];
      for (const f of files) {
        const name = f.slice(0, -5);
        if (!f.endsWith('.json') || !NAME_RE.test(name)) continue;
        const file = path.join(dir, f);
        const source = await fs.readFile(file, 'utf8');
        try {
          JSON.parse(source);
        } catch {
          this.warn(`skipping ${f}: not valid JSON`);
          continue;
        }
        this.emitFile({ type: 'asset', fileName: `plans/${f}`, source });
        index.push({ name, updated: await updatedAt(file) });
      }
      index.sort((a, b) => b.updated - a.updated);
      this.emitFile({ type: 'asset', fileName: 'plans/index.json', source: JSON.stringify(index) });
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
  // relative asset paths, so the build works under any sub-path (e.g. /house-planner/ on GitHub Pages)
  base: './',
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
