use std::{
    ffi::OsStr,
    path::{Component, Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const QWOPUS_MODEL_ID: &str = "qwopus-glm-18b";
pub const QWOPUS_GLM_18B_REPO: &str = "KyleHessling1/Qwopus-GLM-18B-Merged-GGUF";
pub const TERNARY_BONSAI_8B_MODEL_ID: &str = "ternary-bonsai-8b";
pub const TERNARY_BONSAI_8B_REPO: &str = "lilyanatia/Ternary-Bonsai-8B-GGUF";
pub const TERNARY_BONSAI_4B_MODEL_ID: &str = "ternary-bonsai-4b";
pub const TERNARY_BONSAI_4B_REPO: &str = "prism-ml/Ternary-Bonsai-4B-gguf";
pub const TERNARY_BONSAI_17B_MODEL_ID: &str = "ternary-bonsai-1.7b";
pub const TERNARY_BONSAI_17B_REPO: &str = "prism-ml/Ternary-Bonsai-1.7B-gguf";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuMemoryProfile {
    pub dedicated_vram_gb: u16,
    pub ddr5_ram_gb: Option<u16>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum QuantizationTier {
    #[serde(rename = "q2_k")]
    Q2K,
    #[serde(rename = "q2_0")]
    Q20,
    #[serde(rename = "q3_k_m")]
    Q3KM,
    #[serde(rename = "q4_k_m")]
    Q4KM,
    #[serde(rename = "q5_k_m")]
    Q5KM,
    #[serde(rename = "q6_k")]
    Q6K,
    #[serde(rename = "q8_0")]
    Q80,
    #[serde(rename = "f16")]
    F16,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum KvCachePlacement {
    Gpu,
    SystemRam,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QwopusRuntimePlan {
    pub repo: &'static str,
    pub model_file: &'static str,
    pub quantization: QuantizationTier,
    pub gguf_size_gb: f32,
    pub context_size_tokens: u32,
    pub gpu_layers: u16,
    pub flash_attention: bool,
    pub kv_cache: KvCachePlacement,
    pub mmap_model: bool,
    pub mlock_model: bool,
    pub cpu_spill_enabled: bool,
    pub minimum_recommended_ddr5_gb: u16,
    pub llama_server_args: Vec<String>,
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelProfile {
    pub id: String,
    pub display_name: String,
    pub family: String,
    pub repo: String,
    pub license: String,
    pub recommended_use: String,
    pub quantizations: Vec<ModelQuantizationOption>,
    pub vram_tiers: Vec<ModelVramTier>,
    pub runtimes: ModelRuntimeSupport,
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelQuantizationOption {
    pub quantization: QuantizationTier,
    pub model_file: String,
    pub gguf_size_gb: f32,
    pub context_size_tokens: u32,
    pub minimum_vram_gb: u16,
    pub minimum_recommended_ddr5_gb: u16,
    pub recommended: bool,
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelVramTier {
    pub dedicated_vram_gb: u16,
    pub recommended_quantization: QuantizationTier,
    pub context_size_tokens: u32,
    pub gpu_layers: u16,
    pub kv_cache: KvCachePlacement,
    pub ddr5_spillover: bool,
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRuntimeSupport {
    pub llama_cpp_supported: bool,
    pub ollama_modelfile_supported: bool,
    pub caveats: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRuntimePlanRequest {
    pub model_id: String,
    pub gpu: GpuMemoryProfile,
    pub quantization: Option<QuantizationTier>,
    pub context_size_tokens: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelRuntimePlan {
    pub model_id: String,
    pub display_name: String,
    pub repo: String,
    pub model_file: String,
    pub quantization: QuantizationTier,
    pub gguf_size_gb: f32,
    pub context_size_tokens: u32,
    pub gpu_layers: u16,
    pub flash_attention: bool,
    pub kv_cache: KvCachePlacement,
    pub mmap_model: bool,
    pub mlock_model: bool,
    pub cpu_spill_enabled: bool,
    pub minimum_recommended_ddr5_gb: u16,
    pub llama_cpp: RuntimeControlPlan,
    pub ollama: RuntimeControlPlan,
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeControlPlan {
    pub supported: bool,
    pub suggested_tag: Option<String>,
    pub modelfile: Option<String>,
    pub create_args: Vec<String>,
    pub run_args: Vec<String>,
    pub server_args: Vec<String>,
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelImportPlanRequest {
    pub source: ModelImportSource,
    pub model_id: Option<String>,
    pub quantization: Option<QuantizationTier>,
    pub ollama_model_name: Option<String>,
    pub context_size_tokens: Option<u32>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", tag = "sourceType")]
pub enum ModelImportSource {
    LocalGgufPath { path: PathBuf },
    HuggingFaceRepo { repo: String, file: String },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelImportPlan {
    pub source_type: String,
    pub model_id: Option<String>,
    pub repo: Option<String>,
    pub file: String,
    pub validated_local_path: Option<String>,
    pub quantization: Option<QuantizationTier>,
    pub ollama_tag: String,
    pub modelfile: String,
    pub ollama_create_args: Vec<String>,
    pub llama_server_args: Vec<String>,
    pub download_required: bool,
    pub instructions: Vec<String>,
    pub warnings: Vec<String>,
}

pub fn plan_qwopus_runtime(
    profile: GpuMemoryProfile,
) -> Result<QwopusRuntimePlan, ModelProfileError> {
    if profile.dedicated_vram_gb < 8 {
        return Err(ModelProfileError::InsufficientVram {
            detected_gb: profile.dedicated_vram_gb,
        });
    }

    let tier = if profile.dedicated_vram_gb >= 12 {
        q4_plan(profile.dedicated_vram_gb)
    } else {
        q3_plan()
    };

    Ok(tier.with_ram_notes(profile.ddr5_ram_gb))
}

pub fn model_profile_catalog() -> Vec<AiModelProfile> {
    vec![
        qwopus_profile(),
        bonsai_8b_profile(),
        bonsai_4b_profile(),
        bonsai_17b_profile(),
    ]
}

pub fn plan_local_model_runtime(
    request: ModelRuntimePlanRequest,
) -> Result<LocalModelRuntimePlan, ModelPlanningError> {
    match request.model_id.trim() {
        QWOPUS_MODEL_ID => plan_qwopus_local_runtime(request),
        TERNARY_BONSAI_8B_MODEL_ID => plan_bonsai_runtime(
            request,
            BonsaiSpec {
                model_id: TERNARY_BONSAI_8B_MODEL_ID,
                display_name: "Ternary Bonsai 8B",
                repo: TERNARY_BONSAI_8B_REPO,
                model_file: "Ternary-Bonsai-8B-Q2_K.gguf",
                gguf_size_gb: 3.25,
                context_size_tokens: 32_768,
                minimum_recommended_ddr5_gb: 16,
                quantization: QuantizationTier::Q2K,
                ollama_supported: true,
            },
        ),
        TERNARY_BONSAI_4B_MODEL_ID => plan_bonsai_runtime(
            request,
            BonsaiSpec {
                model_id: TERNARY_BONSAI_4B_MODEL_ID,
                display_name: "Ternary Bonsai 4B",
                repo: TERNARY_BONSAI_4B_REPO,
                model_file: "Ternary-Bonsai-4B-Q2_0.gguf",
                gguf_size_gb: 1.07,
                context_size_tokens: 32_768,
                minimum_recommended_ddr5_gb: 16,
                quantization: QuantizationTier::Q20,
                ollama_supported: false,
            },
        ),
        TERNARY_BONSAI_17B_MODEL_ID => plan_bonsai_runtime(
            request,
            BonsaiSpec {
                model_id: TERNARY_BONSAI_17B_MODEL_ID,
                display_name: "Ternary Bonsai 1.7B",
                repo: TERNARY_BONSAI_17B_REPO,
                model_file: "Ternary-Bonsai-1.7B-Q2_0.gguf",
                gguf_size_gb: 0.46,
                context_size_tokens: 32_768,
                minimum_recommended_ddr5_gb: 8,
                quantization: QuantizationTier::Q20,
                ollama_supported: false,
            },
        ),
        model_id => Err(ModelPlanningError::UnknownModel {
            model_id: model_id.to_owned(),
        }),
    }
}

pub fn plan_qwopus_runtime_from_request(
    request: ModelRuntimePlanRequest,
) -> Result<QwopusRuntimePlan, ModelPlanningError> {
    let plan = qwopus_plan_for_quant(request.gpu, request.quantization)?;
    apply_context_override(plan, request.context_size_tokens, 4_096, 65_536)
}

pub fn plan_model_import(
    request: ModelImportPlanRequest,
) -> Result<ModelImportPlan, ModelImportPlanError> {
    let source = validate_import_source(&request.source)?;
    let model_id = request
        .model_id
        .map(|id| id.trim().to_owned())
        .filter(|id| !id.is_empty());
    let quantization = request
        .quantization
        .or_else(|| detect_quantization_from_file(&source.file));
    let context_size_tokens = request.context_size_tokens.unwrap_or_else(|| {
        model_id
            .as_deref()
            .and_then(default_context_for_model)
            .unwrap_or(4_096)
    });
    let ollama_tag = request
        .ollama_model_name
        .unwrap_or_else(|| default_ollama_tag(model_id.as_deref(), &source.file, quantization));

    if !is_valid_ollama_name(&ollama_tag) {
        return Err(ModelImportPlanError::InvalidOllamaModelName { name: ollama_tag });
    }

    let from_line = source.modelfile_from.clone();
    let mut warnings = Vec::new();
    if from_line.chars().any(char::is_whitespace) {
        warnings.push(
            "The GGUF path contains whitespace; keep the Modelfile beside the file or quote/check the path before running ollama create."
                .to_owned(),
        );
    }
    if matches!(quantization, Some(QuantizationTier::Q20)) {
        warnings.push(
            "Q2_0 Bonsai GGUF support may require the Prism llama.cpp fork; verify Ollama support before importing."
                .to_owned(),
        );
    }

    let modelfile = format!("FROM {from_line}\nPARAMETER num_ctx {context_size_tokens}\n");
    let llama_server_args = vec![
        "-m".to_owned(),
        source.llama_model_arg.clone(),
        "--ctx-size".to_owned(),
        context_size_tokens.to_string(),
    ];

    Ok(ModelImportPlan {
        source_type: source.source_type,
        model_id,
        repo: source.repo,
        file: source.file,
        validated_local_path: source.validated_local_path,
        quantization,
        ollama_tag: ollama_tag.clone(),
        modelfile,
        ollama_create_args: vec![
            "ollama".to_owned(),
            "create".to_owned(),
            ollama_tag.clone(),
            "-f".to_owned(),
            "Modelfile".to_owned(),
        ],
        llama_server_args,
        download_required: source.download_required,
        instructions: source.instructions,
        warnings,
    })
}

fn q3_plan() -> QwopusRuntimePlan {
    QwopusRuntimePlan {
        repo: QWOPUS_GLM_18B_REPO,
        model_file: "Qwopus-GLM-18B-Healed-Q3_K_M.gguf",
        quantization: QuantizationTier::Q3KM,
        gguf_size_gb: 7.95,
        context_size_tokens: 32_768,
        gpu_layers: 36,
        flash_attention: true,
        kv_cache: KvCachePlacement::SystemRam,
        mmap_model: true,
        mlock_model: false,
        cpu_spill_enabled: true,
        minimum_recommended_ddr5_gb: 32,
        llama_server_args: Vec::new(),
        notes: vec![
            "8 GB VRAM profile: Q3_K_M keeps the model usable while reserving VRAM for runtime overhead."
                .to_owned(),
            "KV cache stays in system RAM so DDR5 absorbs context pressure instead of exhausting VRAM."
                .to_owned(),
        ],
    }
    .with_llama_args()
}

fn q4_plan(vram_gb: u16) -> QwopusRuntimePlan {
    let is_16gb_or_better = vram_gb >= 16;
    QwopusRuntimePlan {
        repo: QWOPUS_GLM_18B_REPO,
        model_file: "Qwopus-GLM-18B-Healed-Q4_K_M.gguf",
        quantization: QuantizationTier::Q4KM,
        gguf_size_gb: 9.84,
        context_size_tokens: if is_16gb_or_better { 65_536 } else { 49_152 },
        gpu_layers: if is_16gb_or_better { 99 } else { 52 },
        flash_attention: true,
        kv_cache: if is_16gb_or_better {
            KvCachePlacement::Gpu
        } else {
            KvCachePlacement::SystemRam
        },
        mmap_model: true,
        mlock_model: false,
        cpu_spill_enabled: true,
        minimum_recommended_ddr5_gb: if is_16gb_or_better { 32 } else { 48 },
        llama_server_args: Vec::new(),
        notes: vec![
            "12-16 GB VRAM profile: Q4_K_M is the default quality/performance target.".to_owned(),
            "CPU spill remains enabled through mmap and unlocked model pages so DDR5 can absorb non-offloaded layers."
                .to_owned(),
        ],
    }
    .with_llama_args()
}

impl QwopusRuntimePlan {
    fn with_llama_args(mut self) -> Self {
        let mut args = vec![
            "-m".to_owned(),
            self.model_file.to_owned(),
            "--ctx-size".to_owned(),
            self.context_size_tokens.to_string(),
            "--flash-attn".to_owned(),
            "on".to_owned(),
            "--n-gpu-layers".to_owned(),
            self.gpu_layers.to_string(),
            "--split-mode".to_owned(),
            "layer".to_owned(),
        ];

        if self.kv_cache == KvCachePlacement::SystemRam {
            args.push("--no-kv-offload".to_owned());
        }

        self.llama_server_args = args;
        self
    }

    fn with_ram_notes(mut self, ddr5_ram_gb: Option<u16>) -> Self {
        match ddr5_ram_gb {
            Some(ram_gb) if ram_gb < self.minimum_recommended_ddr5_gb => {
                self.notes.push(format!(
                    "Detected DDR5 RAM is below the {} GB recommended spillover budget.",
                    self.minimum_recommended_ddr5_gb
                ));
            }
            Some(ram_gb) => {
                self.notes.push(format!(
                    "Detected {ram_gb} GB DDR5 RAM is acceptable for CPU spillover."
                ));
            }
            None => self.notes.push(format!(
                "DDR5 RAM was not reported; assume at least {} GB for stable spillover.",
                self.minimum_recommended_ddr5_gb
            )),
        }
        self
    }
}

fn qwopus_profile() -> AiModelProfile {
    AiModelProfile {
        id: QWOPUS_MODEL_ID.to_owned(),
        display_name: "Qwopus GLM 18B Healed".to_owned(),
        family: "Qwopus / Qwen3.5".to_owned(),
        repo: QWOPUS_GLM_18B_REPO.to_owned(),
        license: "Apache-2.0".to_owned(),
        recommended_use: "Higher-quality local code and UI planning on 8-16 GB GPUs.".to_owned(),
        quantizations: vec![
            quant_option(QuantizationTier::Q3KM, "Qwopus-GLM-18B-Healed-Q3_K_M.gguf", 7.95, 32_768, 8, 32, true),
            quant_option(QuantizationTier::Q4KM, "Qwopus-GLM-18B-Healed-Q4_K_M.gguf", 9.84, 65_536, 12, 48, true),
            quant_option(QuantizationTier::Q5KM, "Qwopus-GLM-18B-Healed-Q5_K_M.gguf", 11.5, 65_536, 16, 48, false),
            quant_option(QuantizationTier::Q6K, "Qwopus-GLM-18B-Healed-Q6_K.gguf", 13.0, 65_536, 20, 64, false),
            quant_option(QuantizationTier::Q80, "Qwopus-GLM-18B-Healed-Q8_0.gguf", 16.9, 65_536, 24, 64, false),
        ],
        vram_tiers: vec![
            tier(8, QuantizationTier::Q3KM, 32_768, 36, KvCachePlacement::SystemRam, true, "8 GB VRAM uses Q3_K_M and keeps KV cache in DDR5."),
            tier(12, QuantizationTier::Q4KM, 49_152, 52, KvCachePlacement::SystemRam, true, "12 GB VRAM targets Q4_K_M with DDR5 spillover."),
            tier(16, QuantizationTier::Q4KM, 65_536, 99, KvCachePlacement::Gpu, true, "16 GB VRAM can fully offload the Q4_K_M tier."),
        ],
        runtimes: ModelRuntimeSupport {
            llama_cpp_supported: true,
            ollama_modelfile_supported: true,
            caveats: vec![
                "Generation remains disabled until an actual provider/runtime is configured."
                    .to_owned(),
            ],
        },
        notes: vec![
            "The catalog exposes larger quants for UI selection, but automatic planning only selects Q3_K_M or Q4_K_M."
                .to_owned(),
        ],
    }
}

fn bonsai_8b_profile() -> AiModelProfile {
    bonsai_profile(
        TERNARY_BONSAI_8B_MODEL_ID,
        "Ternary Bonsai 8B",
        TERNARY_BONSAI_8B_REPO,
        "Ternary-Bonsai-8B-Q2_K.gguf",
        3.25,
        32_768,
        4,
        16,
        QuantizationTier::Q2K,
        true,
    )
}

fn bonsai_4b_profile() -> AiModelProfile {
    bonsai_profile(
        TERNARY_BONSAI_4B_MODEL_ID,
        "Ternary Bonsai 4B",
        TERNARY_BONSAI_4B_REPO,
        "Ternary-Bonsai-4B-Q2_0.gguf",
        1.07,
        32_768,
        2,
        16,
        QuantizationTier::Q20,
        false,
    )
}

fn bonsai_17b_profile() -> AiModelProfile {
    bonsai_profile(
        TERNARY_BONSAI_17B_MODEL_ID,
        "Ternary Bonsai 1.7B",
        TERNARY_BONSAI_17B_REPO,
        "Ternary-Bonsai-1.7B-Q2_0.gguf",
        0.46,
        32_768,
        0,
        8,
        QuantizationTier::Q20,
        false,
    )
}

fn bonsai_profile(
    id: &str,
    display_name: &str,
    repo: &str,
    model_file: &str,
    gguf_size_gb: f32,
    context_size_tokens: u32,
    minimum_vram_gb: u16,
    minimum_recommended_ddr5_gb: u16,
    quantization: QuantizationTier,
    ollama_supported: bool,
) -> AiModelProfile {
    AiModelProfile {
        id: id.to_owned(),
        display_name: display_name.to_owned(),
        family: "Ternary Bonsai / Qwen3".to_owned(),
        repo: repo.to_owned(),
        license: "Apache-2.0".to_owned(),
        recommended_use: if quantization == QuantizationTier::Q2K {
            "Compact Q2_K GGUF for fast local drafting and lower-memory systems.".to_owned()
        } else {
            "Small, fast local experimentation when Q2_0 runtime support is available.".to_owned()
        },
        quantizations: vec![quant_option(
            quantization,
            model_file,
            gguf_size_gb,
            context_size_tokens,
            minimum_vram_gb,
            minimum_recommended_ddr5_gb,
            true,
        )],
        vram_tiers: vec![
            tier(
                0,
                quantization,
                8_192,
                0,
                KvCachePlacement::SystemRam,
                true,
                "CPU fallback is viable for smaller contexts.",
            ),
            tier(
                4,
                quantization,
                context_size_tokens.min(32_768),
                99,
                KvCachePlacement::SystemRam,
                true,
                "Low VRAM GPUs can offload weights while DDR5 carries KV pressure.",
            ),
            tier(
                8,
                quantization,
                context_size_tokens,
                99,
                KvCachePlacement::Gpu,
                false,
                "8 GB VRAM can target full offload for the compact Bonsai weights.",
            ),
        ],
        runtimes: ModelRuntimeSupport {
            llama_cpp_supported: true,
            ollama_modelfile_supported: ollama_supported,
            caveats: if ollama_supported {
                Vec::new()
            } else {
                vec![
                    "Q2_0 is not assumed to be supported by stock local runtimes; use the Prism llama.cpp fork or verify upstream support first."
                        .to_owned(),
                ]
            },
        },
        notes: vec![
            "This is a planning/import option only; it does not mark the AI runtime ready."
                .to_owned(),
        ],
    }
}

fn quant_option(
    quantization: QuantizationTier,
    model_file: &str,
    gguf_size_gb: f32,
    context_size_tokens: u32,
    minimum_vram_gb: u16,
    minimum_recommended_ddr5_gb: u16,
    recommended: bool,
) -> ModelQuantizationOption {
    ModelQuantizationOption {
        quantization,
        model_file: model_file.to_owned(),
        gguf_size_gb,
        context_size_tokens,
        minimum_vram_gb,
        minimum_recommended_ddr5_gb,
        recommended,
        notes: Vec::new(),
    }
}

fn tier(
    dedicated_vram_gb: u16,
    recommended_quantization: QuantizationTier,
    context_size_tokens: u32,
    gpu_layers: u16,
    kv_cache: KvCachePlacement,
    ddr5_spillover: bool,
    note: &str,
) -> ModelVramTier {
    ModelVramTier {
        dedicated_vram_gb,
        recommended_quantization,
        context_size_tokens,
        gpu_layers,
        kv_cache,
        ddr5_spillover,
        notes: vec![note.to_owned()],
    }
}

fn plan_qwopus_local_runtime(
    request: ModelRuntimePlanRequest,
) -> Result<LocalModelRuntimePlan, ModelPlanningError> {
    Ok(local_plan_from_qwopus(plan_qwopus_runtime_from_request(
        request,
    )?))
}

pub fn qwopus_plan_for_quant(
    profile: GpuMemoryProfile,
    quantization: Option<QuantizationTier>,
) -> Result<QwopusRuntimePlan, ModelPlanningError> {
    if profile.dedicated_vram_gb < 8 {
        return Err(ModelPlanningError::InsufficientVram {
            model_id: QWOPUS_MODEL_ID.to_owned(),
            detected_gb: profile.dedicated_vram_gb,
            minimum_gb: 8,
        });
    }

    let plan = match quantization {
        None if profile.dedicated_vram_gb >= 12 => q4_plan(profile.dedicated_vram_gb),
        None => q3_plan(),
        Some(QuantizationTier::Q3KM) => q3_plan(),
        Some(QuantizationTier::Q4KM) if profile.dedicated_vram_gb >= 12 => {
            q4_plan(profile.dedicated_vram_gb)
        }
        Some(quantization) => {
            return Err(ModelPlanningError::UnsupportedQuantization {
                model_id: QWOPUS_MODEL_ID.to_owned(),
                quantization,
            });
        }
    };

    Ok(plan.with_ram_notes(profile.ddr5_ram_gb))
}

fn apply_context_override(
    plan: QwopusRuntimePlan,
    context_size_tokens: Option<u32>,
    minimum: u32,
    maximum: u32,
) -> Result<QwopusRuntimePlan, ModelPlanningError> {
    let Some(context_size_tokens) = context_size_tokens else {
        return Ok(plan);
    };
    if !(minimum..=maximum).contains(&context_size_tokens) {
        return Err(ModelPlanningError::InvalidContextSize {
            requested: context_size_tokens,
            minimum,
            maximum,
        });
    }
    Ok(QwopusRuntimePlan {
        context_size_tokens,
        ..plan
    }
    .with_llama_args())
}

fn local_plan_from_qwopus(plan: QwopusRuntimePlan) -> LocalModelRuntimePlan {
    let tag = format!(
        "quartz-qwopus-glm-18b:{}",
        quantization_slug(plan.quantization)
    );
    let modelfile = ollama_modelfile(&plan.model_file, plan.context_size_tokens, plan.gpu_layers);
    LocalModelRuntimePlan {
        model_id: QWOPUS_MODEL_ID.to_owned(),
        display_name: "Qwopus GLM 18B Healed".to_owned(),
        repo: plan.repo.to_owned(),
        model_file: plan.model_file.to_owned(),
        quantization: plan.quantization,
        gguf_size_gb: plan.gguf_size_gb,
        context_size_tokens: plan.context_size_tokens,
        gpu_layers: plan.gpu_layers,
        flash_attention: plan.flash_attention,
        kv_cache: plan.kv_cache,
        mmap_model: plan.mmap_model,
        mlock_model: plan.mlock_model,
        cpu_spill_enabled: plan.cpu_spill_enabled,
        minimum_recommended_ddr5_gb: plan.minimum_recommended_ddr5_gb,
        llama_cpp: RuntimeControlPlan {
            supported: true,
            suggested_tag: None,
            modelfile: None,
            create_args: Vec::new(),
            run_args: Vec::new(),
            server_args: plan.llama_server_args.clone(),
            notes: vec!["Use llama-server after downloading the selected GGUF.".to_owned()],
        },
        ollama: RuntimeControlPlan {
            supported: true,
            suggested_tag: Some(tag.clone()),
            modelfile: Some(modelfile),
            create_args: vec![
                "ollama".to_owned(),
                "create".to_owned(),
                tag.clone(),
                "-f".to_owned(),
                "Modelfile".to_owned(),
            ],
            run_args: vec!["ollama".to_owned(), "run".to_owned(), tag],
            server_args: Vec::new(),
            notes: vec![
                "Import from a local GGUF with a Modelfile; this planner does not download models."
                    .to_owned(),
            ],
        },
        notes: plan.notes,
    }
}

#[derive(Clone, Copy)]
struct BonsaiSpec {
    model_id: &'static str,
    display_name: &'static str,
    repo: &'static str,
    model_file: &'static str,
    gguf_size_gb: f32,
    context_size_tokens: u32,
    minimum_recommended_ddr5_gb: u16,
    quantization: QuantizationTier,
    ollama_supported: bool,
}

fn plan_bonsai_runtime(
    request: ModelRuntimePlanRequest,
    spec: BonsaiSpec,
) -> Result<LocalModelRuntimePlan, ModelPlanningError> {
    match request.quantization {
        None => {}
        Some(quantization) if quantization == spec.quantization => {}
        Some(quantization) => {
            return Err(ModelPlanningError::UnsupportedQuantization {
                model_id: spec.model_id.to_owned(),
                quantization,
            });
        }
    }

    let tier = bonsai_runtime_tier(
        request.gpu.dedicated_vram_gb,
        spec.context_size_tokens,
        spec.quantization,
    );
    let context_size_tokens = request
        .context_size_tokens
        .unwrap_or(tier.context_size_tokens);
    if !(1_024..=spec.context_size_tokens).contains(&context_size_tokens) {
        return Err(ModelPlanningError::InvalidContextSize {
            requested: context_size_tokens,
            minimum: 1_024,
            maximum: spec.context_size_tokens,
        });
    }

    let mut notes = if spec.quantization == QuantizationTier::Q2K {
        vec!["Q2_K Bonsai planning is exposed as a local-runtime option, not as configured generation."
            .to_owned()]
    } else {
        vec![
            "Q2_0 Bonsai planning is exposed as a local-runtime option, not as configured generation."
                .to_owned(),
            "Use the Prism llama.cpp fork or verify stock runtime support before loading Q2_0 GGUF files."
                .to_owned(),
        ]
    };
    match request.gpu.ddr5_ram_gb {
        Some(ram_gb) if ram_gb < spec.minimum_recommended_ddr5_gb => notes.push(format!(
            "Detected DDR5 RAM is below the {} GB recommended spillover budget.",
            spec.minimum_recommended_ddr5_gb
        )),
        Some(ram_gb) => notes.push(format!(
            "Detected {ram_gb} GB DDR5 RAM is acceptable for Bonsai spillover."
        )),
        None => notes.push(format!(
            "DDR5 RAM was not reported; assume at least {} GB for stable spillover.",
            spec.minimum_recommended_ddr5_gb
        )),
    }

    let mut llama_args = vec![
        "-m".to_owned(),
        spec.model_file.to_owned(),
        "--ctx-size".to_owned(),
        context_size_tokens.to_string(),
        "--flash-attn".to_owned(),
        "on".to_owned(),
        "--n-gpu-layers".to_owned(),
        tier.gpu_layers.to_string(),
    ];
    if tier.kv_cache == KvCachePlacement::SystemRam {
        llama_args.push("--no-kv-offload".to_owned());
    }

    Ok(LocalModelRuntimePlan {
        model_id: spec.model_id.to_owned(),
        display_name: spec.display_name.to_owned(),
        repo: spec.repo.to_owned(),
        model_file: spec.model_file.to_owned(),
        quantization: spec.quantization,
        gguf_size_gb: spec.gguf_size_gb,
        context_size_tokens,
        gpu_layers: tier.gpu_layers,
        flash_attention: true,
        kv_cache: tier.kv_cache,
        mmap_model: true,
        mlock_model: false,
        cpu_spill_enabled: tier.kv_cache == KvCachePlacement::SystemRam,
        minimum_recommended_ddr5_gb: spec.minimum_recommended_ddr5_gb,
        llama_cpp: RuntimeControlPlan {
            supported: true,
            suggested_tag: None,
            modelfile: None,
            create_args: Vec::new(),
            run_args: Vec::new(),
            server_args: llama_args,
            notes: if spec.quantization == QuantizationTier::Q2K {
                vec!["Use a current GGUF-capable llama.cpp build before serving Bonsai.".to_owned()]
            } else {
                vec!["Use a Q2_0-capable llama.cpp build before serving Bonsai.".to_owned()]
            },
        },
        ollama: RuntimeControlPlan {
            supported: spec.ollama_supported,
            suggested_tag: Some(format!(
                "quartz-{}:{}",
                spec.model_id,
                quantization_slug(spec.quantization)
            )),
            modelfile: Some(ollama_modelfile(
                spec.model_file,
                context_size_tokens,
                tier.gpu_layers,
            )),
            create_args: if spec.ollama_supported {
                let tag = format!(
                    "quartz-{}:{}",
                    spec.model_id,
                    quantization_slug(spec.quantization)
                );
                vec![
                    "ollama".to_owned(),
                    "create".to_owned(),
                    tag,
                    "-f".to_owned(),
                    "Modelfile".to_owned(),
                ]
            } else {
                Vec::new()
            },
            run_args: if spec.ollama_supported {
                let tag = format!(
                    "quartz-{}:{}",
                    spec.model_id,
                    quantization_slug(spec.quantization)
                );
                vec!["ollama".to_owned(), "run".to_owned(), tag]
            } else {
                Vec::new()
            },
            server_args: Vec::new(),
            notes: if spec.ollama_supported {
                vec![
                    "Import from a local GGUF with a Modelfile; this planner does not download models."
                        .to_owned(),
                ]
            } else {
                vec![
                    "Q2_0 is not assumed to work in Ollama; treat this Modelfile as a draft until the installed runtime confirms support."
                        .to_owned(),
                ]
            },
        },
        notes,
    })
}

fn bonsai_runtime_tier(
    vram_gb: u16,
    native_context: u32,
    quantization: QuantizationTier,
) -> ModelVramTier {
    if vram_gb >= 8 {
        return tier(
            8,
            quantization,
            native_context,
            99,
            KvCachePlacement::Gpu,
            false,
            "8 GB VRAM tier targets full GPU offload.",
        );
    }
    if vram_gb >= 4 {
        return tier(
            4,
            quantization,
            native_context.min(32_768),
            99,
            KvCachePlacement::SystemRam,
            true,
            "4 GB VRAM tier offloads weights and keeps KV cache in DDR5.",
        );
    }
    tier(
        0,
        quantization,
        8_192,
        0,
        KvCachePlacement::SystemRam,
        true,
        "CPU fallback tier.",
    )
}

struct ValidatedImportSource {
    source_type: String,
    repo: Option<String>,
    file: String,
    validated_local_path: Option<String>,
    modelfile_from: String,
    llama_model_arg: String,
    download_required: bool,
    instructions: Vec<String>,
}

fn validate_import_source(
    source: &ModelImportSource,
) -> Result<ValidatedImportSource, ModelImportPlanError> {
    match source {
        ModelImportSource::LocalGgufPath { path } => validate_local_gguf_path(path),
        ModelImportSource::HuggingFaceRepo { repo, file } => validate_hf_repo(repo, file),
    }
}

fn validate_local_gguf_path(path: &Path) -> Result<ValidatedImportSource, ModelImportPlanError> {
    if !path.is_absolute() {
        return Err(ModelImportPlanError::PathMustBeAbsolute {
            path: path.display().to_string(),
        });
    }
    if !is_gguf_file_name(path.as_os_str()) {
        return Err(ModelImportPlanError::NotGguf {
            file: path.display().to_string(),
        });
    }

    let canonical =
        std::fs::canonicalize(path).map_err(|_| ModelImportPlanError::PathNotFound {
            path: path.display().to_string(),
        })?;
    if !canonical.is_file() {
        return Err(ModelImportPlanError::PathNotFile {
            path: canonical.display().to_string(),
        });
    }

    let canonical_string = canonical.display().to_string();
    let file = canonical
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or("model.gguf")
        .to_owned();

    Ok(ValidatedImportSource {
        source_type: "local_gguf_path".to_owned(),
        repo: None,
        file,
        validated_local_path: Some(canonical_string.clone()),
        modelfile_from: canonical_string.clone(),
        llama_model_arg: canonical_string,
        download_required: false,
        instructions: vec![
            "Create a Modelfile with the returned content.".to_owned(),
            "Run the returned ollama create command from the Modelfile directory.".to_owned(),
        ],
    })
}

fn validate_hf_repo(repo: &str, file: &str) -> Result<ValidatedImportSource, ModelImportPlanError> {
    if !is_valid_hf_repo(repo) {
        return Err(ModelImportPlanError::InvalidRepository {
            repo: repo.to_owned(),
        });
    }
    if !is_safe_relative_gguf_file(file) {
        return Err(ModelImportPlanError::InvalidRepositoryFile {
            file: file.to_owned(),
        });
    }

    Ok(ValidatedImportSource {
        source_type: "hugging_face_repo".to_owned(),
        repo: Some(repo.to_owned()),
        file: file.to_owned(),
        validated_local_path: None,
        modelfile_from: format!("./{file}"),
        llama_model_arg: file.to_owned(),
        download_required: true,
        instructions: vec![
            "Download the named GGUF from the validated Hugging Face repository first.".to_owned(),
            "Place the Modelfile beside the GGUF, then run the returned ollama create command."
                .to_owned(),
        ],
    })
}

fn is_valid_hf_repo(repo: &str) -> bool {
    let mut parts = repo.split('/');
    let Some(owner) = parts.next() else {
        return false;
    };
    let Some(name) = parts.next() else {
        return false;
    };
    parts.next().is_none() && is_repo_component(owner) && is_repo_component(name)
}

fn is_repo_component(component: &str) -> bool {
    !component.is_empty()
        && component != "."
        && component != ".."
        && component
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
}

fn is_safe_relative_gguf_file(file: &str) -> bool {
    let path = Path::new(file);
    !path.is_absolute()
        && is_gguf_file_name(path.as_os_str())
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn is_gguf_file_name(file: &OsStr) -> bool {
    Path::new(file)
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("gguf"))
}

fn is_valid_ollama_name(name: &str) -> bool {
    let trimmed = name.trim();
    !trimmed.is_empty()
        && trimmed.len() <= 128
        && !trimmed.starts_with(':')
        && !trimmed.ends_with(':')
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':'))
}

fn default_ollama_tag(
    model_id: Option<&str>,
    file: &str,
    quantization: Option<QuantizationTier>,
) -> String {
    let base = model_id
        .map(str::to_owned)
        .unwrap_or_else(|| sanitize_tag_part(file.trim_end_matches(".gguf")));
    match quantization {
        Some(quantization) => format!("{base}:{}", quantization_slug(quantization)),
        None => base,
    }
}

fn sanitize_tag_part(input: &str) -> String {
    let mut output = String::new();
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            output.push(ch.to_ascii_lowercase());
        } else if matches!(ch, '-' | '_' | '.') {
            output.push(ch);
        } else if ch.is_whitespace() {
            output.push('-');
        }
    }
    if output.is_empty() {
        "local-model".to_owned()
    } else {
        output
    }
}

fn detect_quantization_from_file(file: &str) -> Option<QuantizationTier> {
    let lower = file.to_ascii_lowercase();
    if lower.contains("q2_k") {
        Some(QuantizationTier::Q2K)
    } else if lower.contains("q2_0") {
        Some(QuantizationTier::Q20)
    } else if lower.contains("q3_k_m") {
        Some(QuantizationTier::Q3KM)
    } else if lower.contains("q4_k_m") {
        Some(QuantizationTier::Q4KM)
    } else if lower.contains("q5_k_m") {
        Some(QuantizationTier::Q5KM)
    } else if lower.contains("q6_k") {
        Some(QuantizationTier::Q6K)
    } else if lower.contains("q8_0") {
        Some(QuantizationTier::Q80)
    } else if lower.contains("f16") {
        Some(QuantizationTier::F16)
    } else {
        None
    }
}

fn default_context_for_model(model_id: &str) -> Option<u32> {
    match model_id {
        QWOPUS_MODEL_ID => Some(32_768),
        TERNARY_BONSAI_8B_MODEL_ID => Some(65_536),
        TERNARY_BONSAI_4B_MODEL_ID | TERNARY_BONSAI_17B_MODEL_ID => Some(32_768),
        _ => None,
    }
}

fn ollama_modelfile(from: &str, context_size_tokens: u32, gpu_layers: u16) -> String {
    format!(
        "FROM {from}\nPARAMETER num_ctx {context_size_tokens}\nPARAMETER num_gpu {gpu_layers}\n"
    )
}

fn quantization_slug(quantization: QuantizationTier) -> &'static str {
    match quantization {
        QuantizationTier::Q2K => "q2_k",
        QuantizationTier::Q20 => "q2_0",
        QuantizationTier::Q3KM => "q3_k_m",
        QuantizationTier::Q4KM => "q4_k_m",
        QuantizationTier::Q5KM => "q5_k_m",
        QuantizationTier::Q6K => "q6_k",
        QuantizationTier::Q80 => "q8_0",
        QuantizationTier::F16 => "f16",
    }
}

#[derive(Debug, Error)]
pub enum ModelProfileError {
    #[error("Qwopus requires at least 8 GB dedicated VRAM")]
    InsufficientVram { detected_gb: u16 },
}

#[derive(Debug, Error)]
pub enum ModelPlanningError {
    #[error("unknown local AI model profile: {model_id}")]
    UnknownModel { model_id: String },
    #[error("model {model_id} does not support quantization {quantization:?}")]
    UnsupportedQuantization {
        model_id: String,
        quantization: QuantizationTier,
    },
    #[error("model {model_id} requires at least {minimum_gb} GB dedicated VRAM")]
    InsufficientVram {
        model_id: String,
        detected_gb: u16,
        minimum_gb: u16,
    },
    #[error("context size {requested} is outside the supported range {minimum}..={maximum}")]
    InvalidContextSize {
        requested: u32,
        minimum: u32,
        maximum: u32,
    },
}

#[derive(Debug, Error)]
pub enum ModelImportPlanError {
    #[error("GGUF path must be absolute: {path}")]
    PathMustBeAbsolute { path: String },
    #[error("GGUF path was not found: {path}")]
    PathNotFound { path: String },
    #[error("GGUF path is not a file: {path}")]
    PathNotFile { path: String },
    #[error("model file must end with .gguf: {file}")]
    NotGguf { file: String },
    #[error("Hugging Face repository id is invalid: {repo}")]
    InvalidRepository { repo: String },
    #[error("Hugging Face GGUF file path is invalid: {file}")]
    InvalidRepositoryFile { file: String },
    #[error("Ollama model name is invalid: {name}")]
    InvalidOllamaModelName { name: String },
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn selects_q3_for_8gb_vram() {
        let plan = plan_qwopus_runtime(GpuMemoryProfile {
            dedicated_vram_gb: 8,
            ddr5_ram_gb: Some(32),
        })
        .expect("8 GB profile should be supported");

        assert_eq!(plan.quantization, QuantizationTier::Q3KM);
        assert_eq!(plan.kv_cache, KvCachePlacement::SystemRam);
        assert!(plan.cpu_spill_enabled);
        assert!(plan
            .llama_server_args
            .iter()
            .any(|arg| arg == "--no-kv-offload"));
    }

    #[test]
    fn selects_q4_for_12gb_vram_with_spillover() {
        let plan = plan_qwopus_runtime(GpuMemoryProfile {
            dedicated_vram_gb: 12,
            ddr5_ram_gb: Some(64),
        })
        .expect("12 GB profile should be supported");

        assert_eq!(plan.quantization, QuantizationTier::Q4KM);
        assert_eq!(plan.kv_cache, KvCachePlacement::SystemRam);
        assert!(plan.cpu_spill_enabled);
    }

    #[test]
    fn selects_fuller_q4_for_16gb_vram() {
        let plan = plan_qwopus_runtime(GpuMemoryProfile {
            dedicated_vram_gb: 16,
            ddr5_ram_gb: Some(32),
        })
        .expect("16 GB profile should be supported");

        assert_eq!(plan.quantization, QuantizationTier::Q4KM);
        assert_eq!(plan.context_size_tokens, 65_536);
        assert_eq!(plan.gpu_layers, 99);
    }

    #[test]
    fn rejects_less_than_8gb_vram() {
        let plan = plan_qwopus_runtime(GpuMemoryProfile {
            dedicated_vram_gb: 6,
            ddr5_ram_gb: Some(64),
        });

        assert!(matches!(
            plan,
            Err(ModelProfileError::InsufficientVram { detected_gb: 6 })
        ));
    }

    #[test]
    fn serializes_quantization_tiers_for_typescript_boundary() {
        assert_eq!(
            serde_json::to_value(QuantizationTier::Q2K)
                .expect("quantization tier should serialize"),
            serde_json::json!("q2_k")
        );
        assert_eq!(
            serde_json::to_value(QuantizationTier::Q20)
                .expect("quantization tier should serialize"),
            serde_json::json!("q2_0")
        );
        assert_eq!(
            serde_json::to_value(QuantizationTier::Q3KM)
                .expect("quantization tier should serialize"),
            serde_json::json!("q3_k_m")
        );
        assert_eq!(
            serde_json::to_value(QuantizationTier::Q4KM)
                .expect("quantization tier should serialize"),
            serde_json::json!("q4_k_m")
        );
    }

    #[test]
    fn serializes_qwopus_plan_for_typescript_boundary() {
        let plan = plan_qwopus_runtime(GpuMemoryProfile {
            dedicated_vram_gb: 8,
            ddr5_ram_gb: Some(32),
        })
        .expect("8 GB profile should be supported");

        let serialized = serde_json::to_value(&plan).expect("Qwopus plan should serialize");

        assert_eq!(serialized["repo"], serde_json::json!(QWOPUS_GLM_18B_REPO));
        assert_eq!(
            serialized["modelFile"],
            serde_json::json!("Qwopus-GLM-18B-Healed-Q3_K_M.gguf")
        );
        assert_eq!(serialized["quantization"], serde_json::json!("q3_k_m"));
        assert_eq!(serialized["kvCache"], serde_json::json!("system_ram"));
        assert_eq!(serialized["flashAttention"], serde_json::json!(true));
        assert_eq!(
            serialized["llamaServerArgs"],
            serde_json::json!([
                "-m",
                "Qwopus-GLM-18B-Healed-Q3_K_M.gguf",
                "--ctx-size",
                "32768",
                "--flash-attn",
                "on",
                "--n-gpu-layers",
                "36",
                "--split-mode",
                "layer",
                "--no-kv-offload"
            ])
        );
    }

    #[test]
    fn catalog_exposes_qwopus_and_bonsai_profiles() {
        let catalog = model_profile_catalog();
        let ids = catalog
            .iter()
            .map(|profile| profile.id.as_str())
            .collect::<Vec<_>>();

        assert!(ids.contains(&QWOPUS_MODEL_ID));
        assert!(ids.contains(&TERNARY_BONSAI_8B_MODEL_ID));
        assert!(ids.contains(&TERNARY_BONSAI_4B_MODEL_ID));
        assert!(ids.contains(&TERNARY_BONSAI_17B_MODEL_ID));
    }

    #[test]
    fn plans_qwopus_with_explicit_q3_quantization_on_larger_gpu() {
        let plan = plan_local_model_runtime(ModelRuntimePlanRequest {
            model_id: QWOPUS_MODEL_ID.to_owned(),
            gpu: GpuMemoryProfile {
                dedicated_vram_gb: 16,
                ddr5_ram_gb: Some(64),
            },
            quantization: Some(QuantizationTier::Q3KM),
            context_size_tokens: Some(16_384),
        })
        .expect("explicit Q3_K_M should be supported on 16 GB VRAM");

        assert_eq!(plan.quantization, QuantizationTier::Q3KM);
        assert_eq!(plan.context_size_tokens, 16_384);
        assert!(plan.ollama.supported);
        assert!(!plan.llama_cpp.server_args.is_empty());
    }

    #[test]
    fn rejects_unsupported_qwopus_quantization() {
        let error = plan_local_model_runtime(ModelRuntimePlanRequest {
            model_id: QWOPUS_MODEL_ID.to_owned(),
            gpu: GpuMemoryProfile {
                dedicated_vram_gb: 16,
                ddr5_ram_gb: Some(64),
            },
            quantization: Some(QuantizationTier::Q80),
            context_size_tokens: None,
        })
        .expect_err("Q8_0 is catalogued but not automatically planned");

        assert!(matches!(
            error,
            ModelPlanningError::UnsupportedQuantization { .. }
        ));
    }

    #[test]
    fn plans_bonsai_8b_q2k_with_ollama_import_plan() {
        let plan = plan_local_model_runtime(ModelRuntimePlanRequest {
            model_id: TERNARY_BONSAI_8B_MODEL_ID.to_owned(),
            gpu: GpuMemoryProfile {
                dedicated_vram_gb: 8,
                ddr5_ram_gb: Some(32),
            },
            quantization: None,
            context_size_tokens: None,
        })
        .expect("Bonsai 8B Q2_K should have a local runtime plan");

        assert_eq!(plan.repo, TERNARY_BONSAI_8B_REPO);
        assert_eq!(plan.model_file, "Ternary-Bonsai-8B-Q2_K.gguf");
        assert_eq!(plan.quantization, QuantizationTier::Q2K);
        assert_eq!(plan.context_size_tokens, 32_768);
        assert!(plan.llama_cpp.supported);
        assert!(plan.ollama.supported);
    }

    #[test]
    fn creates_import_plan_for_valid_local_gguf() {
        let temp = tempdir().expect("temporary directory should be available");
        let model_path = temp.path().join("Qwopus-GLM-18B-Healed-Q4_K_M.gguf");
        std::fs::write(&model_path, b"gguf fixture").expect("fixture GGUF should be writable");
        let canonical =
            std::fs::canonicalize(&model_path).expect("fixture GGUF should canonicalize");

        let plan = plan_model_import(ModelImportPlanRequest {
            source: ModelImportSource::LocalGgufPath {
                path: canonical.clone(),
            },
            model_id: Some(QWOPUS_MODEL_ID.to_owned()),
            quantization: None,
            ollama_model_name: None,
            context_size_tokens: Some(8_192),
        })
        .expect("valid local GGUF should produce an import plan");

        assert_eq!(plan.quantization, Some(QuantizationTier::Q4KM));
        assert_eq!(
            plan.validated_local_path,
            Some(canonical.display().to_string())
        );
        assert!(plan.modelfile.contains("PARAMETER num_ctx 8192"));
        assert!(!plan.download_required);
    }

    #[test]
    fn rejects_non_gguf_import_path() {
        let temp = tempdir().expect("temporary directory should be available");
        let model_path = temp.path().join("model.bin");
        std::fs::write(&model_path, b"not gguf").expect("fixture should be writable");
        let canonical = std::fs::canonicalize(&model_path).expect("fixture should canonicalize");

        let error = plan_model_import(ModelImportPlanRequest {
            source: ModelImportSource::LocalGgufPath { path: canonical },
            model_id: None,
            quantization: None,
            ollama_model_name: None,
            context_size_tokens: None,
        })
        .expect_err("non-GGUF files must be rejected");

        assert!(matches!(error, ModelImportPlanError::NotGguf { .. }));
    }

    #[test]
    fn creates_repo_metadata_import_plan_without_download() {
        let plan = plan_model_import(ModelImportPlanRequest {
            source: ModelImportSource::HuggingFaceRepo {
                repo: TERNARY_BONSAI_8B_REPO.to_owned(),
                file: "Ternary-Bonsai-8B-Q2_K.gguf".to_owned(),
            },
            model_id: Some(TERNARY_BONSAI_8B_MODEL_ID.to_owned()),
            quantization: None,
            ollama_model_name: None,
            context_size_tokens: None,
        })
        .expect("valid repo metadata should produce an import plan");

        assert!(plan.download_required);
        assert_eq!(plan.repo, Some(TERNARY_BONSAI_8B_REPO.to_owned()));
        assert_eq!(plan.quantization, Some(QuantizationTier::Q2K));
        assert!(plan.warnings.is_empty());
    }
}
