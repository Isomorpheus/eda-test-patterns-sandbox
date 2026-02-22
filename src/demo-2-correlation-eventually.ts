import { BusMessage, InMemoryBus } from "./inMemoryBus";
import { waitForMessage } from "./waitForMessage";

const ACTIVE_RUN_ID = "weekend-run-002";

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m"
};

const paint = (text: string, ...codes: string[]): string => `${codes.join("")}${text}${ansi.reset}`;

function buildMessage(
  messageId: string,
  correlationId: string,
  schemaVersion: string,
  body: Record<string, unknown>,
  runId = ACTIVE_RUN_ID
): BusMessage {
  return {
    messageId,
    correlationId,
    subject: "sandbox.order.created",
    body,
    applicationProperties: {
      runId,
      schemaVersion
    }
  };
}

async function runDemo(): Promise<void> {
  console.log(`\n${paint("=== Block 2: correlation + eventually(waitForMessage) ===", ansi.bold, ansi.cyan)}`);

  const bus = new InMemoryBus({ lockDurationInMs: 15_000 });
  const queueName = "orders-correlation";

  const correlationId = "corr-block-2-target";

  bus.send(queueName, buildMessage("msg-b2-target", correlationId, "1.0", { orderId: 2002 }, ACTIVE_RUN_ID));
  bus.send(queueName, buildMessage("msg-b2-foreign", "corr-foreign", "1.0", { orderId: 2001 }, "weekend-run-999"));

  const receiver = bus.createReceiver(queueName, { receiveMode: "peekLock" });

  const msg = await waitForMessage(
    receiver,
    queueName,
    (message) => message.correlationId === correlationId,
    { timeoutMs: 2_000, pollIntervalMs: 50, runId: ACTIVE_RUN_ID }
  );

  console.log(`[Demo] Correlation matched: messageId=${msg.messageId}, correlationId=${msg.correlationId}`);
  await msg.complete();

  console.log(`${paint("=== Block 2 complete ===", ansi.bold, ansi.green)}\n`);
}

runDemo().catch((error) => {
  console.error("[Demo] Failed:", error);
  process.exitCode = 1;
});
