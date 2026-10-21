export const OCR_MODEL = "PaddleOCR-VL-1.6" as const;
export const OCR_OPTIONS = {
	useDocOrientationClassify: false,
	useDocUnwarping: false,
	useChartRecognition: false,
} as const;

export interface OcrTarget {
	baseUrl: string;
	model: typeof OCR_MODEL;
	options: typeof OCR_OPTIONS;
}
export interface OcrConfig extends OcrTarget {
	apiKey: string;
	updatedAt: string;
}
export type OcrInput =
	| {
			kind: "source";
			key: string;
			noticeId: string;
			contentType: string;
			resource?: { kind: "image" | "attachment"; ordinal: number; displayOrdinal?: number };
	  }
	| { kind: "uploaded"; key: string; contentType: string }
	| { kind: "validation" };
export interface OcrPage {
	index: number;
	markdown: string;
	images: string[];
}
export interface OcrResult {
	rawKey: string;
	missingImages: string[];
}
export interface OcrTask {
	id: string;
	input: OcrInput;
	inputSha256: string | null;
	target: OcrTarget;
	configUpdatedAt: string;
	status: "pending" | "submitting" | "submitted" | "completed" | "failed";
	providerJobId: string | null;
	progress: { totalPages?: number; extractedPages?: number } | null;
	error: string | null;
	result: OcrResult | null;
	pageCount: number;
	createdAt: string;
	updatedAt: string;
}
export interface OcrObjects {
	getSource(key: string): Promise<Uint8Array>;
	getDerived(key: string): Promise<Uint8Array>;
	putDerived(key: string, body: Uint8Array, contentType: string): Promise<void>;
	deleteDerived(key: string): Promise<void>;
	close(): void;
}
export interface OcrTaskStore {
	get(id: string): Promise<OcrTask | null>;
	list(limit?: number): Promise<OcrTask[]>;
	listRecentResources(): Promise<OcrTask[]>;
	listNotice(noticeId: string): Promise<OcrTask[]>;
	create(input: OcrInput, config: OcrConfig, rerun?: boolean): Promise<OcrTask>;
	save(task: OcrTask): Promise<void>;
	getPages(taskId: string): Promise<OcrPage[]>;
	saveResult(task: OcrTask, pages: OcrPage[], result: OcrResult): Promise<void>;
	runnable(): Promise<OcrTask[]>;
}
