package execution

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
)

const MaxInputBytes int64 = 1 << 20

var ErrInputRedirect = errors.New("execution input redirects are disabled")

type InputLoader interface {
	Load(context.Context, DurableRun) (contracts.ExecutionPayloadWire, error)
}

type appAPIInputLoader struct {
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

func InputErrorIsRetryable(err error) bool {
	var inputErr *executionInputError
	return errors.As(err, &inputErr) && inputErr.Retryable()
}

func InputErrorKind(err error) string {
	var inputErr *executionInputError
	if errors.As(err, &inputErr) {
		return inputErr.kind
	}
	return "execution_input_unavailable"
}

func NewInputLoader(cfg config.Config) (InputLoader, error) {
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
	run DurableRun,
) (contracts.ExecutionPayloadWire, error) {
	if !contracts.ValidExecutionRequestID(run.RequestID) {
		return contracts.ExecutionPayloadWire{}, NewInputError(
			"load",
			"execution_input_request_id_invalid",
			false,
			errors.New("request_id is invalid"),
		)
	}
	metadata, err := InputMetadata(run)
	if err != nil {
		return contracts.ExecutionPayloadWire{}, NewInputError("load", "execution_input_metadata_invalid", false, err)
	}
	response, err := loader.do(ctx, run.RequestID)
	if err != nil {
		return contracts.ExecutionPayloadWire{}, NewInputError("load", "execution_input_unavailable", true, err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return contracts.ExecutionPayloadWire{}, executionInputHTTPError("load", response.StatusCode)
	}
	if err := validateExecutionInputResponseHeaders(response.Header, true); err != nil {
		return contracts.ExecutionPayloadWire{}, NewInputError("load", "execution_input_response_invalid", false, err)
	}
	if response.ContentLength > MaxInputBytes {
		return contracts.ExecutionPayloadWire{}, NewInputError(
			"load",
			"execution_input_too_large",
			false,
			fmt.Errorf("content length exceeds %d bytes", MaxInputBytes),
		)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, MaxInputBytes+1))
	if err != nil {
		return contracts.ExecutionPayloadWire{}, NewInputError("load", "execution_input_unavailable", true, err)
	}
	if int64(len(body)) > MaxInputBytes {
		return contracts.ExecutionPayloadWire{}, NewInputError(
			"load",
			"execution_input_too_large",
			false,
			fmt.Errorf("response body exceeds %d bytes", MaxInputBytes),
		)
	}
	digest := sha256.Sum256(body)
	expectedDigest, err := hex.DecodeString(metadata.ExecutionInputSHA256)
	if err != nil || subtle.ConstantTimeCompare(digest[:], expectedDigest) != 1 {
		return contracts.ExecutionPayloadWire{}, NewInputError("load", "execution_input_hash_mismatch", false, nil)
	}
	if !utf8.Valid(body) {
		return contracts.ExecutionPayloadWire{}, NewInputError("load", "execution_input_contract_invalid", false, errors.New("response body must be valid UTF-8"))
	}
	wire, err := contracts.DecodeExecutionPayloadWireJSON(body)
	if err != nil {
		return contracts.ExecutionPayloadWire{}, NewInputError("load", "execution_input_contract_invalid", false, nil)
	}
	if err := validateExecutionInputBinding(wire, run, metadata); err != nil {
		return contracts.ExecutionPayloadWire{}, NewInputError("load", "execution_input_binding_mismatch", false, err)
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

func InputMetadata(run DurableRun) (contracts.ExecutionRunMetadataWire, error) {
	if strings.TrimSpace(run.RequestID) == "" {
		return contracts.ExecutionRunMetadataWire{}, errors.New("request_id is required")
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
	if err := metadata.Validate(run.RequestID); err != nil {
		return contracts.ExecutionRunMetadataWire{}, err
	}
	return metadata, nil
}

func validateExecutionInputBinding(
	wire contracts.ExecutionPayloadWire,
	run DurableRun,
	metadata contracts.ExecutionRunMetadataWire,
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
	return NewInputError(
		operation,
		kind,
		retryable,
		fmt.Errorf("unexpected HTTP status %d", statusCode),
	)
}

func NewInputError(operation string, kind string, retryable bool, cause error) error {
	return &executionInputError{
		cause:     cause,
		kind:      kind,
		operation: operation,
		retryable: retryable,
	}
}
