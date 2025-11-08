import { Router } from 'express';
import { z } from 'zod';
import { requestResource } from '../services/rettiwt';
import { postCallback } from '../utils/callbacks';

export const requestRouter = Router();

const requestSchema = z.object({
	resourceType: z.string(),
	args: z.record(z.any()).optional(),
	serialize: z.boolean().optional(), // retained for future; raw responses already JSON-compatible via FetcherService
	callbackUrl: z.string().url().optional(),
	callbackHeaders: z.record(z.string()).optional(),
});

requestRouter.post('/', async (req, res, next) => {
	try {
		const body = requestSchema.parse(req.body ?? {});
		if (body.callbackUrl) {
			// Asynchronous mode: process and POST result to callback
			// We still process inline here; for heavier workloads, integrate a job queue.
			res.status(202).json({ accepted: true });
			try {
				const data = await requestResource(body.resourceType, body.args || {});
				await postCallback(body.callbackUrl, { ok: true, data, resource: body.resourceType }, body.callbackHeaders);
			} catch (err: any) {
				await postCallback(
					body.callbackUrl,
					{
						ok: false,
						error: {
							message: err?.message || 'Request failed',
							statusCode: err?.statusCode || err?.status || 500,
							details: err?.details,
						},
						resource: body.resourceType,
					},
					body.callbackHeaders,
				);
			}
			return;
		}

		// Synchronous mode
		const data = await requestResource(body.resourceType, body.args || {});
		res.status(200).json({ ok: true, data, resource: body.resourceType });
	} catch (err) {
		next(err);
	}
});


