use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::fs::SafeProjectRoot;

#[derive(Clone, Debug)]
pub struct DevCommand {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: SafeProjectRoot,
    pub env: BTreeMap<String, String>,
    pub expected_port: Option<u16>,
}

impl DevCommand {
    pub fn from_input(
        root: SafeProjectRoot,
        input: DevCommandInput,
    ) -> Result<Self, DevCommandError> {
        validate_token(&input.program)?;
        for arg in &input.args {
            validate_arg(arg)?;
        }

        if input.env.keys().any(|name| is_secret_env_name(name)) {
            return Err(DevCommandError::SecretEnvironment);
        }

        Ok(Self {
            program: input.program,
            args: input.args,
            cwd: root,
            env: input.env,
            expected_port: input.expected_port,
        })
    }

    pub fn approval_fingerprint(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.program.as_bytes());
        for arg in &self.args {
            hasher.update([0]);
            hasher.update(arg.as_bytes());
        }
        for (name, content) in &self.env {
            hasher.update([0]);
            hasher.update(name.as_bytes());
            hasher.update([b'=']);
            hasher.update(content.as_bytes());
        }
        if let Some(port) = self.expected_port {
            hasher.update(port.to_be_bytes());
        }
        hex::encode(hasher.finalize())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevCommandInput {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub expected_port: Option<u16>,
}

#[derive(Debug, Error)]
pub enum DevCommandError {
    #[error("dev command program is empty")]
    EmptyProgram,
    #[error("dev command program must be argv-safe")]
    UnsafeProgram,
    #[error("dev command argument contains a null byte")]
    UnsafeArgument,
    #[error("dev command environment contains a secret-like key")]
    SecretEnvironment,
}

fn validate_token(program: &str) -> Result<(), DevCommandError> {
    if program.trim().is_empty() {
        return Err(DevCommandError::EmptyProgram);
    }

    if program.contains('\0') || looks_like_shell(program) {
        return Err(DevCommandError::UnsafeProgram);
    }

    Ok(())
}

fn validate_arg(arg: &str) -> Result<(), DevCommandError> {
    if arg.contains('\0') {
        return Err(DevCommandError::UnsafeArgument);
    }

    Ok(())
}

fn looks_like_shell(program: &str) -> bool {
    matches!(
        program.to_ascii_lowercase().as_str(),
        "bash" | "cmd" | "cmd.exe" | "powershell" | "powershell.exe" | "pwsh" | "sh"
    )
}

fn is_secret_env_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("token")
        || lower.contains("secret")
        || lower.contains("password")
        || lower.contains("credential")
        || lower.contains("key")
}
