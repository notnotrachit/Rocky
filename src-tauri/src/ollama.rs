use crate::models::{CommandError, GenerateRequest, GenerateResponse, OllamaHealth, OllamaModel, OllamaTagsResponse};

pub async fn health() -> Result<OllamaHealth, CommandError> {
    let ready = reqwest::get("http://127.0.0.1:11434")
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false);

    Ok(OllamaHealth { ready })
}

pub async fn models() -> Result<Vec<OllamaModel>, CommandError> {
    let response = reqwest::get("http://127.0.0.1:11434/api/tags")
        .await
        .map_err(|error| CommandError { message: format!("Ollama tags request failed: {error}") })?
        .json::<OllamaTagsResponse>()
        .await
        .map_err(|error| CommandError { message: format!("Ollama tags parse failed: {error}") })?;

    Ok(response.models)
}

pub async fn generate(base_url: &str, model: &str, prompt: &str) -> Result<String, CommandError> {
    let url = format!("{}/api/generate", base_url.trim_end_matches('/'));
    let response = reqwest::Client::new()
        .post(url)
        .json(&GenerateRequest { model: model.to_string(), prompt: prompt.to_string(), stream: false })
        .send()
        .await
        .map_err(|error| CommandError { message: format!("Ollama request failed: {error}") })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_else(|_| "no response body".to_string());
        return Err(CommandError { message: format!("Ollama returned {status}: {body}") });
    }

    let response = response
        .json::<GenerateResponse>()
        .await
        .map_err(|error| CommandError { message: format!("Ollama response parse failed: {error}") })?;

    Ok(response.response)
}
