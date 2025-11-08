import * as RettiwtNS from 'rettiwt-api';
// RettiwtConfig class is not re-exported from the root; import from its dist path.
// This is necessary so userId, httpsAgent, etc. are correctly derived from the API key.
import { RettiwtConfig as RettiwtConfigClass } from 'rettiwt-api/dist/models/RettiwtConfig.js';
import { env } from '../config/env';
import { ApiError } from '../utils/errors';

// Support both ESM named exports and CJS default export
const Rettiwt: any = (RettiwtNS as any)?.default ?? (RettiwtNS as any);
const ResourceTypeEnum: Record<string, string> = (Rettiwt?.ResourceType as Record<string, string>) ?? {};

function buildConfig(): any {
	// Intentionally minimal; Rettiwt-API supports hot-swapping options on the config instance
	// like config.apiKey = '...'
	return new RettiwtConfigClass({
		apiKey: env.RETTIWT_API_KEY,
		timeout: env.REQUEST_TIMEOUT_MS,
	});
}

// Lazily create a fetcher to reuse config
let cachedFetcher: any | null = null;
export function getFetcher(): any {
	if (!cachedFetcher) {
		cachedFetcher = new Rettiwt.FetcherService(buildConfig());
	}
	return cachedFetcher;
}

// Lazily create a high-level Rettiwt instance (for convenience in triggers)
let cachedRettiwt: any | null = null;
export function getRettiwt(): any {
	if (!cachedRettiwt) {
		cachedRettiwt = new Rettiwt.Rettiwt(buildConfig());
	}
	return cachedRettiwt;
}

function resolveResourceType(keyOrValue: string): string {
	// Accept either the enum key (e.g. 'USER_DETAILS_BY_USERNAME') or the enum value itself
	const fromKey = ResourceTypeEnum[keyOrValue];
	return fromKey ?? keyOrValue;
}

export async function requestResource<T = unknown>(resourceTypeKey: string, args: unknown): Promise<T> {
	const resource = resolveResourceType(resourceTypeKey);
	try {
		const fetcher = getFetcher();
		const result = await fetcher.request(resource as any, (args as Record<string, unknown>) || {});
		return result as T;
	} catch (err: any) {
		// Normalize error
		const status = typeof err?.status === 'number' ? err.status : (typeof err?.statusCode === 'number' ? err.statusCode : 500);
		const message = err?.message || 'Rettiwt request failed';
		throw new ApiError(message, status, { resource, args, cause: err });
	}
}

export function listResourceTypes(): { keys: string[]; mapping: Record<string, string> } {
	const mapping: Record<string, string> = {};
	for (const [k, v] of Object.entries(ResourceTypeEnum)) {
		mapping[k] = v;
	}
	return { keys: Object.keys(mapping), mapping };
}

export async function verifyAuthentication(): Promise<{ ok: true; resource: string; sample?: unknown }> {
	const resource = env.VERIFY_RESOURCE;
	if (!env.RETTIWT_API_KEY && !env.ALLOW_GUEST) {
		throw new ApiError('API key not configured and guest mode disabled', 401);
	}
	if (!resource) {
		// As a conservative default we probe a public/basic resource to sanity-check connectivity;
		// for real auth checks, set VERIFY_RESOURCE to a user-only resource in env.
		const sample = await requestResource<unknown>('USER_DETAILS_BY_USERNAME', { id: 'jack' });
		return { ok: true, resource: 'USER_DETAILS_BY_USERNAME', sample };
	}
	const sample = await requestResource<unknown>(resource, env.VERIFY_ARGS_JSON || {});
	return { ok: true, resource, sample };
}


