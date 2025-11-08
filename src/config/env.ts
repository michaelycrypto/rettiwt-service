import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
	PORT: z
		.string()
		.transform((v) => parseInt(v, 10))
		.refine((v) => Number.isFinite(v) && v > 0, 'PORT must be a positive integer')
		.default('8787' as unknown as string),
	RETTIWT_API_KEY: z.string().optional(),
	ALLOW_GUEST: z
		.string()
		.optional()
		.transform((v) => (v ?? 'true').toLowerCase() === 'true'),
	VERIFY_RESOURCE: z.string().optional(),
	VERIFY_ARGS_JSON: z
		.string()
		.optional()
		.transform((v) => {
			if (!v) return undefined;
			try {
				return JSON.parse(v);
			} catch {
				throw new Error('VERIFY_ARGS_JSON must be valid JSON when provided');
			}
		}),
	CORS_ORIGIN: z.string().default('*'),
	CALLBACK_SECRET: z.string().optional(),
	REQUEST_TIMEOUT_MS: z
		.string()
		.optional()
		.transform((v) => {
			const n = v ? Number(v) : 30000;
			if (!Number.isFinite(n) || n <= 0) {
				throw new Error('REQUEST_TIMEOUT_MS must be a positive number');
			}
			return n;
		}),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

