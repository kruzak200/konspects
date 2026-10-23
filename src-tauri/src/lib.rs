use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const LIBRARY_DIR: &str = "Konspects";
const META_FILE: &str = "chapter.json";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SectionMeta {
    id: String,
    /// If set, overrides the auto title from the first line of the section file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    custom_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChapterMeta {
    version: u32,
    sections: Vec<SectionMeta>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionInfo {
    pub id: String,
    pub title: String,
    pub title_is_custom: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterSnapshot {
    pub sections: Vec<SectionInfo>,
    pub active_id: String,
    pub content: String,
}

fn library_root(app: &AppHandle) -> Result<PathBuf, String> {
    let docs = app
        .path()
        .document_dir()
        .map_err(|e| format!("Не удалось найти папку Документы: {e}"))?;
    Ok(docs.join(LIBRARY_DIR))
}

fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("Не удалось создать папку: {e}"))
}

fn validate_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Название не может быть пустым".into());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains('\0') {
        return Err("Название не должно содержать слэши".into());
    }
    if trimmed == "." || trimmed == ".." || trimmed.starts_with('.') {
        return Err("Недопустимое название".into());
    }
    Ok(trimmed.to_string())
}

fn subject_dir(root: &Path, subject: &str) -> Result<PathBuf, String> {
    let name = validate_name(subject)?;
    Ok(root.join(name))
}

fn chapter_dir(root: &Path, subject: &str, chapter: &str) -> Result<PathBuf, String> {
    let name = validate_name(chapter)?;
    Ok(subject_dir(root, subject)?.join(name))
}

fn legacy_chapter_file(root: &Path, subject: &str, chapter: &str) -> Result<PathBuf, String> {
    let name = validate_name(chapter)?;
    Ok(subject_dir(root, subject)?.join(format!("{name}.md")))
}

fn meta_path(dir: &Path) -> PathBuf {
    dir.join(META_FILE)
}

fn section_file(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.md"))
}

fn new_section_id() -> String {
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let r: u32 = (t as u32).wrapping_mul(2654435761) ^ (t >> 17) as u32;
    format!("s_{t:x}_{r:x}")
}

fn strip_simple_markup(s: &str) -> String {
    let mut t = s.trim().to_string();
    // Strip HTML tags if first line was saved as an aligned heading/paragraph.
    let mut out = String::new();
    let mut in_tag = false;
    for ch in t.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    t = out;
    t = t.trim_start_matches('#').trim().to_string();
    if t.starts_with("**") && t.ends_with("**") && t.len() > 4 {
        t = t[2..t.len() - 2].trim().to_string();
    }
    t
}

fn auto_title_from_content(content: &str) -> String {
    let line = content
        .lines()
        .map(|l| l.trim())
        .find(|l| !l.is_empty())
        .unwrap_or("");
    let title = strip_simple_markup(line);
    if title.is_empty() {
        "Без названия".into()
    } else if title.chars().count() > 80 {
        let clipped: String = title.chars().take(77).collect();
        format!("{clipped}…")
    } else {
        title
    }
}

fn list_dirs(path: &Path) -> Result<Vec<String>, String> {
    if !path.exists() {
        return Ok(vec![]);
    }
    let mut names = Vec::new();
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        if meta.is_dir() {
            if let Some(name) = entry.file_name().to_str() {
                if !name.starts_with('.') {
                    names.push(name.to_string());
                }
            }
        }
    }
    names.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(names)
}

fn read_meta(dir: &Path) -> Result<ChapterMeta, String> {
    let path = meta_path(dir);
    let raw = fs::read_to_string(&path).map_err(|e| format!("Не удалось прочитать главу: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Повреждён chapter.json: {e}"))
}

fn write_meta(dir: &Path, meta: &ChapterMeta) -> Result<(), String> {
    let path = meta_path(dir);
    let raw = serde_json::to_string_pretty(meta)
        .map_err(|e| format!("Не удалось записать метаданные: {e}"))?;
    fs::write(&path, raw).map_err(|e| format!("Не удалось сохранить главу: {e}"))
}

fn section_info(dir: &Path, meta: &SectionMeta) -> Result<SectionInfo, String> {
    let content = fs::read_to_string(section_file(dir, &meta.id)).unwrap_or_default();
    let title_is_custom = meta
        .custom_title
        .as_ref()
        .map(|t| !t.trim().is_empty())
        .unwrap_or(false);
    let title = if title_is_custom {
        meta.custom_title.as_ref().unwrap().trim().to_string()
    } else {
        auto_title_from_content(&content)
    };
    Ok(SectionInfo {
        id: meta.id.clone(),
        title,
        title_is_custom,
    })
}

fn create_empty_chapter_folder(dir: &Path) -> Result<ChapterMeta, String> {
    if dir.exists() {
        return Err("Такая глава уже есть".into());
    }
    ensure_dir(dir)?;
    let id = new_section_id();
    fs::write(section_file(dir, &id), "").map_err(|e| e.to_string())?;
    let meta = ChapterMeta {
        version: 1,
        sections: vec![SectionMeta {
            id,
            custom_title: None,
        }],
    };
    write_meta(dir, &meta)?;
    Ok(meta)
}

/// Turn a legacy `Глава.md` into `Глава/` with one section. Idempotent if folder exists.
fn ensure_chapter_folder(root: &Path, subject: &str, chapter: &str) -> Result<PathBuf, String> {
    let dir = chapter_dir(root, subject, chapter)?;
    let legacy = legacy_chapter_file(root, subject, chapter)?;

    if dir.is_dir() && meta_path(&dir).exists() {
        // Folder chapter already OK; if a leftover .md exists, leave it (user can delete).
        return Ok(dir);
    }

    if legacy.is_file() {
        if dir.exists() && !meta_path(&dir).exists() {
            return Err(format!(
                "Конфликт: есть и файл «{chapter}.md», и папка «{chapter}» без chapter.json"
            ));
        }
        let content = fs::read_to_string(&legacy).map_err(|e| e.to_string())?;
        ensure_dir(&dir)?;
        let id = new_section_id();
        fs::write(section_file(&dir, &id), content).map_err(|e| e.to_string())?;
        let meta = ChapterMeta {
            version: 1,
            sections: vec![SectionMeta {
                id,
                custom_title: None,
            }],
        };
        write_meta(&dir, &meta)?;
        fs::remove_file(&legacy).map_err(|e| format!("Не удалось убрать старый .md: {e}"))?;
        return Ok(dir);
    }

    if dir.is_dir() {
        // Folder without meta — repair with existing .md files or one empty section
        let mut sections = Vec::new();
        for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if let Some(stem) = name.strip_suffix(".md") {
                if !stem.is_empty() && !stem.starts_with('.') {
                    sections.push(SectionMeta {
                        id: stem.to_string(),
                        custom_title: None,
                    });
                }
            }
        }
        if sections.is_empty() {
            let id = new_section_id();
            fs::write(section_file(&dir, &id), "").map_err(|e| e.to_string())?;
            sections.push(SectionMeta {
                id,
                custom_title: None,
            });
        }
        let meta = ChapterMeta {
            version: 1,
            sections,
        };
        write_meta(&dir, &meta)?;
        return Ok(dir);
    }

    Err("Глава не найдена".into())
}

fn chapter_exists(root: &Path, subject: &str, chapter: &str) -> Result<bool, String> {
    let dir = chapter_dir(root, subject, chapter)?;
    let legacy = legacy_chapter_file(root, subject, chapter)?;
    Ok(dir.is_dir() || legacy.is_file())
}

fn snapshot_for(
    dir: &Path,
    meta: &ChapterMeta,
    active_id: Option<&str>,
) -> Result<ChapterSnapshot, String> {
    if meta.sections.is_empty() {
        return Err("В главе нет разделов".into());
    }
    let mut infos = Vec::new();
    for s in &meta.sections {
        infos.push(section_info(dir, s)?);
    }
    let active = active_id
        .filter(|id| meta.sections.iter().any(|s| s.id == *id))
        .unwrap_or(&meta.sections[0].id)
        .to_string();
    let content = fs::read_to_string(section_file(dir, &active))
        .map_err(|e| format!("Не удалось прочитать раздел: {e}"))?;
    Ok(ChapterSnapshot {
        sections: infos,
        active_id: active,
        content,
    })
}

#[tauri::command]
fn get_library_info(app: AppHandle) -> Result<LibraryInfo, String> {
    let root = library_root(&app)?;
    ensure_dir(&root)?;
    Ok(LibraryInfo {
        path: root.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn list_subjects(app: AppHandle) -> Result<Vec<String>, String> {
    let root = library_root(&app)?;
    ensure_dir(&root)?;
    list_dirs(&root)
}

#[tauri::command]
fn create_subject(app: AppHandle, name: String) -> Result<String, String> {
    let root = library_root(&app)?;
    ensure_dir(&root)?;
    let dir = subject_dir(&root, &name)?;
    if dir.exists() {
        return Err("Такой предмет уже есть".into());
    }
    ensure_dir(&dir)?;
    Ok(validate_name(&name)?)
}

#[tauri::command]
fn rename_subject(app: AppHandle, old_name: String, new_name: String) -> Result<String, String> {
    let root = library_root(&app)?;
    let from = subject_dir(&root, &old_name)?;
    let to = subject_dir(&root, &new_name)?;
    if !from.exists() {
        return Err("Предмет не найден".into());
    }
    if to.exists() {
        return Err("Предмет с таким названием уже есть".into());
    }
    fs::rename(&from, &to).map_err(|e| format!("Не удалось переименовать: {e}"))?;
    Ok(validate_name(&new_name)?)
}

#[tauri::command]
fn delete_subject(app: AppHandle, name: String) -> Result<(), String> {
    let root = library_root(&app)?;
    let dir = subject_dir(&root, &name)?;
    if !dir.exists() {
        return Err("Предмет не найден".into());
    }
    fs::remove_dir_all(&dir).map_err(|e| format!("Не удалось удалить: {e}"))
}

#[tauri::command]
fn list_chapters(app: AppHandle, subject: String) -> Result<Vec<String>, String> {
    let root = library_root(&app)?;
    let dir = subject_dir(&root, &subject)?;
    if !dir.exists() {
        return Err("Предмет не найден".into());
    }
    let mut names = std::collections::BTreeSet::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let fname = entry.file_name();
        let Some(name) = fname.to_str() else { continue };
        if name.starts_with('.') {
            continue;
        }
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        if meta.is_dir() {
            names.insert(name.to_string());
        } else if let Some(stem) = name.strip_suffix(".md") {
            if !stem.is_empty() {
                names.insert(stem.to_string());
            }
        }
    }
    Ok(names.into_iter().collect())
}

#[tauri::command]
fn create_chapter(app: AppHandle, subject: String, name: String) -> Result<String, String> {
    let root = library_root(&app)?;
    let sdir = subject_dir(&root, &subject)?;
    if !sdir.exists() {
        return Err("Предмет не найден".into());
    }
    if chapter_exists(&root, &subject, &name)? {
        return Err("Такая глава уже есть".into());
    }
    let dir = chapter_dir(&root, &subject, &name)?;
    create_empty_chapter_folder(&dir)?;
    Ok(validate_name(&name)?)
}

#[tauri::command]
fn rename_chapter(
    app: AppHandle,
    subject: String,
    old_name: String,
    new_name: String,
) -> Result<String, String> {
    let root = library_root(&app)?;
    let next = validate_name(&new_name)?;
    if chapter_exists(&root, &subject, &next)? {
        return Err("Глава с таким названием уже есть".into());
    }
    let from_dir = ensure_chapter_folder(&root, &subject, &old_name)?;
    let to_dir = chapter_dir(&root, &subject, &next)?;
    fs::rename(&from_dir, &to_dir).map_err(|e| format!("Не удалось переименовать: {e}"))?;
    Ok(next)
}

#[tauri::command]
fn delete_chapter(app: AppHandle, subject: String, name: String) -> Result<(), String> {
    let root = library_root(&app)?;
    let dir = chapter_dir(&root, &subject, &name)?;
    let legacy = legacy_chapter_file(&root, &subject, &name)?;
    if dir.is_dir() {
        fs::remove_dir_all(&dir).map_err(|e| format!("Не удалось удалить: {e}"))?;
    }
    if legacy.is_file() {
        fs::remove_file(&legacy).map_err(|e| format!("Не удалось удалить: {e}"))?;
    }
    if !dir.exists() && !legacy.exists() {
        // ok if one form existed
    }
    Ok(())
}

#[tauri::command]
fn open_chapter(
    app: AppHandle,
    subject: String,
    chapter: String,
    section_id: Option<String>,
) -> Result<ChapterSnapshot, String> {
    let root = library_root(&app)?;
    let dir = ensure_chapter_folder(&root, &subject, &chapter)?;
    let meta = read_meta(&dir)?;
    snapshot_for(&dir, &meta, section_id.as_deref())
}

#[tauri::command]
fn create_section(
    app: AppHandle,
    subject: String,
    chapter: String,
) -> Result<ChapterSnapshot, String> {
    let root = library_root(&app)?;
    let dir = ensure_chapter_folder(&root, &subject, &chapter)?;
    let mut meta = read_meta(&dir)?;
    let id = new_section_id();
    fs::write(section_file(&dir, &id), "").map_err(|e| e.to_string())?;
    meta.sections.push(SectionMeta {
        id: id.clone(),
        custom_title: None,
    });
    write_meta(&dir, &meta)?;
    snapshot_for(&dir, &meta, Some(&id))
}

#[tauri::command]
fn delete_section(
    app: AppHandle,
    subject: String,
    chapter: String,
    section_id: String,
) -> Result<ChapterSnapshot, String> {
    let root = library_root(&app)?;
    let dir = ensure_chapter_folder(&root, &subject, &chapter)?;
    let mut meta = read_meta(&dir)?;
    if meta.sections.len() <= 1 {
        return Err("Нельзя удалить единственный раздел".into());
    }
    if !meta.sections.iter().any(|s| s.id == section_id) {
        return Err("Раздел не найден".into());
    }
    meta.sections.retain(|s| s.id != section_id);
    let _ = fs::remove_file(section_file(&dir, &section_id));
    write_meta(&dir, &meta)?;
    snapshot_for(&dir, &meta, None)
}

#[tauri::command]
fn set_section_title(
    app: AppHandle,
    subject: String,
    chapter: String,
    section_id: String,
    custom_title: Option<String>,
) -> Result<ChapterSnapshot, String> {
    let root = library_root(&app)?;
    let dir = ensure_chapter_folder(&root, &subject, &chapter)?;
    let mut meta = read_meta(&dir)?;
    let section = meta
        .sections
        .iter_mut()
        .find(|s| s.id == section_id)
        .ok_or_else(|| "Раздел не найден".to_string())?;
    let trimmed = custom_title
        .as_ref()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());
    section.custom_title = trimmed;
    write_meta(&dir, &meta)?;
    snapshot_for(&dir, &meta, Some(&section_id))
}

#[tauri::command]
fn write_section(
    app: AppHandle,
    subject: String,
    chapter: String,
    section_id: String,
    content: String,
) -> Result<ChapterSnapshot, String> {
    let root = library_root(&app)?;
    let dir = ensure_chapter_folder(&root, &subject, &chapter)?;
    let meta = read_meta(&dir)?;
    if !meta.sections.iter().any(|s| s.id == section_id) {
        return Err("Раздел не найден".into());
    }
    fs::write(section_file(&dir, &section_id), content)
        .map_err(|e| format!("Не удалось сохранить: {e}"))?;
    snapshot_for(&dir, &meta, Some(&section_id))
}

#[tauri::command]
fn read_chapter_export(
    app: AppHandle,
    subject: String,
    chapter: String,
) -> Result<String, String> {
    let root = library_root(&app)?;
    let dir = ensure_chapter_folder(&root, &subject, &chapter)?;
    let meta = read_meta(&dir)?;
    let mut parts = Vec::new();
    for s in &meta.sections {
        let info = section_info(&dir, s)?;
        let body = fs::read_to_string(section_file(&dir, &s.id)).unwrap_or_default();
        if body.trim().is_empty() {
            continue;
        }
        parts.push(format!("# {}\n\n{}", info.title, body.trim()));
    }
    Ok(parts.join("\n\n"))
}

/// Write an exported file (DOCX/PDF) chosen via the native save dialog.
#[tauri::command]
fn write_export_file(path: String, data_base64: String) -> Result<(), String> {
    use base64::Engine;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Путь не задан".into());
    }
    let lower = trimmed.to_lowercase();
    if !(lower.ends_with(".docx") || lower.ends_with(".pdf")) {
        return Err("Можно сохранять только .docx или .pdf".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("Не удалось прочитать данные экспорта: {e}"))?;
    if let Some(parent) = Path::new(trimmed).parent() {
        if !parent.as_os_str().is_empty() {
            ensure_dir(parent)?;
        }
    }
    fs::write(trimmed, bytes).map_err(|e| format!("Не удалось сохранить файл: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_library_info,
            list_subjects,
            create_subject,
            rename_subject,
            delete_subject,
            list_chapters,
            create_chapter,
            rename_chapter,
            delete_chapter,
            open_chapter,
            create_section,
            delete_section,
            set_section_title,
            write_section,
            read_chapter_export,
            write_export_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
