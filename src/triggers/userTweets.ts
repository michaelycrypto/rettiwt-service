import { getRettiwt } from '../services/rettiwt';
import { logger } from '../utils/logger';
import { postCallback } from '../utils/callbacks';

type UserIdentifier = { id?: string; username?: string };

type TrackedUser = {
	userId: string; // numeric
	username?: string;
	lastSeenTweetId?: string;
};

export type Subscription = {
	id: string;
	callbackUrl: string;
	callbackHeaders?: Record<string, string>;
	intervalMs: number;
	deliverBacklog: boolean;
	users: Map<string, TrackedUser>; // keyed by userId
	timer?: NodeJS.Timeout;
	active: boolean;
};

class UserTweetTriggerManager {
	private subscriptions: Map<string, Subscription> = new Map();

	createSubscription(params: {
		callbackUrl: string;
		callbackHeaders?: Record<string, string>;
		intervalMs?: number;
		deliverBacklog?: boolean;
	}): Subscription {
		const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const sub: Subscription = {
			id,
			callbackUrl: params.callbackUrl,
			callbackHeaders: params.callbackHeaders,
			intervalMs: Math.max(10_000, params.intervalMs ?? 30_000),
			deliverBacklog: params.deliverBacklog ?? false,
			users: new Map(),
			active: false,
		};
		this.subscriptions.set(id, sub);
		this.start(sub);
		return sub;
	}

	removeSubscription(id: string): boolean {
		const sub = this.subscriptions.get(id);
		if (!sub) return false;
		this.stop(sub);
		return this.subscriptions.delete(id);
	}

	listSubscriptions(): Subscription[] {
		return Array.from(this.subscriptions.values()).map((s) => ({ ...s, users: new Map(s.users) }));
	}

	getSubscription(id: string): Subscription | undefined {
		const s = this.subscriptions.get(id);
		if (!s) return undefined;
		return { ...s, users: new Map(s.users) };
	}

	async addUsers(id: string, users: UserIdentifier[]): Promise<{ added: number; details: TrackedUser[] }> {
		const sub = this.subscriptions.get(id);
		if (!sub) throw new Error('Subscription not found');
		const details: TrackedUser[] = [];
		for (const u of users) {
			const tracked = await this.resolveUser(u);
			if (!sub.users.has(tracked.userId)) {
				sub.users.set(tracked.userId, tracked);
				details.push(tracked);
			}
		}
		return { added: details.length, details };
	}

	async removeUsers(id: string, userIds: string[]): Promise<{ removed: number }> {
		const sub = this.subscriptions.get(id);
		if (!sub) throw new Error('Subscription not found');
		let removed = 0;
		for (const uid of userIds) {
			if (sub.users.delete(uid)) removed++;
		}
		return { removed };
	}

	private start(sub: Subscription) {
		if (sub.active) return;
		sub.active = true;
		const run = async () => {
			if (!sub.active) return;
			try {
				await this.pollOnce(sub);
			} catch (err) {
				logger.warn({ err, subId: sub.id }, 'poll error');
			} finally {
				if (sub.active) {
					sub.timer = setTimeout(run, sub.intervalMs);
				}
			}
		};
		run();
	}

	private stop(sub: Subscription) {
		sub.active = false;
		if (sub.timer) {
			clearTimeout(sub.timer);
			sub.timer = undefined;
		}
	}

	private async resolveUser(u: UserIdentifier): Promise<TrackedUser> {
		if (u.id && /^\d+$/.test(u.id)) {
			return { userId: u.id, username: u.username };
		}
		if (!u.username) {
			throw new Error('username is required if id is not numeric');
		}
		const rettiwt = getRettiwt();
		const details = await rettiwt.user.details(u.username);
		const user = details?.toJSON?.() ?? details;
		const userId = user?.id || user?.rest_id || user?.legacy?.id_str;
		if (!userId) {
			throw new Error('Unable to resolve user id');
		}
		return { userId: String(userId), username: user?.username || u.username };
	}

	private async pollOnce(sub: Subscription) {
		if (sub.users.size === 0) return;
		const rettiwt = getRettiwt();
		for (const tracked of sub.users.values()) {
			try {
				const timeline = await rettiwt.user.timeline(tracked.userId, 5);
				const items = timeline?.items || timeline?.toJSON?.()?.items || [];
				// Items are typically newest-first; normalize to oldest-first for callback ordering
				const tweets = [...items].reverse();
				if (!tracked.lastSeenTweetId) {
					// bootstrap: set last seen but don't emit unless deliverBacklog is true
					const newest = tweets.length ? tweets[tweets.length - 1] : undefined;
					if (newest) {
						tracked.lastSeenTweetId = String(newest.id ?? newest.rest_id ?? newest?.raw?.tweet_id ?? newest?.legacy?.id_str);
						if (sub.deliverBacklog) {
							await this.emitTweets(sub, tracked, tweets);
						}
					}
					continue;
				}
				// find new tweets after lastSeen
				const newOnes = [];
				for (const t of tweets) {
					const tid = String(t.id ?? t.rest_id ?? t?.raw?.tweet_id ?? t?.legacy?.id_str);
					if (!tid) continue;
					if (tid === tracked.lastSeenTweetId) {
						newOnes.length = 0; // reset because we only want strictly newer than lastSeen; anything before lastSeen is older
						// Actually, since we're iterating oldest-first, once we hit lastSeen we clear any earlier (older) ones and continue to the next which are newer?
						// Instead, break here since older items are already processed earlier.
						// However, because we reversed, older items come first; so once we hit lastSeen, everything after is newer. Adjust logic:
					}
				}
				// Correct logic: iterate newest-first and collect until lastSeen is encountered
				const newestFirst = [...items]; // original order assumed newest-first
				const collected: any[] = [];
				for (const t of newestFirst) {
					const tid = String(t.id ?? t.rest_id ?? t?.raw?.tweet_id ?? t?.legacy?.id_str);
					if (!tid) continue;
					if (tid === tracked.lastSeenTweetId) break;
					collected.push(t);
				}
				// Emit in chronological order
				if (collected.length > 0) {
					await this.emitTweets(sub, tracked, collected.reverse());
					// Update lastSeen to newest emitted
					const newestEmitted = collected[0];
					const newestId = String(newestEmitted.id ?? newestEmitted.rest_id ?? newestEmitted?.raw?.tweet_id ?? newestEmitted?.legacy?.id_str);
					if (newestId) tracked.lastSeenTweetId = newestId;
				} else {
					// Update lastSeen to current newest if lastSeen not in the page (gap)
					if (newestFirst.length > 0) {
						const newestId = String(newestFirst[0].id ?? newestFirst[0].rest_id ?? newestFirst[0]?.raw?.tweet_id ?? newestFirst[0]?.legacy?.id_str);
						if (newestId) tracked.lastSeenTweetId = newestId;
					}
				}
			} catch (err) {
				logger.warn({ err, userId: tracked.userId, subId: sub.id }, 'timeline fetch failed');
			}
		}
	}

	private async emitTweets(sub: Subscription, user: TrackedUser, tweets: any[]) {
		for (const t of tweets) {
			const payload = {
				event: 'user.tweet.created',
				subscriptionId: sub.id,
				user: { id: user.userId, username: user.username },
				tweet: typeof t.toJSON === 'function' ? t.toJSON() : t,
			};
			await postCallback(sub.callbackUrl, payload, sub.callbackHeaders);
		}
	}
}

export const userTweetTriggerManager = new UserTweetTriggerManager();


