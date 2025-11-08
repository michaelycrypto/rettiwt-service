import { Router } from 'express';
import { z } from 'zod';
import { listResourceTypes, requestResource } from '../services/rettiwt';
import { postCallback } from '../utils/callbacks';

export const resourcesRouter = Router();

// Discovery endpoint to help automation (e.g., n8n) list valid resource types
resourcesRouter.get('/resource-types', (req, res) => {
	const list = listResourceTypes();
	res.status(200).json({ ok: true, ...list });
});

const getSchema = z.object({
	args: z.string().optional(), // JSON string
});

// GET wrapper: synchronous fetch with args passed as JSON string in query
resourcesRouter.get('/:resourceType', async (req, res, next) => {
	try {
		const parsed = getSchema.parse(req.query);
		const resourceType = req.params.resourceType;
		const args = parsed.args ? JSON.parse(parsed.args) : {};
		const data = await requestResource(resourceType, args);
		res.status(200).json({ ok: true, resource: resourceType, data });
	} catch (err) {
		next(err);
	}
});

const postSchema = z.object({
	args: z.record(z.any()).optional(),
	callbackUrl: z.string().url().optional(),
	callbackHeaders: z.record(z.string()).optional(),
});

// POST wrapper: supports both sync and async (callback) modes
resourcesRouter.post('/:resourceType', async (req, res, next) => {
	try {
		const body = postSchema.parse(req.body ?? {});
		const resourceType = req.params.resourceType;
		if (body.callbackUrl) {
			res.status(202).json({ accepted: true });
			try {
				const data = await requestResource(resourceType, body.args || {});
				await postCallback(body.callbackUrl, { ok: true, resource: resourceType, data }, body.callbackHeaders);
			} catch (err: any) {
				await postCallback(
					body.callbackUrl,
					{
						ok: false,
						resource: resourceType,
						error: {
							message: err?.message || 'Request failed',
							statusCode: err?.statusCode || err?.status || 500,
							details: err?.details,
						},
					},
					body.callbackHeaders,
				);
			}
			return;
		}
		const data = await requestResource(resourceType, body.args || {});
		res.status(200).json({ ok: true, resource: resourceType, data });
	} catch (err) {
		next(err);
	}
});


