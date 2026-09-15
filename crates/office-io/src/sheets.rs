use super::{ImportResult, OfficeError, package::*};
use document_model::{Cell, CellRange, Content, Document, Properties, Worksheet};
use nexafile::Parts;
use serde_json::{Value, json};
use std::collections::BTreeMap;
const S: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
pub fn address(row: u32, column: u32) -> String {
    let mut n = column + 1;
    let mut letters = String::new();
    while n > 0 {
        n -= 1;
        letters.insert(0, (b'A' + (n % 26) as u8) as char);
        n /= 26;
    }
    format!("{letters}{}", row + 1)
}
pub fn coordinate(s: &str) -> Result<(u32, u32), OfficeError> {
    let mut column = 0u32;
    let mut digits = String::new();
    for c in s.bytes() {
        if c == b'$' {
            continue;
        }
        if c.is_ascii_alphabetic() && digits.is_empty() {
            column = column
                .checked_mul(26)
                .and_then(|v| v.checked_add((c.to_ascii_uppercase() - b'A' + 1) as u32))
                .ok_or_else(|| OfficeError::Xml("Cell reference overflow".into()))?;
        } else if c.is_ascii_digit() {
            digits.push(c as char);
        } else {
            return Err(OfficeError::Xml("Invalid cell reference".into()));
        }
    }
    let row = digits
        .parse::<u32>()
        .map_err(|_| OfficeError::Xml("Invalid row reference".into()))?;
    if row == 0 || column == 0 || row > 1_048_576 || column > 16_384 {
        return Err(OfficeError::Xml("Cell dimensions exceed limits".into()));
    }
    Ok((row - 1, column - 1))
}
pub fn import(parts: &Parts, title: &str) -> Result<Document, OfficeError> {
    let book = xml(parts, "xl/workbook.xml")?;
    let rels = relationships(parts, "xl/workbook.xml")?;
    let shared = if parts.contains_key("xl/sharedStrings.xml") {
        let d = xml(parts, "xl/sharedStrings.xml")?;
        d.descendants()
            .filter(|n| n.has_tag_name((S, "si")))
            .map(text)
            .collect::<Vec<_>>()
    } else {
        vec![]
    };
    let styles = read_styles(parts)?;
    let mut doc = Document::new("sheets", title)?;
    if let Content::Sheets { workbook } = &mut doc.content {
        workbook.sheets.clear();
        for n in book
            .descendants()
            .filter(|n| n.tag_name().name() == "sheet")
        {
            let (path, external) = rels
                .get(attr(n, "id"))
                .ok_or_else(|| OfficeError::Missing("Worksheet relationship".into()))?;
            if *external {
                return Err(OfficeError::Unsupported);
            }
            let d = xml(parts, path)?;
            let mut sheet = Worksheet::blank(attr(n, "name"));
            for row in d.descendants().filter(|n| n.tag_name().name() == "row") {
                let row_idx = attr(row, "r").parse::<u32>().unwrap_or(1).saturating_sub(1);
                if !attr(row, "ht").is_empty() || attr(row, "hidden") == "1" {
                    sheet.row_dimensions.insert(row_idx,json!({"h":attr(row,"ht").parse::<f64>().unwrap_or(15.0)*4.0/3.0,"hd":if attr(row,"hidden")=="1"{1}else{0}}));
                }
                for c in row.children().filter(|n| n.tag_name().name() == "c") {
                    let (r, col) = coordinate(attr(c, "r"))?;
                    sheet.row_count = sheet.row_count.max(r + 1);
                    sheet.column_count = sheet.column_count.max(col + 1);
                    let raw = child(c, "v").and_then(|n| n.text()).unwrap_or("");
                    let value = match attr(c, "t") {
                        "s" => json!(
                            shared
                                .get(raw.parse::<usize>().unwrap_or(usize::MAX))
                                .cloned()
                                .unwrap_or_default()
                        ),
                        "inlineStr" => json!(text(c)),
                        "str" | "e" | "d" => json!(raw),
                        "b" => json!(raw == "1"),
                        _ => {
                            if raw.is_empty() {
                                Value::Null
                            } else {
                                raw.parse::<f64>().map_or_else(|_| json!(raw), |n| json!(n))
                            }
                        }
                    };
                    let formula = child(c, "f")
                        .and_then(|n| n.text())
                        .map(|f| format!("={f}"));
                    let mut extensions = BTreeMap::new();
                    if attr(c, "t") == "e" {
                        extensions.insert("error".into(), json!(true));
                    }
                    let cell = Cell {
                        value,
                        formula,
                        format: styles
                            .get(attr(c, "s").parse::<usize>().unwrap_or(0))
                            .cloned()
                            .unwrap_or_default(),
                        extensions,
                        ..Cell::default()
                    };
                    sheet.cells.entry(r).or_default().insert(col, cell);
                }
            }
            for c in d.descendants().filter(|n| n.tag_name().name() == "col") {
                let min = attr(c, "min").parse::<u32>().unwrap_or(1).saturating_sub(1);
                let max = attr(c, "max").parse::<u32>().unwrap_or(min + 1).min(16384);
                for col in min..max {
                    sheet.column_dimensions.insert(col,json!({"w":attr(c,"width").parse::<f64>().unwrap_or(10.0)*7.0+5.0,"hd":if attr(c,"hidden")=="1"{1}else{0}}));
                }
                sheet.column_count = sheet.column_count.max(max);
            }
            for m in d
                .descendants()
                .filter(|n| n.tag_name().name() == "mergeCell")
            {
                if let Some((a, b)) = attr(m, "ref").split_once(':') {
                    let (r, c) = coordinate(a)?;
                    let (er, ec) = coordinate(b)?;
                    sheet.row_count = sheet.row_count.max(er + 1);
                    sheet.column_count = sheet.column_count.max(ec + 1);
                    sheet.merges.push(CellRange {
                        start_row: r,
                        end_row: er,
                        start_column: c,
                        end_column: ec,
                    });
                }
            }
            if let Some(p) = d
                .descendants()
                .find(|n| n.tag_name().name() == "pane" && attr(*n, "state").starts_with("frozen"))
            {
                sheet.freeze = [
                    attr(p, "ySplit").parse().unwrap_or(0),
                    attr(p, "xSplit").parse().unwrap_or(0),
                ];
            }
            workbook.sheets.push(sheet);
        }
    }
    Ok(doc)
}
fn read_styles(parts: &Parts) -> Result<Vec<Properties>, OfficeError> {
    if !parts.contains_key("xl/styles.xml") {
        return Ok(vec![]);
    }
    let d = xml(parts, "xl/styles.xml")?;
    let root = d.root_element();
    let fonts = child(root, "fonts")
        .map(|p| p.children().filter(|n| n.is_element()).collect::<Vec<_>>())
        .unwrap_or_default();
    let fills = child(root, "fills")
        .map(|p| p.children().filter(|n| n.is_element()).collect::<Vec<_>>())
        .unwrap_or_default();
    let numfmts = d
        .descendants()
        .filter(|n| n.tag_name().name() == "numFmt")
        .map(|n| {
            (
                attr(n, "numFmtId").to_string(),
                attr(n, "formatCode").to_string(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let mut out = vec![];
    if let Some(xfs) = child(root, "cellXfs") {
        for xf in xfs.children().filter(|n| n.is_element()) {
            let mut f = Properties::new();
            if let Some(font) = fonts.get(attr(xf, "fontId").parse::<usize>().unwrap_or(0)) {
                for (tag, key) in [("b", "bold"), ("i", "italic"), ("u", "underline")] {
                    if child(*font, tag).is_some() {
                        f.insert(key.into(), json!(true));
                    }
                }
                if let Some(n) = child(*font, "name") {
                    f.insert("fontFamily".into(), json!(attr(n, "val")));
                }
                if let Some(n) = child(*font, "sz") {
                    f.insert(
                        "fontSize".into(),
                        json!(attr(n, "val").parse::<f64>().unwrap_or(11.0)),
                    );
                }
                if let Some(n) = child(*font, "color") {
                    let c = attr(n, "rgb");
                    if c.len() >= 6 {
                        f.insert("color".into(), json!(format!("#{}", &c[c.len() - 6..])));
                    }
                }
            }
            if let Some(fill) = fills.get(attr(xf, "fillId").parse::<usize>().unwrap_or(0))
                && let Some(n) = descendant(*fill, "fgColor")
            {
                let c = attr(n, "rgb");
                if c.len() >= 6 {
                    f.insert(
                        "background".into(),
                        json!(format!("#{}", &c[c.len() - 6..])),
                    );
                }
            }
            let id = attr(xf, "numFmtId");
            let number_format = numfmts.get(id).map(String::as_str).or(match id {
                "1" => Some("0"),
                "2" => Some("0.00"),
                "3" => Some("#,##0"),
                "4" => Some("#,##0.00"),
                "9" => Some("0%"),
                "10" => Some("0.00%"),
                "14" => Some("yyyy-mm-dd"),
                "22" => Some("yyyy-mm-dd hh:mm"),
                _ => None,
            });
            if let Some(code) = number_format {
                f.insert("numberFormat".into(), json!(code));
            }
            if let Some(a) = child(xf, "alignment") {
                if !attr(a, "horizontal").is_empty() {
                    f.insert("align".into(), json!(attr(a, "horizontal")));
                }
                if attr(a, "wrapText") == "1" {
                    f.insert("wrap".into(), json!(true));
                }
            }
            out.push(f);
        }
    }
    Ok(out)
}
fn style_xml(formats: &[Properties]) -> String {
    let fonts = formats
        .iter()
        .map(|f| {
            format!(
                "<font><sz val=\"{}\"/><name val=\"{}\"/>{}{}{}<color rgb=\"FF{}\"/></font>",
                f.get("fontSize").and_then(Value::as_f64).unwrap_or(11.0),
                esc(f
                    .get("fontFamily")
                    .and_then(Value::as_str)
                    .unwrap_or("Calibri")),
                if f.get("bold") == Some(&json!(true)) {
                    "<b/>"
                } else {
                    ""
                },
                if f.get("italic") == Some(&json!(true)) {
                    "<i/>"
                } else {
                    ""
                },
                if f.get("underline") == Some(&json!(true)) {
                    "<u/>"
                } else {
                    ""
                },
                esc(f
                    .get("color")
                    .and_then(Value::as_str)
                    .unwrap_or("#202b29")
                    .trim_start_matches('#'))
            )
        })
        .collect::<String>();
    let fills=formats.iter().map(|f|format!("<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FF{}\"/><bgColor indexed=\"64\"/></patternFill></fill>",esc(f.get("background").and_then(Value::as_str).unwrap_or("#ffffff").trim_start_matches('#')))).collect::<String>();
    let numfmts = formats
        .iter()
        .enumerate()
        .filter_map(|(i, f)| {
            f.get("numberFormat").and_then(Value::as_str).map(|code| {
                format!(
                    "<numFmt numFmtId=\"{}\" formatCode=\"{}\"/>",
                    164 + i,
                    esc(code)
                )
            })
        })
        .collect::<String>();
    let xfs=formats.iter().enumerate().map(|(i,f)|format!("<xf numFmtId=\"{}\" fontId=\"{i}\" fillId=\"{}\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyNumberFormat=\"1\" applyAlignment=\"1\"><alignment horizontal=\"{}\" wrapText=\"{}\"/></xf>",if f.contains_key("numberFormat"){164+i}else{0},i+2,esc(f.get("align").and_then(Value::as_str).unwrap_or("general")),if f.get("wrap")==Some(&json!(true)){1}else{0})).collect::<String>();
    format!(
        "<styleSheet xmlns=\"{S}\"><numFmts count=\"{}\">{numfmts}</numFmts><fonts count=\"{}\">{fonts}</fonts><fills count=\"{}\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill>{fills}</fills><borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs><cellXfs count=\"{}\">{xfs}</cellXfs><cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles></styleSheet>",
        formats
            .iter()
            .filter(|f| f.contains_key("numberFormat"))
            .count(),
        formats.len(),
        formats.len() + 2,
        formats.len()
    )
}
pub fn export(doc: &Document) -> Result<Parts, OfficeError> {
    let Content::Sheets { workbook } = &doc.content else {
        return Err(OfficeError::Unsupported);
    };
    let mut parts = Parts::new();
    let mut formats = vec![Properties::new()];
    let mut style_ids = BTreeMap::from([("{}".to_string(), 0usize)]);
    for s in &workbook.sheets {
        for cell in s.cells.values().flat_map(|r| r.values()) {
            let key = serde_json::to_string(&cell.format)?;
            if let std::collections::btree_map::Entry::Vacant(e) = style_ids.entry(key) {
                e.insert(formats.len());
                formats.push(cell.format.clone());
            }
        }
    }
    let mut names = String::new();
    let mut relations = vec![("styles".into(), "styles".into(), "styles.xml".into(), false)];
    let mut overrides = vec![
        (
            "xl/workbook.xml".to_string(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
                .to_string(),
        ),
        (
            "xl/styles.xml".to_string(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml".to_string(),
        ),
    ];
    for (i, s) in workbook.sheets.iter().enumerate() {
        let id = i + 1;
        let path = format!("xl/worksheets/sheet{id}.xml");
        names.push_str(&format!(
            "<sheet name=\"{}\" sheetId=\"{id}\" r:id=\"sheet{id}\"/>",
            esc(&s.name)
        ));
        relations.push((
            format!("sheet{id}"),
            "worksheet".into(),
            format!("worksheets/sheet{id}.xml"),
            false,
        ));
        overrides.push((
            path.clone(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml".into(),
        ));
        let mut data = String::new();
        for (r, row) in &s.cells {
            let mut cells = String::new();
            for (c, cell) in row {
                let a = address(*r, *c);
                let style = style_ids
                    .get(&serde_json::to_string(&cell.format)?)
                    .copied()
                    .unwrap_or(0);
                let formula = cell
                    .formula
                    .as_deref()
                    .map(|f| format!("<f>{}</f>", esc(f.trim_start_matches('='))))
                    .unwrap_or_default();
                let (t, value) = match &cell.value {
                    Value::String(v) => {
                        if cell.formula.is_some() {
                            ("str", format!("<v>{}</v>", esc(v)))
                        } else {
                            (
                                "inlineStr",
                                format!("<is><t xml:space=\"preserve\">{}</t></is>", esc(v)),
                            )
                        }
                    }
                    Value::Bool(v) => ("b", format!("<v>{}</v>", u8::from(*v))),
                    Value::Number(v) => ("n", format!("<v>{v}</v>")),
                    _ => ("n", String::new()),
                };
                cells.push_str(&format!(
                    "<c r=\"{a}\" s=\"{style}\" t=\"{t}\">{formula}{value}</c>"
                ));
            }
            let dim = s.row_dimensions.get(r);
            let props = dim
                .map(|v| {
                    format!(
                        " ht=\"{}\" customHeight=\"1\" hidden=\"{}\"",
                        v.get("h").and_then(Value::as_f64).unwrap_or(20.0) * 0.75,
                        v.get("hd").and_then(Value::as_u64).unwrap_or(0)
                    )
                })
                .unwrap_or_default();
            data.push_str(&format!("<row r=\"{}\"{props}>{cells}</row>", r + 1));
        }
        let cols = s
            .column_dimensions
            .iter()
            .map(|(c, v)| {
                format!(
                    "<col min=\"{}\" max=\"{}\" width=\"{}\" customWidth=\"1\" hidden=\"{}\"/>",
                    c + 1,
                    c + 1,
                    (v.get("w").and_then(Value::as_f64).unwrap_or(75.0) - 5.0) / 7.0,
                    v.get("hd").and_then(Value::as_u64).unwrap_or(0)
                )
            })
            .collect::<String>();
        let cols = if cols.is_empty() {
            String::new()
        } else {
            format!("<cols>{cols}</cols>")
        };
        let pane = if s.freeze != [0, 0] {
            format!(
                "<pane xSplit=\"{}\" ySplit=\"{}\" topLeftCell=\"{}\" activePane=\"bottomRight\" state=\"frozen\"/>",
                s.freeze[1],
                s.freeze[0],
                address(s.freeze[0], s.freeze[1])
            )
        } else {
            String::new()
        };
        let merges = if s.merges.is_empty() {
            String::new()
        } else {
            format!(
                "<mergeCells count=\"{}\">{}</mergeCells>",
                s.merges.len(),
                s.merges
                    .iter()
                    .map(|m| format!(
                        "<mergeCell ref=\"{}:{}\"/>",
                        address(m.start_row, m.start_column),
                        address(m.end_row, m.end_column)
                    ))
                    .collect::<String>()
            )
        };
        put(
            &mut parts,
            &path,
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?><worksheet xmlns=\"{S}\"><sheetViews><sheetView workbookViewId=\"0\">{pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight=\"15\"/>{cols}<sheetData>{data}</sheetData>{merges}<pageMargins left=\"0.4\" right=\"0.4\" top=\"0.5\" bottom=\"0.5\" header=\"0.2\" footer=\"0.2\"/></worksheet>"
            ),
        );
    }
    put(
        &mut parts,
        "xl/workbook.xml",
        format!(
            "<workbook xmlns=\"{S}\" xmlns:r=\"{REL}\"><bookViews><workbookView/></bookViews><sheets>{names}</sheets><calcPr calcId=\"191029\" fullCalcOnLoad=\"1\"/></workbook>"
        ),
    );
    put(&mut parts, "xl/styles.xml", style_xml(&formats));
    put(&mut parts, "xl/_rels/workbook.xml.rels", rels(&relations));
    put(
        &mut parts,
        "_rels/.rels",
        rels(&[(
            "rId1".into(),
            "officeDocument".into(),
            "xl/workbook.xml".into(),
            false,
        )]),
    );
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
pub fn import_delimited(
    bytes: &[u8],
    title: &str,
    delimiter: u8,
) -> Result<ImportResult, OfficeError> {
    if bytes.len() > 128 * 1024 * 1024 {
        return Err(OfficeError::Unsupported);
    }
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .has_headers(false)
        .flexible(true)
        .from_reader(bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes));
    let mut doc = Document::new("sheets", title)?;
    if let Content::Sheets { workbook } = &mut doc.content {
        let s = &mut workbook.sheets[0];
        let mut count = 0;
        for (r, row) in reader.records().enumerate() {
            let row = row?;
            if r >= 1_048_576 || row.len() > 16_384 {
                return Err(OfficeError::Unsupported);
            }
            for (c, raw) in row.iter().enumerate() {
                if raw.is_empty() {
                    continue;
                }
                count += 1;
                if count > document_model::MAX_CELLS {
                    return Err(OfficeError::Unsupported);
                }
                let value = if raw.starts_with('0') && raw.len() > 1 && !raw.starts_with("0.") {
                    json!(raw)
                } else {
                    raw.parse::<f64>().map_or_else(|_| json!(raw), |n| json!(n))
                };
                s.cells.entry(r as u32).or_default().insert(
                    c as u32,
                    Cell {
                        value,
                        ..Cell::default()
                    },
                );
            }
            s.row_count = s.row_count.max(r as u32 + 1);
            s.column_count = s.column_count.max(row.len() as u32);
        }
    }
    Ok(ImportResult{document:doc,preserved:Parts::new(),warnings:vec!["Delimited imports treat formula-like text as text. CSV/TSV exports contain displayed values from the first worksheet; use NXS or XLSX for complete workbooks.".into()]})
}
pub fn export_delimited(doc: &Document, delimiter: u8) -> Result<Vec<u8>, OfficeError> {
    let Content::Sheets { workbook } = &doc.content else {
        return Err(OfficeError::Unsupported);
    };
    let s = workbook.sheets.first().ok_or(OfficeError::Unsupported)?;
    let max_row = s.cells.keys().next_back().copied().unwrap_or(0);
    let max_col = s
        .cells
        .values()
        .flat_map(|r| r.keys())
        .max()
        .copied()
        .unwrap_or(0);
    if (max_row as u64 + 1) * (max_col as u64 + 1) > 5_000_000 {
        return Err(OfficeError::Unsupported);
    }
    let mut w = csv::WriterBuilder::new()
        .delimiter(delimiter)
        .from_writer(Vec::new());
    for r in 0..=max_row {
        let row = (0..=max_col)
            .map(|c| {
                let v = s.cells.get(&r).and_then(|r| r.get(&c)).map(|c| &c.value);
                match v {
                    Some(Value::String(s)) => {
                        if s.starts_with(['=', '+', '-', '@', '\t', '\r']) {
                            format!("'{s}")
                        } else {
                            s.clone()
                        }
                    }
                    Some(Value::Null) | None => String::new(),
                    Some(v) => v.to_string(),
                }
            })
            .collect::<Vec<_>>();
        w.write_record(row)?;
    }
    w.flush()?;
    w.into_inner().map_err(|e| OfficeError::Io(e.into_error()))
}
