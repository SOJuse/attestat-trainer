//! Файл с данными пользователя (прогресс, история, настройки) в папке данных приложения.
//! Запись идёт во временный файл и переименованием: при сбое прежний файл остаётся целым.

use std::fs;
use std::io::Write;
use std::path::Path;

const FILE: &str = "userdata.json";
/// Больше этого файл прогресса быть не может: защита от записи мусора из интерфейса.
const MAX_BYTES: usize = 64 * 1024 * 1024;

pub fn load(dir: &Path) -> Result<Option<String>, String> {
    let path = dir.join(FILE);
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(|_| "io".to_string())
}

pub fn save(dir: &Path, text: &str) -> Result<(), String> {
    if text.len() > MAX_BYTES {
        return Err("too-large".to_string());
    }
    fs::create_dir_all(dir).map_err(|_| "io".to_string())?;
    let tmp = dir.join(format!("{FILE}.new"));
    let result = (|| {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        fs::rename(&tmp, dir.join(FILE))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(|_| "io".to_string())
}

/// Записывает файл переноса прогресса туда, куда указал человек в диалоге сохранения.
pub fn write_export(path: &Path, text: &str) -> Result<(), String> {
    if text.len() > MAX_BYTES {
        return Err("too-large".to_string());
    }
    fs::write(path, text).map_err(|_| "io".to_string())
}

/// Читает файл, выбранный человеком в диалоге. Слишком большой файл не читается вовсе.
pub fn read_import(path: &Path) -> Result<String, String> {
    let size = fs::metadata(path).map_err(|_| "io".to_string())?.len();
    if size > MAX_BYTES as u64 {
        return Err("too-large".to_string());
    }
    // не текст — тоже отдаём интерфейсу: он скажет, что файл не подошёл
    fs::read(path).map(|bytes| String::from_utf8_lossy(&bytes).into_owned()).map_err(|_| "io".to_string())
}

pub mod commands {
    use tauri::{AppHandle, Manager};
    use tauri_plugin_dialog::DialogExt;

    /// Диалог сохранения и запись файла. Путь выбирает человек; интерфейс доступа к диску не получает.
    #[tauri::command(async)]
    pub fn file_save(app: AppHandle, name: String, text: String) -> Result<bool, String> {
        let picked = app.dialog().file().set_file_name(name).add_filter("JSON", &["json"]).blocking_save_file();
        let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
            return Ok(false);
        };
        super::write_export(&path, &text).map(|_| true)
    }

    /// Диалог выбора файла и его текст. None — человек отменил.
    #[tauri::command(async)]
    pub fn file_pick(app: AppHandle) -> Result<Option<String>, String> {
        let picked = app.dialog().file().add_filter("JSON", &["json"]).blocking_pick_file();
        let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
            return Ok(None);
        };
        super::read_import(&path).map(Some)
    }

    fn data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
        app.path().app_data_dir().map_err(|_| "io".to_string())
    }

    #[tauri::command(async)]
    pub fn store_load(app: AppHandle) -> Result<Option<String>, String> {
        super::load(&data_dir(&app)?)
    }

    #[tauri::command(async)]
    pub fn store_save(app: AppHandle, text: String) -> Result<(), String> {
        super::save(&data_dir(&app)?, &text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_file_yet_is_none() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(dir.path()), Ok(None));
    }

    #[test]
    fn save_then_load_returns_the_text() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), "{\"a\":1}").unwrap();
        save(dir.path(), "{\"a\":2, \"имя\":\"прогресс\"}").unwrap();
        assert_eq!(load(dir.path()), Ok(Some("{\"a\":2, \"имя\":\"прогресс\"}".to_string())));
        assert!(!dir.path().join("userdata.json.new").exists());
    }

    #[test]
    fn creates_the_data_directory_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("нет").join("такой папки");
        save(&nested, "{}").unwrap();
        assert_eq!(load(&nested), Ok(Some("{}".to_string())));
    }

    #[test]
    fn failed_write_keeps_the_previous_file() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), "старое").unwrap();
        // на месте временного файла стоит каталог: создать файл не получится
        fs::create_dir(dir.path().join("userdata.json.new")).unwrap();
        assert_eq!(save(dir.path(), "новое"), Err("io".to_string()));
        assert_eq!(load(dir.path()), Ok(Some("старое".to_string())));
    }

    #[test]
    fn export_and_import_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("прогресс.json");
        write_export(&path, "{\"schema\":1}").unwrap();
        assert_eq!(read_import(&path), Ok("{\"schema\":1}".to_string()));
    }

    #[test]
    fn import_of_missing_or_binary_file_does_not_panic() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_import(&dir.path().join("нет.json")), Err("io".to_string()));
        let path = dir.path().join("bin.json");
        fs::write(&path, [0xff, 0xfe, 0x00]).unwrap();
        assert!(read_import(&path).is_ok());
    }

    #[test]
    fn oversized_text_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let huge = "x".repeat(MAX_BYTES + 1);
        assert_eq!(save(dir.path(), &huge), Err("too-large".to_string()));
        assert_eq!(load(dir.path()), Ok(None));
    }
}
