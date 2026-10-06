import { effectiveTheme, effectiveThemeId } from './theme';
import { createCopyButton } from './copyControls';
import { createToolButton } from './toolButtons';
import type { MermaidConfig } from 'mermaid';

let serial = 0;
let queue: Promise<void> = Promise.resolve();
const generations = new WeakMap<HTMLElement, symbol>();

function config(): MermaidConfig {
  const theme = effectiveThemeId();
  if (theme === 'light' || theme === 'dark') {
    return { securityLevel: 'strict', startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'neutral' };
  }
  const css = getComputedStyle(document.documentElement);
  const color = (name: string): string => css.getPropertyValue(name).trim();
  return {
    securityLevel: 'strict', startOnLoad: false, theme: 'base',
    themeVariables: {
      darkMode: effectiveTheme() === 'dark',
      background: color('--code-bg'), textColor: color('--text'),
      primaryColor: color('--accent-soft'), primaryTextColor: color('--text'), primaryBorderColor: color('--accent'),
      secondaryColor: color('--surface'), secondaryTextColor: color('--text'), secondaryBorderColor: color('--accent'),
      tertiaryColor: color('--sidebar'), tertiaryTextColor: color('--text'), tertiaryBorderColor: color('--accent'),
      lineColor: color('--accent'), nodeTextColor: color('--text'),
    },
  };
}

export function drawMermaid(container: HTMLElement, current: () => boolean, rendered?: () => void, print = false): Promise<void> {
  const elements = [...container.querySelectorAll<HTMLElement>('[data-mermaid="true"]')];
  if (!elements.length) return Promise.resolve();
  const generation = Symbol();
  generations.set(container, generation);
  const theme = effectiveThemeId();
  const options: MermaidConfig = print ? { securityLevel: 'strict', startOnLoad: false, theme: 'neutral' } : config();
  const definitions = elements.map((element) => {
    const definition = element.dataset.source ?? element.textContent ?? '';
    element.dataset.source = definition;
    return definition;
  });
  const actions = (element: HTMLElement, ready: boolean): HTMLElement => {
    const toolbar = document.createElement('div'); toolbar.className = 'diagram-actions';
    if (ready && !print) {
      const source = createToolButton('code', 'Source'); source.dataset.diagramAction = 'source';
      const expand = createToolButton('maximize', 'Expand'); expand.dataset.diagramAction = 'expand';
      toolbar.append(source, expand);
    }
    if (!print) toolbar.append(createCopyButton(() => element.dataset.source ?? ''));
    return toolbar;
  };
  for (const element of elements) {
    if (!element.querySelector('.diagram-actions') && !print) element.prepend(actions(element, false));
  }
  const failure = (element: HTMLElement, index: number, error: unknown): void => {
    element.replaceChildren(actions(element, false));
    const heading = document.createElement('strong'); heading.textContent = 'Cannot display diagram';
    const message = document.createElement('p'); message.className = 'diagram-error'; message.textContent = String(error).replace(/^Error:\s*/, '');
    const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Show source';
    const source = document.createElement('pre'); source.textContent = definitions[index]; details.append(summary, source);
    element.append(heading, message, details); element.dataset.rendered = 'true';
  };
  const valid = (): boolean => generations.get(container) === generation && (print || effectiveThemeId() === theme) && current();
  // Mermaid has global configuration. Keep initialization and rendering in one queue.
  const task = queue.then(async () => {
    if (!valid()) return;
    let mermaid: typeof import('mermaid').default;
    try { ({ default: mermaid } = await import('mermaid')); }
    catch (error) {
      for (const [index, element] of elements.entries()) {
        if (valid() && element.isConnected && container.contains(element)) failure(element, index, error);
      }
      return;
    }
    if (!valid()) return;
    mermaid.initialize(options);
    for (const [index, element] of elements.entries()) {
      if (!valid()) return;
      if (!element.isConnected || !container.contains(element)) continue;
      try {
        const { svg } = await mermaid.render(`markport-diagram-${++serial}`, definitions[index]);
        if (!valid()) return;
        if (!element.isConnected || !container.contains(element)) continue;
        const image = element.querySelector<HTMLElement>('.diagram-image');
        if (image) {
          const { scrollTop, scrollLeft } = image;
          image.innerHTML = svg;
          image.scrollTop = scrollTop; image.scrollLeft = scrollLeft;
        } else {
          element.innerHTML = `<div class="diagram-image">${svg}</div>`;
          element.prepend(actions(element, true));
        }
        element.dataset.rendered = 'true';
        rendered?.();
      } catch (error) {
        if (!valid()) return;
        if (!element.isConnected || !container.contains(element)) continue;
        failure(element, index, error);
      }
    }
  });
  queue = task.catch(() => { /* A failed load must not block later renders. */ });
  return task;
}
