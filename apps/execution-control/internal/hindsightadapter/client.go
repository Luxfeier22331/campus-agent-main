package hindsightadapter

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	hindsight "github.com/vectorize-io/hindsight/hindsight-clients/go"
)

func (c hindsightHTTPClient) EnsureBank(ctx context.Context, bankID string, cfg hindsightBankConfig) error {
	trimmedBankID := strings.TrimSpace(bankID)
	if trimmedBankID == "" {
		return errors.New("hindsight bank id is required")
	}
	request := hindsight.CreateBankRequest{}
	request.SetName("campus-agent personal memory")
	_, response, err := c.client.BanksAPI.
		CreateOrUpdateBank(ctx, trimmedBankID).
		CreateBankRequest(request).
		Execute()
	if err != nil {
		return err
	}
	if response != nil && response.Body != nil {
		defer func() { _ = response.Body.Close() }()
	}
	if err := requireHindsightSuccess(response, "create or update bank"); err != nil {
		return err
	}

	update := hindsight.BankConfigUpdate{Updates: hindsightBankConfigUpdate(cfg)}
	_, response, err = c.client.BanksAPI.
		UpdateBankConfig(ctx, trimmedBankID).
		BankConfigUpdate(update).
		Execute()
	if err != nil {
		return err
	}
	if response != nil && response.Body != nil {
		defer func() { _ = response.Body.Close() }()
	}
	if err := requireHindsightSuccess(response, "update bank config"); err != nil {
		return err
	}

	responseBody, response, err := c.client.BanksAPI.
		GetBankConfig(ctx, trimmedBankID).
		Execute()
	if err != nil {
		return err
	}
	if response != nil && response.Body != nil {
		defer func() { _ = response.Body.Close() }()
	}
	if err := requireHindsightSuccess(response, "get bank config"); err != nil {
		return err
	}
	if err := requireHindsightBankConfig(responseBody, cfg); err != nil {
		return err
	}
	return nil
}

func (c hindsightHTTPClient) BankExists(ctx context.Context, bankID string) (bool, error) {
	trimmedBankID := strings.TrimSpace(bankID)
	_, response, err := c.client.BanksAPI.GetBankProfile(ctx, trimmedBankID).Execute()
	if response != nil && response.Body != nil {
		defer func() { _ = response.Body.Close() }()
	}
	if response != nil && response.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := requireHindsightSuccess(response, "get bank profile"); err != nil {
		return false, err
	}
	return true, nil
}

func (c hindsightHTTPClient) RetainMemories(
	ctx context.Context,
	bankID string,
	request hindsightRetainRequest,
) (hindsightRetainResponse, error) {
	trimmedBankID := strings.TrimSpace(bankID)
	payload := hindsight.RetainRequest{
		Async: request.Async,
		Items: make([]hindsight.MemoryItem, 0, len(request.Items)),
	}
	for _, item := range request.Items {
		sdkItem, err := toHindsightSDKMemoryItem(item)
		if err != nil {
			return hindsightRetainResponse{}, err
		}
		payload.Items = append(payload.Items, sdkItem)
	}
	responseBody, response, err := c.client.MemoryAPI.
		RetainMemories(ctx, trimmedBankID).
		RetainRequest(payload).
		Execute()
	if err != nil {
		return hindsightRetainResponse{}, err
	}
	if response != nil && response.Body != nil {
		defer func() { _ = response.Body.Close() }()
	}
	if err := requireHindsightSuccess(response, "retain memories"); err != nil {
		return hindsightRetainResponse{}, err
	}
	return fromHindsightSDKRetainResponse(responseBody), nil
}

func (c hindsightHTTPClient) RecallMemories(
	ctx context.Context,
	bankID string,
	request hindsightRecallRequest,
) (hindsightRecallResponse, error) {
	trimmedBankID := strings.TrimSpace(bankID)
	payload := hindsight.NewRecallRequest(strings.TrimSpace(request.Query))
	if strings.TrimSpace(request.Budget) != "" {
		budget := hindsight.Budget(strings.TrimSpace(request.Budget))
		payload.Budget = &budget
	}
	if request.MaxTokens > 0 {
		maxTokens := int32(request.MaxTokens)
		payload.MaxTokens = &maxTokens
	}
	trace := request.Trace
	payload.Trace = &trace
	preferObservations := request.PreferObservations
	payload.PreferObservations = &preferObservations
	include := hindsight.NewIncludeOptions()
	include.SetEntities(hindsight.EntityIncludeOptions{MaxTokens: int32Pointer(0)})
	include.SetSourceFacts(hindsight.SourceFactsIncludeOptions{
		MaxTokens:               int32Pointer(0),
		MaxTokensPerObservation: int32Pointer(0),
	})
	payload.Include = include
	payload.Tags = append([]string{}, request.Tags...)
	if strings.TrimSpace(request.TagsMatch) != "" {
		tagsMatch := strings.TrimSpace(request.TagsMatch)
		payload.TagsMatch = &tagsMatch
	}
	if strings.TrimSpace(request.QueryTimestamp) != "" {
		payload.SetQueryTimestamp(strings.TrimSpace(request.QueryTimestamp))
	}
	payload.Types = append([]string{}, request.Types...)
	responseBody, response, err := c.client.MemoryAPI.
		RecallMemories(ctx, trimmedBankID).
		RecallRequest(*payload).
		Execute()
	if err != nil {
		return hindsightRecallResponse{}, err
	}
	if response != nil && response.Body != nil {
		defer func() { _ = response.Body.Close() }()
	}
	if err := requireHindsightSuccess(response, "recall memories"); err != nil {
		return hindsightRecallResponse{}, err
	}
	return fromHindsightSDKRecallResponse(responseBody), nil
}

func (c hindsightHTTPClient) DeleteBank(ctx context.Context, bankID string) error {
	trimmedBankID := strings.TrimSpace(bankID)
	responseBody, response, err := c.client.BanksAPI.
		DeleteBank(ctx, trimmedBankID).
		Execute()
	if response != nil && response.StatusCode == http.StatusNotFound {
		if response.Body != nil {
			_ = response.Body.Close()
		}
		return nil
	}
	if err != nil {
		return err
	}
	if response != nil && response.Body != nil {
		defer func() { _ = response.Body.Close() }()
	}
	if err := requireHindsightSuccess(response, "delete bank"); err != nil {
		return err
	}
	if responseBody == nil || !responseBody.GetSuccess() {
		return errors.New("hindsight delete bank returned success=false")
	}
	return nil
}

func requireHindsightSuccess(response *http.Response, operation string) error {
	if response == nil {
		return fmt.Errorf("hindsight %s returned no response", operation)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode > http.StatusAccepted {
		return fmt.Errorf("hindsight %s failed with status %d", operation, response.StatusCode)
	}
	return nil
}

func hindsightBankConfigUpdate(cfg hindsightBankConfig) map[string]interface{} {
	rules := make([]map[string]interface{}, 0, len(cfg.MemoryDefense.Rules))
	for _, rule := range cfg.MemoryDefense.Rules {
		rules = append(rules, map[string]interface{}{
			"action": strings.TrimSpace(rule.Action),
			"on":     strings.TrimSpace(rule.On),
		})
	}
	return map[string]interface{}{
		"enable_auto_consolidation": cfg.EnableAutoConsolidation,
		"enable_observations":       cfg.EnableObservations,
		"memory_defense": map[string]interface{}{
			"enabled": cfg.MemoryDefense.Enabled,
			"rules":   rules,
		},
	}
}

func requireHindsightBankConfig(response *hindsight.BankConfigResponse, expected hindsightBankConfig) error {
	if response == nil {
		return errors.New("hindsight bank config returned no response")
	}
	for key, want := range map[string]bool{
		"enable_auto_consolidation": expected.EnableAutoConsolidation,
		"enable_observations":       expected.EnableObservations,
	} {
		got, ok := response.GetConfig()[key].(bool)
		if !ok || got != want {
			return fmt.Errorf("hindsight bank config %s=%v, want %v", key, response.GetConfig()[key], want)
		}
	}
	defense, ok := response.GetConfig()["memory_defense"].(map[string]interface{})
	if !ok {
		return errors.New("hindsight bank config missing memory_defense")
	}
	enabled, ok := defense["enabled"].(bool)
	if !ok || enabled != expected.MemoryDefense.Enabled {
		return fmt.Errorf("hindsight memory defense enabled=%v, want %v", defense["enabled"], expected.MemoryDefense.Enabled)
	}
	rules, ok := defense["rules"].([]interface{})
	if !ok {
		return errors.New("hindsight memory defense rules are missing")
	}
	if len(rules) != len(expected.MemoryDefense.Rules) {
		return fmt.Errorf("hindsight memory defense rules count=%d, want %d", len(rules), len(expected.MemoryDefense.Rules))
	}
	for index, expectedRule := range expected.MemoryDefense.Rules {
		rule, ok := rules[index].(map[string]interface{})
		if !ok {
			return fmt.Errorf("hindsight memory defense rule[%d] is invalid", index)
		}
		if strings.TrimSpace(fmt.Sprint(rule["on"])) != strings.TrimSpace(expectedRule.On) ||
			strings.TrimSpace(fmt.Sprint(rule["action"])) != strings.TrimSpace(expectedRule.Action) {
			return fmt.Errorf("hindsight memory defense rule[%d]=%#v, want %#v", index, rule, expectedRule)
		}
	}
	return nil
}

func toHindsightSDKMemoryItem(item hindsightMemoryItem) (hindsight.MemoryItem, error) {
	output := hindsight.MemoryItem{
		Content:  strings.TrimSpace(item.Content),
		Metadata: copyStringMap(item.Metadata),
		Tags:     append([]string{}, item.Tags...),
	}
	if len(item.ObservationScopes) > 0 {
		scopes := make([][]string, len(item.ObservationScopes))
		for index, scope := range item.ObservationScopes {
			scopes[index] = append([]string{}, scope...)
		}
		output.SetObservationScopes(hindsight.ObservationScopes{ArrayOfArrayOfString: &scopes})
	}
	if strings.TrimSpace(item.Context) != "" {
		output.SetContext(strings.TrimSpace(item.Context))
	}
	if strings.TrimSpace(item.DocumentID) != "" {
		output.SetDocumentId(strings.TrimSpace(item.DocumentID))
	}
	if strings.TrimSpace(item.UpdateMode) != "" {
		output.SetUpdateMode(strings.TrimSpace(item.UpdateMode))
	}
	if strings.TrimSpace(item.Timestamp) != "" {
		timestamp, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(item.Timestamp))
		if err != nil {
			return hindsight.MemoryItem{}, fmt.Errorf("invalid hindsight memory item timestamp: %w", err)
		}
		output.SetTimestamp(hindsight.Timestamp{TimeTime: &timestamp})
	}
	return output, nil
}

func fromHindsightSDKRetainResponse(response *hindsight.RetainResponse) hindsightRetainResponse {
	if response == nil {
		return hindsightRetainResponse{}
	}
	return hindsightRetainResponse{
		Async:        response.GetAsync(),
		BankID:       strings.TrimSpace(response.GetBankId()),
		ItemsCount:   int(response.GetItemsCount()),
		OperationID:  strings.TrimSpace(response.GetOperationId()),
		OperationIDs: append([]string{}, response.GetOperationIds()...),
		Success:      response.GetSuccess(),
	}
}

func fromHindsightSDKRecallResponse(response *hindsight.RecallResponse) hindsightRecallResponse {
	if response == nil {
		return hindsightRecallResponse{}
	}
	results := make([]hindsightRecallResult, 0, len(response.Results))
	for _, item := range response.Results {
		results = append(results, hindsightRecallResult{
			DocumentID:      item.GetDocumentId(),
			ID:              strings.TrimSpace(item.Id),
			MentionedAt:     item.GetMentionedAt(),
			Metadata:        copyStringMap(item.Metadata),
			OccurredEnd:     item.GetOccurredEnd(),
			OccurredStart:   item.GetOccurredStart(),
			Tags:            append([]string{}, item.Tags...),
			Score:           hindsightFinalScore(item),
			SourceFactCount: len(item.SourceFactIds),
			Text:            strings.TrimSpace(item.Text),
			Type:            item.GetType(),
		})
	}
	return hindsightRecallResponse{Results: results}
}

func hindsightFinalScore(item hindsight.RecallResult) float64 {
	if !item.HasScores() {
		return 0
	}
	scores := item.GetScores()
	return float64(scores.GetFinal())
}

func int32Pointer(value int32) *int32 {
	return &value
}
