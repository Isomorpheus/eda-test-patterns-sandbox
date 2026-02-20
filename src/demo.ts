import { BusMessage, InMemoryBus } from "./inMemoryBus";

const EXPECTED_SCHEMA_VERSION = "1.0";

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
  console.log("\n=== InMemoryBus demo (peekLock + settlement + DLQ + duplicates) ===\n");

  const bus = new InMemoryBus({ lockDurationInMs: 15_000 });
  const queueName = "orders";

  bus.send(queueName, buildMessage("msg-1", "1.0", { orderId: 1001 }));
  bus.send(queueName, buildMessage("msg-2", "1.0", { orderId: 1002 }));
  bus.send(queueName, buildMessage("msg-3", "0.9", { orderId: 1003 }));

  const receiver = bus.createReceiver(queueName, { receiveMode: "peekLock" });

  console.log("\n[Demo] Step 1: receive 1 and complete");
  const firstBatch = await receiver.receiveMessages(1, { maxWaitTimeInMs: 1_000 });
  if (firstBatch.length === 1) {
    const msg = firstBatch[0];
    console.log(`[Demo] Got ${msg.messageId}, completing...`);
    await msg.complete();
  }

  console.log("\n[Demo] Step 2: receive next and abandon (should reappear)");
  const secondBatch = await receiver.receiveMessages(1, { maxWaitTimeInMs: 1_000 });
  if (secondBatch.length === 1) {
    const msg = secondBatch[0];
    console.log(`[Demo] Got ${msg.messageId}, abandoning...`);
    await msg.abandon();
  }

  console.log("\n[Demo] Verify abandoned message reappears, then complete it");
  const reappearedBatch = await receiver.receiveMessages(1, { maxWaitTimeInMs: 1_000 });
  if (reappearedBatch.length === 1) {
    const msg = reappearedBatch[0];
    console.log(`[Demo] Reappeared message: ${msg.messageId}. Completing now.`);
    await msg.complete();
  }

  console.log("\n[Demo] Step 3: receive invalid schemaVersion and dead-letter");
  const thirdBatch = await receiver.receiveMessages(1, { maxWaitTimeInMs: 1_000 });
  if (thirdBatch.length === 1) {
    const msg = thirdBatch[0];
    const schemaVersion = msg.applicationProperties.schemaVersion;
    console.log(`[Demo] Got ${msg.messageId} with schemaVersion=${schemaVersion}`);

    if (schemaVersion !== EXPECTED_SCHEMA_VERSION) {
      await msg.deadLetter(`Invalid schemaVersion '${schemaVersion}', expected '${EXPECTED_SCHEMA_VERSION}'`);
    } else {
      await msg.complete();
    }
  }

  const dlq = bus.getDeadLetterQueue(queueName);
  console.log(`\n[Demo] DLQ count for '${queueName}': ${dlq.length}`);
  for (const item of dlq) {
    console.log(
      `[Demo] DLQ item -> messageId=${item.message.messageId}, reason=${item.reason}, at=${item.deadLetteredAt}`
    );
  }

  console.log("\n[Demo] Duplicate simulation toggle (optional behavior)");
  bus.setDuplicateSimulation(true);
  bus.send(queueName, buildMessage("msg-4", "1.0", { orderId: 1004 }));

  const duplicateSource = await receiver.receiveMessages(1, { maxWaitTimeInMs: 1_000 });
  if (duplicateSource.length === 1) {
    console.log(`[Demo] Completing ${duplicateSource[0].messageId}; duplicate should be re-enqueued.`);
    await duplicateSource[0].complete();
  }

  const duplicateDelivery = await receiver.receiveMessages(1, { maxWaitTimeInMs: 1_000 });
  if (duplicateDelivery.length === 1) {
    console.log(`[Demo] Duplicate observed: ${duplicateDelivery[0].messageId}. Completing duplicate.`);
    bus.setDuplicateSimulation(false);
    await duplicateDelivery[0].complete();
  }

  console.log("\n=== Demo complete ===\n");
}

runDemo().catch((error) => {
  console.error("[Demo] Failed:", error);
  process.exitCode = 1;
});
