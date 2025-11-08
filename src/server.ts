import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './utils/logger';
import { authRouter } from './routes/auth';
import { requestRouter } from './routes/request';
import { resourcesRouter } from './routes/resources';
import { triggersRouter } from './routes/triggers';
import { ApiError } from './utils/errors';

const app = express();

app.use(helmet());
app.use(
	cors({
		origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN,
	}),
);
app.use(express.json({ limit: '1mb' }));
app.use(
	rateLimit({
		windowMs: 60 * 1000,
		limit: 120,
		standardHeaders: true,
		legacyHeaders: false,
	}),
);
app.use(
	pinoHttp({
		logger,
	}),
);

app.get('/health', (req, res) => {
	res.status(200).json({ ok: true });
});

app.use('/auth', authRouter);
app.use('/api/request', requestRouter);
app.use('/api/resources', resourcesRouter);
app.use('/api/triggers', triggersRouter);

// Not found
app.use((req, res) => {
	res.status(404).json({ ok: false, error: { message: 'Not Found' } });
});

// Error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
	if (err instanceof ApiError) {
		return res.status(err.statusCode).json({
			ok: false,
			error: {
				message: err.message,
				statusCode: err.statusCode,
				details: err.details,
			},
		});
	}
	const status = (err as any)?.status || (err as any)?.statusCode || 500;
	const message = (err as any)?.message || 'Internal Server Error';
	res.status(status).json({ ok: false, error: { message, statusCode: status } });
});

const port = env.PORT;
app.listen(port, () => {
	logger.info({ port }, 'Rettiwt service listening');
});


