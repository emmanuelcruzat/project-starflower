import { el } from './dom';

// A small right-click menu: a heading, a few facts, an optional
// description, and actions. Only one is open at a time. It closes on a
// click elsewhere, Escape, scrolling, resizing, or choosing an action.

export interface MenuContent {
  /** Small caps line above the title, like "Star system" or "Planet". */
  eyebrow: string;
  title: string;
  /** Just the actions, with no heading; the title only names the menu for screen readers. */
  actionsOnly?: boolean;
  subtitle?: string;
  /** Label and value pairs, shown as a compact table. */
  facts?: [label: string, value: string][];
  description?: string;
  actions?: MenuAction[];
  /** A color dot beside the title: the body's own color. */
  colour?: string;
}

export interface MenuAction {
  label: string;
  run?: () => void;
  /** A small heading over this action and the ones after it that share it, like "Diplomacy". */
  group?: string;
  /**
   * PLACEHOLDER: for an action that doesn't work yet. Choosing it opens a
   * note in the menu's place saying so, with this as its text, instead of
   * running anything.
   */
  soon?: string;
}

let open: { node: HTMLElement; close: () => void } | null = null;

export function closeContextMenu(): void {
  open?.close();
}

/**
 * Opens a menu at a point on screen (client coordinates), nudged to stay in
 * the window. Focus goes to the first action, if any, so the keyboard can
 * use it: arrow keys move between actions, Escape closes.
 */
export function showContextMenu(x: number, y: number, content: MenuContent): void {
  closeContextMenu();
  const menu = el('div', 'context-menu');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', content.title);

  const head = el('div', 'context-menu-head');
  head.append(el('p', 'eyebrow', content.eyebrow));
  const title = el('h3', 'context-menu-title');
  if (content.colour) {
    const dot = el('span', 'body-swatch');
    dot.style.background = content.colour;
    title.append(dot);
  }
  title.append(content.title);
  head.append(title);
  if (content.subtitle) head.append(el('p', 'muted', content.subtitle));
  if (!content.actionsOnly) menu.append(head);

  if (content.facts?.length) {
    const facts = el('dl', 'context-menu-facts');
    for (const [label, value] of content.facts) facts.append(el('dt', '', label), el('dd', '', value));
    menu.append(facts);
  }
  if (content.description) menu.append(el('p', 'context-menu-description', content.description));

  const buttons: HTMLButtonElement[] = [];
  if (content.actions?.length) {
    const list = el('div', 'context-menu-actions');
    let group: string | undefined;
    for (const action of content.actions) {
      if (action.group && action.group !== group) list.append(el('p', 'context-menu-group', action.group));
      group = action.group;
      const button = el('button', `context-menu-action ${action.soon ? 'soon' : ''}`, action.label) as HTMLButtonElement;
      button.setAttribute('role', 'menuitem');
      button.addEventListener('click', () => {
        close();
        if (action.soon) showContextMenu(x, y, { eyebrow: 'Coming soon', title: action.label, description: action.soon });
        else action.run?.();
      });
      buttons.push(button);
      list.append(button);
    }
    menu.append(list);
  }

  const previous = document.activeElement as HTMLElement | null;
  const onPointer = (event: PointerEvent) => {
    if (!menu.contains(event.target as Node)) close();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      previous?.focus({ preventScroll: true });
      return;
    }
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at === -1 || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault();
    buttons[(at + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length].focus();
  };
  const onAway = () => close();
  function close() {
    if (open?.node !== menu) return;
    open = null;
    menu.remove();
    document.removeEventListener('pointerdown', onPointer, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('wheel', onAway, true);
    window.removeEventListener('resize', onAway);
    window.removeEventListener('blur', onAway);
  }
  // Capture phase, so the map's own handlers (which might stop the event) don't hide it from us.
  document.addEventListener('pointerdown', onPointer, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('wheel', onAway, true);
  window.addEventListener('resize', onAway);
  window.addEventListener('blur', onAway);
  open = { node: menu, close };

  document.body.append(menu);
  // Keep it in the window: flip left or up if it would run off the edge.
  const margin = 8;
  const { width, height } = menu.getBoundingClientRect();
  const left = x + width + margin > window.innerWidth ? Math.max(margin, x - width) : x;
  const top = y + height + margin > window.innerHeight ? Math.max(margin, y - height) : y;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  buttons[0]?.focus({ preventScroll: true });
}
