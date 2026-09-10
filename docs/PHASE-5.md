# Phase 5 — Operations: Maintenance, Staff, Documents, Notifications & Audit

What was built, the decisions behind it, and what deliberately was not built.
Design: [`BLUEPRINT.md`](BLUEPRINT.md) §16–§17, §21.

## Outcome

The day-to-day layer. Raise a maintenance job and drive it through a real
workflow; invite staff and decide which properties each of them can see; upload
documents and get them back only through an authorized download; receive in-app
alerts; and read an audit trail that nothing in the product can edit.

## The upload validation chain

This is the sharpest security surface in the project, so it fails closed at
every step and in this order — each check cheaper than the next:

1. **Size** — against the buffer's real length, not the client's `size` field.
2. **Extension** — against an allow-list of nine document and image types.
3. **Declared MIME** — must be allow-listed *and* consistent with the extension.
4. **Magic bytes** — the first bytes of the actual buffer. This is the step a
   renamed script fails, and the only one that cannot be lied to.
5. **Generated storage key** — `org/{orgId}/{yyyy}/{mm}/{uuid}{ext}`. User
   input never contributes to it, so path traversal is not defended against so
   much as made impossible.
6. **SHA-256 checksum** — stored, so a swapped or corrupted object is detectable.
7. **Linked record** — verified to exist inside the caller's organization *and*
   inside their property scope, before a byte is written.

`../../../etc/passwd.pdf` is accepted and neutralised rather than refused: the
display name becomes `passwd.pdf`, and the stored key contains neither the
traversal nor the name. A `.pdf` whose contents are `<?php …>` is refused with a
422, and the refusal is written to the audit trail — repeated content
mismatches from one account is what an attempted upload attack looks like from
the inside.

## Getting a document back out

There is no public URL, no static mount and no endpoint that returns a storage
key. The only path to a byte is `GET /documents/:id/download`, which runs
session → permission → organization → property scope, then streams with:

```
Content-Disposition: attachment; filename="…"
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'none'; sandbox
```

Those three headers are why an uploaded file cannot become an XSS in the app
origin. The browser fetches through the API client with the session cookie — a
plain `<a href>` would be an anonymous request and get a 401, which is the
point.

## Decisions worth knowing

| Decision | Why |
|---|---|
| **COMPLETED and CANCELLED are terminal** | A fault that comes back is a new request. That way each job carries its own cost, its own timeline and its own duration, and "how long did this take" has an answer that does not need unpicking reopenings |
| Transitions come from a **table**, not from the request | A request cannot jump from pending to completed, and the UI only offers moves the API will accept — a button that returns 409 teaches people to distrust the buttons |
| **Every status change writes a timeline row** | The history of a job is a table of rows, not a column that remembers only its latest value. "Who marked this done, and when" always has an answer |
| `completedAt` and `COMPLETED` are **enforced to agree** | A CHECK constraint, not a convention. Two sources of truth for "is this finished" is how a report starts disagreeing with the board it was built from |
| Completing a job **does not create an expense** | It may be paid later, in a different amount, by a different method — and auto-creating one would double-count the moment somebody also records it by hand. The screen says so and points at Expenses |
| **SUPER_ADMIN is not assignable** | It is a platform role. A dropdown that granted it would be a privilege-escalation path in the shape of a form field |
| Nobody may **act on their own account** | No changing your own role, no deactivating yourself, no deleting yourself. An admin locking themselves out is a support ticket; an admin quietly promoting themselves is a breach |
| The **last active owner** is protected | Demote, deactivate or delete is refused. An organization with nobody who can administer it is unrecoverable |
| Deactivation **revokes every session** | Otherwise access ends whenever the cookie happens to expire, which is not what "deactivate" means |
| Property assignments are a **PUT, not a PATCH** | The array is the whole set, and an empty array means "sees nothing" — a real instruction, not a half-finished form. The UI spells that out before saving |
| The **invite link is returned once** | Email is not delivered in V1, so a link that only went to the server log would leave an owner unable to onboard anyone. It goes to an authenticated caller holding `staff.create`, is never readable again, and the dialog says plainly that nothing was sent |
| Notification recipients respect **permission and scope** | An alert is a disclosure: telling a caretaker that unit 4B owes 30,000 tells them what 4B pays. Recipients are resolved the same way a request is authorized |
| **One alert per fact per day** | A partial unique index on `(organizationId, userId, dedupeKey)`, so a re-run, a restart mid-sweep or two racing workers all produce one row |
| Notifications **poll every 60 seconds** | A WebSocket for a number that changes a few times a day is operational cost with no user-visible benefit. The contract can become SSE without touching callers |
| The audit trail is **read-only over HTTP** | There is no create, update or delete route. A trail an operator can edit is not a trail |
| The audit read **omits IP and user agent** | Both are stored for an incident investigation. Returning them would turn a staff screen into a list of colleagues' IP addresses |

## Invariants the database enforces

```sql
CREATE UNIQUE INDEX "Notification_org_user_dedupeKey_key"
  ON "Notification" ("organizationId", "userId", "dedupeKey")
  WHERE "dedupeKey" IS NOT NULL;

ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_completed_has_date"
  CHECK (("status" = 'COMPLETED' AND "completedAt" IS NOT NULL)
      OR ("status" <> 'COMPLETED' AND "completedAt" IS NULL));

ALTER TABLE "MaintenanceRequest" ADD CONSTRAINT "MaintenanceRequest_costs_non_negative" …
ALTER TABLE "Document" ADD CONSTRAINT "Document_checksum_is_sha256"
  CHECK ("checksum" ~ '^[0-9a-f]{64}$');
ALTER TABLE "Document" ADD CONSTRAINT "Document_entity_id_required"
  CHECK ("entityType" = 'ORGANIZATION' OR "entityId" IS NOT NULL);
```

The suite proves each of them by bypassing the service and writing directly —
PostgreSQL refuses.

## Two real bugs this phase's tests caught

**A staff invite could not be accepted.** `POST /staff` created the account as
`INVITED` and issued a set-password link, but `resetPassword` left the status
alone and login refuses anything that is not `ACTIVE`. The whole onboarding flow
dead-ended at a 403. Accepting an invite now promotes `INVITED` → `ACTIVE`, and
**only** `INVITED` — a stale link must never let a deactivated or suspended
account reactivate itself. The test walks the entire journey: invite → accept →
sign in → see exactly the assigned property.

**A cross-organization maintenance request returned 409, not 404.** The scope
check only narrows a property-scoped user, so an unrestricted owner reached the
composite foreign key instead, which refused the insert with "that would break a
link to another record" — safe, but it names a constraint rather than saying the
property is not theirs. Reading through the scoped client first makes it the
same 404 as every other cross-organization reference.

A third, smaller one: the **finance seed was not idempotent**. Receipt numbers
came from a run-local counter that restarted at zero, so the first re-run that
created any new payment reissued a number the unique index had already taken.
Numbers are now derived from `(lease, period)` and the live counter is advanced
past the highest one actually used, not past one the seed assumed it would use.

## Test coverage added

**Unit** — 23 new (132 total): the entire upload validation chain against the
inputs an attacker actually sends (a PHP script named `.pdf`, an SVG, an
executable, a traversing filename, a client lying about `size`), filename
sanitisation including the newline that would split a `Content-Disposition`
header, and the maintenance transition table exhaustively, including that no
status can transition to itself and nothing escapes a terminal state.

**Integration** — a new `operations.e2e-spec.ts` of 41 tests, plus operations
rows added to the isolation, permission and property-scope suites (340 total):

- Maintenance: workflow walk with the timeline asserted step by step, refused
  jump to completed, refused reopen, refused edit after closing, unassignment
  moving back to pending, board counts, and both CHECK constraints proven by
  direct write
- Documents: real PDF stored with checksum and generated key; script, SVG and
  executable refused; traversing filename neutralised; rejected upload audited;
  missing record refused; cross-organization attach refused; exact bytes back
  with all three security headers; anonymous 401; cross-organization 404 on both
  metadata and download; delete removing row **and** object from disk
- Staff: invite → accept → sign in journey; SUPER_ADMIN refused; self-role and
  self-deactivation refused; last-active-owner protected against demote,
  deactivate and delete (exercised through a platform super admin, the only
  caller who can reach it); manager can see staff but change nothing;
  assignment set replacement including empty; deactivation ending live sessions
  in the same request
- Notifications: reaches the assignee and not the actor; three actions on the
  same fact collapse to one row; another user in the same organization cannot
  mark it read; unread count
- Audit: recorded, newest first, no IP or user agent returned, action list
  reflects reality, no write surface exists at all, refused without the
  permission

**End-to-end** — 5 Playwright journeys on desktop and mobile: a job from
reported to done with its timeline; a document filed against a property and
downloaded back; a disguised script refused at the dialog; a staff invite with
the one-time link handed over and a property assigned; and the audit trail
showing what happened with no way to change it.

Full suite: 132 unit, 340 integration and 58 Playwright tests (one mobile-only,
skipped on desktop), all passing.

## Screens

`/maintenance` (status board that filters the table below it), `/maintenance/[id]`
(timeline, assignment, only-valid-transition buttons), `/staff` (roles,
assignments, activate/deactivate, the invite-link handoff), `/documents`,
`/notifications`, a topbar unread badge, and an audit-log panel on Settings.
Documents also appear as a tab on the property and tenant pages, where the
records they describe live. The Phase-1 read-only `/users` directory is gone —
`/staff` does everything it did and more.

## Not built in Phase 5

Stated plainly rather than stubbed:

- **No email, SMS or WhatsApp delivery.** The provider ports exist and are
  injected; the V1 adapters log and do not send. Nothing in the UI claims a
  message went out — the staff screen says so in as many words
- **No S3 storage.** `FileStorageProvider` has one adapter, writing to a local
  volume. Switching is an environment variable and a DI binding
- **No document versioning, preview or thumbnails.** Upload, download, delete
- **No virus scanning.** Magic-byte sniffing is not an antivirus, and V1 does
  not pretend otherwise. A ClamAV step would slot into the same chain
- **No maintenance → expense automation**, deliberately, per the table above
- **No bulk staff import, no custom roles.** The six system roles, one per user
- **No orphan-object cleanup job.** A failed row write deletes its object
  inline; a crash between the two leaves an orphan that nothing yet sweeps
- **No notification preferences.** Everyone who may see a thing is told about it

## Verified on

PostgreSQL 16, Node 22, `pnpm 9`. Migrations `20260910073103_operations` and
`20260910073200_operations_invariants` applied cleanly to an empty database and
on top of Phase 4, with every constraint and the partial unique index confirmed
present afterwards.
