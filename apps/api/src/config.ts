import { z } from 'zod';

const httpOrigin = z.string().url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const parsed = new URL(value);
  return ['http:', 'https:'].includes(parsed.protocol)
    && parsed.origin === value
    && parsed.username === ''
    && parsed.password === '';
}, 'must be an HTTP(S) origin without a path or credentials');

const runtimeDatabaseUrl = z.string().url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const parsed = new URL(value);
  return ['postgres:', 'postgresql:'].includes(parsed.protocol)
    && parsed.username === 'voice_app';
}, 'must use PostgreSQL and the restricted voice_app role');

const redisUrl = z.string().url().refine(
  (value) => URL.canParse(value) && ['redis:', 'rediss:'].includes(new URL(value).protocol),
  'must be a redis:// or rediss:// URL',
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGIN: httpOrigin.default('http://localhost:3000'),
  DATABASE_URL: runtimeDatabaseUrl,
  REDIS_URL: redisUrl,
  AUTH_MODE: z.literal('disabled').default('disabled'),
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production') {
    context.addIssue({
      code: 'custom',
      path: ['AUTH_MODE'],
      message: 'production startup requires a future implemented authentication adapter; this scaffold supports development/test only',
    });
  }
});

export type AppConfig = Readonly<z.infer<typeof environmentSchema>>;

/** Only explicitly selected server settings are returned. Migration credentials are never read. */
export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    // Report field names and requirements, never the supplied values or connection credentials.
    throw new Error(`Invalid API configuration: ${result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')}`);
  }
  return Object.freeze(result.data);
}
