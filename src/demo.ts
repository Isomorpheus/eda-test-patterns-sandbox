import { BusMessage, InMemoryBus } from "./inMemoryBus";

const EXPECTED_SCHEMA_VERSION = "1.0";
const RECEIVE_DEADLINE_MS = 2_000;
const ACTIVE_RUN_ID = "weekend-run-001";

type DemoDiagnostics = {
  seenCount: number;
  lastMessage: string | null;
  countsByMessageId: Map<string, number>;
};

type DemoReceiver = {
  receiveMessages: (
    max: number,
    receiveOptions?: { maxWaitTimeInMs?: number }
  ) => Promise<Array<BusMessage & { complete(): Promise<void>; abandon(): Promise<void> }>>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function buildMessage(
  messageId: string,
  schemaVersion: string,
  body: Record<string, unknown>,
  runId = ACTIVE_RUN_ID
): BusMessage {
  return {
    messageId,
    correlationId: `corr-${runId}`,
    subject: "sandbox.order.created",
    body,
    applicationProperties: {
      runId,
      schemaVersion
    }
  };
}

async function runDemo(): Promise<void> {
  const separator = (): void => {
    console.log("[Demo] ------------------------------------------------------------");
  };

  const log = (scope: "Demo" | "Diag", message: string): void => {
    console.log(`[${scope}] ${message}`);
  };

  console.log("\n=== InMemoryBus demo (peekLock + settlement + DLQ + duplicates) ===");

  const diagnostics: DemoDiagnostics = {
    seenCount: 0,
    lastMessage: null,
    countsByMessageId: new Map<string, number>()
  };

  const trackSeen = (messageId: string): void => {
    diagnostics.seenCount += 1;
    diagnostics.lastMessage = messageId;
    diagnostics.countsByMessageId.set(messageId, (diagnostics.countsByMessageId.get(messageId) ?? 0) + 1);
    log(
      "Diag",
      `seenCount=${diagnostics.seenCount}, lastMessage=${diagnostics.lastMessage}, ${messageId}Seen=${diagnostics.countsByMessageId.get(messageId)}`
    );
  };

  const eventualSeen = (messageId: string, minCount = 1): boolean => {
    return (diagnostics.countsByMessageId.get(messageId) ?? 0) >= minCount;
  };

  const isCurrentRun = (message: { applicationProperties: { runId: string } }): boolean => {
    return message.applicationProperties.runId === ACTIVE_RUN_ID;
  };

  const resolveAndSettleOnPredicate = async (
    receiverToUse: DemoReceiver,
    predicate: (message: BusMessage) => boolean,
    options?: { deadlineMs?: number; batchSize?: number; contextLabel?: string; retryDelayMs?: number }
  ): Promise<BusMessage> => {
    const deadlineMs = options?.deadlineMs ?? RECEIVE_DEADLINE_MS;
    const batchSize = options?.batchSize ?? 5;
    const contextLabel = options?.contextLabel ?? "predicate-resolver";
    const retryDelayMs = options?.retryDelayMs ?? 25;
    const startedAt = Date.now();
    let checkedCount = 0;
    let blockedCount = 0;
    const blockedSamples: string[] = [];
    let blockedLogSuppressed = false;

    while (Date.now() - startedAt < deadlineMs) {
      const remainingMs = Math.max(1, deadlineMs - (Date.now() - startedAt));
      const batch = await receiverToUse.receiveMessages(batchSize, { maxWaitTimeInMs: remainingMs });

      if (batch.length === 0) {
        break;
      }

      for (const msg of batch) {
        checkedCount += 1;
        if (predicate(msg)) {
          await msg.complete();
          return {
            messageId: msg.messageId,
            correlationId: msg.correlationId,
            subject: msg.subject,
            body: msg.body,
            applicationProperties: {
              runId: msg.applicationProperties.runId,
              schemaVersion: msg.applicationProperties.schemaVersion
            }
          };
        }

        if (blockedCount < 3) {
          log(
            "Demo",
            `First gate BLOCKED ${msg.messageId} (runId=${msg.applicationProperties.runId}); predicate did not match, not handled.`
          );
        } else if (!blockedLogSuppressed) {
          blockedLogSuppressed = true;
          log("Demo", "First gate BLOCKED ... additional repeats suppressed");
        }
        blockedCount += 1;
        if (blockedSamples.length < 5) {
          blockedSamples.push(`${msg.messageId}:${msg.applicationProperties.runId}`);
        }
        await msg.abandon();
      }

      const remainingAfterBatchMs = deadlineMs - (Date.now() - startedAt);
      if (remainingAfterBatchMs > 0) {
        await sleep(Math.min(retryDelayMs, remainingAfterBatchMs));
      }
    }

    const elapsedMs = Date.now() - startedAt;
    throw new Error(
      `Timeout while resolving predicate (${contextLabel}). context=${JSON.stringify({
        deadlineMs,
        elapsedMs,
        checkedCount,
        blockedCount,
        blockedSamples
      })}`
    );
  };

  const bus = new InMemoryBus({ lockDurationInMs: 15_000 });
  const queueName = "orders";

  bus.send(queueName, buildMessage("msg-1", "1.0", { orderId: 1001 }));
  bus.send(queueName, buildMessage("msg-2", "1.0", { orderId: 1002 }));
  bus.send(queueName, buildMessage("msg-3", "0.9", { orderId: 1003 }));

  const receiver = bus.createReceiver(queueName, { receiveMode: "peekLock" });

  separator();
  log("Demo", "Log 1: receive 1 and complete");
  const firstBatch = await receiver.receiveMessages(1, { maxWaitTimeInMs: RECEIVE_DEADLINE_MS });
  if (firstBatch.length === 1) {
    const msg = firstBatch[0];
    trackSeen(msg.messageId);
    log("Demo", `Got ${msg.messageId}, completing...`);
    await msg.complete();
  }

  separator();
  log("Demo", "Log 2: receive next and abandon (should reappear)");
  const secondBatch = await receiver.receiveMessages(1, { maxWaitTimeInMs: RECEIVE_DEADLINE_MS });
  if (secondBatch.length === 1) {
    const msg = secondBatch[0];
    trackSeen(msg.messageId);
    log("Demo", `Got ${msg.messageId}, abandoning...`);
    await msg.abandon();
  }

  separator();
  log("Demo", "Log 3: verify abandoned message reappears, then complete it");
  const reappearedBatch = await receiver.receiveMessages(1, { maxWaitTimeInMs: RECEIVE_DEADLINE_MS });
  if (reappearedBatch.length === 1) {
    const msg = reappearedBatch[0];
    trackSeen(msg.messageId);
    log("Demo", `Reappeared message: ${msg.messageId}. Completing now.`);
    await msg.complete();
  }

  separator();
  log("Demo", "Log 4: receive invalid schemaVersion and dead-letter");
  const thirdBatch = await receiver.receiveMessages(1, { maxWaitTimeInMs: RECEIVE_DEADLINE_MS });
  if (thirdBatch.length === 1) {
    const msg = thirdBatch[0];
    trackSeen(msg.messageId);
    const schemaVersion = msg.applicationProperties.schemaVersion;
    log("Demo", `Got ${msg.messageId} with schemaVersion=${schemaVersion}`);

    if (schemaVersion !== EXPECTED_SCHEMA_VERSION) {
      await msg.deadLetter(`Invalid schemaVersion '${schemaVersion}', expected '${EXPECTED_SCHEMA_VERSION}'`);
    } else {
      await msg.complete();
    }
  }

  const dlq = bus.getDeadLetterQueue(queueName);
  separator();
  log("Demo", `Log 5: inspect DLQ (count for '${queueName}': ${dlq.length})`);
  for (const item of dlq) {
    log(
      "Demo",
      `DLQ item -> messageId=${item.message.messageId}, reason=${item.reason}, at=${item.deadLetteredAt}`
    );
  }

  separator();
  log("Demo", "Log 6: duplicate simulation (optional behavior)");
  bus.setDuplicateSimulation(true);
  bus.send(queueName, buildMessage("msg-4", "1.0", { orderId: 1004 }));

  const duplicateSource = await receiver.receiveMessages(1, { maxWaitTimeInMs: RECEIVE_DEADLINE_MS });
  if (duplicateSource.length === 1) {
    trackSeen(duplicateSource[0].messageId);
    log("Demo", `Completing ${duplicateSource[0].messageId}; duplicate should be re-enqueued.`);
    await duplicateSource[0].complete();
  }

  const duplicateDelivery = await receiver.receiveMessages(1, { maxWaitTimeInMs: RECEIVE_DEADLINE_MS });
  if (duplicateDelivery.length === 1) {
    trackSeen(duplicateDelivery[0].messageId);
    log("Demo", `Duplicate observed: ${duplicateDelivery[0].messageId}. Completing duplicate.`);
    bus.setDuplicateSimulation(false);
    await duplicateDelivery[0].complete();
  }

  separator();
  log("Demo", "Log 7: poll in a loop until 2s deadline (empty queue)");
  log("Demo", "Expect bus to poll repeatedly and then return 0 messages at deadline.");
  const startedAt = Date.now();
  const timeoutBatch = await receiver.receiveMessages(1, { maxWaitTimeInMs: RECEIVE_DEADLINE_MS });
  const elapsed = Date.now() - startedAt;
  log("Demo", `Timeout receive returned ${timeoutBatch.length} message(s) after ~${elapsed}ms`);
  const nearDeadline = elapsed >= RECEIVE_DEADLINE_MS && elapsed <= RECEIVE_DEADLINE_MS + 200;
  log(
    "Demo",
    `Poll-until-deadline check: ${nearDeadline ? "PASS" : "CHECK"} (target=${RECEIVE_DEADLINE_MS}ms, actual~${elapsed}ms)`
  );

  separator();
  log("Diag", "Log 8: diagnostics summary");
  log("Diag", `seenCount=${diagnostics.seenCount}`);
  log("Diag", `lastMessage=${diagnostics.lastMessage ?? "<none>"}`);
  log("Diag", `eventualSeen(msg-2, 2)=${eventualSeen("msg-2", 2)}`);
  log("Diag", `eventualSeen(msg-3)=${eventualSeen("msg-3")}`);
  log("Diag", `eventualSeen(msg-4, 2)=${eventualSeen("msg-4", 2)}`);

  separator();
  log("Demo", "Log 9: run isolation first-gating demo");
  const runIsolationQueue = "orders-run-isolation";
  bus.send(runIsolationQueue, buildMessage("msg-ri-foreign", "1.0", { orderId: 2001 }, "weekend-run-999"));
  bus.send(runIsolationQueue, buildMessage("msg-ri-local", "1.0", { orderId: 2002 }, ACTIVE_RUN_ID));

  const runIsolationReceiver = bus.createReceiver(runIsolationQueue, { receiveMode: "peekLock" });

  log("Demo", "Using predicate resolver: if predicate(message) is true -> resolve and complete in one place.");
  const matched = await resolveAndSettleOnPredicate(
    runIsolationReceiver,
    (message) => isCurrentRun(message),
    { deadlineMs: RECEIVE_DEADLINE_MS, batchSize: 2, contextLabel: "run-isolation-success-path" }
  );

  log(
    "Demo",
    `First gate PASS for ${matched.messageId} (runId=${matched.applicationProperties.runId}); settled via centralized success path (complete).`
  );

  const stillBlocked = await runIsolationReceiver.receiveMessages(1, { maxWaitTimeInMs: RECEIVE_DEADLINE_MS });
  if (stillBlocked.length === 1) {
    const msg = stillBlocked[0];
    log("Demo", `Still blocked on next receive: ${msg.messageId} (runId=${msg.applicationProperties.runId}).`);
    await msg.abandon();
  }

  separator();
  log("Demo", "Log 10: timeout -> throw with context (predicate resolver)");
  const timeoutQueue = "orders-run-isolation-timeout";
  bus.send(timeoutQueue, buildMessage("msg-timeout-foreign", "1.0", { orderId: 3001 }, "weekend-run-404"));
  const timeoutReceiver = bus.createReceiver(timeoutQueue, { receiveMode: "peekLock" });

  try {
    await resolveAndSettleOnPredicate(timeoutReceiver, (message) => isCurrentRun(message), {
      deadlineMs: 400,
      batchSize: 1,
      contextLabel: "run-isolation-timeout-demo"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("Demo", `Expected timeout caught -> ${message}`);
  }

  console.log("=== Demo complete ===\n");
}

runDemo().catch((error) => {
  console.error("[Demo] Failed:", error);
  process.exitCode = 1;
});
