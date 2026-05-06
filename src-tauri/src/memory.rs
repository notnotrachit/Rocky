use std::{fs, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};

use tauri::{AppHandle, Manager};

use crate::models::{CommandError, MemoryItem};

pub fn list(app: &AppHandle) -> Result<Vec<MemoryItem>, CommandError> {
    read_all(app)
}

pub fn relevant(app: &AppHandle, message: &str, limit: usize) -> Result<Vec<MemoryItem>, CommandError> {
    let mut memories = read_all(app)?;
    let terms = keywords(message);

    memories.sort_by(|a, b| {
        let a_score = score_memory(a, &terms);
        let b_score = score_memory(b, &terms);
        b_score
            .cmp(&a_score)
            .then_with(|| b.last_used_at.cmp(&a.last_used_at))
            .then_with(|| b.created_at.cmp(&a.created_at))
    });

    Ok(memories.into_iter().take(limit).collect())
}

pub fn remember(app: &AppHandle, subject: String, fact: String, source: String, confidence: f64) -> Result<MemoryItem, CommandError> {
    let subject = subject.trim();
    let fact = fact.trim();

    if subject.is_empty() || fact.is_empty() {
        return Err(CommandError::from("Memory subject and fact are required."));
    }

    let mut memories = read_all(app)?;
    let now = now_ms();

    if let Some(existing) = memories.iter_mut().find(|memory| {
        memory.subject.eq_ignore_ascii_case(subject) && memory.fact.eq_ignore_ascii_case(fact)
    }) {
        existing.confidence = existing.confidence.max(confidence.clamp(0.0, 1.0));
        existing.last_used_at = now;
        let item = existing.clone();
        write_all(app, &memories)?;
        return Ok(item);
    }

    let item = MemoryItem {
        id: format!("mem-{now}-{}", memories.len() + 1),
        subject: subject.to_string(),
        fact: fact.to_string(),
        source,
        confidence: confidence.clamp(0.0, 1.0),
        created_at: now,
        last_used_at: now,
    };

    memories.push(item.clone());
    write_all(app, &memories)?;
    Ok(item)
}

pub fn delete(app: &AppHandle, id: String) -> Result<(), CommandError> {
    let mut memories = read_all(app)?;
    memories.retain(|memory| memory.id != id);
    write_all(app, &memories)
}

pub fn clear(app: &AppHandle) -> Result<(), CommandError> {
    write_all(app, &[])
}

fn read_all(app: &AppHandle) -> Result<Vec<MemoryItem>, CommandError> {
    let path = memory_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let contents = fs::read_to_string(&path)
        .map_err(|error| CommandError::from(format!("Could not read memory file: {error}")))?;
    serde_json::from_str(&contents)
        .map_err(|error| CommandError::from(format!("Could not parse memory file: {error}")))
}

fn write_all(app: &AppHandle, memories: &[MemoryItem]) -> Result<(), CommandError> {
    let path = memory_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| CommandError::from(format!("Could not create memory directory: {error}")))?;
    }

    let json = serde_json::to_string_pretty(memories)
        .map_err(|error| CommandError::from(format!("Could not serialize memories: {error}")))?;
    fs::write(path, json)
        .map_err(|error| CommandError::from(format!("Could not write memory file: {error}")))
}

fn memory_path(app: &AppHandle) -> Result<PathBuf, CommandError> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("memories.json"))
        .map_err(|error| CommandError::from(format!("Could not resolve memory path: {error}")))
}

fn score_memory(memory: &MemoryItem, terms: &[String]) -> usize {
    let haystack = format!("{} {}", memory.subject, memory.fact).to_lowercase();
    terms.iter().filter(|term| haystack.contains(term.as_str())).count()
}

fn keywords(message: &str) -> Vec<String> {
    message
        .split(|character: char| !character.is_alphanumeric())
        .map(str::trim)
        .filter(|word| word.len() > 3)
        .map(str::to_lowercase)
        .take(24)
        .collect()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
