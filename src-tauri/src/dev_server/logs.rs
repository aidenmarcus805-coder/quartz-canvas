use std::{collections::VecDeque, sync::Arc};

use chrono::{DateTime, Utc};
use serde::Serialize;
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, BufReader},
    sync::Mutex,
};

use crate::{
    domain::ProjectId,
    security::{RedactionLocation, Redactor},
};

#[derive(Debug)]
pub struct DevLogBuffer {
    lines: Mutex<VecDeque<DevLogLine>>,
    capacity: usize,
}

impl DevLogBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            lines: Mutex::new(VecDeque::with_capacity(capacity)),
            capacity,
        }
    }

    pub async fn push(&self, line: DevLogLine) {
        let mut lines = self.lines.lock().await;
        if lines.len() == self.capacity {
            lines.pop_front();
        }
        lines.push_back(line);
    }

    pub async fn recent(&self) -> Vec<DevLogLine> {
        self.lines.lock().await.iter().cloned().collect()
    }

    pub async fn recent_for(&self, project_id: &ProjectId, project_epoch: u64) -> Vec<DevLogLine> {
        self.lines
            .lock()
            .await
            .iter()
            .filter(|line| line.project_id == *project_id && line.project_epoch == project_epoch)
            .cloned()
            .collect()
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevLogLine {
    pub project_id: ProjectId,
    pub project_epoch: u64,
    pub stream: LogStream,
    pub line: String,
    pub captured_at: DateTime<Utc>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LogStream {
    Stdout,
    Stderr,
}

pub fn spawn_log_reader<R>(
    reader: R,
    stream: LogStream,
    project_id: ProjectId,
    project_epoch: u64,
    buffer: Arc<DevLogBuffer>,
    redactor: Arc<Redactor>,
) where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let redacted = redactor.redact_text(&line, RedactionLocation::Log);
            buffer
                .push(DevLogLine {
                    project_id: project_id.clone(),
                    project_epoch,
                    stream,
                    line: redacted.content,
                    captured_at: Utc::now(),
                })
                .await;
        }
    });
}
