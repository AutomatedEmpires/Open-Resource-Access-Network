# Scripts

Repository automation scripts.

## What's here

- `azure/`: Azure-first operational scripts and documentation
- `provision-owner-access.mjs`: Bootstrap or upgrade primary/backup privileged operator accounts plus an owner organization. Requires `DATABASE_URL`. Can also set or rotate a password hash on an existing Entra-backed profile without changing the underlying `user_id` or removing Entra sign-in. Phone values are stored as credentials login identifiers only; ORAN does not currently implement SMS/OTP 2SV in-app.
