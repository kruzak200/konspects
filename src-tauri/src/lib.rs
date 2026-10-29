use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const LIBRARY_DIR: &str = "Konspects";
const META_FILE: &str = "chapter.json";
const META_VERSION: u32 = 2;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubsectionMeta {
    id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    custom_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SectionMeta {
    id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    custom_title: Option<String>,
    /// Empty only briefly during migration; always ≥1 after migrate_to_v2.
    #[serde(default)]
    subsections: Vec<SubsectionMeta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChapterMeta {
    version: u32,
    sections: Vec<SectionMeta>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubsectionInfo {
    pub id: String,
    pub title: String,
    pub title_is_custom: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionInfo {
    pub id: String,
    pub title: String,
    pub title_is_custom: bool,
    pub subsections: Vec<SubsectionInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterSnapshot {
    pub sections: Vec<SectionInfo>,
    pub active_section_id: String,
    pub active_subsection_id: String,
    pub content: String,
    pub chapter_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedImage {
    pub relative_path: String,
    pub absolute_path: String,
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
    Ok(root.join(validate_name(subject)?))
}

fn chapter_dir(root: &Path, subject: &str, chapter: &str) -> Result<PathBuf, String> {
    Ok(subject_dir(root, subject)?.join(validate_name(chapter)?))
}

fn legacy_chapter_file(root: &Path, subject: &str, chapter: &str) -> Result<PathBuf, String> {
    Ok(subject_dir(root, subject)?.join(format!("{}.md", validate_name(chapter)?)))
}

fn meta_path(dir: &Path) -> PathBuf {
    dir.join(META_FILE)
}

fn validate_id(id: &str, kind: &str) -> Result<&str, String> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err(format!("{kind} не найден"));
    }
    if trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('\0')
        || trimmed.contains("..")
        || trimmed.starts_with('.')
    {
        return Err(format!("Недопустимый идентификатор ({kind})"));
    }
    Ok(trimmed)
}

fn new_id(prefix: &str) -> String {
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let r: u32 = (t as u32).wrapping_mul(2654435761) ^ (t >> 17) as u32;
    format!("{prefix}_{t:x}_{r:x}")
}

fn new_section_id() -> String {
    new_id("s")
}

fn new_subsection_id() -> String {
    new_id("u")
}

fn section_dir(chapter: &Path, section_id: &str) -> PathBuf {
    chapter.join(section_id)
}

fn subsection_file(chapter: &Path, section_id: &str, subsection_id: &str) -> PathBuf {
    section_dir(chapter, section_id).join(format!("{subsection_id}.md"))
}

fn subsection_assets_dir(chapter: &Path, section_id: &str, subsection_id: &str) -> PathBuf {
    chapter
        .join("assets")
        .join(section_id)
        .join(subsection_id)
}

fn strip_simple_markup(s: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    let mut t = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"");
    t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    t = t.trim_start_matches('#').trim().to_string();
    if t.starts_with("**") && t.ends_with("**") && t.len() > 4 {
        t = t[2..t.len() - 2].trim().to_string();
    }
    t
}

fn clip_title(title: String) -> String {
    if title.is_empty() {
        "Без названия".into()
    } else if title.chars().count() > 80 {
        let clipped: String = title.chars().take(77).collect();
        format!("{clipped}…")
    } else {
        title
    }
}

fn is_image_only_line(line: &str) -> bool {
    let t = line.trim();
    if t.is_empty() {
        return true;
    }
    if t.starts_with("data:image/") {
        return true;
    }
    if t.starts_with("![") && t.contains("](") && t.ends_with(')') {
        return true;
    }
    let lower = t.to_lowercase();
    lower.starts_with("<img") && lower.ends_with('>')
}

fn auto_title_from_content(content: &str) -> String {
    for line in content.lines().take(12) {
        let trimmed = line.trim();
        if is_image_only_line(trimmed) {
            continue;
        }
        let hashes = trimmed.chars().take_while(|c| *c == '#').count();
        if (1..=3).contains(&hashes) {
            let rest = trimmed[hashes..].trim();
            if !rest.is_empty() {
                let t = strip_simple_markup(rest);
                if !t.is_empty() {
                    return clip_title(t);
                }
            }
        }
    }
    if let Some(start) = content.find("<h") {
        let slice = &content[start..];
        if let Some(open_end) = slice.find('>') {
            let after_open = &slice[open_end + 1..];
            if let Some(close_rel) = after_open.to_lowercase().find("</h") {
                let inner = &after_open[..close_rel];
                let t = strip_simple_markup(inner);
                if !t.is_empty() {
                    return clip_title(t);
                }
            }
        }
    }
    let line = content
        .lines()
        .map(|l| l.trim())
        .find(|l| !l.is_empty() && !is_image_only_line(l))
        .unwrap_or("");
    clip_title(strip_simple_markup(line))
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

fn rewrite_asset_paths(content: &str, section_id: &str, subsection_id: &str) -> String {
    let old = format!("assets/{section_id}/");
    let new = format!("assets/{section_id}/{subsection_id}/");
    content.replace(&old, &new)
}

/// Migrate v1 flat `s_….md` (+ `assets/s_…/`) into section folders + subsections.
fn migrate_to_v2(dir: &Path, meta: &mut ChapterMeta) -> Result<(), String> {
    if meta.version >= META_VERSION
        && meta
            .sections
            .iter()
            .all(|s| !s.subsections.is_empty())
    {
        return Ok(());
    }

    for section in &mut meta.sections {
        if !section.subsections.is_empty() {
            // Ensure folder layout exists for already-migrated entries.
            ensure_dir(&section_dir(dir, &section.id))?;
            continue;
        }

        let legacy_md = dir.join(format!("{}.md", section.id));
        let content = if legacy_md.is_file() {
            fs::read_to_string(&legacy_md).unwrap_or_default()
        } else {
            String::new()
        };

        let uid = new_subsection_id();
        ensure_dir(&section_dir(dir, &section.id))?;

        // Move legacy assets/s_xxx/* → assets/s_xxx/u_yyy/*
        let old_assets = dir.join("assets").join(&section.id);
        let new_assets = subsection_assets_dir(dir, &section.id, &uid);
        let mut body = content;
        if old_assets.is_dir() {
            // If old_assets already has subsection folders, leave as-is.
            let has_subdirs = fs::read_dir(&old_assets)
                .map(|rd| {
                    rd.filter_map(|e| e.ok()).any(|e| {
                        e.path().is_dir()
                            && e.file_name()
                                .to_str()
                                .map(|n| n.starts_with('u'))
                                .unwrap_or(false)
                    })
                })
                .unwrap_or(false);
            if !has_subdirs {
                ensure_dir(&new_assets)?;
                for entry in fs::read_dir(&old_assets).map_err(|e| e.to_string())? {
                    let entry = entry.map_err(|e| e.to_string())?;
                    let path = entry.path();
                    if path.is_file() {
                        let name = entry.file_name();
                        let dest = new_assets.join(&name);
                        let _ = fs::rename(&path, &dest);
                    }
                }
                body = rewrite_asset_paths(&body, &section.id, &uid);
            }
        }

        fs::write(subsection_file(dir, &section.id, &uid), &body)
            .map_err(|e| format!("Не удалось перенести раздел: {e}"))?;
        if legacy_md.is_file() {
            let _ = fs::remove_file(&legacy_md);
        }

        section.subsections.push(SubsectionMeta {
            id: uid,
            custom_title: None,
        });
    }

    meta.version = META_VERSION;
    write_meta(dir, meta)?;
    Ok(())
}

fn ensure_meta_v2(dir: &Path) -> Result<ChapterMeta, String> {
    let mut meta = read_meta(dir)?;
    migrate_to_v2(dir, &mut meta)?;
    // Re-read in case migrate wrote; keep in-memory meta which is current.
    Ok(meta)
}

fn subsection_info(
    dir: &Path,
    section_id: &str,
    sub: &SubsectionMeta,
) -> Result<SubsectionInfo, String> {
    let content =
        fs::read_to_string(subsection_file(dir, section_id, &sub.id)).unwrap_or_default();
    let title_is_custom = sub
        .custom_title
        .as_ref()
        .map(|t| !t.trim().is_empty())
        .unwrap_or(false);
    let title = if title_is_custom {
        sub.custom_title.as_ref().unwrap().trim().to_string()
    } else {
        auto_title_from_content(&content)
    };
    Ok(SubsectionInfo {
        id: sub.id.clone(),
        title,
        title_is_custom,
    })
}

fn section_info(dir: &Path, meta: &SectionMeta) -> Result<SectionInfo, String> {
    let mut subs = Vec::new();
    for sub in &meta.subsections {
        subs.push(subsection_info(dir, &meta.id, sub)?);
    }
    let title_is_custom = meta
        .custom_title
        .as_ref()
        .map(|t| !t.trim().is_empty())
        .unwrap_or(false);
    let title = if title_is_custom {
        meta.custom_title.as_ref().unwrap().trim().to_string()
    } else if let Some(first) = subs.first() {
        first.title.clone()
    } else {
        "Без названия".into()
    };
    Ok(SectionInfo {
        id: meta.id.clone(),
        title,
        title_is_custom,
        subsections: subs,
    })
}

fn create_empty_chapter_folder(dir: &Path) -> Result<ChapterMeta, String> {
    if dir.exists() {
        return Err("Такая глава уже есть".into());
    }
    ensure_dir(dir)?;
    let sid = new_section_id();
    let uid = new_subsection_id();
    ensure_dir(&section_dir(dir, &sid))?;
    fs::write(subsection_file(dir, &sid, &uid), "").map_err(|e| e.to_string())?;
    let meta = ChapterMeta {
        version: META_VERSION,
        sections: vec![SectionMeta {
            id: sid,
            custom_title: None,
            subsections: vec![SubsectionMeta {
                id: uid,
                custom_title: None,
            }],
        }],
    };
    write_meta(dir, &meta)?;
    Ok(meta)
}

fn ensure_chapter_folder(root: &Path, subject: &str, chapter: &str) -> Result<PathBuf, String> {
    let dir = chapter_dir(root, subject, chapter)?;
    let legacy = legacy_chapter_file(root, subject, chapter)?;

    if dir.is_dir() && meta_path(&dir).exists() {
        let mut meta = read_meta(&dir)?;
        migrate_to_v2(&dir, &mut meta)?;
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
        let sid = new_section_id();
        let uid = new_subsection_id();
        ensure_dir(&section_dir(&dir, &sid))?;
        fs::write(subsection_file(&dir, &sid, &uid), content).map_err(|e| e.to_string())?;
        let meta = ChapterMeta {
            version: META_VERSION,
            sections: vec![SectionMeta {
                id: sid,
                custom_title: None,
                subsections: vec![SubsectionMeta {
                    id: uid,
                    custom_title: None,
                }],
            }],
        };
        write_meta(&dir, &meta)?;
        fs::remove_file(&legacy).map_err(|e| format!("Не удалось убрать старый .md: {e}"))?;
        return Ok(dir);
    }

    if dir.is_dir() {
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
                        subsections: vec![],
                    });
                }
            }
        }
        if sections.is_empty() {
            let sid = new_section_id();
            let uid = new_subsection_id();
            ensure_dir(&section_dir(&dir, &sid))?;
            fs::write(subsection_file(&dir, &sid, &uid), "").map_err(|e| e.to_string())?;
            sections.push(SectionMeta {
                id: sid,
                custom_title: None,
                subsections: vec![SubsectionMeta {
                    id: uid,
                    custom_title: None,
                }],
            });
            let meta = ChapterMeta {
                version: META_VERSION,
                sections,
            };
            write_meta(&dir, &meta)?;
        } else {
            let mut meta = ChapterMeta {
                version: 1,
                sections,
            };
            write_meta(&dir, &meta)?;
            migrate_to_v2(&dir, &mut meta)?;
        }
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
    section_id: Option<&str>,
    subsection_id: Option<&str>,
) -> Result<ChapterSnapshot, String> {
    if meta.sections.is_empty() {
        return Err("В главе нет разделов".into());
    }
    let mut infos = Vec::new();
    for s in &meta.sections {
        infos.push(section_info(dir, s)?);
    }
    let active_section = section_id
        .filter(|id| meta.sections.iter().any(|s| s.id == *id))
        .unwrap_or(&meta.sections[0].id)
        .to_string();
    let section = meta
        .sections
        .iter()
        .find(|s| s.id == active_section)
        .ok_or_else(|| "Раздел не найден".to_string())?;
    if section.subsections.is_empty() {
        return Err("В разделе нет подразделов".into());
    }
    let active_sub = subsection_id
        .filter(|id| section.subsections.iter().any(|u| u.id == *id))
        .unwrap_or(&section.subsections[0].id)
        .to_string();
    let content = fs::read_to_string(subsection_file(dir, &active_section, &active_sub))
        .map_err(|e| format!("Не удалось прочитать подраздел: {e}"))?;
    Ok(ChapterSnapshot {
        sections: infos,
        active_section_id: active_section,
        active_subsection_id: active_sub,
        content,
        chapter_path: dir.to_string_lossy().into_owned(),
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
    Ok(())
}

#[tauri::command]
fn open_chapter(
    app: AppHandle,
    subject: String,
    chapter: String,
    section_id: Option<String>,
    subsection_id: Option<String>,
) -> Result<ChapterSnapshot, String> {
    let root = library_root(&app)?;
    let dir = ensure_chapter_folder(&root, &subject, &chapter)?;
    let meta = ensure_meta_v2(&dir)?;
    let sid = match section_id.as_deref() {
        Some(id) if !id.trim().is_empty() => Some(validate_id(id, "Раздел")?),
        _ => None,
    };
    let uid = match subsection_id.as_deref() {
        Some(id) if !id.trim().is_empty() => Some(validate_id(id, "Подраздел")?),
        _ => None,
    };
    snapshot_for(&dir, &meta, sid, uid)
}

#[tauri::command]
fn create_section(
    app: AppHandle,
    subject: String,
    chapter: String,
) -> Result<ChapterSnapshot, String> {
    let root = library_root(&app)?;
    let dir = ensure_chapter_folder(&root, &subject, &chapter)?;
    let mut meta = ensure_meta_v2(&dir)?;
    let sid = new_section_id();
    let uid = new_subsection_id();
    ensure_dir(&section_dir(&dir, &sid))?;
    fs::write(subsection_file(&dir, &sid, &uid), "").map_err(|e| e.to_string())?;
    meta.sections.push(SectionMeta {
        id: sid.clone(),
        custom_title: None,
        subsections: vec![SubsectionMeta {
            id: uid.clone(),
            custom_title: None,
        }],
    });
    write_meta(&dir, &meta)?;
    snapshot_for(&dir, &meta, Some(&sid), Some(&uid))
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
    let section_id = validate_id(&section_id, "Раздел")?.to_string();
    let mut meta = ensure_meta_v2(&dir)?;
    if meta.sections.len() <= 1 {
        return Err("Нельзя удалить единственный раздел".into());
    }
    if !meta.sections.iter().any(|s| s.id == section_id) {
        return Err("Раздел не найден".into());
    }
    meta.sections.retain(|s| s.id != section_id);
    let sdir = section_dir(&dir, &section_id);
    if sdir.is_dir() {
        let _ = fs::remove_dir_all(&sdir);
    }
    let legacy = dir.join(format!("{section_id}.md"));
    let _ = fs::remove_file(legacy);
    let assets = dir.join("assets").join(&section_id);
    if assets.is_dir() {
        let _ = fs::remove_dir_all(&assets);
    }
    write_meta(&dir, &meta)?;
    snapshot_for(&dir, &meta, None, None)
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
    let section_id = validate_id(&section_id, "Раздел")?.to_string();
    let mut meta = ensure_meta_v2(&dir)?;
    let section = meta
        .sections
        .iter_mut()
        .find(|s| s.id == section_id)
        .ok_or_else(|| "Раздел не найден".to_string())?;
    section.custom_title = custom_title
        .as_ref()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());
    write_meta(&dir, &meta)?;
    snapshot_for(&dir, &meta, Some(&section_id), None)
}

#[tauri::command]
fn create_subsection(
    app: AppHandle,
    subject: String,
    chapter: String,
    section_id: String,
) -> Result<ChapterSnapshot, String> {
    let root = library_root(&app)?;
    let dir = ensure_chapter_folder(&root, &subject, &chapter)?;
    let section_id = validate_id(&section_id, "Раздел")?.to_string();
    let mut meta = ensure_meta_v2(&dir)?;
    let section = meta
        .sections
        .iter_mut()
        .find(|s| s.id == section_id)
        .ok_or_else(|| "Раздел не найден".to_string())?;
    let uid = new_subsection_id();
    ensure_dir(&section_dir(&dir, &section_id))?;
    fs::write(subsection_file(&dir, &section_id, &uid), "").map_err(|e| e.to_string())?;
    section.subsections.push(SubsectionMeta {
        id: uid.clone(),
        custom_title: None,
    });
    write_meta(&dir, &meta)?;
    snapshot_for(&dir, &meta, Some(&section_id), Some(&uid))
}

#[tauri::command]
fn delete_subsection(
    app: AppHandle,
    subject: String,
    chapter: String,
    section_id: String,
    subsection_id: String,
) -> Result<ChapterSnapshot, String> {
    let root = library_root(&app)?;
    let dir = ensure_chapter_folder(&root, &subject, &chapter)?;
    let section_id = validate_id(&section_id, "Раздел")?.to_string();
    let subsection_id = validate_id(&subsection_id, "Подраздел")?.to_string();
    let mut meta = ensure_meta_v2(&dir)?;
    let section = meta
        .sections
        .iter_mut()
        .find(|s| s.id == section_id)
        .ok_or_else(|| "Раздел не найден".to_string())?;
    if section.subsections.len() <= 1 {
        return Err("Нельзя удалить единственный подраздел".into());
    }
    if !section.subsections.iter().any(|u| u.id == subsection_id) {
        return Err("Подраздел не найден".into());
    }
    section.subsections.retain(|u| u.id != subsection_id);
    let _ = fs::remove_file(subsection_file(&dir, &section_id, &subsection_id));
    let assets = subsection_assets_dir(&dir, &section_id, &subsection_id);
    if assets.is_dir() {
        let _ = fs::remove_dir_all(&assets);
    }
    write_meta(&dir, &meta)?;
    snapshot_for(&dir, &meta, Some(&section_id), None)
}

#[tauri::command]
fn set_subsection_title(
    app: AppHandle,
    subject: String,
    chapter: String,
    section_id: String,
    subsection_id: String,
    custom_title: Option<String>,
) -> Result<ChapterSnapshot, String> {
    let root = library_root(&app)?;
    let dir = ensure_chapter_folder(&root, &subject, &chapter)?;
    let section_id = validate_id(&section_id, "Раздел")?.to_string();
    let subsection_id = validate_id(&subsection_id, "Подраздел")?.to_string();
    let mut meta = ensure_meta_v2(&dir)?;
    let section = meta
        .sections
        .iter_mut()
        .find(|s| s.id == section_id)
        .ok_or_else(|| "Раздел не найден".to_string())?;
    let sub = section
        .subsections
        .iter_mut()
        .find(|u| u.id == subsection_id)
        .ok_or_else(|| "Подраздел не найден".to_string())?;
    sub.custom_title = custom_title
        .as_ref()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());
    write_meta(&dir, &meta)?;
    snapshot_for(&dir, &meta, Some(&section_id), Some(&subsection_id))
}

#[tauri::command]
fn write_subsection(
    app: AppHandle,
    subject: String,
    chapter: String,
    section_id: String,
    subsection_id: String,
    content: String,
) -> Result<ChapterSnapshot, String> {
    let root = library_root(&app)?;
    let dir = ensure_chapter_folder(&root, &subject, &chapter)?;
    let section_id = validate_id(&section_id, "Раздел")?.to_string();
    let subsection_id = validate_id(&subsection_id, "Подраздел")?.to_string();
    let meta = ensure_meta_v2(&dir)?;
    let section = meta
        .sections
        .iter()
        .find(|s| s.id == section_id)
        .ok_or_else(|| "Раздел не найден".to_string())?;
    if !section.subsections.iter().any(|u| u.id == subsection_id) {
        return Err("Подраздел не найден".into());
    }
    ensure_dir(&section_dir(&dir, &section_id))?;
    fs::write(
        subsection_file(&dir, &section_id, &subsection_id),
        content,
    )
    .map_err(|e| format!("Не удалось сохранить: {e}"))?;
    snapshot_for(&dir, &meta, Some(&section_id), Some(&subsection_id))
}

/// Merge selected subsections (in order) into the first; delete the rest.
#[tauri::command]
fn merge_subsections(
    app: AppHandle,
    subject: String,
    chapter: String,
    section_id: String,
    subsection_ids: Vec<String>,
    custom_title: Option<String>,
) -> Result<ChapterSnapshot, String> {
    let root = library_root(&app)?;
    let dir = ensure_chapter_folder(&root, &subject, &chapter)?;
    let section_id = validate_id(&section_id, "Раздел")?.to_string();
    if subsection_ids.len() < 2 {
        return Err("Выберите хотя бы два подраздела для объединения".into());
    }
    let mut ids = Vec::new();
    for id in &subsection_ids {
        ids.push(validate_id(id, "Подраздел")?.to_string());
    }
    let mut meta = ensure_meta_v2(&dir)?;
    let section = meta
        .sections
        .iter_mut()
        .find(|s| s.id == section_id)
        .ok_or_else(|| "Раздел не найден".to_string())?;

    for id in &ids {
        if !section.subsections.iter().any(|u| u.id == *id) {
            return Err(format!("Подраздел «{id}» не найден"));
        }
    }

    let mut parts = Vec::new();
    for id in &ids {
        let sub = section.subsections.iter().find(|u| u.id == *id).unwrap();
        let info = subsection_info(&dir, &section_id, sub)?;
        let body = fs::read_to_string(subsection_file(&dir, &section_id, id)).unwrap_or_default();
        let body = body.trim();
        if body.is_empty() {
            continue;
        }
        // Avoid duplicating title if body already starts with same heading
        let heading = format!("## {}", info.title);
        if body.starts_with(&heading) || body.starts_with(&format!("# {}", info.title)) {
            parts.push(body.to_string());
        } else {
            parts.push(format!("{heading}\n\n{body}"));
        }
    }
    let merged = parts.join("\n\n");
    let keep_id = ids[0].clone();
    fs::write(subsection_file(&dir, &section_id, &keep_id), merged)
        .map_err(|e| format!("Не удалось сохранить объединённый текст: {e}"))?;

    // Merge asset folders into keep_id (best-effort rename with prefix)
    for id in ids.iter().skip(1) {
        let from = subsection_assets_dir(&dir, &section_id, id);
        let to = subsection_assets_dir(&dir, &section_id, &keep_id);
        if from.is_dir() {
            ensure_dir(&to)?;
            if let Ok(rd) = fs::read_dir(&from) {
                for entry in rd.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        let name = entry.file_name();
                        let dest = to.join(format!(
                            "from_{}_{}",
                            id,
                            name.to_string_lossy()
                        ));
                        let _ = fs::rename(&path, dest);
                    }
                }
            }
            let _ = fs::remove_dir_all(&from);
        }
        let _ = fs::remove_file(subsection_file(&dir, &section_id, id));
    }

    section.subsections.retain(|u| !ids[1..].contains(&u.id));
    if let Some(keep) = section.subsections.iter_mut().find(|u| u.id == keep_id) {
        keep.custom_title = custom_title
            .as_ref()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .or_else(|| keep.custom_title.clone());
    }

    write_meta(&dir, &meta)?;
    snapshot_for(&dir, &meta, Some(&section_id), Some(&keep_id))
}

#[tauri::command]
fn read_chapter_export(
    app: AppHandle,
    subject: String,
    chapter: String,
) -> Result<String, String> {
    let root = library_root(&app)?;
    let dir = ensure_chapter_folder(&root, &subject, &chapter)?;
    let meta = ensure_meta_v2(&dir)?;
    let mut parts = Vec::new();
    for s in &meta.sections {
        let sinfo = section_info(&dir, s)?;
        let mut section_parts = Vec::new();
        for sub in &s.subsections {
            let uinfo = subsection_info(&dir, &s.id, sub)?;
            let body =
                fs::read_to_string(subsection_file(&dir, &s.id, &sub.id)).unwrap_or_default();
            if body.trim().is_empty() {
                continue;
            }
            section_parts.push(format!("## {}\n\n{}", uinfo.title, body.trim()));
        }
        if section_parts.is_empty() {
            continue;
        }
        parts.push(format!("# {}\n\n{}", sinfo.title, section_parts.join("\n\n")));
    }
    Ok(parts.join("\n\n"))
}

#[tauri::command]
fn save_section_image(
    app: AppHandle,
    subject: String,
    chapter: String,
    section_id: String,
    subsection_id: String,
    data_base64: String,
    extension: String,
) -> Result<SavedImage, String> {
    use base64::Engine;
    let root = library_root(&app)?;
    let dir = ensure_chapter_folder(&root, &subject, &chapter)?;
    let section_id = validate_id(&section_id, "Раздел")?.to_string();
    let subsection_id = validate_id(&subsection_id, "Подраздел")?.to_string();
    let meta = ensure_meta_v2(&dir)?;
    let section = meta
        .sections
        .iter()
        .find(|s| s.id == section_id)
        .ok_or_else(|| "Раздел не найден".to_string())?;
    if !section.subsections.iter().any(|u| u.id == subsection_id) {
        return Err("Подраздел не найден".into());
    }
    let ext = extension.trim().trim_start_matches('.').to_lowercase();
    let allowed = ["png", "jpg", "jpeg", "webp", "gif"];
    if !allowed.contains(&ext.as_str()) {
        return Err("Поддерживаются PNG, JPEG, WebP и GIF".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("Не удалось прочитать изображение: {e}"))?;
    if bytes.is_empty() {
        return Err("Пустое изображение".into());
    }
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("Файл слишком большой (макс. ~8 МБ после сжатия)".into());
    }
    let assets = subsection_assets_dir(&dir, &section_id, &subsection_id);
    ensure_dir(&assets)?;
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let filename = format!("img_{t:x}.{ext}");
    let abs = assets.join(&filename);
    fs::write(&abs, &bytes).map_err(|e| format!("Не удалось сохранить картинку: {e}"))?;
    let relative_path = format!("assets/{section_id}/{subsection_id}/{filename}");
    Ok(SavedImage {
        relative_path,
        absolute_path: abs.to_string_lossy().into_owned(),
    })
}

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
            create_subsection,
            delete_subsection,
            set_subsection_title,
            write_subsection,
            merge_subsections,
            read_chapter_export,
            save_section_image,
            write_export_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
