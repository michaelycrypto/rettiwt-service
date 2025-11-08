export class ApiError extends Error {
	statusCode: number;
	details?: unknown;
	constructor(message: string, statusCode = 500, details?: unknown) {
		super(message);
		this.name = 'ApiError';
		this.statusCode = statusCode;
		this.details = details;
	}
}


