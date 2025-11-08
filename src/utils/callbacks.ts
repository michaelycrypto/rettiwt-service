import crypto from 'crypto';
import { env } from '../config/env';
import { logger } from './logger';

type HeadersMap = Record<string, string>;

function signPayload(payload: unknown): string | undefined {
	if (!env.CALLBACK_SECRET) return undefined;
	const json = JSON.stringify(payload);
	return crypto.createHmac('sha256', env.CALLBACK_SECRET).update(json).digest('hex');
}

export async function postCallback(
	url: string,
	payload: unknown,
	headers?: HeadersMap,
) {
	const signature = signPayload(payload);
	const mergedHeaders: HeadersMap = {
		'content-type': 'application/json',
		...(headers || {}),
	};
	if (signature) {
		mergedHeaders['x-signature-sha256'] = signature;
	}
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: mergedHeaders,
			body: JSON.stringify(payload),
		});
		if (!res.ok) {
			const text = await res.text();
			logger.warn({ status: res.status, text }, 'Callback returned non-OK status');
		}
	} catch (err) {
		logger.error({ err }, 'Callback POST failed');
	}
}


