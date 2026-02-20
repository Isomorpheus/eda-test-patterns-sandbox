export interface BusMessage {
  messageId: string;
  correlationId: string;
  subject: string;
  body: unknown;
  applicationProperties: {
    runId: string;
    schemaVersion: string;
  };
}

export interface ReceiveOptions {
  maxWaitTimeInMs?: number;
}

export interface ReceiverOptions {
  receiveMode: "peekLock";
}

export interface ReceivedBusMessage extends BusMessage {
  deliveryCount: number;
  lockedUntilUtc: Date;
  complete(): Promise<void>;
  abandon(): Promise<void>;
  deadLetter(reason: string): Promise<void>;
}

interface QueueMessageEnvelope {
  message: BusMessage;
  state: "available" | "locked";
  deliveryCount: number;
  lockedUntilEpochMs: number | null;
  lockOwnerId: string | null;
}

interface DeadLetterRecord {
  message: BusMessage;
  reason: string;
  deadLetteredAt: string;
}

interface BusOptions {
  lockDurationInMs?: number;
  simulateDuplicatesOnComplete?: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class InMemoryBus {
  private readonly queues = new Map<string, QueueMessageEnvelope[]>();
  private readonly deadLetterQueues = new Map<string, DeadLetterRecord[]>();
  private receiverCounter = 0;
  private lockDurationInMs: number;
  private simulateDuplicatesOnComplete: boolean;

  constructor(options?: BusOptions) {
    this.lockDurationInMs = options?.lockDurationInMs ?? 10_000;
    this.simulateDuplicatesOnComplete = options?.simulateDuplicatesOnComplete ?? false;
  }

  public setDuplicateSimulation(enabled: boolean): void {
    this.simulateDuplicatesOnComplete = enabled;
    console.log(`[Bus] Duplicate simulation set to ${enabled}`);
  }

  public send(queueName: string, message: BusMessage): void {
    const queue = this.getOrCreateQueue(queueName);
    queue.push({
      message: this.cloneMessage(message),
      state: "available",
      deliveryCount: 0,
      lockedUntilEpochMs: null,
      lockOwnerId: null
    });

    console.log(
      `[Bus] Sent message ${message.messageId} to queue '${queueName}' (schema=${message.applicationProperties.schemaVersion})`
    );
  }

  public createReceiver(queueName: string, options: ReceiverOptions): {
    receiveMessages: (max: number, receiveOptions?: ReceiveOptions) => Promise<ReceivedBusMessage[]>;
  } {
    if (options.receiveMode !== "peekLock") {
      throw new Error("Only peekLock mode is supported by InMemoryBus.");
    }

    this.getOrCreateQueue(queueName);
    const receiverId = `receiver-${++this.receiverCounter}`;

    console.log(`[Bus] Created receiver ${receiverId} for queue '${queueName}' in peekLock mode`);

    return {
      receiveMessages: async (max: number, receiveOptions?: ReceiveOptions) => {
        return this.receiveMessages(receiverId, queueName, max, receiveOptions);
      }
    };
  }

  public getDeadLetterQueue(queueName: string): DeadLetterRecord[] {
    const dlq = this.deadLetterQueues.get(queueName) ?? [];
    return dlq.map((record) => ({
      message: this.cloneMessage(record.message),
      reason: record.reason,
      deadLetteredAt: record.deadLetteredAt
    }));
  }

  private async receiveMessages(
    receiverId: string,
    queueName: string,
    max: number,
    options?: ReceiveOptions
  ): Promise<ReceivedBusMessage[]> {
    if (max <= 0) {
      return [];
    }

    const maxWaitTimeInMs = options?.maxWaitTimeInMs ?? 0;
    const deadline = Date.now() + maxWaitTimeInMs;

    while (true) {
      this.releaseExpiredLocks(queueName);
      const queue = this.getOrCreateQueue(queueName);

      const available = queue.filter((envelope) => envelope.state === "available").slice(0, max);
      if (available.length > 0) {
        const now = Date.now();

        const wrapped = available.map((envelope) => {
          envelope.state = "locked";
          envelope.lockOwnerId = receiverId;
          envelope.lockedUntilEpochMs = now + this.lockDurationInMs;
          envelope.deliveryCount += 1;

          console.log(
            `[Bus] Locked message ${envelope.message.messageId} for ${receiverId} until ${new Date(
              envelope.lockedUntilEpochMs
            ).toISOString()}`
          );

          return this.wrapReceivedMessage(queueName, receiverId, envelope);
        });

        return wrapped;
      }

      if (Date.now() >= deadline) {
        return [];
      }

      await sleep(25);
    }
  }

  private wrapReceivedMessage(
    queueName: string,
    receiverId: string,
    envelope: QueueMessageEnvelope
  ): ReceivedBusMessage {
    const checkActiveLock = (): void => {
      this.releaseExpiredLocks(queueName);
      if (envelope.state !== "locked" || envelope.lockOwnerId !== receiverId) {
        throw new Error(`Message ${envelope.message.messageId} is no longer locked by this receiver.`);
      }
    };

    return {
      ...this.cloneMessage(envelope.message),
      deliveryCount: envelope.deliveryCount,
      lockedUntilUtc: new Date(envelope.lockedUntilEpochMs ?? Date.now()),
      complete: async () => {
        checkActiveLock();

        const queue = this.getOrCreateQueue(queueName);
        const idx = queue.indexOf(envelope);
        if (idx >= 0) {
          queue.splice(idx, 1);
        }

        console.log(`[Bus] Completed message ${envelope.message.messageId} from queue '${queueName}'`);

        if (this.simulateDuplicatesOnComplete) {
          const duplicate = this.cloneMessage(envelope.message);
          this.send(queueName, duplicate);
          console.log(`[Bus] Duplicate simulated for message ${duplicate.messageId}`);
        }
      },
      abandon: async () => {
        checkActiveLock();

        envelope.state = "available";
        envelope.lockOwnerId = null;
        envelope.lockedUntilEpochMs = null;

        console.log(`[Bus] Abandoned message ${envelope.message.messageId}; it is visible again`);
      },
      deadLetter: async (reason: string) => {
        checkActiveLock();

        const queue = this.getOrCreateQueue(queueName);
        const idx = queue.indexOf(envelope);
        if (idx >= 0) {
          queue.splice(idx, 1);
        }

        const dlq = this.getOrCreateDeadLetterQueue(queueName);
        dlq.push({
          message: this.cloneMessage(envelope.message),
          reason,
          deadLetteredAt: new Date().toISOString()
        });

        console.log(
          `[Bus] Dead-lettered message ${envelope.message.messageId} from '${queueName}' with reason: ${reason}`
        );
      }
    };
  }

  private releaseExpiredLocks(queueName: string): void {
    const queue = this.getOrCreateQueue(queueName);
    const now = Date.now();

    for (const envelope of queue) {
      if (
        envelope.state === "locked" &&
        envelope.lockedUntilEpochMs !== null &&
        envelope.lockedUntilEpochMs <= now
      ) {
        envelope.state = "available";
        envelope.lockOwnerId = null;
        envelope.lockedUntilEpochMs = null;

        console.log(`[Bus] Lock expired for message ${envelope.message.messageId}; visible again`);
      }
    }
  }

  private getOrCreateQueue(queueName: string): QueueMessageEnvelope[] {
    let queue = this.queues.get(queueName);
    if (!queue) {
      queue = [];
      this.queues.set(queueName, queue);
    }

    return queue;
  }

  private getOrCreateDeadLetterQueue(queueName: string): DeadLetterRecord[] {
    let dlq = this.deadLetterQueues.get(queueName);
    if (!dlq) {
      dlq = [];
      this.deadLetterQueues.set(queueName, dlq);
    }

    return dlq;
  }

  private cloneMessage(message: BusMessage): BusMessage {
    return {
      messageId: message.messageId,
      correlationId: message.correlationId,
      subject: message.subject,
      body: message.body,
      applicationProperties: {
        runId: message.applicationProperties.runId,
        schemaVersion: message.applicationProperties.schemaVersion
      }
    };
  }
}
