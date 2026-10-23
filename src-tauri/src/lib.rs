use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

const LIBRARY_DIR: &str = "Konspects";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    pub path: String,
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

fn chapter_path(root: &Path, subject: &str, chapter: &str) -> Result<PathBuf, String> {
    let chapter_name = validate_name(chapter)?;
    Ok(subject_dir(root, subject)?.join(format!("{chapter_name}.md")))
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

fn list_md_files(path: &Path) -> Result<Vec<String>, String> {
    if !path.exists() {
        return Ok(vec![]);
    }
    let mut names = Vec::new();
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        if meta.is_file() {
            let file_name = entry.file_name();
            let Some(name) = file_name.to_str() else {
                continue;
            };
            if let Some(stem) = name.strip_suffix(".md") {
                if !stem.is_empty() && !stem.starts_with('.') {
                    names.push(stem.to_string());
                }
            }
        }
    }
    names.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(names)
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
    list_md_files(&dir)
}

#[tauri::command]
fn create_chapter(app: AppHandle, subject: String, name: String) -> Result<String, String> {
    let root = library_root(&app)?;
    let dir = subject_dir(&root, &subject)?;
    if !dir.exists() {
        return Err("Предмет не найден".into());
    }
    let path = chapter_path(&root, &subject, &name)?;
    if path.exists() {
        return Err("Такая глава уже есть".into());
    }
    fs::write(&path, "").map_err(|e| format!("Не удалось создать главу: {e}"))?;
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
    let from = chapter_path(&root, &subject, &old_name)?;
    let to = chapter_path(&root, &subject, &new_name)?;
    if !from.exists() {
        return Err("Глава не найдена".into());
    }
    if to.exists() {
        return Err("Глава с таким названием уже есть".into());
    }
    fs::rename(&from, &to).map_err(|e| format!("Не удалось переименовать: {e}"))?;
    Ok(validate_name(&new_name)?)
}

#[tauri::command]
fn delete_chapter(app: AppHandle, subject: String, name: String) -> Result<(), String> {
    let root = library_root(&app)?;
    let path = chapter_path(&root, &subject, &name)?;
    if !path.exists() {
        return Err("Глава не найдена".into());
    }
    fs::remove_file(&path).map_err(|e| format!("Не удалось удалить: {e}"))
}

#[tauri::command]
fn read_chapter(app: AppHandle, subject: String, name: String) -> Result<String, String> {
    let root = library_root(&app)?;
    let path = chapter_path(&root, &subject, &name)?;
    if !path.exists() {
        return Err("Глава не найдена".into());
    }
    fs::read_to_string(&path).map_err(|e| format!("Не удалось прочитать: {e}"))
}

#[tauri::command]
fn write_chapter(
    app: AppHandle,
    subject: String,
    name: String,
    content: String,
) -> Result<(), String> {
    let root = library_root(&app)?;
    let path = chapter_path(&root, &subject, &name)?;
    if !path.exists() {
        return Err("Глава не найдена".into());
    }
    fs::write(&path, content).map_err(|e| format!("Не удалось сохранить: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            read_chapter,
            write_chapter,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
