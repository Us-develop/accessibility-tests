<script>
  import { tick } from 'svelte';

  /**
   * The one contact form of the app ("Talk to a WCAG expert"). Used on the scan
   * teaser, where `token` ties the request to the guest's scan, and on /contact,
   * where `source` says which page sent the visitor.
   *
   * @type {{ token?: string, source?: string, heading?: string, intro?: string }}
   */
  let {
    token = '',
    source = 'contact',
    heading = 'Talk to a WCAG expert',
    intro = 'Prefer expert support? We can audit the site, prioritise findings, and turn them into practical improvements. No obligation.',
  } = $props();

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
        err = data.error || 'Could not send your request.';
        return;
      }
      // The form is replaced by a confirmation, and focus goes to it: a form
      // that only empties itself leaves people unsure whether anything was sent.
      sent = { email, confirmationSent: data.confirmationSent === true };
      await tick();
      successEl?.focus();
    } catch {
      err = 'We could not reach the server. Check your connection and try again.';
    } finally {
      submitting = false;
    }
  }
</script>

<div class="card guest-lead" id="lead-form">
  {#if sent}
    <div class="guest-lead-success" role="status" tabindex="-1" bind:this={successEl}>
      <h2>Thank you, your request is on its way</h2>
      <p>
        One of our accessibility specialists will reply to <strong>{sent.email}</strong> within two working days.
      </p>
      {#if sent.confirmationSent}
        <p class="muted">We have sent a confirmation to that address. Check your spam folder if you do not see it.</p>
      {/if}
      <div class="guest-cta-row">
        <a class="btn btn-primary" href="/">Start a new scan</a>
        <a class="btn btn-ghost" href="/pricing">See pricing</a>
      </div>
    </div>
  {:else}
    <h2>{heading}</h2>
    <p class="muted guest-lead-intro">{intro}</p>
    <form onsubmit={onSubmit}>
      <div class="field">
        <label class="field-label" for="lead-name">Name</label>
        <input class="input" id="lead-name" name="name" type="text" autocomplete="name" required />
      </div>
      <div class="field">
        <label class="field-label" for="lead-company">Company</label>
        <input class="input" id="lead-company" name="company" type="text" autocomplete="organization" />
      </div>
      <div class="field">
        <label class="field-label" for="lead-email">Email</label>
        <input class="input" id="lead-email" name="email" type="email" autocomplete="email" required />
      </div>
      <div class="field">
        <label class="field-label" for="lead-phone">Phone (optional)</label>
        <input class="input" id="lead-phone" name="phone" type="tel" autocomplete="tel" />
      </div>
      <div class="field">
        <label class="field-label" for="lead-message">Message</label>
        <textarea class="textarea" id="lead-message" name="message" rows="4" maxlength="4000"></textarea>
      </div>
      <p class="muted guest-lead-privacy">
        We use these details only to contact you about this request. See our
        <a class="link" href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Notice</a>.
      </p>
      {#if err}
        <p id="lead-err" class="guest-lead-msg guest-lead-msg-err" role="alert">{err}</p>
      {/if}
      <button type="submit" class="btn btn-grad btn-lg" disabled={submitting} aria-describedby={err ? 'lead-err' : undefined}>
        {submitting ? 'Sending…' : 'Send my request'}
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
