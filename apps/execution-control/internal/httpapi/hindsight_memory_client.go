package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	hindsight "github.com/vectorize-io/hindsight/hindsight-clients/go"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

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
		memoryItem, err := toHindsightSDKMemoryItem(item)
		if err != nil {
			return hindsightRetainResponse{}, err
		}
		payload.Items = append(payload.Items, memoryItem)
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

func (c hindsightHTTPClient) EnsureBank(ctx context.Context, bankID string) error {
	request := hindsight.NewCreateBankRequest()
	request.SetName("campus personal memory")
	request.SetMission("Campus student assistant private memory bank.")
	request.SetRetainMission(hindsightRetainMission())
	request.SetRetainExtractionMode("custom")
	request.SetRetainCustomInstructions(hindsightRetainCustomInstructions())
	request.SetEnableObservations(false)
	_, response, err := c.client.BanksAPI.
		CreateOrUpdateBank(ctx, strings.TrimSpace(bankID)).
		CreateBankRequest(*request).
		Execute()
	if err != nil {
		return err
	}
	if response != nil && response.Body != nil {
		defer func() { _ = response.Body.Close() }()
	}
	return requireHindsightSuccess(response, "ensure bank")
}

func (c hindsightHTTPClient) OperationStatus(
	ctx context.Context,
	bankID string,
	operationID string,
) (hindsightOperationStatus, error) {
	responseBody, response, err := c.client.OperationsAPI.
		GetOperationStatus(ctx, strings.TrimSpace(bankID), strings.TrimSpace(operationID)).
		IncludePayload(false).
		Execute()
	if err != nil {
		return hindsightOperationStatus{}, err
	}
	if response != nil && response.Body != nil {
		defer func() { _ = response.Body.Close() }()
	}
	if err := requireHindsightSuccess(response, "operation status"); err != nil {
		return hindsightOperationStatus{}, err
	}
	return fromHindsightSDKOperationStatus(responseBody), nil
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
		parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(item.Timestamp))
		if err != nil {
			return hindsight.MemoryItem{}, fmt.Errorf("hindsight memory item timestamp must be RFC3339: %w", err)
		}
		output.SetTimestamp(hindsight.Timestamp{TimeTime: &parsed})
	}
	return output, nil
}

func fromHindsightSDKRetainResponse(response *hindsight.RetainResponse) hindsightRetainResponse {
	if response == nil {
		return hindsightRetainResponse{}
	}
	return hindsightRetainResponse{
		Async:        response.GetAsync(),
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

func fromHindsightSDKOperationStatus(
	response *hindsight.OperationStatusResponse,
) hindsightOperationStatus {
	if response == nil {
		return hindsightOperationStatus{}
	}
	var retryCount *int
	if value, ok := response.GetRetryCountOk(); ok && value != nil {
		converted := int(*value)
		retryCount = &converted
	}
	return hindsightOperationStatus{
		ChildOperations: fromHindsightSDKChildOperationStatuses(response.GetChildOperations()),
		CompletedAt:     response.GetCompletedAt(),
		CreatedAt:       response.GetCreatedAt(),
		ErrorMessage:    response.GetErrorMessage(),
		NextRetryAt:     response.GetNextRetryAt(),
		OperationID:     strings.TrimSpace(response.GetOperationId()),
		OperationType:   response.GetOperationType(),
		Progress:        fromHindsightSDKOperationProgress(response.GetProgress()),
		ResultMetadata:  copyAnyMap(response.GetResultMetadata()),
		RetryCount:      retryCount,
		Status:          strings.TrimSpace(response.GetStatus()),
		UpdatedAt:       response.GetUpdatedAt(),
	}
}

func fromHindsightSDKChildOperationStatuses(
	children []hindsight.ChildOperationStatus,
) []hindsightChildOperationStatus {
	if len(children) == 0 {
		return nil
	}
	result := make([]hindsightChildOperationStatus, 0, len(children))
	for _, child := range children {
		var itemsCount *int
		if value, ok := child.GetItemsCountOk(); ok && value != nil {
			converted := int(*value)
			itemsCount = &converted
		}
		var subBatchIndex *int
		if value, ok := child.GetSubBatchIndexOk(); ok && value != nil {
			converted := int(*value)
			subBatchIndex = &converted
		}
		result = append(result, hindsightChildOperationStatus{
			ErrorMessage:  child.GetErrorMessage(),
			ItemsCount:    itemsCount,
			OperationID:   strings.TrimSpace(child.GetOperationId()),
			Status:        strings.TrimSpace(child.GetStatus()),
			SubBatchIndex: subBatchIndex,
		})
	}
	return result
}

func operationStatusChildren(
	children []hindsightChildOperationStatus,
) []memoryruntime.PersonalMemoryChildOperationStatus {
	if len(children) == 0 {
		return nil
	}
	result := make([]memoryruntime.PersonalMemoryChildOperationStatus, 0, len(children))
	for _, child := range children {
		result = append(result, memoryruntime.PersonalMemoryChildOperationStatus{
			ErrorMessage:  strings.TrimSpace(child.ErrorMessage),
			ItemsCount:    child.ItemsCount,
			OperationID:   strings.TrimSpace(child.OperationID),
			Status:        strings.TrimSpace(child.Status),
			SubBatchIndex: child.SubBatchIndex,
		})
	}
	return result
}

func fromHindsightSDKOperationProgress(progress hindsight.OperationProgress) map[string]any {
	if strings.TrimSpace(progress.GetStage()) == "" && strings.TrimSpace(progress.GetAt()) == "" {
		return nil
	}
	result := map[string]any{
		"at":    progress.GetAt(),
		"stage": progress.GetStage(),
	}
	if value, ok := progress.GetProcessedOk(); ok && value != nil {
		result["processed"] = int(*value)
	}
	if value, ok := progress.GetTotalOk(); ok && value != nil {
		result["total"] = int(*value)
	}
	if len(progress.Detail) > 0 {
		detail := make(map[string]any, len(progress.Detail))
		for key, value := range progress.Detail {
			detail[key] = int(value)
		}
		result["detail"] = detail
	}
	return result
}
