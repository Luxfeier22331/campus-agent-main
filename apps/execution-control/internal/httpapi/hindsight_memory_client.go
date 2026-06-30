package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	hindsight "github.com/vectorize-io/hindsight/hindsight-clients/go"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
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

func (c hindsightHTTPClient) HealthCheck(ctx context.Context) error {
	_, response, err := c.client.MonitoringAPI.HealthEndpointHealthGet(ctx).Execute()
	if err != nil {
		return err
	}
	if response != nil && response.Body != nil {
		defer func() { _ = response.Body.Close() }()
	}
	return requireHindsightSuccess(response, "health")
}

func (c hindsightHTTPClient) RetainMemories(
	ctx context.Context,
	bankID string,
	request hindsightRetainRequest,
) (hindsightRetainResponse, error) {
	payload := hindsight.RetainRequest{
		Async:        request.Async,
		DocumentTags: append([]string{}, request.DocumentTags...),
		Items:        make([]hindsight.MemoryItem, 0, len(request.Items)),
	}
	for _, item := range request.Items {
		sdkItem, err := toHindsightSDKMemoryItem(item)
		if err != nil {
			return hindsightRetainResponse{}, err
		}
		payload.Items = append(payload.Items, sdkItem)
	}
	responseBody, response, err := c.client.MemoryAPI.
		RetainMemories(ctx, strings.TrimSpace(bankID)).
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
		RecallMemories(ctx, strings.TrimSpace(bankID)).
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

func (c hindsightHTTPClient) Reflect(
	ctx context.Context,
	bankID string,
	request hindsightReflectRequest,
) (hindsightReflectResponse, error) {
	payload := hindsight.NewReflectRequest(strings.TrimSpace(request.Query))
	if strings.TrimSpace(request.Budget) != "" {
		budget := hindsight.Budget(strings.TrimSpace(request.Budget))
		payload.Budget = &budget
	}
	if strings.TrimSpace(request.Context) != "" {
		payload.SetContext(strings.TrimSpace(request.Context))
	}
	if request.MaxTokens > 0 {
		maxTokens := int32(request.MaxTokens)
		payload.MaxTokens = &maxTokens
	}
	if request.IncludeFacts {
		payload.Include = &hindsight.ReflectIncludeOptions{Facts: map[string]any{}}
	}
	payload.FactTypes = append([]string{}, request.FactTypes...)
	payload.Tags = append([]string{}, request.Tags...)
	if strings.TrimSpace(request.TagsMatch) != "" {
		tagsMatch := strings.TrimSpace(request.TagsMatch)
		payload.TagsMatch = &tagsMatch
	}
	responseBody, response, err := c.client.MemoryAPI.
		Reflect(ctx, strings.TrimSpace(bankID)).
		ReflectRequest(*payload).
		Execute()
	if err != nil {
		return hindsightReflectResponse{}, err
	}
	if response != nil && response.Body != nil {
		defer func() { _ = response.Body.Close() }()
	}
	if err := requireHindsightSuccess(response, "reflect memories"); err != nil {
		return hindsightReflectResponse{}, err
	}
	return fromHindsightSDKReflectResponse(responseBody), nil
}

func (c hindsightHTTPClient) OperationStatus(
	ctx context.Context,
	bankID string,
	operationID string,
) (hindsightOperationStatusResponse, error) {
	responseBody, response, err := c.client.OperationsAPI.
		GetOperationStatus(ctx, strings.TrimSpace(bankID), strings.TrimSpace(operationID)).
		IncludePayload(false).
		Execute()
	if err != nil {
		return hindsightOperationStatusResponse{}, err
	}
	if response != nil && response.Body != nil {
		defer func() { _ = response.Body.Close() }()
	}
	if err := requireHindsightSuccess(response, "get operation status"); err != nil {
		return hindsightOperationStatusResponse{}, err
	}
	return fromHindsightSDKOperationStatusResponse(responseBody), nil
}

func (c hindsightHTTPClient) ListOperations(
	ctx context.Context,
	bankID string,
	request hindsightOperationListRequest,
) (hindsightOperationListResponse, error) {
	query := c.client.OperationsAPI.ListOperations(ctx, strings.TrimSpace(bankID))
	if strings.TrimSpace(request.Status) != "" {
		query = query.Status(strings.TrimSpace(request.Status))
	}
	if strings.TrimSpace(request.OperationType) != "" {
		query = query.Type_(strings.TrimSpace(request.OperationType))
	}
	if request.Limit > 0 {
		query = query.Limit(int32(request.Limit))
	}
	if request.Offset > 0 {
		query = query.Offset(int32(request.Offset))
	}
	query = query.ExcludeParents(request.ExcludeParents)
	responseBody, response, err := query.Execute()
	if err != nil {
		return hindsightOperationListResponse{}, err
	}
	if response != nil && response.Body != nil {
		defer func() { _ = response.Body.Close() }()
	}
	if err := requireHindsightSuccess(response, "list operations"); err != nil {
		return hindsightOperationListResponse{}, err
	}
	return fromHindsightSDKOperationListResponse(responseBody), nil
}

func (c hindsightHTTPClient) CancelOperation(
	ctx context.Context,
	bankID string,
	operationID string,
) (hindsightOperationActionResponse, error) {
	responseBody, response, err := c.client.OperationsAPI.
		CancelOperation(ctx, strings.TrimSpace(bankID), strings.TrimSpace(operationID)).
		Execute()
	if err != nil {
		return hindsightOperationActionResponse{}, err
	}
	if response != nil && response.Body != nil {
		defer func() { _ = response.Body.Close() }()
	}
	if err := requireHindsightSuccess(response, "cancel operation"); err != nil {
		return hindsightOperationActionResponse{}, err
	}
	return hindsightOperationActionResponse{
		Message:     strings.TrimSpace(responseBody.GetMessage()),
		OperationID: strings.TrimSpace(responseBody.GetOperationId()),
		Success:     responseBody.GetSuccess(),
	}, nil
}

func (c hindsightHTTPClient) RetryOperation(
	ctx context.Context,
	bankID string,
	operationID string,
) (hindsightOperationActionResponse, error) {
	responseBody, response, err := c.client.OperationsAPI.
		RetryOperation(ctx, strings.TrimSpace(bankID), strings.TrimSpace(operationID)).
		Execute()
	if err != nil {
		return hindsightOperationActionResponse{}, err
	}
	if response != nil && response.Body != nil {
		defer func() { _ = response.Body.Close() }()
	}
	if err := requireHindsightSuccess(response, "retry operation"); err != nil {
		return hindsightOperationActionResponse{}, err
	}
	return hindsightOperationActionResponse{
		Message:     strings.TrimSpace(responseBody.GetMessage()),
		OperationID: strings.TrimSpace(responseBody.GetOperationId()),
		Success:     responseBody.GetSuccess(),
	}, nil
}

func (c hindsightHTTPClient) DeleteDocument(ctx context.Context, bankID string, documentID string) error {
	_, response, err := c.client.DocumentsAPI.
		DeleteDocument(ctx, strings.TrimSpace(bankID), strings.TrimSpace(documentID)).
		Execute()
	if err != nil {
		return err
	}
	if response != nil && response.Body != nil {
		defer func() { _ = response.Body.Close() }()
	}
	return requireHindsightSuccess(response, "delete document")
}

func (c hindsightHTTPClient) DeleteBank(ctx context.Context, bankID string) error {
	_, response, err := c.client.BanksAPI.
		DeleteBank(ctx, strings.TrimSpace(bankID)).
		Execute()
	if err != nil {
		return err
	}
	if response != nil && response.Body != nil {
		defer func() { _ = response.Body.Close() }()
	}
	return requireHindsightSuccess(response, "delete bank")
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
			DocumentID:    item.GetDocumentId(),
			ID:            strings.TrimSpace(item.Id),
			MentionedAt:   item.GetMentionedAt(),
			Metadata:      copyStringMap(item.Metadata),
			OccurredEnd:   item.GetOccurredEnd(),
			OccurredStart: item.GetOccurredStart(),
			Tags:          append([]string{}, item.Tags...),
			Text:          strings.TrimSpace(item.Text),
			Type:          item.GetType(),
		})
	}
	return hindsightRecallResponse{Results: results}
}

func fromHindsightSDKReflectResponse(response *hindsight.ReflectResponse) hindsightReflectResponse {
	if response == nil {
		return hindsightReflectResponse{}
	}
	reflectResponse := hindsightReflectResponse{
		StructuredOutput: copyAnyMap(response.GetStructuredOutput()),
		Text:             strings.TrimSpace(response.GetText()),
	}
	if response.HasBasedOn() {
		basedOn := response.GetBasedOn()
		reflectResponse.BasedOnMemories = make([]hindsightReflectFact, 0, len(basedOn.Memories))
		for _, fact := range basedOn.Memories {
			reflectResponse.BasedOnMemories = append(reflectResponse.BasedOnMemories, hindsightReflectFact{
				Context:       strings.TrimSpace(fact.GetContext()),
				ID:            strings.TrimSpace(fact.GetId()),
				OccurredEnd:   fact.GetOccurredEnd(),
				OccurredStart: fact.GetOccurredStart(),
				Text:          strings.TrimSpace(fact.GetText()),
				Type:          strings.TrimSpace(fact.GetType()),
			})
		}
	}
	if response.HasUsage() {
		usage := response.GetUsage()
		reflectResponse.Usage = memoryruntime.TokenUsage{
			CachedTokens: int(usage.GetCachedTokens()),
			InputTokens:  int(usage.GetInputTokens()),
			OutputTokens: int(usage.GetOutputTokens()),
			TotalTokens:  int(usage.GetTotalTokens()),
		}
	}
	return reflectResponse
}

func fromHindsightSDKOperationStatusResponse(
	response *hindsight.OperationStatusResponse,
) hindsightOperationStatusResponse {
	if response == nil {
		return hindsightOperationStatusResponse{}
	}
	return hindsightOperationStatusResponse{
		CompletedAt:    response.GetCompletedAt(),
		CreatedAt:      response.GetCreatedAt(),
		ErrorMessage:   response.GetErrorMessage(),
		OperationID:    strings.TrimSpace(response.GetOperationId()),
		OperationType:  strings.TrimSpace(response.GetOperationType()),
		ResultMetadata: copyAnyMap(response.ResultMetadata),
		RetryCount:     int(response.GetRetryCount()),
		Status:         strings.TrimSpace(response.GetStatus()),
		UpdatedAt:      response.GetUpdatedAt(),
	}
}

func fromHindsightSDKOperationListResponse(
	response *hindsight.OperationsListResponse,
) hindsightOperationListResponse {
	if response == nil {
		return hindsightOperationListResponse{}
	}
	operations := make([]hindsightOperationItem, 0, len(response.Operations))
	for _, operation := range response.Operations {
		operations = append(operations, hindsightOperationItem{
			CreatedAt:     operation.GetCreatedAt(),
			ErrorMessage:  strings.TrimSpace(operation.GetErrorMessage()),
			ItemsCount:    int(operation.GetItemsCount()),
			OperationID:   strings.TrimSpace(operation.GetId()),
			OperationType: strings.TrimSpace(operation.GetTaskType()),
			RetryCount:    int(operation.GetRetryCount()),
			Status:        strings.TrimSpace(operation.GetStatus()),
			UpdatedAt:     operation.GetUpdatedAt(),
		})
	}
	return hindsightOperationListResponse{
		Limit:      int(response.GetLimit()),
		Offset:     int(response.GetOffset()),
		Operations: operations,
		Total:      int(response.GetTotal()),
	}
}
