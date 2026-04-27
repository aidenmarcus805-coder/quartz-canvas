use thiserror::Error;

pub async fn run<T, F>(task: F) -> Result<T, BlockingError>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|source| BlockingError::Join { source })
}

#[derive(Debug, Error)]
pub enum BlockingError {
    #[error("blocking task failed to join")]
    Join {
        #[source]
        source: tokio::task::JoinError,
    },
}
