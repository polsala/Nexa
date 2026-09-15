use super::{OfficeError, package::*};
use document_model::{Content, Document, Mark, TextNode};
use nexafile::Parts;
use roxmltree::Node;
use serde_json::{Value, json};
use std::collections::BTreeMap;
const W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

pub fn import(parts: &Parts, title: &str) -> Result<Document, OfficeError> {
    let d = xml(parts, "word/document.xml")?;
    let body = d
        .descendants()
        .find(|n| n.tag_name().name() == "body")
        .ok_or_else(|| OfficeError::Missing("Document body".into()))?;
    let relationships = relationships(parts, "word/document.xml")?;
    let numbering = super::writer_lists::read(parts)?;
    let mut doc = Document::new("writer", title)?;
    if let Content::Writer { body: out, page } = &mut doc.content {
        out.content = blocks(body, parts, &relationships, &numbering);
        if out.content.is_empty() {
            out.content.push(TextNode::block("paragraph", ""));
        }
        if let Some(size) = descendant(body, "pgSz") {
            page.width = attr(size, "w").parse::<f64>().unwrap_or(11910.0) / 15.0;
            page.height = attr(size, "h").parse::<f64>().unwrap_or(16845.0) / 15.0;
        }
        if let Some(m) = descendant(body, "pgMar") {
            for (i, k) in ["top", "right", "bottom", "left"].iter().enumerate() {
                page.margins[i] = attr(m, k).parse::<f64>().unwrap_or(1140.0) / 15.0;
            }
        }
        for (key, field) in [
            ("word/header1.xml", &mut page.header),
            ("word/footer1.xml", &mut page.footer),
        ] {
            if let Ok(d) = xml(parts, key) {
                *field = text(d.root_element());
            }
        }
    }
    Ok(doc)
}
fn blocks(
    parent: Node<'_, '_>,
    parts: &Parts,
    rels: &BTreeMap<String, (String, bool)>,
    numbering: &super::writer_lists::Numbering,
) -> Vec<TextNode> {
    let mut out = vec![];
    let mut active_numbers: Vec<String> = Vec::new();
    for n in parent.children().filter(|n| n.is_element()) {
        match n.tag_name().name() {
            "p" => {
                let mut p = TextNode::block("paragraph", "");
                if let Some(pr) = child(n, "pPr") {
                    if let Some(s) = child(pr, "pStyle") {
                        let v = attr(s, "val").to_lowercase();
                        if let Some(level) =
                            v.strip_prefix("heading").and_then(|v| v.parse::<u8>().ok())
                        {
                            p.kind = "heading".into();
                            p.attrs.insert("level".into(), json!(level.clamp(1, 6)));
                        }
                    }
                    if let Some(j) = child(pr, "jc") {
                        p.attrs.insert(
                            "textAlign".into(),
                            json!(if attr(j, "val") == "both" {
                                "justify"
                            } else {
                                attr(j, "val")
                            }),
                        );
                    }
                    if let Some(j) = child(pr, "ind") {
                        p.attrs.insert(
                            "indent".into(),
                            json!(attr(j, "left").parse::<f64>().unwrap_or(0.0) / 720.0),
                        );
                    }
                    if let Some(j) = child(pr, "spacing") {
                        p.attrs.insert(
                            "spaceAfter".into(),
                            json!(attr(j, "after").parse::<f64>().unwrap_or(160.0) / 20.0),
                        );
                        p.attrs.insert(
                            "lineHeight".into(),
                            json!(attr(j, "line").parse::<f64>().unwrap_or(276.0) / 240.0),
                        );
                    }
                }
                p.content = inline(n, parts, rels, &[]);
                if let Some(num) = descendant(n, "numPr") {
                    let id = child(num, "numId").map(|n| attr(n, "val")).unwrap_or("0");
                    let depth = child(num, "ilvl")
                        .and_then(|n| attr(n, "val").parse::<u8>().ok())
                        .unwrap_or(0)
                        .min(8);
                    let (ordered, start) = numbering
                        .get(&(id.to_owned(), depth))
                        .copied()
                        .unwrap_or((false, 1));
                    let continuation = active_numbers
                        .get(usize::from(depth))
                        .is_some_and(|last| last == id);
                    active_numbers.resize(usize::from(depth) + 1, String::new());
                    active_numbers[usize::from(depth)] = id.to_owned();
                    super::writer_lists::append(&mut out, p, depth, ordered, start, continuation);
                } else {
                    active_numbers.clear();
                    out.push(p);
                }
            }
            "tbl" => {
                let rows = n
                    .children()
                    .filter(|n| n.tag_name().name() == "tr")
                    .map(|r| TextNode {
                        kind: "tableRow".into(),
                        content: r
                            .children()
                            .filter(|n| n.tag_name().name() == "tc")
                            .map(|c| {
                                let mut children = blocks(c, parts, rels, numbering);
                                if children.is_empty() {
                                    children.push(TextNode::block("paragraph", ""));
                                }
                                TextNode {
                                    kind: "tableCell".into(),
                                    attrs: BTreeMap::from([
                                        (
                                            "colspan".into(),
                                            json!(descendant(c, "gridSpan").map_or(1, |n| {
                                                attr(n, "val").parse::<u32>().unwrap_or(1)
                                            })),
                                        ),
                                        ("rowspan".into(), json!(1)),
                                    ]),
                                    content: children,
                                    ..TextNode::default()
                                }
                            })
                            .collect(),
                        ..TextNode::default()
                    })
                    .collect();
                out.push(TextNode {
                    kind: "table".into(),
                    content: rows,
                    ..TextNode::default()
                });
            }
            "sdt" | "sdtContent" => out.extend(blocks(n, parts, rels, numbering)),
            _ => {}
        }
    }
    out
}
fn inline(
    n: Node<'_, '_>,
    parts: &Parts,
    rels: &BTreeMap<String, (String, bool)>,
    inherited: &[Mark],
) -> Vec<TextNode> {
    let mut out = vec![];
    for c in n.children().filter(|n| n.is_element()) {
        match c.tag_name().name() {
            "r" => {
                let mut marks = inherited.to_vec();
                if let Some(pr) = child(c, "rPr") {
                    for (tag, kind) in [
                        ("b", "bold"),
                        ("i", "italic"),
                        ("u", "underline"),
                        ("strike", "strike"),
                    ] {
                        if child(pr, tag)
                            .is_some_and(|n| !matches!(attr(n, "val"), "0" | "false" | "none"))
                        {
                            marks.push(Mark {
                                kind: kind.into(),
                                attrs: BTreeMap::new(),
                            });
                        }
                    }
                    let mut style = BTreeMap::new();
                    if let Some(s) = child(pr, "rFonts") {
                        style.insert("fontFamily".into(), json!(attr(s, "ascii")));
                    }
                    if let Some(s) = child(pr, "sz") {
                        style.insert(
                            "fontSize".into(),
                            json!(format!(
                                "{}pt",
                                attr(s, "val").parse::<f64>().unwrap_or(24.0) / 2.0
                            )),
                        );
                    }
                    if let Some(s) = child(pr, "color")
                        && attr(s, "val") != "auto"
                    {
                        style.insert("color".into(), json!(format!("#{}", attr(s, "val"))));
                    }
                    if !style.is_empty() {
                        marks.push(Mark {
                            kind: "textStyle".into(),
                            attrs: style,
                        });
                    }
                    if let Some(s) = child(pr, "highlight") {
                        let color = if attr(s, "val") == "yellow" {
                            "#ffff00"
                        } else {
                            "#fef08a"
                        };
                        marks.push(Mark {
                            kind: "highlight".into(),
                            attrs: BTreeMap::from([("color".into(), json!(color))]),
                        });
                    }
                    if let Some(s) = child(pr, "vertAlign") {
                        marks.push(Mark {
                            kind: if attr(s, "val") == "superscript" {
                                "superscript"
                            } else {
                                "subscript"
                            }
                            .into(),
                            attrs: BTreeMap::new(),
                        });
                    }
                }
                out.extend(inline(c, parts, rels, &marks));
            }
            "t" => {
                if let Some(t) = c.text()
                    && !t.is_empty()
                {
                    out.push(TextNode {
                        kind: "text".into(),
                        text: Some(t.into()),
                        marks: inherited.to_vec(),
                        ..TextNode::default()
                    });
                }
            }
            "tab" => out.push(TextNode {
                kind: "text".into(),
                text: Some("\t".into()),
                marks: inherited.to_vec(),
                ..TextNode::default()
            }),
            "br" => out.push(TextNode {
                kind: if attr(c, "type") == "page" {
                    "pageBreak"
                } else {
                    "hardBreak"
                }
                .into(),
                ..TextNode::default()
            }),
            "hyperlink" => {
                let mut marks = inherited.to_vec();
                if let Some((target, true)) = rels.get(attr(c, "id"))
                    && (target.starts_with("http://")
                        || target.starts_with("https://")
                        || target.starts_with("mailto:"))
                {
                    marks.push(Mark {
                        kind: "link".into(),
                        attrs: BTreeMap::from([("href".into(), json!(target))]),
                    });
                }
                out.extend(inline(c, parts, rels, &marks));
            }
            "drawing" => {
                if let Some(blip) = descendant(c, "blip")
                    && let Some((path, false)) = rels.get(attr(blip, "embed"))
                    && let Some(src) = image_data(parts, path)
                {
                    let mut attrs =
                        BTreeMap::from([("src".into(), json!(src)), ("alt".into(), json!(""))]);
                    if let Some(ext) = descendant(c, "extent") {
                        attrs.insert(
                            "width".into(),
                            json!(attr(ext, "cx").parse::<f64>().unwrap_or(2_857_500.0) / 9525.0),
                        );
                        attrs.insert(
                            "height".into(),
                            json!(attr(ext, "cy").parse::<f64>().unwrap_or(1_905_000.0) / 9525.0),
                        );
                    }
                    out.push(TextNode {
                        kind: "image".into(),
                        attrs,
                        ..TextNode::default()
                    });
                }
            }
            _ => {}
        }
    }
    out
}
struct Writer {
    parts: Parts,
    rels: Vec<(String, String, String, bool)>,
    image: usize,
    numbering: Vec<(u32, bool, u32)>,
}
impl Writer {
    fn node(&mut self, n: &TextNode, level: usize, num_id: u32) -> Result<String, OfficeError> {
        match n.kind.as_str(){
            "doc"|"blockquote"=>n.content.iter().map(|c|self.node(c,level,num_id)).collect::<Result<String,_>>(),
            "paragraph"|"heading"|"codeBlock"=>{
                let mut props=String::new();if n.kind=="heading"{props.push_str(&format!("<w:pStyle w:val=\"Heading{}\"/>",n.attrs.get("level").and_then(Value::as_u64).unwrap_or(1)));}
                if level>0{props.push_str(&format!("<w:numPr><w:ilvl w:val=\"{}\"/><w:numId w:val=\"{num_id}\"/></w:numPr>",(level-1).min(8)));}
                if let Some(v)=n.attrs.get("textAlign").and_then(Value::as_str){props.push_str(&format!("<w:jc w:val=\"{}\"/>",esc(if v=="justify"{"both"}else{v})));}
                if let Some(v)=n.attrs.get("indent").and_then(Value::as_f64){props.push_str(&format!("<w:ind w:left=\"{}\"/>",(v*720.0)as i64));}
                props.push_str(&format!("<w:spacing w:after=\"{}\" w:line=\"{}\" w:lineRule=\"auto\"/>",(n.attrs.get("spaceAfter").and_then(Value::as_f64).unwrap_or(8.0)*20.0)as u32,(n.attrs.get("lineHeight").and_then(Value::as_f64).unwrap_or(1.5)*240.0)as u32));
                let content=n.content.iter().map(|c|self.node(c,0,0)).collect::<Result<String,_>>()?;Ok(format!("<w:p><w:pPr>{props}</w:pPr>{content}</w:p>"))
            },
            "text"=>{let mut props=String::new();let mut href=None;for m in &n.marks{match m.kind.as_str(){"bold"=>props.push_str("<w:b/>"),"italic"=>props.push_str("<w:i/>"),"underline"=>props.push_str("<w:u w:val=\"single\"/>"),"strike"=>props.push_str("<w:strike/>"),"superscript"|"subscript"=>props.push_str(&format!("<w:vertAlign w:val=\"{}\"/>",m.kind)),"highlight"=>props.push_str("<w:highlight w:val=\"yellow\"/>"),"link"=>href=m.attrs.get("href").and_then(Value::as_str),"textStyle"=>{if let Some(v)=m.attrs.get("fontFamily").and_then(Value::as_str){props.push_str(&format!("<w:rFonts w:ascii=\"{}\" w:hAnsi=\"{}\"/>",esc(v),esc(v)));}
if let Some(v)=m.attrs.get("fontSize").and_then(Value::as_str){let size=v.trim_end_matches("pt").trim_end_matches("px").parse::<f64>().unwrap_or(12.0);props.push_str(&format!("<w:sz w:val=\"{}\"/>",(size*2.0)as u32));}
if let Some(v)=m.attrs.get("color").and_then(Value::as_str){props.push_str(&format!("<w:color w:val=\"{}\"/>",esc(v.trim_start_matches('#'))));}},_=>{}}}
                let run=format!("<w:r><w:rPr>{props}</w:rPr><w:t xml:space=\"preserve\">{}</w:t></w:r>",esc(n.text.as_deref().unwrap_or("")));if let Some(href)=href{let id=format!("nexaLink{}",self.rels.len());self.rels.push((id.clone(),"hyperlink".into(),href.into(),true));Ok(format!("<w:hyperlink r:id=\"{id}\">{run}</w:hyperlink>"))}else{Ok(run)}
            },
            "hardBreak"=>Ok("<w:r><w:br/></w:r>".into()),"pageBreak"=>Ok("<w:r><w:br w:type=\"page\"/></w:r>".into()),
            "horizontalRule"=>Ok("<w:p><w:pPr><w:pBdr><w:bottom w:val=\"single\" w:sz=\"6\"/></w:pBdr></w:pPr></w:p>".into()),
            "bulletList"|"orderedList"=>{let id=self.numbering.len() as u32+1;let start=n.attrs.get("start").and_then(Value::as_u64).unwrap_or(1).clamp(1,1_000_000)as u32;self.numbering.push((id,n.kind=="orderedList",start));n.content.iter().map(|c|self.node(c,level+1,id)).collect()},"listItem"=>n.content.iter().map(|c|self.node(c,level,num_id)).collect(),
            "table"=>{let inner=n.content.iter().map(|c|self.node(c,0,0)).collect::<Result<String,_>>()?;let cols=n.content.first().map_or(1,|r|r.content.len());Ok(format!("<w:tbl><w:tblPr><w:tblW w:w=\"0\" w:type=\"auto\"/><w:tblBorders><w:top w:val=\"single\" w:sz=\"4\"/><w:left w:val=\"single\" w:sz=\"4\"/><w:bottom w:val=\"single\" w:sz=\"4\"/><w:right w:val=\"single\" w:sz=\"4\"/><w:insideH w:val=\"single\" w:sz=\"4\"/><w:insideV w:val=\"single\" w:sz=\"4\"/></w:tblBorders></w:tblPr><w:tblGrid>{}</w:tblGrid>{inner}</w:tbl>","<w:gridCol w:w=\"2400\"/>".repeat(cols)))},
            "tableRow"=>Ok(format!("<w:tr>{}</w:tr>",n.content.iter().map(|c|self.node(c,0,0)).collect::<Result<String,_>>()?)),
            "tableCell"|"tableHeader"=>Ok(format!("<w:tc><w:tcPr><w:tcW w:w=\"2400\" w:type=\"dxa\"/><w:gridSpan w:val=\"{}\"/></w:tcPr>{}</w:tc>",n.attrs.get("colspan").and_then(Value::as_u64).unwrap_or(1),n.content.iter().map(|c|self.node(c,0,0)).collect::<Result<String,_>>()?)),
            "image"=>{self.image+=1;let src=n.attrs.get("src").and_then(Value::as_str).ok_or_else(||OfficeError::Missing("Image source".into()))?;let path=add_image(&mut self.parts,src,"word",self.image)?;let id=format!("nexaImage{}",self.image);self.rels.push((id.clone(),"image".into(),path.trim_start_matches("word/").into(),false));let w=(n.attrs.get("width").and_then(Value::as_f64).unwrap_or(400.0)*9525.0)as u64;let h=(n.attrs.get("height").and_then(Value::as_f64).unwrap_or(300.0)*9525.0)as u64;Ok(format!("<w:r><w:drawing><wp:inline><wp:extent cx=\"{w}\" cy=\"{h}\"/><wp:docPr id=\"{}\" name=\"Image\"/><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><pic:pic><pic:nvPicPr><pic:cNvPr id=\"0\" name=\"Image\"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed=\"{id}\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"{w}\" cy=\"{h}\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>",self.image))},
            _=>Err(OfficeError::Unsupported)
        }
    }
}
pub fn export(doc: &Document) -> Result<Parts, OfficeError> {
    let Content::Writer { body, page } = &doc.content else {
        return Err(OfficeError::Unsupported);
    };
    let mut w = Writer {
        parts: Parts::new(),
        rels: vec![
            (
                "nexaStyles".into(),
                "styles".into(),
                "styles.xml".into(),
                false,
            ),
            (
                "nexaNumbering".into(),
                "numbering".into(),
                "numbering.xml".into(),
                false,
            ),
        ],
        image: 0,
        numbering: Vec::new(),
    };
    let body = w.node(body, 0, 0)?;
    let mut refs = String::new();
    let mut overrides = vec![
        (
            "word/document.xml",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        ),
        (
            "word/styles.xml",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
        ),
        (
            "word/numbering.xml",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml",
        ),
    ];
    for (kind, tag, text) in [
        ("header", "hdr", &page.header),
        ("footer", "ftr", &page.footer),
    ] {
        if !text.is_empty() {
            let id = format!("nexa{kind}");
            w.rels
                .push((id.clone(), kind.into(), format!("{kind}1.xml"), false));
            refs.push_str(&format!(
                "<w:{kind}Reference w:type=\"default\" r:id=\"{id}\"/>"
            ));
            put(
                &mut w.parts,
                &format!("word/{kind}1.xml"),
                format!(
                    "<w:{tag} xmlns:w=\"{W}\"><w:p><w:r><w:t>{}</w:t></w:r></w:p></w:{tag}>",
                    esc(text)
                ),
            );
            if kind == "header" {
                overrides.push((
                    "word/header1.xml",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml",
                ));
            } else {
                overrides.push((
                    "word/footer1.xml",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml",
                ));
            }
        }
    }
    put(
        &mut w.parts,
        "word/document.xml",
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:document xmlns:w=\"{W}\" xmlns:r=\"{REL}\" xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" xmlns:a=\"{A}\" xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><w:body>{body}<w:sectPr>{refs}<w:pgSz w:w=\"{}\" w:h=\"{}\"/><w:pgMar w:top=\"{}\" w:right=\"{}\" w:bottom=\"{}\" w:left=\"{}\" w:header=\"400\" w:footer=\"400\" w:gutter=\"0\"/></w:sectPr></w:body></w:document>",
            (page.width * 15.0) as u32,
            (page.height * 15.0) as u32,
            (page.margins[0] * 15.0) as u32,
            (page.margins[1] * 15.0) as u32,
            (page.margins[2] * 15.0) as u32,
            (page.margins[3] * 15.0) as u32
        ),
    );
    put(&mut w.parts, "word/_rels/document.xml.rels", rels(&w.rels));
    put(
        &mut w.parts,
        "_rels/.rels",
        rels(&[(
            "rId1".into(),
            "officeDocument".into(),
            "word/document.xml".into(),
            false,
        )]),
    );
    let headings=(1..=6).map(|i|format!("<w:style w:type=\"paragraph\" w:styleId=\"Heading{i}\"><w:name w:val=\"heading {i}\"/><w:basedOn w:val=\"Normal\"/><w:pPr><w:outlineLvl w:val=\"{}\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"{}\"/></w:rPr></w:style>",i-1,48-i*4)).collect::<String>();
    put(
        &mut w.parts,
        "word/styles.xml",
        format!(
            "<w:styles xmlns:w=\"{W}\"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii=\"Calibri\" w:hAnsi=\"Calibri\"/><w:sz w:val=\"24\"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/></w:style>{headings}</w:styles>"
        ),
    );
    put(
        &mut w.parts,
        "word/numbering.xml",
        super::writer_lists::write(&w.numbering),
    );
    put(&mut w.parts, "[Content_Types].xml", types(&overrides));
    Ok(w.parts)
}
pub fn export_html(doc: &Document) -> Result<Vec<u8>, OfficeError> {
    let Content::Writer { body, .. } = &doc.content else {
        return Err(OfficeError::Unsupported);
    };
    fn node(n: &TextNode) -> String {
        let tag = match n.kind.as_str() {
            "paragraph" => "p",
            "heading" => "h2",
            "table" => "table",
            "tableRow" => "tr",
            "tableCell" => "td",
            "tableHeader" => "th",
            "bulletList" => "ul",
            "orderedList" => "ol",
            "listItem" => "li",
            "blockquote" => "blockquote",
            _ => "div",
        };
        if let Some(t) = &n.text {
            let mut t = esc(t);
            for m in &n.marks {
                let tag = match m.kind.as_str() {
                    "bold" => "strong",
                    "italic" => "em",
                    "underline" => "u",
                    "strike" => "s",
                    _ => "span",
                };
                t = format!("<{tag}>{t}</{tag}>");
            }
            return t;
        }
        if n.kind == "image" {
            return format!(
                "<img alt=\"\" src=\"{}\"/>",
                esc(n.attrs.get("src").and_then(Value::as_str).unwrap_or(""))
            );
        }
        format!(
            "<{tag}>{}</{tag}>",
            n.content.iter().map(node).collect::<String>()
        )
    }
    Ok(format!("<!doctype html><html><head><meta charset=\"utf-8\"><title>{}</title></head><body>{}</body></html>",esc(&doc.title),node(body)).into_bytes())
}
