package runtimeassembly

import (
	"context"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/outboundadapter"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/hindsightadapter"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryapplication"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memorypersistence"
)

type memoryResources struct {
	store          memoryapplication.MemoryStateStore
	storeErr       error
	commandState   memoryapplication.CommandReceiptStore
	callLease      memoryapplication.CallLeaseStore
	ownerLifecycle memoryapplication.OwnerLifecycleStore
	recaller       memoryapplication.MemoryRecaller
	command        memoryapplication.MemoryCommandExecutor
	asyncExecutor  memoryapplication.AsyncMemoryExecutor
	reader         memoryapplication.ProfileReader
	providerErr    error
	resultClient   memoryapplication.MemoryCommandResultClient
}

func newMemoryResources(ctx context.Context, cfg config.Config, resultClient memoryapplication.MemoryCommandResultClient) memoryResources {
	if cfg.MemoryServiceBaseURL != "" {
		client := outboundadapter.NewMemoryClient(cfg.MemoryServiceBaseURL, cfg.MemoryServiceSecret)
		return memoryResources{recaller: client, reader: client}
	}
	provider, personalMemoryErr := hindsightadapter.New(hindsightadapter.Options{
		APISecret:         cfg.PersonalMemoryAPISecret,
		BaseURL:           cfg.PersonalMemoryBaseURL,
		ContextCharBudget: cfg.PersonalMemoryContextCharBudget,
		OwnerSalt:         cfg.PersonalMemoryOwnerSalt,
		RecallLimit:       cfg.PersonalMemoryRecallLimit,
		RecallMaxTokens:   cfg.PersonalMemoryRecallMaxTokens,
		Timeout:           time.Duration(cfg.PersonalMemoryTimeoutSeconds * float64(time.Second)),
	})
	personalMemoryStateStore, personalMemoryStateErr := newPersonalMemoryStateStore(ctx, cfg)
	var personalMemoryRecaller memoryapplication.MemoryRecaller
	var personalMemoryCommand memoryapplication.MemoryCommandExecutor
	var asyncMemoryExecutor memoryapplication.AsyncMemoryExecutor
	var personalMemoryReader memoryapplication.ProfileReader
	commandState, callLease, ownerLifecycle := memoryStatePorts(personalMemoryStateStore)
	if personalMemoryErr == nil && personalMemoryStateErr == nil {
		fenced := memoryapplication.NewFencedMemoryRecaller(
			provider, callLease,
			cfg.PersonalMemoryOwnerSalt,
			time.Duration(cfg.PersonalMemoryTimeoutSeconds*float64(time.Second)),
		)
		profileService := &memoryapplication.ProfileService{
			Provider:   provider,
			State:      personalMemoryStateStore,
			StateError: personalMemoryStateErr,
			OwnerSalt:  cfg.PersonalMemoryOwnerSalt,
			Timeout:    time.Duration(cfg.PersonalMemoryTimeoutSeconds * float64(time.Second)),
		}
		personalMemoryRecaller = fenced
		personalMemoryCommand = provider
		personalMemoryReader = profileService
		asyncMemoryExecutor = provider
	} else {
		// A provider without the lifecycle state store is not a usable memory
		// runtime. Keep the provider error for activities, but never expose the
		// raw executor to an online caller that would bypass the fence.
		personalMemoryRecaller = nil
		personalMemoryCommand = nil
		asyncMemoryExecutor = nil
	}

	return memoryResources{
		store: personalMemoryStateStore, storeErr: personalMemoryStateErr,
		commandState: commandState, callLease: callLease, ownerLifecycle: ownerLifecycle,
		recaller: personalMemoryRecaller, command: personalMemoryCommand,
		asyncExecutor: asyncMemoryExecutor,
		reader:        personalMemoryReader, providerErr: personalMemoryErr, resultClient: resultClient,
	}
}

func newPersonalMemoryStateStore(ctx context.Context, cfg config.Config) (memoryapplication.MemoryStateStore, error) {
	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		return memorypersistence.NewInMemoryStateStore(), nil
	}
	connectCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	return memorypersistence.NewPostgresStateStore(connectCtx, memorypersistence.PostgresStateStoreOptions{
		DatabaseURL: strings.TrimSpace(cfg.DatabaseURL),
	})
}

func memoryStatePorts(store memoryapplication.MemoryStateStore) (memoryapplication.CommandReceiptStore, memoryapplication.CallLeaseStore, memoryapplication.OwnerLifecycleStore) {
	return store, store, store
}
