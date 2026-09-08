package executionapplication

import (
	"context"
	"errors"
	"fmt"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

const (
	defaultAgentDeadlineMS        = 240000
	defaultAgentMaxOutputTokens   = 2048
	defaultAgentCurrentInputChars = 8000
	defaultAgentContextChars      = 16000
	defaultMaxFunctionToolCalls   = 8
	defaultMaxModelTurns          = 8
	defaultMaxPlanSteps           = 6
	defaultMaxReplans             = 3
)

type AdmissionOptions struct {
	AgentDeadlineMS       int
	ContextCharLimit      int
	CurrentInputCharLimit int
	MaxOutputTokens       int
	ModelTargetResolver   execution.ModelTargetResolver
	ModelTargetError      error
	ToolContract          ToolContractSource
}

type AdmissionService struct {
	limits              execution.AgentRuntimeLimitsSnapshot
	modelTargetResolver execution.ModelTargetResolver
	modelTargetError    error
	toolContract        ToolContractSource
}

func NewAdmissionService(options AdmissionOptions) *AdmissionService {
	return &AdmissionService{
		limits: execution.AgentRuntimeLimitsSnapshot{
			AgentDeadlineMS:       positiveOrDefault(options.AgentDeadlineMS, defaultAgentDeadlineMS),
			ContextCharLimit:      positiveOrDefault(options.ContextCharLimit, defaultAgentContextChars),
			CurrentInputCharLimit: positiveOrDefault(options.CurrentInputCharLimit, defaultAgentCurrentInputChars),
			MaxOutputTokens:       positiveOrDefault(options.MaxOutputTokens, defaultAgentMaxOutputTokens),
		},
		modelTargetResolver: options.ModelTargetResolver,
		modelTargetError:    options.ModelTargetError,
		toolContract:        options.ToolContract,
	}
}

func (s *AdmissionService) BuildAgentAdmissionSnapshot(
	ctx context.Context,
	personalMemoryRecallAvailable bool,
) (execution.AgentAdmissionSnapshot, error) {
	if s == nil {
		return execution.AgentAdmissionSnapshot{}, execution.NewDependencyNotReadyError(
			errors.New("agent admission service is not configured"),
		)
	}
	target, err := s.resolveModelTarget(ctx)
	if err != nil {
		return execution.AgentAdmissionSnapshot{}, execution.NewDependencyNotReadyError(
			fmt.Errorf("resolve workflow model target: %w", err),
		)
	}
	capabilities := execution.AgentCapabilitiesForAdmission(
		personalMemoryRecallAvailable,
		target.HostedWebSearch,
	)
	budget := execution.AgentRuntimeBudgetSnapshot{
		MaxFunctionToolCalls: defaultMaxFunctionToolCalls,
		MaxModelTurns:        defaultMaxModelTurns,
		MaxPlanSteps:         defaultMaxPlanSteps,
		MaxReplans:           defaultMaxReplans,
		SchemaVersion:        execution.AgentRuntimeBudgetSchemaVersion,
	}
	toolContract, err := s.toolFingerprint()
	if err != nil {
		return execution.AgentAdmissionSnapshot{}, execution.NewDependencyNotReadyError(
			fmt.Errorf("build tool contract admission snapshot: %w", err),
		)
	}
	snapshot := execution.AgentAdmissionSnapshot{
		AgentLimits:             s.limits,
		AgentCapabilities:       capabilities,
		AgentBudget:             budget,
		ModelTargetSHA256:       target.TargetSHA256,
		ToolContractFingerprint: toolContract,
	}
	if err := execution.ValidateAdmissionSnapshot(snapshot); err != nil {
		return execution.AgentAdmissionSnapshot{}, err
	}
	return snapshot, nil
}

func (s *AdmissionService) ValidateLocalToolContractFingerprintMap(expected map[string]any) error {
	if len(expected) == 0 {
		return errors.New("admitted tool contract fingerprint is unavailable")
	}
	if s == nil {
		return errors.New("agent admission service is not configured")
	}
	local, err := s.toolFingerprint()
	if err != nil {
		return fmt.Errorf("build local tool contract fingerprint: %w", err)
	}
	if execution.HashAdmissionJSON(expected) !=
		execution.HashAdmissionJSON(execution.ToolContractFingerprintSnapshotMap(local)) {
		return errors.New("local execution-control tool contract fingerprint does not match admission")
	}
	return nil
}

func (s *AdmissionService) resolveModelTarget(ctx context.Context) (execution.ModelTarget, error) {
	if s.modelTargetError != nil {
		return execution.ModelTarget{}, s.modelTargetError
	}
	if s.modelTargetResolver == nil {
		return execution.ModelTarget{}, errors.New("workflow model target resolver is not configured")
	}
	return s.modelTargetResolver.ResolveModelTarget(ctx)
}

func positiveOrDefault(value int, fallback int) int {
	if value > 0 {
		return value
	}
	return fallback
}

type ToolContractSource interface {
	Fingerprint() (execution.ToolContractFingerprintSnapshot, error)
}

func (s *AdmissionService) toolFingerprint() (execution.ToolContractFingerprintSnapshot, error) {
	if s.toolContract == nil {
		return execution.ToolContractFingerprintSnapshot{}, errors.New("tool contract source is not configured")
	}
	return s.toolContract.Fingerprint()
}
