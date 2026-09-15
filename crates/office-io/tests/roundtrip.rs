use document_model::{Cell, Content, Document, TextNode};
use nexafile::Parts;
use serde_json::json;
use std::sync::atomic::AtomicBool;

#[test]
fn unresolved_recovery_input_is_not_silently_dropped_by_export()
-> Result<(), Box<dyn std::error::Error>> {
    let mut d = Document::new("sheets", "Recovered input")?;
    if let Content::Sheets { workbook } = &d.content {
        d.recovery_draft = Some(document_model::CellDraft {
            version: 1,
            sheet_id: workbook.sheets[0].id.clone(),
            row: 0,
            column: 0,
            text: "=SUM(".into(),
        });
    }
    for ext in ["xlsx", "csv", "tsv"] {
        assert!(matches!(
            office_io::export(&d, ext, &Parts::new(), &AtomicBool::new(false)),
            Err(office_io::OfficeError::UnresolvedDraft)
        ));
    }
    Ok(())
}

#[test]
fn writer_table_unicode_round_trip() -> Result<(), Box<dyn std::error::Error>> {
    let mut d = Document::new("writer", "Carta")?;
    if let Content::Writer { body, .. } = &mut d.content {
        body.content = vec![
            TextNode::block("heading", "Bon dia, món — Español"),
            serde_json::from_value(
                json!({"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"A&B <1>"}]}]}]}]}),
            )?,
        ];
    }
    let c = AtomicBool::new(false);
    let bytes = office_io::export(&d, "docx", &Parts::new(), &c)?;
    let loaded = office_io::import(&bytes, "docx", "Carta", &c)?;
    let Content::Writer { body, .. } = loaded.document.content else {
        panic!("Wrong kind")
    };
    assert!(body.plain_text().contains("Bon dia, món"));
    assert!(body.plain_text().contains("A&B <1>"));
    Ok(())
}
#[test]
fn workbook_formulas_formats_multiple_sheets() -> Result<(), Box<dyn std::error::Error>> {
    let mut d = Document::new("sheets", "Budget")?;
    if let Content::Sheets { workbook } = &mut d.content {
        workbook.sheets[0].cells.entry(0).or_default().insert(
            0,
            Cell {
                value: json!(42.5),
                formula: Some("=SUM(40,2.5)".into()),
                format: std::collections::BTreeMap::from([
                    ("bold".into(), json!(true)),
                    ("numberFormat".into(), json!("0.00")),
                ]),
                ..Cell::default()
            },
        );
        workbook
            .sheets
            .push(document_model::Worksheet::blank("Data"));
    }
    let c = AtomicBool::new(false);
    let bytes = office_io::export(&d, "xlsx", &Parts::new(), &c)?;
    let loaded = office_io::import(&bytes, "xlsx", "Budget", &c)?;
    let Content::Sheets { workbook } = loaded.document.content else {
        panic!("Wrong kind")
    };
    assert_eq!(workbook.sheets.len(), 2);
    let cell = &workbook.sheets[0].cells[&0][&0];
    assert_eq!(cell.formula.as_deref(), Some("=SUM(40,2.5)"));
    assert_eq!(cell.value, json!(42.5));
    assert_eq!(cell.format.get("bold"), Some(&json!(true)));
    Ok(())
}
#[test]
fn slides_objects_notes_round_trip() -> Result<(), Box<dyn std::error::Error>> {
    let mut d = Document::new("slides", "Pitch")?;
    if let Content::Slides { deck } = &mut d.content {
        deck.slides[0].notes = "Remember the demo".into();
        deck.slides[0].objects.push(serde_json::from_value(json!({"id":"t1","kind":"text","x":40,"y":50,"width":600,"height":100,"fill":"transparent","stroke":"transparent","text":"Hello slides","fontSize":42}))?);
    }
    let c = AtomicBool::new(false);
    let bytes = office_io::export(&d, "pptx", &Parts::new(), &c)?;
    let loaded = office_io::import(&bytes, "pptx", "Pitch", &c)?;
    let Content::Slides { deck } = loaded.document.content else {
        panic!("Wrong kind")
    };
    assert_eq!(deck.slides[0].objects[0].text, "Hello slides");
    assert_eq!(deck.slides[0].notes, "Remember the demo");
    assert_eq!(deck.slides[0].objects[0].font_size, 42.0);
    Ok(())
}
#[test]
fn rejects_entity_expansion() -> Result<(), Box<dyn std::error::Error>> {
    let c = AtomicBool::new(false);
    let p = Parts::from([(
        "word/document.xml".into(),
        b"<!DOCTYPE x [<!ENTITY a SYSTEM 'file:///etc/passwd'>]><x>&a;</x>".to_vec(),
    )]);
    assert!(office_io::import(&nexafile::write_zip(&p, &c)?, "docx", "Unsafe", &c).is_err());
    Ok(())
}
#[test]
fn csv_formula_injection_and_quotes() -> Result<(), Box<dyn std::error::Error>> {
    let c = AtomicBool::new(false);
    let d = office_io::import(b"name,value\n\"a,b\",=DANGEROUS()\n", "csv", "Data", &c)?;
    let out = office_io::export(&d.document, "csv", &Parts::new(), &c)?;
    assert!(String::from_utf8(out)?.contains("'=DANGEROUS()"));
    Ok(())
}
#[test]
fn ordered_lists_keep_start_and_nested_bullets() -> Result<(), Box<dyn std::error::Error>> {
    let mut d = Document::new("writer", "Lists")?;
    if let Content::Writer { body, .. } = &mut d.content {
        *body = serde_json::from_value(
            json!({"type":"doc","content":[{"type":"orderedList","attrs":{"start":3},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"First"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Nested"}]}]}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Second"}]}]}]}]}),
        )?;
    }
    let cancel = AtomicBool::new(false);
    let bytes = office_io::export(&d, "docx", &Parts::new(), &cancel)?;
    let reopened = office_io::import(&bytes, "docx", "Lists", &cancel)?;
    let Content::Writer { body, .. } = reopened.document.content else {
        panic!("Wrong kind");
    };
    assert_eq!(body.content[0].kind, "orderedList");
    assert_eq!(body.content[0].attrs.get("start"), Some(&json!(3)));
    assert_eq!(body.content[0].content.len(), 2);
    assert_eq!(body.content[0].content[0].content[1].kind, "bulletList");
    assert!(
        body.content[0].content[0].content[1]
            .plain_text()
            .contains("Nested")
    );
    Ok(())
}
#[test]
fn edited_office_exports_preserve_earlier_source_archives() -> Result<(), Box<dyn std::error::Error>>
{
    let cancel = AtomicBool::new(false);
    let mut d = Document::new("writer", "Preservation")?;
    let mut source = nexafile::read_zip(
        &office_io::export(&d, "docx", &Parts::new(), &cancel)?,
        &cancel,
    )?;
    source.insert("nexa/original.zip".into(), b"earlier source bytes".to_vec());
    d.title = "Edited".into();
    let output = office_io::export(&d, "docx", &source, &cancel)?;
    let package = nexafile::read_zip(&output, &cancel)?;
    let preserved = nexafile::read_zip(&package["nexa/original.zip"], &cancel)?;
    assert_eq!(preserved["nexa/original.zip"], b"earlier source bytes");
    Ok(())
}
