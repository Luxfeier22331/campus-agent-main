package executioninput

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

var ErrInputRedirect = errors.New("execution input redirects are disabled")

type appAPIInputLoader struct {
	baseURL      string
	httpClient   *http.Client
	sharedSecret string
}

func NewInputLoader(cfg config.Config) (execution.InputLoader, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(cfg.ProductCallbackBaseURL), "/")
	sharedSecret := strings.TrimSpace(cfg.AppAPIExecutionSharedSecret)
	if baseURL == "" || sharedSecret == "" {
		return nil, errors.New("app-api execution input endpoint is not configured")
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || strings.Contains(baseURL, "#") {
		return nil, errors.New("app-api execution input base URL is invalid")
	}
	timeout := time.Duration(cfg.ProductCallbackTimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	return &appAPIInputLoader{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: timeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return ErrInputRedirect
			},
		},
		sharedSecret: sharedSecret,
	}, nil
}

func (loader *appAPIInputLoader) Load(
	ctx context.Context,
	run execution.DurableRun,
) (contracts.ExecutionPayloadWire, error) {
	if !contracts.ValidExecutionRequestID(run.RequestID) {
		return contracts.ExecutionPayloadWire{}, execution.NewInputError(
			"load",
			"execution_input_request_id_invalid",
			false,
			errors.New("request_id is invalid"),
		)
	}
	metadata, err := execution.InputMetadata(run)
	if err != nil {
		return contracts.ExecutionPayloadWire{}, execution.NewInputError("load", "execution_input_metadata_invalid", false, err)
	}
	response, err := loader.do(ctx, run.RequestID)
	if err != nil {
		return contracts.ExecutionPayloadWire{}, execution.NewInputError("load", "execution_input_unavailable", true, err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return contracts.ExecutionPayloadWire{}, executionInputHTTPError("load", response.StatusCode)
	}
	if err := validateExecutionInputResponseHeaders(response.Header, true); err != nil {
		return contracts.ExecutionPayloadWire{}, execution.NewInputError("load", "execution_input_response_invalid", false, err)
	}
	if response.ContentLength > execution.MaxInputBytes {
		return contracts.ExecutionPayloadWire{}, execution.NewInputError(
			"load",
			"execution_input_too_large",
			false,
			fmt.Errorf("content length exceeds %d bytes", execution.MaxInputBytes),
		)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, execution.MaxInputBytes+1))
	if err != nil {
		return contracts.ExecutionPayloadWire{}, execution.NewInputError("load", "execution_input_unavailable", true, err)
	}
	if int64(len(body)) > execution.MaxInputBytes {
		return contracts.ExecutionPayloadWire{}, execution.NewInputError(
			"load",
			"execution_input_too_large",
			false,
			fmt.Errorf("response body exceeds %d bytes", execution.MaxInputBytes),
		)
	}
	if err := execution.VerifyInputSHA256(body, metadata.ExecutionInputSHA256); err != nil {
		return contracts.ExecutionPayloadWire{}, execution.NewInputError("load", "execution_input_hash_mismatch", false, err)
	}
	if !utf8.Valid(body) {
		return contracts.ExecutionPayloadWire{}, execution.NewInputError("load", "execution_input_contract_invalid", false, errors.New("response body must be valid UTF-8"))
	}
	wire, err := contracts.DecodeExecutionPayloadWireJSON(body)
	if err != nil {
		return contracts.ExecutionPayloadWire{}, execution.NewInputError("load", "execution_input_contract_invalid", false, nil)
	}
	if err := validateExecutionInputBinding(wire, run); err != nil {
		return contracts.ExecutionPayloadWire{}, execution.NewInputError("load", "execution_input_binding_mismatch", false, err)
	}
	return wire, nil
}

func (loader *appAPIInputLoader) do(
	ctx context.Context,
	requestID string,
) (*http.Response, error) {
	requestURL := loader.baseURL + "/api/internal/execution/requests/" + url.PathEscape(requestID) + "/input"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("accept", "application/json")
	request.Header.Set("accept-encoding", "identity")
	request.Header.Set("x-app-execution-auth", loader.sharedSecret)
	response, err := loader.httpClient.Do(request)
	if err != nil {
		if response != nil && response.Body != nil {
			_ = response.Body.Close()
		}
		return nil, err
	}
	return response, nil
}

func validateExecutionInputBinding(
	wire contracts.ExecutionPayloadWire,
	run execution.DurableRun,
) error {
	if wire.ConversationID != run.ConversationID {
		return errors.New("conversation_id does not match the run")
	}
	if wire.RequestID != run.RequestID {
		return errors.New("request_id does not match the run")
	}
	return nil
}

func validateExecutionInputResponseHeaders(headers http.Header, requireJSON bool) error {
	if !cacheControlHasNoStore(headers.Values("cache-control")) {
		return errors.New("Cache-Control must include no-store")
	}
	if encoding := strings.TrimSpace(headers.Get("content-encoding")); encoding != "" && !strings.EqualFold(encoding, "identity") {
		return errors.New("Content-Encoding must be identity")
	}
	if !requireJSON {
		return nil
	}
	mediaType, _, err := mime.ParseMediaType(headers.Get("content-type"))
	if err != nil || !strings.EqualFold(mediaType, "application/json") {
		return errors.New("Content-Type must be application/json")
	}
	return nil
}

func cacheControlHasNoStore(values []string) bool {
	for _, value := range values {
		for _, directive := range strings.Split(value, ",") {
			name, _, _ := strings.Cut(strings.TrimSpace(directive), "=")
			if strings.EqualFold(strings.TrimSpace(name), "no-store") {
				return true
			}
		}
	}
	return false
}

func executionInputHTTPError(operation string, statusCode int) error {
	retryable := statusCode == http.StatusRequestTimeout || statusCode == http.StatusTooManyRequests || statusCode >= 500
	kind := "execution_input_rejected"
	if retryable {
		kind = "execution_input_unavailable"
	}
	return execution.NewInputError(
		operation,
		kind,
		retryable,
		fmt.Errorf("unexpected HTTP status %d", statusCode),
	)
}
