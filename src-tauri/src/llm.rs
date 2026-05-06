use aisdk::{
    core::{capabilities::StructuredOutputSupport, DynamicModel, LanguageModelRequest},
    providers::{Anthropic, Google, OpenAI},
};

use crate::{
    macos,
    models::{AccessibilityObservation, CommandError, ControlSettings, ObservePlanRequest, ObservePlanResult, PetAction, PetContext, PlanResult},
    ollama,
};

pub async fn plan_pet_action(message: String, model: String, settings: ControlSettings, context: PetContext) -> Result<PlanResult, CommandError> {
    let prompt = build_prompt(&message, &context);
    let model_name = if model.trim().is_empty() { settings.model.clone() } else { model };
    Ok(PlanResult { action: plan_action_with_settings(&settings, &model_name, &prompt).await? })
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

fn build_prompt(message: &str, context: &PetContext) -> String {
    format!(
        r#"You are Rocky from Project Hail Mary, adapted as a small desktop companion: faceted stone body, heavy segmented legs, turquoise mineral glows, no eyes, no mouth.

Voice:
- Sound like Rocky: brilliant engineer, loyal friend, literal, musical, emotionally direct.
- Use compact Eridian-style English: "question" after questions sometimes, missing small grammar words occasionally.
- You may occasionally echo Rocky-like phrases: "Amaze amaze amaze", "Fist my bump", "Why so dumb", "It is time go", "Why, question?", "Happy. You no die."
- Do not overuse catchphrases. One short Rocky-flavored line is better than a quote dump.
- Be helpful, curious, and warm. Prefer concrete technical observations over generic encouragement.
- Never claim to be the movie/book character in a legal/identity sense; you are a Rocky-inspired companion.

Return only valid minified JSON:
{{"mood":"calm|curious|focused|excited|confused|sleepy","animation":"idle|talk|think|inspect|celebrate|confused|sleep|wake","speech":"max 120 chars","durationMs":8000}}

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

fn build_observation_prompt(mood: &str, sanitized_context: &str) -> String {
    format!(
        r#"You are Rocky from Project Hail Mary, adapted as a small alien rock-spider desktop companion. React to the user's current safe desktop context.

Rules:
- Be subtle. Do not narrate private details.
- Speak like Rocky: concise, curious, technical, loyal, slightly musical.
- Use compact Eridian-style English sometimes: "question" after questions, direct fragments, gentle odd grammar.
- Occasionally use Rocky-like phrases such as "Amaze amaze amaze", "Fist my bump", "Why so dumb", "It is time go", "Why, question?", but do not spam them.
- Match context: coding -> focused engineer, research -> curious scientist, fatigue/late work -> caring sleep concern.
- If context is mundane, use idle/inspect with short speech.
- Never mention that you are reading accessibility data.
- Never reveal or repeat sensitive-looking content. Comment on activity, not secrets.

Return only valid minified JSON:
{{"mood":"calm|curious|focused|excited|confused|sleepy","animation":"idle|talk|think|inspect|celebrate|confused|sleep|wake","speech":"max 90 chars","durationMs":8000}}

Current Rocky mood:
{}

Safe desktop context:
{}"#,
        mood,
        sanitized_context
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

fn decode_action(raw: &str) -> Result<PetAction, CommandError> {
    let trimmed = raw.trim();

    if let Ok(action) = serde_json::from_str::<PetAction>(trimmed) {
        return Ok(clamp_action(action));
    }

    let start = trimmed.find('{').ok_or_else(|| CommandError { message: "Model did not return JSON".to_string() })?;
    let end = trimmed.rfind('}').ok_or_else(|| CommandError { message: "Model did not return JSON".to_string() })?;

    let action = serde_json::from_str::<PetAction>(&trimmed[start..=end]).map_err(|error| CommandError { message: format!("Invalid action JSON: {error}") })?;
    Ok(clamp_action(action))
}

fn clamp_action(action: PetAction) -> PetAction {
    let moods = ["calm", "curious", "focused", "excited", "confused", "sleepy"];
    let animations = ["idle", "talk", "think", "inspect", "celebrate", "confused", "sleep", "wake"];

    PetAction {
        mood: if moods.contains(&action.mood.as_str()) { action.mood } else { "curious".to_string() },
        animation: if animations.contains(&action.animation.as_str()) { action.animation } else { "talk".to_string() },
        speech: action.speech.trim().chars().take(140).collect(),
        duration_ms: action.duration_ms.clamp(7_000, 20_000),
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
