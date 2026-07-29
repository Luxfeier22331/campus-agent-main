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
fn build_retrieval_chunks_v2_writes_formal_chunks() {
    let output = run_kernel(
        &[
            "build-retrieval-chunks-v2",
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
        r##"{"schema_version":"canonical_document_unit.v2","document_scope":"regulations","document_id":"doc1","version_id":"v1","section_id":"section-1","parent_section_id":null,"ordinal":0,"anchor":"#section-1","document_title":"Handbook","section_title":"Section 1","canonical_url":"https://example.test/handbook#section-1","content":"hello","content_sha256":"sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824","metadata":{}}
"##,
    );

    assert!(output.status.success(), "stderr={}", stderr(&output));
    let payload: serde_json::Value = serde_json::from_slice(&output.stdout).expect("json stdout");
    assert_eq!(payload["schema_version"], "retrieval_chunk_set.v2");
    assert_eq!(payload["chunk_count"], 1);
    assert_eq!(payload["chunks"][0]["schema_version"], "retrieval_chunk.v2");
    assert_eq!(payload["chunks"][0]["token_count"], 1);
}

#[test]
fn build_retrieval_chunks_v2_rejects_retired_max_chars_argument() {
    let output = run_kernel(&["build-retrieval-chunks-v2", "--max-chars", "8"], "");

    assert!(!output.status.success());
    assert!(stderr(&output).contains("--max-chars is retired"));
}

#[test]
fn build_retrieval_chunks_v2_fails_closed_when_tokenizer_is_missing() {
    let output = run_kernel(
        &[
            "build-retrieval-chunks-v2",
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
