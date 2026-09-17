const MAX_BIGINT = 9223372036854775807n;

function validateRate(ratePaisePerMinute: bigint, quantumSeconds: 30 | 60): void {
  if (typeof ratePaisePerMinute !== 'bigint' || ratePaisePerMinute <= 0n || ratePaisePerMinute > MAX_BIGINT) {
    throw new RangeError('Rate must be a positive PostgreSQL BIGINT in paise');
  }
  if (quantumSeconds !== 30 && quantumSeconds !== 60) throw new RangeError('Billing quantum must be 30 or 60 seconds');
  if (quantumSeconds === 30 && ratePaisePerMinute % 2n !== 0n) {
    throw new RangeError('30-second billing requires an even paise-per-minute rate');
  }
}

/** Pure arithmetic only; this is not the credit/reserve/settle service. */
export function calculateCallCharge(connectedDurationSeconds: bigint, ratePaisePerMinute: bigint, quantumSeconds: 30 | 60) {
  validateRate(ratePaisePerMinute, quantumSeconds);
  if (typeof connectedDurationSeconds !== 'bigint' || connectedDurationSeconds < 0n) {
    throw new RangeError('Connected duration must be nonnegative bigint seconds');
  }
  const quantum = BigInt(quantumSeconds);
  const billableSeconds = ((connectedDurationSeconds + quantum - 1n) / quantum) * quantum;
  const amountPaise = (billableSeconds / quantum) * (ratePaisePerMinute * quantum / 60n);
  if (amountPaise > MAX_BIGINT) throw new RangeError('Charge exceeds PostgreSQL BIGINT');
  return { billableSeconds, amountPaise };
}

export function calculateReservationAmount(maxConnectedDurationSeconds: bigint, terminationMarginSeconds: bigint,
  ratePaisePerMinute: bigint, quantumSeconds: 30 | 60): bigint {
  if (maxConnectedDurationSeconds <= 0n || terminationMarginSeconds < 0n) {
    throw new RangeError('Maximum duration must be positive and termination margin nonnegative');
  }
  const amount = calculateCallCharge(maxConnectedDurationSeconds + terminationMarginSeconds, ratePaisePerMinute, quantumSeconds).amountPaise;
  if (amount < ratePaisePerMinute) throw new RangeError('Reserve must cover at least one minute');
  return amount;
}
