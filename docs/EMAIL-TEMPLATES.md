# E-mail templates

The app sends nine kinds of e-mail, each in Dutch or English. This page lists what each mail is for, who gets it, in which language, and the **params** its Brevo template receives. The app sends the recipient, the template id and these params; the design and the copy live in Brevo.

The texts the app sends itself over SMTP, when a mail has no Brevo template, are in [`i18n/mail.nl.mjs`](../i18n/mail.nl.mjs) and [`i18n/mail.en.mjs`](../i18n/mail.en.mjs). Use them as the starting point for the template copy. The code that builds the params is [`server/mail-messages.mjs`](../server/mail-messages.mjs); `tests/mail.test.js` checks that this page and the code agree.

## Templates and language

Make one template per mail and per language, for example `WCAG | New lead_NL` and `WCAG | New lead_EN`. Each template id goes in its own environment variable, `BREVO_TEMPLATE_<KIND>_<LANG>` (see the table). The app picks the template in this order:

1. the template in the recipient's language;
2. the Dutch template;
3. the app's own text over SMTP;
4. no mail, with a line in the log.

Until the Brevo connection is merged, every mail takes step 3.

The recipient's language is:

- **account mails**: the language stored on the account. It is set at signup and follows the language switch while signed in. Accounts from before this change have none and get Dutch until they switch once;
- **lead and lead confirmation**: the language of the visitor who filled in the form. The team mail uses it too, so the team sees which language to answer in;
- **run notification**: the language the scan was started in, like its report.

## Params

Every param is a **string**, already formatted for the language ("48 uur", "72/100", "3 pagina's"), and every param is always sent. A value that is unknown is `''`, so a template can write `{{ params.firstName | default: "" }}`.

Every mail also gets:

| Param | Example |
| --- | --- |
| `lang` | `nl` or `en` |
| `siteUrl` | `https://wcag.about-us.be` |

| Kind | To | Template variables | Params |
| --- | --- | --- | --- |
| `verify` | the new account | `BREVO_TEMPLATE_VERIFY_NL`, `_EN` | `firstName`, `email`, `link`, `expiresIn` ("48 uur" / "48 hours") |
| `signup-existing` | an address that already has an account, when someone signs up with it | `BREVO_TEMPLATE_SIGNUP_EXISTING_NL`, `_EN` | `firstName` (of the existing account), `loginUrl`, `forgotUrl` |
| `reset` | the account | `BREVO_TEMPLATE_RESET_NL`, `_EN` | `firstName`, `link`, `expiresIn` ("2 uur" / "2 hours") |
| `email-change` | the new address | `BREVO_TEMPLATE_EMAIL_CHANGE_NL`, `_EN` | `firstName`, `newEmail`, `link`, `expiresIn` ("48 uur" / "48 hours") |
| `email-change-notice` | the old address | `BREVO_TEMPLATE_EMAIL_CHANGE_NOTICE_NL`, `_EN` | `firstName`, `newEmail`, `forgotUrl` |
| `run-notification` | the address a staff member entered when starting a scan | `BREVO_TEMPLATE_RUN_NOTIFICATION_NL`, `_EN` | `status` (`done` or `error`), `domain`, `reportUrl`, `score` ("72/100", '' on error), `pages` ("3 pagina's" / "3 pages"), `issues` ("12 problemen" / "12 issues"), `errorMessage` ('' when done), `runId` |
| `lead` | the Us team (`ACCESS_REQUEST_TO`), reply-to the visitor | `BREVO_TEMPLATE_LEAD_NL`, `_EN` | `name`, `company`, `email`, `phone`, `message`, `source`, `scannedUrl`, `domain`, `score` ("58/100" or ''), `teaserUrl`, `visitorLang` (`nl` / `en`) |
| `lead-confirmation` | the visitor who filled in the contact form, reply-to the team | `BREVO_TEMPLATE_LEAD_CONFIRMATION_NL`, `_EN` | `name`, `scannedUrl`, `message`, `teaserUrl` |

`firstName` is empty for accounts created before first and last name were asked separately. `teaserUrl`, `scannedUrl`, `domain` and `score` are empty when the lead did not come from a scan result. In `run-notification`, use `{% if params.status == "done" %}` to show the score or the error.

## Rules for every template

- **Turn off open and click tracking.** Brevo would otherwise rewrite the links, and the confirmation and reset links must reach the visitor unchanged. The app never asks for tracking.
- Show each security link (`link`) as a button **and** as the plain address, and say how long it works (`expiresIn`).
- `name`, `company`, `phone`, `message` and `email` are typed by visitors. Show them as text; never mark them as safe HTML.
- No unsubscribe link and no marketing content: these are service mails.
- Host images on the product domain (`siteUrl`), not on a third-party domain.
- The sender must be on the domain authenticated in Brevo (SPF, DKIM, DMARC).
- Dutch addresses the reader as "u".
