export class PanelHttpError extends Error {
	body: unknown;
	redirectTo?: string;
	status: number;

	constructor(message: string, status: number, body: unknown, redirectTo?: string) {
		super(message);
		this.name = "PanelHttpError";
		this.body = body;
		this.status = status;
		this.redirectTo = redirectTo;
	}
}

export function getPanelErrorMessage(error: unknown, fallback = "请求失败。") {
	if (error instanceof Error && error.message.trim()) {
		return error.message;
	}
	return fallback;
}
