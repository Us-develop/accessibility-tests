<script>
  import { tick } from 'svelte';
  import { t } from '../../../i18n/index.mjs';

  /**
   * The one contact form of the app ("Talk to a WCAG expert"). Used on the scan
   * teaser, where `token` ties the request to the guest's scan, and on /contact,
   * where `source` says which page sent the visitor.
   *
   * `lang` is the language of the page the form sits on. Pages that are not
   * translated yet leave it at English.
   *
   * @type {{ token?: string, source?: string, lang?: string, heading?: string, intro?: string }}
   */
  let { token = '', source = 'contact', lang = 'en', heading = '', intro = '' } = $props();
  const tr = (key) => t(lang, key);
  /** Server messages are English for now; mark them when the page is not. */
  let errLang = $state('');

  let err = $state('');
  let sent = $state(/** @type {{ email: string, confirmationSent: boolean } | null} */ (null));
  let submitting = $state(false);
  /** @type {HTMLElement | undefined} */
  let successEl = $state();

  function wcUrl(path) {
    return typeof globalThis.wcagApiUrl === 'function' ? globalThis.wcagApiUrl(path) : path;
  }
  function wcCreds() {
    return typeof globalThis.wcagFetchCredentials === 'function' ? globalThis.wcagFetchCredentials() : 'same-origin';
  }

  async function onSubmit(e) {
    e.preventDefault();
    err = '';
    errLang = '';
    submitting = true;
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get('email') || '').trim();
    const body = {
      name: String(fd.get('name') || '').trim(),
      company: String(fd.get('company') || '').trim(),
      email,
      phone: String(fd.get('phone') || '').trim(),
      message: String(fd.get('message') || '').trim(),
      token,
      source,
    };
    try {
      const res = await fetch(wcUrl('/api/lead'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: wcCreds(),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        err = data.error || tr('lead.error.generic');
        errLang = data.error && lang !== 'en' ? 'en' : '';
        return;
      }
      // The form is replaced by a confirmation, and focus goes to it: a form
      // that only empties itself leaves people unsure whether anything was sent.
      sent = { email, confirmationSent: data.confirmationSent === true };
      await tick();
      successEl?.focus();
    } catch {
      err = tr('lead.error.network');
    } finally {
      submitting = false;
    }
  }
</script>

<div class="card guest-lead" id="lead-form">
  {#if sent}
    <div class="guest-lead-success" role="status" tabindex="-1" bind:this={successEl}>
      <h2>{tr('lead.sent.heading')}</h2>
      <p>
        {tr('lead.sent.body.before')} <strong>{sent.email}</strong> {tr('lead.sent.body.after')}
      </p>
      {#if sent.confirmationSent}
        <p class="muted">{tr('lead.sent.confirmation')}</p>
      {/if}
      <div class="guest-cta-row">
        <a class="btn btn-primary" href="/">{tr('lead.sent.scan')}</a>
        <a class="btn btn-ghost" href="/pricing">{tr('lead.sent.pricing')}</a>
      </div>
    </div>
  {:else}
    <h2>{heading || tr('lead.heading')}</h2>
    <p class="muted guest-lead-intro">{intro || tr('lead.intro')}</p>
    <form onsubmit={onSubmit}>
      <div class="field">
        <label class="field-label" for="lead-name">{tr('lead.name')}</label>
        <input class="input" id="lead-name" name="name" type="text" autocomplete="name" required />
      </div>
      <div class="field">
        <label class="field-label" for="lead-company">{tr('lead.company')}</label>
        <input class="input" id="lead-company" name="company" type="text" autocomplete="organization" />
      </div>
      <div class="field">
        <label class="field-label" for="lead-email">{tr('lead.email')}</label>
        <input class="input" id="lead-email" name="email" type="email" autocomplete="email" required />
      </div>
      <div class="field">
        <label class="field-label" for="lead-phone">{tr('lead.phone')}</label>
        <input class="input" id="lead-phone" name="phone" type="tel" autocomplete="tel" />
      </div>
      <div class="field">
        <label class="field-label" for="lead-message">{tr('lead.message')}</label>
        <textarea class="textarea" id="lead-message" name="message" rows="4" maxlength="4000"></textarea>
      </div>
      <p class="muted guest-lead-privacy">
        {tr('lead.privacy.before')}
        <a class="link" href="/privacy" target="_blank" rel="noopener noreferrer">{tr('lead.privacy.link')}</a>.
      </p>
      {#if err}
        <p id="lead-err" class="guest-lead-msg guest-lead-msg-err" role="alert" lang={errLang || undefined}>{err}</p>
      {/if}
      <button type="submit" class="btn btn-grad btn-lg" disabled={submitting} aria-describedby={err ? 'lead-err' : undefined}>
        {submitting ? tr('lead.sending') : tr('lead.submit')}
      </button>
    </form>
  {/if}
</div>

<style>
  .guest-lead {
    padding: 32px;
    scroll-margin-top: 96px;
  }
  .guest-lead h2 {
    font-size: 24px;
    margin-bottom: 8px;
  }
  .guest-lead-intro {
    margin-bottom: 22px;
  }
  .guest-lead .field {
    margin-bottom: 14px;
  }
  .guest-lead .field:last-of-type {
    margin-bottom: 18px;
  }
  .guest-lead-msg {
    margin-bottom: 12px;
    font-size: 14px;
  }
  .guest-lead-msg-err {
    color: var(--status-error);
  }
  .guest-lead-success p {
    margin-bottom: 12px;
  }
  .guest-lead-success .guest-cta-row {
    margin-top: 18px;
  }
</style>
