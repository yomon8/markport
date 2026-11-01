import { mathText } from './math';

type OutlineOptions = {
  content: HTMLElement;
  outline: HTMLElement;
  main: HTMLElement;
  rightContent: HTMLElement;
  rightOutline: HTMLElement;
  rightContents: HTMLButtonElement;
};

export function createOutline(deps: OutlineOptions) {
  const { content, outline, main, rightContent, rightOutline, rightContents } = deps;
  let outlineObserver: IntersectionObserver | undefined;
  function updateOutline(): void {
    outlineObserver?.disconnect(); outline.replaceChildren();
    const headings = [...content.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]')];
    outline.hidden = headings.length < 3;
    if (outline.hidden) return;
    for (const heading of headings) {
      const link = document.createElement('a'); link.href = `#${encodeURIComponent(heading.id)}`; link.textContent = mathText(heading); link.className = `outline-h${heading.tagName.slice(1)}`;
      link.addEventListener('click', (event) => { event.preventDefault(); history.replaceState(history.state, '', `#${encodeURIComponent(heading.id)}`); heading.scrollIntoView(); outline.classList.remove('open'); }); outline.append(link);
    }
    if (typeof IntersectionObserver !== 'undefined') {
      outlineObserver = new IntersectionObserver((entries) => { for (const entry of entries) if (entry.isIntersecting) for (const link of outline.querySelectorAll('a')) link.classList.toggle('active', decodeURIComponent(link.hash.slice(1)) === entry.target.id); }, { root: main, rootMargin: '-15% 0px -70% 0px' });
      headings.forEach((heading) => outlineObserver?.observe(heading));
    }
  }
  function updateRightOutline(): void {
    rightOutline.replaceChildren(); rightOutline.classList.remove('open');
    const headings = [...rightContent.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]')];
    rightOutline.hidden = headings.length < 3; rightContents.hidden = rightOutline.hidden;
    for (const heading of headings) {
      const link = document.createElement('a'); link.href = `#${encodeURIComponent(heading.id)}`;
      link.textContent = mathText(heading); link.className = `outline-h${heading.tagName.slice(1)}`;
      link.addEventListener('click', (event) => { event.preventDefault(); heading.scrollIntoView(); rightOutline.classList.remove('open'); });
      rightOutline.append(link);
    }
  }
  function clear(): void {
    outlineObserver?.disconnect(); outline.replaceChildren(); outline.hidden = true;
  }
  return { updateOutline, updateRightOutline, clear, dispose: () => outlineObserver?.disconnect() };
}
