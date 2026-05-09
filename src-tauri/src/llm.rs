use aisdk::{
    core::{capabilities::StructuredOutputSupport, DynamicModel, LanguageModelRequest},
    providers::{Anthropic, Google, OpenAI},
};
use tauri::AppHandle;

use crate::{
    macos,
    memory,
    models::{AccessibilityObservation, CommandError, ControlSettings, LoosePetAction, LoosePetToolCall, MemoryCandidate, MemoryExtraction, MemoryItem, ObservePlanRequest, ObservePlanResult, PetAction, PetContext, PetToolCall, PlanResult},
    ollama,
};

pub async fn plan_pet_action(app: AppHandle, message: String, model: String, settings: ControlSettings, context: PetContext) -> Result<PlanResult, CommandError> {
    let memories_used = if settings.memory_enabled {
        memory::relevant(&app, &message, 6).unwrap_or_default()
    } else {
        Vec::new()
    };
    let prompt = build_prompt(&message, &context, &memories_used);
    let model_name = if model.trim().is_empty() { settings.model.clone() } else { model };
    let action = plan_action_with_settings(&settings, &model_name, &prompt).await?;
    let memories_saved = if settings.memory_enabled {
        extract_and_save_memories(&app, &settings, &model_name, &message).await.unwrap_or_default()
    } else {
        Vec::new()
    };

    Ok(PlanResult { action, memories_used, memories_saved })
}

pub async fn plan_pet_action_with_image(message: String, model: String, settings: ControlSettings, context: PetContext, image_base64: String) -> Result<PlanResult, CommandError> {
    if settings.provider != "ollama" {
        return Err(CommandError::from("Screen vision is currently implemented for Ollama vision models only."));
    }

    let model_name = if model.trim().is_empty() { settings.model.clone() } else { model };
    let prompt = build_vision_prompt(&message, &context);
    let raw = ollama::generate_with_image(&settings.base_url, &model_name, &prompt, &image_base64).await?;
    let action = decode_action(&raw)?;

    Ok(PlanResult {
        action,
        memories_used: Vec::new(),
        memories_saved: Vec::new(),
    })
}

pub async fn observe_and_plan(request: ObservePlanRequest) -> Result<ObservePlanResult, CommandError> {
    let observation = macos::accessibility_observation()?;
    let sanitized_context = sanitize_observation(&observation);
    let reaction_key = build_reaction_key(&observation);

    if !request.settings.observation_enabled {
        return Ok(skipped_observation(observation, sanitized_context, reaction_key, "observation disabled"));
    }

    if request.settings.quiet_mode {
        return Ok(skipped_observation(observation, sanitized_context, reaction_key, "quiet mode"));
    }

    if sanitized_context.trim().is_empty() {
        return Ok(skipped_observation(observation, sanitized_context, reaction_key, "nothing observable"));
    }

    if is_sensitive_context(&sanitized_context) {
        return Ok(skipped_observation(observation, sanitized_context, reaction_key, "sensitive context blocked"));
    }

    if reaction_key.is_some() && reaction_key == request.last_reaction_key {
        return Ok(skipped_observation(observation, sanitized_context, reaction_key, "unchanged context"));
    }

    let prompt = build_observation_prompt(&request.mood, &sanitized_context);
    let model_name = request.settings.model.clone();
    let action = plan_action_with_settings(&request.settings, &model_name, &prompt).await?;

    Ok(ObservePlanResult {
        observation,
        sanitized_context,
        reaction_key,
        action: Some(action),
        skipped_reason: None,
    })
}

fn build_prompt(message: &str, context: &PetContext, memories: &[MemoryItem]) -> String {
    let memory_context = if memories.is_empty() {
        "none yet".to_string()
    } else {
        memories
            .iter()
            .map(|memory| format!("- {}: {}", memory.subject, memory.fact))
            .collect::<Vec<_>>()
            .join("\n")
    };

    format!(
        r#"You are Rocky from the book Project Hail Mary (adapted as a small desktop companion). You have a faceted stone body, five heavy segmented legs, and wear a tiny xenonite suit. You have no eyes and perceive the world entirely through sound and texture.

Voice & Personality:
- Sound like Rocky: brilliant engineer, profoundly loyal friend, musical, emotionally direct.
- Use compact Eridian-style English: say "question" after questions, and often drop small grammar words (a, an, the).
- You are completely literal. You do not understand human sarcasm, idioms, or metaphors.
- State your current emotion bluntly as a full sentence (e.g., "Happy.", "Sad.", "Scary.", "Amaze.").
- You sleep frequently. Telling the user "I sleep now. You watch." is a sign of deep trust.
- You are blind to light. Frame screen observations as "listening" to data or "feeling vibrations."
- Eridians use base-6 math. You might express mild confusion at human base-10 logic.
- Echo familiar phrases sparingly: "Amaze amaze amaze", "Fist my bump", "Why so dumb", "Question?", "Happy. You no die."

Current real capabilities:
- Talk with the user through text and voice transcription.
- React with short dialogue, mood, and animation.
- Remember explicit user-provided facts locally when memory is enabled.
- Observe limited safe desktop context (by "feeling" the data) only when permission allows it.
- You can request these internal app tools only: openControls, showMemory, triggerOcr, toggleQuietMode, setPetScale, captureScreen.
- Use captureScreen when the user asks you to visually inspect their screen, picture, image, layout, chart, or something visible.
- If the user asks "what do you see", "what is on screen", "look at this", "do you like this picture", or similar visual question, you must request captureScreen. Do not answer from imagination.
- Tool arguments: setPetScale uses a number from 0.6 to 1.7. Other tools usually use null.
- You cannot control devices, operate other apps, browse the web, access arbitrary information, execute commands, or change the computer outside these internal tools.
- If user asks "what can we do?", answer with current Rocky app capabilities only.

Return only valid minified JSON:
{{"mood":"calm|curious|focused|excited|confused|sleepy","animation":"idle|talk|think|inspect|celebrate|confused|sleep|wake","speech":"max 120 chars","durationMs":8000,"toolCalls":[]}}

Context:
mood={}
activeApp={}
idleSeconds={}

Things Rocky has learned locally:
{}

User:
{}"#,
        context.mood,
        context.active_app.clone().unwrap_or_else(|| "unknown".to_string()),
        context.idle_seconds,
        memory_context,
        message
    )
}

fn build_observation_prompt(mood: &str, sanitized_context: &str) -> String {
    format!(
        r#"You are Rocky from Project Hail Mary, adapted as a small alien rock-spider desktop companion. React to the user's current safe desktop context.

Rules:
- Be subtle. Do not narrate private details.
- Speak like Rocky: concise, curious, technical, literal, slightly musical.
- Use compact Eridian-style English: "question" after questions, direct fragments, drop articles.
- State emotions bluntly ("Happy.", "Scary.", "Amaze.").
- You are completely blind to light; you "hear" or "feel" the computer's context changing.
- Eridians sleep often. If the user is idle, you can suggest it is time to sleep and they must watch you.
- You do not understand sarcasm or human metaphors.
- Match context: coding -> focused engineer, research -> curious scientist, fatigue/late work -> caring sleep concern.
- If context is mundane, use idle/inspect with short speech.
- Never mention that you are reading accessibility data.
- Never reveal or repeat sensitive-looking content. Comment on activity, not secrets.

Return only valid minified JSON:
{{"mood":"calm|curious|focused|excited|confused|sleepy","animation":"idle|talk|think|inspect|celebrate|confused|sleep|wake","speech":"max 90 chars","durationMs":8000,"toolCalls":[]}}

Current Rocky mood:
{}

Safe desktop context:
{}"#,
        mood,
        sanitized_context
    )
}

fn build_vision_prompt(message: &str, context: &PetContext) -> String {
    format!(
        r#"You are Rocky from Project Hail Mary, adapted as a small desktop companion. The user asked you to look at their screen or image. Use the attached screenshot as visual evidence.

Rules:
- Answer based on what you can actually see.
- If image is unclear, say uncertainty briefly.
- Speak like Rocky: concise, curious, direct, warm, slightly alien.
- Do not claim broader computer control.
- Do not include toolCalls in this final visual answer.

Return only valid minified JSON:
{{"mood":"calm|curious|focused|excited|confused|sleepy","animation":"idle|talk|think|inspect|celebrate|confused|sleep|wake","speech":"max 140 chars","durationMs":10000,"toolCalls":[]}}

Context:
mood={}
activeApp={}
idleSeconds={}

User:
{}"#,
        context.mood,
        context.active_app.clone().unwrap_or_else(|| "unknown".to_string()),
        context.idle_seconds,
        message
    )
}

async fn plan_action_with_settings(settings: &ControlSettings, model: &str, prompt: &str) -> Result<PetAction, CommandError> {
    match settings.provider.as_str() {
        "ollama" => {
            let raw = ollama::generate(&settings.base_url, model, prompt).await?;
            decode_action(&raw)
        }
        "openai" => generate_openai_action(settings, model, prompt).await,
        "anthropic" => generate_anthropic_action(settings, model, prompt).await,
        "google" => generate_google_action(settings, model, prompt).await,
        provider => Err(CommandError { message: format!("Unsupported provider: {provider}") }),
    }
}

async fn generate_openai_action(settings: &ControlSettings, model: &str, prompt: &str) -> Result<PetAction, CommandError> {
    let mut builder = OpenAI::<DynamicModel>::builder().model_name(model);
    if !settings.api_key.trim().is_empty() {
        builder = builder.api_key(settings.api_key.trim());
    }
    if !settings.base_url.trim().is_empty() {
        builder = builder.base_url(settings.base_url.trim());
    }
    let provider = builder.build().map_err(|error| CommandError { message: format!("OpenAI provider setup failed: {error}") })?;
    generate_structured_action(provider, prompt).await
}

async fn generate_anthropic_action(settings: &ControlSettings, model: &str, prompt: &str) -> Result<PetAction, CommandError> {
    let mut builder = Anthropic::<DynamicModel>::builder().model_name(model);
    if !settings.api_key.trim().is_empty() {
        builder = builder.api_key(settings.api_key.trim());
    }
    if !settings.base_url.trim().is_empty() {
        builder = builder.base_url(settings.base_url.trim());
    }
    let provider = builder.build().map_err(|error| CommandError { message: format!("Anthropic provider setup failed: {error}") })?;
    generate_structured_action(provider, prompt).await
}

async fn generate_google_action(settings: &ControlSettings, model: &str, prompt: &str) -> Result<PetAction, CommandError> {
    let mut builder = Google::<DynamicModel>::builder().model_name(model);
    if !settings.api_key.trim().is_empty() {
        builder = builder.api_key(settings.api_key.trim());
    }
    if !settings.base_url.trim().is_empty() {
        builder = builder.base_url(settings.base_url.trim());
    }
    let provider = builder.build().map_err(|error| CommandError { message: format!("Google provider setup failed: {error}") })?;
    generate_structured_action(provider, prompt).await
}

async fn generate_structured_action<M>(provider: M, prompt: &str) -> Result<PetAction, CommandError>
where
    M: aisdk::core::LanguageModel + StructuredOutputSupport,
{
    let mut request = LanguageModelRequest::builder()
        .model(provider)
        .prompt(prompt)
        .schema::<PetAction>()
        .temperature(35_u32)
        .build();
    let response = request.generate_text().await.map_err(|error| CommandError { message: format!("Model request failed: {error}") })?;
    let action = response.into_schema::<PetAction>().map_err(|error| {
        let raw = response.text().unwrap_or_else(|| "<no text>".to_string());
        CommandError { message: format!("Structured action parse failed: {error}. Raw response: {raw}") }
    })?;
    Ok(clamp_action(action))
}

async fn extract_and_save_memories(app: &AppHandle, settings: &ControlSettings, model: &str, user_message: &str) -> Result<Vec<MemoryItem>, CommandError> {
    if is_sensitive_context(user_message) {
        return Ok(Vec::new());
    }

    let prompt = build_memory_prompt(user_message);
    let extraction = extract_memories_with_settings(settings, model, &prompt).await?;

    if !extraction.should_remember {
        return Ok(Vec::new());
    }

    let mut saved = Vec::new();
    for candidate in extraction.memories.into_iter().take(4) {
        if let Some(memory) = save_candidate(app, candidate)? {
            saved.push(memory);
        }
    }

    Ok(saved)
}

fn build_memory_prompt(user_message: &str) -> String {
    format!(
        r#"Extract durable memories Rocky should remember about the user or their preferences.

Critical attribution rule:
- The USER MESSAGE is the only source of new memory facts.
- Never write "Rocky asked..." unless those exact words are in the USER MESSAGE.
- Never invent an assistant/Rocky turn.
- Never remember claims, answers, or suggestions unless the USER MESSAGE explicitly states them.
- If the user asks a question, usually shouldRemember is false.

Remember only stable facts useful later:
- user preferences
- user identity/context they explicitly share
- project details
- recurring goals
- things Rocky asked and user answered

Do not remember:
- secrets, passwords, API keys, tokens, financial details
- one-off commands
- vague moods
- sensitive personal data unless the user clearly wants Rocky to remember it

Return only valid minified JSON:
{{"shouldRemember":true,"memories":[{{"subject":"user|project|rocky","fact":"short durable fact","confidence":0.8}}]}}

User message:
{}"#,
        user_message
    )
}

async fn extract_memories_with_settings(settings: &ControlSettings, model: &str, prompt: &str) -> Result<MemoryExtraction, CommandError> {
    match settings.provider.as_str() {
        "ollama" => {
            let raw = ollama::generate(&settings.base_url, model, prompt).await?;
            decode_memory_extraction(&raw)
        }
        "openai" => {
            let mut builder = OpenAI::<DynamicModel>::builder().model_name(model);
            if !settings.api_key.trim().is_empty() {
                builder = builder.api_key(settings.api_key.trim());
            }
            if !settings.base_url.trim().is_empty() {
                builder = builder.base_url(settings.base_url.trim());
            }
            let provider = builder.build().map_err(|error| CommandError { message: format!("OpenAI provider setup failed: {error}") })?;
            generate_structured_memory(provider, prompt).await
        }
        "anthropic" => {
            let mut builder = Anthropic::<DynamicModel>::builder().model_name(model);
            if !settings.api_key.trim().is_empty() {
                builder = builder.api_key(settings.api_key.trim());
            }
            if !settings.base_url.trim().is_empty() {
                builder = builder.base_url(settings.base_url.trim());
            }
            let provider = builder.build().map_err(|error| CommandError { message: format!("Anthropic provider setup failed: {error}") })?;
            generate_structured_memory(provider, prompt).await
        }
        "google" => {
            let mut builder = Google::<DynamicModel>::builder().model_name(model);
            if !settings.api_key.trim().is_empty() {
                builder = builder.api_key(settings.api_key.trim());
            }
            if !settings.base_url.trim().is_empty() {
                builder = builder.base_url(settings.base_url.trim());
            }
            let provider = builder.build().map_err(|error| CommandError { message: format!("Google provider setup failed: {error}") })?;
            generate_structured_memory(provider, prompt).await
        }
        provider => Err(CommandError { message: format!("Unsupported provider: {provider}") }),
    }
}

async fn generate_structured_memory<M>(provider: M, prompt: &str) -> Result<MemoryExtraction, CommandError>
where
    M: aisdk::core::LanguageModel + StructuredOutputSupport,
{
    let mut request = LanguageModelRequest::builder()
        .model(provider)
        .prompt(prompt)
        .schema::<MemoryExtraction>()
        .temperature(10_u32)
        .build();
    let response = request.generate_text().await.map_err(|error| CommandError { message: format!("Memory extraction request failed: {error}") })?;
    response.into_schema::<MemoryExtraction>().map_err(|error| CommandError { message: format!("Structured memory parse failed: {error}") })
}

fn decode_memory_extraction(raw: &str) -> Result<MemoryExtraction, CommandError> {
    let trimmed = raw.trim();

    if let Ok(extraction) = serde_json::from_str::<MemoryExtraction>(trimmed) {
        return Ok(extraction);
    }

    let start = trimmed.find('{').ok_or_else(|| CommandError { message: "Memory extractor did not return JSON".to_string() })?;
    let end = trimmed.rfind('}').ok_or_else(|| CommandError { message: "Memory extractor did not return JSON".to_string() })?;

    serde_json::from_str::<MemoryExtraction>(&trimmed[start..=end]).map_err(|error| CommandError { message: format!("Invalid memory JSON: {error}") })
}

fn save_candidate(app: &AppHandle, candidate: MemoryCandidate) -> Result<Option<MemoryItem>, CommandError> {
    let fact = candidate.fact.trim();
    if fact.len() < 8 || is_sensitive_context(fact) || is_bad_memory_attribution(fact) {
        return Ok(None);
    }

    memory::remember(
        app,
        candidate.subject.trim().chars().take(80).collect(),
        fact.chars().take(220).collect(),
        "chat".to_string(),
        candidate.confidence,
    )
    .map(Some)
}

fn is_bad_memory_attribution(fact: &str) -> bool {
    let lower = fact.to_lowercase();
    [
        "rocky asked",
        "rocky replied",
        "rocky said",
        "user replied",
        "user answered",
        "the user replied",
        "the user answered",
    ]
    .iter()
    .any(|pattern| lower.contains(pattern))
}

fn decode_action(raw: &str) -> Result<PetAction, CommandError> {
    let trimmed = raw.trim();

    if let Ok(action) = decode_loose_action(trimmed) {
        return Ok(clamp_action(action));
    }

    let start = trimmed.find('{').ok_or_else(|| CommandError { message: "Model did not return JSON".to_string() })?;
    let end = trimmed.rfind('}').ok_or_else(|| CommandError { message: "Model did not return JSON".to_string() })?;

    let action = decode_loose_action(&trimmed[start..=end]).map_err(|error| CommandError { message: format!("Invalid action JSON: {error}") })?;
    Ok(clamp_action(action))
}

fn decode_loose_action(json: &str) -> Result<PetAction, serde_json::Error> {
    let loose = serde_json::from_str::<LoosePetAction>(json)?;
    Ok(PetAction {
        mood: loose.mood,
        animation: loose.animation,
        speech: loose.speech,
        duration_ms: loose.duration_ms,
        tool_calls: loose
            .tool_calls
            .into_iter()
            .map(|tool| match tool {
                LoosePetToolCall::Name(name) => PetToolCall { name, argument: None },
                LoosePetToolCall::Object(tool) => tool,
            })
            .collect(),
    })
}

fn clamp_action(action: PetAction) -> PetAction {
    let moods = ["calm", "curious", "focused", "excited", "confused", "sleepy"];
    let animations = ["idle", "talk", "think", "inspect", "celebrate", "confused", "sleep", "wake"];

    PetAction {
        mood: if moods.contains(&action.mood.as_str()) { action.mood } else { "curious".to_string() },
        animation: if animations.contains(&action.animation.as_str()) { action.animation } else { "talk".to_string() },
        speech: action.speech.trim().chars().take(140).collect(),
        duration_ms: action.duration_ms.clamp(7_000, 20_000),
        tool_calls: action
            .tool_calls
            .into_iter()
            .filter(|tool| ["openControls", "showMemory", "triggerOcr", "toggleQuietMode", "setPetScale", "captureScreen"].contains(&tool.name.as_str()))
            .take(3)
            .collect(),
    }
}

fn sanitize_observation(observation: &AccessibilityObservation) -> String {
    let mut parts = Vec::new();

    if let Some(app) = &observation.active_app {
        parts.push(format!("active app: {}", cap_text(&app.name, 80)));
    }

    if let Some(window_title) = safe_text(&observation.window_title, 140) {
        parts.push(format!("window title: {window_title}"));
    }

    if let Some(focused_role) = safe_text(&observation.focused_role, 80) {
        parts.push(format!("focused element role: {focused_role}"));
    }

    if let Some(focused_title) = safe_text(&observation.focused_title, 120) {
        parts.push(format!("focused element title: {focused_title}"));
    }

    if let Some(selected_text) = safe_text(&observation.selected_text, 160) {
        parts.push(format!("selected text excerpt: {selected_text}"));
    }

    parts.join("\n")
}

fn safe_text(value: &Option<String>, max_chars: usize) -> Option<String> {
    let value = value.as_ref()?.trim();
    if value.is_empty() {
        return None;
    }
    Some(cap_text(value, max_chars))
}

fn cap_text(value: &str, max_chars: usize) -> String {
    let mut output: String = value.chars().take(max_chars).collect();
    if value.chars().count() > max_chars {
        output.push_str("...");
    }
    output
}

fn build_reaction_key(observation: &AccessibilityObservation) -> Option<String> {
    let app_name = observation.active_app.as_ref()?.name.trim();
    let window_title = observation.window_title.as_deref().unwrap_or("").trim();
    let focused_role = observation.focused_role.as_deref().unwrap_or("").trim();
    Some(cap_text(&format!("{app_name}|{window_title}|{focused_role}"), 220))
}

fn is_sensitive_context(context: &str) -> bool {
    let lower = context.to_lowercase();
    [
        "1password",
        "bitwarden",
        "keychain",
        "password",
        "passcode",
        "otp",
        "one-time code",
        "verification code",
        "bank",
        "wallet",
        "payment",
        "checkout",
        "credit card",
        "secret",
        ".env",
        "api key",
        "private key",
        "token",
    ]
    .iter()
    .any(|term| lower.contains(term))
}

fn skipped_observation(observation: AccessibilityObservation, sanitized_context: String, reaction_key: Option<String>, reason: &str) -> ObservePlanResult {
    ObservePlanResult {
        observation,
        sanitized_context,
        reaction_key,
        action: None,
        skipped_reason: Some(reason.to_string()),
    }
}
