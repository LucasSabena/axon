import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';

// HTML in a document is text, never an application DOM or executable content.
const parser = new MarkdownIt({ html: false, linkify: true }).use(taskLists);
const imageRule = parser.renderer.rules.image;
parser.renderer.rules.image = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet('loading', 'lazy');
  tokens[index].attrSet('referrerpolicy', 'no-referrer');
  return imageRule(tokens, index, options, env, renderer);
};

function localPath(href, path) {
  if (!path || !href || href.startsWith('#') || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return null;
  // URL normalizes ../ and escapes spaces, but does not grant filesystem access.
  const url = new URL(href, 'https://axon.invalid' + path.split('/').map(encodeURIComponent).join('/'));
  return { path: decodeURIComponent(url.pathname), hash: url.hash };
}

export function renderMarkdown(article, source, options = {}) {
  article.innerHTML = parser.render(String(source).replace(/^\uFEFF/, ''));
  for (const checkbox of article.querySelectorAll('.task-list-item-checkbox')) {
    checkbox.setAttribute('aria-label', checkbox.closest('li').textContent.trim() || 'Tarea');
  }
  for (const [index, block] of [...article.querySelectorAll('pre,table')].entries()) {
    block.tabIndex = 0;
    block.setAttribute('aria-label', (block.tagName === 'PRE' ? 'Bloque de código ' : 'Tabla ') + (index + 1));
  }
  const ids = new Map();
  for (const heading of article.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    const slug = heading.textContent.toLowerCase().trim().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s+/g, '-') || 'seccion';
    const count = ids.get(slug) || 0; ids.set(slug, count + 1);
    heading.id = count ? slug + '-' + count : slug;
  }
  for (const link of article.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href');
    try {
      const local = localPath(href, options.path);
      if (local) {
        const parts = local.path.split('/'), name = parts.pop();
        link.href = window.AxonNavigation.url('files', { path: parts.join('/') || '/', item: name });
      }
    } catch { link.removeAttribute('href'); }
    if (!href.startsWith('#')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
  }
  for (const image of article.querySelectorAll('img')) {
    try {
      const local = localPath(image.getAttribute('src'), options.path);
      if (local) image.src = '/api/files/preview?path=' + encodeURIComponent(local.path);
    } catch { image.removeAttribute('src'); }
  }
  // Scope fragment navigation to this reader, without changing AXON's route.
  article.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    event.preventDefault();
    try {
      const target = article.querySelector('#' + CSS.escape(decodeURIComponent(link.getAttribute('href').slice(1))));
      target?.scrollIntoView({ block: 'start' });
    } catch { /* An invalid document anchor is not an application error. */ }
  }, { signal: options.signal });
}
