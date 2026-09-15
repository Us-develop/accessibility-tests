# Brevo transactional templates

Author one template per mail kind in the Brevo dashboard. The app sends recipient, `templateId`, and `params` only. Design and copy live in Brevo.

Use `{{ params.name | default: "there" }}` (and the same `default` filter on any other param that may be empty). Every param listed below is always sent; unknown values are `''` so templates can rely on `default`.

Show security links as both a button and a visible plain URL. State the expiry in the body. Do not add an unsubscribe link or marketing content. Host images on the product domain (`PUBLIC_BASE_URL`). The sender must be an authenticated domain in Brevo.

Disable **open tracking** and **click tracking** on every template (template settings). Verification and reset links must not be rewritten, and transactional mail is not tracked. The app never enables tracking in the API call.

| Kind | Env | Params |
| --- | --- | --- |
| `verify` | `BREVO_TEMPLATE_VERIFY` | `name`, `email`, `link`, `expiresIn` (`48 hours`), `customerType` |
| `reset` | `BREVO_TEMPLATE_RESET` | `name`, `link`, `expiresIn` (`2 hours`) |
| `email-change` | `BREVO_TEMPLATE_EMAIL_CHANGE` | `name`, `newEmail`, `link`, `expiresIn` (`48 hours`) |
| `email-change-notice` | `BREVO_TEMPLATE_EMAIL_CHANGE_NOTICE` | `name`, `newEmail` |
| `run-notification` | `BREVO_TEMPLATE_RUN_DONE` | `domain`, `runId`, `reportUrl`, `status` (`done` or `error`), `score` (number or `''`), `pagesScanned` (number), `issueCount` (number), `error` |
| `lead` | `BREVO_TEMPLATE_LEAD` | `name`, `company`, `email`, `phone`, `message`, `scannedUrl`, `domain`, `score`, `teaserUrl` |
| `access-request` | `BREVO_TEMPLATE_ACCESS_REQUEST` | `name`, `company`, `email`, `message` |

Lead and access-request mail go to `ACCESS_REQUEST_TO`, with `replyTo` set to the submitter.
