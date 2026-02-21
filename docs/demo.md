# InMemory Service Bus Demo

This document explains the sandbox demo in [src/demo.ts](../src/demo.ts) and the simulator in [src/inMemoryBus.ts](../src/inMemoryBus.ts).

## Purpose

Use a local in-memory bus to practice event-driven patterns without Azure Service Bus.

Implemented concepts:

- `peekLock` receive mode
- Message settlement: `complete()`, `abandon()`, `deadLetter(reason)`
- Dead-letter queue (DLQ) per queue
- Optional duplicate simulation
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
4. Receives 1 message and calls `complete()`.
5. Receives next message and calls `abandon()`.
6. Receives again to verify abandoned message is visible again, then calls `complete()`.
7. Receives the invalid message, validates schema, and calls `deadLetter(...)`.
8. Reads and prints DLQ entries.
9. Enables duplicate simulation, sends `msg-4`, completes it once (duplicate is re-enqueued), receives duplicate, disables duplicate simulation, and completes duplicate.
10. Performs a final receive on an empty queue with a static deadline of 2 seconds to show timeout behavior.

## Diagnostics

The demo now tracks and prints:

- `seenCount`: total deliveries seen by the receiver (includes retries/duplicates)
- `lastMessage`: most recently seen `messageId`
- `eventualSeen(messageId, minCount?)`: final boolean assertion that a message was observed enough times

Example checks in output:

- `eventualSeen(msg-2, 2)=true` (abandon + redelivery)
- `eventualSeen(msg-3)=true` (seen before dead-letter)
- `eventualSeen(msg-4, 2)=true` (original + duplicate)

## Expected console behavior

You should see logs for:

- Send operations
- Lock acquisition and lock expiry timestamps
- Completion and abandonment transitions
- Dead-letter action with reason
- DLQ count and item details
- Duplicate simulation toggling and duplicate delivery
- Receive timing logs (`receiveMessages returning ... after waiting ...`)
- Deadline hit log from stopwatch (`hit deadline after ... and returned 0 message(s)`)
- Diagnostics summary (`seenCount`, `lastMessage`, `eventualSeen(...)`)

## How to run

From project root, run:

`npm run demo`

The demo uses a static receive deadline of `2000ms` for each receive call.

## Notes

- This is intentionally minimal and single-process in-memory.
- There is no persistence across runs.
- It is designed for weekend sandbox testing and pattern exploration.
