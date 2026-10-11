package hindsightadapter

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
	hindsight "github.com/vectorize-io/hindsight/hindsight-clients/go"
)

// The profile is one fixed mental model per owner bank with a stable ID, so
// reads, lazy creation, and consolidation-triggered refreshes always address
// the same model.
const hindsightProfileModelID = "user-profile"

const hindsightProfileSourceQuery = "综合这位用户已存储的个人记忆，生成一份当前的用户画像：稳定的偏好、长期目标、重要事实与背景。只依据已存储的记忆，不要臆测，不要编造。单次咨询、提问、测试标记不视为稳定偏好。用简体中文，条理清晰。"

const hindsightProfileMaxTokens int32 = 2048

type hindsightProfileModelSnapshot struct {
	Content         string
	Generating      bool
	IsStale         bool
	LastRefreshedAt string
}

func (e hindsightExecutor) LookupProfileModel(ctx context.Context, query memoryruntime.ProfileQuery) (memoryruntime.ProfileModelSnapshot, bool, bool, error) {
	if err := memoryruntime.ValidateProfileQuery(query); err != nil {
		return memoryruntime.ProfileModelSnapshot{}, false, false, err
	}
	bankID := e.scopedBankIDForGeneration(query.TenantID, query.OwnerUserID, query.OwnerGeneration)
	exists, err := e.client.BankExists(ctx, bankID)
	if err != nil || !exists {
		return memoryruntime.ProfileModelSnapshot{}, exists, false, err
	}
	snapshot, found, err := e.client.GetMentalModel(ctx, bankID, hindsightProfileModelID)
	if err != nil {
		return memoryruntime.ProfileModelSnapshot{}, true, false, err
	}
	return memoryruntime.ProfileModelSnapshot{
		Content: snapshot.Content, Generating: snapshot.Generating,
		IsStale: snapshot.IsStale, LastRefreshedAt: snapshot.LastRefreshedAt,
	}, true, found, nil
}

func (e hindsightExecutor) CreateProfileModel(ctx context.Context, query memoryruntime.ProfileQuery) error {
	if err := memoryruntime.ValidateProfileQuery(query); err != nil {
		return err
	}
	bankID := e.scopedBankIDForGeneration(query.TenantID, query.OwnerUserID, query.OwnerGeneration)
	return e.client.CreateMentalModel(ctx, bankID, e.profileModelRequest())
}

func (e hindsightExecutor) profileModelRequest() hindsight.CreateMentalModelRequest {
	request := hindsight.NewCreateMentalModelRequest("用户画像", hindsightProfileSourceQuery)
	request.Id = hindsight.NullableString{}
	request.SetId(hindsightProfileModelID)
	request.SetMaxTokens(hindsightProfileMaxTokens)
	request.SetTrigger(hindsight.MentalModelTriggerInput{
		Mode:                      stringPointer("full"),
		RefreshAfterConsolidation: boolPointer(true),
	})
	return *request
}

func (c hindsightHTTPClient) GetMentalModel(ctx context.Context, bankID string, modelID string) (hindsightProfileModelSnapshot, bool, error) {
	// Read the operation before the model: once completion is observed, the
	// subsequent model read includes its committed result, not an earlier placeholder.
	status, err := c.profileRefreshStatus(ctx, bankID, modelID)
	if err != nil {
		return hindsightProfileModelSnapshot{}, false, err
	}
	responseBody, response, err := c.client.MentalModelsAPI.
		GetMentalModel(ctx, strings.TrimSpace(bankID), strings.TrimSpace(modelID)).
		Detail("full").
		Execute()
	if response != nil && response.StatusCode == http.StatusNotFound {
		if response.Body != nil {
			_ = response.Body.Close()
		}
		return hindsightProfileModelSnapshot{}, false, nil
	}
	if err != nil {
		return hindsightProfileModelSnapshot{}, false, err
	}
	if response != nil && response.Body != nil {
		defer func() { _ = response.Body.Close() }()
	}
	if err := requireHindsightSuccess(response, "get mental model"); err != nil {
		return hindsightProfileModelSnapshot{}, false, err
	}
	if responseBody == nil {
		return hindsightProfileModelSnapshot{}, false, errors.New("hindsight get mental model returned no response")
	}
	if status == "failed" || status == "cancelled" {
		return hindsightProfileModelSnapshot{}, false, errors.New("hindsight profile refresh did not complete")
	}
	snapshot := hindsightProfileModelSnapshot{
		Content:         responseBody.GetContent(),
		Generating:      status == "pending" || status == "processing",
		IsStale:         responseBody.GetIsStale(),
		LastRefreshedAt: strings.TrimSpace(responseBody.GetLastRefreshedAt()),
	}
	// Creation also sets last_refreshed_at. The initial row has no reflect
	// result; preserve only generated content while a later refresh is running.
	if generated, _ := responseBody.ReflectResponse["text"].(string); strings.TrimSpace(generated) == "" {
		snapshot.Content = ""
		snapshot.LastRefreshedAt = ""
	}
	return snapshot, true, nil
}

func (c hindsightHTTPClient) profileRefreshStatus(ctx context.Context, bankID, modelID string) (string, error) {
	const pageSize int32 = 100
	for offset := int32(0); ; offset += pageSize {
		body, response, err := c.client.OperationsAPI.ListOperations(ctx, bankID).
			Type_("refresh_mental_model").Limit(pageSize).Offset(offset).Execute()
		if response != nil && response.Body != nil {
			_ = response.Body.Close()
		}
		if err != nil {
			return "", err
		}
		if err := requireHindsightSuccess(response, "list profile refreshes"); err != nil {
			return "", err
		}
		if body == nil {
			return "", errors.New("hindsight list profile refreshes returned no response")
		}
		// Hindsight returns newest first. Other mental models may share a bank.
		for _, operation := range body.Operations {
			// The deployed 0.9.1 list does not expose mental_model_id. The
			// original task payload identifies the target without persisting a
			// second operation mapping in the product database.
			detail, response, err := c.client.OperationsAPI.GetOperationStatus(ctx, bankID, operation.Id).
				IncludePayload(true).Execute()
			if response != nil && response.Body != nil {
				_ = response.Body.Close()
			}
			if err != nil {
				return "", err
			}
			if err := requireHindsightSuccess(response, "get profile refresh"); err != nil {
				return "", err
			}
			if detail == nil {
				return "", errors.New("hindsight get profile refresh returned no response")
			}
			if detail.TaskPayload["mental_model_id"] != modelID {
				continue
			}
			switch detail.Status {
			case "pending", "processing", "completed", "failed", "cancelled":
				return detail.Status, nil
			default:
				return "", errors.New("hindsight returned an unknown profile refresh status")
			}
		}
		if len(body.Operations) == 0 || offset+int32(len(body.Operations)) >= body.Total {
			return "", nil
		}
	}
}

func (c hindsightHTTPClient) CreateMentalModel(ctx context.Context, bankID string, request hindsight.CreateMentalModelRequest) error {
	_, response, err := c.client.MentalModelsAPI.
		CreateMentalModel(ctx, strings.TrimSpace(bankID)).
		CreateMentalModelRequest(request).
		Execute()
	if response != nil && response.StatusCode == http.StatusConflict {
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
	return requireHindsightSuccess(response, "create mental model")
}

func stringPointer(value string) *string { return &value }
