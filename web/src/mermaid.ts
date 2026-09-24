import { effectiveTheme } from './theme';
let serial = 0;
export async function drawMermaid(container: HTMLElement, current: () => boolean): Promise<void> {
  const elements = [...container.querySelectorAll<HTMLElement>('[data-mermaid="true"]')];
  if (!elements.length) return;
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({ securityLevel: 'strict', startOnLoad: false, theme: effectiveTheme() === 'dark' ? 'dark' : 'neutral' });
  for (const element of elements) {
    const definition = element.dataset.source ?? element.textContent ?? '';
    element.dataset.source = definition;
    try {
      const { svg } = await mermaid.render(`markport-diagram-${++serial}`, definition);
      if (!current() || !element.isConnected) return;
      element.innerHTML = `<div class="diagram-actions"><button type="button" data-diagram-action="source">Source</button><button type="button" data-diagram-action="expand">Expand</button></div><div class="diagram-image">${svg}</div>`;
      element.dataset.rendered = 'true';
    } catch (error) {
      if (!current() || !element.isConnected) return;
      element.replaceChildren();
      const heading = document.createElement('strong'); heading.textContent = 'Cannot display diagram';
      const message = document.createElement('p'); message.className = 'diagram-error'; message.textContent = String(error).replace(/^Error:\s*/, '');
      const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Show source';
      const source = document.createElement('pre'); source.textContent = definition; details.append(summary, source);
      element.append(heading, message, details); element.dataset.rendered = 'true';
    }
  }
}
