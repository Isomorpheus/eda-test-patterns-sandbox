import { BusMessage, InMemoryBus } from "./inMemoryBus";

const EXPECTED_SCHEMA_VERSION = "1.0";
const RECEIVE_DEADLINE_MS = 2_000;

type DemoDiagnostics = {
  seenCount: number;
  lastMessage: string | null;
  countsByMessageId: Map<string, number>;
};

function buildMessage(
  messageId: string,
  schemaVersion: string,
  body: Record<string, unknown>,
  runId = "weekend-run-001"
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

  const bus = new InMemoryBus({ lockDurationInMs: 15_000 });
  const queueName = "orders";

  bus.send(queueName, buildMessage("msg-1", "1.0", { orderId: 1001 }));
  bus.send(queueName, buildMessage("msg-2", "1.0", { orderId: 1002 }));
  bus.send(queueName, buildMessage("msg-3", "0.9", { orderId: 1003 }));

  const receiver = bus.createReceiver(queueName, { receiveMode: "peekLock" });

  log("Demo", "Log 1: receive 1 and complete");
  const firstBatch = await receiver.receiveMessages(1, { maxWaitTimeInMs: RECEIVE_DEADLINE_MS });
  if (firstBatch.length === 1) {
    const msg = firstBatch[0];
    trackSeen(msg.messageId);
    log("Demo", `Got ${msg.messageId}, completing...`);
    await msg.complete();
  }

  log("Demo", "Log 2: receive next and abandon (should reappear)");
  const secondBatch = await receiver.receiveMessages(1, { maxWaitTimeInMs: RECEIVE_DEADLINE_MS });
  if (secondBatch.length === 1) {
    const msg = secondBatch[0];
    trackSeen(msg.messageId);
    log("Demo", `Got ${msg.messageId}, abandoning...`);
    await msg.abandon();
  }

  log("Demo", "Log 3: verify abandoned message reappears, then complete it");
  const reappearedBatch = await receiver.receiveMessages(1, { maxWaitTimeInMs: RECEIVE_DEADLINE_MS });
  if (reappearedBatch.length === 1) {
    const msg = reappearedBatch[0];
    trackSeen(msg.messageId);
    log("Demo", `Reappeared message: ${msg.messageId}. Completing now.`);
    await msg.complete();
  }

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
  log("Demo", `Log 5: inspect DLQ (count for '${queueName}': ${dlq.length})`);
  for (const item of dlq) {
    log(
      "Demo",
      `DLQ item -> messageId=${item.message.messageId}, reason=${item.reason}, at=${item.deadLetteredAt}`
    );
  }

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

  log("Diag", "Log 8: diagnostics summary");
  log("Diag", `seenCount=${diagnostics.seenCount}`);
  log("Diag", `lastMessage=${diagnostics.lastMessage ?? "<none>"}`);
  log("Diag", `eventualSeen(msg-2, 2)=${eventualSeen("msg-2", 2)}`);
  log("Diag", `eventualSeen(msg-3)=${eventualSeen("msg-3")}`);
  log("Diag", `eventualSeen(msg-4, 2)=${eventualSeen("msg-4", 2)}`);

  console.log("=== Demo complete ===\n");
}

runDemo().catch((error) => {
  console.error("[Demo] Failed:", error);
  process.exitCode = 1;
});
