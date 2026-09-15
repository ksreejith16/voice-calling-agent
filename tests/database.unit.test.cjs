const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateCallCharge, calculateReservationAmount, parsePaise, serializeBigInts,
  capturedFieldsSchema, transcriptSchema, extractedAnalysisSchema, consentEvidenceSchema,
  callingConfigurationSchema, retryConfigurationSchema } = require('../packages/database/dist');

test('talk-time billing rounds up exact integer quanta, including never-connected zero', () => {
  for (const [duration, rate, quantum, seconds, charge] of [
    [0n, 100n, 60, 0n, 0n], [1n, 100n, 60, 60n, 100n], [60n, 100n, 60, 60n, 100n],
    [61n, 100n, 60, 120n, 200n], [30n, 102n, 30, 30n, 51n], [31n, 102n, 30, 60n, 102n],
    [60n, 9007199254740993n, 60, 60n, 9007199254740993n],
  ]) assert.deepEqual(calculateCallCharge(duration, rate, quantum), { billableSeconds: seconds, amountPaise: charge });
});
test('invalid quantum, fractional-paise policy violations, negative durations and overflow fail', () => {
  for (const args of [[1n, 101n, 30], [1n, 100n, 15], [-1n, 100n, 60], [120n, 9223372036854775807n, 60]])
    assert.throws(() => calculateCallCharge(...args), RangeError);
});
test('authorization includes termination margin and at least one minute of credit', () => {
  assert.equal(calculateReservationAmount(60n, 30n, 100n, 60), 200n);
  assert.equal(calculateReservationAmount(300n, 10n, 600n, 60), 3600n);
  assert.throws(() => calculateReservationAmount(10n, 0n, 100n, 30), /at least one minute/);
});
test('paise parse and JSON serialization preserve bigint precision and reject JS numbers', () => {
  assert.equal(parsePaise('9007199254740993'), 9007199254740993n);
  assert.equal(JSON.stringify({ balancePaise: 9007199254740993n }, serializeBigInts), '{"balancePaise":"9007199254740993"}');
  for (const bad of [100, 1.5, '1.5', '-1', '01', '9223372036854775808']) assert.throws(() => parsePaise(bad));
});
test('captured field definitions reject duplicate keys and choices without options', () => {
  const field = { key: 'budget', label: 'Budget', type: 'number' };
  assert.ok(capturedFieldsSchema.safeParse([field]).success);
  assert.ok(!capturedFieldsSchema.safeParse([field, field]).success);
  assert.ok(!capturedFieldsSchema.safeParse([{ ...field, type: 'choice' }]).success);
});
test('transcript validates timestamp order and analysis validates score at runtime', () => {
  const segment = { speaker: 'caller', startMs: 100, endMs: 200, text: 'Hello', language: 'en-IN' };
  assert.ok(transcriptSchema.safeParse([segment]).success);
  assert.ok(!transcriptSchema.safeParse([{ ...segment, endMs: 50 }]).success);
  assert.ok(!transcriptSchema.safeParse([segment, { ...segment, startMs: 50 }]).success);
  const analysis = { score: 8, classification: 'hot', summary: 'Interested', objections: [], capturedAttributes: {}, model: 'test', generatedAt: new Date().toISOString() };
  assert.ok(extractedAnalysisSchema.safeParse(analysis).success);
  assert.ok(!extractedAnalysisSchema.safeParse({ ...analysis, score: 11 }).success);
});
test('voice/WhatsApp consent and retry/calling windows have separate validation', () => {
  assert.ok(consentEvidenceSchema.safeParse({ voice: { status: 'unknown' }, whatsapp: { status: 'unknown' } }).success);
  assert.ok(!consentEvidenceSchema.safeParse({ voice: { status: 'granted' }, whatsapp: { status: 'unknown' } }).success);
  assert.ok(!retryConfigurationSchema.safeParse({ maxAttempts: 3, delaySeconds: [30], retryableOutcomes: ['failed'] }).success);
  assert.ok(!callingConfigurationSchema.safeParse({ timezone: 'Invalid/Timezone', weekdays: [1], startTime: '09:00', endTime: '18:00' }).success);
});
