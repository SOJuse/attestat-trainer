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

pub mod commands {
    use tauri::{AppHandle, Manager};

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
    fn oversized_text_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let huge = "x".repeat(MAX_BYTES + 1);
        assert_eq!(save(dir.path(), &huge), Err("too-large".to_string()));
        assert_eq!(load(dir.path()), Ok(None));
    }
}
