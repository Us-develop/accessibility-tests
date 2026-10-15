<script>
  import { t } from '../../../i18n/index.mjs';

  /** @type {{ severity: 'error' | 'warning' | 'passed' | 'notice', lang?: string }} */
  let { severity, lang = 'en' } = $props();

  const map = {
    error: { cls: 'tag-error', dot: 'error' },
    warning: { cls: 'tag-warning', dot: 'warning' },
    passed: { cls: 'tag-success', dot: 'success' },
    notice: { cls: 'tag-info', dot: 'notice' },
  };
  const key = $derived(map[severity] ? severity : 'notice');
  const m = $derived(map[key]);
</script>

<span class="tag {m.cls}"><span class="dot dot-{m.dot}"></span>{t(lang, `severity.${key}`)}</span>
