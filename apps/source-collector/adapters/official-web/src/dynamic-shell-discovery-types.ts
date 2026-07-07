import type {
	OfficialWebConfigBundle,
	OfficialWebDynamicShellDiscoveryPolicy,
	OfficialWebHostPolicy,
} from "./core/index.ts";
import type { CollectedPageArtifact } from "./page-artifacts.ts";

export type { OfficialWebDynamicShellDiscoveryPolicy } from "./core/index.ts";

export interface DynamicShellNetworkCapture {
	url: string;
	status: number | null;
	contentType: string | null;
	bodyText: string | null;
}

export interface OfficialWebDynamicShellDiscovererInput {
	bundle: OfficialWebConfigBundle;
	captureNetwork?: (input: {
		policy: OfficialWebDynamicShellDiscoveryPolicy;
		url: string;
	}) => Promise<{
		captures: DynamicShellNetworkCapture[];
		wait: OfficialWebDynamicShellDiscoveryAudit["wait"];
	}>;
	hostPolicy: OfficialWebHostPolicy;
	page: CollectedPageArtifact;
}

export interface OfficialWebDynamicShellDiscoveryAudit {
	sourceUrl: string;
	host: string;
	wait: {
		waitAfterLoadMs: number;
		networkObservationTimeoutMs: number;
		matchedResponseUrl: string | null;
		matchedSelector: string | null;
		usedNetworkIdleWait: boolean;
		usedFixedDelayWait: boolean;
	};
	captures: Array<{
		url: string;
		status: number | null;
		contentType: string | null;
		ignored: boolean;
		allowed: boolean;
	}>;
	extractedUrls: string[];
	resolvedUrls: string[];
	admissions: Array<{
		url: string;
		admitted: boolean;
		normalizedUrl: string | null;
		reason: string;
		host: string | null;
	}>;
	promotedUrls: string[];
}

export interface OfficialWebDynamicShellDiscoveryResult {
	promotedUrls: string[];
	audit: OfficialWebDynamicShellDiscoveryAudit;
}

export type OfficialWebDynamicShellDiscovererOutput =
	| string[]
	| OfficialWebDynamicShellDiscoveryResult;

export type OfficialWebDynamicShellDiscoverer = (
	input: OfficialWebDynamicShellDiscovererInput,
) => Promise<OfficialWebDynamicShellDiscovererOutput>;
