import type { HubEntryState } from "./manifest";

export function formatEntryState(state: HubEntryState): string {
	switch (state) {
		case "available":
			return "可用";
		case "preview":
			return "预览";
		case "gated":
			return "受保护";
		case "coming_soon":
			return "即将开放";
		case "external_legacy":
			return "外部服务";
		default:
			return "未知";
	}
}
