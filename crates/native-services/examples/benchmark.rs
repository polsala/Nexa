//! Reproducible, generated local workloads. Run with --release, never debug timings.
use document_model::{Cell, Content, Document, TextNode};
use nexafile::Parts;
use serde_json::{Value, json};
use std::{sync::atomic::AtomicBool, time::Instant};

fn peak_kib() -> Option<u64> {
    std::fs::read_to_string("/proc/self/status")
        .ok()?
        .lines()
        .find_map(|line| {
            line.strip_prefix("VmHWM:")
                .and_then(|v| v.split_whitespace().next()?.parse().ok())
        })
}
fn fixture(kind: &str, size: usize) -> Result<Document, Box<dyn std::error::Error>> {
    let mut d = Document::new(kind, &format!("Benchmark {kind} {size}"))?;
    match &mut d.content {
        Content::Writer { body, .. } => {
            body.content.clear();
            for page in 0..size {
                let mut heading =
                    TextNode::block("heading", &format!("Project progress — page {}", page + 1));
                heading.attrs.insert("level".into(), json!(1));
                body.content.push(heading);
                for section in 0..6 {
                    body.content.push(TextNode::block("paragraph", &format!("Section {}. Our team prepares an independent review of local productivity workflows. Each document remains under the author's control, with clear ownership and a reliable recovery path. The report combines practical observations, measured outcomes and specific next steps. Unicode text such as català, español and café remains intact throughout every export. This paragraph belongs to page {} of the review.", section + 1, page + 1)));
                }
                if page + 1 < size {
                    body.content.push(TextNode {
                        kind: "paragraph".into(),
                        content: vec![TextNode {
                            kind: "pageBreak".into(),
                            ..Default::default()
                        }],
                        ..Default::default()
                    });
                }
            }
        }
        Content::Sheets { workbook } => {
            let sheet = &mut workbook.sheets[0];
            sheet.row_count = size.div_ceil(20).max(1000) as u32;
            sheet.column_count = 26;
            for i in 0..size {
                let row = (i / 20) as u32;
                let col = (i % 20) as u32;
                let formula = (col == 19).then(|| format!("=SUM(A{}:S{})", row + 1, row + 1));
                let value = if col == 19 {
                    (0..19).map(|c| (row * 20 + c) % 997).sum::<u32>() as f64 / 10.0
                } else {
                    (i % 997) as f64 / 10.0
                };
                sheet.cells.entry(row).or_default().insert(
                    col,
                    Cell {
                        value: json!(value),
                        formula,
                        ..Default::default()
                    },
                );
            }
        }
        Content::Slides { deck } => {
            deck.slides.clear();
            for i in 0..size {
                let mut slide = document_model::Slide::blank(&format!("Project update {}", i + 1));
                slide.notes = format!(
                    "Speaker notes for slide {}. Explain the measured results.",
                    i + 1
                );
                slide.objects.push(serde_json::from_value(json!({"id":format!("title-{i}"),"kind":"text","x":90,"y":80,"width":1000,"height":110,"fill":"transparent","stroke":"transparent","text":format!("A practical next step · {}",i+1),"fontSize":48,"bold":true}))?);
                slide.objects.push(serde_json::from_value(json!({"id":format!("body-{i}"),"kind":"text","x":90,"y":230,"width":900,"height":330,"fill":"transparent","stroke":"transparent","text":"A local-first workflow\nMeasured performance\nCareful compatibility\nReliable recovery","fontSize":30}))?);
                slide.objects.push(serde_json::from_value(json!({"id":format!("shape-{i}"),"kind":"rectangle","x":1060,"y":80,"width":100,"height":480,"fill":"#386b5a","stroke":"transparent"}))?);
                deck.slides.push(slide);
            }
        }
    }
    d.validate()?;
    Ok(d)
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::env::current_dir()?.join("artifacts/benchmarks");
    std::fs::create_dir_all(&root)?;
    let cancel = AtomicBool::new(false);
    let mut results: Vec<Value> = vec![];
    for (kind, sizes) in [
        ("writer", [1, 50, 300]),
        ("sheets", [1000, 100_000, 1_000_000]),
        ("slides", [10, 100, 300]),
    ] {
        for size in sizes {
            let d = fixture(kind, size)?;
            let path = root.join(format!(
                "{kind}-{size}.{}",
                match kind {
                    "writer" => "nxd",
                    "sheets" => "nxs",
                    _ => "nxp",
                }
            ));
            let start = Instant::now();
            let bytes = nexafile::encode(&d, &Parts::new(), &cancel)?;
            let encode_ms = start.elapsed().as_secs_f64() * 1000.0;
            let start = Instant::now();
            native_services::atomic_write(&path, &bytes)?;
            let write_ms = start.elapsed().as_secs_f64() * 1000.0;
            let bytes_len = bytes.len();
            drop(bytes);
            let start = Instant::now();
            let loaded = nexafile::decode(&std::fs::read(&path)?, &cancel)?;
            let open_ms = start.elapsed().as_secs_f64() * 1000.0;
            if loaded.document != d {
                return Err("Benchmark round trip changed the document".into());
            }
            let row = json!({"kind":kind,"size":size,"bytes":bytes_len,"encodeMs":encode_ms,"durableWriteMs":write_ms,"openMs":open_ms,"processHighWaterKiB":peak_kib()});
            println!("{row}");
            results.push(row);
        }
    }
    std::fs::write(
        root.join("results.json"),
        serde_json::to_vec_pretty(
            &json!({"version":env!("CARGO_PKG_VERSION"),"profile":"release","os":std::env::consts::OS,"arch":std::env::consts::ARCH,"note":"Single sequential run. High-water RSS is cumulative for this benchmark process, not application idle memory. Times exclude editor construction and formula recalculation.","results":results}),
        )?,
    )?;
    Ok(())
}
