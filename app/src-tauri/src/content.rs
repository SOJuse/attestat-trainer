//! База заданий, полученная обновлением: файл `tasks.json` в папке данных приложения.
//!
//! Интерфейс скачивает файл сам и передаёт сюда байты. Здесь проверяются подпись (тем же ключом,
//! что у библиотеки), SHA-256 и то, что это JSON с версией базы; только после этого файл встаёт
//! на место прежнего. Содержание заданий проверяет интерфейс по своей схеме при чтении.

use std::fs;
use std::io::Write;
use std::path::Path;

use crate::library::{sha256_hex, verify_signature, LibError};

const FILE: &str = "tasks.json";
/// База из нескольких сотен заданий занимает около мегабайта; больше этого — не база.
const MAX_BYTES: usize = 32 * 1024 * 1024;

pub fn read(dir: &Path) -> Result<Option<String>, LibError> {
    let path = dir.join(FILE);
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(|_| LibError::Io)
}

fn check(bytes: &[u8]) -> Result<(), LibError> {
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| LibError::BadPack)?;
    let ok = value.get("schemaVersion").is_some_and(|v| v.is_u64())
        && value.get("packVersion").is_some_and(|v| v.is_string())
        && value.get("tasks").is_some_and(|v| v.is_array());
    if ok { Ok(()) } else { Err(LibError::BadPack) }
}

/// Ставит базу заданий. При любой ошибке прежний файл остаётся как был.
pub fn install(dir: &Path, bytes: &[u8], sha256: &str, signature: &str, pubkey: &str) -> Result<(), LibError> {
    if bytes.len() > MAX_BYTES {
        return Err(LibError::BadPack);
    }
    verify_signature(bytes, signature, pubkey)?;
    if !sha256_hex(bytes).eq_ignore_ascii_case(sha256.trim()) {
        return Err(LibError::Checksum);
    }
    check(bytes)?;
    fs::create_dir_all(dir).map_err(|_| LibError::Io)?;
    let tmp = dir.join(format!("{FILE}.new"));
    let result = (|| {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&tmp, dir.join(FILE))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(|_| LibError::Io)
}

pub mod commands {
    use super::*;
    use crate::library::PACK_PUBKEY;
    use tauri::ipc::{InvokeBody, Request};
    use tauri::{AppHandle, Manager};

    fn data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
        app.path().app_data_dir().map_err(|_| LibError::Io.code().to_string())
    }

    #[tauri::command(async)]
    pub fn content_read(app: AppHandle) -> Result<Option<String>, String> {
        read(&data_dir(&app)?).map_err(|e| e.code().to_string())
    }

    /// Тело запроса — файл базы; хеш и подпись приходят в заголовках.
    #[tauri::command(async)]
    pub fn content_install(app: AppHandle, request: Request<'_>) -> Result<(), String> {
        let InvokeBody::Raw(bytes) = request.body() else {
            return Err(LibError::BadPack.code().to_string());
        };
        let header = |name: &str| {
            request
                .headers()
                .get(name)
                .and_then(|v| v.to_str().ok())
                .map(String::from)
                .ok_or_else(|| LibError::BadPack.code().to_string())
        };
        install(&data_dir(&app)?, bytes, &header("x-sha256")?, &header("x-signature")?, PACK_PUBKEY)
            .map_err(|e| e.code().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TASKS: &[u8] = include_bytes!("../tests/fixtures/tasks.json");
    const TASKS_SIG: &str = include_str!("../tests/fixtures/tasks.json.sig");
    const LIBRARY_SIG: &str = include_str!("../tests/fixtures/library.sqlite.gz.sig");
    const TEST_KEY: &str = include_str!("../tests/fixtures/test-key.pub");

    #[test]
    fn nothing_installed_reads_as_none() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read(dir.path()), Ok(None));
    }

    #[test]
    fn signed_pack_is_installed_and_read_back() {
        let dir = tempfile::tempdir().unwrap();
        install(dir.path(), TASKS, &sha256_hex(TASKS), TASKS_SIG, TEST_KEY).unwrap();
        assert_eq!(read(dir.path()).unwrap().unwrap().as_bytes(), TASKS);
        assert!(!dir.path().join("tasks.json.new").exists());
    }

    #[test]
    fn foreign_signature_is_rejected_and_previous_file_survives() {
        let dir = tempfile::tempdir().unwrap();
        install(dir.path(), TASKS, &sha256_hex(TASKS), TASKS_SIG, TEST_KEY).unwrap();
        // правильный JSON с верным хешем, но подпись от другого файла
        let forged = br#"{"schemaVersion":1,"packVersion":"2027.01.01.1","tasks":[]}"#;
        assert_eq!(
            install(dir.path(), forged, &sha256_hex(forged), LIBRARY_SIG, TEST_KEY),
            Err(LibError::Signature)
        );
        assert_eq!(read(dir.path()).unwrap().unwrap().as_bytes(), TASKS);
    }

    #[test]
    fn pack_signed_by_another_key_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            install(dir.path(), TASKS, &sha256_hex(TASKS), TASKS_SIG, crate::library::PACK_PUBKEY),
            Err(LibError::Signature)
        );
        assert_eq!(read(dir.path()), Ok(None));
    }

    #[test]
    fn wrong_checksum_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(install(dir.path(), TASKS, &"0".repeat(64), TASKS_SIG, TEST_KEY), Err(LibError::Checksum));
        assert_eq!(read(dir.path()), Ok(None));
    }

    #[test]
    fn signed_file_that_is_not_a_tasks_pack_is_rejected() {
        // пакет библиотеки подписан тем же ключом, но это не база заданий
        let library: &[u8] = include_bytes!("../tests/fixtures/library.sqlite.gz");
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            install(dir.path(), library, &sha256_hex(library), LIBRARY_SIG, TEST_KEY),
            Err(LibError::BadPack)
        );
        assert_eq!(read(dir.path()), Ok(None));
    }
}
