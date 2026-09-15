use crate::{OfficeError, package::*};
use document_model::TextNode;
use nexafile::Parts;
use serde_json::json;
use std::collections::BTreeMap;

pub type Numbering = BTreeMap<(String, u8), (bool, u32)>;
pub fn read(parts: &Parts) -> Result<Numbering, OfficeError> {
    if !parts.contains_key("word/numbering.xml") {
        return Ok(BTreeMap::new());
    }
    let doc = xml(parts, "word/numbering.xml")?;
    let mut definitions = BTreeMap::new();
    for n in doc
        .descendants()
        .filter(|n| n.tag_name().name() == "abstractNum")
    {
        for level in n.children().filter(|n| n.tag_name().name() == "lvl") {
            let depth = attr(level, "ilvl").parse::<u8>().unwrap_or(0).min(8);
            let ordered = child(level, "numFmt").is_some_and(|f| attr(f, "val") != "bullet");
            let start = child(level, "start")
                .and_then(|f| attr(f, "val").parse::<u32>().ok())
                .unwrap_or(1)
                .max(1);
            definitions.insert(
                (attr(n, "abstractNumId").to_owned(), depth),
                (ordered, start),
            );
        }
    }
    let mut result = BTreeMap::new();
    for n in doc.descendants().filter(|n| n.tag_name().name() == "num") {
        let Some(reference) = child(n, "abstractNumId") else {
            continue;
        };
        for depth in 0..9 {
            if let Some(definition) = definitions.get(&(attr(reference, "val").to_owned(), depth)) {
                let mut definition = *definition;
                if let Some(override_node) = n.children().find(|l| {
                    l.tag_name().name() == "lvlOverride"
                        && attr(*l, "ilvl").parse::<u8>().ok() == Some(depth)
                }) && let Some(start) = child(override_node, "startOverride")
                    .and_then(|s| attr(s, "val").parse::<u32>().ok())
                {
                    definition.1 = start.max(1);
                }
                result.insert((attr(n, "numId").to_owned(), depth), definition);
            }
        }
    }
    Ok(result)
}
pub fn append(
    out: &mut Vec<TextNode>,
    paragraph: TextNode,
    depth: u8,
    ordered: bool,
    start: u32,
    continuation: bool,
) {
    if depth > 0
        && let Some(parent) = out
            .last_mut()
            .filter(|n| matches!(n.kind.as_str(), "bulletList" | "orderedList"))
        && let Some(item) = parent.content.last_mut()
    {
        append(
            &mut item.content,
            paragraph,
            depth - 1,
            ordered,
            start,
            continuation,
        );
        return;
    }
    let kind = if ordered { "orderedList" } else { "bulletList" };
    let item = TextNode {
        kind: "listItem".into(),
        content: vec![paragraph],
        ..Default::default()
    };
    if continuation && let Some(list) = out.last_mut().filter(|n| n.kind == kind) {
        list.content.push(item);
    } else {
        let attrs = if ordered {
            [("start".into(), json!(start))].into()
        } else {
            BTreeMap::new()
        };
        out.push(TextNode {
            kind: kind.into(),
            attrs,
            content: vec![item],
            ..Default::default()
        });
    }
}
pub fn write(definitions: &[(u32, bool, u32)]) -> String {
    let mut abstracts = String::new();
    let mut instances = String::new();
    for (id, ordered, start) in definitions {
        let mut levels = String::new();
        for i in 0..9 {
            let format = if *ordered { "decimal" } else { "bullet" };
            let label = if *ordered {
                format!("%{}.", i + 1)
            } else {
                "•".into()
            };
            levels.push_str(&format!("<w:lvl w:ilvl=\"{i}\"><w:start w:val=\"{start}\"/><w:numFmt w:val=\"{format}\"/><w:lvlText w:val=\"{label}\"/><w:lvlJc w:val=\"left\"/><w:pPr><w:ind w:left=\"{}\" w:hanging=\"360\"/></w:pPr></w:lvl>", (i + 1) * 720));
        }
        abstracts.push_str(&format!(
            "<w:abstractNum w:abstractNumId=\"{id}\">{levels}</w:abstractNum>"
        ));
        instances.push_str(&format!(
            "<w:num w:numId=\"{id}\"><w:abstractNumId w:val=\"{id}\"/></w:num>"
        ));
    }
    format!(
        "<w:numbering xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">{abstracts}{instances}</w:numbering>"
    )
}
