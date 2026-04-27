use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::security::{RedactionLocation, RedactionReport, Redactor};

#[derive(Debug)]
pub struct DiagnosticService {
    redactor: Arc<Redactor>,
}

impl DiagnosticService {
    pub fn new(redactor: Arc<Redactor>) -> Self {
        Self { redactor }
    }

    pub fn redact_message(&self, message: &str) -> DiagnosticsSnapshot {
        let redacted = self
            .redactor
            .redact_text(message, RedactionLocation::Diagnostic);
        DiagnosticsSnapshot {
            redacted_message: redacted.content,
            redaction: redacted.report,
            generated_at: Utc::now(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSnapshot {
    pub redacted_message: String,
    pub redaction: RedactionReport,
    pub generated_at: DateTime<Utc>,
}
