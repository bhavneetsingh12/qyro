# Security Hardening

This file is the current source of truth for security posture in QYRO.

## Completed

- Public Assist widget requests now require a signed widget token in addition to tenant-aware origin checks.
- Widget embed snippets now use `data-tenant-id` and `data-widget-token`, matching the live widget loader.
- Public widget chat and missed-call flows now enforce tenant daily budgets to reduce token and provider-cost abuse.
- Missed-call auto-reply now requires normalized E.164 phone input and applies a per-phone cooldown to reduce SMS spam and repeated sends.
- Internal cron webhooks now use timestamped HMAC signatures with replay detection instead of a static shared header comparison.
- Stripe webhook handling now captures raw request bytes correctly and rejects duplicate event IDs.
- API rate limiting now defaults to fail-closed in production.
- Admin routes now have explicit fail-closed rate limiting.
- API responses now send baseline security headers and HSTS in production.
- The API now trusts the platform proxy explicitly and uses proxy-resolved client IPs instead of directly trusting `x-forwarded-for`.
- Request body limits are now set on JSON and URL-encoded parsers.
- Production first-login auto-provisioning is now gated behind `ALLOW_PUBLIC_TENANT_PROVISIONING=true`.

## Current Defaults

- Public widget chat daily limit defaults to `250` requests per tenant per day.
- Public missed-call daily limit defaults to `25` requests per tenant per day.
- Missed-call cooldown defaults to `30` minutes per tenant + phone number.
- Widget token expiry defaults to `180` days.

These can be made tenant-configurable later if needed.

## Still Worth Hardening

- Clerk signup and tenant auto-provisioning are now environment-gated, but the long-term policy decision still matters. If you enable public provisioning, add invitation-only provisioning or stronger signup abuse controls before broader launch.
- Tenant integration secrets are encrypted at the application layer, but not yet moved to a managed KMS or envelope-encryption setup.
- Public widget protection is materially stronger than before, but a public website embed token is still a public artifact. If abuse pressure rises, add bot detection or CAPTCHA, plus a server-issued short-lived session token flow.
- High-impact admin actions do not yet require step-up authentication.
- There is not yet a dedicated automated security test suite covering widget abuse, webhook replay, billing replay, and admin escalation paths.

## Required Environment Notes

- `WEBHOOK_SECRET`: required for signed internal cron triggers.
- `WIDGET_SIGNING_SECRET`: recommended dedicated secret for widget token signing.
- `TENANT_INTEGRATION_SECRET_KEY`: still required for tenant secret encryption and used as widget-signing fallback if `WIDGET_SIGNING_SECRET` is absent.
- `ALLOW_PUBLIC_TENANT_PROVISIONING`: keep unset or `false` unless you intentionally want self-serve tenant creation in production.

## Launch Checklist

- Set `WIDGET_SIGNING_SECRET` in Railway for every API environment.
- Confirm widget allowed origins are configured for each Assist tenant.
- Re-copy the widget embed snippet from the client portal after token rotation or allowed-origin changes.
- Confirm Stripe webhook delivery succeeds after deploy.
- Confirm cron jobs are sending `x-webhook-timestamp` and `x-webhook-signature`.
