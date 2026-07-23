import ky, { type KyInstance } from "ky";
import { catalogRecordsFromLarkTables, type LarkTableRecord } from "./catalog-field-mapping.ts";
import type { DiningCatalogSourceRecords } from "./catalog-source-types.ts";
import { recordFromFieldMap } from "./field-mapping.ts";
import type { DiningReviewSourceSnapshot, DiningSourceRecord } from "./types.ts";

const FEISHU_OPENAPI_BASE_URL = "https://open.feishu.cn/open-apis";
const HTTP_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_SKEW_MS = 60_000;
const FALLBACK_TOKEN_TTL_SECONDS = 7_000;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export interface LarkClientConfig {
	appId: string;
	appSecret: string;
	baseToken: string;
	catalog?: {
		campusTableId: string;
		dishTableId: string;
		hallTableId: string;
		stallTableId: string;
	};
	fetch?: typeof fetch;
	now?: () => number;
	review?: { tableId: string; viewId: string };
}

export class LarkDiningClient {
	private readonly config: LarkClientConfig;
	private fieldIdByName: Map<string, string> | null = null;
	private readonly http: KyInstance;
	private readonly now: () => number;
	private token: { expiresAt: number; value: string } | null = null;

	constructor(config: LarkClientConfig) {
		this.config = config;
		this.now = config.now ?? Date.now;
		this.http = ky.create({
			fetch: config.fetch,
			retry: {
				limit: 3,
				methods: ["get", "post"],
				statusCodes: [408, 429, 500, 502, 503, 504],
			},
			timeout: HTTP_TIMEOUT_MS,
		});
	}

	async listReviewRecords(): Promise<DiningReviewSourceSnapshot> {
		const token = await this.getTenantAccessToken();
		const fieldIdByName = await this.loadFieldIdByName(token);
		const records: DiningSourceRecord[] = [];
		const review = requireReviewConfig(this.config.review);
		const seenPageTokens = new Set<string>();
		let pageToken: string | undefined;
		do {
			const url = new URL(
				`${FEISHU_OPENAPI_BASE_URL}/bitable/v1/apps/${this.config.baseToken}/tables/${review.tableId}/records`,
			);
			url.searchParams.set("view_id", review.viewId);
			url.searchParams.set("page_size", "500");
			if (pageToken) {
				url.searchParams.set("page_token", pageToken);
			}
			const response = await this.fetchLarkJson<LarkRecordListResponse>(url, {
				headers: { Authorization: `Bearer ${token}` },
			});
			for (const item of response.data.items) {
				try {
					records.push(
						recordFromFieldMap({
							fields: fieldsById(item.fields, fieldIdByName),
							sourceRecordId: item.record_id,
							submittedAt: larkCreatedTimeToIso(item.created_time),
						}),
					);
				} catch {
					records.push(blockedReviewRecord(item.record_id, item.created_time));
				}
			}
			pageToken = nextPageToken(response.data, seenPageTokens);
		} while (pageToken);
		return { complete: true, records };
	}

	async listCatalogRecords(): Promise<DiningCatalogSourceRecords> {
		const token = await this.getTenantAccessToken();
		const catalog = requireCatalogConfig(this.config.catalog);
		const [campuses, halls, stalls, dishes] = await Promise.all([
			this.listRawTableRecords(token, catalog.campusTableId),
			this.listRawTableRecords(token, catalog.hallTableId),
			this.listRawTableRecords(token, catalog.stallTableId),
			this.listRawTableRecords(token, catalog.dishTableId),
		]);
		return catalogRecordsFromLarkTables({ campuses, dishes, halls, stalls });
	}

	async downloadAttachment(
		fileToken: string,
		maxBytes = MAX_ATTACHMENT_BYTES,
	): Promise<Uint8Array> {
		const token = await this.getTenantAccessToken();
		const response = await this.http.get(
			`${FEISHU_OPENAPI_BASE_URL}/drive/v1/medias/${fileToken}/download`,
			{ headers: { Authorization: `Bearer ${token}` } },
		);
		return readBoundedBody(response, maxBytes);
	}

	private async loadFieldIdByName(token: string): Promise<Map<string, string>> {
		if (this.fieldIdByName) {
			return this.fieldIdByName;
		}
		const review = requireReviewConfig(this.config.review);
		const items: LarkFieldListResponse["data"]["items"] = [];
		const seenPageTokens = new Set<string>();
		let pageToken: string | undefined;
		do {
			const url = new URL(
				`${FEISHU_OPENAPI_BASE_URL}/bitable/v1/apps/${this.config.baseToken}/tables/${review.tableId}/fields`,
			);
			url.searchParams.set("view_id", review.viewId);
			url.searchParams.set("page_size", "100");
			if (pageToken) {
				url.searchParams.set("page_token", pageToken);
			}
			const response = await this.fetchLarkJson<LarkFieldListResponse>(url, {
				headers: { Authorization: `Bearer ${token}` },
			});
			items.push(...response.data.items);
			pageToken = nextPageToken(response.data, seenPageTokens);
		} while (pageToken);

		const ids = new Set(items.map((item) => item.field_id));
		for (const fieldId of REQUIRED_FIELD_IDS) {
			if (!ids.has(fieldId)) {
				throw new Error(`Lark review table is missing required field ${fieldId}.`);
			}
		}
		this.fieldIdByName = new Map(items.map((item) => [item.field_name, item.field_id]));
		return this.fieldIdByName;
	}

	private async getTenantAccessToken(): Promise<string> {
		if (this.token && this.token.expiresAt - TOKEN_REFRESH_SKEW_MS > this.now()) {
			return this.token.value;
		}
		const response = await this.fetchLarkJson<LarkTenantTokenResponse>(
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
		const expiresIn = positiveNumber(response.expire) ?? FALLBACK_TOKEN_TTL_SECONDS;
		this.token = {
			expiresAt: this.now() + expiresIn * 1_000,
			value: response.tenant_access_token,
		};
		return this.token.value;
	}

	private async listRawTableRecords(token: string, tableId: string): Promise<LarkTableRecord[]> {
		const records: LarkTableRecord[] = [];
		const seenPageTokens = new Set<string>();
		let pageToken: string | undefined;
		do {
			const url = new URL(
				`${FEISHU_OPENAPI_BASE_URL}/bitable/v1/apps/${this.config.baseToken}/tables/${tableId}/records`,
			);
			url.searchParams.set("page_size", "500");
			if (pageToken) {
				url.searchParams.set("page_token", pageToken);
			}
			const response = await this.fetchLarkJson<LarkRecordListResponse>(url, {
				headers: { Authorization: `Bearer ${token}` },
			});
			for (const item of response.data.items) {
				records.push({ fields: item.fields, recordId: item.record_id });
			}
			pageToken = nextPageToken(response.data, seenPageTokens);
		} while (pageToken);
		return records;
	}

	private async fetchLarkJson<T extends LarkResponse>(
		input: string | URL,
		init?: RequestInit,
	): Promise<T> {
		const payload = await this.http(input, init).json<T>();
		if (payload.code !== 0) {
			throw new Error(`Lark OpenAPI request failed: ${payload.code} ${payload.msg}.`);
		}
		return payload;
	}
}

function requireCatalogConfig(
	value: LarkClientConfig["catalog"],
): NonNullable<LarkClientConfig["catalog"]> {
	if (!value) {
		throw new Error("Lark Dining catalog configuration is required.");
	}
	return value;
}

function requireReviewConfig(
	value: LarkClientConfig["review"],
): NonNullable<LarkClientConfig["review"]> {
	if (!value) {
		throw new Error("Lark Dining review configuration is required.");
	}
	return value;
}

function nextPageToken(
	data: { has_more: boolean; page_token?: string },
	seen: Set<string>,
): string | undefined {
	if (!data.has_more) {
		return;
	}
	const token = data.page_token?.trim();
	if (!token) {
		throw new Error("Lark OpenAPI indicated another page without a page token.");
	}
	if (seen.has(token)) {
		throw new Error(`Lark OpenAPI repeated page token ${token}.`);
	}
	seen.add(token);
	return token;
}

function blockedReviewRecord(sourceRecordId: string, createdTime: string): DiningSourceRecord {
	return {
		attachments: [],
		campus: "",
		comment: null,
		contributorName: null,
		dishName: "",
		hallName: "",
		paidPriceLabel: null,
		rating: null,
		sourceBlockReason: "source_record_invalid",
		sourceRecordId,
		stallName: "",
		submittedAt: larkCreatedTimeToIso(createdTime),
	};
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > maxBytes) {
		throw new Error(`Lark attachment exceeds the ${maxBytes} byte limit.`);
	}
	if (!response.body) {
		throw new Error("Lark attachment response has no body.");
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) {
				break;
			}
			length += chunk.value.byteLength;
			if (length > maxBytes) {
				throw new Error(`Lark attachment exceeds the ${maxBytes} byte limit.`);
			}
			chunks.push(chunk.value);
		}
	} finally {
		reader.releaseLock();
	}
	const body = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
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

interface LarkResponse {
	code: number;
	msg: string;
}

interface LarkTenantTokenResponse extends LarkResponse {
	expire?: number;
	tenant_access_token: string;
}

interface LarkRecordListResponse extends LarkResponse {
	data: {
		has_more: boolean;
		items: Array<{
			created_time: string;
			fields: Record<string, unknown>;
			record_id: string;
		}>;
		page_token?: string;
	};
}

interface LarkFieldListResponse extends LarkResponse {
	data: {
		has_more: boolean;
		items: Array<{ field_id: string; field_name: string }>;
		page_token?: string;
	};
}

function larkCreatedTimeToIso(value: string): string | null {
	const milliseconds = Number(value);
	const date = Number.isFinite(milliseconds) ? new Date(milliseconds) : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
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

function positiveNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
