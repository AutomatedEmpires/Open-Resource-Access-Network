# ORAN Roadmap — single Project board (one board for everything)

**Project (ORAN Roadmap):** https://github.com/users/AutomatedEmpires/projects/3

This runbook is meant to be “do these two things once, then everything just works.”

---

## Fast fix (if the workflow is failing right now)

If the Action log says “PROJECT_TOKEN cannot access the ORAN Roadmap Project”, you only need to do this:

1. Create a token that has **Projects** permission (account-level).
2. Paste it into the repo secret named `PROJECT_TOKEN`.
3. Re-run the workflow.

Most common confusion:
- Setting `export GH_TOKEN=...` in your terminal does **nothing** for GitHub Actions.
- GitHub Actions only reads the repo secret at: https://github.com/AutomatedEmpires/Open-Resource-Access-Network/settings/secrets/actions

---

## What you are trying to achieve

```
Issues / PRs get labels  ──▶  GitHub Action runs  ──▶  Project fields update
           (SSOT)                    (automation)            (derived)
```

- **Labels are the SSOT** for triage (humans + agents apply labels).
- The Project is a **view of that label state**, so the board stays clean.
- The Action needs a token because `GITHUB_TOKEN` typically cannot write to **user-owned** Projects v2.

---

## One-time setup (2 steps)

### Step 1 — Create a scoped token (PAT)

You have two options. Use **Option A** if you can; it’s the most “scoped.”

#### Option A (preferred): Fine-grained PAT

Open: https://github.com/settings/personal-access-tokens

Then:
1. Click **Generate new token** → **Fine-grained token**.
2. **Token name:** `ORAN Project Sync` (anything is fine).
3. **Expiration:** pick something reasonable (e.g., 90 days) so it rotates.
4. **Resource owner:** choose the account that can edit the Project.
   - The ORAN Roadmap Project is under `users/AutomatedEmpires`, so you generally want the owner account to be `AutomatedEmpires`.
5. **Repository access:** select *only* this repo (recommended), or “All repositories” if you must.
6. **Permissions:**
   - **Account permissions**
     - **Projects**: **Read and write**
   - **Repository permissions**
     - **Issues**: **Read and write**
     - **Pull requests**: **Read and write**
     - (If you don’t see these exact toggles, pick the closest equivalents; GitHub’s UI labels shift over time.)
7. Generate token and copy it.

#### Option B (fallback): Classic PAT

Use this only if fine-grained doesn’t expose Projects permissions for you.

Open: https://github.com/settings/tokens/new

Select scopes:
- `project`
- plus enough repo scopes to read issues/PRs (often `repo` for private repos, or none for public repos)

Generate token and copy it.

✅ You’re done when you have a token string that starts with something like `github_pat_...` (fine-grained) or `ghp_...` (classic).

Important: “max read/write scoped to this repository” is NOT enough for Projects v2.
This Project is user-owned (`users/AutomatedEmpires`), so the token must include **Account permissions → Projects (read/write)** (or classic scope `project`).

---

## Token self-test (2 minutes, optional but recommended)

This lets you confirm the token can “see” the Project *before* you store it as `PROJECT_TOKEN`.

If CLI feels annoying: skip this section and just use the workflow run logs — they will explicitly tell you if the token can’t access the Project.

1. In a terminal, temporarily export the token (don’t paste it into chat):

- `export GH_TOKEN='<paste token here>'`

2. Run a Projects query (in Codespaces, strip injected tokens so your GH_TOKEN is used):

- `env -u GITHUB_TOKEN -u GH_TOKEN gh api graphql -f query='query($id:ID!){ node(id:$id){ __typename ... on ProjectV2 { title } } }' -F id='PVT_kwHODJLGp84BQzJl'`

Expected success output:
- `__typename` is `ProjectV2` and you see a `title`.

If you see an error like “Resource not accessible by personal access token”, the token is missing Projects permission (fix Step 1).

3. Clean up:

- `unset GH_TOKEN`

---

## Security note (important)

If you ever paste a token into chat, screenshots, or logs, assume it’s compromised.
- Revoke it immediately: https://github.com/settings/personal-access-tokens
- Generate a new one and update `PROJECT_TOKEN` again.

---

### Step 2 — Add the token as a repo secret

Open your repo’s Actions secrets page:

- https://github.com/AutomatedEmpires/Open-Resource-Access-Network/settings/secrets/actions

Then:
1. Click **New repository secret**.
2. **Name:** `PROJECT_TOKEN`
3. **Secret:** paste the token from Step 1.
4. Save.

✅ You’re done when the secret exists and is named exactly `PROJECT_TOKEN`.

---

## Verify it’s working (30 seconds)

1. Open the workflow page:
   - https://github.com/AutomatedEmpires/Open-Resource-Access-Network/actions/workflows/project-sync.yml
2. Click **Run workflow**.
  - Default mode is `backfill-open` (adds/syncs up to `limit` recently-updated open issues/PRs).
  - If you want to test one item only, set:
    - `mode`: `single`
    - `kind`: `issue` or `pr`
    - `number`: the issue/PR number
3. Open an issue, add a label like `status:in-progress`, and confirm:
   - the issue is added to the Project
   - Project **Status** becomes `In progress`

If it doesn’t update, jump to Troubleshooting below.

---

## Views (manual UI step — unavoidable)

The public API available here doesn’t let us create/rename Project views programmatically, so do this once in the UI:

1. Open the Project: https://github.com/users/AutomatedEmpires/projects/3
2. Rename the existing view `View 1` → `Table`.
3. Create a new view → choose **Board**.
4. In the Board view, set **Group by → Status**.

That’s it — fields/labels are still automated.

---

## Label → Project field mapping (SSOT)

- `area:<x>` → Project **Area** = `<x>`
- `risk:<x>` → Project **Risk** = `<x>`
- `size:<x>` → Project **Size** = `<x>`
- `priority:P0|P1` → Project **Priority** = the option starting with `P0`/`P1` (e.g., `P0 - Critical`)
- `status:<x>` → Project **Status** (single-select)
  - `needs-info` → `Needs info`
  - `ready` → `Ready`
  - `in-progress` → `In progress`
  - `needs-review` → `Needs review`
  - `blocked` → `Blocked`
  - closed issue/PR → `Done`

---

## Automation (what runs)

Workflow file: `.github/workflows/project-sync.yml`

Triggers:
- issue + PR open/edit/label/unlabel/close
- manual run (`workflow_dispatch`)

What it does:
- Ensures the issue/PR is in the Project.
- Updates Project fields based on the label prefixes above.

Safety:
- If `PROJECT_TOKEN` is missing, it exits early and does nothing (by design).

---

## Troubleshooting

### “I can’t find Projects permissions on fine-grained tokens”

- Try classic PAT (Option B) with `project` scope.
- Confirm you’re creating the token from the same GitHub account that has write access to the Project.

### “Workflow runs but does nothing”

- Confirm `PROJECT_TOKEN` secret exists and is spelled exactly.
- Look at the workflow run logs — you should see it either:
  - exit early due to missing secret, or
  - perform “add to project” + “update field” operations.

### “Resource not accessible by personal access token”

This means the token does not have Projects access.

- Regenerate `PROJECT_TOKEN` so it has:
  - Fine-grained: **Account permissions → Projects: Read and write**
  - or Classic: scope `project`
- Make sure the token’s owner can access the Project at https://github.com/users/AutomatedEmpires/projects/3

### Codespaces / CLI weirdness (“Resource not accessible by integration”)

This only affects local `gh api` calls; it does not affect GitHub Actions.
Codespaces injects `GITHUB_TOKEN` which can force “integration-like” auth.

Prefer:

- `env -u GITHUB_TOKEN -u GH_TOKEN gh api graphql ...`

