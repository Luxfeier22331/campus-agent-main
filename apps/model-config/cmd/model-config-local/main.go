package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/model-config/internal/modelconfig"
)

var errLocalCheckNotReady = errors.New("local model config check is not ready")

type environmentLookup func(string) (string, bool)

type repeatedNameFlag []string

func (values *repeatedNameFlag) String() string {
	return strings.Join(*values, ",")
}

func (values *repeatedNameFlag) Set(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return errors.New("--name requires a non-empty value")
	}
	*values = append(*values, value)
	return nil
}

type localCommandOptions struct {
	names            []modelconfig.ConfigName
	storeEnvironment environmentLookup
}

type checkOutput struct {
	Checks []modelconfig.LocalConfigCheck `json:"checks"`
}

type seedOutput struct {
	Seeded []modelconfig.ConfigName `json:"seeded"`
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := run(ctx, os.Args[1:], os.Stdout, os.Stderr, os.LookupEnv); err != nil {
		if !errors.Is(err, errLocalCheckNotReady) {
			fmt.Fprintln(os.Stderr, err)
		}
		os.Exit(1)
	}
}

func run(
	ctx context.Context,
	args []string,
	stdout io.Writer,
	_ io.Writer,
	lookup environmentLookup,
) error {
	if len(args) == 0 {
		return errors.New("usage: model-config-local <seed|check> --name <config-name> [--name <config-name> ...]")
	}
	operation := args[0]
	if operation != "seed" && operation != "check" {
		return fmt.Errorf("unsupported model-config-local operation %q", operation)
	}
	options, err := parseOptions(operation, args[1:], lookup)
	if err != nil {
		return err
	}
	if operation == "seed" {
		return runSeed(ctx, options, stdout)
	}
	return runCheck(ctx, options, stdout)
}

func parseOptions(
	operation string,
	args []string,
	lookup environmentLookup,
) (localCommandOptions, error) {
	var rawNames repeatedNameFlag
	flags := flag.NewFlagSet("model-config-local "+operation, flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.Var(&rawNames, "name", "model config name; may be repeated")
	if err := flags.Parse(args); err != nil {
		return localCommandOptions{}, err
	}
	if len(flags.Args()) > 0 {
		return localCommandOptions{}, fmt.Errorf("unexpected arguments: %s", strings.Join(flags.Args(), " "))
	}
	if len(rawNames) == 0 {
		return localCommandOptions{}, errors.New("at least one --name is required")
	}
	names := make([]modelconfig.ConfigName, 0, len(rawNames))
	seen := make(map[modelconfig.ConfigName]struct{}, len(rawNames))
	for _, rawName := range rawNames {
		name := modelconfig.ConfigName(rawName)
		if _, ok := localSeedEnvironment(name); !ok && name != modelconfig.ConfigNoticeClassification {
			return localCommandOptions{}, fmt.Errorf("unsupported model config name %q", rawName)
		}
		if _, duplicate := seen[name]; duplicate {
			return localCommandOptions{}, fmt.Errorf("duplicate model config name %q", rawName)
		}
		seen[name] = struct{}{}
		names = append(names, name)
	}
	return localCommandOptions{names: names, storeEnvironment: lookup}, nil
}

func runSeed(ctx context.Context, options localCommandOptions, stdout io.Writer) error {
	store, err := openStore(ctx, options.storeEnvironment)
	if err != nil {
		return err
	}
	defer store.Close()
	checks, err := store.Check(ctx, options.names)
	if err != nil {
		return err
	}
	names, err := missingSeedNames(checks)
	if err != nil {
		return err
	}
	if len(names) == 0 {
		return writeJSON(stdout, seedOutput{Seeded: []modelconfig.ConfigName{}})
	}
	configs, selections, missing, err := localSeedConfigs(names, options.storeEnvironment)
	if err != nil {
		return err
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing required local model config environment variables: %s", strings.Join(missing, ", "))
	}
	if err := store.Seed(ctx, configs, selections); err != nil {
		return errors.New("local model config seed failed")
	}
	return writeJSON(stdout, seedOutput{Seeded: names})
}

func missingSeedNames(checks []modelconfig.LocalConfigCheck) ([]modelconfig.ConfigName, error) {
	names := []modelconfig.ConfigName{}
	for _, check := range checks {
		switch check.State {
		case modelconfig.LocalConfigCheckReady:
		case modelconfig.LocalConfigCheckMissing:
			names = append(names, check.Name)
		default:
			return nil, fmt.Errorf("cannot seed %s: %s", check.Name, check.State)
		}
	}
	return names, nil
}

func runCheck(ctx context.Context, options localCommandOptions, stdout io.Writer) error {
	store, err := openStore(ctx, options.storeEnvironment)
	if err != nil {
		checks := make([]modelconfig.LocalConfigCheck, 0, len(options.names))
		for _, name := range options.names {
			checks = append(checks, unknownCheck(name))
		}
		if writeErr := writeJSON(stdout, checkOutput{Checks: checks}); writeErr != nil {
			return writeErr
		}
		return errLocalCheckNotReady
	}
	defer store.Close()
	checks, err := store.Check(ctx, options.names)
	if err != nil {
		checks = make([]modelconfig.LocalConfigCheck, 0, len(options.names))
		for _, name := range options.names {
			checks = append(checks, unknownCheck(name))
		}
	}
	if writeErr := writeJSON(stdout, checkOutput{Checks: checks}); writeErr != nil {
		return writeErr
	}
	for _, check := range checks {
		if check.State != modelconfig.LocalConfigCheckReady {
			return errLocalCheckNotReady
		}
	}
	return nil
}

func localSeedConfigs(
	names []modelconfig.ConfigName,
	lookup environmentLookup,
) ([]modelconfig.LocalSeedConfig, []modelconfig.LocalSeedSelection, []string, error) {
	configs := make([]modelconfig.LocalSeedConfig, 0, len(names))
	selections := []modelconfig.LocalSeedSelection{}
	missingSet := make(map[string]struct{})
	for _, name := range names {
		if name == modelconfig.ConfigNoticeClassification {
			backendConfigs, selection, missing, err := noticeClassificationSeed(lookup)
			if err != nil {
				return nil, nil, nil, err
			}
			for _, key := range missing {
				missingSet[key] = struct{}{}
			}
			configs = append(configs, backendConfigs...)
			if selection != nil {
				selections = append(selections, *selection)
			}
			continue
		}
		definition, _ := localSeedEnvironment(name)
		values := make(map[string]string, len(definition.environmentKeys))
		for _, key := range definition.environmentKeys {
			value, ok := lookup(key)
			value = strings.TrimSpace(value)
			if !ok || value == "" {
				missingSet[key] = struct{}{}
				continue
			}
			values[key] = value
		}
		if name == modelconfig.ConfigPrimaryAgent {
			values["LLM_PROVIDER"], _ = lookup("LLM_PROVIDER")
			values["LLM_API_PROTOCOL"], _ = lookup("LLM_API_PROTOCOL")
			if values["LLM_PROVIDER"] == "" {
				values["LLM_PROVIDER"] = "openai-compatible"
			}
			if values["LLM_API_PROTOCOL"] == "" {
				values["LLM_API_PROTOCOL"] = "openai.responses"
			}
		}
		configs = append(configs, definition.build(values))
	}
	missing := make([]string, 0, len(missingSet))
	for key := range missingSet {
		missing = append(missing, key)
	}
	sort.Strings(missing)
	return configs, selections, missing, nil
}

var (
	noticeClassificationDecisionKeys = []string{"NOTICE_CLASSIFICATION_DECISION_API_KEY", "NOTICE_CLASSIFICATION_DECISION_BASE_URL"}
	noticeClassificationLLMKeys      = []string{
		"NOTICE_CLASSIFICATION_LLM_API_KEY",
		"NOTICE_CLASSIFICATION_LLM_BASE_URL",
		"NOTICE_CLASSIFICATION_LLM_MODEL",
	}
)

// noticeClassificationSeed seeds every backend whose credential is complete
// and selects NOTICE_CLASSIFICATION_BACKEND, defaulting to the decision model
// when both are present. One complete backend is enough.
func noticeClassificationSeed(
	lookup environmentLookup,
) ([]modelconfig.LocalSeedConfig, *modelconfig.LocalSeedSelection, []string, error) {
	value := func(key string) string {
		raw, _ := lookup(key)
		return strings.TrimSpace(raw)
	}
	missingKeys := func(keys []string) []string {
		missing := []string{}
		for _, key := range keys {
			if value(key) == "" {
				missing = append(missing, key)
			}
		}
		return missing
	}
	decisionMissing := missingKeys(noticeClassificationDecisionKeys)
	llmMissing := missingKeys(noticeClassificationLLMKeys)
	configs := []modelconfig.LocalSeedConfig{}
	if len(decisionMissing) == 0 {
		provider := value("NOTICE_CLASSIFICATION_DECISION_PROVIDER")
		if provider == "" {
			provider = "nace"
		}
		model := value("NOTICE_CLASSIFICATION_DECISION_MODEL")
		if model == "" {
			model = "drex-max"
		}
		configs = append(configs, modelconfig.LocalSeedConfig{
			APIKey: value("NOTICE_CLASSIFICATION_DECISION_API_KEY"), Name: modelconfig.ConfigNoticeClassificationDecision, Provider: provider,
			APIProtocol: "typesafe.systemone", BaseURL: value("NOTICE_CLASSIFICATION_DECISION_BASE_URL"), Model: model,
		})
	}
	if len(llmMissing) == 0 {
		protocol := value("NOTICE_CLASSIFICATION_LLM_API_PROTOCOL")
		if protocol == "" {
			protocol = "openai.chat_completions"
		}
		configs = append(configs, modelconfig.LocalSeedConfig{
			APIKey: value("NOTICE_CLASSIFICATION_LLM_API_KEY"), Name: modelconfig.ConfigNoticeClassificationLLM, Provider: "openai-compatible",
			APIProtocol: protocol, BaseURL: value("NOTICE_CLASSIFICATION_LLM_BASE_URL"), Model: value("NOTICE_CLASSIFICATION_LLM_MODEL"),
		})
	}
	backend := value("NOTICE_CLASSIFICATION_BACKEND")
	if backend == "" {
		switch {
		case len(decisionMissing) == 0:
			backend = "decision"
		case len(llmMissing) == 0:
			backend = "llm"
		default:
			return nil, nil, append(decisionMissing, llmMissing...), nil
		}
	}
	var selected modelconfig.ConfigName
	var missing []string
	switch backend {
	case "decision":
		selected, missing = modelconfig.ConfigNoticeClassificationDecision, decisionMissing
	case "llm":
		selected, missing = modelconfig.ConfigNoticeClassificationLLM, llmMissing
	default:
		return nil, nil, nil, fmt.Errorf("NOTICE_CLASSIFICATION_BACKEND must be decision or llm, got %q", backend)
	}
	if len(missing) > 0 {
		return nil, nil, missing, nil
	}
	return configs, &modelconfig.LocalSeedSelection{Alias: modelconfig.ConfigNoticeClassification, ConfigName: selected}, nil, nil
}

type localSeedDefinition struct {
	environmentKeys []string
	build           func(map[string]string) modelconfig.LocalSeedConfig
}

func localSeedEnvironment(name modelconfig.ConfigName) (localSeedDefinition, bool) {
	switch name {
	case modelconfig.ConfigPrimaryAgent:
		return localSeedDefinition{
			environmentKeys: []string{"LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL"},
			build: func(values map[string]string) modelconfig.LocalSeedConfig {
				return modelconfig.LocalSeedConfig{
					APIKey: values["LLM_API_KEY"], Name: name, Provider: values["LLM_PROVIDER"],
					APIProtocol: values["LLM_API_PROTOCOL"], BaseURL: values["LLM_BASE_URL"], Model: values["LLM_MODEL"],
				}
			},
		}, true
	case modelconfig.ConfigDocumentOCR:
		return localSeedDefinition{
			environmentKeys: []string{"DOCUMENT_OCR_API_KEY", "DOCUMENT_OCR_BASE_URL"},
			build: func(values map[string]string) modelconfig.LocalSeedConfig {
				return modelconfig.LocalSeedConfig{
					APIKey: values["DOCUMENT_OCR_API_KEY"], Name: name, Provider: "paddleocr",
					APIProtocol: "paddleocr.jobs", BaseURL: values["DOCUMENT_OCR_BASE_URL"], Model: "PaddleOCR-VL-1.6",
				}
			},
		}, true
	case modelconfig.ConfigCampusDocsEmbedding:
		return localSeedDefinition{
			environmentKeys: []string{"EMBEDDING_API_KEY", "EMBEDDING_BASE_URL"},
			build: func(values map[string]string) modelconfig.LocalSeedConfig {
				return modelconfig.LocalSeedConfig{
					APIKey: values["EMBEDDING_API_KEY"], Name: name, Provider: "openai-compatible",
					APIProtocol: "openai.embeddings", BaseURL: values["EMBEDDING_BASE_URL"], Model: "Qwen3-Embedding-4B",
				}
			},
		}, true
	case modelconfig.ConfigCampusDocsReranker:
		return localSeedDefinition{
			environmentKeys: []string{"RERANK_API_KEY", "RERANK_BASE_URL", "RERANK_MODEL"},
			build: func(values map[string]string) modelconfig.LocalSeedConfig {
				return modelconfig.LocalSeedConfig{
					APIKey: values["RERANK_API_KEY"], Name: name, Provider: "cohere-compatible",
					APIProtocol: "cohere.rerank", BaseURL: values["RERANK_BASE_URL"], Model: values["RERANK_MODEL"],
				}
			},
		}, true
	default:
		return localSeedDefinition{}, false
	}
}

func openStore(ctx context.Context, lookup environmentLookup) (*modelconfig.Store, error) {
	databaseURL, _ := lookup("MODEL_CONFIG_DATABASE_URL")
	keyPath, _ := lookup("MODEL_CONFIG_ENCRYPTION_KEY_FILE")
	databaseURL = strings.TrimSpace(databaseURL)
	keyPath = strings.TrimSpace(keyPath)
	if databaseURL == "" || keyPath == "" {
		return nil, errors.New("model config store is not configured")
	}
	cipher, err := modelconfig.LoadCipher(keyPath)
	if err != nil {
		return nil, errors.New("model config encryption key is unavailable")
	}
	store, err := modelconfig.NewStore(ctx, databaseURL, cipher)
	if err != nil {
		return nil, errors.New("model config database is unavailable")
	}
	return store, nil
}

func unknownCheck(name modelconfig.ConfigName) modelconfig.LocalConfigCheck {
	return modelconfig.LocalConfigCheck{Name: name, State: modelconfig.LocalConfigCheckUnknown, Reason: "unable to inspect model config"}
}

func writeJSON(writer io.Writer, value any) error {
	return json.NewEncoder(writer).Encode(value)
}
