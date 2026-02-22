import { BusMessage, InMemoryBus } from "./inMemoryBus";

const RECEIVE_DEADLINE_MS = 2_000;
const ACTIVE_RUN_ID = "weekend-run-001";

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  blue: "\x1b[34m"
};

const paint = (text: string, ...codes: string[]): string => `${codes.join("")}${text}${ansi.reset}`;

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
    console.log(
      `${paint("[Demo]", ansi.bold, ansi.cyan)} ${paint("------------------------------------------------------------", ansi.dim)}`
    );
  };

  const log = (scope: "Demo" | "Diag", message: string): void => {
    const prefix =
      scope === "Demo"
        ? paint("[Demo]", ansi.bold, ansi.cyan)
        : paint("[Diag]", ansi.bold, ansi.blue);
    console.log(`${prefix} ${message}`);
  };

  console.log(`\n${paint("=== Block 1: basic send/receive ===", ansi.bold, ansi.cyan)}`);

  const bus = new InMemoryBus({ lockDurationInMs: 15_000 });
  const queueName = "orders";

  bus.send(queueName, buildMessage("msg-1", "1.0", { orderId: 1001 }));

  const receiver = bus.createReceiver(queueName, { receiveMode: "peekLock" });

  separator();
  log("Demo", "Log 1: receive 1 and complete");
  const firstBatch = await receiver.receiveMessages(1, { maxWaitTimeInMs: RECEIVE_DEADLINE_MS });
  if (firstBatch.length === 1) {
    const msg = firstBatch[0];
    log("Diag", `seenCount=1, lastMessage=${msg.messageId}, ${msg.messageId}Seen=1`);
    log("Demo", `Got ${msg.messageId}, completing...`);
    await msg.complete();
  }

  console.log(`${paint("=== Block 1 complete ===", ansi.bold, ansi.green)}\n`);
}

runDemo().catch((error) => {
  console.error("[Demo] Failed:", error);
  process.exitCode = 1;
});
