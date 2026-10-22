/**
 * Eye buttons next to password fields: `<button data-password-toggle="<input id>" aria-pressed="false">`.
 * Shows or hides what was typed. Bound once per page load (view transitions keep the listener).
 */
export function bindPasswordToggles() {
  if (globalThis.__wcagPasswordToggleBound) return;
  globalThis.__wcagPasswordToggleBound = true;
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const toggle = target.closest('[data-password-toggle]');
    if (!toggle) return;
    const input = document.getElementById(toggle.getAttribute('data-password-toggle') || '');
    if (!(input instanceof HTMLInputElement)) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', show ? 'true' : 'false');
  });
}
