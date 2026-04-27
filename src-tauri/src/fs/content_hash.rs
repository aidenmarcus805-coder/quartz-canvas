use std::{fmt, fs, path::Path};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ContentHash(String);

impl ContentHash {
    pub fn from_bytes(bytes: &[u8]) -> Self {
        let digest = Sha256::digest(bytes);
        Self(hex::encode(digest))
    }

    pub fn from_text(text: &str) -> Self {
        Self::from_bytes(text.as_bytes())
    }

    pub fn from_file(path: &Path) -> Result<Self, ContentHashError> {
        let bytes = fs::read(path).map_err(|source| ContentHashError::Read { source })?;
        Ok(Self::from_bytes(&bytes))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ContentHash {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Debug, Error)]
pub enum ContentHashError {
    #[error("failed to read file for hashing")]
    Read {
        #[source]
        source: std::io::Error,
    },
}
