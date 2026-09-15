use super::{OfficeError, package::*};
use document_model::{Content, Document, Slide, SlideObject};
use nexafile::Parts;
use serde_json::json;
use uuid::Uuid;
const P: &str = "http://schemas.openxmlformats.org/presentationml/2006/main";
fn emu(v: f64) -> i64 {
    (v * 9525.0).round() as i64
}
pub fn import(parts: &Parts, title: &str) -> Result<Document, OfficeError> {
    let pres = xml(parts, "ppt/presentation.xml")?;
    let rels = relationships(parts, "ppt/presentation.xml")?;
    let mut doc = Document::new("slides", title)?;
    if let Content::Slides { deck } = &mut doc.content {
        if let Some(size) = descendant(pres.root_element(), "sldSz") {
            deck.width = attr(size, "cx").parse::<f64>().unwrap_or(12192000.0) / 9525.0;
            deck.height = attr(size, "cy").parse::<f64>().unwrap_or(6858000.0) / 9525.0;
        }
        deck.slides.clear();
        for n in pres
            .descendants()
            .filter(|n| n.tag_name().name() == "sldId")
        {
            let (path, external) = rels
                .get(attr(n, "id"))
                .or_else(|| {
                    n.attributes().find_map(|a| {
                        if a.namespace() == Some(REL) {
                            rels.get(a.value())
                        } else {
                            None
                        }
                    })
                })
                .ok_or_else(|| OfficeError::Missing("Slide relationship".into()))?;
            if *external {
                return Err(OfficeError::Unsupported);
            }
            let d = xml(parts, path)?;
            let slide_rels = relationships(parts, path)?;
            let mut slide = Slide {
                id: Uuid::new_v4().to_string(),
                name: format!("Slide {}", deck.slides.len() + 1),
                background: "#ffffff".into(),
                notes: String::new(),
                objects: vec![],
            };
            if let Some(bg) =
                descendant(d.root_element(), "bg").and_then(|b| descendant(b, "srgbClr"))
            {
                slide.background = format!("#{}", attr(bg, "val"));
            }
            for sp in d
                .descendants()
                .filter(|n| matches!(n.tag_name().name(), "sp" | "pic" | "cxnSp"))
            {
                let mut o: SlideObject = serde_json::from_value(
                    json!({"id":Uuid::new_v4().to_string(),"kind":"text","x":80,"y":80,"width":600,"height":120,"fill":"transparent","stroke":"transparent"}),
                )?;
                if let Some(xfrm) = descendant(sp, "xfrm") {
                    o.rotation = attr(xfrm, "rot").parse::<f64>().unwrap_or(0.0) / 60000.0;
                    if let Some(off) = child(xfrm, "off") {
                        o.x = attr(off, "x").parse::<f64>().unwrap_or(0.0) / 9525.0;
                        o.y = attr(off, "y").parse::<f64>().unwrap_or(0.0) / 9525.0;
                    }
                    if let Some(ext) = child(xfrm, "ext") {
                        o.width =
                            (attr(ext, "cx").parse::<f64>().unwrap_or(952500.0) / 9525.0).max(1.0);
                        o.height =
                            (attr(ext, "cy").parse::<f64>().unwrap_or(952500.0) / 9525.0).max(1.0);
                    }
                }
                let paragraphs = sp
                    .descendants()
                    .filter(|n| n.tag_name().name() == "p")
                    .map(text)
                    .collect::<Vec<_>>();
                o.text = paragraphs.join("\n");
                if let Some(r) = descendant(sp, "rPr") {
                    o.font_size = attr(r, "sz").parse::<f64>().unwrap_or(2100.0) / 75.0;
                    o.bold = attr(r, "b") == "1";
                    o.italic = attr(r, "i") == "1";
                    if let Some(c) = descendant(r, "srgbClr") {
                        o.color = format!("#{}", attr(c, "val"));
                    }
                    if let Some(font) = descendant(r, "latin") {
                        o.font_family = attr(font, "typeface").into();
                    }
                }
                if let Some(pr) = child(sp, "spPr") {
                    if let Some(fill) = child(pr, "solidFill").and_then(|n| child(n, "srgbClr")) {
                        o.fill = format!("#{}", attr(fill, "val"));
                    }
                    if let Some(line) = child(pr, "ln") {
                        o.stroke_width = attr(line, "w").parse::<f64>().unwrap_or(9525.0) / 9525.0;
                        if let Some(c) = descendant(line, "srgbClr") {
                            o.stroke = format!("#{}", attr(c, "val"));
                        }
                    }
                    if let Some(geom) = child(pr, "prstGeom") {
                        let shape = attr(geom, "prst");
                        if o.text.is_empty() {
                            o.kind = match shape {
                                "ellipse" => "ellipse",
                                "line" => "line",
                                "rightArrow" => "arrow",
                                _ => "rectangle",
                            }
                            .into();
                        }
                    }
                }
                if sp.tag_name().name() == "pic"
                    && let Some(blip) = descendant(sp, "blip")
                    && let Some((path, false)) = slide_rels.get(attr(blip, "embed"))
                {
                    if let Some(src) = image_data(parts, path) {
                        o.kind = "image".into();
                        o.src = Some(src);
                    } else {
                        continue;
                    }
                }
                slide.objects.push(o);
            }
            for (path, external) in slide_rels.values() {
                if !external
                    && path.contains("notesSlides/")
                    && let Ok(notes) = xml(parts, path)
                {
                    slide.notes = notes
                        .descendants()
                        .filter(|n| {
                            n.tag_name().name() == "sp"
                                && descendant(*n, "ph").is_some_and(|n| attr(n, "type") == "body")
                        })
                        .map(text)
                        .collect::<Vec<_>>()
                        .join("\n");
                }
            }
            deck.slides.push(slide);
        }
    }
    Ok(doc)
}
fn fill(color: &str) -> String {
    if color == "transparent" || color.is_empty() {
        "<a:noFill/>".into()
    } else {
        format!(
            "<a:solidFill><a:srgbClr val=\"{}\"/></a:solidFill>",
            esc(color.trim_start_matches('#'))
        )
    }
}
fn shape(
    o: &SlideObject,
    id: usize,
    parts: &mut Parts,
    rels: &mut Vec<(String, String, String, bool)>,
    image_index: &mut usize,
) -> Result<String, OfficeError> {
    let transform = format!(
        "<a:xfrm rot=\"{}\"><a:off x=\"{}\" y=\"{}\"/><a:ext cx=\"{}\" cy=\"{}\"/></a:xfrm>",
        (o.rotation * 60000.0) as i64,
        emu(o.x),
        emu(o.y),
        emu(o.width),
        emu(o.height)
    );
    if o.kind == "image" {
        *image_index += 1;
        let path = add_image(
            parts,
            o.src
                .as_deref()
                .ok_or_else(|| OfficeError::Missing("Slide image source".into()))?,
            "ppt",
            *image_index,
        )?;
        let rid = format!("nexaImage{image_index}");
        rels.push((
            rid.clone(),
            "image".into(),
            format!("../{}", path.trim_start_matches("ppt/")),
            false,
        ));
        return Ok(format!(
            "<p:pic><p:nvPicPr><p:cNvPr id=\"{id}\" name=\"Image {id}\"/><p:cNvPicPr><a:picLocks noChangeAspect=\"1\"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed=\"{rid}\"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>{transform}<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr></p:pic>"
        ));
    }
    let geom = match o.kind.as_str() {
        "ellipse" => "ellipse",
        "line" => "line",
        "arrow" => "rightArrow",
        _ => "rect",
    };
    let paragraphs=o.text.split('\n').map(|t|format!("<a:p><a:pPr algn=\"{}\"/><a:r><a:rPr lang=\"en-US\" sz=\"{}\" b=\"{}\" i=\"{}\">{}<a:latin typeface=\"{}\"/></a:rPr><a:t>{}</a:t></a:r><a:endParaRPr lang=\"en-US\"/></a:p>",match o.align.as_str(){"center"=>"ctr","right"=>"r",_=>"l"},(o.font_size*75.0)as u32,u8::from(o.bold),u8::from(o.italic),fill(&o.color),esc(&o.font_family),esc(t))).collect::<String>();
    Ok(format!(
        "<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"Object {id}\"/><p:cNvSpPr txBox=\"{}\"/><p:nvPr/></p:nvSpPr><p:spPr>{transform}<a:prstGeom prst=\"{geom}\"><a:avLst/></a:prstGeom>{}<a:ln w=\"{}\">{}</a:ln></p:spPr><p:txBody><a:bodyPr wrap=\"square\" lIns=\"0\" rIns=\"0\" tIns=\"0\" bIns=\"0\"/><a:lstStyle/>{paragraphs}</p:txBody></p:sp>",
        u8::from(o.kind == "text"),
        fill(&o.fill),
        emu(o.stroke_width),
        fill(&o.stroke)
    ))
}
fn group() -> &'static str {
    "<p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>"
}
pub fn export(doc: &Document) -> Result<Parts, OfficeError> {
    let Content::Slides { deck } = &doc.content else {
        return Err(OfficeError::Unsupported);
    };
    let mut parts = Parts::new();
    let mut relationships = vec![(
        "master".into(),
        "slideMaster".into(),
        "slideMasters/slideMaster1.xml".into(),
        false,
    )];
    let mut overrides = vec![
        (
            "ppt/presentation.xml".to_string(),
            "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"
                .to_string(),
        ),
        (
            "ppt/slideMasters/slideMaster1.xml".into(),
            "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml".into(),
        ),
        (
            "ppt/slideLayouts/slideLayout1.xml".into(),
            "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml".into(),
        ),
        (
            "ppt/theme/theme1.xml".into(),
            "application/vnd.openxmlformats-officedocument.theme+xml".into(),
        ),
    ];
    let mut ids = String::new();
    let mut image_index = 0;
    for (i, s) in deck.slides.iter().enumerate() {
        let index = i + 1;
        let path = format!("ppt/slides/slide{index}.xml");
        let mut rel = vec![(
            "layout".into(),
            "slideLayout".into(),
            "../slideLayouts/slideLayout1.xml".into(),
            false,
        )];
        let mut objects = String::new();
        for (j, o) in s.objects.iter().enumerate() {
            objects.push_str(&shape(o, j + 2, &mut parts, &mut rel, &mut image_index)?);
        }
        put(
            &mut parts,
            &path,
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?><p:sld xmlns:p=\"{P}\" xmlns:a=\"{A}\" xmlns:r=\"{REL}\"><p:cSld name=\"{}\"><p:bg><p:bgPr>{}<a:effectLst/></p:bgPr></p:bg><p:spTree>{}{objects}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>",
                esc(&s.name),
                fill(&s.background),
                group()
            ),
        );
        if !s.notes.is_empty() {
            let note_path = format!("ppt/notesSlides/notesSlide{index}.xml");
            put(
                &mut parts,
                &note_path,
                format!(
                    "<p:notes xmlns:p=\"{P}\" xmlns:a=\"{A}\" xmlns:r=\"{REL}\"><p:cSld><p:spTree>{}<p:sp><p:nvSpPr><p:cNvPr id=\"2\" name=\"Notes\"/><p:cNvSpPr/><p:nvPr><p:ph type=\"body\" idx=\"1\"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>",
                    group(),
                    esc(&s.notes)
                ),
            );
            rel.push((
                "notes".into(),
                "notesSlide".into(),
                format!("../notesSlides/notesSlide{index}.xml"),
                false,
            ));
            put(
                &mut parts,
                &format!("ppt/notesSlides/_rels/notesSlide{index}.xml.rels"),
                rels(&[(
                    "slide".into(),
                    "slide".into(),
                    format!("../slides/slide{index}.xml"),
                    false,
                )]),
            );
            overrides.push((
                note_path,
                "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"
                    .into(),
            ));
        }
        put(
            &mut parts,
            &format!("ppt/slides/_rels/slide{index}.xml.rels"),
            rels(&rel),
        );
        relationships.push((
            format!("slide{index}"),
            "slide".into(),
            format!("slides/slide{index}.xml"),
            false,
        ));
        ids.push_str(&format!(
            "<p:sldId id=\"{}\" r:id=\"slide{index}\"/>",
            256 + i
        ));
        overrides.push((
            path,
            "application/vnd.openxmlformats-officedocument.presentationml.slide+xml".into(),
        ));
    }
    put(
        &mut parts,
        "ppt/presentation.xml",
        format!(
            "<p:presentation xmlns:p=\"{P}\" xmlns:a=\"{A}\" xmlns:r=\"{REL}\"><p:sldMasterIdLst><p:sldMasterId id=\"2147483648\" r:id=\"master\"/></p:sldMasterIdLst><p:sldIdLst>{ids}</p:sldIdLst><p:sldSz cx=\"{}\" cy=\"{}\"/><p:notesSz cx=\"6858000\" cy=\"9144000\"/></p:presentation>",
            emu(deck.width),
            emu(deck.height)
        ),
    );
    put(
        &mut parts,
        "ppt/_rels/presentation.xml.rels",
        rels(&relationships),
    );
    put(
        &mut parts,
        "_rels/.rels",
        rels(&[(
            "rId1".into(),
            "officeDocument".into(),
            "ppt/presentation.xml".into(),
            false,
        )]),
    );
    put(
        &mut parts,
        "ppt/slideMasters/slideMaster1.xml",
        format!(
            "<p:sldMaster xmlns:p=\"{P}\" xmlns:a=\"{A}\" xmlns:r=\"{REL}\"><p:cSld><p:spTree>{}</p:spTree></p:cSld><p:clrMap accent1=\"accent1\" accent2=\"accent2\" accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" bg1=\"lt1\" bg2=\"lt2\" folHlink=\"folHlink\" hlink=\"hlink\" tx1=\"dk1\" tx2=\"dk2\"/><p:sldLayoutIdLst><p:sldLayoutId id=\"2147483649\" r:id=\"layout\"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>",
            group()
        ),
    );
    put(
        &mut parts,
        "ppt/slideMasters/_rels/slideMaster1.xml.rels",
        rels(&[
            (
                "layout".into(),
                "slideLayout".into(),
                "../slideLayouts/slideLayout1.xml".into(),
                false,
            ),
            (
                "theme".into(),
                "theme".into(),
                "../theme/theme1.xml".into(),
                false,
            ),
        ]),
    );
    put(
        &mut parts,
        "ppt/slideLayouts/slideLayout1.xml",
        format!(
            "<p:sldLayout xmlns:p=\"{P}\" xmlns:a=\"{A}\" xmlns:r=\"{REL}\" type=\"blank\" preserve=\"1\"><p:cSld name=\"Blank\"><p:spTree>{}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>",
            group()
        ),
    );
    put(
        &mut parts,
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
        rels(&[(
            "master".into(),
            "slideMaster".into(),
            "../slideMasters/slideMaster1.xml".into(),
            false,
        )]),
    );
    let colors = [
        ("dk1", "182b29"),
        ("lt1", "FFFFFF"),
        ("dk2", "386b5a"),
        ("lt2", "F4F7F3"),
        ("accent1", "386b5a"),
        ("accent2", "F0BF70"),
        ("accent3", "688DB1"),
        ("accent4", "C897B3"),
        ("accent5", "80AC9A"),
        ("accent6", "E09D7B"),
        ("hlink", "0563C1"),
        ("folHlink", "954F72"),
    ]
    .iter()
    .map(|(k, v)| format!("<a:{k}><a:srgbClr val=\"{v}\"/></a:{k}>"))
    .collect::<String>();
    put(&mut parts,"ppt/theme/theme1.xml",format!("<a:theme xmlns:a=\"{A}\" name=\"Nexa\"><a:themeElements><a:clrScheme name=\"Nexa\">{colors}</a:clrScheme><a:fontScheme name=\"Nexa\"><a:majorFont><a:latin typeface=\"Arial\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:majorFont><a:minorFont><a:latin typeface=\"Arial\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:minorFont></a:fontScheme><a:fmtScheme name=\"Nexa\"><a:fillStyleLst>{}</a:fillStyleLst><a:lnStyleLst>{}</a:lnStyleLst><a:effectStyleLst>{}</a:effectStyleLst><a:bgFillStyleLst>{}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>","<a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill>".repeat(3),"<a:ln w=\"9525\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/></a:ln>".repeat(3),"<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3),"<a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill>".repeat(3)));
    put(
        &mut parts,
        "[Content_Types].xml",
        types(
            &overrides
                .iter()
                .map(|(a, b)| (a.as_str(), b.as_str()))
                .collect::<Vec<_>>(),
        ),
    );
    Ok(parts)
}
