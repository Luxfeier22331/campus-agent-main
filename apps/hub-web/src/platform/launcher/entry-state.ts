import type { HubEntryState } from "./manifest";

export function formatEntryState(state: HubEntryState): string {
	switch (state) {
		case "available":
			return "可用";
		case "preview":
			return "预览";
		case "gated":
			return "受保护";
		case "planned":
			return "规划中";
		case "external":
			return "外部服务";
		default:
			return "未知";
	}
}
