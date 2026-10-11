package modelconfigclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
)

const maxDescriptorResponseBytes = 1 << 20

var lowercaseSHA256 = regexp.MustCompile(`^[0-9a-f]{64}$`)

var ErrNotConfigured = errors.New("model config client is not configured")

type ModelTarget = execution.ModelTarget

type RuntimeConfig struct {
	SchemaVersion string `json:"schema_version"`
	Name          string `json:"name"`
	Provider      string `json:"provider"`
	APIProtocol   string `json:"api_protocol"`
	BaseURL       string `json:"base_url"`
	Model         string `json:"model"`
	APIKey        string `json:"api_key"`
	TargetSHA256  string `json:"target_sha256"`
	Capabilities  struct {
		HostedWebSearch bool `json:"hosted_web_search"`
	} `json:"capabilities"`
}

type ModelTargetResolver = execution.ModelTargetResolver

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
	Capabilities  struct {
		HostedWebSearch bool `json:"hosted_web_search"`
	} `json:"capabilities"`
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

func (c *Client) ResolveModelTarget(ctx context.Context) (ModelTarget, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/internal/model-targets/primary_agent", nil)
	if err != nil {
		return ModelTarget{}, err
	}
	response, err := c.http.Do(request)
	if err != nil {
		return ModelTarget{}, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return ModelTarget{}, fmt.Errorf("model config target returned HTTP %d", response.StatusCode)
	}
	value, err := decodeDescriptor(response.Body)
	if err != nil {
		return ModelTarget{}, err
	}
	if err := validateDescriptor(value); err != nil {
		return ModelTarget{}, err
	}
	return ModelTarget{
		TargetSHA256:    value.TargetSHA256,
		HostedWebSearch: value.Capabilities.HostedWebSearch,
	}, nil
}

func (c *Client) ResolveRuntimeConfig(ctx context.Context, name string) (RuntimeConfig, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return RuntimeConfig{}, errors.New("model config name is required")
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		c.baseURL+"/internal/model-configs/"+url.PathEscape(name),
		nil,
	)
	if err != nil {
		return RuntimeConfig{}, err
	}
	response, err := c.http.Do(request)
	if err != nil {
		return RuntimeConfig{}, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return RuntimeConfig{}, fmt.Errorf("model config %s returned HTTP %d", name, response.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxDescriptorResponseBytes+1))
	if err != nil {
		return RuntimeConfig{}, err
	}
	if len(raw) > maxDescriptorResponseBytes {
		return RuntimeConfig{}, errors.New("model runtime config is oversized")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var value RuntimeConfig
	if err := decoder.Decode(&value); err != nil {
		return RuntimeConfig{}, fmt.Errorf("decode model runtime config: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return RuntimeConfig{}, errors.New("model runtime config must contain one JSON value")
	}
	if err := validateRuntimeConfig(value, name); err != nil {
		return RuntimeConfig{}, err
	}
	return value, nil
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
	if value.Provider != "google" && value.Provider != "openai" && value.Provider != "openai-compatible" {
		return errors.New("model config target provider is invalid")
	}
	if strings.TrimSpace(value.BaseURL) == "" || strings.TrimSpace(value.BaseURL) != value.BaseURL || strings.TrimSpace(value.Model) == "" || strings.TrimSpace(value.Model) != value.Model {
		return errors.New("model config target is invalid")
	}
	validGoogleProtocol := value.Provider == "google" && value.APIProtocol == "google.generate_content"
	validOpenAIProtocol := value.Provider != "google" &&
		(value.APIProtocol == "openai.responses" || value.APIProtocol == "openai.chat_completions")
	if !validGoogleProtocol && !validOpenAIProtocol {
		return errors.New("model config target API protocol is invalid")
	}
	if !lowercaseSHA256.MatchString(value.TargetSHA256) {
		return errors.New("model config target hash is invalid")
	}
	return nil
}

func validateRuntimeConfig(value RuntimeConfig, wantName string) error {
	if value.SchemaVersion != "model_runtime_config.v1" || value.Name != wantName {
		return errors.New("model runtime config identity is invalid")
	}
	if value.Provider == "" || value.APIProtocol == "" || value.BaseURL == "" || value.Model == "" || value.APIKey == "" {
		return errors.New("model runtime config is incomplete")
	}
	if value.Provider != "openai" && value.Provider != "openai-compatible" && value.Provider != "cohere" && value.Provider != "cohere-compatible" {
		return errors.New("model runtime config provider is invalid")
	}
	if value.APIProtocol != "openai.responses" && value.APIProtocol != "openai.chat_completions" && value.APIProtocol != "openai.embeddings" && value.APIProtocol != "cohere.rerank" {
		return errors.New("model runtime config API protocol is invalid")
	}
	if !lowercaseSHA256.MatchString(value.TargetSHA256) {
		return errors.New("model runtime config target hash is invalid")
	}
	return nil
}
