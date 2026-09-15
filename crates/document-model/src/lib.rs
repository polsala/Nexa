//! Nexa's engine-independent document schema. All input is validated before persistence.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    time::{SystemTime, UNIX_EPOCH},
};
use thiserror::Error;
use uuid::Uuid;

pub type Properties = BTreeMap<String, Value>;
pub const SCHEMA_VERSION: u32 = 1;
pub const MAX_CELLS: usize = 2_000_000;

#[derive(Debug, Error)]
pub enum ModelError {
    #[error("This document uses a newer schema ({0}); open it with a newer Nexa version.")]
    FutureSchema(u32),
    #[error("Invalid document: {0}")]
    Invalid(String),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub schema_version: u32,
    pub id: Uuid,
    pub title: String,
    pub created_at: u64,
    pub modified_at: u64,
    #[serde(default)]
    pub revision: u64,
    pub content: Content,
    #[serde(default)]
    pub metadata: Properties,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery_draft: Option<CellDraft>,
    #[serde(default, flatten)]
    pub extra: Properties,
}

/// Recovery-only, engine-independent input. `content` keeps the committed cell.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CellDraft {
    pub version: u32,
    pub sheet_id: String,
    pub row: u32,
    pub column: u32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Content {
    Writer { body: TextNode, page: Page },
    Sheets { workbook: Workbook },
    Slides { deck: Deck },
}
impl<'de> Deserialize<'de> for Content {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        // Stream typed fields directly, instead of buffering a whole workbook
        // in serde's internally-tagged enum Content representation.
        #[derive(Deserialize)]
        struct Wire {
            kind: String,
            body: Option<TextNode>,
            page: Option<Page>,
            workbook: Option<Workbook>,
            deck: Option<Deck>,
        }
        let value = Wire::deserialize(deserializer)?;
        use serde::de::Error;
        match value.kind.as_str() {
            "writer" => Ok(Self::Writer {
                body: value.body.ok_or_else(|| D::Error::missing_field("body"))?,
                page: value.page.ok_or_else(|| D::Error::missing_field("page"))?,
            }),
            "sheets" => Ok(Self::Sheets {
                workbook: value
                    .workbook
                    .ok_or_else(|| D::Error::missing_field("workbook"))?,
            }),
            "slides" => Ok(Self::Slides {
                deck: value.deck.ok_or_else(|| D::Error::missing_field("deck"))?,
            }),
            _ => Err(D::Error::custom("Unknown content kind")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct TextNode {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub attrs: Properties,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub marks: Vec<Mark>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content: Vec<TextNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Mark {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub attrs: Properties,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub width: f64,
    pub height: f64,
    pub margins: [f64; 4],
    #[serde(default)]
    pub header: String,
    #[serde(default)]
    pub footer: String,
}
impl Default for Page {
    fn default() -> Self {
        Self {
            width: 794.0,
            height: 1123.0,
            margins: [76.0; 4],
            header: String::new(),
            footer: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Workbook {
    pub sheets: Vec<Worksheet>,
    #[serde(default)]
    pub charts: Vec<Chart>,
    /// Versioned editor extension resources (validation, conditional rules, defined names).
    #[serde(default)]
    pub extensions: Properties,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Worksheet {
    pub id: String,
    pub name: String,
    pub row_count: u32,
    pub column_count: u32,
    #[serde(default, deserialize_with = "deserialize_cells")]
    pub cells: BTreeMap<u32, BTreeMap<u32, Cell>>,
    #[serde(default)]
    pub merges: Vec<CellRange>,
    #[serde(default)]
    pub freeze: [u32; 2],
    #[serde(default, deserialize_with = "deserialize_indices")]
    pub row_dimensions: BTreeMap<u32, Value>,
    #[serde(default, deserialize_with = "deserialize_indices")]
    pub column_dimensions: BTreeMap<u32, Value>,
    #[serde(default)]
    pub extensions: Properties,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Cell {
    #[serde(default)]
    pub value: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub format: Properties,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rich_text: Option<Value>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extensions: Properties,
}

// Internally tagged enums deserialize through serde's intermediate Content
// representation. JSON object keys remain strings there (unlike a direct JSON
// map deserializer), so numeric sparse indices must be decoded explicitly.
fn parse_indices<T, E: serde::de::Error>(
    entries: BTreeMap<String, T>,
) -> Result<BTreeMap<u32, T>, E> {
    let mut out = BTreeMap::new();
    for (key, value) in entries {
        let index: u32 = key.parse().map_err(E::custom)?;
        if key != index.to_string() || out.insert(index, value).is_some() {
            return Err(E::custom("Noncanonical or duplicate grid index"));
        }
    }
    Ok(out)
}
fn deserialize_indices<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<BTreeMap<u32, T>, D::Error> {
    parse_indices(BTreeMap::<String, T>::deserialize(deserializer)?)
}
fn deserialize_cells<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<BTreeMap<u32, BTreeMap<u32, Cell>>, D::Error> {
    let rows = BTreeMap::<String, BTreeMap<String, Cell>>::deserialize(deserializer)?;
    let rows = rows
        .into_iter()
        .map(|(key, cells)| Ok((key, parse_indices::<_, D::Error>(cells)?)))
        .collect::<Result<BTreeMap<_, _>, D::Error>>()?;
    parse_indices(rows)
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CellRange {
    pub start_row: u32,
    pub end_row: u32,
    pub start_column: u32,
    pub end_column: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Chart {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub sheet_id: String,
    pub range: CellRange,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Deck {
    pub width: f64,
    pub height: f64,
    pub slides: Vec<Slide>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Slide {
    pub id: String,
    pub name: String,
    pub background: String,
    #[serde(default)]
    pub notes: String,
    pub objects: Vec<SlideObject>,
}
impl Slide {
    pub fn blank(name: &str) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            background: "#ffffff".into(),
            notes: String::new(),
            objects: vec![],
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SlideObject {
    pub id: String,
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub rotation: f64,
    pub fill: String,
    pub stroke: String,
    #[serde(default)]
    pub stroke_width: f64,
    #[serde(default)]
    pub text: String,
    #[serde(default = "default_font_size")]
    pub font_size: f64,
    #[serde(default = "default_font")]
    pub font_family: String,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    #[serde(default = "default_align")]
    pub align: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub src: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rich_text: Option<TextNode>,
}
fn default_font_size() -> f64 {
    28.0
}
fn default_font() -> String {
    "Arial".into()
}
fn default_color() -> String {
    "#182b29".into()
}
fn default_align() -> String {
    "left".into()
}
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

impl TextNode {
    pub fn text(text: &str) -> Self {
        Self {
            kind: "text".into(),
            text: Some(text.into()),
            ..Self::default()
        }
    }
    pub fn block(kind: &str, text: &str) -> Self {
        Self {
            kind: kind.into(),
            content: if text.is_empty() {
                vec![]
            } else {
                vec![Self {
                    kind: "text".into(),
                    text: Some(text.into()),
                    ..Self::default()
                }]
            },
            ..Self::default()
        }
    }
    pub fn plain_text(&self) -> String {
        if let Some(t) = &self.text {
            return t.clone();
        }
        self.content
            .iter()
            .map(Self::plain_text)
            .collect::<Vec<_>>()
            .join(
                if matches!(
                    self.kind.as_str(),
                    "doc" | "table" | "bulletList" | "orderedList"
                ) {
                    "\n"
                } else if self.kind == "tableRow" {
                    "\t"
                } else {
                    ""
                },
            )
    }
}
impl Worksheet {
    pub fn blank(name: &str) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.into(),
            row_count: 1000,
            column_count: 26,
            cells: BTreeMap::new(),
            merges: vec![],
            freeze: [0, 0],
            row_dimensions: BTreeMap::new(),
            column_dimensions: BTreeMap::new(),
            extensions: BTreeMap::new(),
        }
    }
}
impl Document {
    pub fn new(kind: &str, title: &str) -> Result<Self, ModelError> {
        let content = match kind {
            "writer" => Content::Writer {
                body: TextNode {
                    kind: "doc".into(),
                    content: vec![TextNode::block("paragraph", "")],
                    ..TextNode::default()
                },
                page: Page::default(),
            },
            "sheets" => Content::Sheets {
                workbook: Workbook {
                    sheets: vec![Worksheet::blank("Sheet 1")],
                    charts: vec![],
                    extensions: BTreeMap::new(),
                },
            },
            "slides" => Content::Slides {
                deck: Deck {
                    width: 1280.0,
                    height: 720.0,
                    slides: vec![Slide {
                        id: Uuid::new_v4().to_string(),
                        name: "Slide 1".into(),
                        background: "#ffffff".into(),
                        notes: String::new(),
                        objects: vec![],
                    }],
                },
            },
            _ => return Err(ModelError::Invalid("Unknown document type".into())),
        };
        Ok(Self {
            schema_version: SCHEMA_VERSION,
            id: Uuid::new_v4(),
            title: title.into(),
            created_at: now(),
            modified_at: now(),
            revision: 0,
            content,
            metadata: BTreeMap::new(),
            recovery_draft: None,
            extra: BTreeMap::new(),
        })
    }
    pub fn kind(&self) -> &'static str {
        match self.content {
            Content::Writer { .. } => "writer",
            Content::Sheets { .. } => "sheets",
            Content::Slides { .. } => "slides",
        }
    }
    pub fn extension(&self) -> &'static str {
        match self.content {
            Content::Writer { .. } => "nxd",
            Content::Sheets { .. } => "nxs",
            Content::Slides { .. } => "nxp",
        }
    }
    pub fn mime(&self) -> &'static str {
        match self.content {
            Content::Writer { .. } => "application/vnd.nexa.document",
            Content::Sheets { .. } => "application/vnd.nexa.spreadsheet",
            Content::Slides { .. } => "application/vnd.nexa.presentation",
        }
    }
    pub fn validate(&self) -> Result<(), ModelError> {
        let invalid = |s: &str| ModelError::Invalid(s.into());
        if self.schema_version > SCHEMA_VERSION {
            return Err(ModelError::FutureSchema(self.schema_version));
        }
        if self.schema_version != SCHEMA_VERSION || self.title.len() > 4096 {
            return Err(invalid("Invalid schema or title"));
        }
        if let Some(draft) = &self.recovery_draft {
            let Content::Sheets { workbook } = &self.content else {
                return Err(invalid("Cell draft requires a spreadsheet"));
            };
            if draft.version != 1
                || draft.text.len() > 1024 * 1024
                || !workbook.sheets.iter().any(|s| {
                    s.id == draft.sheet_id
                        && draft.row < s.row_count
                        && draft.column < s.column_count
                })
            {
                return Err(invalid("Invalid or oversized recovery cell input"));
            }
        }
        match &self.content {
            Content::Writer { body, page } => {
                if body.kind != "doc" {
                    return Err(invalid("Writer root must be a document"));
                }
                validate_node(body, 0)?;
                if ![page.width, page.height]
                    .iter()
                    .all(|n| n.is_finite() && *n >= 100.0 && *n <= 10_000.0)
                    || !page.margins.iter().all(|n| n.is_finite() && *n >= 0.0)
                    || page.margins[1] + page.margins[3] >= page.width
                    || page.margins[0] + page.margins[2] >= page.height
                {
                    return Err(invalid("Invalid page geometry"));
                }
            }
            Content::Sheets { workbook } => {
                if workbook.sheets.is_empty() || workbook.sheets.len() > 1024 {
                    return Err(invalid("Invalid worksheet count"));
                }
                let mut count = 0usize;
                let mut ids = std::collections::HashSet::new();
                let mut names = std::collections::HashSet::new();
                for s in &workbook.sheets {
                    if s.id.is_empty()
                        || !ids.insert(&s.id)
                        || s.name.is_empty()
                        || !names.insert(s.name.to_lowercase())
                    {
                        return Err(invalid("Duplicate or empty worksheet identity"));
                    }
                    if s.row_count == 0
                        || s.row_count > 1_048_576
                        || s.column_count == 0
                        || s.column_count > 16_384
                    {
                        return Err(invalid("Worksheet dimensions exceed limits"));
                    }
                    for (r, row) in &s.cells {
                        if *r >= s.row_count {
                            return Err(invalid("Cell outside worksheet"));
                        }
                        count += row.len();
                        for (c, cell) in row {
                            if *c >= s.column_count
                                || cell.value.is_object()
                                || cell.value.is_array()
                                || cell
                                    .formula
                                    .as_ref()
                                    .is_some_and(|f| f.len() > 32768 || !f.starts_with('='))
                            {
                                return Err(invalid("Invalid cell"));
                            }
                        }
                    }
                    for m in &s.merges {
                        if m.start_row > m.end_row
                            || m.start_column > m.end_column
                            || m.end_row >= s.row_count
                            || m.end_column >= s.column_count
                        {
                            return Err(invalid("Invalid merged range"));
                        }
                    }
                }
                if count > MAX_CELLS {
                    return Err(invalid(
                        "Workbook exceeds the supported populated-cell limit",
                    ));
                }
            }
            Content::Slides { deck } => {
                if deck.slides.is_empty()
                    || deck.slides.len() > 10_000
                    || ![deck.width, deck.height]
                        .iter()
                        .all(|n| n.is_finite() && *n > 0.0 && *n <= 20_000.0)
                {
                    return Err(invalid("Invalid slide deck geometry"));
                }
                for s in &deck.slides {
                    if s.objects.len() > 10_000 {
                        return Err(invalid("Too many slide objects"));
                    }
                    for o in &s.objects {
                        if ![o.x, o.y, o.width, o.height, o.rotation, o.font_size]
                            .iter()
                            .all(|n| n.is_finite() && n.abs() <= 100_000.0)
                            || o.width <= 0.0
                            || o.height <= 0.0
                        {
                            return Err(invalid("Invalid slide object geometry"));
                        }
                        if !["text", "rectangle", "ellipse", "line", "arrow", "image"]
                            .contains(&o.kind.as_str())
                        {
                            return Err(invalid("Unknown slide object kind"));
                        }
                        if o.src.as_ref().is_some_and(|s| !safe_image_url(s)) {
                            return Err(invalid("Unsafe image source"));
                        }
                        if let Some(rich) = &o.rich_text {
                            validate_node(rich, 0)?;
                        }
                    }
                }
            }
        }
        Ok(())
    }
}
pub fn safe_image_url(s: &str) -> bool {
    s.starts_with("data:image/png;base64,")
        || s.starts_with("data:image/jpeg;base64,")
        || s.starts_with("data:image/webp;base64,")
        || s.starts_with("asset://")
}
fn validate_node(node: &TextNode, depth: usize) -> Result<(), ModelError> {
    if depth > 48 {
        return Err(ModelError::Invalid("Text nesting exceeds 48 levels".into()));
    }
    if ![
        "doc",
        "paragraph",
        "heading",
        "text",
        "bulletList",
        "orderedList",
        "listItem",
        "blockquote",
        "codeBlock",
        "hardBreak",
        "horizontalRule",
        "pageBreak",
        "table",
        "tableRow",
        "tableCell",
        "tableHeader",
        "image",
    ]
    .contains(&node.kind.as_str())
    {
        return Err(ModelError::Invalid(format!(
            "Unsupported text node {}",
            node.kind
        )));
    }
    if node.kind == "image"
        && node
            .attrs
            .get("src")
            .and_then(Value::as_str)
            .is_none_or(|s| !safe_image_url(s))
    {
        return Err(ModelError::Invalid("Unsafe image source".into()));
    }
    for mark in &node.marks {
        if mark.kind == "link"
            && mark
                .attrs
                .get("href")
                .and_then(Value::as_str)
                .is_some_and(|s| {
                    !s.starts_with("https://")
                        && !s.starts_with("http://")
                        && !s.starts_with("mailto:")
                        && !s.starts_with('#')
                })
        {
            return Err(ModelError::Invalid("Unsafe hyperlink".into()));
        }
    }
    for child in &node.content {
        validate_node(child, depth + 1)?;
    }
    Ok(())
}

/// v0 development files have an explicit, one-way migration. Unknown newer versions are read-blocked.
pub fn migrate(mut value: Value) -> Result<Document, ModelError> {
    if value.get("schemaVersion").and_then(Value::as_u64) == Some(0) {
        value["schemaVersion"] = json!(1);
        if value.get("revision").is_none() {
            value["revision"] = json!(0);
        }
    }
    let doc: Document = serde_json::from_value(value)?;
    doc.validate()?;
    Ok(doc)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migrate_and_preserve_future_fields() -> Result<(), ModelError> {
        let d = Document::new("writer", "Test")?;
        let mut v = serde_json::to_value(d)?;
        v["schemaVersion"] = json!(0);
        v["futureField"] = json!({"safe":true});
        let d = migrate(v)?;
        assert_eq!(d.schema_version, 1);
        assert!(d.extra.contains_key("futureField"));
        Ok(())
    }
    #[test]
    fn reject_unsafe_images_and_future_versions() -> Result<(), ModelError> {
        let mut d = Document::new("writer", "Test")?;
        d.schema_version = 999;
        assert!(d.validate().is_err());
        assert!(!safe_image_url("file:///etc/passwd"));
        assert!(!safe_image_url("data:image/svg+xml,<svg/>"));
        Ok(())
    }
    #[test]
    fn validate_recovery_draft_bounds_and_kind() -> Result<(), ModelError> {
        let mut d = Document::new("sheets", "Draft")?;
        let Content::Sheets { workbook } = &d.content else {
            return Err(ModelError::Invalid("Wrong fixture kind".into()));
        };
        let sheet = &workbook.sheets[0];
        let draft = CellDraft {
            version: 1,
            sheet_id: sheet.id.clone(),
            row: 0,
            column: 0,
            text: "=SUM(A1:".into(),
        };
        d.recovery_draft = Some(draft.clone());
        d.validate()?;
        d.recovery_draft = Some(CellDraft {
            row: 1_048_576,
            ..draft.clone()
        });
        assert!(d.validate().is_err());
        d.recovery_draft = Some(CellDraft {
            text: "x".repeat(1024 * 1024 + 1),
            ..draft.clone()
        });
        assert!(d.validate().is_err());
        d.recovery_draft = Some(CellDraft {
            version: 2,
            ..draft.clone()
        });
        assert!(d.validate().is_err());
        let mut writer = Document::new("writer", "Not a sheet")?;
        writer.recovery_draft = Some(draft);
        assert!(writer.validate().is_err());
        Ok(())
    }
}
