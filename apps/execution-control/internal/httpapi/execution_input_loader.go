package httpapi

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
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

const maxExecutionInputBytes int64 = 1 << 20

var errExecutionInputRedirect = errors.New("execution input redirects are disabled")

type ExecutionInputLoader interface {
	Load(context.Context, execution.DurableRun) (contracts.ExecutionPayloadWire, error)
}

type appAPIExecutionInputLoader struct {
	baseURL      string
	httpClient   *http.Client
	sharedSecret string
}

type executionInputError struct {
	cause     error
	kind      string
	operation string
	retryable bool
}

func (e *executionInputError) Error() string {
	message := fmt.Sprintf("execution input %s failed: %s", e.operation, e.kind)
	if e.cause != nil {
		return message + ": " + e.cause.Error()
	}
	return message
}

func (e *executionInputError) Unwrap() error {
	return e.cause
}

func (e *executionInputError) Retryable() bool {
	return e.retryable
}

func executionInputErrorIsRetryable(err error) bool {
	var inputErr *executionInputError
	return errors.As(err, &inputErr) && inputErr.Retryable()
}

func executionInputErrorKind(err error) string {
	var inputErr *executionInputError
	if errors.As(err, &inputErr) {
		return inputErr.kind
	}
	return "execution_input_unavailable"
}

func newExecutionInputLoader(cfg config.Config) (ExecutionInputLoader, error) {
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
	return &appAPIExecutionInputLoader{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: timeout,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return errExecutionInputRedirect
			},
		},
		sharedSecret: sharedSecret,
	}, nil
}

func (loader *appAPIExecutionInputLoader) Load(
	ctx context.Context,
	run execution.DurableRun,
) (contracts.ExecutionPayloadWire, error) {
	if !contracts.ValidExecutionRunID(run.RunID) {
		return contracts.ExecutionPayloadWire{}, newExecutionInputError(
			"load",
			"execution_input_run_id_invalid",
			false,
			errors.New("run_id is invalid"),
		)
	}
	metadata, err := executionInputMetadata(run)
	if err != nil {
		return contracts.ExecutionPayloadWire{}, newExecutionInputError("load", "execution_input_metadata_invalid", false, err)
	}
	response, err := loader.do(ctx, run.RunID)
	if err != nil {
		return contracts.ExecutionPayloadWire{}, newExecutionInputError("load", "execution_input_unavailable", true, err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return contracts.ExecutionPayloadWire{}, executionInputHTTPError("load", response.StatusCode)
	}
	if err := validateExecutionInputResponseHeaders(response.Header, true); err != nil {
		return contracts.ExecutionPayloadWire{}, newExecutionInputError("load", "execution_input_response_invalid", false, err)
	}
	if response.ContentLength > maxExecutionInputBytes {
		return contracts.ExecutionPayloadWire{}, newExecutionInputError(
			"load",
			"execution_input_too_large",
			false,
			fmt.Errorf("content length exceeds %d bytes", maxExecutionInputBytes),
		)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxExecutionInputBytes+1))
	if err != nil {
		return contracts.ExecutionPayloadWire{}, newExecutionInputError("load", "execution_input_unavailable", true, err)
	}
	if int64(len(body)) > maxExecutionInputBytes {
		return contracts.ExecutionPayloadWire{}, newExecutionInputError(
			"load",
			"execution_input_too_large",
			false,
			fmt.Errorf("response body exceeds %d bytes", maxExecutionInputBytes),
		)
	}
	digest := sha256.Sum256(body)
	expectedDigest, err := hex.DecodeString(metadata.ExecutionInputSHA256)
	if err != nil || subtle.ConstantTimeCompare(digest[:], expectedDigest) != 1 {
		return contracts.ExecutionPayloadWire{}, newExecutionInputError("load", "execution_input_hash_mismatch", false, nil)
	}
	if !utf8.Valid(body) {
		return contracts.ExecutionPayloadWire{}, newExecutionInputError("load", "execution_input_contract_invalid", false, errors.New("response body must be valid UTF-8"))
	}
	wire, err := contracts.DecodeExecutionPayloadWireJSON(body)
	if err != nil {
		return contracts.ExecutionPayloadWire{}, newExecutionInputError("load", "execution_input_contract_invalid", false, nil)
	}
	if err := validateExecutionInputBinding(wire, run, metadata); err != nil {
		return contracts.ExecutionPayloadWire{}, newExecutionInputError("load", "execution_input_binding_mismatch", false, err)
	}
	return wire, nil
}

func (loader *appAPIExecutionInputLoader) do(
	ctx context.Context,
	runID string,
) (*http.Response, error) {
	requestURL := loader.baseURL + "/api/internal/execution/runs/" + url.PathEscape(runID) + "/input"
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

func executionInputMetadata(run execution.DurableRun) (contracts.ExecutionRunMetadataWire, error) {
	if strings.TrimSpace(run.RunID) == "" {
		return contracts.ExecutionRunMetadataWire{}, errors.New("run_id is required")
	}
	contractVersion, ok := run.Metadata["execution_contract_version"].(string)
	if !ok {
		return contracts.ExecutionRunMetadataWire{}, errors.New("execution_contract_version must be a string")
	}
	inputRef, ok := run.Metadata["execution_input_ref"].(string)
	if !ok {
		return contracts.ExecutionRunMetadataWire{}, errors.New("execution_input_ref must be a string")
	}
	inputSHA256, ok := run.Metadata["execution_input_sha256"].(string)
	if !ok {
		return contracts.ExecutionRunMetadataWire{}, errors.New("execution_input_sha256 must be a string")
	}
	metadata := contracts.ExecutionRunMetadataWire{
		ExecutionContractVersion: contractVersion,
		ExecutionInputRef:        inputRef,
		ExecutionInputSHA256:     inputSHA256,
	}
	if err := metadata.Validate(run.RunID); err != nil {
		return contracts.ExecutionRunMetadataWire{}, err
	}
	return metadata, nil
}

func validateExecutionInputBinding(
	wire contracts.ExecutionPayloadWire,
	run execution.DurableRun,
	metadata contracts.ExecutionRunMetadataWire,
) error {
	if wire.ConversationID != run.ConversationID {
		return errors.New("conversation_id does not match the run")
	}
	if wire.RequestID != run.RequestID {
		return errors.New("request_id does not match the run")
	}
	if wire.Trace.TraceID != run.TraceID {
		return errors.New("trace.trace_id does not match the run")
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
	return newExecutionInputError(
		operation,
		kind,
		retryable,
		fmt.Errorf("unexpected HTTP status %d", statusCode),
	)
}

func newExecutionInputError(operation string, kind string, retryable bool, cause error) error {
	return &executionInputError{
		cause:     cause,
		kind:      kind,
		operation: operation,
		retryable: retryable,
	}
}
