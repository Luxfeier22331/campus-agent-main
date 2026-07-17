import { recordFromFieldMap } from "./field-mapping";
import { catalogRecordsFromLarkTables, type LarkTableRecord } from "./catalog-field-mapping";
import type { DiningCatalogSourceRecords } from "./catalog-source-types";
import type { DiningSourceRecord } from "./types";

const FEISHU_OPENAPI_BASE_URL = "https://open.feishu.cn/open-apis";

export interface LarkClientConfig {
	appId: string;
	appSecret: string;
	baseToken: string;
	campusTableId?: string;
	dishTableId?: string;
	hallTableId?: string;
	reviewTableId?: string;
	reviewViewId?: string;
	stallTableId?: string;
}

export class LarkDiningClient {
	private readonly config: LarkClientConfig;
	private fieldIdByName: Map<string, string> | null = null;

	constructor(config: LarkClientConfig) {
		this.config = config;
	}

	async listReviewRecords(): Promise<DiningSourceRecord[]> {
		const token = await this.getTenantAccessToken();
		const fieldIdByName = await this.loadFieldIdByName(token);
		const records: DiningSourceRecord[] = [];
		const reviewTableId = requireConfig(this.config.reviewTableId, "reviewTableId");
		const reviewViewId = requireConfig(this.config.reviewViewId, "reviewViewId");
		let pageToken: string | undefined;
		do {
			const url = new URL(
				`${FEISHU_OPENAPI_BASE_URL}/bitable/v1/apps/${this.config.baseToken}/tables/${reviewTableId}/records`,
			);
			url.searchParams.set("view_id", reviewViewId);
			url.searchParams.set("page_size", "500");
			if (pageToken) {
				url.searchParams.set("page_token", pageToken);
			}
			const response = await fetchLarkJson<LarkRecordListResponse>(url, {
				headers: { Authorization: `Bearer ${token}` },
			});
			for (const item of response.data.items) {
				records.push(
						recordFromFieldMap({
							fields: fieldsById(item.fields, fieldIdByName),
							sourceRecordId: item.record_id,
							submittedAt: larkCreatedTimeToIso(item.created_time),
						}),
				);
			}
			pageToken = response.data.has_more ? response.data.page_token : undefined;
		} while (pageToken);
		return records;
	}

	async listCatalogRecords(): Promise<DiningCatalogSourceRecords> {
		const token = await this.getTenantAccessToken();
		const [campuses, halls, stalls, dishes] = await Promise.all([
			this.listRawTableRecords(token, requireConfig(this.config.campusTableId, "campusTableId")),
			this.listRawTableRecords(token, requireConfig(this.config.hallTableId, "hallTableId")),
			this.listRawTableRecords(token, requireConfig(this.config.stallTableId, "stallTableId")),
			this.listRawTableRecords(token, requireConfig(this.config.dishTableId, "dishTableId")),
		]);
		return catalogRecordsFromLarkTables({ campuses, dishes, halls, stalls });
	}

	async downloadAttachment(fileToken: string): Promise<Uint8Array> {
		const token = await this.getTenantAccessToken();
		const url = `${FEISHU_OPENAPI_BASE_URL}/drive/v1/medias/${fileToken}/download`;
		const response = await fetch(url, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!response.ok) {
			throw new Error(`Lark attachment download failed: HTTP ${response.status}.`);
		}
		return new Uint8Array(await response.arrayBuffer());
	}

	private async loadFieldIdByName(token: string): Promise<Map<string, string>> {
		if (this.fieldIdByName) {
			return this.fieldIdByName;
		}
		const url = new URL(
			`${FEISHU_OPENAPI_BASE_URL}/bitable/v1/apps/${this.config.baseToken}/tables/${requireConfig(this.config.reviewTableId, "reviewTableId")}/fields`,
		);
		url.searchParams.set("view_id", requireConfig(this.config.reviewViewId, "reviewViewId"));
		url.searchParams.set("page_size", "100");
		const response = await fetchLarkJson<LarkFieldListResponse>(url, {
			headers: { Authorization: `Bearer ${token}` },
		});
		const ids = new Set(response.data.items.map((item) => item.field_id));
		for (const fieldId of REQUIRED_FIELD_IDS) {
			if (!ids.has(fieldId)) {
				throw new Error(`Lark review table is missing required field ${fieldId}.`);
			}
		}
		this.fieldIdByName = new Map(
			response.data.items.map((item) => [item.field_name, item.field_id]),
		);
		return this.fieldIdByName;
	}

	private async getTenantAccessToken(): Promise<string> {
		const response = await fetchLarkJson<LarkTenantTokenResponse>(
			`${FEISHU_OPENAPI_BASE_URL}/auth/v3/tenant_access_token/internal`,
			{
				body: JSON.stringify({
					app_id: this.config.appId,
					app_secret: this.config.appSecret,
				}),
				headers: { "Content-Type": "application/json; charset=utf-8" },
				method: "POST",
			},
		);
		return response.tenant_access_token;
	}

	private async listRawTableRecords(token: string, tableId: string): Promise<LarkTableRecord[]> {
		const records: LarkTableRecord[] = [];
		let pageToken: string | undefined;
		do {
			const url = new URL(
				`${FEISHU_OPENAPI_BASE_URL}/bitable/v1/apps/${this.config.baseToken}/tables/${tableId}/records`,
			);
			url.searchParams.set("page_size", "500");
			if (pageToken) {
				url.searchParams.set("page_token", pageToken);
			}
			const response = await fetchLarkJson<LarkRecordListResponse>(url, {
				headers: { Authorization: `Bearer ${token}` },
			});
			for (const item of response.data.items) {
				records.push({ fields: item.fields, recordId: item.record_id });
			}
			pageToken = response.data.has_more ? response.data.page_token : undefined;
		} while (pageToken);
		return records;
	}
}

function requireConfig(value: string | undefined, name: string): string {
	if (!value?.trim()) {
		throw new Error(`Lark dining catalog ${name} is required.`);
	}
	return value.trim();
}

const REQUIRED_FIELD_IDS = [
	"fldGE8Z5vG",
	"fldmJk9inX",
	"fldPRZItgB",
	"flduqrX7Ab",
	"fldomqSoKM",
	"fldOWOVRMX",
	"fldIBfi1eC",
	"fldyqctdoB",
	"fldHJzHJpX",
] as const;

interface LarkTenantTokenResponse {
	code: number;
	msg: string;
	tenant_access_token: string;
}

interface LarkRecordListResponse {
	code: number;
	data: {
		has_more: boolean;
			items: Array<{
				created_time: string;
				fields: Record<string, unknown>;
				record_id: string;
			}>;
		page_token?: string;
	};
	msg: string;
}

function larkCreatedTimeToIso(value: string): string | null {
	const milliseconds = Number(value);
	const date = Number.isFinite(milliseconds) ? new Date(milliseconds) : new Date(value);
	if (Number.isNaN(date.getTime())) {
		return null;
	}
	return date.toISOString();
}

interface LarkFieldListResponse {
	code: number;
	data: {
		items: Array<{ field_id: string; field_name: string }>;
	};
	msg: string;
}

function fieldsById(
	fieldsByName: Record<string, unknown>,
	fieldIdByName: Map<string, string>,
): Map<string, unknown> {
	const mapped = new Map<string, unknown>();
	for (const [fieldName, value] of Object.entries(fieldsByName)) {
		const fieldId = fieldIdByName.get(fieldName);
		if (fieldId) {
			mapped.set(fieldId, value);
		}
	}
	return mapped;
}

async function fetchLarkJson<T extends { code: number; msg: string }>(
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(input, init);
	if (!response.ok) {
		throw new Error(`Lark OpenAPI request failed: HTTP ${response.status}.`);
	}
	const payload = (await response.json()) as T;
	if (payload.code !== 0) {
		throw new Error(`Lark OpenAPI request failed: ${payload.code} ${payload.msg}.`);
	}
	return payload;
}
