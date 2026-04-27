use regex::Regex;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug)]
pub struct Redactor {
    patterns: Vec<RedactionPattern>,
}

impl Redactor {
    pub fn new() -> Result<Self, RedactionError> {
        Ok(Self {
            patterns: vec![
                RedactionPattern::new(
                    RedactionKind::PrivateKey,
                    r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----",
                    "[REDACTED_PRIVATE_KEY]",
                    true,
                )?,
                RedactionPattern::new(
                    RedactionKind::Token,
                    r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{16,}",
                    "[REDACTED_TOKEN]",
                    false,
                )?,
                RedactionPattern::new(
                    RedactionKind::Token,
                    r"\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b",
                    "[REDACTED_JWT]",
                    false,
                )?,
                RedactionPattern::new(
                    RedactionKind::Credential,
                    r"(?i)\b[A-Za-z][A-Za-z0-9+.-]*://[^/\s:@]+:[^@\s]+@[^/\s]+",
                    "[REDACTED_CONNECTION_STRING]",
                    true,
                )?,
                RedactionPattern::new(
                    RedactionKind::Secret,
                    r#"(?i)\b(api[_-]?key|token|secret|password|refresh[_-]?token)\s*[:=]\s*["']?[^\s"',;]{8,}"#,
                    "[REDACTED_SECRET_ASSIGNMENT]",
                    false,
                )?,
                RedactionPattern::new(
                    RedactionKind::Cookie,
                    r"(?i)\bcookie\s*[:=]\s*[^\r\n;]+(?:;[^\r\n;]+)*",
                    "[REDACTED_COOKIE]",
                    false,
                )?,
            ],
        })
    }

    pub fn redact_text(&self, content: &str, location: RedactionLocation) -> RedactedText {
        let mut redacted = content.to_owned();
        let mut findings = Vec::new();

        for pattern in &self.patterns {
            let matches = pattern.regex.find_iter(&redacted).count();
            if matches == 0 {
                continue;
            }

            findings.extend((0..matches).map(|_| RedactionFinding {
                kind: pattern.kind,
                location,
                replacement: pattern.replacement.to_owned(),
                blocked: pattern.blocked,
            }));
            redacted = pattern
                .regex
                .replace_all(&redacted, pattern.replacement)
                .into_owned();
        }

        let entropy_findings = redact_high_entropy(&mut redacted, location);
        findings.extend(entropy_findings);

        RedactedText {
            content: redacted,
            report: RedactionReport::from_findings(findings),
        }
    }
}

#[derive(Clone, Debug)]
struct RedactionPattern {
    kind: RedactionKind,
    regex: Regex,
    replacement: &'static str,
    blocked: bool,
}

impl RedactionPattern {
    fn new(
        kind: RedactionKind,
        raw_regex: &'static str,
        replacement: &'static str,
        blocked: bool,
    ) -> Result<Self, RedactionError> {
        let regex = Regex::new(raw_regex)
            .map_err(|source| RedactionError::InvalidPattern { kind, source })?;
        Ok(Self {
            kind,
            regex,
            replacement,
            blocked,
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RedactedText {
    pub content: String,
    pub report: RedactionReport,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RedactionReport {
    pub status: RedactionStatus,
    pub findings: Vec<RedactionFinding>,
}

impl RedactionReport {
    pub fn from_findings(findings: Vec<RedactionFinding>) -> Self {
        let status = if findings.iter().any(|finding| finding.blocked) {
            RedactionStatus::Blocked
        } else if findings.is_empty() {
            RedactionStatus::Clean
        } else {
            RedactionStatus::Redacted
        };

        Self { status, findings }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RedactionStatus {
    Clean,
    Redacted,
    Blocked,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RedactionFinding {
    pub kind: RedactionKind,
    pub location: RedactionLocation,
    pub replacement: String,
    pub blocked: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RedactionKind {
    Secret,
    Credential,
    Cookie,
    Token,
    PrivateKey,
    PasswordField,
    HighEntropy,
    ProtectedFile,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RedactionLocation {
    Dom,
    Screenshot,
    Source,
    Metadata,
    Log,
    Diagnostic,
}

#[derive(Debug, Error)]
pub enum RedactionError {
    #[error("invalid redaction pattern for {kind:?}")]
    InvalidPattern {
        kind: RedactionKind,
        #[source]
        source: regex::Error,
    },
}

fn redact_high_entropy(content: &mut String, location: RedactionLocation) -> Vec<RedactionFinding> {
    let mut findings = Vec::new();
    let mut redacted = String::with_capacity(content.len());

    for segment in content.split_inclusive(char::is_whitespace) {
        let (token, suffix) = split_suffix(segment);
        if is_high_entropy_token(token) {
            let fingerprint = token.chars().take(4).collect::<String>();
            redacted.push_str(&format!("[REDACTED_TOKEN:{fingerprint}]"));
            redacted.push_str(suffix);
            findings.push(RedactionFinding {
                kind: RedactionKind::HighEntropy,
                location,
                replacement: "[REDACTED_TOKEN]".to_owned(),
                blocked: false,
            });
        } else {
            redacted.push_str(segment);
        }
    }

    *content = redacted;
    findings
}

fn split_suffix(segment: &str) -> (&str, &str) {
    let trimmed = segment.trim_end_matches(char::is_whitespace);
    segment.split_at(trimmed.len())
}

fn is_high_entropy_token(token: &str) -> bool {
    if token.len() < 32 || token.len() > 256 {
        return false;
    }

    let alpha = token
        .chars()
        .any(|character| character.is_ascii_alphabetic());
    let digit = token.chars().any(|character| character.is_ascii_digit());
    let symbol = token
        .chars()
        .any(|character| matches!(character, '_' | '-' | '.' | '/' | '+'));
    let allowed = token
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "_-./+=".contains(character));

    allowed && alpha && digit && symbol
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_secrets_before_context_packaging() {
        let redactor = Redactor::new().expect("redaction patterns compile");
        let text =
            "const token = \"sk-abc123456789secret\";\nAuthorization: Bearer abcdefghijklmnop12345";
        let redacted = redactor.redact_text(text, RedactionLocation::Source);

        assert!(!redacted.content.contains("abcdefghijklmnop12345"));
        assert_eq!(redacted.report.status, RedactionStatus::Redacted);
    }

    #[test]
    fn blocks_private_keys() {
        let redactor = Redactor::new().expect("redaction patterns compile");
        let text = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----";
        let redacted = redactor.redact_text(text, RedactionLocation::Diagnostic);

        assert_eq!(redacted.report.status, RedactionStatus::Blocked);
        assert!(redacted.content.contains("[REDACTED_PRIVATE_KEY]"));
    }
}
