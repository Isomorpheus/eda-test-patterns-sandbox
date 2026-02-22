import { randomUUID } from "node:crypto";
import { BusMessage, InMemoryBus } from "./inMemoryBus";
import { waitForMessage } from "./waitForMessage";

const QUEUE_NAME = "orders-mini-flow-ordering";
const RUN_LABEL = "RUN A";
const RUN_ID = randomUUID();
const NEGATIVE_MODE = process.argv.includes("--negative");

const CORRELATIONS = ["A-1", "A-2", "A-3"] as const;
const EXPECTED_ORDER = ["FlowStarted", "FlowProcessed", "FlowCompleted"] as const;

type FlowSubject = (typeof EXPECTED_ORDER)[number];

type CorrState = {
  subjectsSeen: string[];
  messageIds: string[];
};

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

const colorForSubject = (subject: string): string => {
  if (subject === "FlowStarted") return ansi.blue;
  if (subject === "FlowProcessed") return ansi.yellow;
  if (subject === "FlowCompleted") return ansi.green;
  return ansi.gray;
};

const randomDelay = (minMs: number, maxMs: number): number => {
  const span = maxMs - minMs + 1;
  return minMs + Math.floor(Math.random() * span);
};

function buildMessage(correlationId: string, subject: FlowSubject, eventIndex: number): BusMessage {
  return {
    messageId: randomUUID(),
    correlationId,
    subject,
    body: {
      eventIndex
    },
    applicationProperties: {
      runId: RUN_ID,
      correlationId,
      schemaVersion: "1"
    } as BusMessage["applicationProperties"]
  };
}

function allCorrelationsComplete(eventsByCorr: Map<string, CorrState>): boolean {
  for (const corr of CORRELATIONS) {
    const state = eventsByCorr.get(corr);
    if (!state || state.subjectsSeen.length < EXPECTED_ORDER.length) {
      return false;
    }
  }

  return true;
}

function assertOrder(eventsByCorr: Map<string, CorrState>): void {
  const expectedJoined = EXPECTED_ORDER.join(" -> ");

  for (const corr of CORRELATIONS) {
    const actual = eventsByCorr.get(corr)?.subjectsSeen ?? [];
    const actualJoined = actual.join(" -> ");

    const sameLength = actual.length === EXPECTED_ORDER.length;
    const sameOrder =
      sameLength &&
      actual.every((subject, idx) => {
        return subject === EXPECTED_ORDER[idx];
      });

    if (!sameOrder) {
      console.error(paint("========================================", ansi.bold, ansi.red));
      console.error(paint("🚨 DEMO 6 ORDER VIOLATION 🚨", ansi.bold, ansi.red));
      console.error(paint("========================================", ansi.bold, ansi.red));
      console.error(`${paint("runId", ansi.bold)}=${RUN_ID}`);
      console.error(`${paint("correlationId", ansi.bold)}=${paint(corr, ansi.cyan)}`);
      console.error(`${paint("expected", ansi.bold)}=${paint(expectedJoined, ansi.green)}`);
      console.error(`${paint("actual", ansi.bold)}=${paint(actualJoined || "<none>", ansi.yellow)}`);
      console.error(paint("========================================", ansi.bold, ansi.red));
      throw new Error(`Ordering mismatch for correlationId=${corr}`);
    }
  }
}

async function runDemo(): Promise<void> {
  console.log(`\n${paint("=== Block 6: mini flow ordering per correlationId ===", ansi.bold, ansi.magenta)}`);
  console.log(`${paint("RUN A", ansi.bold, ansi.cyan)} | runId=${RUN_ID}`);
  if (NEGATIVE_MODE) {
    console.log(paint("Mode: --negative (expect ordering failure)", ansi.bold, ansi.yellow));
  } else {
    console.log(paint("Mode: normal", ansi.bold, ansi.green));
  }

  const bus = new InMemoryBus({ lockDurationInMs: 15_000 });
  const receiver = bus.createReceiver(QUEUE_NAME, { receiveMode: "peekLock" });

  const eventsByCorr = new Map<string, CorrState>();
  const seenMessageIds = new Set<string>();

  for (const corr of CORRELATIONS) {
    eventsByCorr.set(corr, { subjectsSeen: [], messageIds: [] });
  }

  const sendTasks = CORRELATIONS.map((corr) =>
    (async () => {
      const subjectOrder: readonly FlowSubject[] =
        NEGATIVE_MODE && corr === "A-2"
          ? (["FlowProcessed", "FlowStarted", "FlowCompleted"] as const)
          : EXPECTED_ORDER;

      for (let i = 0; i < subjectOrder.length; i += 1) {
        const subject = subjectOrder[i];
        const delayMs = randomDelay(20, 120);
        await sleep(delayMs);

        const msg = buildMessage(corr, subject, i + 1);
        bus.send(QUEUE_NAME, msg);
        console.log(
          `${paint("[SEND]", ansi.bold, ansi.gray)} runId=${RUN_ID} | corr=${paint(corr, ansi.cyan)} | subject=${paint(subject, ansi.bold, colorForSubject(subject))} | msg=${msg.messageId} | delayMs=${paint(String(delayMs), ansi.gray)}`
        );
      }
    })()
  );

  while (!allCorrelationsComplete(eventsByCorr)) {
    const msg = await waitForMessage(
      receiver,
      QUEUE_NAME,
      (m) => {
        const subjectOk = EXPECTED_ORDER.includes(m.subject as FlowSubject);
        const corr = String((m.applicationProperties as { correlationId?: string }).correlationId ?? m.correlationId);
        const corrOk = CORRELATIONS.includes(corr as (typeof CORRELATIONS)[number]);
        return subjectOk && corrOk;
      },
      { timeoutMs: 15_000, pollIntervalMs: 50, runId: RUN_ID }
    );

    const corr = String((msg.applicationProperties as { correlationId?: string }).correlationId ?? msg.correlationId);
    const subject = msg.subject;

    if (!CORRELATIONS.includes(corr as (typeof CORRELATIONS)[number])) {
      await msg.complete();
      throw new Error(`Unexpected correlationId received: ${corr}`);
    }

    const firstOrDuplicate = seenMessageIds.has(msg.messageId) ? "DUPLICATE" : "FIRST";

    if (!seenMessageIds.has(msg.messageId)) {
      seenMessageIds.add(msg.messageId);

      const state = eventsByCorr.get(corr);
      if (!state) {
        await msg.complete();
        throw new Error(`Missing state for correlationId=${corr}`);
      }

      state.subjectsSeen.push(subject);
      state.messageIds.push(msg.messageId);
    }

    await msg.complete();

    console.log(
      `${paint(RUN_LABEL, ansi.bold, ansi.cyan)} | runId=${RUN_ID} | corr=${paint(corr, ansi.cyan)} | msg=${msg.messageId} | subject=${paint(subject, ansi.bold, colorForSubject(subject))} | ${paint(firstOrDuplicate, firstOrDuplicate === "FIRST" ? ansi.green : ansi.yellow)} | ${paint("complete", ansi.bold, ansi.green)}`
    );
  }

  await Promise.all(sendTasks);

  assertOrder(eventsByCorr);

  console.log(paint("---- DEMO 6 SUMMARY ----", ansi.bold, ansi.magenta));
  for (const corr of CORRELATIONS) {
    const subjects = eventsByCorr.get(corr)?.subjectsSeen ?? [];
    const order = subjects
      .map((subject) => paint(subject, ansi.bold, colorForSubject(subject)))
      .join(paint(" -> ", ansi.gray));
    console.log(`${paint("corr", ansi.bold)} ${paint(corr, ansi.cyan)}: ${order || "<none>"}`);
  }
  console.log(paint("========================================", ansi.bold, ansi.green));
  console.log(paint("PASS: ordering verified per correlationId", ansi.bold, ansi.green));
  console.log(paint("========================================", ansi.bold, ansi.green));
  console.log("");
}

async function main(): Promise<void> {
  try {
    await runDemo();

    if (NEGATIVE_MODE) {
      console.error(paint("ERROR: negative mode did NOT trigger ordering violation", ansi.bold, ansi.red));
      process.exitCode = 1;
    }
  } catch (error) {
    if (NEGATIVE_MODE) {
      console.log(paint("EXPECTED FAILURE: ordering violation detected", ansi.bold, ansi.yellow));
      return;
    }

    console.error(`${paint("[Demo-06] Failed:", ansi.bold, ansi.red)}`, error);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`${paint("[Demo-06] Failed:", ansi.bold, ansi.red)}`, error);
  process.exitCode = 1;
});
