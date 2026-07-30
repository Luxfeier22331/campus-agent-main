package execution

import (
	"strings"
	"testing"
)

func TestExecutionControlRuntimeGrantSQLUsesExactTablesAndPrivileges(t *testing.T) {
	for _, table := range executionControlRuntimeTables {
		if !strings.Contains(executionControlRuntimeGrantSQL, table) {
			t.Fatalf("runtime grant SQL missing %q", table)
		}
	}
	for _, snippet := range []string{
		"revoke all privileges on schema runtime from execution_control",
		"grant usage on schema runtime to execution_control",
		"grant select, insert, update, delete on table",
		"runtime.request_observability_fact",
	} {
		if !strings.Contains(executionControlRuntimeGrantSQL, snippet) {
			t.Fatalf("runtime grant SQL missing %q", snippet)
		}
	}
	for _, snippet := range []string{
		"all tables in schema runtime",
		"grant all",
		"grant create",
		"grant truncate",
		"grant references",
		"grant trigger",
	} {
		if strings.Contains(strings.ToLower(executionControlRuntimeGrantSQL), snippet) {
			t.Fatalf("runtime grant SQL must not contain %q", snippet)
		}
	}
}
