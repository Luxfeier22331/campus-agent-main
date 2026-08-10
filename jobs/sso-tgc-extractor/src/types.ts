export interface ExtractorConfig {
	username: string;
	password: string;
	portalUrl: string;
	loginUrl: string;
	cookieName: string;
	headed: boolean;
	retryTimes: number;
	retryDelay: number;
	storageStateDir: string;
	automationUrl: string;
	automationToken: string;
	credentialName: string;
}

export interface SsoTgcResult {
	value: string;
	domain: string;
	path: string;
	expires: number;
	httpOnly: boolean;
	secure: boolean;
	extractedAt: string;
	reused: boolean;
}


export interface CredentialSyncResult {
	action: "created" | "rotated";
	credentialId: string;
	credentialName: string;
	previousVersion: number | null;
	version: number;
	extractedAt: string;
	reused: boolean;
}

export type ExtractionOutput =
	| {
			mode: "dry-run";
			extractedAt: string;
			reused: boolean;
	  }
	  | ({ mode: "sync" } & CredentialSyncResult);
