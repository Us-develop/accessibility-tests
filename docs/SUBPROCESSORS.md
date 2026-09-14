# Subprocessors

Processors that may handle personal data for the Us accessibility scanner. Contact the controller named in the [Privacy Notice](/privacy) for questions.

| Processor | Role | Typical location |
| --- | --- | --- |
| OVH | Virtual private server hosting the app | EU |
| Postgres host | Account, scan metadata, consents, billing records | Same VPS unless `DATABASE_URL` points elsewhere |
| SMTP provider | Transactional mail (verify, reset, lead notify) | Depends on `SMTP_*` configuration |
| Stripe | Payments, invoicing, VAT/tax, customer portal | EU with possible US support staff |
| Cloudflare Turnstile | Bot challenge on guest scans when enabled | Global / US |
| Anthropic | Optional WCAG coverage write-up when `ANTHROPIC_API_KEY` is set | US |
| Atlassian | Optional Jira OAuth when a staff user connects a project | EU/US |

We do not use a third-party webfont CDN. Typefaces are self-hosted.

<!-- COUNSEL: confirm each processor’s DPA and transfer tool before go-live. -->
