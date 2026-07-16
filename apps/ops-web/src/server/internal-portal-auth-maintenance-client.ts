import {
	type OpsInternalPortalMaintenanceStatus,
	OpsInternalPortalMaintenanceStatusSchema,
} from "../shared/ops-contract.ts";

const REQUEST_TIMEOUT_MS = 5_000;
const STATUS_PATH = "/internal/ingestion/operations/internal-portal-auth-maintenance";

export interface InternalPortalAuthMaintenanceEnv {
	OPS_WEB_INGESTION_CONTROL_OPS_TOKEN?: string;
	OPS_WEB_INGESTION_CONTROL_URL?: string;
}

export interface InternalPortalAuthMaintenanceClient {
	getStatus(): Promise<OpsInternalPortalMaintenanceStatus>;
	resume(): Promise<OpsInternalPortalMaintenanceStatus>;
}

export class InternalPortalAuthMaintenanceUnavailableError extends Error {
	constructor(message = "internal portal auth maintenance is unavailable", options?: ErrorOptions) {
		super(message, options);
		this.name = "InternalPortalAuthMaintenanceUnavailableError";
	}
}

export function createInternalPortalAuthMaintenanceClientFromEnv(
	env: InternalPortalAuthMaintenanceEnv,
): InternalPortalAuthMaintenanceClient {
	const baseUrl = env.OPS_WEB_INGESTION_CONTROL_URL?.trim().replace(/\/+$/u, "");
	const token = env.OPS_WEB_INGESTION_CONTROL_OPS_TOKEN?.trim();
	if (!(baseUrl && token)) {
		return createUnavailableInternalPortalAuthMaintenanceClient();
	}
	const parsedUrl = new URL(baseUrl);
	if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
		throw new InternalPortalAuthMaintenanceUnavailableError(
			"ingestion-control URL must use HTTP or HTTPS",
		);
	}
	const request = async (method: "GET" | "POST") => {
		let response: Response;
		try {
			response = await fetch(`${baseUrl}${STATUS_PATH}${method === "POST" ? "/resume" : ""}`, {
				headers: { authorization: `Bearer ${token}` },
				method,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch (error) {
			throw new InternalPortalAuthMaintenanceUnavailableError(undefined, { cause: error });
		}
		if (!response.ok) {
			throw new InternalPortalAuthMaintenanceUnavailableError(
				`ingestion-control maintenance request returned HTTP ${response.status}`,
			);
		}
		return OpsInternalPortalMaintenanceStatusSchema.parse(await response.json());
	};
	return {
		getStatus: async () => await request("GET"),
		resume: async () => await request("POST"),
	};
}

export function createUnavailableInternalPortalAuthMaintenanceClient(): InternalPortalAuthMaintenanceClient {
	return {
		getStatus: async () => unavailableMaintenanceStatus(),
		resume: async () => {
			throw new InternalPortalAuthMaintenanceUnavailableError();
		},
	};
}

export function unavailableMaintenanceStatus(): OpsInternalPortalMaintenanceStatus {
	return {
		errorCode: "internal_portal_auth_maintenance_unavailable",
		lastAttemptAt: null,
		lastOutcome: null,
		lastSuccessAt: null,
		nextRunAt: null,
		noticeProbeSucceeded: null,
		portalSessionEstablished: null,
		scheduleState: "UNAVAILABLE",
		serviceTicketIssued: null,
	};
}
