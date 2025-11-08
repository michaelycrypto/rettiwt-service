import { Router } from 'express';
import { verifyAuthentication } from '../services/rettiwt';
import { requestResource } from '../services/rettiwt';
import { z } from 'zod';

export const authRouter = Router();

authRouter.get('/verify', async (req, res, next) => {
	try {
		// Optional overrides via query for ad-hoc checks
		const resourceType = typeof req.query.resourceType === 'string' ? req.query.resourceType : undefined;
		const argsJson = typeof req.query.args === 'string' ? req.query.args : undefined;
		if (resourceType) {
			const args = argsJson ? JSON.parse(argsJson) : {};
			const data = await requestResource(resourceType, args);
			return res.status(200).json({ ok: true, resource: resourceType, sample: data });
		}
		const result = await verifyAuthentication();
		res.status(200).json(result);
	} catch (err) {
		next(err);
	}
});

const probeSchema = z.object({
	resourceType: z.string(),
	args: z.record(z.any()).optional(),
});

authRouter.post('/probe', async (req, res, next) => {
	try {
		const body = probeSchema.parse(req.body ?? {});
		const data = await requestResource(body.resourceType, body.args || {});
		res.status(200).json({ ok: true, resource: body.resourceType, sample: data });
	} catch (err) {
		next(err);
	}
});


