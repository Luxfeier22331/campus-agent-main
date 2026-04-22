const data = {
	generatedAt: "2026-04-22T22:51:02.643679+00:00",
	documentTitle: "光电信息科学与工程本科人才培养方案",
	documentId: "curriculum:光电信息科学与工程本科人才培养方案",
	rawAssetId: "asset:curriculum-plan-2022",
	rawVersionId: "sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67",
	blocks: [
		{
			blockId: "page-0429-page-0429-block-mineru-block-0002-0002-map-01",
			title: "光电信息科学与工程专业本科课程结构拓扑图",
			status: "partial",
			titleConfidence: "partial",
			pageNumber: 429,
			rowId: "page-0429-block-mineru-block-0002-0002",
			mapIndex: 1,
			parentHeadingHint: "七、课程地图",
			displayStageLabels: [
				"本科一年级",
				"本科二年级",
				"本科三年级",
				"本科四年级"
			],
			extractionNotes: [
				"当前裁切区域仅识别到 1 张完整课程地图，未拆分出更多独立子图。",
				"图中存在重复课程名（如各年级的思政课、综合素养课、专业选修课），当前按不同年级分别建节点，但边仅保留图上明确可见者。",
				"部分节点文字在图中换行显示，如“光电信息基础实验/光电专业实训/课程设计”，此处按可见文本合并为单个node_label。",
				"未为颜色图例推断category_label，均留空以避免误判。",
				"仅记录了箭头方向清晰可见的连线；未推断隐含先修关系。",
				"至少有一个检测到的课程地图区域标题不够清晰。"
			],
			imageSrc: "/course-maps/光电信息科学与工程本科人才培养方案/page-0429-page-0429-block-mineru-block-0002-0002-map-01.png",
			nodes: [
				{
					node_label: "思政课",
					stage_label: "本科一年级",
					category_label: "",
					route_group: "foundation",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "综合素养课",
					stage_label: "本科一年级",
					category_label: "",
					route_group: "foundation",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "基本素养课",
					stage_label: "本科一年级",
					category_label: "",
					route_group: "foundation",
					incoming_count: 0,
					outgoing_count: 1
				},
				{
					node_label: "高等数学",
					stage_label: "本科一年级",
					category_label: "",
					route_group: "foundation",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "线性代数",
					stage_label: "本科一年级",
					category_label: "",
					route_group: "foundation",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "专业导论",
					stage_label: "本科一年级",
					category_label: "",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "大学物理与实验（一）上",
					stage_label: "本科一年级",
					category_label: "",
					route_group: "foundation",
					incoming_count: 0,
					outgoing_count: 1
				},
				{
					node_label: "C语言程序设计",
					stage_label: "本科一年级",
					category_label: "",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 1
				},
				{
					node_label: "工程图学基础",
					stage_label: "本科一年级",
					category_label: "",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 1
				},
				{
					node_label: "Python语言程序设计",
					stage_label: "本科一年级",
					category_label: "",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 1
				},
				{
					node_label: "金工实习",
					stage_label: "本科一年级",
					category_label: "",
					route_group: "practice",
					incoming_count: 1,
					outgoing_count: 0
				},
				{
					node_label: "Matlab程序设计",
					stage_label: "本科一年级",
					category_label: "",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 0
				},
				{
					node_label: "思政课",
					stage_label: "本科二年级",
					category_label: "",
					route_group: "foundation",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "综合素养课",
					stage_label: "本科二年级",
					category_label: "",
					route_group: "foundation",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "基本素养课",
					stage_label: "本科二年级",
					category_label: "",
					route_group: "foundation",
					incoming_count: 0,
					outgoing_count: 1
				},
				{
					node_label: "概率论与数理统计",
					stage_label: "本科二年级",
					category_label: "",
					route_group: "foundation",
					incoming_count: 1,
					outgoing_count: 0
				},
				{
					node_label: "大学物理与实验（一）下",
					stage_label: "本科二年级",
					category_label: "",
					route_group: "foundation",
					incoming_count: 1,
					outgoing_count: 0
				},
				{
					node_label: "数学物理方法",
					stage_label: "本科二年级",
					category_label: "",
					route_group: "foundation",
					incoming_count: 0,
					outgoing_count: 1
				},
				{
					node_label: "电磁场与电磁波",
					stage_label: "本科二年级",
					category_label: "",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 2
				},
				{
					node_label: "电子技术基础/实验",
					stage_label: "本科二年级",
					category_label: "",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 1
				},
				{
					node_label: "电子工艺实习",
					stage_label: "本科二年级",
					category_label: "",
					route_group: "practice",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "应用光学",
					stage_label: "本科二年级",
					category_label: "",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 2
				},
				{
					node_label: "物理光学",
					stage_label: "本科二年级",
					category_label: "",
					route_group: "foundation",
					incoming_count: 1,
					outgoing_count: 1
				},
				{
					node_label: "光电信息基础实验光电专业实训/课程设计",
					stage_label: "本科二年级",
					category_label: "",
					route_group: "practice",
					incoming_count: 2,
					outgoing_count: 1
				},
				{
					node_label: "思政课",
					stage_label: "本科三年级",
					category_label: "",
					route_group: "foundation",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "综合素养课",
					stage_label: "本科三年级",
					category_label: "",
					route_group: "foundation",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "专业选修课",
					stage_label: "本科三年级",
					category_label: "",
					route_group: "extension",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "量子物理",
					stage_label: "本科三年级",
					category_label: "",
					route_group: "foundation",
					incoming_count: 0,
					outgoing_count: 2
				},
				{
					node_label: "激光技术与应用",
					stage_label: "本科三年级",
					category_label: "",
					route_group: "core",
					incoming_count: 2,
					outgoing_count: 1
				},
				{
					node_label: "半导体器件物理",
					stage_label: "本科三年级",
					category_label: "",
					route_group: "foundation",
					incoming_count: 1,
					outgoing_count: 0
				},
				{
					node_label: "导波光学基础",
					stage_label: "本科三年级",
					category_label: "",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 1
				},
				{
					node_label: "光电子技术基础",
					stage_label: "本科三年级",
					category_label: "",
					route_group: "core",
					incoming_count: 0,
					outgoing_count: 1
				},
				{
					node_label: "光电信息专业实验",
					stage_label: "本科三年级",
					category_label: "",
					route_group: "core",
					incoming_count: 2,
					outgoing_count: 0
				},
				{
					node_label: "光电专业课程设计",
					stage_label: "本科三年级",
					category_label: "",
					route_group: "practice",
					incoming_count: 1,
					outgoing_count: 1
				},
				{
					node_label: "专业选修课",
					stage_label: "本科四年级",
					category_label: "",
					route_group: "extension",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "本硕贯通课",
					stage_label: "本科四年级",
					category_label: "",
					route_group: "extension",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "跨学科交叉课",
					stage_label: "本科四年级",
					category_label: "",
					route_group: "extension",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "行业协同育人课",
					stage_label: "本科四年级",
					category_label: "",
					route_group: "extension",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "全球胜任力课",
					stage_label: "本科四年级",
					category_label: "",
					route_group: "extension",
					incoming_count: 0,
					outgoing_count: 0
				},
				{
					node_label: "工程伦理",
					stage_label: "本科四年级",
					category_label: "",
					route_group: "core",
					incoming_count: 1,
					outgoing_count: 1
				},
				{
					node_label: "毕业论文",
					stage_label: "本科四年级",
					category_label: "",
					route_group: "practice",
					incoming_count: 2,
					outgoing_count: 0
				},
				{
					node_label: "学年论文",
					stage_label: "本科四年级",
					category_label: "",
					route_group: "practice",
					incoming_count: 0,
					outgoing_count: 0
				}
			],
			edges: [
				{
					source_label: "大学物理与实验（一）上",
					target_label: "大学物理与实验（一）下"
				},
				{
					source_label: "C语言程序设计",
					target_label: "Python语言程序设计"
				},
				{
					source_label: "Python语言程序设计",
					target_label: "Matlab程序设计"
				},
				{
					source_label: "工程图学基础",
					target_label: "金工实习"
				},
				{
					source_label: "基本素养课",
					target_label: "概率论与数理统计"
				},
				{
					source_label: "数学物理方法",
					target_label: "电磁场与电磁波"
				},
				{
					source_label: "电磁场与电磁波",
					target_label: "电子技术基础/实验"
				},
				{
					source_label: "应用光学",
					target_label: "物理光学"
				},
				{
					source_label: "电子技术基础/实验",
					target_label: "光电信息基础实验光电专业实训/课程设计"
				},
				{
					source_label: "物理光学",
					target_label: "光电信息基础实验光电专业实训/课程设计"
				},
				{
					source_label: "电磁场与电磁波",
					target_label: "激光技术与应用"
				},
				{
					source_label: "应用光学",
					target_label: "导波光学基础"
				},
				{
					source_label: "量子物理",
					target_label: "激光技术与应用"
				},
				{
					source_label: "量子物理",
					target_label: "半导体器件物理"
				},
				{
					source_label: "激光技术与应用",
					target_label: "光电信息专业实验"
				},
				{
					source_label: "导波光学基础",
					target_label: "光电信息专业实验"
				},
				{
					source_label: "光电子技术基础",
					target_label: "工程伦理"
				},
				{
					source_label: "光电信息基础实验光电专业实训/课程设计",
					target_label: "光电专业课程设计"
				},
				{
					source_label: "光电专业课程设计",
					target_label: "毕业论文"
				},
				{
					source_label: "工程伦理",
					target_label: "毕业论文"
				}
			]
		}
	]
} as const;

export default data;
