import { z } from 'zod';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(), z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]));
export const attributesSchema = z.record(z.string().min(1).max(100), jsonValueSchema);
export const organizationIdSchema = z.string().uuid();
export const e164PhoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Expected an E.164 phone number');
export const languageSchema = z.enum(['te-IN', 'hi-IN', 'en-IN', 'te-en']);

export const organizationDefaultsSchema = z.object({
  language: languageSchema.default('en-IN'),
  timezone: z.string().min(1).default('Asia/Kolkata'),
}).strict();

export const capturedFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  label: z.string().min(1).max(120),
  type: z.enum(['text', 'number', 'boolean', 'choice']),
  required: z.boolean().default(false),
  choices: z.array(z.string().min(1).max(120)).min(1).max(100).optional(),
}).strict().superRefine((field, context) => {
  if (field.type === 'choice' && !field.choices) {
    context.addIssue({ code: 'custom', message: 'Choice fields require choices', path: ['choices'] });
  }
  if (field.type !== 'choice' && field.choices) {
    context.addIssue({ code: 'custom', message: 'Only choice fields accept choices', path: ['choices'] });
  }
});
export const capturedFieldsSchema = z.array(capturedFieldSchema).max(100).superRefine((fields, context) => {
  if (new Set(fields.map((field) => field.key)).size !== fields.length) {
    context.addIssue({ code: 'custom', message: 'Captured field keys must be unique' });
  }
});

export const retryConfigurationSchema = z.object({
  maxAttempts: z.number().int().min(1).max(10),
  delaySeconds: z.array(z.number().int().min(30).max(604800)).max(9),
  retryableOutcomes: z.array(z.enum(['no_answer', 'busy', 'failed'])).max(3),
}).strict().refine((value) => value.delaySeconds.length === value.maxAttempts - 1, {
  message: 'Provide one delay for each retry', path: ['delaySeconds'],
});
const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const callingConfigurationSchema = z.object({
  timezone: z.string().min(1).refine((zone) => {
    try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; }
  }, 'Expected an IANA timezone'),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7)
    .refine((days) => new Set(days).size === days.length, 'Weekdays must be unique'),
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
}).strict().refine((value) => value.startTime < value.endTime, {
  message: 'Calling window must end after it starts on the same day', path: ['endTime'],
});

const consentChannelSchema = z.object({
  status: z.enum(['unknown', 'granted', 'denied', 'revoked']),
  recordedAt: z.string().datetime({ offset: true }).optional(),
  source: z.string().min(1).max(200).optional(),
  evidenceReference: z.string().min(1).max(2000).optional(),
  noticeVersion: z.string().min(1).max(100).optional(),
}).strict().refine((value) => value.status === 'unknown' || Boolean(value.recordedAt && value.source), {
  message: 'Known consent requires recordedAt and source',
});
export const consentEvidenceSchema = z.object({
  voice: consentChannelSchema,
  whatsapp: consentChannelSchema,
}).strict();

export const transcriptSegmentSchema = z.object({
  speaker: z.enum(['caller', 'agent']),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string().min(1).max(20000),
  language: languageSchema.optional(),
}).strict().refine((segment) => segment.endMs >= segment.startMs, {
  message: 'Transcript end must be at or after its start', path: ['endMs'],
});
export const transcriptSchema = z.array(transcriptSegmentSchema).max(100000)
  .refine((segments) => segments.every((segment, index) => index === 0 || segment.startMs >= segments[index - 1]!.startMs),
    'Transcript segments must be ordered by start time');
export const extractedAnalysisSchema = z.object({
  score: z.number().int().min(1).max(10),
  classification: z.enum(['hot', 'warm', 'cold']),
  summary: z.string().min(1).max(5000),
  objections: z.array(z.string().min(1).max(1000)).max(100),
  capturedAttributes: attributesSchema,
  model: z.string().min(1).max(200),
  generatedAt: z.string().datetime({ offset: true }),
}).strict();

export const campaignConfigurationSchema = z.object({
  capturedFields: capturedFieldsSchema,
  retryConfiguration: retryConfigurationSchema,
  callingConfiguration: callingConfigurationSchema,
}).strict();
export type OrganizationDefaults = z.infer<typeof organizationDefaultsSchema>;
export type CapturedFields = z.infer<typeof capturedFieldsSchema>;
export type RetryConfiguration = z.infer<typeof retryConfigurationSchema>;
export type CallingConfiguration = z.infer<typeof callingConfigurationSchema>;
export type ConsentEvidence = z.infer<typeof consentEvidenceSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;
export type ExtractedAnalysis = z.infer<typeof extractedAnalysisSchema>;
export type Attributes = z.infer<typeof attributesSchema>;

/** Parse decimal-string paise at server input boundaries. Never accept JS numbers. */
export function parsePaise(value: unknown): bigint {
  const text = z.string().regex(/^(0|[1-9]\d*)$/, 'Paise must be a nonnegative decimal string').parse(value);
  const amount = BigInt(text);
  if (amount > 9223372036854775807n) throw new RangeError('Amount exceeds PostgreSQL BIGINT');
  return amount;
}

/** Use as JSON.stringify(value, serializeBigInts); HTTP money values are decimal strings. */
export function serializeBigInts(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
