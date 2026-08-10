# Secrets Management

Scope: where PlayaPost secrets live, how to retrieve them on this box, and where they get staged locally. This document contains names, paths, and non-secret identifiers only — it must never contain an actual secret value.

## 1. Where Secrets Live

All secrets are stored in 1Password, vault **"My LangWatch Agents"**.

| Item | Field | Contents |
|---|---|---|
| `Supabase PlayaPost API TOKEN` | `credential` | Supabase personal access token (`sbp_...`) |
| `Supabase Postgres DB Password` | `password` | Postgres database password |
| `PERSONAL_RENDER_API_KEY` | `credential` | Render API key, workspace "drewdrewthis's Workspace" — the backend host (ADR-0009) |
| `Playa Post VAPID Push Keys` | `publicKey`, `privateKey`, `contact` | The Web Push application server key pair (RFC 8292) and the operator contact URI. `publicKey` and `contact` are **not** secrets; they live here anyway because the pair rotates as one — see §4 |
| `Cloudflare PlayaPost API TOKEN` | `credential` | Cloudflare API token, account "Drewdrewthis@gmail.com's Account". **Unused by the deploy path** — see the note below |

> **The Cloudflare token is retained but unused.** It was provisioned for the Cloudflare Worker API
> target that ADR-0009 retired. It stays in 1Password pending owner cleanup: nothing in this repository
> reads it, and the static frontend's hosting is a separate question ADR-0009 does not decide. Do not
> wire it into CI or a deploy on the assumption it is still load-bearing.

## 2. Retrieval (On This Box)

Two-step pattern: load the service account token into the environment, then read the item via its `op://` path.

```bash
export OP_SERVICE_ACCOUNT_TOKEN="$(cat /home/ubuntu/.secrets/op-service-account.token)"
op read "op://My LangWatch Agents/<item>/<field>"
```

Nuance: the service account requires `--vault` on `op item get`, but not on `op read` when given a full `op://` path. Prefer `op read` with the full path for this reason.

Worked examples (each command produces the value; it is not shown here):

```bash
export OP_SERVICE_ACCOUNT_TOKEN="$(cat /home/ubuntu/.secrets/op-service-account.token)"

op read "op://My LangWatch Agents/Supabase PlayaPost API TOKEN/credential"
op read "op://My LangWatch Agents/Supabase Postgres DB Password/password"
op read "op://My LangWatch Agents/PERSONAL_RENDER_API_KEY/credential"
op read "op://My LangWatch Agents/Cloudflare PlayaPost API TOKEN/credential"

op read "op://My LangWatch Agents/Playa Post VAPID Push Keys/publicKey"
op read "op://My LangWatch Agents/Playa Post VAPID Push Keys/privateKey"
op read "op://My LangWatch Agents/Playa Post VAPID Push Keys/contact"
```

## 3. Local Staging

Retrieved values are staged in `.env.local` at the repo root. This file is gitignored and must be `chmod 0600`.

| Key | Source / Notes |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | From "Supabase PlayaPost API TOKEN" / `credential` |
| `SUPABASE_DB_PASSWORD` | From "Supabase Postgres DB Password" / `password` |
| `SUPABASE_PROJECT_REF` | `raiemsytiokplvmoqsze` — project ref/identifier, not a secret |
| `SUPABASE_URL` | Project API URL. **Not a secret**, and the one key here the running server also reads: it derives the JWKS endpoint it verifies access tokens against from this value (ADR-0011). Committed in `render.yaml` as a plain value — see §4 |
| `SUPABASE_ANON_KEY` | Project anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Project service role key |
| `RENDER_API_KEY` | From `PERSONAL_RENDER_API_KEY` / `credential`. Needed only to drive the Render API or CLI (`render blueprint launch`); the running service never reads it |
| `CLOUDFLARE_API_TOKEN` | From "Cloudflare PlayaPost API TOKEN" / `credential`. Retained, unused — see §1 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier. Retained, unused — see §1 |
| `VAPID_PUBLIC_KEY` | From "Playa Post VAPID Push Keys" / `publicKey`. Read by the server; the **same** value is the browser's `VITE_VAPID_PUBLIC_KEY` |
| `VAPID_PRIVATE_KEY` | From "Playa Post VAPID Push Keys" / `privateKey`. Secret |
| `VAPID_CONTACT` | From "Playa Post VAPID Push Keys" / `contact`. The `mailto:`/`https:` URI a push service reaches the operator at |
| `VITE_VAPID_PUBLIC_KEY` | The same value as `VAPID_PUBLIC_KEY`, staged in `apps/web/.env.local` for the browser build. Public by construction — Vite inlines every `VITE_`-prefixed key into the bundle |

Supabase project identity (identifiers, not secrets): project **PlayaPost**, ref `raiemsytiokplvmoqsze`, region `eu-west-3`.

## 4. Rules

- Never echo, log, or commit secret values. This document itself contains names and paths only, never values.
- Deployment secrets go to platform secret stores (Render environment variables, GitHub Actions secrets), never to source control. See `architecture-addendum.md` §17.
- In `render.yaml`, a secret is declared as a `key` with `sync: false` and its value is entered in the Render dashboard. A value in the blueprint is a value in git.
- **`SUPABASE_URL` is the deliberate exception, and is committed with its value.** It identifies a project rather than authenticating to one (§3), and it is the string that decides whose users the API accepts (ADR-0011) — a decision that belongs in a reviewable pull request, not in dashboard state. Do not "fix" it into a `sync: false` entry.
- **The VAPID trio is all-or-none, and its public half stays in the secret store anyway.** `packages/configuration` refuses a partial set at boot, naming the missing keys; with none set the server boots on the unconfigured push transport and never schedules the notification flush. `VAPID_PUBLIC_KEY` is not a secret — the browser subscribes with it and Vite inlines it into the bundle — but it is one half of a **key pair**, so committing it to `render.yaml` the way `SUPABASE_URL` is committed would fork rotation into two places that can half-apply. A public key whose private half has rotated is a subscription nobody can push to, with nothing in any log saying why. The pair travels together: rotate the 1Password item, then update `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_CONTACT` on the server and `VITE_VAPID_PUBLIC_KEY` on the frontend **in the same pass**, and re-subscribe every device (an existing subscription is bound to the old key).
- **The project's legacy HS256 JWT secret is retired and is not needed anywhere.** The project signs access tokens with asymmetric keys; the server verifies against the published JWKS and holds no signing material at all (ADR-0011). Nothing in this repository reads a shared JWT secret — if you find yourself hunting for one, the thing you actually want is `SUPABASE_URL`.
- Rotation procedure: update the 1Password item first, then re-run the retrieval commands in §2 to refresh `.env.local`.
