//! Browser-local deterministic kernels. The host supplies verified JSON and hashes.
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
type Result<T> = std::result::Result<T, String>;
fn text(v: &Value) -> Result<&str> {
    v.as_str().ok_or_else(|| "Expected text".into())
}
fn array(v: &Value) -> Result<&Vec<Value>> {
    v.as_array().ok_or_else(|| "Expected array".into())
}
fn object(v: &Value) -> Result<&Map<String, Value>> {
    v.as_object().ok_or_else(|| "Expected object".into())
}
fn number(v: &Value) -> Result<usize> {
    v.as_u64()
        .filter(|n| *n <= usize::MAX as u64)
        .map(|n| n as usize)
        .ok_or_else(|| "Invalid source offset".into())
}
fn id(v: &Value) -> Result<&str> {
    let s = text(v)?;
    if s.is_empty()
        || s.len() > 160
        || !s.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        || !s
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_.:-".contains(c))
    {
        return Err("Invalid identity".into());
    }
    Ok(s)
}
struct Source<'a> {
    text: &'a str,
    bounds: Vec<usize>,
}
impl<'a> Source<'a> {
    fn new(text: &'a str) -> Self {
        let mut bounds: Vec<_> = text.char_indices().map(|(i, _)| i).collect();
        bounds.push(text.len());
        Self { text, bounds }
    }
}
fn spans(value: &Value, source: &Source, empty: bool) -> Result<()> {
    let s = array(value)?;
    if s.len() > 128 || (!empty && s.is_empty()) {
        return Err("Anchor is required".into());
    }
    let mut last = 0;
    for p in s {
        let a = number(&p["start"])?;
        let b = number(&p["end"])?;
        if a < last
            || b <= a
            || b >= source.bounds.len()
            || text(&p["text"])? != &source.text[source.bounds[a]..source.bounds[b]]
        {
            return Err("Invalid source span".into());
        }
        last = b;
    }
    Ok(())
}
fn validate_schema(s: &Value) -> Result<()> {
    id(&s["id"])?;
    text(&s["version"])?;
    let families = object(&s["families"])?;
    if families.is_empty() || families.len() > 200 {
        return Err("Schema family limit".into());
    }
    for (name, def) in families {
        id(&json!(name))?;
        let fields = object(&def["fields"])?;
        if fields.len() > 100 {
            return Err("Field limit".into());
        }
        for (name, f) in fields {
            id(&json!(name))?;
            let typ = text(&f["type"])?;
            if !["text", "number", "boolean", "enum", "span"].contains(&typ) {
                return Err("Unsupported field type".into());
            }
            if typ == "enum" {
                let values = array(&f["values"])?;
                let mut seen = HashSet::new();
                if values.is_empty() || values.len() > 1000 {
                    return Err("Enum limit".into());
                }
                for value in values {
                    if !seen.insert(text(value)?) {
                        return Err("Duplicate enum value".into());
                    }
                }
            }
        }
    }
    if let Some(relations) = s.get("relations") {
        for (name, rel) in object(relations)? {
            id(&json!(name))?;
            for role in ["head", "tail"] {
                for family in array(&rel[role])? {
                    if !families.contains_key(text(family)?) {
                        return Err("Invalid relation family".into());
                    }
                }
            }
        }
    }
    Ok(())
}
fn validate_records(records: &Value, docs: &Value, schema: &Value) -> Result<()> {
    validate_schema(schema)?;
    let records = array(records)?;
    if records.len() > 100_000 {
        return Err("Record limit".into());
    }
    let documents: HashMap<&str, Source> = array(docs)?
        .iter()
        .map(|d| Ok((id(&d["id"])?, Source::new(text(&d["text"])?))))
        .collect::<Result<_>>()?;
    let mut ids = HashMap::new();
    for r in records {
        if ids.insert(id(&r["id"])?, r).is_some() {
            return Err("Duplicate record identity".into());
        }
    }
    for r in records {
        let source = documents
            .get(text(&r["documentId"])?)
            .ok_or("Unknown source")?;
        let def = schema["families"]
            .get(text(&r["family"])?)
            .ok_or("Unknown family")?;
        spans(&r["anchor"], source, def["documentLevel"] == true)?;
        for (key, value) in object(&r["fields"])? {
            let field = def["fields"].get(key).ok_or("Unknown field")?;
            if value.is_null() {
                continue;
            }
            let valid = match text(&field["type"])? {
                "span" => {
                    spans(value, source, false)?;
                    true
                }
                "enum" => array(&field["values"])?.contains(value),
                "text" => value
                    .as_str()
                    .is_some_and(|s| s.encode_utf16().count() <= 20000),
                "boolean" => value.is_boolean(),
                "number" => value.is_number(),
                _ => false,
            };
            if !valid {
                return Err("Invalid field value".into());
            }
        }
        if let Some(e) = r.get("evidence") {
            spans(e, source, true)?;
        }
        if let Some(score) = r.get("score") {
            if !score.is_null() && !score.is_number() {
                return Err("Invalid model score".into());
            }
        }
        if let Some(relations) = r.get("relations") {
            if array(relations)?.len() > 1000 {
                return Err("Relation limit".into());
            }
            for rel in array(relations)? {
                let target = ids.get(id(&rel["targetId"])?).ok_or("Dangling relation")?;
                id(&rel["type"])?;
                if target["documentId"] != r["documentId"] {
                    return Err("Cross-source relation".into());
                }
                if let Some(defs) = schema.get("relations") {
                    let def = defs
                        .get(text(&rel["type"])?)
                        .ok_or("Unknown relation type")?;
                    if !array(&def["head"])?.contains(&r["family"])
                        || !array(&def["tail"])?.contains(&target["family"])
                    {
                        return Err("Invalid relation endpoint family".into());
                    }
                }
            }
        }
    }
    Ok(())
}
fn ranges(v: &Value) -> Result<Vec<(usize, usize)>> {
    array(v)?
        .iter()
        .map(|s| Ok((number(&s["start"])?, number(&s["end"])?)))
        .collect()
}
fn iou(a: &Value, b: &Value) -> Result<f64> {
    let a = ranges(a)?;
    let b = ranges(b)?;
    let total: usize = a.iter().chain(&b).map(|(s, e)| e.saturating_sub(*s)).sum();
    let mut both = 0;
    let (mut i, mut j) = (0, 0);
    while i < a.len() && j < b.len() {
        both += a[i].1.min(b[j].1).saturating_sub(a[i].0.max(b[j].0));
        if a[i].1 <= b[j].1 {
            i += 1
        } else {
            j += 1
        }
    }
    Ok(if total == both {
        if a.is_empty() && b.is_empty() {
            1.0
        } else {
            0.0
        }
    } else {
        both as f64 / (total - both) as f64
    })
}
fn same(a: &Value, b: &Value) -> bool {
    ranges(a).ok() == ranges(b).ok()
}
fn counts(tp: usize, fp: usize, fn_: usize) -> Value {
    json!({"tp":tp,"fp":fp,"fn":fn_,"precision":if tp+fp>0{Some(tp as f64/(tp+fp) as f64)}else{None},"recall":if tp+fn_>0{Some(tp as f64/(tp+fn_) as f64)}else{None},"f1":if 2*tp+fp+fn_>0{Some(2.0*tp as f64/(2*tp+fp+fn_) as f64)}else{None}})
}
// Iterative augmenting paths avoid recursion overflow on large ambiguous corpora.
fn matching(
    left: &[&Value],
    right: &[&Value],
    mode: &str,
    threshold: f64,
) -> Result<(Vec<(usize, usize)>, Vec<usize>, Vec<usize>)> {
    let mut groups: HashMap<(String, String), Vec<usize>> = HashMap::new();
    for (j, r) in right.iter().enumerate() {
        groups
            .entry((text(&r["documentId"])?.into(), text(&r["family"])?.into()))
            .or_default()
            .push(j);
    }
    let mut edges = Vec::new();
    let mut work = 0usize;
    for a in left {
        let mut compatible = Vec::new();
        if let Some(group) =
            groups.get(&(text(&a["documentId"])?.into(), text(&a["family"])?.into()))
        {
            for &j in group {
                work += 1;
                if work > 20_000_000 {
                    return Err("Comparison pair budget exceeded; split the corpus".into());
                }
                let score = iou(&a["anchor"], &right[j]["anchor"])?;
                if (mode == "exact" && same(&a["anchor"], &right[j]["anchor"]))
                    || (mode == "overlap" && score >= threshold)
                {
                    compatible.push((j, score));
                }
            }
        }
        compatible.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        edges.push(compatible.into_iter().map(|e| e.0).collect::<Vec<_>>());
    }
    let mut assigned = vec![None; right.len()];
    for root in 0..left.len() {
        let mut seen = vec![false; right.len()];
        let mut stack = vec![(root, 0usize, None::<usize>)];
        let mut path = Vec::new();
        while let Some((i, next, _via)) = stack.last_mut() {
            if *next >= edges[*i].len() {
                stack.pop();
                continue;
            }
            let j = edges[*i][*next];
            *next += 1;
            if seen[j] {
                continue;
            }
            seen[j] = true;
            if let Some(previous) = assigned[j] {
                stack.push((previous, 0, Some(j)));
            } else {
                path = stack.iter().map(|(i, _, via)| (*i, *via)).collect();
                path.push((usize::MAX, Some(j)));
                break;
            }
        }
        if !path.is_empty() {
            for k in 0..path.len() - 1 {
                assigned[path[k + 1].1.unwrap()] = Some(path[k].0);
            }
        }
    }
    let mut pairs: Vec<_> = assigned
        .iter()
        .enumerate()
        .filter_map(|(j, i)| i.map(|i| (i, j)))
        .collect();
    pairs.sort();
    let matched: HashSet<_> = pairs.iter().map(|(i, _)| *i).collect();
    Ok((
        pairs,
        (0..left.len()).filter(|i| !matched.contains(i)).collect(),
        assigned
            .iter()
            .enumerate()
            .filter_map(|(j, i)| i.is_none().then_some(j))
            .collect(),
    ))
}
fn compare(a: &Value, b: &Value, o: &Value) -> Result<Value> {
    if a["schemaHash"] != b["schemaHash"] || a["sources"] != b["sources"] {
        return Err("Comparison source or schema mismatch".into());
    }
    let mode = o["mode"].as_str().unwrap_or("exact");
    let threshold = o["iou"].as_f64().unwrap_or(0.5);
    if !["exact", "overlap"].contains(&mode) || threshold <= 0.0 || threshold > 1.0 {
        return Err("Invalid matching policy".into());
    }
    let mut source_ids: Vec<String> = object(&a["sources"])?.keys().cloned().collect();
    source_ids.sort();
    let complete = o["requireComplete"] != false;
    let evaluated: Vec<String> = source_ids
        .iter()
        .filter(|id| {
            (!complete || a["completeness"][*id]["full"] == true)
                && (b["kind"] != "machine" || b["completeness"][*id]["full"] == true)
        })
        .cloned()
        .collect();
    let allowed: HashSet<_> = evaluated.iter().map(String::as_str).collect();
    let mut left: Vec<_> = array(&a["records"])?
        .iter()
        .filter(|r| {
            r["documentId"]
                .as_str()
                .is_some_and(|s| allowed.contains(s))
        })
        .collect();
    let mut right: Vec<_> = array(&b["records"])?
        .iter()
        .filter(|r| {
            r["documentId"]
                .as_str()
                .is_some_and(|s| allowed.contains(s))
        })
        .collect();
    let original_left = left.clone();
    let original_right = right.clone();
    for (records, key) in [
        (&mut left, "referenceOrder"),
        (&mut right, "candidateOrder"),
    ] {
        let order: HashMap<&str, usize> = array(&o[key])?
            .iter()
            .enumerate()
            .map(|(i, id)| Ok((text(id)?, i)))
            .collect::<Result<_>>()?;
        records.sort_by_key(|r| {
            order
                .get(r["id"].as_str().unwrap())
                .copied()
                .unwrap_or(usize::MAX)
        });
    }
    let (pairs, missing, extra) = matching(&left, &right, mode, threshold)?;
    let mut fields: Map<String, Value> = Map::new();
    let mut disagreements = Vec::new();
    let mut tuples = 0;
    let mut eligible = HashSet::new();
    for &(i, j) in &pairs {
        let (x, y) = (left[i], right[j]);
        let mut tuple = true;
        for (key, value) in object(&x["fields"])? {
            if value.is_null() {
                continue;
            }
            let correct = value == &y["fields"][key];
            let stat = fields
                .entry(key.clone())
                .or_insert(json!({"correct":0,"evaluated":0}));
            stat["evaluated"] = json!(stat["evaluated"].as_u64().unwrap() + 1);
            if correct {
                stat["correct"] = json!(stat["correct"].as_u64().unwrap() + 1);
            } else {
                tuple = false;
                disagreements.push(json!({"kind":"field-mismatch","referenceId":x["id"],"candidateId":y["id"],"field":key,"documentId":x["documentId"]}));
            }
        }
        if tuple {
            tuples += 1;
        }
        let empty = json!([]);
        let evidence = x.get("evidence").unwrap_or(&empty) == y.get("evidence").unwrap_or(&empty);
        if !evidence {
            disagreements.push(json!({"kind":"evidence-mismatch","referenceId":x["id"],"candidateId":y["id"],"documentId":x["documentId"]}));
        }
        if tuple && evidence && same(&x["anchor"], &y["anchor"]) {
            eligible.insert(i);
        }
        if !same(&x["anchor"], &y["anchor"]) {
            disagreements.push(json!({"kind":"boundary-mismatch","referenceId":x["id"],"candidateId":y["id"],"documentId":x["documentId"]}));
        }
    }
    for &i in &missing {
        disagreements.push(json!({"kind":"missing-record","referenceId":left[i]["id"],"documentId":left[i]["documentId"]}));
    }
    for &j in &extra {
        disagreements.push(json!({"kind":"extra-record","candidateId":right[j]["id"],"documentId":right[j]["documentId"]}));
    }
    let mapped: HashMap<String, Value> = pairs
        .iter()
        .map(|&(i, j)| {
            (
                left[i]["id"].as_str().unwrap().into(),
                right[j]["id"].clone(),
            )
        })
        .collect();
    let edge_list = |records: &[&Value]| -> Result<Vec<Value>> {
        let mut edges = Vec::new();
        for r in records {
            if let Some(rels) = r.get("relations") {
                for rel in array(rels)? {
                    edges.push(json!({"head":r["id"],"tail":rel["targetId"],"type":rel["type"],"documentId":r["documentId"]}));
                }
            }
        }
        Ok(edges)
    };
    let expected = edge_list(&original_left)?;
    let actual = edge_list(&original_right)?;
    let mut remaining = actual.clone();
    let mut relation_tp = 0;
    let covered = !evaluated.is_empty()
        && evaluated.iter().all(|id| {
            a["completeness"][id]["relationsChecked"] == true
                && b["completeness"][id]["relationsChecked"] == true
        });
    if covered {
        for e in &expected {
            let head = mapped
                .get(e["head"].as_str().unwrap())
                .unwrap_or(&Value::Null);
            let tail = mapped
                .get(e["tail"].as_str().unwrap())
                .unwrap_or(&Value::Null);
            if let Some(at) = remaining
                .iter()
                .position(|r| &r["head"] == head && &r["tail"] == tail && r["type"] == e["type"])
            {
                relation_tp += 1;
                remaining.remove(at);
            } else {
                disagreements.push(json!({"kind":"wrong-linkage","documentId":e["documentId"],"referenceId":e["head"],"field":e["type"]}));
            }
        }
        for e in &remaining {
            disagreements.push(json!({"kind":"extra-linkage","documentId":e["documentId"],"candidateId":e["head"],"field":e["type"]}));
        }
    }
    let relation_keys = |r: &Value, map: bool| -> Result<Vec<(String, String)>> {
        let mut result = Vec::new();
        if let Some(rels) = r.get("relations") {
            for rel in array(rels)? {
                let target = if map {
                    mapped
                        .get(text(&rel["targetId"])?)
                        .cloned()
                        .unwrap_or(Value::Null)
                } else {
                    rel["targetId"].clone()
                };
                result.push((text(&rel["type"])?.into(), target.to_string()));
            }
        }
        result.sort();
        Ok(result)
    };
    let mut records = 0;
    for &(i, j) in &pairs {
        if eligible.contains(&i)
            && (!covered || relation_keys(left[i], true)? == relation_keys(right[j], false)?)
        {
            records += 1;
        }
    }
    for stat in fields.values_mut() {
        stat["accuracy"] =
            json!(stat["correct"].as_f64().unwrap() / stat["evaluated"].as_f64().unwrap());
    }
    let mut completeness = counts(records, right.len() - records, left.len() - records);
    completeness["definition"] = json!(if covered {
        "exact-anchor+evaluated-fields+evidence+outgoing-relations"
    } else {
        "exact-anchor+evaluated-fields+evidence; relation coverage not declared"
    });
    Ok(
        json!({"format":"nextmedtator-comparison-v1","referenceHash":a["hash"],"candidateHash":b["hash"],"schemaHash":a["schemaHash"],"interpretation":if o["referenceDeclared"]==true{"comparison-to-declared-reference"}else{"disagreement-analysis-not-accuracy"},"matching":{"algorithm":"deterministic-maximum-cardinality-v1","mode":mode,"iou":if mode=="overlap"{Some(threshold)}else{None}},"coverage":{"evaluated":evaluated,"excluded":source_ids.iter().filter(|id|!allowed.contains(id.as_str())).collect::<Vec<_>>(),"policy":if complete{"complete-reference-documents"}else{"explicit-partial-comparison"}},"anchors":counts(pairs.len(),extra.len(),missing.len()),"evaluatedFieldTuples":counts(tuples,right.len()-tuples,left.len()-tuples),"fields":fields,"disagreements":disagreements,"recordCompleteness":completeness,"relationMetrics":if covered{counts(relation_tp,actual.len()-relation_tp,expected.len()-relation_tp)}else{json!({"status":"not-applicable","reason":"Relation coverage must be declared for both inputs"})},"support":{"documents":evaluated.len(),"referenceRecords":left.len(),"candidateRecords":right.len(),"referenceRelations":expected.len(),"candidateRelations":actual.len()},"goldStandardClaim":false}),
    )
}
pub fn execute(input: Value) -> Result<Value> {
    match text(&input["operation"])? {
        "health" => Ok(
            json!({"protocol":"nextmedtator-core-v1","engine":"rust-wasm","version":env!("CARGO_PKG_VERSION")}),
        ),
        "validate" => {
            validate_records(&input["records"], &input["documents"], &input["schema"])?;
            Ok(json!({"valid":true}))
        }
        "compare" => compare(&input["reference"], &input["candidate"], &input["options"]),
        "offsets" => {
            let s = text(&input["text"])?;
            let mut utf16 = vec![0];
            let mut n = 0;
            for c in s.chars() {
                n += c.len_utf16();
                utf16.push(n);
            }
            Ok(json!({"codePointToUTF16":utf16}))
        }
        "search" => {
            let s = text(&input["text"])?;
            let needle = text(&input["needle"])?;
            if needle.is_empty() || needle.len() > 20000 {
                return Err("Invalid literal search".into());
            }
            let mut matches = Vec::new();
            let mut previous_byte = 0;
            let mut codepoint = 0;
            let width = needle.chars().count();
            for (byte, hit) in s.match_indices(needle) {
                codepoint += s[previous_byte..byte].chars().count();
                matches.push(json!({"start":codepoint,"end":codepoint+width,"text":hit}));
                previous_byte = byte;
                if matches.len() > 100_000 {
                    return Err("Search result limit".into());
                }
            }
            Ok(json!(matches))
        }
        _ => Err("Unsupported core operation".into()),
    }
}
thread_local! {static OUTPUT:std::cell::RefCell<Vec<u8>>=const{std::cell::RefCell::new(Vec::new())};}
#[no_mangle]
pub extern "C" fn allocate(len: u32) -> *mut u8 {
    let mut bytes = vec![0u8; len as usize];
    let ptr = bytes.as_mut_ptr();
    std::mem::forget(bytes);
    ptr
}
/// # Safety: caller supplies a live allocation with the same length.
#[no_mangle]
pub unsafe extern "C" fn release(ptr: *mut u8, len: u32) {
    drop(Vec::from_raw_parts(ptr, len as usize, len as usize));
}
/// # Safety: caller supplies a readable buffer allocated by this module.
#[no_mangle]
pub unsafe extern "C" fn dispatch(ptr: *const u8, len: u32) -> u32 {
    let result = serde_json::from_slice(std::slice::from_raw_parts(ptr, len as usize))
        .map_err(|_| "Invalid core request".into())
        .and_then(execute);
    let reply = match result {
        Ok(value) => json!({"ok":true,"value":value}),
        Err(message) => json!({"ok":false,"error":{"code":"CORE_VALIDATION","message":message}}),
    };
    OUTPUT.with(|out| {
        *out.borrow_mut() = serde_json::to_vec(&reply).unwrap();
        out.borrow().as_ptr() as u32
    })
}
#[no_mangle]
pub extern "C" fn result_length() -> u32 {
    OUTPUT.with(|out| out.borrow().len() as u32)
}
