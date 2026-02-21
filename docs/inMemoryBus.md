# InMemoryBus internals

This document explains how [src/inMemoryBus.ts](../src/inMemoryBus.ts) works.

## Purpose

`InMemoryBus` is a lightweight local simulator for practicing event-driven patterns without Azure Service Bus. It focuses on core queue behaviors (`peekLock`, settlement, DLQ, duplicates) so you can test message-flow logic quickly in a sandbox.

## Core model

`InMemoryBus` stores queue state in memory only:

- `queues: Map<string, QueueMessageEnvelope[]>`
- `deadLetterQueues: Map<string, DeadLetterRecord[]>`

Each queue item is wrapped in `QueueMessageEnvelope`:

- `message`
- `state`: `available` or `locked`
- `deliveryCount`
- `lockedUntilEpochMs`
- `lockOwnerId`

## Receiver and peekLock

`createReceiver(queueName, { receiveMode: "peekLock" })` returns a receiver with:

- `receiveMessages(max, { maxWaitTimeInMs })`

Behavior:

1. Only `available` messages are delivered.
2. Delivered messages are moved to `locked` state.
3. Locked messages are invisible to other receives until:
   - settled (`complete`, `abandon`, `deadLetter`), or
   - lock expires.

## Polling until deadline

`receiveMessages` uses:

- a tiny stopwatch (`createStopwatch()`)
- polling interval of 25ms
- loop condition: poll until elapsed time reaches `maxWaitTimeInMs`

Flow:

1. Try to find `available` messages.
2. If found, lock and return them immediately.
3. If none found, sleep for `min(25ms, remainingMs)`.
4. When deadline is reached, stop stopwatch and return `[]`.

## Settlement methods

Each received message includes:

- `complete()`
  - removes message from queue
  - optionally re-enqueues duplicate if duplicate simulation is enabled
- `abandon()`
  - clears lock and makes message visible again
- `deadLetter(reason)`
  - removes message from main queue
  - appends record to per-queue DLQ

## Lock expiry

`releaseExpiredLocks(queueName)` runs during receive and settlement checks.

If lock time is past `lockedUntilEpochMs`, message is moved back to `available` state.

## Duplicate simulation

`setDuplicateSimulation(true|false)` toggles duplicate behavior.

When enabled, `complete()` re-enqueues a copy of the completed message into the same queue.

## Notes and limits

- Single-process, in-memory only (no persistence).
- No sessions, transactions, scheduling, defer, or renew-lock features.
- Intended for sandbox testing of event-driven patterns.
