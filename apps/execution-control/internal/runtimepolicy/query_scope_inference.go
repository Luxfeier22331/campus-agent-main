package runtimepolicy

import (
	"fmt"
	"strings"
)

type knowledgeScopeCandidate struct {
	scope   Scope
	score   int
	signals []string
}

func InferKnowledgeQueryScope(queryText string, policyPath string) (Scope, error) {
	normalized := NormalizeGoal(queryText)
	if normalized == "" {
		return Scope{}, fmt.Errorf("could not select knowledge query scope: query_text is empty")
	}
	candidates := []knowledgeScopeCandidate{
		scoreKnowledgeScope(
			"regulations",
			"student_rules",
			normalized,
			[]string{
				"本科学生", "学生", "学生手册", "奖学金", "国家奖学金", "助学金", "请假",
				"学籍", "转专业", "毕业", "推免", "保研", "处分", "申诉", "选课",
			},
		),
		scoreKnowledgeScope(
			"curriculum",
			"curriculum_plan",
			normalized,
			[]string{
				"培养方案", "培养计划", "人才培养", "课程", "学分", "专业", "大一", "大二",
				"大三", "大四", "学期", "毕业要求", "课程体系", "课程设置",
			},
		),
		scoreKnowledgeScope(
			"official_web",
			"stable_reference",
			normalized,
			[]string{
				"官网", "官方网站", "招生办公室", "联系方式", "联系电话", "地址", "学院官网",
				"部门主页",
			},
		),
		scoreKnowledgeScope(
			"regulations",
			"institutional_rules",
			normalized,
			[]string{
				"学校章程", "党委常委会", "校长办公会", "会议制度", "机构设置", "校级",
				"规章制度", "管理办法", "党政", "校务",
				"校园网", "校园网密码", "校园网认证", "校园网用户账号", "校园网接入",
				"上网账号", "网络账号", "统一身份认证", "统一认证", "信息门户",
				"智慧门户", "门户运行管理", "网络与信息", "信息化建设管理处",
			},
		),
	}
	selected, err := selectUniqueKnowledgeScopeCandidate(candidates)
	if err != nil {
		return Scope{}, err
	}
	allowed, err := QueryScopeAllowed(selected.scope.Corpus, selected.scope.Collection, policyPath)
	if err != nil {
		return Scope{}, err
	}
	if !allowed {
		return Scope{}, fmt.Errorf(
			"selected knowledge query scope %s/%s is not query-enabled",
			selected.scope.Corpus,
			selected.scope.Collection,
		)
	}
	return selected.scope, nil
}

func scoreKnowledgeScope(
	corpus string,
	collection string,
	normalizedQuery string,
	signals []string,
) knowledgeScopeCandidate {
	candidate := knowledgeScopeCandidate{scope: Scope{Corpus: corpus, Collection: collection}}
	for _, signal := range signals {
		normalizedSignal := NormalizeGoal(signal)
		if normalizedSignal == "" || !strings.Contains(normalizedQuery, normalizedSignal) {
			continue
		}
		candidate.score++
		candidate.signals = append(candidate.signals, signal)
	}
	return candidate
}

func selectUniqueKnowledgeScopeCandidate(candidates []knowledgeScopeCandidate) (knowledgeScopeCandidate, error) {
	var selected knowledgeScopeCandidate
	for _, candidate := range candidates {
		if candidate.score <= 0 {
			continue
		}
		if selected.score == 0 || candidate.score > selected.score {
			selected = candidate
			continue
		}
		if candidate.score == selected.score {
			return knowledgeScopeCandidate{}, fmt.Errorf(
				"could not select unique knowledge query scope: matched %s/%s and %s/%s",
				selected.scope.Corpus,
				selected.scope.Collection,
				candidate.scope.Corpus,
				candidate.scope.Collection,
			)
		}
	}
	if selected.score == 0 {
		return knowledgeScopeCandidate{}, fmt.Errorf("could not select knowledge query scope")
	}
	return selected, nil
}
