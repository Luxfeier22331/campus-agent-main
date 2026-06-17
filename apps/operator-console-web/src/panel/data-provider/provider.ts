import type {
	DeleteManyParams,
	DeleteParams,
	GetListParams,
	GetListResult,
	GetManyParams,
	GetManyReferenceParams,
	GetManyResult,
	GetOneParams,
	GetOneResult,
	QueryFunctionContext,
	RaRecord,
	UpdateManyParams,
	UpdateParams,
} from "react-admin";

import { fetchJson } from "../http";
import {
	normalizeOverviewRecord,
	type RawPanelOverviewResponse,
	type RequestProjectionRecord,
} from "../types";
import {
	getAuthenticatedNoticeProcessingDetail,
	getAuthenticatedNoticeProcessingList,
} from "./authenticated-notice-processing";
import {
	getAuthenticatedNoticeRunProcessingDetail,
	getAuthenticatedNoticeRunProcessingList,
} from "./authenticated-notice-run-processing";
import {
	getOfficialWebReleaseTaskDetail,
	getOfficialWebReleaseTaskList,
	getOfficialWebRunDetail,
	getOfficialWebRunList,
	getOfficialWebSiteDetail,
	getOfficialWebSiteList,
	getOfficialWebTargetInventoryList,
	getOfficialWebTargetJobDetail,
	getOfficialWebTargetJobList,
} from "./official-web";
import {
	getOperatorAuditEvent,
	getOperatorCostSummary,
	getOperatorCostTimeseries,
	getOperatorEvalCoverage,
	getOperatorIntentSummary,
	getOperatorIntentTimeseries,
	getOperatorOverview,
	getOperatorQualitySummary,
	getOperatorQualityTimeseries,
	getOperatorRuntimeHealth,
	getOperatorSafetySummary,
	listOperatorAudit,
	listOperatorQualityBadcases,
	listOperatorQualityEvalCandidates,
	listOperatorSafetyAnomalies,
} from "./operator";
import { getRequestDetail, getRequestList, getRequestObservabilityDetail } from "./requests";
import { unsupportedMethod } from "./shared";
import type { OperatorConsoleDataProvider } from "./types";

export const operatorConsoleDataProvider: OperatorConsoleDataProvider = {
	async create(resource) {
		unsupportedMethod(resource, "create");
	},
	async delete(resource, _params?: DeleteParams) {
		unsupportedMethod(resource, "delete");
	},
	async deleteMany(resource, _params?: DeleteManyParams) {
		unsupportedMethod(resource, "deleteMany");
	},
	async getList<RecordType extends RaRecord = RequestProjectionRecord>(
		resource: string,
		params: GetListParams & QueryFunctionContext,
	): Promise<GetListResult<RecordType>> {
		if (resource === "requests") {
			return (await getRequestList(params)) as unknown as GetListResult<RecordType>;
		}
		if (resource === "officialWebRuns") {
			return (await getOfficialWebRunList(params)) as unknown as GetListResult<RecordType>;
		}
		if (resource === "officialWebTargetJobs") {
			return (await getOfficialWebTargetJobList(params)) as unknown as GetListResult<RecordType>;
		}
		if (resource === "officialWebTargetInventory") {
			return (await getOfficialWebTargetInventoryList(
				params,
			)) as unknown as GetListResult<RecordType>;
		}
		if (resource === "officialWebReleaseTasks") {
			return (await getOfficialWebReleaseTaskList(params)) as unknown as GetListResult<RecordType>;
		}
		if (resource === "officialWebSites") {
			return (await getOfficialWebSiteList(params.signal)) as unknown as GetListResult<RecordType>;
		}
		if (resource === "authenticatedNoticeProcessing") {
			return (await getAuthenticatedNoticeProcessingList(
				params,
			)) as unknown as GetListResult<RecordType>;
		}
		if (resource === "authenticatedNoticeRunProcessing") {
			return (await getAuthenticatedNoticeRunProcessingList(
				params,
			)) as unknown as GetListResult<RecordType>;
		}

		unsupportedMethod(resource, "getList");
	},
	async getMany<RecordType extends RaRecord = RequestProjectionRecord>(
		resource: string,
		params: GetManyParams<RecordType> & QueryFunctionContext,
	): Promise<GetManyResult<RecordType>> {
		if (resource === "requests") {
			const items = await Promise.all(
				params.ids.map((id) => getRequestDetail(id, params.signal).then((result) => result.data)),
			);

			return {
				data: items,
			} as unknown as GetManyResult<RecordType>;
		}
		if (resource === "officialWebRuns") {
			const items = await Promise.all(
				params.ids.map((id) =>
					getOfficialWebRunDetail(id, params.signal).then((result) => result.data),
				),
			);

			return {
				data: items,
			} as unknown as GetManyResult<RecordType>;
		}
		if (resource === "officialWebTargetJobs") {
			const items = await Promise.all(
				params.ids.map((id) =>
					getOfficialWebTargetJobDetail(id, params.signal).then((result) => result.data),
				),
			);

			return {
				data: items,
			} as unknown as GetManyResult<RecordType>;
		}
		if (resource === "officialWebReleaseTasks") {
			const items = await Promise.all(
				params.ids.map((id) =>
					getOfficialWebReleaseTaskDetail(id, params.signal).then((result) => result.data),
				),
			);

			return {
				data: items,
			} as unknown as GetManyResult<RecordType>;
		}
		if (resource === "officialWebSites") {
			const items = await Promise.all(
				params.ids.map((id) =>
					getOfficialWebSiteDetail(id, params.signal).then((result) => result.data),
				),
			);

			return {
				data: items,
			} as unknown as GetManyResult<RecordType>;
		}
		if (resource === "authenticatedNoticeProcessing") {
			const items = await Promise.all(
				params.ids.map((id) =>
					getAuthenticatedNoticeProcessingDetail(id, params.signal).then((result) => result.data),
				),
			);

			return {
				data: items,
			} as unknown as GetManyResult<RecordType>;
		}
		if (resource === "authenticatedNoticeRunProcessing") {
			const items = await Promise.all(
				params.ids.map((id) =>
					getAuthenticatedNoticeRunProcessingDetail(id, params.signal).then(
						(result) => result.data,
					),
				),
			);

			return {
				data: items,
			} as unknown as GetManyResult<RecordType>;
		}

		unsupportedMethod(resource, "getMany");
	},
	async getManyReference(resource, _params?: GetManyReferenceParams) {
		unsupportedMethod(resource, "getManyReference");
	},
	async getOne<RecordType extends RaRecord = RequestProjectionRecord>(
		resource: string,
		params: GetOneParams<RecordType> & QueryFunctionContext,
	): Promise<GetOneResult<RecordType>> {
		if (resource === "requests") {
			return (await getRequestDetail(
				params.id,
				params.signal,
			)) as unknown as GetOneResult<RecordType>;
		}
		if (resource === "officialWebRuns") {
			return (await getOfficialWebRunDetail(
				params.id,
				params.signal,
			)) as unknown as GetOneResult<RecordType>;
		}
		if (resource === "officialWebTargetJobs") {
			return (await getOfficialWebTargetJobDetail(
				params.id,
				params.signal,
			)) as unknown as GetOneResult<RecordType>;
		}
		if (resource === "officialWebReleaseTasks") {
			return (await getOfficialWebReleaseTaskDetail(
				params.id,
				params.signal,
			)) as unknown as GetOneResult<RecordType>;
		}
		if (resource === "officialWebSites") {
			return (await getOfficialWebSiteDetail(
				params.id,
				params.signal,
			)) as unknown as GetOneResult<RecordType>;
		}
		if (resource === "authenticatedNoticeProcessing") {
			return (await getAuthenticatedNoticeProcessingDetail(
				params.id,
				params.signal,
			)) as unknown as GetOneResult<RecordType>;
		}
		if (resource === "authenticatedNoticeRunProcessing") {
			return (await getAuthenticatedNoticeRunProcessingDetail(
				params.id,
				params.signal,
			)) as unknown as GetOneResult<RecordType>;
		}

		unsupportedMethod(resource, "getOne");
	},
	async getOverview(input) {
		const payload = await fetchJson<RawPanelOverviewResponse>("/api/overview", {
			signal: input?.signal,
		});

		return {
			data: normalizeOverviewRecord(payload),
		};
	},
	async getOperatorOverview(input) {
		return getOperatorOverview(input);
	},
	async getOperatorQualitySummary(input) {
		return getOperatorQualitySummary(input);
	},
	async getOperatorQualityTimeseries(input) {
		return getOperatorQualityTimeseries(input);
	},
	async getOperatorRuntimeHealth(input) {
		return getOperatorRuntimeHealth(input);
	},
	async getOperatorIntentSummary(input) {
		return getOperatorIntentSummary(input);
	},
	async getOperatorIntentTimeseries(input) {
		return getOperatorIntentTimeseries(input);
	},
	async listOperatorQualityBadcases(input) {
		return listOperatorQualityBadcases(input);
	},
	async listOperatorQualityEvalCandidates(input) {
		return listOperatorQualityEvalCandidates(input);
	},
	async getOperatorSafetySummary(input) {
		return getOperatorSafetySummary(input);
	},
	async listOperatorSafetyAnomalies(input) {
		return listOperatorSafetyAnomalies(input);
	},
	async getOperatorCostSummary(input) {
		return getOperatorCostSummary(input);
	},
	async getOperatorCostTimeseries(input) {
		return getOperatorCostTimeseries(input);
	},
	async getOperatorEvalCoverage(input) {
		return getOperatorEvalCoverage(input);
	},
	async listOperatorAudit(input) {
		return listOperatorAudit(input);
	},
	async getOperatorAuditEvent(input) {
		return getOperatorAuditEvent(input);
	},
	async getRequestObservability(input) {
		return getRequestObservabilityDetail(input.requestId, input.signal);
	},
	async update(resource, _params?: UpdateParams) {
		unsupportedMethod(resource, "update");
	},
	async updateMany(resource, _params?: UpdateManyParams) {
		unsupportedMethod(resource, "updateMany");
	},
};
