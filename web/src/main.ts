import './style.css';
import { drawMermaid } from './mermaid';

type Node = { name: string; path: string; type: 'directory' | 'file'; children?: Node[] };
type FileReply = { path: string; type: string; html: string };
type ApiError = { error?: string; message?: string };

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('app missing');
app.innerHTML = `<header><h1>markport</h1><span id="connection" role="status">接続中…</span><button id="reload" type="button">再読み込み</button></header><div class="layout"><aside><label for="search">ファイル名で検索</label><input id="search" type="search" placeholder="ファイル名"><nav id="tree" aria-label="ファイル一覧"></nav></aside><main><div id="file-title"></div><article id="content"><p class="hint">ファイルを選択してください。</p></article></main></div>`;
const tree = document.querySelector<HTMLElement>('#tree')!;
const content = document.querySelector<HTMLElement>('#content')!;
const title = document.querySelector<HTMLElement>('#file-title')!;
const search = document.querySelector<HTMLInputElement>('#search')!;
const connection = document.querySelector<HTMLElement>('#connection')!;
const reload = document.querySelector<HTMLButtonElement>('#reload')!;

let nodes: Node[] = [];
let revision = 0;
let pending = false;
let running = false;
let renderedRevision = 0;

function selected(): string { return new URL(location.href).searchParams.get('path') ?? ''; }
function fileURL(path: string): string { return `/?path=${encodeURIComponent(path)}`; }
function setStatus(message: string, bad = false): void { connection.textContent = message; connection.classList.toggle('bad', bad); }

function visible(node: Node, filter: string): boolean {
  if (!filter) return true;
  if (node.type === 'file') return node.name.toLocaleLowerCase().includes(filter);
  return !!node.children?.some((child) => visible(child, filter));
}
function appendNodes(parent: HTMLElement, items: Node[], filter: string): void {
  const list = document.createElement('ul');
  for (const node of items) {
    if (!visible(node, filter)) continue;
    const item = document.createElement('li');
    if (node.type === 'directory') {
      const details = document.createElement('details'); details.open = true;
      const summary = document.createElement('summary'); summary.textContent = node.name;
      details.append(summary); appendNodes(details, node.children ?? [], filter); item.append(details);
    } else {
      const link = document.createElement('a'); link.href = fileURL(node.path); link.textContent = node.name;
      if (selected() === node.path) link.setAttribute('aria-current', 'page');
      item.append(link);
    }
    list.append(item);
  }
  parent.append(list);
}
function renderTree(): void { tree.replaceChildren(); appendNodes(tree, nodes, search.value.trim().toLocaleLowerCase()); }

async function getJSON<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.json() as T & ApiError;
  if (!response.ok) throw new Error(body.message || body.error || `HTTP ${response.status}`);
  return body;
}

function requestRefresh(): void {
  revision++; pending = true;
  if (!running) void refreshLoop();
}
async function refreshLoop(): Promise<void> {
  running = true;
  try {
    while (pending) {
      pending = false;
      const current = revision;
      const path = selected();
      const treePromise = getJSON<{ entries: Node[] }>('/api/tree');
      const filePromise = path ? getJSON<FileReply>(`/api/file?path=${encodeURIComponent(path)}`).then((value) => ({ value }), (error: unknown) => ({ error })) : Promise.resolve(null);
      try {
        const [treeReply, fileReply] = await Promise.all([treePromise, filePromise]);
        if (current !== revision || path !== selected()) { pending = true; continue; }
        nodes = treeReply.entries; renderTree();
        title.textContent = path;
        renderedRevision = current;
        if (!path) { content.innerHTML = '<p class="hint">ファイルを選択してください。</p>'; continue; }
        if (fileReply && 'error' in fileReply) {
          content.replaceChildren();
          const message = document.createElement('p'); message.className = 'file-error';
          message.textContent = `ファイルを表示できません: ${String(fileReply.error)}`;
          content.append(message);
        } else if (fileReply && 'value' in fileReply) {
          content.innerHTML = fileReply.value.html;
          if (location.hash) {
            try { document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView(); } catch { /* Invalid fragment. */ }
          }
          void drawMermaid(content, () => renderedRevision === current && revision === current && path === selected());
        }
      } catch (error) {
        if (current !== revision) { pending = true; continue; }
        content.replaceChildren();
        const message = document.createElement('p'); message.className = 'file-error';
        message.textContent = `再取得に失敗しました: ${String(error)}`; content.append(message);
      }
    }
  } finally {
    running = false;
    if (pending) void refreshLoop();
  }
}

tree.addEventListener('click', (event) => {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault(); history.pushState(null, '', link.href); requestRefresh();
});
content.addEventListener('click', (event) => {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || link.origin !== location.origin || link.pathname !== '/' || !new URL(link.href).searchParams.has('path')) return;
  if (link.pathname === location.pathname && link.search === location.search && link.hash) return;
  event.preventDefault(); history.pushState(null, '', link.href); requestRefresh();
});
window.addEventListener('popstate', requestRefresh);
search.addEventListener('input', renderTree);
reload.addEventListener('click', requestRefresh);

const events = new EventSource('/api/events');
events.addEventListener('ready', () => { setStatus('自動更新中'); requestRefresh(); });
events.addEventListener('refresh', requestRefresh);
for (const name of ['created', 'changed', 'deleted']) events.addEventListener(name, requestRefresh);
events.addEventListener('watch-error', () => { setStatus('監視エラー。再読み込みしてください。', true); requestRefresh(); });
events.addEventListener('watch-ok', () => setStatus('自動更新中'));
events.onerror = () => setStatus('接続が切れました。再接続中…', true);
