pub mod detect;
pub mod lifecycle;

pub use lifecycle::{
    ActiveProject, OpenProjectRequest, OpenProjectResponse, ProjectError, ProjectRuntimeState,
    ProjectService, ProjectSnapshot,
};
