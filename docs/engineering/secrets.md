# Secrets Management

Scope: where PlayaPost secrets live, how to retrieve them on this box, and where they get staged locally. This document contains names, paths, and non-secret identifiers only — it must never contain an actual secret value.

## 1. Where Secrets Live

All secrets are stored in 1Password, vault **"My LangWatch Agents"**.

| Item | Field | Contents |
|---|---|---|
| `Supabase PlayaPost API TOKEN` | `credential` | Supabase personal access token (`sbp_...`) |
| `Supabase Postgres DB Password` | `password` | Postgres database password |
| `PERSONAL_RENDER_API_KEY` | `credential` | Render API key, workspace "drewdrewthis's Workspace" — the backend host (ADR-0009) |
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
```

## 3. Local Staging

Retrieved values are staged in `.env.local` at the repo root. This file is gitignored and must be `chmod 0600`.

| Key | Source / Notes |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | From "Supabase PlayaPost API TOKEN" / `credential` |
| `SUPABASE_DB_PASSWORD` | From "Supabase Postgres DB Password" / `password` |
| `SUPABASE_PROJECT_REF` | `raiemsytiokplvmoqsze` — project ref/identifier, not a secret |
| `SUPABASE_URL` | Project API URL |
| `SUPABASE_ANON_KEY` | Project anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Project service role key |
| `RENDER_API_KEY` | From `PERSONAL_RENDER_API_KEY` / `credential`. Needed only to drive the Render API or CLI (`render blueprint launch`); the running service never reads it |
| `CLOUDFLARE_API_TOKEN` | From "Cloudflare PlayaPost API TOKEN" / `credential`. Retained, unused — see §1 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier. Retained, unused — see §1 |

Supabase project identity (identifiers, not secrets): project **PlayaPost**, ref `raiemsytiokplvmoqsze`, region `eu-west-3`.

## 4. Rules

- Never echo, log, or commit secret values. This document itself contains names and paths only, never values.
- Deployment secrets go to platform secret stores (Render environment variables, GitHub Actions secrets), never to source control. See `architecture-addendum.md` §17.
- In `render.yaml`, a secret is declared as a `key` with `sync: false` and its value is entered in the Render dashboard. A value in the blueprint is a value in git.
- Rotation procedure: update the 1Password item first, then re-run the retrieval commands in §2 to refresh `.env.local`.
