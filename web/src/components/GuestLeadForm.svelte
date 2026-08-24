<script>
  /** @type {{ token: string }} */
  let { token } = $props();

  let err = $state('');
  let ok = $state('');
  let submitting = $state(false);

  function wcUrl(path) {
    return typeof globalThis.wcagApiUrl === 'function' ? globalThis.wcagApiUrl(path) : path;
  }
  function wcCreds() {
    return typeof globalThis.wcagFetchCredentials === 'function' ? globalThis.wcagFetchCredentials() : 'same-origin';
  }

  async function onSubmit(e) {
    e.preventDefault();
    err = '';
    ok = '';
    submitting = true;
    const form = e.currentTarget;
    const fd = new FormData(form);
    const body = {
      name: String(fd.get('name') || '').trim(),
      company: String(fd.get('company') || '').trim(),
      email: String(fd.get('email') || '').trim(),
      phone: String(fd.get('phone') || '').trim(),
      message: String(fd.get('message') || '').trim(),
      token,
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
      ok = data.emailed
        ? 'Thanks — we received your request and emailed our team.'
        : 'Thanks — we received your request.';
      form.reset();
    } catch {
      err = 'Network error — try again in a moment.';
    } finally {
      submitting = false;
    }
  }
</script>

<div class="card guest-lead" id="lead-form">
  <h2>Get a full WCAG audit from Us</h2>
  <p class="muted guest-lead-intro">
    We’ll review the findings with you and quote remediation or an accessibility statement. No obligation.
  </p>
  <form onsubmit={onSubmit}>
    <input type="hidden" name="token" value={token} />
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
    {#if err}
      <p class="guest-lead-msg guest-lead-msg-err">{err}</p>
    {/if}
    {#if ok}
      <p class="guest-lead-msg guest-lead-msg-ok">{ok}</p>
    {/if}
    <button type="submit" class="btn btn-grad btn-lg" disabled={submitting}>
      {submitting ? 'Sending…' : 'Request WCAG services'}
    </button>
  </form>
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
  .guest-lead-msg-ok {
    color: var(--us-mint-text);
  }
</style>
