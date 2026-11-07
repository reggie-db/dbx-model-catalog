import { resolve, sep } from 'node:path';
import { createOptionKit } from 'optionkit';

const INDEX_FILE = 'index.html';

export interface StaticServerOptions {
  readonly headHtml: readonly string[];
  readonly hostname: string;
  readonly port: number;
  readonly root: string;
}

export function parseHeadHtml(value: string): readonly string[] {
  const trimmed = value.trim();
  if (trimmed.length === 0) return [];
  if (!trimmed.startsWith('[')) return [value];

  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed) || !parsed.every(entry => typeof entry === 'string')) {
    throw new TypeError('DBX_MODEL_CATALOG_HEAD_HTML must be a string or a JSON array of strings');
  }
  return parsed;
}

export function renderHeadFragment(fragment: string): string {
  const trimmed = fragment.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;

  const url = new URL(trimmed);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`Unsupported script URL protocol: ${url.protocol}`);
  }
  const source = url.toString()
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  return `<script defer src="${source}"></script>`;
}

export function injectHeadHtml(
  html: string,
  fragments: readonly string[],
): string {
  const content = fragments
    .map(renderHeadFragment)
    .filter(fragment => fragment.length > 0);
  if (content.length === 0) return html;

  const closingHead = html.lastIndexOf('</head>');
  if (closingHead < 0) {
    throw new Error(`${INDEX_FILE} does not contain a closing head element`);
  }

  return `${html.slice(0, closingHead)}${content.join('\n')}\n${html.slice(closingHead)}`;
}

export function resolveAssetPath(root: string, pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }

  const relative = decoded.replace(/^\/+/, '');
  const candidate = resolve(root, relative || INDEX_FILE);
  const normalizedRoot = resolve(root);
  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${sep}`)) {
    return undefined;
  }
  return candidate;
}

export async function startStaticServer(options: StaticServerOptions): Promise<Bun.Server<undefined>> {
  const root = resolve(options.root);
  const indexPath = resolve(root, INDEX_FILE);
  const indexFile = Bun.file(indexPath);
  if (!(await indexFile.exists())) {
    throw new Error(`Static site entrypoint not found: ${indexPath}`);
  }
  const indexHtml = injectHeadHtml(await indexFile.text(), options.headHtml);

  return Bun.serve({
    hostname: options.hostname,
    port: options.port,
    async fetch(request) {
      const method = request.method.toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        return new Response('Method Not Allowed\n', {
          status: 405,
          headers: { Allow: 'GET, HEAD' },
        });
      }

      const { pathname } = new URL(request.url);
      if (pathname === '/healthz') {
        return new Response(method === 'HEAD' ? null : 'ok\n', {
          headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'text/plain; charset=utf-8',
          },
        });
      }

      const assetPath = resolveAssetPath(root, pathname);
      if (assetPath !== undefined && assetPath !== indexPath) {
        const asset = Bun.file(assetPath);
        if (await asset.exists()) {
          return new Response(method === 'HEAD' ? null : asset, {
            headers: {
              'Cache-Control': 'public, max-age=3600',
              'Content-Type': asset.type,
            },
          });
        }
      }

      return new Response(method === 'HEAD' ? null : indexHtml, {
        headers: {
          'Cache-Control': 'no-cache',
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    },
  });
}

async function main(): Promise<void> {
  const { f, z } = await createOptionKit({
    environmentPrefix: 'DBX_MODEL_CATALOG',
    errorFormatter: false,
    fields: {
      headHtml: { env: 'DBX_MODEL_CATALOG_HEAD_HTML', short: false },
      hostname: { env: 'HOST', short: false },
      port: { env: 'PORT', short: false },
      root: { env: 'DBX_MODEL_CATALOG_ROOT', short: false },
    },
    moduleUrl: import.meta.url,
  });
  const optionsSchema = z.object({
    headHtml: z.string().default('').describe(
      'A script URL, raw head fragment, or JSON array of either form.',
    ),
    hostname: z.string().default('0.0.0.0').describe('Host interface to bind.'),
    port: z.number().int().min(1).max(65_535).default(8080).describe('Port to listen on.'),
    root: z.string().default('./public').describe('Directory containing the static site.'),
  }).readonly();

  const command = f.command({
    name: 'dbx-model-catalog-static-server',
    description: 'Serve the static model catalog explorer.',
  })
    .input(optionsSchema)
    .output(z.void())
    .handler(async options => {
      const server = await startStaticServer({
        ...options,
        headHtml: parseHeadHtml(options.headHtml),
      });
      console.log(`Model catalog listening on ${server.url}`);
    });

  await command.parseAsync(process.argv);
}

if (import.meta.main) await main();
