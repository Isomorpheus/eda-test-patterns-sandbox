# InMemory Service Bus Demo

This document explains the sandbox demo in [src/demo.ts](../src/demo.ts) and the simulator in [src/inMemoryBus.ts](../src/inMemoryBus.ts).

It also documents the duplicate/idempotency demo in [src/demo-4-duplicates-idempotency.ts](../src/demo-4-duplicates-idempotency.ts).

Related docs:

- InMemoryBus internals: [docs/inMemoryBus.md](./inMemoryBus.md)

## Purpose

Use a local in-memory bus to practice event-driven patterns without Azure Service Bus.

Implemented concepts:

- `peekLock` receive mode
- Message settlement: `complete()`, `abandon()`, `deadLetter(reason)`
- Dead-letter queue (DLQ) per queue
- Optional duplicate simulation
- Run isolation first-gating (`applicationProperties.runId`)
- Receive deadline timing with a tiny stopwatch
- Simple diagnostics: seen count, last message, eventual seen checks

## Message shape

The demo uses this message structure:

- `messageId`
- `correlationId`
- `subject`
- `body`
- `applicationProperties`
  - `runId`
  - `schemaVersion`

## What the demo does

In [src/demo.ts](../src/demo.ts):

1. Creates `InMemoryBus` with lock duration of 15 seconds.
2. Sends 3 messages to queue `orders`:
   - `msg-1` with valid `schemaVersion=1.0`
   - `msg-2` with valid `schemaVersion=1.0`
   - `msg-3` with invalid `schemaVersion=0.9`
3. Creates a receiver in `peekLock` mode.
4. Log 1: receives 1 message and calls `complete()`.
5. Log 2: receives next message and calls `abandon()`.
6. Log 3: receives again to verify abandoned message is visible again, then calls `complete()`.
7. Log 4: receives the invalid message, validates schema, and calls `deadLetter(...)`.
8. Log 5: inspects and prints DLQ entries.
9. Log 6: enables duplicate simulation, sends `msg-4`, completes it once (duplicate is re-enqueued), receives duplicate, disables duplicate simulation, and completes duplicate.
10. Log 7: performs a final receive on an empty queue and polls in a loop until the static 2-second deadline.
11. Log 8: prints diagnostics summary (`seenCount`, `lastMessage`, `eventualSeen(...)`).
12. Log 9: runs a dedicated run-isolation demo with a predicate resolver:
  - `predicate(message)` is `message.applicationProperties.runId === activeRunId`
  - non-matching messages are blocked and not handled (`abandon()`)
  - the first matching message resolves the operation and is settled in one central success path (`complete()`)
  - the resolved message is returned from the predicate resolver
  - the foreign-run message is shown as still blocked on the next receive
13. Log 10: demonstrates timeout behavior for the predicate resolver:
  - no matching message is available for the active run
  - resolver throws timeout error with context
  - demo catches and logs the context

## Diagnostics

The demo now tracks and prints:

- `seenCount`: total deliveries seen by the receiver (includes retries/duplicates)
- `lastMessage`: most recently seen `messageId`
- `eventualSeen(messageId, minCount?)`: final boolean assertion that a message was observed enough times

Example checks in output:

- `eventualSeen(msg-2, 2)=true` (abandon + redelivery)
- `eventualSeen(msg-3)=true` (seen before dead-letter)
- `eventualSeen(msg-4, 2)=true` (original + duplicate)

## Demo 4: duplicates + idempotency-light

Sunday Block 4 is implemented in [src/demo-4-duplicates-idempotency.ts](../src/demo-4-duplicates-idempotency.ts).

Goal:

- Show duplicate delivery behavior.
- Show lightweight consumer-side idempotency with `seenMessageIds`.

### Duplicate simulation mechanism

The bus supports duplicate enqueue via `send(queueName, message, { simulateDuplicate: true })` in [src/inMemoryBus.ts](../src/inMemoryBus.ts).

When `simulateDuplicate` is true, the same message is enqueued twice (same `messageId`).

### Scenario A: Duplicate happy path

1. Create fresh `runId` and `correlationId`.
2. Send one message with `simulateDuplicate: true`.
3. Receive first delivery, treat as first-seen, `complete()`.
4. Receive second delivery (same `messageId`), detect duplicate via `seenMessageIds`, `complete()` and ignore business processing.
5. Print summary:
  - deliveries seen
  - duplicates ignored

### Scenario B: Duplicate via lock expiry (lock lost)

1. Create fresh `runId` and `correlationId`.
2. Send one normal message.
3. Receive once, but intentionally do not settle.
4. Wait past lock duration.
5. Receive same message again (redelivery), detect duplicate by `messageId`.
6. `complete()` the redelivery.
7. Print summary:
  - deliveries seen
  - duplicates ignored

### Why this maps to Azure Service Bus

- Scenario A models explicit duplicate delivery from producer/system behavior.
- Scenario B models redelivery after lock loss when a handler fails or times out before settlement.
- Together they demonstrate at-least-once delivery semantics and why idempotent consumers are needed.

### Logging in demo 4

Demo 4 logs include:

- `runId` and `correlationId` per scenario
- `messageId` on each delivery
- first-seen vs duplicate
- settlement action (`complete` or intentionally none)
- final per-scenario summary

The script also uses ANSI colors for readability in terminal output.

## Expected console behavior

You should see logs for:

- Demo/diagnostic prefixes (`[Demo] ...`, `[Diag] ...`)
- Visual separators between log sections (`[Demo] ------------------------------------------------------------`)
- Send operations
- Lock acquisition and lock expiry timestamps
- Completion and abandonment transitions
- Dead-letter action with reason
- DLQ count and item details
- Duplicate simulation toggling and duplicate delivery
- Run-isolation gate logs (`First gate BLOCKED/PASS ...`, blocked messages are not handled)
- Predicate resolver behavior (`if predicate(message) true -> resolve + settle (complete)`)
- Timeout with context (`Timeout while resolving predicate ... context={...}`)
- Receive timing logs (`receiveMessages returning ... after waiting ...`)
- Deadline hit log from stopwatch (`hit deadline after ... and returned 0 message(s)`)
- Poll deadline assertion line (`Poll-until-deadline check: PASS ...`)
- Diagnostics summary (`seenCount`, `lastMessage`, `eventualSeen(...)`)

## How to run

From project root, run:

`npm run demo`

For Demo 4 only, run:

`npm run demo-4`

The demo uses a static receive deadline of `2000ms` for each receive call.

## Notes

- This is intentionally minimal and single-process in-memory.
- There is no persistence across runs.
- It is designed for weekend sandbox testing and pattern exploration.
