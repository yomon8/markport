import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from '../web/node_modules/jsdom/lib/api.js';

const destination = process.argv[2];
assert.ok(destination, 'Usage: node scripts/test-pages.mjs <Jekyll output directory>');
const base = 'https://yomon8.github.io/markport';
const image = `${base}/docs/og-image.png`;

for (const [file, lang, locale, title] of [
  ['index.html', 'en-US', 'en_US', 'Local Markdown Viewer for AI Agent Output | Markport'],
  ['README.ja.html', 'ja', 'ja_JP', 'AI 出力を確認するローカル Markdown ビューア | Markport'],
]) {
  const document = new JSDOM(readFileSync(join(destination, file), 'utf8')).window.document;
  const meta = name => document.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.content;
  const canonical = file === 'index.html' ? `${base}/` : `${base}/${file}`;
  assert.equal(document.documentElement.lang, lang);
  assert.equal(document.title, title);
  assert.equal(document.querySelector('link[rel="canonical"]')?.href, canonical);
  assert.equal(meta('og:locale'), locale);
  assert.match(meta('description'), lang === 'ja' ? /読み取り専用.*AI エージェント/ : /Local, read-only Markdown viewer/);
  assert.equal(meta('og:image'), image);
  assert.equal(meta('og:image:width'), '1200');
  assert.equal(meta('og:image:height'), '630');
  assert.ok(meta('og:image:alt'));
  assert.equal(document.querySelectorAll('meta[property="og:image:alt"]').length, 1);
  assert.equal(meta('twitter:image:alt'), meta('og:image:alt'));
  assert.equal(meta('twitter:card'), 'summary_large_image');
  assert.equal(meta('twitter:image'), image);
  assert.equal(document.querySelector('link[rel="icon"]')?.getAttribute('href'), '/markport/logo/markport-favicon.svg');
  for (const [language, url] of [['en', `${base}/`], ['ja', `${base}/README.ja.html`], ['x-default', `${base}/`]]) {
    assert.equal(document.querySelector(`link[hreflang="${language}"]`)?.href, url);
  }
  const schemas = [...document.querySelectorAll('script[type="application/ld+json"]')].map(script => JSON.parse(script.textContent));
  for (const schema of schemas) {
    if (schema.image && typeof schema.image === 'object') {
      assert.equal(schema.image.alt, undefined, 'ImageObject does not support the alt property');
    }
  }
  const graph = schemas.find(schema => schema['@graph']);
  assert.equal(graph?.['@context'], 'https://schema.org');
  const apps = graph['@graph'].filter(schema => schema['@type'] === 'SoftwareApplication');
  assert.equal(apps.length, 1);
  const app = apps[0];
  assert.equal(app['@id'], `${base}/#application`);
  assert.equal(app.name, 'Markport');
  assert.equal(app.applicationCategory, 'DeveloperApplication');
  assert.equal(app.operatingSystem, 'Linux, macOS, Windows');
  assert.equal(app.inLanguage, lang);
  assert.equal(app.image, image);
  assert.equal(app.description, meta('description'));
  assert.deepEqual(app.offers, { '@type': 'Offer', price: '0', priceCurrency: 'USD' });
  assert.equal(app.downloadUrl, 'https://github.com/yomon8/markport/releases');
  assert.equal(app.codeRepository, undefined, 'codeRepository belongs to SoftwareSourceCode');
  const source = graph['@graph'].find(schema => schema['@type'] === 'SoftwareSourceCode');
  assert.equal(source?.codeRepository, 'https://github.com/yomon8/markport');
  assert.deepEqual(source.targetProduct, { '@id': app['@id'] });
  assert.equal(document.querySelectorAll('.markdown-body h1').length, 1);
  assert.match(document.querySelector('.markdown-body h1')?.textContent, /Markport.*Markdown/);
  const otherLanguage = file === 'index.html' ? `${base}/README.ja.html` : `${base}/`;
  assert.ok([...document.querySelectorAll('.markdown-body a')].some(link => new URL(link.getAttribute('href'), canonical).href === otherLanguage));
  for (const img of document.querySelectorAll('.markdown-body img[src*="screenshots/"]')) {
    assert.ok(img.alt && img.width && img.height, 'Screenshots need alt text and dimensions');
  }
  console.log(`${file}: language, metadata, alternates, images, and JSON-LD passed`);
}

const sitemap = new JSDOM(readFileSync(join(destination, 'sitemap.xml'), 'utf8'), { contentType: 'text/xml' }).window.document;
assert.deepEqual([...sitemap.querySelectorAll('loc')].map(node => node.textContent).sort(), [`${base}/`, `${base}/README.ja.html`].sort());
assert.equal(readFileSync(join(destination, 'google94b07decab1153ec.html'), 'utf8'), readFileSync('google94b07decab1153ec.html', 'utf8'));
assert.match(readFileSync(join(destination, 'robots.txt'), 'utf8'), /Sitemap: https:\/\/yomon8\.github\.io\/markport\/sitemap\.xml/);
const png = readFileSync(join(destination, 'docs/og-image.png'));
assert.equal(png.readUInt32BE(16), 1200);
assert.equal(png.readUInt32BE(20), 630);
assert.ok(readFileSync(join(destination, 'logo/markport-favicon.svg'), 'utf8').includes('<svg'));
console.log('Sitemap, robots.txt, unchanged verification file, OGP dimensions, and favicon passed');
