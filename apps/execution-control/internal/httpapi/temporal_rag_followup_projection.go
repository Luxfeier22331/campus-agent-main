package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
)

type ragConversationRewrite struct {
	QueryText             string
	Projection            ragruntime.QueryRewriteProjection
	PreviousEvidenceReuse *ragruntime.PreviousEvidenceReuseProjection
	PreviousEvidenceRefs  []conversationEvidenceRef
}

type conversationEvidenceRef struct {
	AccessScope  string
	Collection   string
	ContentHash  string
	DocumentID   string
	EvidenceID   string
	SectionTitle string
	Snippet      string
	SourceID     string
	SnapshotID   string
	Title        string
	VersionID    string
}

func ragConversationRewriteForPayload(
	queryText string,
	payload map[string]any,
) (ragConversationRewrite, error) {
	conversation := cloneAnyMapFromMetadata(nestedAny(payload, "context", "conversation"))
	refs := conversationPreviousEvidenceRefs(conversation)
	previousAnswerSummary := firstNonEmptyText(conversation["previous_answer_summary"])
	recentContext := conversationRecentTurnContext(conversation)
	isFollowup := isContextualFollowupQuery(queryText)
	if isFollowup && len(refs) == 0 && previousAnswerSummary == "" && recentContext == "" {
		return ragConversationRewrite{}, errors.New("rag follow-up query requires resolvable conversation context")
	}

	standaloneQuery := queryText
	referenceType := "none"
	referenceIDs := []string{}
	reuse := &ragruntime.PreviousEvidenceReuseProjection{Decision: "not_available"}
	if len(refs) > 0 {
		reuse = previousEvidenceReuseProjection(refs, isFollowup)
	}
	if isFollowup {
		switch {
		case len(refs) > 0:
			referenceType = "previous_evidence"
			referenceIDs = evidenceIDs(refs)
			standaloneQuery = joinNonEmptyText(
				queryText,
				"上一轮证据: "+previousEvidenceContext(refs),
				"上一轮回答: "+previousAnswerSummary,
				"最近对话: "+recentContext,
			)
		case previousAnswerSummary != "":
			referenceType = "previous_answer"
			standaloneQuery = joinNonEmptyText(queryText, "上一轮回答: "+previousAnswerSummary, "最近对话: "+recentContext)
		default:
			referenceType = "recent_turns"
			standaloneQuery = joinNonEmptyText(queryText, "最近对话: "+recentContext)
		}
	}

	return ragConversationRewrite{
		QueryText: strings.TrimSpace(standaloneQuery),
		Projection: ragruntime.QueryRewriteProjection{
			StandaloneQueryHash:  "sha256:" + sha256HexForRAGRewrite(standaloneQuery),
			ResolutionState:      "resolved",
			FollowupReference:    ragruntime.FollowupReferenceProjection{Type: referenceType, IDs: referenceIDs},
			RequiresNewRetrieval: true,
		},
		PreviousEvidenceReuse: reuse,
		PreviousEvidenceRefs:  refs,
	}, nil
}

func conversationPreviousEvidenceRefs(conversation map[string]any) []conversationEvidenceRef {
	rawRefs, ok := conversation["previous_evidence_refs"].([]any)
	if !ok {
		return nil
	}
	refs := make([]conversationEvidenceRef, 0, len(rawRefs))
	for _, raw := range rawRefs {
		refMap, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		ref := conversationEvidenceRef{
			AccessScope:  firstNonEmptyText(refMap["access_scope"]),
			Collection:   firstNonEmptyText(refMap["collection"]),
			ContentHash:  firstNonEmptyText(refMap["content_hash"]),
			DocumentID:   firstNonEmptyText(refMap["document_id"]),
			EvidenceID:   firstNonEmptyText(refMap["evidence_id"]),
			SectionTitle: firstNonEmptyText(refMap["section_title"]),
			Snippet:      firstNonEmptyText(refMap["snippet"]),
			SourceID:     firstNonEmptyText(refMap["source_id"]),
			SnapshotID:   firstNonEmptyText(refMap["snapshot_id"]),
			Title:        firstNonEmptyText(refMap["title"]),
			VersionID:    firstNonEmptyText(refMap["version_id"], refMap["snapshot_id"]),
		}
		if ref.EvidenceID != "" && ref.SourceID != "" {
			refs = append(refs, ref)
		}
	}
	return refs
}

func conversationRecentTurnContext(conversation map[string]any) string {
	rawTurns, ok := conversation["recent_turns"].([]any)
	if !ok {
		return ""
	}
	parts := []string{}
	for index := len(rawTurns) - 1; index >= 0 && len(parts) < 2; index-- {
		turn, ok := rawTurns[index].(map[string]any)
		if !ok {
			continue
		}
		text := firstNonEmptyText(turn["summary"], turn["content"])
		if text != "" {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, "；")
}

func previousEvidenceContext(refs []conversationEvidenceRef) string {
	parts := make([]string, 0, len(refs))
	for _, ref := range refs {
		parts = append(parts, joinNonEmptyText(ref.Title, ref.SectionTitle, ref.Snippet))
		if len(parts) >= 3 {
			break
		}
	}
	return strings.Join(parts, "；")
}

func previousEvidenceReuseProjection(
	refs []conversationEvidenceRef,
	isFollowup bool,
) *ragruntime.PreviousEvidenceReuseProjection {
	decision := "not_reused_new_question"
	if isFollowup {
		decision = "contextual_anchor_for_new_retrieval"
	}
	return &ragruntime.PreviousEvidenceReuseProjection{
		Decision:             decision,
		EvidenceIDs:          evidenceIDs(refs),
		PreferredDocumentIDs: preferredDocumentIDs(refs),
		ProofRefs:            previousEvidenceProofRefs(refs),
		VersionIDs:           evidenceVersionIDs(refs),
	}
}

func validateRAGPreviousEvidenceScope(
	rewrite ragConversationRewrite,
	scope runtimepolicy.Scope,
) error {
	if rewrite.PreviousEvidenceReuse == nil ||
		rewrite.PreviousEvidenceReuse.Decision != "contextual_anchor_for_new_retrieval" {
		return nil
	}
	for _, ref := range rewrite.PreviousEvidenceRefs {
		if ref.Collection != "" && ref.Collection != scope.Collection {
			return fmt.Errorf("rag previous evidence scope mismatch: %s does not match %s", ref.Collection, scope.Collection)
		}
	}
	return nil
}

func applyPreviousEvidenceSelector(
	step *ragruntime.RetrievalStepProjection,
	reuse *ragruntime.PreviousEvidenceReuseProjection,
) {
	if step == nil || reuse == nil || reuse.Decision != "contextual_anchor_for_new_retrieval" {
		return
	}
	step.Selector.PreferredDocumentIDs = append(
		step.Selector.PreferredDocumentIDs,
		reuse.PreferredDocumentIDs...,
	)
}

type ragFollowupClassification string

const (
	ragFollowupStandalone ragFollowupClassification = "standalone"
	ragFollowupContextual ragFollowupClassification = "contextual_followup"
	ragFollowupAmbiguous  ragFollowupClassification = "ambiguous_followup"
)

func isContextualFollowupQuery(query string) bool {
	classification := classifyRAGFollowupQuery(query)
	return classification == ragFollowupContextual || classification == ragFollowupAmbiguous
}

func classifyRAGFollowupQuery(query string) ragFollowupClassification {
	normalized := normalizeRAGFollowupQuery(query)
	if normalized == "" {
		return ragFollowupStandalone
	}
	if containsAnyRAGFollowupSignal(normalized, []string{
		"这个", "那个", "这条", "那条", "上一条", "上条", "刚才", "前面", "其中",
		"第一点", "第二点", "第三点",
	}) {
		return ragFollowupContextual
	}
	if hasPronounRAGFollowupReference(normalized) {
		return ragFollowupAmbiguous
	}
	if hasStandaloneRAGSubject(normalized) {
		return ragFollowupStandalone
	}
	if containsAnyRAGFollowupSignal(normalized, []string{
		"继续", "展开", "详细说", "详细说明", "具体说", "具体说明",
	}) {
		return ragFollowupAmbiguous
	}
	return ragFollowupStandalone
}

func normalizeRAGFollowupQuery(query string) string {
	return strings.ToLower(strings.Join(strings.Fields(query), ""))
}

func containsAnyRAGFollowupSignal(normalized string, signals []string) bool {
	for _, signal := range signals {
		if strings.Contains(normalized, signal) {
			return true
		}
	}
	return false
}

func hasPronounRAGFollowupReference(normalized string) bool {
	if strings.Contains(normalized, "其他") || strings.Contains(normalized, "其它") {
		return false
	}
	if strings.Contains(normalized, "它") {
		return len([]rune(normalized)) <= 12 || containsAnyRAGFollowupSignal(normalized, []string{
			"它的", "对它", "它是", "它要", "它需", "它们",
		})
	}
	return containsAnyRAGFollowupSignal(normalized, []string{
		"其要求", "其流程", "其条件", "其依据", "其原则", "其内容", "其原因", "其材料",
	})
}

func hasStandaloneRAGSubject(normalized string) bool {
	return containsAnyRAGFollowupSignal(normalized, []string{
		"中央民族大学", "本科学生", "学生手册", "奖学金", "国家奖学金", "助学金",
		"评审办法", "管理办法", "申请条件", "请假", "学籍", "转专业", "毕业",
		"推免", "保研", "处分", "申诉", "选课", "培养方案", "培养计划", "课程",
		"学分", "专业", "官网", "官方网站", "招生办公室", "联系方式", "联系电话",
		"地址", "学院官网", "部门主页", "学校章程", "规章制度", "校园网",
		"统一身份认证", "信息门户", "智慧门户",
	})
}

func evidenceIDs(refs []conversationEvidenceRef) []string {
	values := make([]string, 0, len(refs))
	for _, ref := range refs {
		if ref.EvidenceID != "" {
			values = append(values, ref.EvidenceID)
		}
	}
	return dedupeStrings(values)
}

func preferredDocumentIDs(refs []conversationEvidenceRef) []string {
	values := make([]string, 0, len(refs))
	for _, ref := range refs {
		values = append(values, firstNonEmptyText(ref.DocumentID, ref.SourceID))
	}
	return dedupeStrings(values)
}

func evidenceVersionIDs(refs []conversationEvidenceRef) []string {
	values := make([]string, 0, len(refs))
	for _, ref := range refs {
		if ref.VersionID != "" {
			values = append(values, ref.VersionID)
		}
	}
	return dedupeStrings(values)
}

func previousEvidenceProofRefs(refs []conversationEvidenceRef) []ragruntime.PreviousEvidenceContextItem {
	items := make([]ragruntime.PreviousEvidenceContextItem, 0, len(refs))
	for _, ref := range refs {
		item := ragruntime.PreviousEvidenceContextItem{
			AccessScope:  ref.AccessScope,
			Collection:   ref.Collection,
			ContentHash:  ref.ContentHash,
			DocumentID:   ref.DocumentID,
			EvidenceID:   ref.EvidenceID,
			SectionTitle: ref.SectionTitle,
			SnapshotID:   ref.SnapshotID,
			Snippet:      ref.Snippet,
			SourceID:     ref.SourceID,
			Title:        ref.Title,
			VersionID:    ref.VersionID,
		}
		if item.EvidenceID == "" || item.SourceID == "" || item.ContentHash == "" || item.AccessScope == "" {
			continue
		}
		items = append(items, item)
	}
	return items
}

func dedupeStrings(values []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" || seen[trimmed] {
			continue
		}
		seen[trimmed] = true
		result = append(result, trimmed)
	}
	return result
}

func joinNonEmptyText(values ...string) string {
	parts := []string{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			parts = append(parts, trimmed)
		}
	}
	return strings.Join(parts, "\n")
}

func sha256HexForRAGRewrite(value string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(value)))
	return hex.EncodeToString(sum[:])
}
