use serde_json::Value;
use std::{path::PathBuf, sync::atomic::AtomicBool};
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
#[test]
fn committed_office_fixtures_and_normalized_goldens() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests");
    let cancel = AtomicBool::new(false);
    for ext in ["docx", "xlsx", "pptx"] {
        let bytes = std::fs::read(root.join(format!("fixtures/{ext}/semantic.{ext}")))?;
        let imported = office_io::import(&bytes, ext, "Fixture", &cancel)?;
        let golden: Value =
            serde_json::from_slice(&std::fs::read(root.join(format!("golden/{ext}.json")))?)?;
        let mut model = serde_json::to_value(&imported.document.content)?;
        normalize(&mut model);
        assert_eq!(model, golden, "import {ext}");
        // No-edit export preserves all original package parts byte for byte.
        let unchanged = office_io::export(&imported.document, ext, &imported.preserved, &cancel)?;
        assert_eq!(
            nexafile::read_zip(&bytes, &cancel)?,
            nexafile::read_zip(&unchanged, &cancel)?
        );
        // Rebuild supported content from our model, not the original package shortcut.
        let rebuilt = office_io::export(&imported.document, ext, &nexafile::Parts::new(), &cancel)?;
        let reopened = office_io::import(&rebuilt, ext, "Fixture", &cancel)?;
        let mut roundtrip = serde_json::to_value(reopened.document.content)?;
        normalize(&mut roundtrip);
        assert_eq!(roundtrip, golden, "rebuilt {ext}");
    }
    Ok(())
}
