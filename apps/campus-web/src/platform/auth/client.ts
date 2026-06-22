import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";

import {
	buildSignupLegalConsentHeaders,
	SIGNUP_LEGAL_CONSENT_FIELD_NAME,
	SIGNUP_LEGAL_CONSENT_REQUIRED_MESSAGE,
} from "./legal-consent";

const betterAuthClient = createAuthClient({
	plugins: [oauthProviderClient(), passkeyClient()],
});

export {
	SIGNUP_LEGAL_CONSENT_FIELD_NAME,
	SIGNUP_LEGAL_CONSENT_HEADER_NAME,
	SIGNUP_LEGAL_CONSENT_HEADER_VALUE,
	SIGNUP_LEGAL_CONSENT_REQUIRED_MESSAGE,
} from "./legal-consent";

type BetterAuthClient = typeof betterAuthClient;
type BetterAuthSignUpEmail = BetterAuthClient["signUp"]["email"];
type CampusSignUpEmailInput = Parameters<BetterAuthSignUpEmail>[0] & {
	[SIGNUP_LEGAL_CONSENT_FIELD_NAME]?: unknown;
};
type CampusAuthClient = Omit<BetterAuthClient, "signUp"> & {
	signUp: Omit<BetterAuthClient["signUp"], "email"> & {
		email: (input: CampusSignUpEmailInput) => ReturnType<BetterAuthSignUpEmail>;
	};
};

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
		email: async (input: CampusSignUpEmailInput) => {
			const { [SIGNUP_LEGAL_CONSENT_FIELD_NAME]: legalConsentAccepted, ...signUpInput } =
				input as CampusSignUpEmailInput;
			if (legalConsentAccepted !== true) {
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
			const fetchOptions = signUpInput.fetchOptions ?? {};
			return betterAuthClient.signUp.email({
				...signUpInput,
				fetchOptions: {
					...fetchOptions,
					headers: buildSignupLegalConsentHeaders(headersInitFromUnknown(fetchOptions.headers)),
				},
			});
		},
	},
};
