package hindsightadapter

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"reflect"
	"regexp"
	"strings"
	"syscall"
	"time"
)

// UpgradeConfig updates only Campus personal-memory banks through the provider API.
// It shares the defaults used by new banks/models; it never creates banks or reads
// user content into logs. Hindsight 0.9.1 lists all banks without pagination.
func UpgradeConfig(ctx context.Context, options Options, output io.Writer) error {
	if strings.TrimSpace(options.BaseURL) == "" || strings.TrimSpace(options.APISecret) == "" {
		return fmt.Errorf("HINDSIGHT_API_BASE_URL and HINDSIGHT_API_TENANT_API_KEY are required")
	}
	c := newHindsightHTTPClient(hindsightClientOptions{baseURL: options.BaseURL, apiSecret: options.APISecret, timeout: options.Timeout})
	return (configUpgrader{client: c, pollInterval: 5 * time.Second, output: output}).run(ctx)
}

type configUpgrader struct {
	client       hindsightHTTPClient
	pollInterval time.Duration
	output       io.Writer
}

type upgradeModel struct {
	SourceQuery string         `json:"source_query"`
	MaxTokens   int32          `json:"max_tokens"`
	Trigger     map[string]any `json:"trigger"`
}

var personalBankID = regexp.MustCompile(`^hindsight_bank_[0-9a-f]{32}$`)

func (u configUpgrader) run(ctx context.Context) error {
	var page struct {
		Banks []struct {
			ID   string `json:"bank_id"`
			Name string `json:"name"`
		} `json:"banks"`
	}
	if found, err := u.listBanksWhenConnected(ctx, &page); err != nil {
		return err
	} else if !found {
		return fmt.Errorf("Hindsight bank list endpoint not found")
	}
	count := 0
	for _, bank := range page.Banks {
		if !personalBankID.MatchString(bank.ID) || bank.Name != "campus-agent personal memory" {
			continue
		}
		if err := u.upgradeBank(ctx, bank.ID); err != nil {
			return fmt.Errorf("bank %s: %w", bank.ID, err)
		}
		count++
	}
	_, err := fmt.Fprintf(u.output, "Memory configuration upgrade complete: %d banks checked\n", count)
	return err
}

// New Job pods can start before the cluster network policy admits traffic.
// Retry only the initial read on connection refusal, before any mutation.
func (u configUpgrader) listBanksWhenConnected(ctx context.Context, page any) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	for {
		found, err := u.request(ctx, http.MethodGet, "/v1/default/banks", nil, page)
		if !errors.Is(err, syscall.ECONNREFUSED) {
			return found, err
		}
		timer := time.NewTimer(u.pollInterval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return false, ctx.Err()
		case <-timer.C:
		}
	}
}

func (u configUpgrader) upgradeBank(ctx context.Context, bank string) error {
	base := "/v1/default/banks/" + url.PathEscape(bank)
	var config struct {
		Config map[string]any `json:"config"`
	}
	found, err := u.request(ctx, http.MethodGet, base+"/config", nil, &config)
	if err != nil || !found {
		return err
	} // Erased concurrently; never recreate.
	// Normalize typed slices to JSON before comparing the provider representation.
	data, _ := json.Marshal(hindsightBankConfigUpdate(defaultHindsightBankConfig()))
	var expected map[string]any
	if err = json.Unmarshal(data, &expected); err != nil {
		return err
	}
	delta := map[string]any{}
	for k, v := range expected {
		if !reflect.DeepEqual(config.Config[k], v) {
			delta[k] = v
		}
	}
	if len(delta) > 0 {
		if found, err = u.request(ctx, http.MethodPatch, base+"/config", map[string]any{"updates": delta}, nil); err != nil || !found {
			return err
		}
		if found, err = u.request(ctx, http.MethodGet, base+"/config", nil, &config); err != nil || !found {
			return err
		}
		for k, v := range expected {
			if !reflect.DeepEqual(config.Config[k], v) {
				return fmt.Errorf("bank config %s was not applied", k)
			}
		}
	}
	path := base + "/mental-models/" + hindsightProfileModelID
	var model upgradeModel
	if found, err = u.request(ctx, http.MethodGet, path+"?detail=full", nil, &model); err != nil || !found {
		return err
	}
	if model.SourceQuery == hindsightProfileSourceQuery && model.MaxTokens == hindsightProfileMaxTokens && model.Trigger["mode"] == "full" && model.Trigger["refresh_after_consolidation"] == true {
		fmt.Fprintf(u.output, "%s: configuration current\n", bank)
		return nil
	}
	// Keep the existing trigger fields. The disabled automatic refresh is also the
	// provider-native incomplete-upgrade state, since 0.9.1 does not expose
	// last_refreshed_source_query. A failed run is safe to repeat without a ledger.
	if model.Trigger == nil {
		model.Trigger = map[string]any{}
	}
	model.Trigger["mode"] = "full"
	model.Trigger["refresh_after_consolidation"] = false
	update := map[string]any{"source_query": hindsightProfileSourceQuery, "max_tokens": hindsightProfileMaxTokens, "trigger": model.Trigger}
	if found, err = u.request(ctx, http.MethodPatch, path, update, nil); err != nil || !found {
		return err
	}
	// Drain already submitted refreshes after disabling new automatic submissions.
	// A previous attempt may have ended before enqueueing or completing its refresh.
	if err = u.waitExistingRefreshes(ctx, base); err != nil {
		return err
	}
	var submitted struct {
		OperationID string `json:"operation_id"`
	}
	if found, err = u.request(ctx, http.MethodPost, path+"/refresh", nil, &submitted); err != nil || !found {
		return err
	}
	if submitted.OperationID == "" {
		return fmt.Errorf("refresh returned no operation ID")
	}
	if err = u.waitOperation(ctx, base, submitted.OperationID, true); err != nil {
		return err
	}
	model.Trigger["refresh_after_consolidation"] = true
	if found, err = u.request(ctx, http.MethodPatch, path, map[string]any{"trigger": model.Trigger}, nil); err != nil || !found {
		return err
	}
	var verified upgradeModel
	if found, err = u.request(ctx, http.MethodGet, path+"?detail=full", nil, &verified); err != nil || !found {
		return err
	}
	if verified.SourceQuery != hindsightProfileSourceQuery || verified.MaxTokens != hindsightProfileMaxTokens || verified.Trigger["mode"] != "full" || verified.Trigger["refresh_after_consolidation"] != true {
		return fmt.Errorf("profile configuration was not applied")
	}
	fmt.Fprintf(u.output, "%s: configuration updated and profile refreshed\n", bank)
	return nil
}

func (u configUpgrader) waitExistingRefreshes(ctx context.Context, base string) error {
	for offset := 0; ; offset += 100 {
		var page struct {
			Total      int `json:"total"`
			Operations []struct {
				ID     string `json:"id"`
				Status string `json:"status"`
			} `json:"operations"`
		}
		found, err := u.request(ctx, http.MethodGet, fmt.Sprintf("%s/operations?type=refresh_mental_model&limit=100&offset=%d", base, offset), nil, &page)
		if err != nil || !found {
			return err
		}
		for _, op := range page.Operations {
			if op.Status != "pending" && op.Status != "processing" {
				continue
			}
			var detail struct {
				TaskPayload map[string]any `json:"task_payload"`
			}
			found, err = u.request(ctx, http.MethodGet, base+"/operations/"+url.PathEscape(op.ID)+"?include_payload=true", nil, &detail)
			if err != nil {
				return err
			}
			if found && detail.TaskPayload["mental_model_id"] == hindsightProfileModelID {
				if err = u.waitOperation(ctx, base, op.ID, false); err != nil {
					return err
				}
			}
		}
		if len(page.Operations) == 0 || offset+len(page.Operations) >= page.Total {
			return nil
		}
	}
}

func (u configUpgrader) waitOperation(ctx context.Context, base, id string, requireSuccess bool) error {
	for {
		var op struct {
			Status string `json:"status"`
		}
		found, err := u.request(ctx, http.MethodGet, base+"/operations/"+url.PathEscape(id), nil, &op)
		if err != nil {
			return err
		}
		if !found {
			return fmt.Errorf("refresh operation disappeared")
		}
		switch op.Status {
		case "completed":
			return nil
		case "failed", "cancelled":
			if requireSuccess {
				return fmt.Errorf("refresh operation %s %s", id, op.Status)
			}
			return nil
		case "pending", "processing":
		default:
			return fmt.Errorf("unknown refresh status %q", op.Status)
		}
		timer := time.NewTimer(u.pollInterval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

// Narrow wire decoding is intentional: the installed 0.9.1 bank list lacks the
// pagination fields required by the generated 0.9.2 SDK. Trigger maps also retain
// provider fields unknown to that SDK. Transport/auth are shared with the adapter.
func (u configUpgrader) request(ctx context.Context, method, path string, input, output any) (bool, error) {
	var body io.Reader
	if input != nil {
		data, err := json.Marshal(input)
		if err != nil {
			return false, err
		}
		body = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, u.client.baseURL+path, body)
	if err != nil {
		return false, err
	}
	req.Header.Set("Authorization", "Bearer "+u.client.apiSecret)
	if input != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	response, err := u.client.client.GetConfig().HTTPClient.Do(req)
	if err != nil {
		return false, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return false, fmt.Errorf("%s %s returned HTTP %d", method, path, response.StatusCode)
	}
	if output != nil {
		if err = json.NewDecoder(response.Body).Decode(output); err != nil {
			return false, err
		}
	}
	return true, nil
}
