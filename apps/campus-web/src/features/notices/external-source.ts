export type ExternalNoticeSourceKind =
	| "campus"
	| "document"
	| "media"
	| "procurement"
	| "website"
	| "wechat";

export interface ExternalNoticeSource {
	hostname: string;
	kind: ExternalNoticeSourceKind;
	label: string;
}

const KNOWN_SOURCES: Readonly<Record<string, Pick<ExternalNoticeSource, "kind" | "label">>> = {
	"ctbpsp.com": {
		kind: "procurement",
		label: "中国招标投标公共服务平台",
	},
	"docs.qq.com": { kind: "document", label: "腾讯文档" },
	"ggzyfw.beijing.gov.cn": {
		kind: "procurement",
		label: "北京市公共资源交易平台",
	},
	"h.xinhuaxmt.com": { kind: "media", label: "新华社" },
	"mp.weixin.qq.com": { kind: "wechat", label: "微信公众号" },
	"www.ccgp.gov.cn": { kind: "procurement", label: "中国政府采购网" },
	"www.easyjcx.com": { kind: "procurement", label: "采购平台 · easyjcx.com" },
	"www.zycg.gov.cn": { kind: "procurement", label: "中央政府采购网" },
};

export function describeExternalNoticeSource(externalUrl: string): ExternalNoticeSource {
	const hostname = new URL(externalUrl).hostname.toLowerCase();
	const known = KNOWN_SOURCES[hostname];
	if (known) {
		return { hostname, ...known };
	}
	if (hostname === "muc.edu.cn" || hostname.endsWith(".muc.edu.cn")) {
		return {
			hostname,
			kind: "campus",
			label: `校内网站 · ${hostname}`,
		};
	}
	return {
		hostname,
		kind: "website",
		label: `外部网站 · ${hostname.replace(/^www\./u, "")}`,
	};
}
