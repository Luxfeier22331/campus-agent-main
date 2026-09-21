package hindsightadapter

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/google/uuid"
)

// A retain submission or status read may represent an already accepted remote
// write. Keep one operation identity alive long enough to observe it instead
// of letting a short client timeout start a competing submission.
const appendOperationHTTPTimeout = 300 * time.Second

func (e hindsightExecutor) appendOperationID(request memoryruntime.AppendConversationTurnRequest) string {
	bankID := e.scopedBankIDForGeneration(request.TenantID, request.UserID, request.OwnerGeneration)
	documentID := e.conversationMessageDocumentID(bankID, request.ThreadID, request.UserMessageID)
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte(bankID+"/retain/"+documentID)).String()
}

func (e hindsightExecutor) SubmitConversationTurn(ctx context.Context, request memoryruntime.AppendConversationTurnRequest) (memoryruntime.AppendOperation, error) {
	if err := memoryruntime.ValidateAppendConversationTurnRequest(request); err != nil {
		return memoryruntime.AppendOperation{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, appendOperationHTTPTimeout)
	defer cancel()
	bankID := e.scopedBankIDForGeneration(request.TenantID, request.UserID, request.OwnerGeneration)
	if err := e.ensureBankForWrite(ctx, bankID); err != nil {
		return memoryruntime.AppendOperation{}, err
	}
	operationID := e.appendOperationID(request)
	payload := e.conversationRetainRequest(bankID, request)
	payload.Async = boolPointer(true)
	payload.OperationID = operationID
	result, err := e.client.RetainMemories(ctx, bankID, payload)
	if err != nil {
		return memoryruntime.AppendOperation{}, err
	}
	if err := requireHindsightRetainAccepted(result, bankID, 1, true); err != nil {
		return memoryruntime.AppendOperation{}, err
	}
	if result.OperationID != operationID {
		return memoryruntime.AppendOperation{}, errors.New("hindsight returned a different retain operation")
	}
	return memoryruntime.AppendOperation{OperationID: operationID, Status: "pending"}, nil
}

func (e hindsightExecutor) GetConversationTurnOperation(ctx context.Context, request memoryruntime.AppendConversationTurnRequest) (memoryruntime.AppendOperation, error) {
	if err := memoryruntime.ValidateAppendConversationTurnRequest(request); err != nil {
		return memoryruntime.AppendOperation{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, appendOperationHTTPTimeout)
	defer cancel()
	bankID := e.scopedBankIDForGeneration(request.TenantID, request.UserID, request.OwnerGeneration)
	return e.client.GetOperation(ctx, bankID, e.appendOperationID(request))
}

func (c hindsightHTTPClient) GetOperation(ctx context.Context, bankID, operationID string) (memoryruntime.AppendOperation, error) {
	result, response, err := c.client.OperationsAPI.GetOperationStatus(ctx, bankID, operationID).IncludePayload(false).Execute()
	if response != nil && response.Body != nil {
		defer func() { _ = response.Body.Close() }()
	}
	if err != nil {
		return memoryruntime.AppendOperation{}, err
	}
	if err := requireHindsightSuccess(response, "get retain operation"); err != nil {
		return memoryruntime.AppendOperation{}, err
	}
	if result == nil || result.GetOperationId() != operationID {
		return memoryruntime.AppendOperation{}, errors.New("invalid hindsight operation response")
	}
	status := result.GetStatus()
	// A parent is only terminal when none of its children are still active.
	for _, child := range result.GetChildOperations() {
		switch child.GetStatus() {
		case "completed", "failed", "cancelled":
		default:
			status = "processing"
		}
	}
	output := memoryruntime.AppendOperation{OperationID: operationID, Status: status}
	if status == "failed" || status == "cancelled" {
		output.ErrorCode = "hindsight_append_" + status
		output.ErrorDetail, output.HTTPStatus = appendFailureDetail(result.GetErrorMessage())
	}
	return output, nil
}

var appendHTTPStatus = regexp.MustCompile(`(?i)(?:HTTP|Error code:)\s*([45][0-9]{2})\b`)

// Keep the diagnostic category, not provider bodies which can contain memory text.
func appendFailureDetail(message string) (string, int) {
	detail := "Hindsight retain operation failed."
	lower := strings.ToLower(message)
	switch {
	case strings.Contains(lower, "timed out"), strings.Contains(lower, "timeout"), strings.Contains(lower, "wall-clock limit"):
		detail = "Hindsight reported a timeout during retain processing."
	case strings.Contains(lower, "connection"):
		detail = "Hindsight reported a connection failure during retain processing."
	case strings.Contains(lower, "cancel"):
		detail = "Hindsight retain operation was cancelled."
	}
	status := 0
	if match := appendHTTPStatus.FindStringSubmatch(message); len(match) == 2 {
		status, _ = strconv.Atoi(match[1])
		detail = "Hindsight reported an upstream HTTP failure during retain processing."
	}
	return detail, status
}
