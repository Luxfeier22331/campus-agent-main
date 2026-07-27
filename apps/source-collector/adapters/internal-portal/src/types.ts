export interface NoticeItem {
	notice_id?: number | string | null;
}

export interface NoticePage {
	totalCounts?: number | string;
}

export interface NoticeListResponse {
	state?: boolean;
	msg?: string;
	datas?: {
		tables?: NoticeItem[];
		page?: NoticePage;
	};
}

export interface NoticeDetailInfo {
	notice_title?: string | null;
	notice_content?: string | null;
	notice_link?: string | null;
	notice_type_name?: string | null;
	organization_name?: string | null;
	organization_id?: string | null;
	notice_id?: number | null;
	notice_release_time?: string | null;
	notice_annext?: NoticeAnnexInfo[] | null;
}

export interface NoticeAnnexInfo {
	notice_annex_path?: string | null;
	notice_annex_id?: string | null;
	notice_annex_name?: string | null;
	suffix?: string | null;
	type?: string | null;
}

export interface NoticeDetailResponse {
	state?: boolean;
	msg?: string;
	datas?: {
		notice_info?: NoticeDetailInfo | null;
	};
}

export interface FileReleaseDetailResponse {
	id?: number | string | null;
	filename?: string | null;
	filecode?: string | null;
	fileurl?: string | null;
	filetime?: string | null;
	state?: number | boolean | null;
	filedepartment?: string | null;
	upfilename?: string | null;
	explainDept?: string | null;
}

export interface FileReleaseDownloadUrlResponse {
	state?: boolean;
	url?: string | null;
}

export interface ApiResponseLike {
	bodyStream?(): AsyncIterable<Uint8Array>;
	cancelBody?(reason?: unknown): Promise<void>;
	headers?(): Record<string, string>;
	ok(): boolean;
	status(): number;
	statusText(): string;
	text(): Promise<string>;
}

export interface ApiRequestContextLike {
	get(path: string): Promise<ApiResponseLike>;
	post(
		path: string,
		input: {
			form: Record<string, string>;
		},
	): Promise<ApiResponseLike>;
}

export interface DisposableApiContextLike {
	dispose(): Promise<void>;
}
