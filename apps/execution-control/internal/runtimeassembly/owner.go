package runtimeassembly

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executioninput"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/hindsightadapter"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memorypersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/modelconfigclient"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/outboundadapter"
	finalizationactivities "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/toolcontract"
)

type resources struct {
	runProjectionStore       executionapplication.RunStore
	runProjectionStoreErr    error
	personalMemoryStateStore executionapplication.MemoryStore
	personalMemoryStateErr   error
	personalMemoryExecutor   executionapplication.MemoryExecutor
	asyncMemoryExecutor      executionapplication.AsyncMemoryExecutor
	personalMemoryReader     executionapplication.MemoryReader
	personalMemoryErr        error
	temporalStarter          *temporalruntime.Starter
	temporalStarterErr       error
	modelConfigResolver      *modelconfigclient.Client
	admissionService         *executionapplication.AdmissionService
	executionInputLoader     execution.InputLoader
	executionInputErr        error
	writer                   *projection.Writer
	finalizationAdapter      *finalizationactivities.Adapter
	closeOnce                sync.Once
}

func newResources(cfg config.Config, logger *slog.Logger) (*resources, error) {
	ctx := context.Background()
	runProjectionStore, runProjectionStoreErr := newRunProjectionStore(ctx, cfg)

	var modelConfigResolver *modelconfigclient.Client
	var modelConfigErr error
	if strings.TrimSpace(cfg.ModelConfigBaseURL) != "" {
		modelConfigResolver, modelConfigErr = modelconfigclient.New(cfg.ModelConfigBaseURL)
	} else {
		modelConfigErr = modelconfigclient.ErrNotConfigured
	}

	admissionService := executionapplication.NewAdmissionService(executionapplication.AdmissionOptions{
		ToolContract:          toolcontract.Files{},
		AgentDeadlineMS:       cfg.AgentRuntimeDeadlineMS,
		ContextCharLimit:      cfg.AgentRuntimeContextCharLimit,
		CurrentInputCharLimit: cfg.AgentRuntimeInputCharLimit,
		MaxOutputTokens:       cfg.AgentRuntimeMaxOutputTokens,
		ModelTargetResolver:   modelConfigResolver,
		ModelTargetError:      modelConfigErr,
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
	var asyncMemoryExecutor executionapplication.AsyncMemoryExecutor
	var personalMemoryReader executionapplication.MemoryReader
	if personalMemoryErr == nil && personalMemoryStateErr == nil {
		personalMemoryExecutor = executionapplication.NewFencedExecutor(
			personalMemoryExecutor,
			personalMemoryStateStore,
			cfg.PersonalMemoryOwnerSalt,
			time.Duration(cfg.PersonalMemoryTimeoutSeconds*float64(time.Second)),
		)
		asyncMemoryExecutor, _ = personalMemoryExecutor.(executionapplication.AsyncMemoryExecutor)
		personalMemoryReader, _ = personalMemoryExecutor.(executionapplication.MemoryReader)
	} else {
		// A provider without the lifecycle state store is not a usable memory
		// runtime. Keep the provider error for activities, but never expose the
		// raw executor to an online caller that would bypass the fence.
		personalMemoryExecutor = nil
		asyncMemoryExecutor = nil
	}

	executionInputLoader, executionInputErr := executioninput.NewInputLoader(cfg)
	productCallbackClient := outboundadapter.NewProductCallbackClient(cfg)
	temporalStarter, temporalStarterErr := newTemporalStarter(ctx, cfg)

	writer := projection.New(projection.Writer{Config: cfg, ExecutionInputLoader: executionInputLoader, ExecutionInputErr: executionInputErr, ProductCallbackClient: productCallbackClient, RunProjectionStore: runProjectionStore})
	finalizationAdapter := finalizationactivities.New(finalizationactivities.Adapter{Writer: writer, AdmissionService: admissionService, Logger: logger})
	return &resources{
		runProjectionStore:       runProjectionStore,
		runProjectionStoreErr:    runProjectionStoreErr,
		personalMemoryStateStore: personalMemoryStateStore,
		personalMemoryStateErr:   personalMemoryStateErr,
		personalMemoryExecutor:   personalMemoryExecutor,
		asyncMemoryExecutor:      asyncMemoryExecutor,
		personalMemoryReader:     personalMemoryReader,
		personalMemoryErr:        personalMemoryErr,
		temporalStarter:          temporalStarter,
		temporalStarterErr:       temporalStarterErr,
		modelConfigResolver:      modelConfigResolver,
		admissionService:         admissionService,
		executionInputLoader:     executionInputLoader,
		executionInputErr:        executionInputErr,
		writer:                   writer,
		finalizationAdapter:      finalizationAdapter,
	}, nil
}
func (r *resources) Close() {
	r.closeOnce.Do(func() {
		if r.temporalStarter != nil {
			r.temporalStarter.Close()
		}
		if closer, ok := r.runProjectionStore.(interface{ Close() }); ok {
			closer.Close()
		}
		if closer, ok := r.personalMemoryStateStore.(interface{ Close() }); ok {
			closer.Close()
		}
	})
}
func newRunProjectionStore(ctx context.Context, cfg config.Config) (executionapplication.RunStore, error) {
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

func newPersonalMemoryStateStore(ctx context.Context, cfg config.Config) (executionapplication.MemoryStore, error) {
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
	return NewStarter(connectCtx, temporalruntime.StarterOptions{
		ActivityTaskQueues:       []string{temporalruntime.ActivityTaskQueueCore, temporalruntime.ActivityTaskQueueAgent},
		Address:                  cfg.TemporalAddress,
		Namespace:                cfg.TemporalNamespace,
		TaskQueue:                cfg.TemporalTaskQueue,
		WorkerID:                 cfg.TemporalWorkerIdentity,
		StartTimeout:             time.Duration(cfg.TemporalStartTimeoutMS) * time.Millisecond,
		WorkflowExecutionTimeout: time.Duration(cfg.TemporalWorkflowExecutionTimeoutSeconds) * time.Second,
	})
}
