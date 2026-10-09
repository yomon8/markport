# GitHub Pages SEO maintenance

The English and Japanese README files remain plain Markdown on GitHub. Page
metadata lives in `_config.yml`. `_layouts/default.html` is copied from Primer
v0.6.0 with two changes: use the page language, and omit the redundant site H1
on README pages. Compare those changes when upgrading the theme.

The Japanese URL stays `/README.ja.html`; `/ja/` migration is deferred to avoid
changing existing indexed URLs. Hreflang links apply only to the two README
pages. The Google verification file stays byte-for-byte unchanged and is
excluded from the sitemap through defaults.

The custom JSON-LD graph describes the application and its source code as
linked entities. Unlike the example in `spec.md`, `codeRepository` is placed
on `SoftwareSourceCode`, the [type that supports that property](https://schema.org/codeRepository),
and `targetProduct` points to the `SoftwareApplication` entity.
Image alt text uses a separate `og_image_alt` default and two meta tags in
`head-custom.html`: Jekyll SEO Tag 2.8.0 otherwise copies `image.alt` into
JSON-LD as an unsupported `ImageObject` property. Image URL and dimensions
still use the plugin's normal image configuration.

## Local validation

Install Ruby and the GitHub Pages gem (`github-pages` 232, Jekyll 3.10.0), plus
the locked web dependencies (`cd web && npm ci`). From the repository root:

```sh
gem install github-pages -v 232 --no-document
JEKYLL_ENV=production PAGES_REPO_NWO=yomon8/markport ruby -rgithub-pages -e \
  'Jekyll::Commands::Build.process({"source" => Dir.pwd, "destination" => "/tmp/markport-pages-seo"})'
node scripts/test-pages.mjs /tmp/markport-pages-seo
node scripts/test-pages-browser.mjs /tmp/markport-pages-seo
```

The check reads generated HTML, JSON-LD, sitemap, robots.txt, favicon, and PNG
dimensions. It checks both languages and confirms that Google verification
content is unchanged. Keep build output outside the repository.
The browser check uses Playwright Chromium (`cd web && npx playwright install
chromium`) and checks both languages at desktop and mobile widths, including
screenshot loading and aspect ratios. It saves preview images to
`/tmp/markport-pages-<language>-<width>.png`.

Pre-deployment checks on 2026-10-09:

- `make test` and `make lint` passed.
- The generated English and Japanese pages passed metadata and sitemap checks,
  plus Chromium checks at 1280px and 390px.
- Both complete generated HTML documents were submitted to Schema Markup
  Validator in code mode: zero errors and zero warnings. This is a check of
  local build output, not a check of the live deployed URLs.
- GitHub's Markdown API rendered both README files with the screenshot
  gallery and descriptive alt text. Its sanitizer added `height: auto` to
  screenshot images, preserving aspect ratios on GitHub.
- GitHub About website, description, and all ten requested topics were updated.

Source publication, live URL validation, repository Social preview upload,
search engine account operations, and post-deployment metrics remain pending.

## Deployment and account follow-up

- Publish the source changes to `main` and wait for the Pages build to succeed.
- Check both live pages, sitemap, robots.txt, OGP image, and favicon. Local
  checks do not prove that deployment or crawler processing has succeeded.
- Upload `docs/og-image.png` (1200 × 630) in repository Settings → Social preview.
  The GitHub About website, description, and topics are separate settings.
- Validate the live JSON-LD with Schema Markup Validator. Also inspect Rich
  Results Test. [Google requires a rating or review for software app rich
  results](https://developers.google.com/search/docs/appearance/structured-data/software-app).
  This markup describes the application without claiming that eligibility;
  no ratings or reviews are invented.
- Inspect shared links using X, Slack, or Facebook Sharing Debugger after
  publication; the generated metadata alone does not prove cache refresh.
- In Search Console, verify the exact property and submitted sitemap URL
  (`https://yomon8.github.io/markport/sitemap.xml`), then use URL Inspection for
  the Japanese page and request indexing. If fetching fails, record the last
  read time and detailed error before changing configuration.
- Import the Search Console property in Bing Webmaster Tools if not registered.
- Compare impressions, queries, and CTR in Search Console after 2–4 weeks.

Articles, community posts, awesome-list submissions, package registrations,
and dedicated use-case landing pages are deferred until there is evidence of
demand, as described in the P2 proposals in `spec.md`. Screenshots already have
dimensions and descriptive alt text; images in the additional screenshot
gallery use lazy loading. A PageSpeed Insights mobile check can follow after
deployment.
