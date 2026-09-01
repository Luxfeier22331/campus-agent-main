import { NOTICE_CONTENT_ALIGNMENTS, NOTICE_CONTENT_ALLOWED_TAGS } from "campus-contracts/notices";

export const ALLOWED_TAGS = new Set<string>(NOTICE_CONTENT_ALLOWED_TAGS);
export const ALIGNMENTS = new Set<string>(NOTICE_CONTENT_ALIGNMENTS);

export const BLOCK_TAGS = new Set([
	"BLOCKQUOTE",
	"H3",
	"H4",
	"H5",
	"H6",
	"LI",
	"P",
	"TABLE",
	"TD",
	"TH",
	"TR",
]);

export const ALIGNABLE_TAGS = new Set(["BLOCKQUOTE", "H3", "H4", "H5", "H6", "P", "TD", "TH"]);
export const INLINE_PRESENTATION_TAGS = new Set([
	"A",
	"B",
	"BLOCKQUOTE",
	"EM",
	"FONT",
	"H3",
	"H4",
	"H5",
	"H6",
	"I",
	"LI",
	"MARK",
	"P",
	"S",
	"SPAN",
	"STRONG",
	"TD",
	"TH",
	"U",
]);
export const PRUNABLE_TAGS = new Set([
	"A",
	"B",
	"BLOCKQUOTE",
	"EM",
	"H3",
	"H4",
	"H5",
	"I",
	"LI",
	"MARK",
	"OL",
	"P",
	"S",
	"STRONG",
	"U",
	"UL",
]);
export const TEXT_EDGE_TAGS = new Set([
	"BLOCKQUOTE",
	"H3",
	"H4",
	"H5",
	"H6",
	"LI",
	"P",
	"TD",
	"TH",
]);
export const REPEATED_TITLE_TAGS = new Set(["H3", "H4", "H5", "H6", "P"]);

export const ALERT_COLORS = new Set([
	"#7b0c00",
	"#c00000",
	"#e53333",
	"#e54c5e",
	"#ee0000",
	"#ff0000",
	"red",
	"rgb(123,12,0)",
	"rgb(192,0,0)",
	"rgb(229,51,51)",
	"rgb(229,76,94)",
	"rgb(238,0,0)",
	"rgb(255,0,0)",
]);
export const HIGHLIGHT_COLORS = new Set(["#ff0", "#ffff00", "rgb(255,255,0)", "yellow"]);

export const GENERIC_IMAGE_NAME = /^(?:image|img|图片|微信图片)[\s_()（）-]*[0-9]*$/iu;
export const IMAGE_EXTENSION = /\.(?:avif|bmp|gif|jpe?g|png|webp)$/iu;
export const NON_DESCRIPTIVE_IMAGE_NAME = /^[0-9_()（）.-]+$/u;

export const NOTICE_TEXT_REPLACEMENTS = [
	["统计表干3月5日前", "统计表于3月5日前"],
	["Al+信息可视化设计", "AI+信息可视化设计"],
	["气模馆", "气膜馆"],
] as const;
export const LOGIN_CONTEXT =
	/登陆(?=[^。！？\n]{0,20}(?:系统|平台|网站|门户|页面|账号|账户|模块|客户端|小程序))/gu;
export const SPACE_BEFORE_CJK_PUNCTUATION = /[ \u3000]+([，。；：！？、）》】])/gu;
export const DUPLICATE_PUNCTUATION = /:\s*；/gu;
