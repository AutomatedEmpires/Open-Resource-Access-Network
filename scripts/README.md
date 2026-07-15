# Scripts

Repository automation scripts.

## What's here

- `azure/`: archived rollback-era operational scripts and documentation; do not use for new ORAN environments
- `provision-owner-access.mjs`: Bootstrap or upgrade primary/backup privileged operator accounts plus an owner organization. Requires `DATABASE_URL` and explicit Clerk user IDs. It never links identities by email and never handles passwords.
