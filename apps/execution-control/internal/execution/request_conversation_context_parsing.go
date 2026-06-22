package execution

import (
	"encoding/json"
	"fmt"
)

func parseConversationContext(raw json.RawMessage) (map[string]any, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	rawConversation, err := parseObject(raw, "context.conversation")
	if err != nil {
		return nil, fmt.Errorf("context.conversation must be an object")
	}
	if err := assertSupportedFields(
		rawConversation,
		[]string{
			"schema_version",
			"conversation_id",
			"user_message_id",
			"parent_message_id",
			"current_user_message",
			"recent_turns",
			"previous_answer_summary",
			"previous_evidence_refs",
			"previous_capability_results",
			"session_state",
			"visibility",
			"memory_recall",
			"source_attribution",
			"context_summary",
			"budget",
			"truncation",
		},
		"context.conversation",
		"unsupported conversation context fields are not allowed: %s",
	); err != nil {
		return nil, err
	}
	schemaVersion, err := requireString(
		rawConversation["schema_version"],
		"context.conversation.schema_version",
	)
	if err != nil {
		return nil, err
	}
	if schemaVersion != "conversation_context.v1" {
		return nil, fmt.Errorf("context.conversation.schema_version is unsupported: %s", schemaVersion)
	}
	if _, err := requireString(
		rawConversation["conversation_id"],
		"context.conversation.conversation_id",
	); err != nil {
		return nil, err
	}
	if _, err := requireString(
		rawConversation["user_message_id"],
		"context.conversation.user_message_id",
	); err != nil {
		return nil, err
	}
	if err := parseCurrentUserMessage(rawConversation["current_user_message"]); err != nil {
		return nil, err
	}
	if err := parseRecentTurns(rawConversation["recent_turns"]); err != nil {
		return nil, err
	}
	if err := parsePreviousEvidenceRefs(rawConversation["previous_evidence_refs"]); err != nil {
		return nil, err
	}
	if err := parsePreviousCapabilityResults(rawConversation["previous_capability_results"]); err != nil {
		return nil, err
	}
	if err := parseConversationVisibility(rawConversation["visibility"]); err != nil {
		return nil, err
	}
	if err := parseConversationMemoryRecall(rawConversation["memory_recall"]); err != nil {
		return nil, err
	}
	if err := parseSourceAttribution(rawConversation["source_attribution"]); err != nil {
		return nil, err
	}
	if err := parseConversationBudget(rawConversation["budget"]); err != nil {
		return nil, err
	}
	if len(rawConversation["session_state"]) == 0 {
		return nil, fmt.Errorf("context.conversation.session_state is required")
	}
	if _, ok := rawConversation["context_summary"]; !ok {
		return nil, fmt.Errorf("context.conversation.context_summary is required")
	}
	if _, ok := rawConversation["truncation"]; !ok {
		return nil, fmt.Errorf("context.conversation.truncation is required")
	}

	var projected map[string]any
	if err := json.Unmarshal(raw, &projected); err != nil {
		return nil, fmt.Errorf("context.conversation must be an object")
	}
	return projected, nil
}

func parseCurrentUserMessage(raw json.RawMessage) error {
	rawMessage, err := parseObject(raw, "context.conversation.current_user_message")
	if err != nil {
		return fmt.Errorf("context.conversation.current_user_message must be an object")
	}
	if err := assertSupportedFields(
		rawMessage,
		[]string{"role", "content"},
		"context.conversation.current_user_message",
		"unsupported current user message fields are not allowed: %s",
	); err != nil {
		return err
	}
	role, err := requireString(rawMessage["role"], "context.conversation.current_user_message.role")
	if err != nil {
		return err
	}
	if role != "user" {
		return fmt.Errorf("context.conversation.current_user_message.role must be user")
	}
	_, err = requireString(
		rawMessage["content"],
		"context.conversation.current_user_message.content",
	)
	return err
}

func parseRecentTurns(raw json.RawMessage) error {
	turns, err := parseArray(raw, "context.conversation.recent_turns")
	if err != nil {
		return err
	}
	for index, rawTurn := range turns {
		fieldPrefix := fmt.Sprintf("context.conversation.recent_turns[%d]", index)
		turn, err := parseObject(rawTurn, fieldPrefix)
		if err != nil {
			return fmt.Errorf("%s must be an object", fieldPrefix)
		}
		if err := assertSupportedFields(
			turn,
			[]string{"role", "message_id", "content", "summary", "created_at"},
			fieldPrefix,
			"unsupported recent turn fields are not allowed: %s",
		); err != nil {
			return err
		}
		role, err := requireString(turn["role"], fieldPrefix+".role")
		if err != nil {
			return err
		}
		if role != "user" && role != "assistant" {
			return fmt.Errorf("%s.role must be user or assistant", fieldPrefix)
		}
		if _, err := requireString(turn["message_id"], fieldPrefix+".message_id"); err != nil {
			return err
		}
	}
	return nil
}

func parsePreviousEvidenceRefs(raw json.RawMessage) error {
	refs, err := parseArray(raw, "context.conversation.previous_evidence_refs")
	if err != nil {
		return err
	}
	for index, rawRef := range refs {
		fieldPrefix := fmt.Sprintf("context.conversation.previous_evidence_refs[%d]", index)
		ref, err := parseObject(rawRef, fieldPrefix)
		if err != nil {
			return fmt.Errorf("%s must be an object", fieldPrefix)
		}
		if err := assertSupportedFields(
			ref,
			[]string{
				"evidence_id",
				"source_id",
				"document_id",
				"version_id",
				"snapshot_id",
				"content_hash",
				"source_kind",
				"collection",
				"evidence_role",
				"access_scope",
				"title",
				"section_title",
				"snippet",
			},
			fieldPrefix,
			"unsupported previous evidence ref fields are not allowed: %s",
		); err != nil {
			return err
		}
		for _, field := range []string{"evidence_id", "source_id", "content_hash", "access_scope"} {
			if _, err := requireString(ref[field], fieldPrefix+"."+field); err != nil {
				return err
			}
		}
		versionID, err := parseOptionalString(ref["version_id"])
		if err != nil {
			return fmt.Errorf("%s.version_id must be a string", fieldPrefix)
		}
		snapshotID, err := parseOptionalString(ref["snapshot_id"])
		if err != nil {
			return fmt.Errorf("%s.snapshot_id must be a string", fieldPrefix)
		}
		if versionID == "" && snapshotID == "" {
			return fmt.Errorf("%s must include version_id or snapshot_id", fieldPrefix)
		}
	}
	return nil
}

func parsePreviousCapabilityResults(raw json.RawMessage) error {
	refs, err := parseArray(raw, "context.conversation.previous_capability_results")
	if err != nil {
		return err
	}
	for index, rawRef := range refs {
		fieldPrefix := fmt.Sprintf("context.conversation.previous_capability_results[%d]", index)
		ref, err := parseObject(rawRef, fieldPrefix)
		if err != nil {
			return fmt.Errorf("%s must be an object", fieldPrefix)
		}
		if err := assertSupportedFields(
			ref,
			[]string{
				"request_id",
				"run_id",
				"capability",
				"result_kind",
				"projection_ref",
				"content_hash",
				"status",
				"summary",
			},
			fieldPrefix,
			"unsupported previous capability result fields are not allowed: %s",
		); err != nil {
			return err
		}
		for _, field := range []string{
			"request_id",
			"run_id",
			"capability",
			"result_kind",
			"projection_ref",
			"content_hash",
			"status",
		} {
			if _, err := requireString(ref[field], fieldPrefix+"."+field); err != nil {
				return err
			}
		}
		if summary, err := parseOptionalString(ref["summary"]); err != nil {
			return fmt.Errorf("%s.summary must be a string", fieldPrefix)
		} else if len(summary) > 500 {
			return fmt.Errorf("%s.summary exceeds limit", fieldPrefix)
		}
	}
	return nil
}

func parseConversationVisibility(raw json.RawMessage) error {
	visibility, err := parseObject(raw, "context.conversation.visibility")
	if err != nil {
		return fmt.Errorf("context.conversation.visibility must be an object")
	}
	if err := assertSupportedFields(
		visibility,
		[]string{"model_visible", "runtime_only"},
		"context.conversation.visibility",
		"unsupported conversation visibility fields are not allowed: %s",
	); err != nil {
		return err
	}
	if _, err := parseStringArray(
		visibility["model_visible"],
		"context.conversation.visibility.model_visible",
	); err != nil {
		return err
	}
	if _, err := parseStringArray(
		visibility["runtime_only"],
		"context.conversation.visibility.runtime_only",
	); err != nil {
		return err
	}
	return nil
}

func parseConversationMemoryRecall(raw json.RawMessage) error {
	memoryRecall, err := parseObject(raw, "context.conversation.memory_recall")
	if err != nil {
		return fmt.Errorf("context.conversation.memory_recall must be an object")
	}
	if err := assertSupportedFields(
		memoryRecall,
		[]string{"gate_field", "owner", "runtime"},
		"context.conversation.memory_recall",
		"unsupported conversation memory recall fields are not allowed: %s",
	); err != nil {
		return err
	}
	expected := map[string]string{
		"gate_field": "context.memory.enabled",
		"owner":      "execution-control",
		"runtime":    "hindsight",
	}
	for field, want := range expected {
		got, err := requireString(memoryRecall[field], "context.conversation.memory_recall."+field)
		if err != nil {
			return err
		}
		if got != want {
			return fmt.Errorf("context.conversation.memory_recall.%s must be %s", field, want)
		}
	}
	return nil
}

func parseSourceAttribution(raw json.RawMessage) error {
	entries, err := parseArray(raw, "context.conversation.source_attribution")
	if err != nil {
		return err
	}
	for index, rawEntry := range entries {
		fieldPrefix := fmt.Sprintf("context.conversation.source_attribution[%d]", index)
		entry, err := parseObject(rawEntry, fieldPrefix)
		if err != nil {
			return fmt.Errorf("%s must be an object", fieldPrefix)
		}
		if err := assertSupportedFields(
			entry,
			[]string{"item", "source", "model_visible"},
			fieldPrefix,
			"unsupported source attribution fields are not allowed: %s",
		); err != nil {
			return err
		}
		if _, err := requireString(entry["item"], fieldPrefix+".item"); err != nil {
			return err
		}
		if _, err := requireString(entry["source"], fieldPrefix+".source"); err != nil {
			return err
		}
		if _, err := parseOptionalBool(entry["model_visible"], false); err != nil {
			return fmt.Errorf("%s.model_visible must be a boolean", fieldPrefix)
		}
	}
	return nil
}

func parseConversationBudget(raw json.RawMessage) error {
	budget, err := parseObject(raw, "context.conversation.budget")
	if err != nil {
		return fmt.Errorf("context.conversation.budget must be an object")
	}
	if err := assertSupportedFields(
		budget,
		[]string{"token_estimate", "recent_turn_limit"},
		"context.conversation.budget",
		"unsupported conversation budget fields are not allowed: %s",
	); err != nil {
		return err
	}
	tokenEstimate, err := parseOptionalInt(budget["token_estimate"], -1)
	if err != nil || tokenEstimate < 0 {
		return fmt.Errorf("context.conversation.budget.token_estimate must be a non-negative integer")
	}
	recentTurnLimit, err := parseOptionalInt(budget["recent_turn_limit"], 0)
	if err != nil || recentTurnLimit <= 0 {
		return fmt.Errorf("context.conversation.budget.recent_turn_limit must be a positive integer")
	}
	return nil
}
