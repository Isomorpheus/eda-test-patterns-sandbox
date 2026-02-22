# InMemory Service Bus Demo

This document explains the sandbox demo in [src/demo.ts](../src/demo.ts) and the simulator in [src/inMemoryBus.ts](../src/inMemoryBus.ts).

It also documents the duplicate/idempotency demo in [src/demo-4-duplicates-idempotency.ts](../src/demo-4-duplicates-idempotency.ts), the parallel-runs isolation demo in [src/demo-5-parallel-runs-isolation.ts](../src/demo-5-parallel-runs-isolation.ts), and the mini-flow ordering demo in [src/demo-6-mini-flow-ordering.ts](../src/demo-6-mini-flow-ordering.ts).

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

## What the demos do

The sandbox is now split into focused runnable files:

### Block 1

In [src/demo-1-basic-send-receive.ts](../src/demo-1-basic-send-receive.ts):

- basic send + receive in `peekLock`
- single `complete()` flow

### Block 2

In [src/demo-2-correlation-eventually.ts](../src/demo-2-correlation-eventually.ts):

- correlation-based matching
- eventual receive via `waitForMessage(...)`
- run-id filtering behavior

### Block 3

In [src/demo-3-settlement-peeklock-dlq.ts](../src/demo-3-settlement-peeklock-dlq.ts):

- `complete()` scenario
- `abandon()` scenario + redelivery
- `deadLetter(...)` scenario
- lock-expiry redelivery scenario

### Block 4+

In [src/demo.ts](../src/demo.ts):

- run-isolation first-gating flow
- predicate resolver success path
- predicate resolver timeout path with context

### Block 5

In [src/demo-5-parallel-runs-isolation.ts](../src/demo-5-parallel-runs-isolation.ts):

- three parallel runs (`RUN A`, `RUN B`, `RUN C`) share the same queue
- each run uses its own `runId`, `correlationId`, `seenMessageIds`, and per-run stats
- processed-message logs always include `runId`, `correlationId`, `messageId`, `FIRST/DUPLICATE`, and settlement (`complete`)
- each run tracks minimal per-correlation distribution (`deliveries`, `first`, `dupes`)
- interleaved sends (random delays) simulate concurrent test traffic
- each worker uses `waitForMessage(...)` with run-id isolation
- fail-fast cross-talk detection with visual banner (`🚨 CROSS-TALK DETECTED 🚨`) + throw
- startup section header before workers begin
- per-run summary section headers (`RunA summary`, `RunB summary`, `RunC summary`)
- final PASS banner:
  - `✅ PARALLEL RUN ISOLATION VERIFIED`
  - `No cross-talk detected.`
  - `runId isolation preserved.`
  - `correlationId visibility confirmed.`
- CLI toggle for cross-talk simulation: `--crosstalk`

Block 5 now has two explicit modes:

- normal mode (default): success is expected
- cross-talk simulation mode (`--crosstalk`): failure is expected

Top-level outcome handling:

- default mode:
  - success => PASS banner
  - error => `UNEXPECTED FAILURE` and non-zero exit
- `--crosstalk` mode:
  - cross-talk detection error => `EXPECTED FAILURE: cross-talk successfully detected` and clean exit
  - no detection => `ERROR: cross-talk simulation did NOT trigger detection` and non-zero exit

### Block 6

In [src/demo-6-mini-flow-ordering.ts](../src/demo-6-mini-flow-ordering.ts):

- simulates a small STP-like flow for one `runId` across 3 correlation streams (`A-1`, `A-2`, `A-3`)
- each correlation publishes exactly 3 ordered subjects:
  - `FlowStarted`
  - `FlowProcessed`
  - `FlowCompleted`
- send timing is interleaved globally with small random delays
- receive path uses `waitForMessage(...)` with run-id filtering
- collection map tracks per-correlation sequence and message IDs:
  - `eventsByCorr: { subjectsSeen: string[], messageIds: string[] }`
- duplicate-safe handling logs `FIRST|DUPLICATE` and always settles with `complete`
- strict order assertion per correlation with explicit failure banner showing:
  - `runId`
  - `correlationId`
  - expected order
  - actual order
- final summary prints each correlation order and PASS line:
  - `PASS: ordering verified per correlationId`

## Diagnostics

Diagnostics in [src/demo.ts](../src/demo.ts) include:

- `seenCount`
- `lastMessage`
- `eventualSeen(...)`

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
- final global stats object + single-line summary:
  - `deliveriesSeen`
  - `firstDeliveries`
  - `duplicatesDetected`
  - `lockLostRedeliveries`
  - `completed`
  - plus `runId` and `correlationId`

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
- Run-isolation gate logs (`First gate BLOCKED/PASS ...`, blocked messages are not handled)
- Predicate resolver behavior (`if predicate(message) true -> resolve + settle (complete)`)
- Timeout with context (`Timeout while resolving predicate ... context={...}`)
- Receive timing logs (`receiveMessages returning ... after waiting ...`)
- Deadline hit log from stopwatch (`hit deadline after ... and returned 0 message(s)`)
- Poll deadline assertion line (`Poll-until-deadline check: PASS ...`)
- Diagnostics summary (`seenCount`, `lastMessage`, `eventualSeen(...)`)
- Demo 4 summary block (`---- DEMO 4 SUMMARY ----` and `SUMMARY: deliveries=...`)
- Demo 5 startup header (`Starting parallel run isolation demo`)
- Demo 5 cross-talk mode banner (`⚠ CROSS-TALK SIMULATION MODE ENABLED` + expected-failure line)
- Demo 5 processed-message line format (`RUN X | runId=... | corr=... | msg=... | FIRST/DUPLICATE | complete`)
- Demo 5 per-correlation summary lines (`corr-...: deliveries=... first=... dupes=...`)
- Demo 5 per-run summary headers (`RunA summary`, `RunB summary`, `RunC summary`)
- Demo 5 cross-talk error banner (`🚨 CROSS-TALK DETECTED 🚨`)
- Demo 5 final PASS banner (`✅ PARALLEL RUN ISOLATION VERIFIED`)
- Demo 5 expected-failure line in simulation mode (`EXPECTED FAILURE: cross-talk successfully detected`)
- Demo 6 receive log format (`RUN A | runId=... | corr=... | msg=... | subject=... | FIRST/DUPLICATE | complete`)
- Demo 6 summary block (`---- DEMO 6 SUMMARY ----`)
- Demo 6 PASS line (`PASS: ordering verified per correlationId`)

## How to run

From project root, run:

`npm run demo-1`

`npm run demo-2`

`npm run demo-3`

`npm run demo`

For Demo 4 only, run:

`npm run demo-4`

For Demo 5 only, run:

`npm run demo-5`

For Demo 5 cross-talk simulation, run:

`npm run demo-5 -- --crosstalk`

For Demo 6 mini-flow ordering, run:

`npm run demo-6`

The demo uses a static receive deadline of `2000ms` for each receive call.

## Notes

- This is intentionally minimal and single-process in-memory.
- There is no persistence across runs.
- It is designed for weekend sandbox testing and pattern exploration.
