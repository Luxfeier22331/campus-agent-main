import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";

import {
	buildSignupLegalConsentHeaders,
	isSignupLegalConsentAccepted,
	SIGNUP_LEGAL_CONSENT_REQUIRED_MESSAGE,
} from "./legal-consent";

const betterAuthClient = createAuthClient({
	plugins: [oauthProviderClient()],
});

export {
	SIGNUP_LEGAL_CONSENT_HEADER_NAME,
	SIGNUP_LEGAL_CONSENT_HEADER_VALUE,
	SIGNUP_LEGAL_CONSENT_REQUIRED_MESSAGE,
} from "./legal-consent";

type CampusAuthClient = typeof betterAuthClient;

function headersInitFromUnknown(headers: unknown): HeadersInit | undefined {
	if (
		headers === undefined ||
		headers instanceof Headers ||
		Array.isArray(headers) ||
		(typeof headers === "object" && headers !== null)
	) {
		return headers as HeadersInit | undefined;
	}
	return;
}

export const campusAuthClient: CampusAuthClient = {
	...betterAuthClient,
	signUp: {
		...betterAuthClient.signUp,
		email: async (input: Parameters<CampusAuthClient["signUp"]["email"]>[0]) => {
			if (!isSignupLegalConsentAccepted()) {
				return {
					data: null,
					error: {
						code: "legal_consent_required",
						message: SIGNUP_LEGAL_CONSENT_REQUIRED_MESSAGE,
						status: 400,
						statusText: "Bad Request",
					},
				} as Awaited<ReturnType<CampusAuthClient["signUp"]["email"]>>;
			}
			const fetchOptions = input.fetchOptions ?? {};
			return betterAuthClient.signUp.email({
				...input,
				fetchOptions: {
					...fetchOptions,
					headers: buildSignupLegalConsentHeaders(headersInitFromUnknown(fetchOptions.headers)),
				},
			});
		},
	},
};
