# Secrets Management

Scope: where PlayaPost secrets live, how to retrieve them on this box, and where they get staged locally. This document contains names, paths, and non-secret identifiers only — it must never contain an actual secret value.

## 1. Where Secrets Live

All secrets are stored in 1Password, vault **"My LangWatch Agents"**.

| Item | Field | Contents |
|---|---|---|
| `Supabase PlayaPost API TOKEN` | `credential` | Supabase personal access token (`sbp_...`) |
| `Supabase Postgres DB Password` | `password` | Postgres database password |
| `Cloudflare PlayaPost API TOKEN` | `credential` | Cloudflare API token, under account "Drewdrewthis@gmail.com's Account" |

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
| `CLOUDFLARE_API_TOKEN` | From "Cloudflare PlayaPost API TOKEN" / `credential` |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier |

Supabase project identity (identifiers, not secrets): project **PlayaPost**, ref `raiemsytiokplvmoqsze`, region `eu-west-3`.

## 4. Rules

- Never echo, log, or commit secret values. This document itself contains names and paths only, never values.
- Deployment secrets go to platform secret stores (Cloudflare dashboard/Wrangler secrets, GitHub Actions secrets), never to source control. See `architecture-addendum.md` §17.
- Rotation procedure: update the 1Password item first, then re-run the retrieval commands in §2 to refresh `.env.local`.
