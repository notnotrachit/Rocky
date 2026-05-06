use crate::models::{AccessibilityObservation, ActiveApp, CommandError};

#[cfg(target_os = "macos")]
use core::{ffi::c_void, ptr};

#[cfg(target_os = "macos")]
use core_foundation::{
    base::{CFGetTypeID, CFRelease, CFTypeRef, TCFType},
    boolean::CFBoolean,
    dictionary::{CFDictionary, CFDictionaryRef},
    string::{CFString, CFStringGetTypeID, CFStringRef},
};

#[cfg(target_os = "macos")]
type AXError = i32;

#[cfg(target_os = "macos")]
type AXUIElementRef = *const c_void;

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    static kAXTrustedCheckOptionPrompt: CFStringRef;

    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
    fn AXUIElementCreateSystemWide() -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(element: AXUIElementRef, attribute: CFStringRef, value: *mut CFTypeRef) -> AXError;
}

#[cfg(target_os = "macos")]
pub fn active_app() -> Result<ActiveApp, CommandError> {
    use objc2_app_kit::NSWorkspace;

    let workspace = NSWorkspace::sharedWorkspace();
    let app = workspace.frontmostApplication().ok_or("No frontmost macOS application found")?;

    let name = app
        .localizedName()
        .map(|value| value.to_string())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Unknown".to_string());

    let bundle_identifier = app.bundleIdentifier().map(|value| value.to_string());

    Ok(ActiveApp {
        name,
        bundle_identifier,
        process_id: app.processIdentifier(),
    })
}

#[cfg(target_os = "macos")]
pub fn accessibility_status() -> bool {
    unsafe { AXIsProcessTrusted() }
}

#[cfg(target_os = "macos")]
pub fn request_accessibility_permission() -> bool {
    let prompt_key = unsafe { CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt) };
    let prompt_value = CFBoolean::true_value();
    let options = CFDictionary::from_CFType_pairs(&[(prompt_key, prompt_value)]);

    unsafe { AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) }
}

#[cfg(target_os = "macos")]
pub fn accessibility_observation() -> Result<AccessibilityObservation, CommandError> {
    let active_app = active_app().ok();
    if !accessibility_status() {
        return Ok(AccessibilityObservation {
            trusted: false,
            active_app,
            window_title: None,
            focused_role: None,
            focused_title: None,
            focused_value: None,
            selected_text: None,
        });
    }

    let system = unsafe { AXUIElementCreateSystemWide() };
    if system.is_null() {
        return Err(CommandError::from("Could not create macOS Accessibility system element"));
    }

    let focused_application_attribute = CFString::from_static_string("AXFocusedApplication");
    let focused_window_attribute = CFString::from_static_string("AXFocusedWindow");
    let focused_ui_element_attribute = CFString::from_static_string("AXFocusedUIElement");
    let title_attribute = CFString::from_static_string("AXTitle");
    let role_attribute = CFString::from_static_string("AXRole");
    let value_attribute = CFString::from_static_string("AXValue");
    let selected_text_attribute = CFString::from_static_string("AXSelectedText");

    let mut window_title = None;
    let mut focused_role = None;
    let mut focused_title = None;
    let mut focused_value = None;
    let mut selected_text = None;

    unsafe {
        if let Some(focused_app) = copy_ax_element_attribute(system, focused_application_attribute.as_concrete_TypeRef()) {
            if let Some(focused_window) = copy_ax_element_attribute(focused_app, focused_window_attribute.as_concrete_TypeRef()) {
                window_title = copy_ax_string_attribute(focused_window, title_attribute.as_concrete_TypeRef(), 160);
                CFRelease(focused_window as CFTypeRef);
            }

            if let Some(focused_element) = copy_ax_element_attribute(focused_app, focused_ui_element_attribute.as_concrete_TypeRef()) {
                focused_role = copy_ax_string_attribute(focused_element, role_attribute.as_concrete_TypeRef(), 80);
                focused_title = copy_ax_string_attribute(focused_element, title_attribute.as_concrete_TypeRef(), 160);
                focused_value = copy_ax_string_attribute(focused_element, value_attribute.as_concrete_TypeRef(), 240);
                selected_text = copy_ax_string_attribute(focused_element, selected_text_attribute.as_concrete_TypeRef(), 240);
                CFRelease(focused_element as CFTypeRef);
            }

            CFRelease(focused_app as CFTypeRef);
        }

        CFRelease(system as CFTypeRef);
    }

    Ok(AccessibilityObservation {
        trusted: true,
        active_app,
        window_title,
        focused_role,
        focused_title,
        focused_value,
        selected_text,
    })
}

#[cfg(target_os = "macos")]
unsafe fn copy_ax_element_attribute(element: AXUIElementRef, attribute: CFStringRef) -> Option<AXUIElementRef> {
    let mut value: CFTypeRef = ptr::null();
    if AXUIElementCopyAttributeValue(element, attribute, &mut value) != 0 || value.is_null() {
        return None;
    }

    Some(value as AXUIElementRef)
}

#[cfg(target_os = "macos")]
unsafe fn copy_ax_string_attribute(element: AXUIElementRef, attribute: CFStringRef, max_chars: usize) -> Option<String> {
    let mut value: CFTypeRef = ptr::null();
    if AXUIElementCopyAttributeValue(element, attribute, &mut value) != 0 || value.is_null() {
        return None;
    }

    if CFGetTypeID(value) != CFStringGetTypeID() {
        CFRelease(value);
        return None;
    }

    let text = CFString::wrap_under_create_rule(value as CFStringRef).to_string();
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }

    Some(cap_text(trimmed, max_chars))
}

#[cfg(target_os = "macos")]
fn cap_text(value: &str, max_chars: usize) -> String {
    let mut output: String = value.chars().take(max_chars).collect();
    if value.chars().count() > max_chars {
        output.push_str("...");
    }
    output
}

#[cfg(not(target_os = "macos"))]
pub fn active_app() -> Result<ActiveApp, CommandError> {
    Err(CommandError::from("Active app observation is only implemented for macOS"))
}

#[cfg(not(target_os = "macos"))]
pub fn accessibility_status() -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn request_accessibility_permission() -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn accessibility_observation() -> Result<AccessibilityObservation, CommandError> {
    Ok(AccessibilityObservation {
        trusted: false,
        active_app: None,
        window_title: None,
        focused_role: None,
        focused_title: None,
        focused_value: None,
        selected_text: None,
    })
}
