export class PortalSessionExpiredError extends Error {
	readonly code = "internal_portal_session_expired";

	constructor(message: string) {
		super(message);
		this.name = "PortalSessionExpiredError";
	}
}

export class PortalCredentialUnavailableError extends Error {
	readonly code = "internal_portal_credential_unavailable";

	constructor(message = "internal portal SSO credential is unavailable", options?: ErrorOptions) {
		super(message, options);
		this.name = "PortalCredentialUnavailableError";
	}
}

export class PortalCredentialExpiredError extends Error {
	readonly code = "internal_portal_credential_expired";

	constructor(message = "internal portal SSO credential is expired", options?: ErrorOptions) {
		super(message, options);
		this.name = "PortalCredentialExpiredError";
	}
}
