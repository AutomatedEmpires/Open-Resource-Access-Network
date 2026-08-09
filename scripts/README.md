# Scripts

Repository automation scripts.

## What's here

- `provision-owner-access.mjs`: Bootstrap or upgrade primary/backup privileged operator accounts plus an owner organization. Requires `DATABASE_URL` and explicit Clerk user IDs. It never links identities by email and never handles passwords.
