import {
	type OpsStatusStore,
	OpsStatusStoreUnavailableError,
	type OpsStatusStoreUnavailableReasonCode,
} from "./ops-status-types.ts";

export function createUnavailableOpsStatusStore(
	reasonCode: OpsStatusStoreUnavailableReasonCode,
	message: string,
): OpsStatusStore {
	const fail = async (): Promise<never> => {
		throw new OpsStatusStoreUnavailableError(reasonCode, message);
	};
	return {
		getOverview: fail,
		getRequestDetail: fail,
		listRequests: fail,
		verifyReadiness: fail,
		verifySchema: fail,
	};
}
