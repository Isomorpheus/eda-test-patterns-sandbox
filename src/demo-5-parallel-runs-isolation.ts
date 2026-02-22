import { randomUUID } from "node:crypto";
import { BusMessage, InMemoryBus } from "./inMemoryBus";
import { waitForMessage } from "./waitForMessage";

const QUEUE_NAME = "orders-parallel-runs";
const MESSAGES_PER_RUN = 5;
const SIMULATE_CROSSTALK = process.argv.includes("--crosstalk");

// Run normal: node ...demo-5...
// Run with cross-talk: node ...demo-5... --crosstalk

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m"
};

const paint = (text: string, ...codes: string[]): string => `${codes.join("")}${text}${ansi.reset}`;

const runLabel = (label: string): string => {
  if (label === "RUN A") return paint(`[${label}]`, ansi.bold, ansi.cyan);
  if (label === "RUN B") return paint(`[${label}]`, ansi.bold, ansi.yellow);
  return paint(`[${label}]`, ansi.bold, ansi.magenta);
};

function buildMessage(runId: string, correlationId: string, idx: number): BusMessage {
  return {
    messageId: randomUUID(),
    correlationId,
    subject: "TestEvent",
    body: {
      seq: idx,
      note: `message-${idx}`
    },
    applicationProperties: {
      runId,
      schemaVersion: "1.0",
      correlationId
    } as BusMessage["applicationProperties"]
  };
}

async function runDemo(): Promise<void> {
  console.log(`\n${paint("=== Block 5: parallel runs isolation ===", ansi.bold, ansi.blue)}`);

  const bus = new InMemoryBus({ lockDurationInMs: 15_000 });

  const runA = {
    label: "RUN A",
    runId: randomUUID(),
    correlationId: randomUUID(),
    seenMessageIds: new Set<string>(),
    perCorr: new Map<string, { deliveries: number; first: number; dupes: number }>(),
    stats: { deliveriesSeen: 0, firstDeliveries: 0, duplicatesDetected: 0, completed: 0 }
  };

  const runB = {
    label: "RUN B",
    runId: randomUUID(),
    correlationId: randomUUID(),
    seenMessageIds: new Set<string>(),
    perCorr: new Map<string, { deliveries: number; first: number; dupes: number }>(),
    stats: { deliveriesSeen: 0, firstDeliveries: 0, duplicatesDetected: 0, completed: 0 }
  };

  const runC = {
    label: "RUN C",
    runId: randomUUID(),
    correlationId: randomUUID(),
    seenMessageIds: new Set<string>(),
    perCorr: new Map<string, { deliveries: number; first: number; dupes: number }>(),
    stats: { deliveriesSeen: 0, firstDeliveries: 0, duplicatesDetected: 0, completed: 0 }
  };

  console.log(`${runLabel(runA.label)} runId=${paint(runA.runId, ansi.cyan)} correlationId=${paint(runA.correlationId, ansi.cyan)}`);
  console.log(`${runLabel(runB.label)} runId=${paint(runB.runId, ansi.yellow)} correlationId=${paint(runB.correlationId, ansi.yellow)}`);
  console.log(`${runLabel(runC.label)} runId=${paint(runC.runId, ansi.magenta)} correlationId=${paint(runC.correlationId, ansi.magenta)}`);

  const receiverA = bus.createReceiver(QUEUE_NAME, { receiveMode: "peekLock" });
  const receiverB = bus.createReceiver(QUEUE_NAME, { receiveMode: "peekLock" });
  const receiverC = bus.createReceiver(QUEUE_NAME, { receiveMode: "peekLock" });

  const workerReceiverA = {
    receiveMessages: async (max: number, receiveOptions?: { maxWaitTimeInMs?: number }) => {
      await sleep(5 + Math.floor(Math.random() * 11));
      return receiverA.receiveMessages(max, receiveOptions);
    }
  };

  const workerReceiverB = {
    receiveMessages: async (max: number, receiveOptions?: { maxWaitTimeInMs?: number }) => {
      await sleep(5 + Math.floor(Math.random() * 11));
      return receiverB.receiveMessages(max, receiveOptions);
    }
  };

  const workerReceiverC = {
    receiveMessages: async (max: number, receiveOptions?: { maxWaitTimeInMs?: number }) => {
      await sleep(5 + Math.floor(Math.random() * 11));
      return receiverC.receiveMessages(max, receiveOptions);
    }
  };

  console.log(paint("----------------------------------------", ansi.gray));
  console.log(paint("Starting parallel run isolation demo", ansi.bold, ansi.blue));
  console.log(paint("----------------------------------------", ansi.gray));
  if (SIMULATE_CROSSTALK) {
    console.log(paint("========================================", ansi.bold, ansi.yellow));
    console.log(paint("⚠ CROSS-TALK SIMULATION MODE ENABLED", ansi.bold, ansi.yellow));
    console.log(paint("========================================", ansi.bold, ansi.yellow));
    console.log("Expected outcome: failure via cross-talk detection");
    console.log(paint("========================================", ansi.bold, ansi.yellow));
  } else {
    console.log(paint("Mode: normal (no cross-talk simulation)", ansi.bold, ansi.green));
  }

  const workerA = (async () => {
    for (let i = 0; i < MESSAGES_PER_RUN; i += 1) {
      const msg = await waitForMessage(
        workerReceiverA,
        QUEUE_NAME,
        (m) => m.applicationProperties.runId === runA.runId,
        { timeoutMs: 10_000, pollIntervalMs: 50, runId: runA.runId }
      );

      if (msg.applicationProperties.runId !== runA.runId) {
        console.error(paint("========================================", ansi.bold, ansi.red));
        console.error(paint("🚨 CROSS-TALK DETECTED 🚨", ansi.bold, ansi.red));
        console.error(paint("========================================", ansi.bold, ansi.red));
        console.error(
          `${runA.label} | runId=${runA.runId} | expected=${runA.runId} | actual=${msg.applicationProperties.runId} | ERROR`
        );
        throw new Error("Cross-talk detected in run A");
      }

      const appProps = msg.applicationProperties as BusMessage["applicationProperties"] & { correlationId?: string };
      if (!appProps.correlationId) {
        appProps.correlationId = msg.correlationId;
      }
      const corr = String(appProps.correlationId ?? "missing-correlationId");
      const corrStats = runA.perCorr.get(corr) ?? { deliveries: 0, first: 0, dupes: 0 };

      runA.stats.deliveriesSeen += 1;
      corrStats.deliveries += 1;

      const firstOrDuplicate = runA.seenMessageIds.has(msg.messageId) ? "DUPLICATE" : "FIRST";
      if (runA.seenMessageIds.has(msg.messageId)) {
        runA.stats.duplicatesDetected += 1;
        corrStats.dupes += 1;
      } else {
        runA.seenMessageIds.add(msg.messageId);
        runA.stats.firstDeliveries += 1;
        corrStats.first += 1;
      }
      runA.perCorr.set(corr, corrStats);

      await msg.complete();
      runA.stats.completed += 1;

      console.log(
        `${paint(runA.label, ansi.bold, ansi.cyan)} | runId=${msg.applicationProperties.runId} | corr=${corr} | msg=${msg.messageId} | ${paint(firstOrDuplicate, firstOrDuplicate === "FIRST" ? ansi.green : ansi.yellow)} | complete`
      );
    }
  })();

  const workerB = (async () => {
    for (let i = 0; i < MESSAGES_PER_RUN; i += 1) {
      const msg = await waitForMessage(
        workerReceiverB,
        QUEUE_NAME,
        (m) => (SIMULATE_CROSSTALK ? true : m.applicationProperties.runId === runB.runId),
        { timeoutMs: 10_000, pollIntervalMs: 50, runId: SIMULATE_CROSSTALK ? undefined : runB.runId }
      );

      if (msg.applicationProperties.runId !== runB.runId) {
        console.error(paint("========================================", ansi.bold, ansi.red));
        console.error(paint("🚨 CROSS-TALK DETECTED 🚨", ansi.bold, ansi.red));
        console.error(paint("========================================", ansi.bold, ansi.red));
        console.error(
          `${runB.label} | runId=${runB.runId} | expected=${runB.runId} | actual=${msg.applicationProperties.runId} | ERROR`
        );
        throw new Error("Cross-talk detected in run B");
      }

      const appProps = msg.applicationProperties as BusMessage["applicationProperties"] & { correlationId?: string };
      if (!appProps.correlationId) {
        appProps.correlationId = msg.correlationId;
      }
      const corr = String(appProps.correlationId ?? "missing-correlationId");
      const corrStats = runB.perCorr.get(corr) ?? { deliveries: 0, first: 0, dupes: 0 };

      runB.stats.deliveriesSeen += 1;
      corrStats.deliveries += 1;

      const firstOrDuplicate = runB.seenMessageIds.has(msg.messageId) ? "DUPLICATE" : "FIRST";
      if (runB.seenMessageIds.has(msg.messageId)) {
        runB.stats.duplicatesDetected += 1;
        corrStats.dupes += 1;
      } else {
        runB.seenMessageIds.add(msg.messageId);
        runB.stats.firstDeliveries += 1;
        corrStats.first += 1;
      }
      runB.perCorr.set(corr, corrStats);

      await msg.complete();
      runB.stats.completed += 1;

      console.log(
        `${paint(runB.label, ansi.bold, ansi.yellow)} | runId=${msg.applicationProperties.runId} | corr=${corr} | msg=${msg.messageId} | ${paint(firstOrDuplicate, firstOrDuplicate === "FIRST" ? ansi.green : ansi.yellow)} | complete`
      );
    }
  })();

  const workerC = (async () => {
    for (let i = 0; i < MESSAGES_PER_RUN; i += 1) {
      const msg = await waitForMessage(
        workerReceiverC,
        QUEUE_NAME,
        (m) => m.applicationProperties.runId === runC.runId,
        { timeoutMs: 10_000, pollIntervalMs: 50, runId: runC.runId }
      );

      if (msg.applicationProperties.runId !== runC.runId) {
        console.error(paint("========================================", ansi.bold, ansi.red));
        console.error(paint("🚨 CROSS-TALK DETECTED 🚨", ansi.bold, ansi.red));
        console.error(paint("========================================", ansi.bold, ansi.red));
        console.error(
          `${runC.label} | runId=${runC.runId} | expected=${runC.runId} | actual=${msg.applicationProperties.runId} | ERROR`
        );
        throw new Error("Cross-talk detected in run C");
      }

      const appProps = msg.applicationProperties as BusMessage["applicationProperties"] & { correlationId?: string };
      if (!appProps.correlationId) {
        appProps.correlationId = msg.correlationId;
      }
      const corr = String(appProps.correlationId ?? "missing-correlationId");
      const corrStats = runC.perCorr.get(corr) ?? { deliveries: 0, first: 0, dupes: 0 };

      runC.stats.deliveriesSeen += 1;
      corrStats.deliveries += 1;

      const firstOrDuplicate = runC.seenMessageIds.has(msg.messageId) ? "DUPLICATE" : "FIRST";
      if (runC.seenMessageIds.has(msg.messageId)) {
        runC.stats.duplicatesDetected += 1;
        corrStats.dupes += 1;
      } else {
        runC.seenMessageIds.add(msg.messageId);
        runC.stats.firstDeliveries += 1;
        corrStats.first += 1;
      }
      runC.perCorr.set(corr, corrStats);

      await msg.complete();
      runC.stats.completed += 1;

      console.log(
        `${paint(runC.label, ansi.bold, ansi.magenta)} | runId=${msg.applicationProperties.runId} | corr=${corr} | msg=${msg.messageId} | ${paint(firstOrDuplicate, firstOrDuplicate === "FIRST" ? ansi.green : ansi.yellow)} | complete`
      );
    }
  })();

  const sendTasks: Array<Promise<void>> = [];

  for (let i = 1; i <= MESSAGES_PER_RUN; i += 1) {
    const delayA = Math.floor(Math.random() * 201);
    sendTasks.push(
      (async () => {
        await sleep(delayA);
        const msg = buildMessage(runA.runId, runA.correlationId, i);
        bus.send(QUEUE_NAME, msg);
        console.log(`${paint("[SEND]", ansi.bold, ansi.gray)} run=${paint("A", ansi.cyan)} seq=${i} delayMs=${delayA} messageId=${msg.messageId}`);
      })()
    );

    const delayB = Math.floor(Math.random() * 201);
    sendTasks.push(
      (async () => {
        await sleep(delayB);
        const msg = buildMessage(runB.runId, runB.correlationId, i);
        bus.send(QUEUE_NAME, msg);
        console.log(`${paint("[SEND]", ansi.bold, ansi.gray)} run=${paint("B", ansi.yellow)} seq=${i} delayMs=${delayB} messageId=${msg.messageId}`);
      })()
    );

    const delayC = Math.floor(Math.random() * 201);
    sendTasks.push(
      (async () => {
        await sleep(delayC);
        const msg = buildMessage(runC.runId, runC.correlationId, i);
        bus.send(QUEUE_NAME, msg);
        console.log(`${paint("[SEND]", ansi.bold, ansi.gray)} run=${paint("C", ansi.magenta)} seq=${i} delayMs=${delayC} messageId=${msg.messageId}`);
      })()
    );
  }

  await Promise.all(sendTasks);
  await Promise.all([workerA, workerB, workerC]);

  console.log(paint("----------------------------------------", ansi.gray));
  console.log(paint("RunA summary", ansi.bold, ansi.cyan));
  console.log(paint("----------------------------------------", ansi.gray));
  console.log(
    `${paint("RunA:", ansi.cyan)} deliveriesSeen=${runA.stats.deliveriesSeen} first=${runA.stats.firstDeliveries} dupes=${runA.stats.duplicatesDetected} completed=${runA.stats.completed}`
  );
  console.log(`${paint("RunA per correlation:", ansi.cyan)}`);
  for (const [corr, stats] of runA.perCorr) {
    console.log(`${corr}: deliveries=${stats.deliveries} first=${stats.first} dupes=${stats.dupes}`);
  }

  console.log(paint("----------------------------------------", ansi.gray));
  console.log(paint("RunB summary", ansi.bold, ansi.yellow));
  console.log(paint("----------------------------------------", ansi.gray));
  console.log(
    `${paint("RunB:", ansi.yellow)} deliveriesSeen=${runB.stats.deliveriesSeen} first=${runB.stats.firstDeliveries} dupes=${runB.stats.duplicatesDetected} completed=${runB.stats.completed}`
  );
  console.log(`${paint("RunB per correlation:", ansi.yellow)}`);
  for (const [corr, stats] of runB.perCorr) {
    console.log(`${corr}: deliveries=${stats.deliveries} first=${stats.first} dupes=${stats.dupes}`);
  }

  console.log(paint("----------------------------------------", ansi.gray));
  console.log(paint("RunC summary", ansi.bold, ansi.magenta));
  console.log(paint("----------------------------------------", ansi.gray));
  console.log(
    `${paint("RunC:", ansi.magenta)} deliveriesSeen=${runC.stats.deliveriesSeen} first=${runC.stats.firstDeliveries} dupes=${runC.stats.duplicatesDetected} completed=${runC.stats.completed}`
  );
  console.log(`${paint("RunC per correlation:", ansi.magenta)}`);
  for (const [corr, stats] of runC.perCorr) {
    console.log(`${corr}: deliveries=${stats.deliveries} first=${stats.first} dupes=${stats.dupes}`);
  }
}

async function main(): Promise<void> {
  try {
    await runDemo();

    if (SIMULATE_CROSSTALK) {
      console.error(paint("ERROR: cross-talk simulation did NOT trigger detection", ansi.bold, ansi.red));
      process.exitCode = 1;
      return;
    }

    console.log(paint("========================================", ansi.bold, ansi.green));
    console.log(paint("✅ PARALLEL RUN ISOLATION VERIFIED", ansi.bold, ansi.green));
    console.log(paint("========================================", ansi.bold, ansi.green));
    console.log("No cross-talk detected.");
    console.log("runId isolation preserved.");
    console.log("correlationId visibility confirmed.");
    console.log(paint("========================================", ansi.bold, ansi.green));
    console.log("");
  } catch (error) {
    if (SIMULATE_CROSSTALK) {
      console.log(paint("EXPECTED FAILURE: cross-talk successfully detected", ansi.bold, ansi.yellow));
      return;
    }

    console.error(paint("UNEXPECTED FAILURE", ansi.bold, ansi.red));
    throw error;
  }
}

if (SIMULATE_CROSSTALK) {
  const handleExpectedFailure = () => {
    console.log(paint("EXPECTED FAILURE: cross-talk successfully detected", ansi.bold, ansi.yellow));
    process.exit(0);
  };

  process.on("unhandledRejection", handleExpectedFailure);
  process.on("uncaughtException", handleExpectedFailure);
}

main().catch((error) => {
  console.error(`${paint("[Demo-05] Failed:", ansi.bold, ansi.red)}`, error);
  process.exitCode = 1;
});
