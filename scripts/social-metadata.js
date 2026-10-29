// This runs at build time: link-preview crawlers do not need to execute the app.
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

export function publishedUrl(manifest) {
  let value = manifest.url;
  if (!value && manifest.repository) {
    const repository = new URL(manifest.repository);
    const parts = repository.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
    if (repository.hostname === 'github.com' && parts.length === 2) {
      const [owner, name] = parts;
      value = `https://${owner}.github.io/${name.toLowerCase() === `${owner}.github.io`.toLowerCase() ? '' : `${name}/`}`;
    }
  }
  if (!value) return null; // Unpublished sketches have no invented public address.
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Sketch url must be a public HTTPS URL');
  url.search = ''; url.hash = '';
  return url.href;
}

export function socialTags(manifest) {
  const author = manifest.author || 'Lars Berg';
  const title = `${manifest.title} — ${author}`;
  const description = manifest.description?.trim() || `${manifest.title}, an interactive sketch by ${author}.`;
  const url = publishedUrl(manifest);
  const image = url ? new URL(manifest.thumbnail.src, url) : null;
  const imageType = image && ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' })[image.pathname.split('.').pop().toLowerCase()];
  if (image && !imageType) throw new Error('Social preview thumbnail must be a JPEG, PNG, WebP, or GIF');
  const alt = (manifest.thumbnail.alt?.trim() || `${manifest.title} by ${author}`).slice(0, 420);
  const meta = (key, value) => `    <meta ${key.startsWith('og:') ? 'property' : 'name'}="${key}" content="${escapeHtml(value)}">`;
  return [
    '    <!-- sketch-social:start -->',
    `    <title>${escapeHtml(title)}</title>`,
    meta('description', description), meta('author', author),
    ...(url ? [`    <link rel="canonical" href="${escapeHtml(url)}">`, meta('og:url', url)] : []),
    meta('og:type', 'website'), meta('og:site_name', manifest.title),
    meta('og:title', title), meta('og:description', description),
    meta('twitter:card', image ? 'summary_large_image' : 'summary'),
    meta('twitter:title', title), meta('twitter:description', description),
    ...(image ? [
      meta('og:image', image.href), meta('og:image:type', imageType),
      meta('og:image:width', manifest.thumbnail.width), meta('og:image:height', manifest.thumbnail.height),
      meta('og:image:alt', alt), meta('twitter:image', image.href), meta('twitter:image:alt', alt),
    ] : []),
    '    <!-- sketch-social:end -->',
  ].join('\n');
}

export function withSocialMetadata(html, manifest) {
  if (!/<head\b[^>]*>[\s\S]*?<\/head>/i.test(html)) throw new Error('Missing HTML head for social metadata');
  return html.replace(/(<head\b[^>]*>)([\s\S]*?)(<\/head>)/i, (_match, start, head, end) => {
    head = head.replace(/\s*<!-- sketch-social:start -->[\s\S]*?<!-- sketch-social:end -->/g, '')
      .replace(/\s*<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
      .replace(/\s*<meta\b[^>]*>/gi, tag => /\b(?:name|property)\s*=\s*["'](?:description|author|og:[^"']*|twitter:[^"']*)["']/i.test(tag) ? '' : tag)
      .replace(/\s*<link\b[^>]*>/gi, tag => /\brel\s*=\s*["']canonical["']/i.test(tag) ? '' : tag);
    return `${start}${head.trimEnd()}\n${socialTags(manifest)}\n${end}`;
  });
}
