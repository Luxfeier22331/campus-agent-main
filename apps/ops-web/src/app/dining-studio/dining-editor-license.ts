// tldraw 会在客户端校验该公开 key；部署构建通过 VITE_TLDRAW_LICENSE_KEY 提供，
// 本地 loopback 不设置它以使用 tldraw 开发模式。
export const DINING_TLDRAW_LICENSE = {
	key: import.meta.env.VITE_TLDRAW_LICENSE_KEY?.trim() || undefined,
} as const;
