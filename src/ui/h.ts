// Tiny element helper: h('button', { class: 'primary', onclick }, 'Sign in').

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value as EventListener);
    } else if (key === 'class') {
      el.className = String(value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export function mount(root: HTMLElement, ...nodes: Node[]): void {
  root.replaceChildren(...nodes);
}

/** Replaces an element's children, skipping null/false entries like h() does. */
export function fill(el: HTMLElement, ...children: (Child | Child[])[]): void {
  el.replaceChildren();
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false || child === '') continue;
    el.append(child instanceof Node ? child : String(child));
  }
}
