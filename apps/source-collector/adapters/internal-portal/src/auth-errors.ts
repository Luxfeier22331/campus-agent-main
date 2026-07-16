import { NonRetryableError } from "crawlee";

export class PortalSessionExpiredError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PortalSessionExpiredError";
	}
}

export class PortalCredentialUnavailableError extends NonRetryableError {
	readonly code = "internal_portal_credential_unavailable";

	constructor(message = "internal portal SSO credential is unavailable", options?: ErrorOptions) {
		super(message, options);
		this.name = "PortalCredentialUnavailableError";
	}
}

export class PortalCredentialExpiredError extends NonRetryableError {
	readonly code = "internal_portal_credential_expired";

	constructor(message = "internal portal SSO credential is expired", options?: ErrorOptions) {
		super(message, options);
		this.name = "PortalCredentialExpiredError";
	}
}

export function isPortalCredentialFailure(
	error: unknown,
): error is PortalCredentialUnavailableError | PortalCredentialExpiredError {
	return (
		error instanceof PortalCredentialUnavailableError ||
		error instanceof PortalCredentialExpiredError
	);
}
