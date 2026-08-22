package modelconfigclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

const maxDescriptorResponseBytes = 1 << 20

var lowercaseSHA256 = regexp.MustCompile(`^[0-9a-f]{64}$`)

var ErrNotConfigured = errors.New("model config client is not configured")

type PrimaryAgentTarget struct {
	TargetSHA256 string
}

type PrimaryAgentTargetResolver interface {
	ResolvePrimaryAgentTarget(context.Context) (PrimaryAgentTarget, error)
}

type Client struct {
	baseURL string
	http    *http.Client
}

type descriptor struct {
	SchemaVersion string `json:"schema_version"`
	Name          string `json:"name"`
	Provider      string `json:"provider"`
	APIProtocol   string `json:"api_protocol"`
	BaseURL       string `json:"base_url"`
	Model         string `json:"model"`
	TargetSHA256  string `json:"target_sha256"`
}

func New(baseURL string) (*Client, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return nil, ErrNotConfigured
	}
	return &Client{
		baseURL: baseURL,
		http: &http.Client{
			Timeout:       5 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}, nil
}

func (c *Client) ResolvePrimaryAgentTarget(ctx context.Context) (PrimaryAgentTarget, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/internal/model-targets/primary_agent", nil)
	if err != nil {
		return PrimaryAgentTarget{}, err
	}
	response, err := c.http.Do(request)
	if err != nil {
		return PrimaryAgentTarget{}, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return PrimaryAgentTarget{}, fmt.Errorf("model config target returned HTTP %d", response.StatusCode)
	}
	value, err := decodeDescriptor(response.Body)
	if err != nil {
		return PrimaryAgentTarget{}, err
	}
	if err := validateDescriptor(value); err != nil {
		return PrimaryAgentTarget{}, err
	}
	return PrimaryAgentTarget{TargetSHA256: value.TargetSHA256}, nil
}

func decodeDescriptor(body io.Reader) (descriptor, error) {
	raw, err := io.ReadAll(io.LimitReader(body, maxDescriptorResponseBytes+1))
	if err != nil {
		return descriptor{}, err
	}
	if len(raw) > maxDescriptorResponseBytes {
		return descriptor{}, errors.New("model config target is oversized")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var value descriptor
	if err := decoder.Decode(&value); err != nil {
		return descriptor{}, fmt.Errorf("decode model config target: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return descriptor{}, errors.New("model config target must contain one JSON value")
	}
	return value, nil
}

func validateDescriptor(value descriptor) error {
	if value.SchemaVersion != "model_target.v1" {
		return errors.New("model config target schema version is invalid")
	}
	if value.Name != "primary_agent" {
		return errors.New("model config target name is invalid")
	}
	if value.Provider != "openai" && value.Provider != "openai-compatible" {
		return errors.New("model config target provider is invalid")
	}
	if strings.TrimSpace(value.BaseURL) == "" || strings.TrimSpace(value.BaseURL) != value.BaseURL || strings.TrimSpace(value.Model) == "" || strings.TrimSpace(value.Model) != value.Model {
		return errors.New("model config target is invalid")
	}
	if value.APIProtocol != "openai.responses" && value.APIProtocol != "openai.chat_completions" {
		return errors.New("model config target API protocol is invalid")
	}
	if !lowercaseSHA256.MatchString(value.TargetSHA256) {
		return errors.New("model config target hash is invalid")
	}
	return nil
}
