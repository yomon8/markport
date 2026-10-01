// Keep the original TeX available for errors and outline labels.
export function mathText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  for (const math of clone.querySelectorAll<HTMLElement>('[data-math]')) {
    math.textContent = math.dataset.mathSource ?? math.textContent;
  }
  return clone.textContent ?? '';
}

export async function drawMath(container: HTMLElement, current: () => boolean): Promise<void> {
  const elements = [...container.querySelectorAll<HTMLElement>('[data-math]:not([data-math-rendered])')];
  if (!elements.length) return;
  for (const element of elements) element.dataset.mathSource ??= element.textContent ?? '';
  const active = (element: HTMLElement): boolean => current() && element.isConnected && container.contains(element);
  const fail = (element: HTMLElement, error: unknown): void => {
    element.replaceChildren();
    const source = document.createElement('span'); source.className = 'math-original'; source.textContent = element.dataset.mathSource ?? '';
    const message = document.createElement('span'); message.className = 'math-error'; message.textContent = 'Cannot display formula'; message.title = String(error);
    element.append(source, message); element.dataset.mathRendered = 'error';
  };
  try {
    const [{ default: katex }] = await Promise.all([import('katex'), import('katex/dist/katex.min.css')]);
    for (const element of elements) {
      if (!active(element)) continue;
      if (element.dataset.mathRendered) continue;
      const source = element.dataset.mathSource ?? '';
      const delimiterLength = source.startsWith('$$') || source.startsWith('\\') ? 2 : 1;
      try {
        katex.render(source.slice(delimiterLength, -delimiterLength), element, {
          displayMode: element.dataset.math === 'display', output: 'htmlAndMathml',
          trust: false, throwOnError: true, maxExpand: 1000, maxSize: 20, macros: {},
        });
        element.dataset.mathRendered = 'true';
      } catch (error) { fail(element, error); }
    }
  } catch (error) {
    for (const element of elements) if (active(element)) fail(element, error);
  }
}
