use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

macro_rules! uuid_id {
    ($name:ident) => {
        #[derive(Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(Uuid);

        #[allow(clippy::new_without_default)]
        impl $name {
            pub fn new() -> Self {
                Self(Uuid::new_v4())
            }

            pub fn parse(raw: &str) -> Result<Self, IdParseError> {
                Uuid::parse_str(raw)
                    .map(Self)
                    .map_err(|source| IdParseError::InvalidUuid {
                        type_name: stringify!($name),
                        source,
                    })
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }

        impl FromStr for $name {
            type Err = IdParseError;

            fn from_str(raw: &str) -> Result<Self, Self::Err> {
                Self::parse(raw)
            }
        }
    };
}

uuid_id!(AiRequestId);
uuid_id!(ContextPackageId);
uuid_id!(EventId);
uuid_id!(OperationId);
uuid_id!(PatchId);
uuid_id!(ProjectId);
uuid_id!(ProposalId);
uuid_id!(RequestId);
uuid_id!(SourceIndexVersion);

#[derive(Debug, Error)]
pub enum IdParseError {
    #[error("invalid {type_name} UUID")]
    InvalidUuid {
        type_name: &'static str,
        #[source]
        source: uuid::Error,
    },
}
