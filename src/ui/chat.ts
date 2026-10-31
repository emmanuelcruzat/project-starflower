import { el } from './dom';

// PLACEHOLDER: a mockup of the chat window. There's no server yet, so the
// messages and the online list are made up and the input is disabled. It
// shows where chat will sit and how it will look.

/**
 * The Sector channel: players' messages, mixed with game notifications
 * (`notice`) announcing sector events such as treaties and new colonies.
 */
type ChatLine = { from: string; text: string; own?: boolean } | { notice: string };

const SAMPLE_MESSAGES: ChatLine[] = [
  { notice: 'Ostrel Dominion colonized the Harrow system.' },
  { from: 'Veyrani Compact', text: 'Your survey ships are drifting rather close to our border.' },
  { from: 'You', text: 'Purely scientific. We can share the readings.', own: true },
  { from: 'Veyrani Compact', text: 'Then we look forward to them.' },
  { notice: 'Veyrani Compact and Free Hollis Worlds signed a non-aggression treaty.' },
  { from: 'Free Hollis Worlds', text: 'Anyone trading refined ore this cycle?' },
  { notice: 'Kessa Reach colonized the Tamsin system.' },
];

const SAMPLE_ONLINE: { name: string; status: 'online' | 'away' }[] = [
  { name: 'Veyrani Compact', status: 'online' },
  { name: 'Free Hollis Worlds', status: 'online' },
  { name: 'Ostrel Dominion', status: 'online' },
  { name: 'Kessa Reach', status: 'away' },
  { name: 'Tarnhold Union', status: 'away' },
];

/**
 * Whether the window is minimized. UI-only, like ViewState: it survives the
 * page's redraws (every render rebuilds the window) but not a reload.
 */
let minimized = false;

export function chatMockup(): HTMLElement {
  const panel = el('section', `chat-window ${minimized ? 'minimized' : ''}`);
  panel.setAttribute('aria-label', 'Chat (preview)');
  const body = el('div', 'chat-body');
  body.id = 'chat-body';
  body.hidden = minimized;

  // The header stays visible when minimized, with the online count.
  const header = el('div', 'chat-header');
  const tabs = el('div', 'chat-tabs');
  tabs.append(el('span', 'chat-tab selected', 'Sector'), el('span', 'chat-tab', 'Diplomatic'));
  const online = SAMPLE_ONLINE.filter((p) => p.status === 'online').length;
  const count = el('span', 'chat-online-count', `${online} online`);
  const toggle = el('button', 'secondary small chat-toggle', minimized ? '▴' : '▾');
  const setLabel = () => {
    toggle.textContent = minimized ? '▴' : '▾';
    toggle.title = minimized ? 'Expand chat' : 'Minimize chat';
    toggle.setAttribute('aria-label', toggle.title);
    toggle.setAttribute('aria-expanded', String(!minimized));
  };
  toggle.setAttribute('aria-controls', body.id);
  setLabel();
  toggle.addEventListener('click', () => {
    minimized = !minimized;
    body.hidden = minimized;
    panel.classList.toggle('minimized', minimized);
    setLabel();
  });
  const right = el('div', 'chat-header-right');
  right.append(count, el('span', 'chat-soon', 'Preview'), toggle);
  header.append(tabs, right);

  const messages = el('ol', 'chat-messages');
  for (const line of SAMPLE_MESSAGES) {
    if ('notice' in line) {
      messages.append(el('li', 'chat-notice', line.notice));
      continue;
    }
    const item = el('li', `chat-message ${line.own ? 'own' : ''}`);
    item.append(el('span', 'chat-from', line.from), el('span', 'chat-text', line.text));
    messages.append(item);
  }

  // Who's online, beside the messages: a dot for their status, then their name.
  const people = el('div', 'chat-people');
  people.append(el('p', 'chat-people-title', 'Online'));
  const list = el('ul', 'chat-people-list');
  for (const person of SAMPLE_ONLINE) {
    const item = el('li', `chat-person ${person.status}`);
    item.title = person.status === 'online' ? 'Online' : 'Away';
    item.append(el('span', 'chat-status-dot'), el('span', 'chat-person-name', person.name));
    list.append(item);
  }
  people.append(list);

  const form = el('form', 'chat-input');
  const input = el('input');
  input.type = 'text';
  input.placeholder = 'Chat is coming soon';
  input.disabled = true;
  input.setAttribute('aria-label', 'Message');
  const send = el('button', 'secondary small', 'Send');
  send.type = 'submit';
  send.disabled = true;
  form.append(input, send);
  form.addEventListener('submit', (event) => event.preventDefault());

  const main = el('div', 'chat-main');
  main.append(messages, form);
  body.append(main, people);
  panel.append(header, body);
  return panel;
}
