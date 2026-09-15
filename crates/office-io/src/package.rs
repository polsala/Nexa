use super::OfficeError;
use nexafile::Parts;
use roxmltree::{Document, Node, ParsingOptions};
use std::collections::BTreeMap;
pub const REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
pub const A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
pub fn esc(s: &str) -> String {
    s.chars()
        .filter(|c| *c >= ' ' || matches!(c, '\n' | '\r' | '\t'))
        .collect::<String>()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
pub fn xml_bytes(bytes: &[u8]) -> Result<Document<'_>, OfficeError> {
    if bytes.len() > 128 * 1024 * 1024 {
        return Err(OfficeError::Xml("XML size limit exceeded".into()));
    }
    let s = std::str::from_utf8(bytes)
        .map_err(|_| OfficeError::Xml("Only UTF-8 OOXML is supported".into()))?;
    let d = Document::parse_with_options(
        s,
        ParsingOptions {
            allow_dtd: false,
            nodes_limit: 4_000_000,
            ..ParsingOptions::default()
        },
    )
    .map_err(|e| OfficeError::Xml(e.to_string()))?;
    if d.descendants().any(|n| n.ancestors().take(66).count() > 65) {
        return Err(OfficeError::Xml("XML depth limit exceeded".into()));
    }
    Ok(d)
}
pub fn xml<'a>(parts: &'a Parts, name: &str) -> Result<Document<'a>, OfficeError> {
    xml_bytes(
        parts
            .get(name)
            .ok_or_else(|| OfficeError::Missing(name.into()))?,
    )
}
pub fn attr<'a>(n: Node<'a, '_>, name: &str) -> &'a str {
    n.attributes()
        .find(|a| a.name() == name)
        .map_or("", |a| a.value())
}
pub fn child<'a, 'b>(n: Node<'a, 'b>, name: &str) -> Option<Node<'a, 'b>> {
    n.children()
        .find(|c| c.is_element() && c.tag_name().name() == name)
}
pub fn descendant<'a, 'b>(n: Node<'a, 'b>, name: &str) -> Option<Node<'a, 'b>> {
    n.descendants()
        .find(|c| c.is_element() && c.tag_name().name() == name)
}
pub fn text(n: Node<'_, '_>) -> String {
    n.descendants()
        .filter(|x| x.is_element() && x.tag_name().name() == "t")
        .filter_map(|x| x.text())
        .collect()
}
pub fn resolve(part: &str, target: &str) -> Result<String, OfficeError> {
    if target.contains('\\') || target.contains(':') {
        return Err(OfficeError::Missing("Unsafe relationship target".into()));
    }
    let mut path: Vec<&str> = if target.starts_with('/') {
        vec![]
    } else {
        let mut p: Vec<_> = part.split('/').collect();
        p.pop();
        p
    };
    for c in target.trim_start_matches('/').split('/') {
        match c {
            ".." => {
                if path.pop().is_none() {
                    return Err(OfficeError::Missing("Relationship escapes package".into()));
                }
            }
            "." | "" => {}
            _ => path.push(c),
        }
    }
    Ok(path.join("/"))
}
pub fn relationships(
    parts: &Parts,
    part: &str,
) -> Result<BTreeMap<String, (String, bool)>, OfficeError> {
    let (dir, name) = part.rsplit_once('/').unwrap_or(("", part));
    let relname = if dir.is_empty() {
        format!("_rels/{name}.rels")
    } else {
        format!("{dir}/_rels/{name}.rels")
    };
    if !parts.contains_key(&relname) {
        return Ok(BTreeMap::new());
    }
    let d = xml(parts, &relname)?;
    let mut out = BTreeMap::new();
    for n in d.descendants().filter(|n| n.has_tag_name("Relationship")) {
        let external = attr(n, "TargetMode") == "External";
        out.insert(
            attr(n, "Id").into(),
            (
                if external {
                    attr(n, "Target").into()
                } else {
                    resolve(part, attr(n, "Target"))?
                },
                external,
            ),
        );
    }
    Ok(out)
}
pub fn rels(entries: &[(String, String, String, bool)]) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">{}</Relationships>",
        entries
            .iter()
            .map(|(id, kind, target, external)| format!(
                "<Relationship Id=\"{}\" Type=\"{REL}/{}\" Target=\"{}\"{}/>",
                esc(id),
                esc(kind),
                esc(target),
                if *external {
                    " TargetMode=\"External\""
                } else {
                    ""
                }
            ))
            .collect::<String>()
    )
}
pub fn types(overrides: &[(&str, &str)]) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Default Extension=\"png\" ContentType=\"image/png\"/><Default Extension=\"jpg\" ContentType=\"image/jpeg\"/><Default Extension=\"jpeg\" ContentType=\"image/jpeg\"/><Default Extension=\"webp\" ContentType=\"image/webp\"/><Default Extension=\"zip\" ContentType=\"application/zip\"/><Default Extension=\"bin\" ContentType=\"application/octet-stream\"/>{}</Types>",
        overrides
            .iter()
            .map(|(n, t)| format!(
                "<Override PartName=\"/{}\" ContentType=\"{}\"/>",
                esc(n),
                esc(t)
            ))
            .collect::<String>()
    )
}
pub fn merge_content_types(parts: &mut Parts, source: &Parts) -> Result<(), OfficeError> {
    let Some(source_types) = source.get("[Content_Types].xml") else {
        return Ok(());
    };
    let src = xml_bytes(source_types)?;
    let dst = xml(parts, "[Content_Types].xml")?;
    let existing: std::collections::HashSet<_> = dst
        .descendants()
        .filter(|n| n.is_element())
        .map(|n| {
            (
                n.tag_name().name().to_string(),
                attr(
                    n,
                    if n.has_tag_name("Default") {
                        "Extension"
                    } else {
                        "PartName"
                    },
                )
                .to_string(),
            )
        })
        .collect();
    let mut extras = String::new();
    for n in src.root_element().children().filter(|n| n.is_element()) {
        let key = if n.has_tag_name("Default") {
            "Extension"
        } else {
            "PartName"
        };
        if !existing.contains(&(n.tag_name().name().into(), attr(n, key).into()))
            && !attr(n, "ContentType").to_lowercase().contains("vba")
        {
            extras.push_str(&format!(
                "<{} {}=\"{}\" ContentType=\"{}\"/>",
                n.tag_name().name(),
                key,
                esc(attr(n, key)),
                esc(attr(n, "ContentType"))
            ));
        }
    }
    let s = std::str::from_utf8(
        parts
            .get("[Content_Types].xml")
            .ok_or_else(|| OfficeError::Missing("Content types".into()))?,
    )
    .map_err(|e| OfficeError::Xml(e.to_string()))?
    .replace("</Types>", &format!("{extras}</Types>"));
    parts.insert("[Content_Types].xml".into(), s.into_bytes());
    Ok(())
}
pub fn put(parts: &mut Parts, name: &str, content: String) {
    parts.insert(name.into(), content.into_bytes());
}
pub fn image_data(parts: &Parts, path: &str) -> Option<String> {
    use base64::Engine;
    let data = parts.get(path)?;
    if nexafile::validate_image(data).is_err() {
        return None;
    }
    let mime = if path.to_lowercase().ends_with(".png") {
        "png"
    } else if path.to_lowercase().ends_with(".jpg") || path.to_lowercase().ends_with(".jpeg") {
        "jpeg"
    } else {
        return None;
    };
    Some(format!(
        "data:image/{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(data)
    ))
}
pub fn add_image(
    parts: &mut Parts,
    src: &str,
    prefix: &str,
    index: usize,
) -> Result<String, OfficeError> {
    use base64::Engine;
    let (header, data) = src
        .split_once(";base64,")
        .ok_or_else(|| OfficeError::Missing("Invalid embedded image".into()))?;
    let ext = match header {
        "data:image/png" => "png",
        "data:image/jpeg" => "jpg",
        "data:image/webp" => "webp",
        _ => return Err(OfficeError::Unsupported),
    };
    let path = format!("{prefix}/media/nexa-image-{index}.{ext}");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| OfficeError::Xml(e.to_string()))?;
    nexafile::validate_image(&bytes)?;
    parts.insert(path.clone(), bytes);
    Ok(path)
}
