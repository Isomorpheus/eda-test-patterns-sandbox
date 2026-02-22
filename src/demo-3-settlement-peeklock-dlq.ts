import { BusMessage, InMemoryBus } from "./inMemoryBus";

const EXPECTED_SCHEMA_VERSION = "1.0";
const RECEIVE_DEADLINE_MS = 2_000;
const ACTIVE_RUN_ID = "weekend-run-003";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m"
};

const paint = (text: string, ...codes: string[]): string => `${codes.join("")}${text}${ansi.reset}`;

const colorize = (message: string): string =>
  message
    .replaceAll("completing", paint("completing", ansi.green))
    .replaceAll("complete", paint("complete", ansi.green))
    .replaceAll("abandoning", paint("abandoning", ansi.yellow))
    .replaceAll("abandoned", paint("abandoned", ansi.yellow))
    .replaceAll("abandon", paint("abandon", ansi.yellow))
    .replaceAll("dead-letter", paint("dead-letter", ansi.red))
    .replaceAll("lock-expiry", paint("lock-expiry", ansi.magenta));

const log = (message: string): void => {
  console.log(`${paint("[Demo]", ansi.bold, ansi.cyan)} ${colorize(message)}`);
};

const separator = (): void => {
  console.log(
    `${paint("[Demo]", ansi.bold, ansi.cyan)} ${paint("------------------------------------------------------------", ansi.dim)}`
  );
};

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
  console.log(`\n${paint("=== Block 3: settlement correctness (peekLock + DLQ + lock expiry) ===", ansi.bold, ansi.cyan)}`);

  const bus = new InMemoryBus({ lockDurationInMs: 1_000 });
  const queueName = "orders-settlement";

  bus.send(queueName, buildMessage("msg-1", "1.0", { orderId: 1001 }));
  bus.send(queueName, buildMessage("msg-2", "1.0", { orderId: 1002 }));
  bus.send(queueName, buildMessage("msg-3", "0.9", { orderId: 1003 }));

  const receiver = bus.createReceiver(queueName, { receiveMode: "peekLock" });

  separator();
  log("Log 1: receive 1 and complete");
  const firstBatch = await receiver.receiveMessages(1, { maxWaitTimeInMs: RECEIVE_DEADLINE_MS });
  if (firstBatch.length === 1) {
    const msg = firstBatch[0];
    log(`Got ${msg.messageId}, completing...`);
    await msg.complete();
  }

  separator();
  log("Log 2: receive next and abandon (should reappear)");
  const secondBatch = await receiver.receiveMessages(1, { maxWaitTimeInMs: RECEIVE_DEADLINE_MS });
  if (secondBatch.length === 1) {
    const msg = secondBatch[0];
    log(`Got ${msg.messageId}, abandoning...`);
    await msg.abandon();
  }

  separator();
  log("Log 3: verify abandoned message reappears, then complete it");
  const reappearedBatch = await receiver.receiveMessages(1, { maxWaitTimeInMs: RECEIVE_DEADLINE_MS });
  if (reappearedBatch.length === 1) {
    const msg = reappearedBatch[0];
    log(`Reappeared message: ${msg.messageId}. Completing now.`);
    await msg.complete();
  }

  separator();
  log("Log 4: receive invalid schemaVersion and dead-letter");
  const thirdBatch = await receiver.receiveMessages(1, { maxWaitTimeInMs: RECEIVE_DEADLINE_MS });
  if (thirdBatch.length === 1) {
    const msg = thirdBatch[0];
    const schemaVersion = msg.applicationProperties.schemaVersion;
    log(`Got ${msg.messageId} with schemaVersion=${schemaVersion}`);

    if (schemaVersion !== EXPECTED_SCHEMA_VERSION) {
      await msg.deadLetter(`Invalid schemaVersion '${schemaVersion}', expected '${EXPECTED_SCHEMA_VERSION}'`);
    } else {
      await msg.complete();
    }
  }

  const dlq = bus.getDeadLetterQueue(queueName);
  separator();
  log(`Log 5: inspect DLQ (count for '${queueName}': ${dlq.length})`);
  for (const item of dlq) {
    log(`DLQ item -> messageId=${item.message.messageId}, reason=${item.reason}, at=${item.deadLetteredAt}`);
  }

  separator();
  log("Log 6: lock-expiry redelivery");
  const lockQueue = "orders-settlement-lock-expiry";
  bus.send(lockQueue, buildMessage("msg-lock-1", "1.0", { orderId: 1101 }));
  const lockReceiver = bus.createReceiver(lockQueue, { receiveMode: "peekLock" });

  const lockedOnce = await lockReceiver.receiveMessages(1, { maxWaitTimeInMs: RECEIVE_DEADLINE_MS });
  if (lockedOnce.length === 1) {
    const msg = lockedOnce[0];
    log(`Received ${msg.messageId} and intentionally not settling to let lock expire.`);
  }

  await sleep(1_300);

  const redelivery = await lockReceiver.receiveMessages(1, { maxWaitTimeInMs: RECEIVE_DEADLINE_MS });
  if (redelivery.length === 1) {
    const msg = redelivery[0];
    log(`Lock-expiry redelivery observed: ${msg.messageId}. Completing now.`);
    await msg.complete();
  }

  console.log(`${paint("=== Block 3 complete ===", ansi.bold, ansi.green)}\n`);
}

runDemo().catch((error) => {
  console.error(`${paint("[Demo] Failed:", ansi.bold, ansi.red)}`, error);
  process.exitCode = 1;
});
