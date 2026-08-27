import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
	createAppApiDatabasePool,
	readAppApiDatabaseEnv,
} from "../../src/script-support/shared-db/database.ts";

const LOCAL_DATABASE_NAME = /^campus_agent_wt_[0-9]+_[a-f0-9]{8}$/u;

const SECTIONS = [
	{ id: "acgn", name: "ACGN", position: 0 },
	{ id: "online-games", name: "线上游戏", position: 1 },
	{ id: "interest-groups", name: "同好群", position: 2 },
] as const;

type CampusGroupSeed = [
	id: string,
	sectionId: string,
	position: number,
	joinUrl: string | null,
	name: string,
	qqGroupNumber: string | null,
	summary: string,
	tags: string[],
];

const GROUPS: CampusGroupSeed[] = [
	["qq-533365461", "acgn", 0, null, "民大越共东物园", "533365461", "", ["东方"]],
	["qq-636272370", "acgn", 1, null, "中央民族大学型月群", "636272370", "", ["型月"]],
	[
		"qq-540475994",
		"acgn",
		2,
		null,
		"Tell Your World feat.MUC",
		"540475994",
		"本群兼具烤群与术群职能，欢迎大家来组车队和跑线下活",
		["PJSK", "术力口", "JPOP"],
	],
	["qq-879596093", "acgn", 3, null, "夜之瞳音游群", "879596093", "挂靠夜之瞳", ["音游"]],
	["qq-897940656", "acgn", 4, null, "muc漫画同好会", "897940656", "", ["漫画"]],
	["qq-260099368", "acgn", 5, null, "MUC轻小说同好会", "260099368", "", ["轻小说"]],
	["qq-216201492", "acgn", 6, null, "MUC动画研", "216201492", "", ["冷门番剧"]],
	[
		"qq-1005411538",
		"acgn",
		7,
		null,
		"CiRCLE 魏公村&魏各庄店",
		"1005411538",
		"",
		["BanG Dream", "二偶"],
	],
	["qq-300321279", "acgn", 8, null, "极上引诱会所", "300321279", "", ["音游"]],
	["qq-858285471", "acgn", 9, null, "中央民族大学 tcg 交流群", "858285471", "", ["游戏王"]],
	["qq-1054291421", "acgn", 10, null, "muc szb 坐牢群", "1054291421", "", ["影之诗"]],
	["qq-1058864200", "acgn", 11, null, "民大宝可梦", "1058864200", "", ["宝可梦"]],
	["qq-1062594491", "acgn", 12, null, "MUC游研社", "1062594491", "", ["大型单机游戏", "独立游戏"]],
	[
		"qq-656464025",
		"acgn",
		13,
		null,
		"王佐体育运动学校斯特拉斯堡分校",
		"656464025",
		"",
		["白色相簿2"],
	],
	["qq-209298341", "online-games", 0, null, "MUC神秘学研究专业", "209298341", "", ["重返未来1999"]],
	["qq-758753138", "online-games", 1, null, "MUC瓜游共研社", "758753138", "", ["碧蓝航线"]],
	["qq-470938363", "online-games", 2, null, "MUC原神提瓦特总部", "470938363", "", ["原神"]],
	["qq-760540871", "online-games", 3, null, "王佐体育运动学校", "760540871", "", ["赛马娘"]],
	["qq-516548117", "online-games", 4, null, "MUC煌珑潮人俱乐部", "516548117", "", ["库洛"]],
	[
		"qq-813087142",
		"online-games",
		5,
		null,
		"MUC战批深夜 emo 圣地（二刺螈版）",
		"813087142",
		"",
		["战地"],
	],
	["qq-678893379", "online-games", 6, null, "MUC矿石病共同体研究所", "678893379", "", ["明日方舟"]],
	[
		"qq-413647603",
		"online-games",
		7,
		null,
		"中央民族大学边狱巴士群",
		"413647603",
		"",
		["边狱巴士"],
	],
	["qq-1027120657", "online-games", 8, null, "火石酒馆 muc 分店", "1027120657", "", ["炉石传说"]],
	["qq-1065643381", "online-games", 9, null, "muc fps 聚合群", "1065643381", "", ["FPS"]],
	["contact-identity-v", "online-games", 10, null, "第五人格", null, "联系“ygo群持续招新”进群", []],
	[
		"qq-518470187",
		"online-games",
		11,
		null,
		"MUCESC 民大战略游戏社",
		"518470187",
		"",
		["战略游戏", "P社", "RTS"],
	],
	["qq-1019769525", "online-games", 12, null, "MUC驻燕客", "1019769525", "", ["燕云十六声"]],
	["qq-941434294", "online-games", 13, null, "MUC米哈游崩三咸鱼散养群", "941434294", "", ["崩坏3"]],
	["qq-808747482", "online-games", 14, null, "格里芬muc分部", "808747482", "", ["少女前线"]],
	["qq-677860762", "online-games", 15, null, "muc怪猎群", "677860762", "", ["怪物猎人"]],
	["contact-naruto", "online-games", 16, null, "火影忍者", null, "联系“网友风顺草”加群", []],
	["contact-overwatch", "online-games", 17, null, "守望先锋", null, "联系“ygo群持续招新”进群", []],
	[
		"qq-720518745",
		"online-games",
		18,
		null,
		"LML民大峡谷之巅推免交流群",
		"720518745",
		"已阵亡",
		["LOL"],
	],
	["qq-891277807", "online-games", 19, null, "冬谷基金会 MUC 分会", "891277807", "", ["物华弥新"]],
	["qq-284874509", "interest-groups", 0, null, "民大重型群", "284874509", "", ["重型乐队"]],
	["qq-1058520247", "interest-groups", 1, null, "愿荣光永存", "1058520247", "", ["历史"]],
	[
		"qq-825319996",
		"interest-groups",
		2,
		null,
		"民大 TRPG 交流群",
		"825319996",
		"",
		["TRPG", "跑团桌游"],
	],
	["qq-859546534", "interest-groups", 3, null, "夜之瞳桌游社", "859546534", "", ["桌游"]],
	["contact-tcg", "interest-groups", 4, null, "TCG", null, "联系“ygo群持续招新”进群", []],
	[
		"contact-minecraft",
		"interest-groups",
		5,
		null,
		"Minecraft",
		null,
		"联系“抓吗喽关我马楼仔什么事”进群",
		[],
	],
	[
		"qq-244329626",
		"interest-groups",
		6,
		null,
		"MUC胶佬互助组织",
		"244329626",
		"MUC模玩群，潮哥误入",
		["模型", "高达", "军模", "特摄", "机娘", "粘土"],
	],
	["contact-mahjong", "interest-groups", 7, null, "麻将", null, "联系“ygo群持续招新”进群", []],
	["qq-769786878", "interest-groups", 8, null, "语言神启动", "769786878", "", ["外语交流"]],
	["qq-935378939", "interest-groups", 9, null, "神秘烤蛇交流会", "935378939", "", ["cos"]],
	[
		"qq-1075631737",
		"interest-groups",
		10,
		null,
		"MUC中央民族大学蜂巢",
		"1075631737",
		"",
		["Neuro"],
	],
	[
		"contact-repo",
		"interest-groups",
		11,
		null,
		"REPO",
		null,
		"联系“抓吗喽关我马楼仔什么事”进群",
		[],
	],
	["qq-226055225", "interest-groups", 12, null, "石榴籽星团", "226055225", "", ["天文"]],
	["contact-photography", "interest-groups", 13, null, "摄影", null, "联系“网友风顺草”进群", []],
	[
		"qq-863056472",
		"interest-groups",
		14,
		null,
		"夜之瞳麻将群",
		"863056472",
		"主要是日麻",
		["麻将"],
	],
	[
		"qq-276863443",
		"interest-groups",
		15,
		null,
		"民大天堂鸡汤吧",
		"276863443",
		"",
		["对外校交流群"],
	],
	[
		"qq-912753044",
		"interest-groups",
		16,
		null,
		"民专未来科技研究所",
		"912753044",
		"",
		["命运石之门"],
	],
	[
		"qq-101616192",
		"interest-groups",
		17,
		null,
		"中央民族大学贴吧群（不固定）",
		"101616192",
		"进群须提供真实姓名和学号",
		["百度贴吧讨论群"],
	],
	[
		"discord-muc-community",
		"interest-groups",
		18,
		"https://discord.gg/XgQqU9zrPZ",
		"Discord",
		null,
		"请务必注意保护个人信息安全。",
		["中央民族大学Discord交流群"],
	],
	[
		"qq-220440068",
		"interest-groups",
		19,
		null,
		"中央民族大学图拉丁分部",
		"220440068",
		"中央民族大学电脑硬件同好交流群，垃圾佬和硬件同好欢迎进入",
		["图拉丁吧"],
	],
	[
		"qq-1070260875",
		"interest-groups",
		20,
		null,
		"目测美食群",
		"1070260875",
		"人，焦虑没什么不好的，就像烤肉，焦焦的很好吃~~~",
		["MUC美食群（唯一正统！！！不知道加什么群的新生看过来~~~）"],
	],
];

export async function seedLocalCampusGroups(
	envOverrides: NodeJS.ProcessEnv = process.env,
): Promise<{ groupCount: number; initialized: true; sectionCount: number }> {
	const env = readAppApiDatabaseEnv(envOverrides);
	assertLocalDatabaseUrl(env.databaseUrl);
	const pool = createAppApiDatabasePool(env);
	try {
		await pool.query("BEGIN");
		try {
			for (const section of SECTIONS) {
				await pool.query(
					`insert into campus_groups.sections (id, name, position)
					 values ($1, $2, $3)
					 on conflict (id) do update set name = excluded.name, position = excluded.position`,
					[section.id, section.name, section.position],
				);
			}
			for (const group of GROUPS) {
				await pool.query(
					`insert into campus_groups.groups
						(id, section_id, position, join_url, name, qq_group_number, summary, tags)
					 values ($1, $2, $3, $4, $5, $6, $7, $8)
					 on conflict (id) do update set
						section_id = excluded.section_id,
						position = excluded.position,
						join_url = excluded.join_url,
						name = excluded.name,
						qq_group_number = excluded.qq_group_number,
						summary = excluded.summary,
						tags = excluded.tags`,
					group,
				);
			}
			await pool.query("COMMIT");
		} catch (error) {
			await pool.query("ROLLBACK");
			throw error;
		}
		return { groupCount: GROUPS.length, initialized: true, sectionCount: SECTIONS.length };
	} finally {
		await pool.end();
	}
}

function assertLocalDatabaseUrl(value: string): void {
	const url = new URL(value);
	const databaseName = decodeURIComponent(url.pathname.slice(1));
	if (url.hostname !== "127.0.0.1" || !LOCAL_DATABASE_NAME.test(databaseName)) {
		throw new Error("The local campus groups can only be seeded into an isolated local database.");
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	seedLocalCampusGroups()
		.then((result) => console.log(JSON.stringify(result)))
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		});
}
