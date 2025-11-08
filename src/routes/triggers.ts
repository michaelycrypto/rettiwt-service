import { Router } from 'express';
import { z } from 'zod';
import { userTweetTriggerManager } from '../triggers/userTweets';

export const triggersRouter = Router();

triggersRouter.get('/user-tweets', (req, res) => {
	const list = userTweetTriggerManager.listSubscriptions();
	const safe = list.map((s) => ({
		id: s.id,
		active: s.active,
		intervalMs: s.intervalMs,
		deliverBacklog: s.deliverBacklog,
		callbackUrl: s.callbackUrl,
		users: Array.from(s.users.values()).map((u) => ({ userId: u.userId, username: u.username, lastSeenTweetId: u.lastSeenTweetId })),
	}));
	res.status(200).json({ ok: true, subscriptions: safe });
});

const createSchema = z.object({
	callbackUrl: z.string().url(),
	callbackHeaders: z.record(z.string()).optional(),
	intervalMs: z.number().int().positive().optional(),
	deliverBacklog: z.boolean().optional(),
	users: z
		.array(
			z.object({
				id: z.string().optional(),
				username: z.string().optional(),
			}),
		)
		.optional(),
});

triggersRouter.post('/user-tweets/subscribe', async (req, res, next) => {
	try {
		const body = createSchema.parse(req.body ?? {});
		const sub = userTweetTriggerManager.createSubscription({
			callbackUrl: body.callbackUrl,
			callbackHeaders: body.callbackHeaders,
			intervalMs: body.intervalMs,
			deliverBacklog: body.deliverBacklog,
		});
		if (body.users && body.users.length > 0) {
			await userTweetTriggerManager.addUsers(sub.id, body.users);
		}
		res.status(201).json({ ok: true, subscriptionId: sub.id });
	} catch (err) {
		next(err);
	}
});

const addUsersSchema = z.object({
	subscriptionId: z.string(),
	users: z.array(
		z.object({
			id: z.string().optional(),
			username: z.string().optional(),
		}),
	),
});

triggersRouter.post('/user-tweets/add-users', async (req, res, next) => {
	try {
		const body = addUsersSchema.parse(req.body ?? {});
		const result = await userTweetTriggerManager.addUsers(body.subscriptionId, body.users);
		res.status(200).json({ ok: true, ...result });
	} catch (err) {
		next(err);
	}
});

const removeSchema = z.object({
	subscriptionId: z.string(),
});

triggersRouter.post('/user-tweets/unsubscribe', (req, res, next) => {
	try {
		const body = removeSchema.parse(req.body ?? {});
		const ok = userTweetTriggerManager.removeSubscription(body.subscriptionId);
		res.status(200).json({ ok });
	} catch (err) {
		next(err);
	}
});


