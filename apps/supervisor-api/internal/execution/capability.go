package execution

import "strings"

var placeLookupSignals = []string{
	"在哪里",
	"在哪",
	"在哪儿",
	"怎么去",
	"怎么走",
	"位于哪里",
	"在什么地方",
	"在哪个门",
	"从哪个门进",
	"位置在哪",
}

var placeEntitySignals = []string{
	"图书馆",
	"食堂",
	"会议室",
	"教学楼",
	"宿舍",
	"校医院",
	"博物馆",
	"办公楼",
	"学院楼",
	"校门",
	"操场",
	"体育馆",
	"办公室",
	"办事大厅",
	"服务大厅",
}

var placeLocationNounSignals = []string{"位置", "地址"}

var nonSpatialWhereActionSignals = []string{
	"在哪里申请",
	"在哪申请",
	"在哪儿申请",
	"在哪里办理",
	"在哪办理",
	"在哪儿办理",
	"在哪里报名",
	"在哪报名",
	"在哪儿报名",
	"在哪里提交",
	"在哪提交",
	"在哪儿提交",
	"在哪里查看",
	"在哪查看",
	"在哪儿查看",
	"在哪里查询",
	"在哪查询",
	"在哪儿查询",
	"在哪里看",
	"在哪看",
	"在哪儿看",
}

var transportSignals = []string{"校车", "班车", "通勤车", "接驳车"}
var serviceStatusSignals = []string{
	"开门",
	"开放",
	"营业",
	"办公时间",
	"开放时间",
	"开到几点",
	"营业到几点",
	"状态",
}
var serviceSubjectSignals = []string{"图书馆", "食堂", "会议室", "校医院", "校园卡", "一卡通", "宿舍", "报修"}
var serviceGuideActionSignals = []string{
	"怎么申请",
	"如何申请",
	"怎么办理",
	"如何办理",
	"怎么办",
	"流程",
	"手续",
	"需要什么材料",
	"材料",
	"在哪里办",
	"在哪办",
	"入口",
	"办理时间",
	"联系方式",
	"联系谁",
	"补办",
	"退宿",
	"入住",
	"不住宿",
	"离校",
}
var serviceGuideSubjectSignals = []string{
	"学生公寓",
	"公寓",
	"宿舍",
	"住宿",
	"入住",
	"不住宿",
	"退宿",
	"离校",
	"校园卡",
	"一卡通",
	"会议室",
	"校医院",
	"报修",
}
var noticeSignals = []string{"通知", "公告", "公示"}

func effectiveCapability(
	requestedCapability string,
	userGoal string,
	hasRequestedScope bool,
	versionQuery versionQuery,
) string {
	if hasRequestedScope || (versionQuery.Mode != "" && versionQuery.Mode != "current") {
		if strings.TrimSpace(requestedCapability) == "" {
			return "knowledge"
		}
		return requestedCapability
	}
	if requestedCapability != "" && requestedCapability != "knowledge" {
		return requestedCapability
	}

	inferred := inferCapabilityFromGoal(userGoal)
	if requestedCapability == "knowledge" && inferred == "knowledge" {
		return "knowledge"
	}
	if inferred != "" {
		return inferred
	}
	return "knowledge"
}

func effectiveCapabilitySource(
	requestedCapability string,
	effectiveCapability string,
	hasRequestedScope bool,
	versionQuery versionQuery,
) string {
	normalizedRequestedCapability := strings.TrimSpace(requestedCapability)
	if normalizedRequestedCapability != "" && normalizedRequestedCapability != "knowledge" {
		return "explicit"
	}
	if hasRequestedScope || (versionQuery.Mode != "" && versionQuery.Mode != "current") {
		return "explicit_knowledge"
	}
	if effectiveCapability != "" && effectiveCapability != "knowledge" {
		return "inferred"
	}
	if normalizedRequestedCapability == "knowledge" {
		return "explicit_knowledge"
	}
	return "default"
}

func inferCapabilityFromGoal(userGoal string) string {
	normalized := normalizeGoal(userGoal)
	if normalized == "" {
		return "knowledge"
	}
	if containsAny(normalized, serviceGuideSubjectSignals) && containsAny(normalized, serviceGuideActionSignals) {
		return "campus_services"
	}
	if looksLikeNonSpatialWhereAction(normalized) {
		return "knowledge"
	}
	if containsAny(normalized, placeLookupSignals) && containsAny(normalized, placeEntitySignals) {
		return "place_lookup"
	}
	if containsAny(normalized, placeEntitySignals) && containsAny(normalized, placeLocationNounSignals) {
		return "place_lookup"
	}
	if containsAny(normalized, transportSignals) {
		return "campus_services"
	}
	if containsAny(normalized, serviceStatusSignals) && containsAny(normalized, serviceSubjectSignals) {
		return "campus_services"
	}
	if containsAny(normalized, noticeSignals) {
		return "notice"
	}
	return "knowledge"
}

func normalizeGoal(userGoal string) string {
	return strings.ToLower(strings.Join(strings.Fields(userGoal), ""))
}

func looksLikeNonSpatialWhereAction(normalizedGoal string) bool {
	return containsAny(normalizedGoal, nonSpatialWhereActionSignals)
}

func containsAny(value string, signals []string) bool {
	for _, signal := range signals {
		normalizedSignal := normalizeGoal(signal)
		if normalizedSignal != "" && strings.Contains(value, normalizedSignal) {
			return true
		}
	}
	return false
}
