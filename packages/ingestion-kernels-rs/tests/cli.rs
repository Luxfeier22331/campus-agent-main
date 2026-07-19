use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

fn run_kernel(args: &[&str], stdin: &str) -> std::process::Output {
    let binary = env!("CARGO_BIN_EXE_ingestion-kernel-runner");
    let mut child = Command::new(binary)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn ingestion-kernel-runner");
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(stdin.as_bytes())
        .expect("write stdin");
    child.wait_with_output().expect("wait for kernel")
}

#[test]
fn validate_document_units_reads_jsonl_from_stdin_and_writes_report_json() {
    let output = run_kernel(
        &["validate-document-units"],
        r#"{"doc_id":"doc1","version_id":"v1","chunk_id":"u1","root_unit_id":"u1","text":"hello","clean_text":"hello","metadata":{},"anchor":{}}
{"doc_id":"doc1","version_id":"v1","root_unit_id":"u2","text":"missing id","clean_text":"missing id","metadata":{},"anchor":{}}
"#,
    );

    assert!(output.status.success(), "stderr={}", stderr(&output));
    let payload: serde_json::Value = serde_json::from_slice(&output.stdout).expect("json stdout");
    assert_eq!(
        payload["schema_version"],
        "document_units_validation_report.v1"
    );
    assert_eq!(payload["unit_count"], 2);
    assert_eq!(payload["error_count"], 1);
}

#[test]
fn chunk_document_units_requires_tokenizer_and_token_budget_arguments() {
    let output = run_kernel(
        &[
            "chunk-document-units",
            "--tokenizer-json",
            tokenizer_json_path().to_str().expect("tokenizer path utf8"),
            "--chunk-size",
            "3",
            "--max-tokens",
            "3",
            "--overlap",
            "0",
            "--min-tokens",
            "1",
        ],
        r#"{"doc_id":"doc1","version_id":"v1","chunk_id":"u1","root_unit_id":"u1","text":"hello","clean_text":"hello","metadata":{},"anchor":{}}
{"doc_id":"doc1","version_id":"v1","chunk_id":"u2","root_unit_id":"u2","text":"world","clean_text":"world","metadata":{},"anchor":{}}
"#,
    );

    assert!(output.status.success(), "stderr={}", stderr(&output));
    let payload: serde_json::Value = serde_json::from_slice(&output.stdout).expect("json stdout");
    assert_eq!(payload["schema_version"], "ingestion_chunk_set.v1");
    assert_eq!(payload["chunk_count"], 2);
}

#[test]
fn chunk_document_units_rejects_retired_max_chars_argument() {
    let output = run_kernel(&["chunk-document-units", "--max-chars", "8"], "");

    assert!(!output.status.success());
    assert!(stderr(&output).contains("--tokenizer-json is required"));
}

#[test]
fn chunk_document_units_fails_closed_when_tokenizer_is_missing() {
    let output = run_kernel(
        &[
            "chunk-document-units",
            "--tokenizer-json",
            "/missing/tokenizer.json",
            "--chunk-size",
            "3",
            "--max-tokens",
            "3",
            "--overlap",
            "0",
            "--min-tokens",
            "1",
        ],
        r#"{"doc_id":"doc1","version_id":"v1","chunk_id":"u1","root_unit_id":"u1","text":"hello","clean_text":"hello","metadata":{},"anchor":{}}
"#,
    );

    assert!(!output.status.success());
    assert!(stderr(&output).contains("failed to load tokenizer"));
}

#[test]
fn unknown_kernel_exits_non_zero() {
    let output = run_kernel(&["unknown-kernel"], "");

    assert!(!output.status.success());
    assert!(stderr(&output).contains("unsupported ingestion kernel"));
}

fn stderr(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

fn tokenizer_json_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/tokenizer.json")
}
