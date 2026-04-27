use thiserror::Error;

pub fn apply_unified_diff(original: &str, diff: &str) -> Result<String, DiffApplyError> {
    let source = TextLines::from_text(original);
    let diff_lines = normalize_diff_lines(diff);
    let mut diff_index = find_file_header(&diff_lines)?;

    diff_index += 1;
    if !matches!(diff_lines.get(diff_index), Some(line) if line.starts_with("+++ ")) {
        return Err(DiffApplyError::MissingFileHeader);
    }
    diff_index += 1;

    let mut source_index = 0;
    let mut output = Vec::new();
    let mut saw_hunk = false;

    while diff_index < diff_lines.len() {
        let header = diff_lines
            .get(diff_index)
            .ok_or(DiffApplyError::MissingHunk)?;
        if !header.starts_with("@@ ") {
            return Err(DiffApplyError::UnsupportedLine {
                line: header.clone(),
            });
        }

        let hunk = HunkHeader::parse(header)?;
        diff_index += 1;
        apply_hunk(
            &diff_lines,
            &mut diff_index,
            &source,
            &mut source_index,
            &mut output,
            hunk,
        )?;
        saw_hunk = true;
    }

    if !saw_hunk {
        return Err(DiffApplyError::MissingHunk);
    }

    output.extend(source.lines[source_index..].iter().cloned());
    Ok(TextLines::to_text(&output, source.line_ending))
}

fn normalize_diff_lines(diff: &str) -> Vec<String> {
    diff.lines()
        .map(|line| line.trim_end_matches('\r').to_owned())
        .collect()
}

fn find_file_header(diff_lines: &[String]) -> Result<usize, DiffApplyError> {
    diff_lines
        .iter()
        .position(|line| line.starts_with("--- "))
        .ok_or(DiffApplyError::MissingFileHeader)
}

fn apply_hunk(
    diff_lines: &[String],
    diff_index: &mut usize,
    source: &TextLines,
    source_index: &mut usize,
    output: &mut Vec<String>,
    hunk: HunkHeader,
) -> Result<(), DiffApplyError> {
    let hunk_source_index = hunk.old_start.saturating_sub(1);
    if hunk_source_index < *source_index {
        return Err(DiffApplyError::OverlappingHunk);
    }
    if hunk_source_index > source.lines.len() {
        return Err(DiffApplyError::HunkOutOfBounds);
    }

    output.extend(
        source.lines[*source_index..hunk_source_index]
            .iter()
            .cloned(),
    );
    *source_index = hunk_source_index;

    let mut old_consumed = 0;
    let mut new_produced = 0;

    while *diff_index < diff_lines.len() {
        let line = &diff_lines[*diff_index];
        if line.starts_with("@@ ") {
            break;
        }

        apply_hunk_line(
            line,
            source,
            source_index,
            output,
            &mut old_consumed,
            &mut new_produced,
        )?;
        *diff_index += 1;
    }

    if old_consumed != hunk.old_count || new_produced != hunk.new_count {
        return Err(DiffApplyError::HunkCountMismatch);
    }

    Ok(())
}

fn apply_hunk_line(
    line: &str,
    source: &TextLines,
    source_index: &mut usize,
    output: &mut Vec<String>,
    old_consumed: &mut usize,
    new_produced: &mut usize,
) -> Result<(), DiffApplyError> {
    let mut chars = line.chars();
    let marker = chars
        .next()
        .ok_or_else(|| DiffApplyError::UnsupportedLine { line: line.into() })?;
    let content = chars.as_str();

    match marker {
        ' ' => {
            require_source_line(
                source,
                *source_index,
                content,
                DiffApplyError::ContextMismatch,
            )?;
            output.push(content.to_owned());
            *source_index += 1;
            *old_consumed += 1;
            *new_produced += 1;
        }
        '-' => {
            require_source_line(
                source,
                *source_index,
                content,
                DiffApplyError::RemovalMismatch,
            )?;
            *source_index += 1;
            *old_consumed += 1;
        }
        '+' => {
            output.push(content.to_owned());
            *new_produced += 1;
        }
        '\\' => return Err(DiffApplyError::UnsupportedNoNewlineMarker),
        _ => return Err(DiffApplyError::UnsupportedLine { line: line.into() }),
    }

    Ok(())
}

fn require_source_line(
    source: &TextLines,
    index: usize,
    expected: &str,
    mismatch: DiffApplyError,
) -> Result<(), DiffApplyError> {
    let actual = source
        .lines
        .get(index)
        .ok_or(DiffApplyError::HunkOutOfBounds)?;
    if actual == expected {
        return Ok(());
    }

    Err(mismatch)
}

#[derive(Clone, Copy, Debug)]
struct HunkHeader {
    old_start: usize,
    old_count: usize,
    new_count: usize,
}

impl HunkHeader {
    fn parse(header: &str) -> Result<Self, DiffApplyError> {
        let body = header
            .strip_prefix("@@ ")
            .ok_or_else(|| malformed_hunk(header))?;
        let range_end = body.find(" @@").ok_or_else(|| malformed_hunk(header))?;
        let mut ranges = body[..range_end].split_whitespace();
        let (old_start, old_count) = parse_range(ranges.next(), '-', header)?;
        let (_new_start, new_count) = parse_range(ranges.next(), '+', header)?;

        if ranges.next().is_some() {
            return Err(malformed_hunk(header));
        }

        Ok(Self {
            old_start,
            old_count,
            new_count,
        })
    }
}

fn parse_range(
    range: Option<&str>,
    prefix: char,
    header: &str,
) -> Result<(usize, usize), DiffApplyError> {
    let range = range
        .and_then(|raw| raw.strip_prefix(prefix))
        .ok_or_else(|| malformed_hunk(header))?;
    let (start, count) = range.split_once(',').unwrap_or((range, "1"));
    let start = start.parse().map_err(|_| malformed_hunk(header))?;
    let count = count.parse().map_err(|_| malformed_hunk(header))?;
    Ok((start, count))
}

fn malformed_hunk(header: &str) -> DiffApplyError {
    DiffApplyError::MalformedHunkHeader {
        header: header.to_owned(),
    }
}

#[derive(Debug)]
struct TextLines {
    lines: Vec<String>,
    line_ending: &'static str,
}

impl TextLines {
    fn from_text(text: &str) -> Self {
        let line_ending = if text.contains("\r\n") { "\r\n" } else { "\n" };
        let trailing_newline = text.ends_with(line_ending);
        let body = if trailing_newline {
            text.strip_suffix(line_ending).unwrap_or(text)
        } else {
            text
        };
        let lines = if body.is_empty() {
            if text.is_empty() {
                Vec::new()
            } else {
                vec![String::new()]
            }
        } else {
            body.split(line_ending)
                .map(|line| line.trim_end_matches('\r').to_owned())
                .collect()
        };

        Self { lines, line_ending }
    }

    fn to_text(lines: &[String], line_ending: &str) -> String {
        if lines.is_empty() {
            return String::new();
        }

        let mut text = lines.join(line_ending);
        text.push_str(line_ending);
        text
    }
}

#[derive(Debug, Error)]
pub enum DiffApplyError {
    #[error("unified diff is missing file headers")]
    MissingFileHeader,
    #[error("unified diff does not contain a hunk")]
    MissingHunk,
    #[error("malformed hunk header: {header}")]
    MalformedHunkHeader { header: String },
    #[error("unsupported no-newline marker")]
    UnsupportedNoNewlineMarker,
    #[error("unsupported unified diff line: {line}")]
    UnsupportedLine { line: String },
    #[error("hunk overlaps a previous hunk")]
    OverlappingHunk,
    #[error("hunk points past the end of the source file")]
    HunkOutOfBounds,
    #[error("hunk context does not match the source file")]
    ContextMismatch,
    #[error("hunk removal does not match the source file")]
    RemovalMismatch,
    #[error("hunk line counts do not match the hunk header")]
    HunkCountMismatch,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_single_file_hunk() {
        let diff = "--- a/file.txt\n+++ b/file.txt\n@@ -1,2 +1,2 @@\n alpha\n-beta\n+gamma\n";
        let patched = apply_unified_diff("alpha\nbeta\n", diff);

        assert_eq!(patched.expect("diff applies"), "alpha\ngamma\n");
    }

    #[test]
    fn rejects_no_newline_marker() {
        let diff =
            "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-alpha\n+beta\n\\ No newline at end of file\n";
        let patched = apply_unified_diff("alpha\n", diff);

        assert!(matches!(
            patched,
            Err(DiffApplyError::UnsupportedNoNewlineMarker)
        ));
    }
}
