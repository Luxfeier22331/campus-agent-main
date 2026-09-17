import { ApiRequestError } from "@/platform/api/client";

const mediaMessages: Record<string, string> = {
	dining_submission_image_unavailable: "照片处理暂时不可用，请稍后重试。",
	dining_submission_storage_unavailable: "照片服务暂时不可用，请稍后重试。",
	dining_submission_payload_too_large: "上传内容超过限制，请选择不超过 10 MiB 的照片。",
	dining_submission_media_unsupported: "请选择 JPEG、PNG 或 WebP 照片。",
	dining_submission_photo_invalid: "照片无法处理：可能已损坏、包含动画或尺寸超限，请重新选择。",
};

export function submissionErrorMessage(error: Error) {
	return error instanceof ApiRequestError
		? (mediaMessages[error.code ?? ""] ?? error.message)
		: "操作结果未确认，请检查网络后重试。";
}
