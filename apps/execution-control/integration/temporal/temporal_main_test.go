//go:build temporal_integration

package temporal_test

import (
	"os"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/temporaltest"
)

var packageHarness *temporaltest.Harness

func TestMain(m *testing.M) {
	os.Exit(temporaltest.RunPackage(m, &packageHarness))
}
