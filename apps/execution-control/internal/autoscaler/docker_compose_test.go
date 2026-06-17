package autoscaler

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type recordingComposeRunner struct {
	err    error
	output string
	calls  []string
}

func (r *recordingComposeRunner) Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	r.calls = append(r.calls, name+" "+strings.Join(args, " "))
	return []byte(r.output), r.err
}

func TestDockerComposeActuatorReadsAllowlistedReplicaState(t *testing.T) {
	runner := &recordingComposeRunner{output: `[
		{"Service":"activity-worker-knowledge-retrieval","Publishers":null},
		{"Service":"activity-worker-knowledge-retrieval","Publishers":null},
		{"Service":"activity-worker-finalization","Publishers":null}
	]`}
	actuator := DockerComposeActuator{
		ProjectDirectory: "/srv/campus-agent",
		ProjectName:      "campus-agent-staging",
		Runner:           runner,
	}

	replicas, err := actuator.ReplicaCounts(t.Context(), []string{
		"activity-worker-knowledge-retrieval",
		"activity-worker-finalization",
	})
	if err != nil {
		t.Fatalf("ReplicaCounts returned error: %v", err)
	}
	if replicas["activity-worker-knowledge-retrieval"] != 2 || replicas["activity-worker-finalization"] != 1 {
		t.Fatalf("replicas = %#v", replicas)
	}
	if !strings.Contains(
		runner.calls[0],
		"compose --project-name campus-agent-staging --project-directory /srv/campus-agent ps --format json",
	) {
		t.Fatalf("compose call = %#v", runner.calls)
	}
}

func TestDockerComposeActuatorFailsClosedForNonAllowlistedService(t *testing.T) {
	actuator := DockerComposeActuator{Runner: &recordingComposeRunner{}}

	_, err := actuator.ReplicaCounts(t.Context(), []string{"postgres"})
	if err == nil {
		t.Fatal("non-allowlisted service must fail closed")
	}
	if !strings.Contains(err.Error(), "not allowlisted") {
		t.Fatalf("error = %q", err.Error())
	}
}

func TestDockerComposeActuatorAppliesScaleForChangedDecisionOnly(t *testing.T) {
	runner := &recordingComposeRunner{}
	actuator := DockerComposeActuator{
		ProjectDirectory: "/srv/campus-agent",
		ProjectName:      "campus-agent-staging",
		Runner:           runner,
		Now:              fixedAutoscalerTime,
	}

	actuations, err := actuator.Apply(t.Context(), []WorkerAutoscalerDecision{
		{
			CurrentReplicas: 1,
			Decision:        DecisionScaleUp,
			DecisionID:      "decision-knowledge-retrieval",
			DesiredReplicas: 2,
			TargetService:   "activity-worker-knowledge-retrieval",
		},
		{
			CurrentReplicas: 1,
			Decision:        DecisionHold,
			DecisionID:      "decision-finalization",
			DesiredReplicas: 1,
			TargetService:   "activity-worker-finalization",
		},
	})
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}

	if len(runner.calls) != 1 {
		t.Fatalf("compose calls = %#v", runner.calls)
	}
	if !strings.Contains(
		runner.calls[0],
		"compose --project-name campus-agent-staging --project-directory /srv/campus-agent up -d --scale activity-worker-knowledge-retrieval=2 activity-worker-knowledge-retrieval",
	) {
		t.Fatalf("compose call = %#v", runner.calls)
	}
	if len(actuations) != 2 {
		t.Fatalf("actuation count = %d", len(actuations))
	}
	if actuations[0].Status != ActuationStatusApplied || actuations[0].Action != "scale" {
		t.Fatalf("scale actuation = %#v", actuations[0])
	}
	if actuations[1].Status != ActuationStatusSkipped || actuations[1].Action != "none" {
		t.Fatalf("hold actuation = %#v", actuations[1])
	}
}

func TestDockerComposeActuatorReturnsFailedActuationWhenScaleFails(t *testing.T) {
	runner := &recordingComposeRunner{err: errors.New("compose unavailable"), output: "boom"}
	actuator := DockerComposeActuator{
		ProjectDirectory: "/srv/campus-agent",
		ProjectName:      "campus-agent-staging",
		Runner:           runner,
		Now:              fixedAutoscalerTime,
	}

	actuations, err := actuator.Apply(t.Context(), []WorkerAutoscalerDecision{{
		CurrentReplicas: 1,
		Decision:        DecisionScaleUp,
		DecisionID:      "decision-knowledge-retrieval",
		DesiredReplicas: 2,
		TargetService:   "activity-worker-knowledge-retrieval",
	}})
	if err == nil {
		t.Fatal("Apply must return the compose failure")
	}
	if len(actuations) != 1 {
		t.Fatalf("actuations = %#v", actuations)
	}
	actuation := actuations[0]
	if actuation.Status != ActuationStatusFailed ||
		actuation.ErrorCode != "docker_compose_scale_failed" ||
		actuation.Action != "scale" {
		t.Fatalf("failed actuation = %#v", actuation)
	}
}
