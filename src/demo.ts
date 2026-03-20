


import { BusMessage, InMemoryBus } from "./inMemoryBus";

const RECEIVE_DEADLINE_MS = 2_000;
const ACTIVE_RUN_ID = "weekend-run-001";

type DemoReceiver = {
  receiveMessages: (
    max: number,
    receiveOptions?: { maxWaitTimeInMs?: number }
  ) => Promise<Array<BusMessage & { complete(): Promise<void>; abandon(): Promise<void> }>>;
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

  const colorizeMessage = (message: string): string => {
    return message
      .replaceAll("complete", paint("complete", ansi.green))
      .replaceAll("completing", paint("completing", ansi.green))
      .replaceAll("abandon", paint("abandon", ansi.yellow))
      .replaceAll("abandoning", paint("abandoning", ansi.yellow))
      .replaceAll("dead-letter", paint("dead-letter", ansi.red))
      .replaceAll("timeout", paint("timeout", ansi.magenta))
      .replaceAll("PASS", paint("PASS", ansi.green, ansi.bold))
      .replaceAll("CHECK", paint("CHECK", ansi.yellow, ansi.bold))
      .replaceAll("BLOCKED", paint("BLOCKED", ansi.yellow, ansi.bold));
  };

  const log = (scope: "Demo" | "Diag", message: string): void => {
    const prefix =
      scope === "Demo"
        ? paint("[Demo]", ansi.bold, ansi.cyan)
        : paint("[Diag]", ansi.bold, ansi.blue);
    console.log(`${prefix} ${colorizeMessage(message)}`);
  };

  console.log(`\n${paint("=== InMemoryBus demo (peekLock + settlement + DLQ) ===", ansi.bold, ansi.cyan)}`);

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

  separator();
  log("Demo", "Log 8: run isolation first-gating demo");
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
  log("Demo", "Log 9: timeout -> throw with context (predicate resolver)");
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

  console.log(`${paint("=== Demo complete ===", ansi.bold, ansi.green)}\n`);
}

runDemo().catch((error) => {
  console.error(`${paint("[Demo] Failed:", ansi.bold, ansi.red)}`, error);
  process.exitCode = 1;
});

type DeepPartial<T> =
  T extends Date ? T :
  T extends Array<infer U> ? Array<DeepPartial<U>> :
  T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } :
  T;

export function removeBlackListedProperties<T>(
  obj: T,
  keysToRemove: readonly string[],
): DeepPartial<T> {
  const blacklist = new Set(keysToRemove);
  const cache = new WeakMap<object, unknown>();

  return sanitizeBlackListedProperties(obj, blacklist, cache) as DeepPartial<T>;
}

function sanitizeBlackListedProperties(
  obj: unknown,
  blacklist: ReadonlySet<string>,
  cache: WeakMap<object, unknown>,
): unknown {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  const cached = cache.get(obj);
  if (cached !== undefined) {
    return cached;
  }

  if (Array.isArray(obj)) {
    const cleanedArray: unknown[] = [];
    cache.set(obj, cleanedArray);

    for (const item of obj) {
      cleanedArray.push(
        sanitizeBlackListedProperties(item, blacklist, cache),
      );
    }

    return cleanedArray;
  }

  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    return obj;
  }

  const cleanedObject: Record<string, unknown> = {};
  cache.set(obj, cleanedObject);

  for (const [key, value] of Object.entries(obj)) {
    if (blacklist.has(key)) {
      continue;
    }

    cleanedObject[key] = sanitizeBlackListedProperties(value, blacklist, cache);
  }

  return cleanedObject;
}
