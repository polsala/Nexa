//! Generate owned, editable semantic fixtures and normalized golden snapshots.
use document_model::{Cell, Content, Document, TextNode};
use nexafile::Parts;
use serde_json::{Value, json};
use std::{path::Path, sync::atomic::AtomicBool};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = Path::new("tests/fixtures");
    std::fs::create_dir_all("tests/golden")?;
    let cancel = AtomicBool::new(false);
    for (kind, ext) in [("writer", "docx"), ("sheets", "xlsx"), ("slides", "pptx")] {
        let mut d = Document::new(kind, "Nexa semantic fixture")?;
        match &mut d.content {
            Content::Writer { body, page } => {
                body.content = vec![
                    TextNode {
                        kind: "heading".into(),
                        attrs: [("level".into(), json!(1))].into(),
                        content: vec![TextNode::text("A local document — català, español")],
                        ..Default::default()
                    },
                    TextNode::block(
                        "paragraph",
                        "A&B <C> remains readable, including café and Ελληνικά.",
                    ),
                    serde_json::from_value(
                        json!({"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"Budget"}]}]},{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"120.50"}]}]}]}]}),
                    )?,
                ];
                page.header = "Confidential draft".into();
                page.footer = "Nexa fixture".into();
            }
            Content::Sheets { workbook } => {
                for (row, value) in [(0, 12.5), (1, 20.0), (2, 32.5)] {
                    workbook.sheets[0].cells.entry(row).or_default().insert(
                        0,
                        Cell {
                            value: json!(value),
                            formula: (row == 2).then(|| "=SUM(A1:A2)".into()),
                            format: [("numberFormat".into(), json!("0.00"))].into(),
                            ..Default::default()
                        },
                    );
                }
                workbook.sheets[0].freeze = [1, 0];
                workbook
                    .sheets
                    .push(document_model::Worksheet::blank("Résumé"));
            }
            Content::Slides { deck } => {
                deck.slides[0].objects.push(serde_json::from_value(json!({"id":"title","kind":"text","text":"An independent presentation","x":80,"y":100,"width":1000,"height":200,"fontSize":42,"fill":"transparent","stroke":"transparent"}))?);
                deck.slides[0].notes = "Explain the real workflow, not a mockup.".into();
                deck.slides
                    .push(document_model::Slide::blank("The next step"));
            }
        }
        let bytes = office_io::export(&d, ext, &Parts::new(), &cancel)?;
        // Disposable native inputs for the real desktop save/reopen smoke test.
        std::fs::create_dir_all("artifacts/native-inputs")?;
        d.title = format!("Native {kind}");
        std::fs::write(
            format!("artifacts/native-inputs/{kind}.{}", d.extension()),
            nexafile::encode(&d, &Parts::new(), &cancel)?,
        )?;
        std::fs::create_dir_all(root.join(ext))?;
        std::fs::write(root.join(ext).join(format!("semantic.{ext}")), &bytes)?;
        let imported = office_io::import(&bytes, ext, "Fixture", &cancel)?;
        let mut model = serde_json::to_value(&imported.document.content)?;
        fn normalize(v: &mut Value) {
            match v {
                Value::Object(m) => {
                    m.remove("id");
                    for child in m.values_mut() {
                        normalize(child);
                    }
                }
                Value::Array(a) => {
                    for child in a {
                        normalize(child);
                    }
                }
                _ => {}
            }
        }
        normalize(&mut model);
        std::fs::write(
            format!("tests/golden/{ext}.json"),
            serde_json::to_vec_pretty(&model)?,
        )?;
        println!("Generated {ext} semantic fixture ({} bytes)", bytes.len());
    }
    Ok(())
}
