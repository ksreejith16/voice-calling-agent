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
  AUTH_MODE: z.enum(['disabled', 'clerk']).default('disabled'),
  CLERK_SECRET_KEY: z.string().min(1).optional(),
  CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),
  LIVEKIT_URL: z.string().default(''),
  LIVEKIT_API_KEY: z.string().default(''),
  LIVEKIT_API_SECRET: z.string().default(''),
  VOICE_AGENT_NAME: z.string().default('india-voice-prototype'),
  VOICE_TEST_ENABLED: z.enum(['true', 'false']).default('false'),
}).superRefine((value, context) => {
  if (value.VOICE_TEST_ENABLED === 'true') {
    if (value.NODE_ENV === 'production') context.addIssue({ code: 'custom', path: ['VOICE_TEST_ENABLED'], message: 'Unbilled browser testing is development-only' });
    for (const key of ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] as const) {
      if (!value[key].trim()) context.addIssue({ code: 'custom', path: [key], message: 'Required for browser voice tests' });
    }
    const url = URL.canParse(value.LIVEKIT_URL) ? new URL(value.LIVEKIT_URL) : null;
    if (!url || !['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.protocol === 'ws:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
      context.addIssue({ code: 'custom', path: ['LIVEKIT_URL'], message: 'Use a secure LiveKit URL or a loopback development URL' });
    }
  }
  if (value.AUTH_MODE === 'clerk' && !value.CLERK_SECRET_KEY) {
    context.addIssue({
      code: 'custom',
      path: ['CLERK_SECRET_KEY'],
      message: 'CLERK_SECRET_KEY is required when AUTH_MODE=clerk',
    });
  }
});

export type AppConfig = Readonly<z.infer<typeof environmentSchema>>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    throw new Error(`Invalid API configuration: ${result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')}`);
  }
  return Object.freeze(result.data);
}
