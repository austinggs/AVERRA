import 'server-only';

// Structured server logging.
//
// Why this exists: doc 62 requires logs that carry a correlation ID across
// user action, API request, async job, provider callback, ledger event and payout
// operation. console.log with an interpolated string cannot be queried, and a
// financial system whose logs cannot be correlated is not auditable.
//
// Rules:
//   * Never log a secret, a key, a full token address, or a raw request body
//     that may contain one. redact() is used for values that look sensitive.
//   * Never log a balance amount under a key a human would assume is final.
//     Amounts are logged with their currency and their source.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'secret',
  'key',
  'authorization',
  'cookie',
  'supabase_secret_key',
  'publishablekey',
  'service_role',
  'tx_hash',
  'txhash',
]);

/** Redacts obviously sensitive values before anything reaches a log sink. */
export function redact(fields: LogFields): LogFields {
  const output: LogFields = {};

  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      output[key] = '[redacted]';
      continue;
    }

    if (typeof value === 'bigint') {
      output[key] = value.toString(10);
      continue;
    }

    if (value instanceof Error) {
      output[key] = { name: value.name, message: value.message };
      continue;
    }

    output[key] = value;
  }

  return output;
}

function emit(level: LogLevel, message: string, fields: LogFields = {}): void {
  const entry = {
    level,
    message,
    time: new Date().toISOString(),
    ...redact(fields),
  };

  // Serialised as one JSON object per line so a log pipeline can parse it.
  const line = JSON.stringify(entry);

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, fields?: LogFields) => emit('debug', message, fields),
  info: (message: string, fields?: LogFields) => emit('info', message, fields),
  warn: (message: string, fields?: LogFields) => emit('warn', message, fields),
  error: (message: string, fields?: LogFields) => emit('error', message, fields),
};

/** Business signals from doc 62 FINANCIAL SIGNALS, emitted for alerting. */
export const metrics = {
  rewardGranted: (fields: { userId: string; amountMinor: bigint; unit: string; state: string }) =>
    logger.info('metric.reward_granted', fields),

  depositConfirmed: (fields: { userId: string; amountMinor: bigint; unit: string }) =>
    logger.info('metric.deposit_confirmed', fields),

  withdrawalRequested: (fields: {
    userId: string;
    grossMinor: bigint;
    feeMinor: bigint;
    netMinor: bigint;
    unit: string;
  }) => logger.info('metric.withdrawal_requested', fields),

  withdrawalSettled: (fields: { userId: string; netMinor: bigint; unit: string }) =>
    logger.info('metric.withdrawal_settled', fields),

  rewardReversed: (fields: { rewardId: string; amountMinor: bigint; reason: string }) =>
    logger.warn('metric.reward_reversed', fields),

  // Queue depth and failure counts drive the operational dashboard (doc 62).
  outboxBacklog: (pending: number, failed: number, dead: number) =>
    logger.info('metric.outbox_backlog', { pending, failed, dead }),
};
