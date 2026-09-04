package main

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocspersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executioninput"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionreconciler"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/hindsightadapter"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/httpapi"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memorypersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/modelconfigclient"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/outboundadapter"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type closeable interface {
	Close()
}

// runtimeOwner is the composition-root lifecycle owner. HTTP receives only
// application ports and never closes shared stores or Temporal clients.
type runtimeOwner struct {
	server     *httpapi.Server
	adapter    *temporaladapter.Adapter
	reconciler *executionreconciler.Reconciler

	campusDocsIndexStore     campusdocs.IndexStore
	runProjectionStore       execution.RunProjectionStore
	personalMemoryStateStore memoryruntime.StateStore
	temporalStarter          *temporalruntime.Starter

	closeOnce sync.Once
}

func newRuntimeOwner(cfg config.Config, logger *slog.Logger) (*runtimeOwner, error) {
	ctx := context.Background()
	runProjectionStore, runProjectionStoreErr := newRunProjectionStore(ctx, cfg)

	var modelConfigResolver *modelconfigclient.Client
	var modelConfigErr error
	if strings.TrimSpace(cfg.ModelConfigBaseURL) != "" {
		modelConfigResolver, modelConfigErr = modelconfigclient.New(cfg.ModelConfigBaseURL)
	} else {
		modelConfigErr = modelconfigclient.ErrNotConfigured
	}

	campusDocsIndexStore, campusDocsIndexStoreErr := newCampusDocsIndexStore(cfg)
	campusDocsSearcher, campusDocsSearcherErr := outboundadapter.NewCampusDocsSearcher(cfg, modelConfigResolver)

	admissionService := executionapplication.NewAdmissionService(executionapplication.AdmissionOptions{
		AgentDeadlineMS:            cfg.AgentRuntimeDeadlineMS,
		ContextCharLimit:           cfg.AgentRuntimeContextCharLimit,
		CurrentInputCharLimit:      cfg.AgentRuntimeInputCharLimit,
		MaxOutputTokens:            cfg.AgentRuntimeMaxOutputTokens,
		PrimaryAgentTargetResolver: modelConfigResolver,
		PrimaryAgentTargetError:    modelConfigErr,
	})

	personalMemoryExecutor, personalMemoryErr := hindsightadapter.New(hindsightadapter.Options{
		APISecret:         cfg.PersonalMemoryAPISecret,
		BaseURL:           cfg.PersonalMemoryBaseURL,
		ContextCharBudget: cfg.PersonalMemoryContextCharBudget,
		OwnerSalt:         cfg.PersonalMemoryOwnerSalt,
		RecallLimit:       cfg.PersonalMemoryRecallLimit,
		RecallMaxTokens:   cfg.PersonalMemoryRecallMaxTokens,
		Timeout:           time.Duration(cfg.PersonalMemoryTimeoutSeconds * float64(time.Second)),
	})
	personalMemoryStateStore, personalMemoryStateErr := newPersonalMemoryStateStore(ctx, cfg)
	if personalMemoryErr == nil && personalMemoryStateErr == nil {
		personalMemoryExecutor = memoryruntime.NewFencedExecutor(
			personalMemoryExecutor,
			personalMemoryStateStore,
			cfg.PersonalMemoryOwnerSalt,
			time.Duration(cfg.PersonalMemoryTimeoutSeconds*float64(time.Second)),
		)
	}

	executionInputLoader, executionInputErr := executioninput.NewInputLoader(cfg)
	agentRuntimeClient := outboundadapter.NewAgentRuntimeClient(cfg)
	productCallbackClient := outboundadapter.NewProductCallbackClient(cfg)
	temporalStarter, temporalStarterErr := newTemporalStarter(ctx, cfg)

	adapter := temporaladapter.New(temporaladapter.Options{
		Config:                   cfg,
		AdmissionService:         admissionService,
		ExecutionInputLoader:     executionInputLoader,
		ExecutionInputError:      executionInputErr,
		Logger:                   logger,
		PersonalMemoryExecutor:   personalMemoryExecutor,
		PersonalMemoryError:      personalMemoryErr,
		PersonalMemoryStateStore: personalMemoryStateStore,
		PersonalMemoryStateError: personalMemoryStateErr,
		AgentRuntimeClient:       agentRuntimeClient,
		ProductCallbackClient:    productCallbackClient,
		RunProjectionStore:       runProjectionStore,
	})
	reconciler := executionreconciler.New(executionreconciler.Options{
		Finalizer:        adapter,
		Logger:           logger,
		OperationTimeout: time.Duration(cfg.TemporalStartTimeoutMS) * time.Millisecond,
		Starter:          temporalStarter,
		Store:            runProjectionStore,
	})
	runService := executionapplication.NewRunService(executionapplication.RunServiceOptions{
		AdmissionSnapshotBuilder:      admissionService,
		InputLoader:                   executionInputLoader,
		InputError:                    executionInputErr,
		Namespace:                     cfg.TemporalNamespace,
		PersonalMemoryRecallAvailable: personalMemoryExecutor != nil && personalMemoryErr == nil,
		PersonalMemoryTimeoutSeconds:  cfg.PersonalMemoryTimeoutSeconds,
		ReconcilerWaker:               reconciler,
		Store:                         runProjectionStore,
		StoreError:                    runProjectionStoreErr,
		TaskQueue:                     cfg.TemporalTaskQueue,
	})
	agentToolService := executionapplication.NewAgentToolService(executionapplication.AgentToolServiceOptions{
		CampusDocsIndexStore:      campusDocsIndexStore,
		CampusDocsIndexStoreError: campusDocsIndexStoreErr,
		CampusDocsSearcher:        campusDocsSearcher,
		CampusDocsSearcherError:   campusDocsSearcherErr,
		InputLoader:               executionInputLoader,
		InputError:                executionInputErr,
		PersonalMemoryExecutor:    personalMemoryExecutor,
		PersonalMemoryError:       personalMemoryErr,
		Store:                     runProjectionStore,
		StoreError:                runProjectionStoreErr,
	})
	server := httpapi.NewServerWithOptions(cfg, httpapi.ServerOptions{
		AgentToolService:         agentToolService,
		Logger:                   logger,
		PersonalMemoryStateStore: personalMemoryStateStore,
		PersonalMemoryStateError: personalMemoryStateErr,
		RunProjectionStore:       runProjectionStore,
		RunProjectionStoreError:  runProjectionStoreErr,
		RunService:               runService,
		TemporalStarter:          temporalStarter,
		TemporalStarterError:     temporalStarterErr,
	})
	return &runtimeOwner{
		server:                   server,
		adapter:                  adapter,
		reconciler:               reconciler,
		campusDocsIndexStore:     campusDocsIndexStore,
		runProjectionStore:       runProjectionStore,
		personalMemoryStateStore: personalMemoryStateStore,
		temporalStarter:          temporalStarter,
	}, nil
}

func (owner *runtimeOwner) StartDraining() {
	if owner != nil && owner.server != nil {
		owner.server.StartDraining()
	}
}

func (owner *runtimeOwner) Shutdown(_ context.Context) error {
	if owner == nil {
		return nil
	}
	owner.closeOnce.Do(func() {
		if owner.reconciler != nil {
			owner.reconciler.Stop()
		}
		if owner.temporalStarter != nil {
			owner.temporalStarter.Close()
		}
		if closer, ok := owner.campusDocsIndexStore.(closeable); ok {
			closer.Close()
		}
		if closer, ok := owner.runProjectionStore.(closeable); ok {
			closer.Close()
		}
		if closer, ok := owner.personalMemoryStateStore.(closeable); ok {
			closer.Close()
		}
	})
	return nil
}

func newRunProjectionStore(ctx context.Context, cfg config.Config) (execution.RunProjectionStore, error) {
	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		return nil, nil
	}
	connectCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	store, err := executionpersistence.NewPostgresRunProjectionStore(connectCtx, executionpersistence.PostgresRunProjectionStoreOptions{
		DatabaseURL: strings.TrimSpace(cfg.DatabaseURL),
	})
	if err != nil {
		return nil, err
	}
	return store, nil
}

func newCampusDocsIndexStore(cfg config.Config) (campusdocs.IndexStore, error) {
	return campusdocspersistence.NewPostgresIndexStore(cfg.DatabaseURL)
}

func newPersonalMemoryStateStore(ctx context.Context, cfg config.Config) (memoryruntime.StateStore, error) {
	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		return memorypersistence.NewInMemoryStateStore(), nil
	}
	connectCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	return memorypersistence.NewPostgresStateStore(connectCtx, memorypersistence.PostgresStateStoreOptions{
		DatabaseURL: strings.TrimSpace(cfg.DatabaseURL),
	})
}

func newTemporalStarter(ctx context.Context, cfg config.Config) (*temporalruntime.Starter, error) {
	if strings.TrimSpace(cfg.TemporalAddress) == "" && strings.TrimSpace(cfg.TemporalNamespace) == "" {
		return nil, temporalruntime.ErrTemporalStarterNotConfigured
	}
	connectCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return temporalruntime.NewStarter(connectCtx, temporalruntime.StarterOptions{
		ActivityTaskQueues:       []string{temporalruntime.ActivityTaskQueueCore, temporalruntime.ActivityTaskQueueAgent},
		Address:                  cfg.TemporalAddress,
		Namespace:                cfg.TemporalNamespace,
		TaskQueue:                cfg.TemporalTaskQueue,
		WorkerID:                 cfg.TemporalWorkerIdentity,
		StartTimeout:             time.Duration(cfg.TemporalStartTimeoutMS) * time.Millisecond,
		WorkflowExecutionTimeout: time.Duration(cfg.TemporalWorkflowExecutionTimeoutSeconds) * time.Second,
	})
}
