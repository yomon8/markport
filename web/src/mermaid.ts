import mermaid from 'mermaid';

mermaid.initialize({ securityLevel: 'strict', startOnLoad: false, theme: 'neutral' });
let serial = 0;

export async function drawMermaid(container: HTMLElement, current: () => boolean): Promise<void> {
  for (const element of container.querySelectorAll<HTMLElement>('[data-mermaid="true"]')) {
    const definition = element.textContent ?? '';
    try {
      const { svg } = await mermaid.render(`markport-diagram-${++serial}`, definition);
      if (!current() || !element.isConnected) return;
      element.innerHTML = svg;
    } catch (error) {
      if (!current() || !element.isConnected) return;
      element.replaceChildren();
      const source = document.createElement('pre'); source.textContent = definition;
      const message = document.createElement('p'); message.className = 'diagram-error'; message.textContent = `Mermaid: ${String(error)}`;
      element.append(source, message);
    }
  }
}
