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
		if _, ok := localSeedEnvironment(name); !ok {
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
	configs, missing := localSeedConfigs(options.names, options.storeEnvironment)
	if len(missing) > 0 {
		return fmt.Errorf("missing required local model config environment variables: %s", strings.Join(missing, ", "))
	}
	store, err := openStore(ctx, options.storeEnvironment)
	if err != nil {
		return err
	}
	defer store.Close()
	if err := store.Seed(ctx, configs); err != nil {
		return errors.New("local model config seed failed")
	}
	return writeJSON(stdout, seedOutput{Seeded: options.names})
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
) ([]modelconfig.LocalSeedConfig, []string) {
	configs := make([]modelconfig.LocalSeedConfig, 0, len(names))
	missingSet := make(map[string]struct{})
	for _, name := range names {
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
		configs = append(configs, definition.build(values))
	}
	missing := make([]string, 0, len(missingSet))
	for key := range missingSet {
		missing = append(missing, key)
	}
	sort.Strings(missing)
	return configs, missing
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
					APIKey: values["LLM_API_KEY"], Name: name, Provider: "openai-compatible",
					APIProtocol: "openai.responses", BaseURL: values["LLM_BASE_URL"], Model: values["LLM_MODEL"],
				}
			},
		}, true
	case modelconfig.ConfigNoticeClassification:
		return localSeedDefinition{
			environmentKeys: []string{
				"NOTICE_CLASSIFICATION_API_KEY",
				"NOTICE_CLASSIFICATION_BASE_URL",
				"NOTICE_CLASSIFICATION_MODEL",
			},
			build: func(values map[string]string) modelconfig.LocalSeedConfig {
				return modelconfig.LocalSeedConfig{
					APIKey: values["NOTICE_CLASSIFICATION_API_KEY"], Name: name, Provider: "openai-compatible",
					APIProtocol: "openai.responses", BaseURL: values["NOTICE_CLASSIFICATION_BASE_URL"], Model: values["NOTICE_CLASSIFICATION_MODEL"],
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
