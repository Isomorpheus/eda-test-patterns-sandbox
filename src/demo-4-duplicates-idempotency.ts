import { BusMessage, InMemoryBus, ReceivedBusMessage } from "./inMemoryBus";

const LOCK_DURATION_MS = 1_000;

let runId = "";
let correlationId = "";

const stats = {
  deliveriesSeen: 0,
  firstDeliveries: 0,
  duplicatesDetected: 0,
  completed: 0,
  lockLostRedeliveries: 0
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m"
};

const paint = (text: string, ...codes: string[]): string => `${codes.join("")}${text}${ansi.reset}`;

const scenarioColor = (label: string): string => (label === "A" ? ansi.cyan : ansi.magenta);

async function waitForMessage(
  receiver: { receiveMessages: (max: number, options?: { maxWaitTimeInMs?: number }) => Promise<ReceivedBusMessage[]> },
  queueName: string,
  predicate: (message: ReceivedBusMessage) => boolean,
  options?: { timeoutMs?: number; pollIntervalMs?: number; runId?: string }
): Promise<ReceivedBusMessage> {
  const timeoutMs = options?.timeoutMs ?? 2_000;
  const pollIntervalMs = options?.pollIntervalMs ?? 50;
  const runId = options?.runId;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const remaining = timeoutMs - (Date.now() - startedAt);
    const batch = await receiver.receiveMessages(1, {
      maxWaitTimeInMs: Math.max(1, Math.min(pollIntervalMs, remaining))
    });

    if (batch.length === 0) {
      await sleep(Math.min(pollIntervalMs, Math.max(0, timeoutMs - (Date.now() - startedAt))));
      continue;
    }

    const message = batch[0];

    if (runId && message.applicationProperties.runId !== runId) {
      console.log(
        `${paint("[waitForMessage]", ansi.gray)} queue=${queueName} ${paint("runId-filter miss", ansi.yellow)} messageId=${paint(message.messageId, ansi.yellow)} actualRunId=${message.applicationProperties.runId} expectedRunId=${runId}`
      );
      await message.abandon();
      continue;
    }

    if (!predicate(message)) {
      console.log(
        `${paint("[waitForMessage]", ansi.gray)} queue=${queueName} ${paint("predicate miss", ansi.yellow)} messageId=${paint(message.messageId, ansi.yellow)} runId=${message.applicationProperties.runId}`
      );
      await message.abandon();
      continue;
    }

    console.log(
      `${paint("[waitForMessage]", ansi.gray)} queue=${queueName} ${paint("matched", ansi.green)} messageId=${paint(message.messageId, ansi.green)} runId=${message.applicationProperties.runId}`
    );

    return message;
  }

  throw new Error(`[waitForMessage] timeout queue=${queueName} timeoutMs=${timeoutMs}`);
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildMessage(runId: string, correlationId: string): BusMessage {
  return {
    messageId: newId("msg"),
    correlationId,
    subject: "sandbox.duplicates.demo",
    body: {
      createdAt: new Date().toISOString()
    },
    applicationProperties: {
      runId,
      schemaVersion: "1.0"
    }
  };
}

type ScenarioStats = {
  deliveriesSeen: number;
  duplicatesIgnored: number;
};

async function handleDelivery(
  message: ReceivedBusMessage,
  seenMessageIds: Set<string>,
  scenarioStats: ScenarioStats,
  scenarioLabel: string
): Promise<"first" | "duplicate"> {
  scenarioStats.deliveriesSeen += 1;
  demoStats.deliveriesSeen += 1;

  if (seenMessageIds.has(message.messageId)) {
    scenarioStats.duplicatesIgnored += 1;
    demoStats.duplicatesDetected += 1;
    console.log(
      `${paint(`[${scenarioLabel}]`, scenarioColor(scenarioLabel), ansi.bold)} delivery=${scenarioStats.deliveriesSeen} messageId=${paint(message.messageId, ansi.yellow)} ${paint("duplicate detected", ansi.yellow, ansi.bold)} -> settlement=${paint("complete", ansi.green)}`
    );
    await message.complete();
    demoStats.completed += 1;
    return "duplicate";
  }

  seenMessageIds.add(message.messageId);
  demoStats.firstDeliveries += 1;
  console.log(
    `${paint(`[${scenarioLabel}]`, scenarioColor(scenarioLabel), ansi.bold)} delivery=${scenarioStats.deliveriesSeen} messageId=${paint(message.messageId, ansi.cyan)} ${paint("first-seen", ansi.cyan, ansi.bold)} -> settlement=${paint("complete", ansi.green)}`
  );
  await message.complete();
  demoStats.completed += 1;
  return "first";
}

const demoStats = stats;

async function runScenarioA(bus: InMemoryBus): Promise<void> {
  const queueName = "orders-dup-happy";
  runId = newId("run-a");
  correlationId = newId("corr-a");
  const seenMessageIds = new Set<string>();
  const stats: ScenarioStats = { deliveriesSeen: 0, duplicatesIgnored: 0 };

  console.log(`\n${paint("=== Scenario A: Duplicate happy path ===", ansi.bold, ansi.cyan)}`);
  console.log(
    `${paint("[A]", ansi.bold, ansi.cyan)} runId=${paint(runId, ansi.cyan)} correlationId=${paint(correlationId, ansi.cyan)}`
  );

  const receiver = bus.createReceiver(queueName, { receiveMode: "peekLock" });
  const message = buildMessage(runId, correlationId);

  bus.send(queueName, message, { simulateDuplicate: true });

  const first = await waitForMessage(
    receiver,
    queueName,
    (m) => m.correlationId === correlationId,
    { timeoutMs: 2_000, pollIntervalMs: 50, runId }
  );
  await handleDelivery(first, seenMessageIds, stats, "A");

  const second = await waitForMessage(
    receiver,
    queueName,
    (m) => m.correlationId === correlationId,
    { timeoutMs: 2_000, pollIntervalMs: 50, runId }
  );
  await handleDelivery(second, seenMessageIds, stats, "A");

  console.log(
    `${paint("[A] summary", ansi.bold, ansi.blue)} deliveries seen=${paint(String(stats.deliveriesSeen), ansi.blue)}, duplicates ignored=${paint(String(stats.duplicatesIgnored), ansi.yellow)}`
  );
}

async function runScenarioB(bus: InMemoryBus): Promise<void> {
  const queueName = "orders-dup-lock-expiry";
  runId = newId("run-b");
  correlationId = newId("corr-b");
  const seenMessageIds = new Set<string>();
  const stats: ScenarioStats = { deliveriesSeen: 0, duplicatesIgnored: 0 };

  console.log(`\n${paint("=== Scenario B: Duplicate via lock expiry (lock lost) ===", ansi.bold, ansi.magenta)}`);
  console.log(
    `${paint("[B]", ansi.bold, ansi.magenta)} runId=${paint(runId, ansi.magenta)} correlationId=${paint(correlationId, ansi.magenta)}`
  );

  const receiver = bus.createReceiver(queueName, { receiveMode: "peekLock" });
  const message = buildMessage(runId, correlationId);
  bus.send(queueName, message);

  const first = await waitForMessage(
    receiver,
    queueName,
    (m) => m.correlationId === correlationId,
    { timeoutMs: 2_000, pollIntervalMs: 50, runId }
  );

  stats.deliveriesSeen += 1;
  demoStats.deliveriesSeen += 1;
  demoStats.firstDeliveries += 1;
  seenMessageIds.add(first.messageId);
  console.log(
    `${paint("[B]", ansi.bold, ansi.magenta)} delivery=${stats.deliveriesSeen} messageId=${paint(first.messageId, ansi.cyan)} ${paint("first-seen", ansi.cyan, ansi.bold)} -> settlement=${paint("none", ansi.yellow)} ${paint("(simulate handler crash/timeout)", ansi.dim)}`
  );

  const waitMs = LOCK_DURATION_MS + 300;
  console.log(
    `${paint("[B]", ansi.bold, ansi.magenta)} ${paint("waiting", ansi.yellow)} ${paint(`${waitMs}ms`, ansi.yellow, ansi.bold)} to pass lock timeout and force redelivery`
  );
  await sleep(waitMs);

  const redelivery = await waitForMessage(
    receiver,
    queueName,
    (m) => m.correlationId === correlationId,
    { timeoutMs: 2_000, pollIntervalMs: 50, runId }
  );

  stats.deliveriesSeen += 1;
  demoStats.deliveriesSeen += 1;
  if (seenMessageIds.has(redelivery.messageId)) {
    stats.duplicatesIgnored += 1;
    demoStats.duplicatesDetected += 1;
    demoStats.lockLostRedeliveries += 1;
    console.log(
      `${paint("[B]", ansi.bold, ansi.magenta)} delivery=${stats.deliveriesSeen} messageId=${paint(redelivery.messageId, ansi.yellow)} ${paint("duplicate detected", ansi.yellow, ansi.bold)} after lock-lost redelivery -> settlement=${paint("complete", ansi.green)}`
    );
  } else {
    seenMessageIds.add(redelivery.messageId);
    demoStats.firstDeliveries += 1;
    console.log(
      `${paint("[B]", ansi.bold, ansi.magenta)} delivery=${stats.deliveriesSeen} messageId=${paint(redelivery.messageId, ansi.cyan)} ${paint("first-seen", ansi.cyan, ansi.bold)} ${paint("(unexpected for this scenario)", ansi.red)} -> settlement=${paint("complete", ansi.green)}`
    );
  }
  await redelivery.complete();
  demoStats.completed += 1;

  console.log(
    `${paint("[B] summary", ansi.bold, ansi.blue)} deliveries seen=${paint(String(stats.deliveriesSeen), ansi.blue)}, duplicates ignored=${paint(String(stats.duplicatesIgnored), ansi.yellow)}`
  );
  console.log(
    `${paint("[B]", ansi.bold, ansi.magenta)} ${paint("note", ansi.gray)} this models ${paint("lock-lost redelivery", ansi.yellow)} in at-least-once delivery systems`
  );
}

async function run(): Promise<void> {
  const bus = new InMemoryBus({ lockDurationInMs: LOCK_DURATION_MS });

  await runScenarioA(bus);
  await runScenarioB(bus);

  console.log("---- DEMO 4 SUMMARY ----");
  console.log(demoStats);
  console.log(`runId: ${runId}`);
  console.log(`correlationId: ${correlationId}`);
  console.log(
    `SUMMARY: deliveries=${demoStats.deliveriesSeen} first=${demoStats.firstDeliveries} duplicates=${demoStats.duplicatesDetected} lockLost=${demoStats.lockLostRedeliveries} completed=${demoStats.completed}`
  );

  console.log(`\n${paint("=== Demo 4 complete ===", ansi.bold, ansi.green)}`);
}

run().catch((error) => {
  console.error(`${paint("[Demo-4] failed", ansi.bold, ansi.red)}`, error);
  process.exitCode = 1;
});
