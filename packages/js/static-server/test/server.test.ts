import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  injectHeadHtml,
  parseHeadHtml,
  renderHeadFragment,
  resolveAssetPath,
  startStaticServer,
} from '../src/server.js';

describe('parseHeadHtml', () => {
  test('preserves a multiline script block as one fragment', () => {
    const script = `<script
  defer
  src="https://analytics.example.com/script.js"
  data-website-id="YOUR_WEBSITE_ID"
></script>`;
    expect(parseHeadHtml(script)).toEqual([script]);
  });

  test('accepts a JSON array for multiple entries', () => {
    expect(parseHeadHtml('["https://one.example/script.js","<meta name=\\"demo\\">"]')).toEqual([
      'https://one.example/script.js',
      '<meta name="demo">',
    ]);
  });
});

describe('renderHeadFragment', () => {
  test('wraps an HTTP URL as a deferred script', () => {
    expect(renderHeadFragment('https://analytics.example.com/script.js')).toBe(
      '<script defer src="https://analytics.example.com/script.js"></script>',
    );
  });

  test('passes raw script elements through', () => {
    const script = '<script defer src="https://example.test/script.js" data-site="demo"></script>';
    expect(renderHeadFragment(script)).toBe(script);
  });
});

describe('injectHeadHtml', () => {
  test('injects multiple fragments before the closing head tag', () => {
    expect(injectHeadHtml('<html><head><title>Demo</title></head><body></body></html>', [
      '<script defer src="https://example.test/analytics.js"></script>',
      '<meta name="deployment" content="demo">',
    ])).toBe(
      '<html><head><title>Demo</title><script defer src="https://example.test/analytics.js"></script>\n<meta name="deployment" content="demo">\n</head><body></body></html>',
    );
  });

  test('leaves the document unchanged when no fragments are configured', () => {
    const html = '<html><head></head><body></body></html>';
    expect(injectHeadHtml(html, ['', '  '])).toBe(html);
  });
});

describe('resolveAssetPath', () => {
  test('maps the root path to the site index', () => {
    expect(resolveAssetPath('/srv/site', '/')).toBe('/srv/site/index.html');
  });

  test('rejects traversal outside the static root', () => {
    expect(resolveAssetPath('/srv/site', '/../secret.txt')).toBeUndefined();
    expect(resolveAssetPath('/srv/site', '/%2e%2e/secret.txt')).toBeUndefined();
  });
});

test('serves health, assets, injected HTML, and SPA fallbacks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dbx-model-catalog-static-server-'));
  await Promise.all([
    writeFile(join(root, 'index.html'), '<html><head><title>Demo</title></head><body>catalog</body></html>'),
    writeFile(join(root, 'app.txt'), 'asset\n'),
  ]);
  const server = await startStaticServer({
    headHtml: ['<meta name="deployment" content="test">'],
    hostname: '127.0.0.1',
    port: 0,
    root,
  });

  try {
    const baseUrl = server.url.toString();
    const [health, asset, fallback] = await Promise.all([
      fetch(new URL('/healthz', baseUrl)),
      fetch(new URL('/app.txt', baseUrl)),
      fetch(new URL('/models/example', baseUrl)),
    ]);
    expect(await health.text()).toBe('ok\n');
    expect(await asset.text()).toBe('asset\n');
    expect(await fallback.text()).toContain('<meta name="deployment" content="test">');
  } finally {
    server.stop(true);
    await rm(root, { force: true, recursive: true });
  }
});
