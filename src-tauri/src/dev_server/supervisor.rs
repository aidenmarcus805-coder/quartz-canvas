use std::{collections::HashMap, process::Stdio, sync::Arc, time::Duration};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::{
    net::TcpStream,
    process::{Child, Command},
    sync::Mutex,
    time,
};

use crate::{
    dev_server::{
        command::{DevCommand, DevCommandError, DevCommandInput},
        logs::{spawn_log_reader, DevLogBuffer, DevLogLine, LogStream},
    },
    domain::ProjectId,
    project::{detect::PackageManager, ActiveProject},
    security::Redactor,
};

#[derive(Debug)]
pub struct DevServerRegistry {
    servers: Mutex<HashMap<ProjectId, ManagedServer>>,
    logs: Arc<DevLogBuffer>,
    redactor: Arc<Redactor>,
}

impl DevServerRegistry {
    pub fn new(redactor: Arc<Redactor>) -> Self {
        Self {
            servers: Mutex::new(HashMap::new()),
            logs: Arc::new(DevLogBuffer::new(500)),
            redactor,
        }
    }

    pub async fn start(
        &self,
        project: ActiveProject,
        request: StartDevServerRequest,
    ) -> Result<DevServerSnapshot, DevServerError> {
        let command = DevCommand::from_input(project.root.clone(), request.command)?;
        let fingerprint = command.approval_fingerprint();
        if !command_matches_project_script(&project, &command) {
            return Err(DevServerError::ApprovalRequired { fingerprint });
        }

        if let Some(port) = command.expected_port {
            if probe_port(port).await {
                return Err(DevServerError::PortUnavailable { port });
            }
        }

        let mut child = spawn_child(&command)?;
        let process_id = child.id().ok_or(DevServerError::ProcessIdUnavailable)?;
        attach_log_readers(
            &mut child,
            &project,
            self.logs.clone(),
            self.redactor.clone(),
        );

        if let Some(port) = command.expected_port {
            if !probe_port(port).await {
                terminate_child(child).await?;
                return Err(DevServerError::ReadyTimeout);
            }
        }

        if let Some(status) = child
            .try_wait()
            .map_err(|source| DevServerError::Wait { source })?
        {
            return Err(DevServerError::ExitedEarly {
                code: status.code(),
            });
        }

        let snapshot = DevServerSnapshot::running(process_id, command.expected_port);
        self.servers.lock().await.insert(
            project.project_id.clone(),
            ManagedServer {
                child,
                project_epoch: project.project_epoch,
                snapshot: snapshot.clone(),
            },
        );

        Ok(snapshot.with_logs(
            self.logs
                .recent_for(&project.project_id, project.project_epoch)
                .await,
        ))
    }

    pub async fn stop(&self, project_id: &ProjectId) -> Result<DevServerSnapshot, DevServerError> {
        let managed = self.servers.lock().await.remove(project_id);
        match managed {
            Some(server) => {
                terminate_child(server.child).await?;
                Ok(DevServerSnapshot::stopped()
                    .with_logs(self.logs.recent_for(project_id, server.project_epoch).await))
            }
            None => Ok(DevServerSnapshot::stopped().with_logs(Vec::new())),
        }
    }

    pub async fn snapshot(&self, project_id: Option<&ProjectId>) -> DevServerSnapshot {
        if let Some(project_id) = project_id {
            let mut servers = self.servers.lock().await;
            if let Some(server) = servers.get_mut(project_id) {
                refresh_exit_state(server);
                return server
                    .snapshot
                    .clone()
                    .with_logs(self.logs.recent_for(project_id, server.project_epoch).await);
            }
        }

        DevServerSnapshot::stopped().with_logs(Vec::new())
    }
}

#[derive(Debug)]
struct ManagedServer {
    child: Child,
    project_epoch: u64,
    snapshot: DevServerSnapshot,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDevServerRequest {
    pub command: DevCommandInput,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevServerSnapshot {
    pub state: DevServerState,
    pub ownership: Option<DevServerOwnership>,
    pub recent_logs: Vec<DevLogLine>,
    pub updated_at: DateTime<Utc>,
}

impl DevServerSnapshot {
    fn stopped() -> Self {
        Self {
            state: DevServerState::Stopped,
            ownership: None,
            recent_logs: Vec::new(),
            updated_at: Utc::now(),
        }
    }

    fn running(process_id: u32, expected_port: Option<u16>) -> Self {
        let url = expected_port.map(|port| format!("http://127.0.0.1:{port}"));
        Self {
            state: DevServerState::Running {
                process_id,
                url,
                started_at: Utc::now(),
            },
            ownership: Some(DevServerOwnership::Managed),
            recent_logs: Vec::new(),
            updated_at: Utc::now(),
        }
    }

    fn with_logs(mut self, logs: Vec<DevLogLine>) -> Self {
        self.recent_logs = logs;
        self.updated_at = Utc::now();
        self
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case", tag = "state")]
pub enum DevServerState {
    Stopped,
    Starting {
        process_id: u32,
        started_at: DateTime<Utc>,
    },
    Running {
        process_id: u32,
        url: Option<String>,
        started_at: DateTime<Utc>,
    },
    Restarting {
        previous_process_id: Option<u32>,
    },
    Failed {
        reason: DevServerFailure,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DevServerOwnership {
    Managed,
    Attached,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum DevServerFailure {
    CommandNotFound,
    PortUnavailable { port: u16 },
    SpawnDenied,
    ReadyTimeout,
    ExitedEarly { code: Option<i32> },
    Io,
}

#[derive(Debug, Error)]
pub enum DevServerError {
    #[error("dev command requires approval")]
    ApprovalRequired { fingerprint: String },
    #[error("invalid dev command")]
    InvalidCommand(#[from] DevCommandError),
    #[error("dev server did not report a process id")]
    ProcessIdUnavailable,
    #[error("failed to spawn dev server")]
    Spawn {
        #[source]
        source: std::io::Error,
    },
    #[error("dev server readiness timed out")]
    ReadyTimeout,
    #[error("dev server port is already in use")]
    PortUnavailable { port: u16 },
    #[error("dev server exited before it was ready")]
    ExitedEarly { code: Option<i32> },
    #[error("failed to stop dev server")]
    Stop {
        #[source]
        source: std::io::Error,
    },
    #[error("failed to wait for dev server")]
    Wait {
        #[source]
        source: std::io::Error,
    },
}

fn command_matches_project_script(project: &ActiveProject, command: &DevCommand) -> bool {
    let Some(package_manager) = project.manifest.package_manager else {
        return false;
    };

    let Some(script) = script_from_command(package_manager, command) else {
        return false;
    };

    project
        .manifest
        .available_scripts
        .iter()
        .any(|available| available == script)
}

fn script_from_command(package_manager: PackageManager, command: &DevCommand) -> Option<&str> {
    if !program_matches_package_manager(package_manager, &command.program) {
        return None;
    }

    match package_manager {
        PackageManager::Npm => match command.args.as_slice() {
            [verb, script] if verb == "run" || verb == "run-script" => Some(script.as_str()),
            _ => None,
        },
        PackageManager::Pnpm | PackageManager::Yarn | PackageManager::Bun => {
            match command.args.as_slice() {
                [verb, script] if verb == "run" => Some(script.as_str()),
                [script] => Some(script.as_str()),
                _ => None,
            }
        }
    }
}

fn program_matches_package_manager(package_manager: PackageManager, program: &str) -> bool {
    let normalized = program
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(program)
        .trim_end_matches(".cmd")
        .trim_end_matches(".exe")
        .to_ascii_lowercase();

    matches!(
        (package_manager, normalized.as_str()),
        (PackageManager::Npm, "npm")
            | (PackageManager::Pnpm, "pnpm")
            | (PackageManager::Yarn, "yarn")
            | (PackageManager::Bun, "bun")
    )
}

fn spawn_child(command: &DevCommand) -> Result<Child, DevServerError> {
    let mut process = Command::new(&command.program);
    process
        .args(&command.args)
        .current_dir(command.cwd.path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    for (name, content) in inherited_safe_env() {
        process.env(name, content);
    }

    for (name, content) in &command.env {
        process.env(name, content);
    }

    process
        .spawn()
        .map_err(|source| DevServerError::Spawn { source })
}

fn inherited_safe_env() -> Vec<(String, String)> {
    ["PATH", "Path", "SYSTEMROOT", "COMSPEC", "TEMP", "TMP"]
        .iter()
        .filter_map(|name| {
            std::env::var(name)
                .ok()
                .map(|content| ((*name).to_owned(), content))
        })
        .collect()
}

fn attach_log_readers(
    child: &mut Child,
    project: &ActiveProject,
    buffer: Arc<DevLogBuffer>,
    redactor: Arc<Redactor>,
) {
    if let Some(stdout) = child.stdout.take() {
        spawn_log_reader(
            stdout,
            LogStream::Stdout,
            project.project_id.clone(),
            project.project_epoch,
            buffer.clone(),
            redactor.clone(),
        );
    }

    if let Some(stderr) = child.stderr.take() {
        spawn_log_reader(
            stderr,
            LogStream::Stderr,
            project.project_id.clone(),
            project.project_epoch,
            buffer,
            redactor,
        );
    }
}

async fn probe_port(port: u16) -> bool {
    let address = ("127.0.0.1", port);
    for _ in 0..20 {
        if time::timeout(Duration::from_millis(200), TcpStream::connect(address))
            .await
            .is_ok_and(|connection| connection.is_ok())
        {
            return true;
        }
        time::sleep(Duration::from_millis(100)).await;
    }
    false
}

async fn terminate_child(mut child: Child) -> Result<(), DevServerError> {
    child
        .start_kill()
        .map_err(|source| DevServerError::Stop { source })?;
    child
        .wait()
        .await
        .map_err(|source| DevServerError::Wait { source })?;
    Ok(())
}

fn refresh_exit_state(server: &mut ManagedServer) {
    match server.child.try_wait() {
        Ok(Some(status)) => {
            server.snapshot.state = DevServerState::Failed {
                reason: DevServerFailure::ExitedEarly {
                    code: status.code(),
                },
            };
            server.snapshot.updated_at = Utc::now();
        }
        Ok(None) => {}
        Err(_) => {
            server.snapshot.state = DevServerState::Failed {
                reason: DevServerFailure::Io,
            };
            server.snapshot.updated_at = Utc::now();
        }
    }
}
