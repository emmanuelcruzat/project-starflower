import '../home/home.css';
import './account.css';
import { MAP_HEIGHT, MAP_WIDTH } from '../ui/map/generate';
import { drawSector, showcaseMap } from '../home/sectorArt';
import { loadNation } from '../storage';

// MOCKUP: the account page (account/index.html). Accounts don't exist yet:
// these forms check what's typed and say so, but send and store nothing.
// Sign in and Create account are tabs of one card; #sign-in and #create in
// the address open either (the homepage's header links use them).

type Tab = 'sign-in' | 'create';

const tabs = [...document.querySelectorAll<HTMLButtonElement>('.auth-tab')];
const panels = new Map<Tab, HTMLFormElement>([
  ['sign-in', document.getElementById('panel-sign-in') as HTMLFormElement],
  ['create', document.getElementById('panel-create') as HTMLFormElement],
]);

function showTab(tab: Tab, focus = false): void {
  for (const button of tabs) {
    const selected = button.getAttribute('aria-controls') === `panel-${tab}`;
    button.setAttribute('aria-selected', String(selected));
    // Only the selected tab is in the tab order; arrow keys move between them.
    button.tabIndex = selected ? 0 : -1;
    if (selected && focus) button.focus();
  }
  for (const [name, panel] of panels) panel.hidden = name !== tab;
  document.title = `${tab === 'create' ? 'Create account' : 'Sign in'} · Project Starflower`;
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
}

function wireTabs(): void {
  tabs.forEach((button, i) => {
    button.addEventListener('click', () => showTab(button.getAttribute('aria-controls')!.replace('panel-', '') as Tab));
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const next = tabs[(i + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      showTab(next.getAttribute('aria-controls')!.replace('panel-', '') as Tab, true);
    });
  });
  // "New here? Create an account" and its opposite.
  document.querySelectorAll<HTMLButtonElement>('[data-show]').forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.dataset.show as Tab;
      showTab(tab);
      panels.get(tab)?.querySelector('input')?.focus();
    });
  });
  const fromHash = () => showTab(location.hash === '#create' ? 'create' : 'sign-in');
  window.addEventListener('hashchange', fromHash);
  fromHash();
}

/** Show and Hide on the password fields. */
function wireReveal(): void {
  document.querySelectorAll<HTMLButtonElement>('.reveal').forEach((button) => {
    const input = document.getElementById(button.getAttribute('aria-controls')!) as HTMLInputElement;
    button.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.textContent = show ? 'Hide' : 'Show';
      button.setAttribute('aria-pressed', String(show));
    });
  });
}

const STRENGTH_LABELS = ['At least 8 characters. Longer is stronger.', 'Weak', 'Fair', 'Good', 'Strong'];

/** A rough 0 to 4: length, then a mix of kinds of character. Only a nudge, not a rule. */
function strength(password: string): number {
  if (password.length === 0) return 0;
  let score = password.length >= 8 ? 1 : 0;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  return Math.max(1, score);
}

function wireStrength(): void {
  const input = document.getElementById('create-password') as HTMLInputElement;
  const meter = document.getElementById('create-password-strength')!;
  const label = meter.querySelector('.strength-label')!;
  input.addEventListener('input', () => {
    const score = strength(input.value);
    meter.dataset.strength = String(score);
    label.textContent = STRENGTH_LABELS[score];
  });
}

/** What's wrong with a field, or '' if nothing. */
function problem(input: HTMLInputElement): string {
  const empty = input.type === 'checkbox' ? !input.checked : input.value.trim() === '';
  switch (input.name) {
    case 'email':
      if (empty) return 'Enter your email address.';
      return input.validity.typeMismatch ? 'That doesn\'t look like an email address.' : '';
    case 'password':
      if (empty) return 'Enter a password.';
      return input.minLength > 0 && input.value.length < input.minLength ? `Use at least ${input.minLength} characters.` : '';
    case 'name':
      if (empty) return 'Choose a commander name.';
      if (input.value.trim().length < 3) return 'Use at least 3 characters.';
      return /^[\p{L}\p{N} ]+$/u.test(input.value.trim()) ? '' : 'Use only letters, numbers and spaces.';
    case 'terms':
      return empty ? 'Agree to the terms to create an account.' : '';
    default:
      return '';
  }
}

/** Checks a field and shows or clears its message. True if it's fine. */
function check(input: HTMLInputElement): boolean {
  const message = problem(input);
  const error = document.getElementById(`${input.id || `create-${input.name}`}-error`);
  input.setAttribute('aria-invalid', String(message !== ''));
  if (error) {
    error.textContent = message;
    error.hidden = message === '';
  }
  return message === '';
}

/**
 * MOCKUP: submitting checks every field, and if all is well says accounts
 * aren't open yet. Nothing leaves the page. After a first try, fields
 * recheck as they change.
 */
function wireForms(): void {
  for (const form of panels.values()) {
    const fields = [...form.querySelectorAll<HTMLInputElement>('input[required]')];
    const note = form.querySelector<HTMLElement>('[data-form-note]')!;
    let tried = false;
    for (const input of fields) {
      const recheck = () => tried && check(input);
      input.addEventListener(input.type === 'checkbox' ? 'change' : 'input', recheck);
      input.addEventListener('blur', recheck);
    }
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      tried = true;
      const bad = fields.filter((input) => !check(input));
      if (bad.length > 0) {
        note.textContent = '';
        note.classList.remove('emphasis');
        bad[0].focus();
        return;
      }
      note.textContent = form.dataset.form === 'create'
        ? "Looks good! Accounts aren't open yet, so nothing was created or sent."
        : "Accounts aren't open yet, so you haven't been signed in and nothing was sent.";
      note.classList.add('emphasis');
    });
  }
}

/** If this browser has a nation, offer to bring it to the new account. */
function offerNation(): void {
  const nation = loadNation();
  const offer = document.querySelector<HTMLElement>('[data-bring-nation]');
  if (!nation || !offer) return;
  offer.querySelector('[data-nation-name]')!.textContent = `the ${nation.prefix} of ${nation.name}`;
  offer.hidden = false;
}

/** Links for what isn't built yet explain they're coming instead of going anywhere. */
function wirePlaceholders(): void {
  const toast = document.querySelector<HTMLElement>('.toast');
  let timer = 0;
  document.querySelectorAll<HTMLElement>('[data-coming-soon]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      if (!toast) return;
      toast.textContent = link.dataset.comingSoon ?? 'Coming soon.';
      toast.hidden = false;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => (toast.hidden = true), 4000);
    });
  });
}

/** The small-screen menu, as on the homepage. */
function wireMenu(): void {
  const toggle = document.querySelector<HTMLButtonElement>('.menu-toggle');
  const nav = document.getElementById('site-nav');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('open', open);
  });
}

/** The showcase sector behind the pitch, and a readout of it. */
function drawArt(): void {
  const map = showcaseMap();
  document.querySelector('.account-map')?.append(drawSector(map, `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`));
  const readout = document.querySelector('[data-readout]');
  if (readout) readout.textContent = `${map.sector.name} Cluster · ${map.systems.length} systems surveyed`;
}

wireTabs();
wireReveal();
wireStrength();
wireForms();
offerNation();
wirePlaceholders();
wireMenu();
drawArt();
