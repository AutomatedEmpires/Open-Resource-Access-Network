# ADR-0014: Durable Fail-Closed Account Erasure

## Status

Accepted

## Context

The former self-service deletion route performed an unbounded synchronous set of
database mutations, did not delete the Clerk identity, and could remove the
profile that authorization used while leaving enough identity state for the
ordinary new-user path to recreate access. Partial provider or database failures
had no durable request ledger or safe retry boundary.

ORAN has identity references across relational attribution columns, private
operational tables, embedded JSON/text evidence, user-owned state, and preserved
governance records. A safe erasure must revoke access immediately, finish across
serverless invocations, remain idempotent, preserve non-personal public/resource
integrity, and never claim completion while a concurrent writer is reintroducing
the identity.

## Decision

Adopt a database-coordinated erasure workflow with these invariants:

1. Queueing is atomic and fail-closed. It freezes the ORAN profile, stores hashed
   identity blocks, creates an immutable 72-step ledger, and gives at most one
   worker the initial lease.
2. Clerk deletion is part of the durable workflow. Provider 404 means the desired
   state already exists; other failures use bounded retry/backoff.
3. Database work is a fixed, non-dynamic `SECURITY DEFINER` dispatcher. Each
   transaction processes one bounded primary-key page behind captured high-water
   state and the platform's established advisory-lock order.
4. User-only state is deleted. Identity attribution and embedded identity
   fragments in records that must survive are replaced with request-specific
   tombstones.
5. Completion requires a later no-change verification pass. Persistent writer
   reintroduction blocks for operator review.
6. Authentication checks the durable erased-identity digest when a profile is
   absent, so profile deletion cannot reactivate the ordinary first-login path.
7. The capability remains dark until a fixed 128-index online build is verified
   against exact schema/table targets by tracked migration `0072`.
8. Private request, step, block, and gate tables receive no direct backend table
   grants. Raw identity values are cleared from completed requests and omitted
   from public audit payloads.

## Consequences

- A 202 response is a durable accepted state with access already revoked, not a
  completed-erasure claim.
- Rollout requires a controlled online index phase between migrations `0071` and
  `0072`; production migration history must not be advanced around that gate.
- Operators need monitoring and a blocked-request procedure. They must never
  manually mark a request complete without proving every fixed step is done and
  the identity-provider deletion is durable.
- Adding an identity-bearing table or column requires updating the fixed
  dispatcher, index manifest, executable regressions, and this privacy contract.

## Alternatives considered

- Keep synchronous route deletion: rejected because serverless deadlines and
  provider failures make partial, unrecoverable outcomes unavoidable.
- Soft-delete only the profile: rejected because it leaves personal state and
  permits authorization resurrection.
- Dynamic catalog-driven deletion: rejected because dynamic SQL broadens the
  privilege surface and cannot encode per-record preservation policy safely.
- Put the whole operation in one transaction: rejected because the lock and
  execution time would be unsafe for large production tables.

## Rollout and verification

- Static Vitest assertions cover manifest immutability, privilege boundaries,
  bounded paging, leases, gate semantics, and indexable selectors.
- Disposable PostgreSQL replays the full migration chain, proves `0072` fails
  before index preparation, builds the fixed index manifest, and then proves the
  gate passes.
- Executable workflow tests prove immediate revocation, Clerk completion
  precondition, two-pass completion, reintroduction rejection, and raw-identity
  removal. A 50,000-row plan regression proves matching-subset indexes are used.
- Production rollout and rollback follow
  `docs/ops/services/RUNBOOK_ACCOUNT_ERASURE.md`.

Timestamp: 2026-07-19T00:00:00Z
