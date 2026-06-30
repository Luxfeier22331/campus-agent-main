use std::io::{self, Read};

use ingestion_kernels_rs::{
    chunk_document_units_jsonl, validate_document_units_jsonl, validate_release_manifest_json,
};

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let Some(kernel_id) = args.next() else {
        return Err("ingestion kernel id is required".to_string());
    };
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .map_err(|error| format!("failed to read stdin: {error}"))?;
    let output = match kernel_id.as_str() {
        "validate-document-units" => serde_json::to_string(&validate_document_units_jsonl(&input)),
        "chunk-document-units" => {
            let max_chars = parse_chunk_max_chars(args)?;
            serde_json::to_string(&chunk_document_units_jsonl(&input, max_chars))
        }
        "validate-release-manifest" => {
            serde_json::to_string(&validate_release_manifest_json(&input))
        }
        _ => return Err(format!("unsupported ingestion kernel: {kernel_id}")),
    }
    .map_err(|error| format!("failed to serialize kernel output: {error}"))?;
    println!("{output}");
    Ok(())
}

fn parse_chunk_max_chars(mut args: impl Iterator<Item = String>) -> Result<usize, String> {
    let mut max_chars = 4000;
    while let Some(arg) = args.next() {
        if arg != "--max-chars" {
            return Err(format!("unsupported chunk-document-units argument: {arg}"));
        }
        let Some(value) = args.next() else {
            return Err("--max-chars requires a value".to_string());
        };
        max_chars = value
            .parse::<usize>()
            .map_err(|error| format!("--max-chars must be a positive integer: {error}"))?;
        if max_chars == 0 {
            return Err("--max-chars must be greater than zero".to_string());
        }
    }
    Ok(max_chars)
}
