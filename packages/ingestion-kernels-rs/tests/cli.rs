use std::io::Write;
use std::process::{Command, Stdio};

fn run_kernel(args: &[&str], stdin: &str) -> std::process::Output {
    let binary = std::env::var("CARGO_BIN_EXE_ingestion-kernel-runner")
        .expect("CARGO_BIN_EXE_ingestion-kernel-runner");
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
        r#"{"unit_id":"u1","document_id":"doc1","text":"hello","metadata":{}}
{"document_id":"doc1","text":"missing id","metadata":{}}
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
fn chunk_document_units_accepts_max_chars_argument() {
    let output = run_kernel(
        &["chunk-document-units", "--max-chars", "8"],
        r#"{"unit_id":"u1","document_id":"doc1","text":"hello","metadata":{}}
{"unit_id":"u2","document_id":"doc1","text":"world","metadata":{}}
"#,
    );

    assert!(output.status.success(), "stderr={}", stderr(&output));
    let payload: serde_json::Value = serde_json::from_slice(&output.stdout).expect("json stdout");
    assert_eq!(payload["schema_version"], "ingestion_chunk_set.v1");
    assert_eq!(payload["chunk_count"], 2);
}

#[test]
fn validate_release_manifest_reads_json_from_stdin() {
    let output = run_kernel(
        &["validate-release-manifest"],
        r#"{"schema_version":"ingestion_release_manifest.v1","release_id":"release-1","corpus":"official_web","collection":"stable_reference","artifacts":[{"kind":"object_store","uri":"s3://bucket/release.json","digest":"sha256:abc"}]}"#,
    );

    assert!(output.status.success(), "stderr={}", stderr(&output));
    let payload: serde_json::Value = serde_json::from_slice(&output.stdout).expect("json stdout");
    assert_eq!(
        payload["schema_version"],
        "ingestion_release_manifest_validation_report.v1"
    );
    assert_eq!(payload["error_count"], 0);
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
