import { ReceivedBusMessage } from "./inMemoryBus";

type ReceiveLike = {
  receiveMessages: (
    max: number,
    receiveOptions?: { maxWaitTimeInMs?: number }
  ) => Promise<ReceivedBusMessage[]>;
};

export type WaitForMessageOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
  runId?: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForMessage(
  receiver: ReceiveLike,
  queueName: string,
  predicate: (message: ReceivedBusMessage) => boolean,
  options?: WaitForMessageOptions
): Promise<ReceivedBusMessage> {
  const timeoutMs = options?.timeoutMs ?? 2_000;
  const pollIntervalMs = options?.pollIntervalMs ?? 50;
  const runId = options?.runId;
  const startedAt = Date.now();

  let scanned = 0;
  let runIdFiltered = 0;

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
    scanned += 1;

    if (runId && message.applicationProperties.runId !== runId) {
      runIdFiltered += 1;
      console.log(
        `[waitForMessage] queue=${queueName} runId-filter miss messageId=${message.messageId} actualRunId=${message.applicationProperties.runId} expectedRunId=${runId}`
      );
      await message.abandon();
      continue;
    }

    if (!predicate(message)) {
      console.log(
        `[waitForMessage] queue=${queueName} predicate miss messageId=${message.messageId} runId=${message.applicationProperties.runId}`
      );
      await message.abandon();
      continue;
    }

    console.log(
      `[waitForMessage] queue=${queueName} matched messageId=${message.messageId} runId=${message.applicationProperties.runId} scanned=${scanned} filteredByRunId=${runIdFiltered}`
    );

    return message;
  }

  throw new Error(
    `[waitForMessage] timeout queue=${queueName} timeoutMs=${timeoutMs} scanned=${scanned} filteredByRunId=${runIdFiltered}`
  );
}
