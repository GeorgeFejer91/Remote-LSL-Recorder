use crate::types::Authority;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, io::Read, path::Path};

const MAX_WORKSPACE_BYTES: usize = 1_000_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalPage {
    pub id: String,
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct ViewerPreferences {
    pub hidden_channels: HashSet<String>,
    pub fit_preview: bool,
    pub setup_width: Option<f64>,
    pub setup_height: Option<f64>,
    pub preview_height: Option<f64>,
}

impl ViewerPreferences {
    pub fn validate(&self) -> Result<(), String> {
        if self.hidden_channels.len() > 4096
            || self.hidden_channels.iter().any(|key| key.len() > 2048)
            || [self.setup_width, self.setup_height, self.preview_height]
                .into_iter()
                .flatten()
                .any(|size| !size.is_finite() || !(160.0..=4000.0).contains(&size))
        {
            return Err("Viewer preferences exceed their supported bounds.".into());
        }
        Ok(())
    }
}

pub fn normalize_pages(
    pages: Vec<ExternalPage>,
    persistent: bool,
) -> Result<Vec<ExternalPage>, String> {
    let mut ids = HashSet::new();
    let mut result = Vec::new();
    for mut page in pages {
        if page.id.is_empty()
            || page.id.len() > 64
            || !page
                .id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
            || !ids.insert(page.id.clone())
        {
            return Err("External pages need unique stable IDs of 1–64 ASCII letters, digits, hyphens or underscores.".into());
        }
        page.name = page.name.trim().into();
        if page.name.is_empty()
            || page.name.chars().count() > 80
            || page.name.chars().any(char::is_control)
        {
            return Err("Page names must contain 1–80 printable characters.".into());
        }
        let mut url = tauri::Url::parse(page.url.trim())
            .map_err(|_| "Enter a complete HTTPS controller URL.")?;
        let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
        if !(url.scheme() == "https" || (url.scheme() == "http" && loopback))
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.as_str().len() > 4096
        {
            return Err("External pages require HTTPS, or HTTP loopback for desktop development, without URL credentials.".into());
        }
        if persistent {
            url.set_query(None);
            url.set_fragment(None);
        }
        page.url = url.into();
        result.push(page);
    }
    if serde_json::to_vec(&result)
        .map_err(|_| "Could not encode external pages.")?
        .len()
        > MAX_WORKSPACE_BYTES
    {
        return Err("The external page catalog exceeds 1 MB.".into());
    }
    Ok(result)
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceSettings {
    version: u8,
    pub participant_id: String,
    pub output_directory: String,
    pub select_all_streams: bool,
    pub selected_stream_ids: HashSet<String>,
    pub keyboard_markers: bool,
    pub mouse_markers: bool,
    pub external_pages: Vec<ExternalPage>,
    pub viewer: ViewerPreferences,
}

impl WorkspaceSettings {
    pub fn load(path: &Path) -> Result<Option<Self>, String> {
        let file = match fs::File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => {
                return Err(
                    "Saved workspace could not be opened; the original file is preserved.".into(),
                );
            }
        };
        let mut bytes = Vec::new();
        file.take((MAX_WORKSPACE_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "Saved workspace could not be read.")?;
        if bytes.len() > MAX_WORKSPACE_BYTES {
            return Err("Saved workspace exceeds 1 MB.".into());
        }
        let mut settings: Self = serde_json::from_slice(&bytes)
            .map_err(|_| "Saved workspace is invalid; defaults are active and the original file is preserved.")?;
        if settings.version != 1 {
            return Err(
                "Saved workspace has an unsupported version; the original file is preserved."
                    .into(),
            );
        }
        if !settings.participant_id.is_empty() {
            super::state::validate_participant(&settings.participant_id)?;
        }
        if !Path::new(&settings.output_directory).is_absolute()
            || settings.output_directory.len() > 4096
            || settings.selected_stream_ids.len() > 4096
            || settings
                .selected_stream_ids
                .iter()
                .any(|id| id.len() > 2048)
        {
            return Err(
                "Saved session settings are invalid; the original file is preserved.".into(),
            );
        }
        settings.external_pages = normalize_pages(settings.external_pages, true)?;
        settings.viewer.validate()?;
        Ok(Some(settings))
    }

    pub fn save(path: &Path, state: &Authority) -> Result<(), String> {
        let settings = Self {
            version: 1,
            participant_id: state.participant_id.clone(),
            output_directory: state.output_directory.clone(),
            select_all_streams: state.select_all_streams,
            selected_stream_ids: state.remembered_selected_ids.clone(),
            keyboard_markers: state.keyboard_markers,
            mouse_markers: state.mouse_markers,
            external_pages: normalize_pages(state.external_pages.clone(), true)?,
            viewer: state.viewer.clone(),
        };
        let bytes = serde_json::to_vec_pretty(&settings)
            .map_err(|_| "Could not encode workspace settings.")?;
        if bytes.len() > MAX_WORKSPACE_BYTES {
            return Err("Workspace settings exceed 1 MB.".into());
        }
        let parent = path
            .parent()
            .ok_or("Workspace settings path has no parent.")?;
        fs::create_dir_all(parent)
            .map_err(|_| "Could not create the workspace settings folder.")?;
        let temporary = path.with_extension("json.tmp");
        use std::io::Write;
        let mut file =
            fs::File::create(&temporary).map_err(|_| "Could not write workspace settings.")?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|_| "Could not flush workspace settings.")?;
        drop(file);
        fs::rename(&temporary, path).map_err(|_| {
            "Could not replace workspace settings; the previous file is preserved.".to_string()
        })
    }
}
