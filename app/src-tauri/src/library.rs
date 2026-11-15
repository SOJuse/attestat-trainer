//! Библиотека документов: установка пакета и запросы к нему.
//!
//! Пакет — файл `library.sqlite.gz` с GitHub Pages. Интерфейс скачивает его сам и передаёт
//! сюда байты; здесь проверяется SHA-256, файл распаковывается, проверяется и только после
//! этого встаёт на место прежнего. Вся логика — в обычных функциях от папки данных,
//! команды Tauri внизу файла только вызывают их.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const SCHEMA_VERSION: i64 = 1;

/// Публичный ключ, которым подписаны пакеты базы. Тот же, что у обновлений программы
/// (`plugins.updater.pubkey` в tauri.conf.json); совпадение проверяет тест конфигурации.
pub const PACK_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IERGNEI2ODMyMUYzREE2MUUKUldRZXBqMGZNbWhMMzVvRDB6SG56S2gzelkxanVQT2Jyc0hpcnUrMFE5Z25BWU1YdjhobWNESUIK";
const DB_FILE: &str = "library.sqlite";
const INFO_FILE: &str = "library.json";
const SNIPPET_CHARS: usize = 240;
const SNIPPET_LEAD: usize = 60;
const MAX_LIMIT: u32 = 100;

/// Коды ошибок, которые понимает интерфейс.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum LibError {
    NotInstalled,
    Checksum,
    Signature,
    BadPack,
    Query,
    Io,
}

impl LibError {
    pub fn code(self) -> &'static str {
        match self {
            LibError::NotInstalled => "not-installed",
            LibError::Checksum => "checksum",
            LibError::Signature => "signature",
            LibError::BadPack => "bad-pack",
            LibError::Query => "query",
            LibError::Io => "io",
        }
    }
}

type Res<T> = Result<T, LibError>;

#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub installed: bool,
    pub pack_version: Option<String>,
    pub docs: u32,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocInfo {
    pub id: String,
    pub title: String,
    pub short: Option<String>,
    pub kind: String,
    pub number: Option<String>,
    pub date: Option<String>,
    pub edition: Option<String>,
    pub source_url: Option<String>,
    pub fetched: Option<String>,
    pub modules: Vec<String>,
    pub text_status: String,
    pub note: Option<String>,
    pub list_no: Option<u32>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct SectionHead {
    pub anchor: String,
    pub heading: String,
    pub ord: u32,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct SectionBody {
    pub anchor: String,
    pub heading: String,
    pub ord: u32,
    pub text: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct DocWithToc {
    pub info: DocInfo,
    pub sections: Vec<SectionHead>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub doc_id: String,
    pub doc_title: String,
    pub anchor: String,
    pub heading: String,
    pub snippet: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Info {
    pack_version: String,
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

fn db_path(dir: &Path) -> PathBuf {
    dir.join(DB_FILE)
}

fn open(dir: &Path) -> Res<Connection> {
    let path = db_path(dir);
    if !path.exists() {
        return Err(LibError::NotInstalled);
    }
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|_| LibError::BadPack)
}

/// Проверяет, что файл — библиотека понятной нам версии и в ней есть документы.
fn check_pack(path: &Path) -> Res<u32> {
    let conn =
        Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|_| LibError::BadPack)?;
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|_| LibError::BadPack)?;
    if version != SCHEMA_VERSION {
        return Err(LibError::BadPack);
    }
    let docs: u32 = conn
        .query_row("SELECT count(*) FROM docs", [], |r| r.get(0))
        .map_err(|_| LibError::BadPack)?;
    if docs == 0 {
        return Err(LibError::BadPack);
    }
    Ok(docs)
}

pub fn status(dir: &Path) -> Status {
    let docs = check_pack(&db_path(dir)).unwrap_or(0);
    let pack_version = fs::read_to_string(dir.join(INFO_FILE))
        .ok()
        .and_then(|s| serde_json::from_str::<Info>(&s).ok())
        .map(|i| i.pack_version);
    Status { installed: docs > 0, pack_version: if docs > 0 { pack_version } else { None }, docs }
}

/// Проверяет подпись пакета. Ключ и подпись — в том виде, в каком их выдаёт `tauri signer`:
/// base64 от текста файла minisign.
fn verify_signature(gz: &[u8], signature: &str, pubkey: &str) -> Res<()> {
    use base64::Engine;
    let decode = |text: &str| {
        base64::engine::general_purpose::STANDARD
            .decode(text.trim())
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .ok_or(LibError::Signature)
    };
    let key = minisign_verify::PublicKey::decode(&decode(pubkey)?).map_err(|_| LibError::Signature)?;
    let sig = minisign_verify::Signature::decode(&decode(signature)?).map_err(|_| LibError::Signature)?;
    key.verify(gz, &sig, true).map_err(|_| LibError::Signature)
}

/// Ставит пакет из сжатых байтов. При любой ошибке прежняя библиотека остаётся как была.
///
/// Подлинность пакета подтверждает подпись: её нельзя подделать без закрытого ключа,
/// поэтому не важно, кто передал байты. SHA-256 из манифеста — дополнительная проверка,
/// что файл скачан целиком.
pub fn install(dir: &Path, gz: &[u8], sha256: &str, signature: &str, pubkey: &str, pack_version: &str) -> Res<()> {
    verify_signature(gz, signature, pubkey)?;
    let actual = sha256_hex(gz);
    if !actual.eq_ignore_ascii_case(sha256.trim()) {
        return Err(LibError::Checksum);
    }
    fs::create_dir_all(dir).map_err(|_| LibError::Io)?;
    let tmp = dir.join("library.sqlite.new");
    let result = (|| {
        let mut raw = Vec::new();
        flate2::read::GzDecoder::new(gz).read_to_end(&mut raw).map_err(|_| LibError::BadPack)?;
        fs::write(&tmp, raw).map_err(|_| LibError::Io)?;
        check_pack(&tmp)?;
        fs::rename(&tmp, db_path(dir)).map_err(|_| LibError::Io)?;
        let info = Info { pack_version: pack_version.to_string() };
        fs::write(dir.join(INFO_FILE), serde_json::to_string(&info).map_err(|_| LibError::Io)?)
            .map_err(|_| LibError::Io)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

const DOC_COLUMNS: &str = "id, title, short, kind, number, date, edition, source_url, fetched, \
                           modules, text_status, note, list_no";

fn doc_from_row(r: &rusqlite::Row) -> rusqlite::Result<DocInfo> {
    let modules: String = r.get(9)?;
    Ok(DocInfo {
        id: r.get(0)?,
        title: r.get(1)?,
        short: r.get(2)?,
        kind: r.get(3)?,
        number: r.get(4)?,
        date: r.get(5)?,
        edition: r.get(6)?,
        source_url: r.get(7)?,
        fetched: r.get(8)?,
        modules: modules.split(',').filter(|m| !m.is_empty()).map(String::from).collect(),
        text_status: r.get(10)?,
        note: r.get(11)?,
        list_no: r.get(12)?,
    })
}

pub fn list(dir: &Path) -> Res<Vec<DocInfo>> {
    let conn = open(dir)?;
    let sql = format!("SELECT {DOC_COLUMNS} FROM docs ORDER BY list_no IS NULL, list_no, id");
    let mut stmt = conn.prepare(&sql).map_err(|_| LibError::BadPack)?;
    let rows = stmt.query_map([], doc_from_row).map_err(|_| LibError::BadPack)?;
    rows.collect::<Result<_, _>>().map_err(|_| LibError::BadPack)
}

pub fn doc(dir: &Path, id: &str) -> Res<DocWithToc> {
    let conn = open(dir)?;
    let sql = format!("SELECT {DOC_COLUMNS} FROM docs WHERE id = ?1");
    let info = conn.query_row(&sql, [id], doc_from_row).map_err(|_| LibError::Query)?;
    let mut stmt = conn
        .prepare("SELECT anchor, heading, ord FROM sections WHERE doc_id = ?1 ORDER BY ord")
        .map_err(|_| LibError::BadPack)?;
    let sections = stmt
        .query_map([id], |r| Ok(SectionHead { anchor: r.get(0)?, heading: r.get(1)?, ord: r.get(2)? }))
        .map_err(|_| LibError::BadPack)?
        .collect::<Result<_, _>>()
        .map_err(|_| LibError::BadPack)?;
    Ok(DocWithToc { info, sections })
}

pub fn sections(dir: &Path, doc_id: &str, from_ord: u32, count: u32) -> Res<Vec<SectionBody>> {
    let conn = open(dir)?;
    let mut stmt = conn
        .prepare(
            "SELECT anchor, heading, ord, text FROM sections
             WHERE doc_id = ?1 AND ord >= ?2 ORDER BY ord LIMIT ?3",
        )
        .map_err(|_| LibError::BadPack)?;
    let rows = stmt
        .query_map(rusqlite::params![doc_id, from_ord, count.min(MAX_LIMIT)], |r| {
            Ok(SectionBody { anchor: r.get(0)?, heading: r.get(1)?, ord: r.get(2)?, text: r.get(3)? })
        })
        .map_err(|_| LibError::BadPack)?;
    rows.collect::<Result<_, _>>().map_err(|_| LibError::BadPack)
}

/// Основы из выражения вида `"отпуск"* "уход"*`.
fn stems(fts_query: &str) -> Vec<String> {
    fts_query.split('"').skip(1).step_by(2).filter(|s| !s.is_empty()).map(String::from).collect()
}

/// Отрывок текста вокруг первого слова, которое начинается с одной из основ.
/// Основа Snowball — начало слова, поэтому хватает сравнения по началу слова
/// в тексте, приведённом к нижнему регистру с «ё» как «е».
fn snippet(text: &str, stems: &[String]) -> String {
    let chars: Vec<char> = text.chars().collect();
    let lower: Vec<char> = chars
        .iter()
        .map(|c| match c.to_lowercase().next().unwrap_or(*c) {
            'ё' => 'е',
            l => l,
        })
        .collect();
    let mut hit = None;
    let mut word_start = true;
    'scan: for i in 0..lower.len() {
        if word_start && lower[i].is_alphanumeric() {
            for stem in stems {
                let s: Vec<char> = stem.chars().collect();
                if lower[i..].starts_with(&s) {
                    hit = Some(i);
                    break 'scan;
                }
            }
        }
        word_start = !lower[i].is_alphanumeric();
    }
    let mut start = hit.map(|i| i.saturating_sub(SNIPPET_LEAD)).unwrap_or(0);
    // не начинать с середины слова
    while start > 0 && start < chars.len() && chars[start - 1].is_alphanumeric() {
        start += 1;
    }
    let end = (start + SNIPPET_CHARS).min(chars.len());
    let mut out: String = chars[start..end].iter().collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ");
    if start > 0 {
        out.insert(0, '…');
    }
    if end < chars.len() {
        out.push('…');
    }
    out
}

pub fn search(dir: &Path, fts_query: &str, limit: u32) -> Res<Vec<SearchHit>> {
    let conn = open(dir)?;
    let stems = stems(fts_query);
    let mut stmt = conn
        .prepare(
            "SELECT s.doc_id, d.title, s.anchor, s.heading, s.text
             FROM sections_fts f
             JOIN sections s ON s.rowid = f.rowid
             JOIN docs d ON d.id = s.doc_id
             WHERE sections_fts MATCH ?1
             ORDER BY bm25(sections_fts, 4.0, 1.0)
             LIMIT ?2",
        )
        .map_err(|_| LibError::BadPack)?;
    let rows = stmt
        .query_map(rusqlite::params![fts_query, limit.clamp(1, MAX_LIMIT)], |r| {
            let text: String = r.get(4)?;
            Ok(SearchHit {
                doc_id: r.get(0)?,
                doc_title: r.get(1)?,
                anchor: r.get(2)?,
                heading: r.get(3)?,
                snippet: snippet(&text, &stems),
            })
        })
        .map_err(|_| LibError::Query)?;
    rows.collect::<Result<_, _>>().map_err(|_| LibError::Query)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PACK: &[u8] = include_bytes!("../tests/fixtures/library.sqlite.gz");
    const PACK_SHA: &str = "e1864c4b213fce25fcb41c8d78fad8018c95bbc811bd95f26cdbce5a22a2bead";
    // подпись тестового пакета тестовым ключом; закрытой части ключа в репозитории нет
    const PACK_SIG: &str = include_str!("../tests/fixtures/library.sqlite.gz.sig");
    const TEST_KEY: &str = include_str!("../tests/fixtures/test-key.pub");

    fn installed() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        install(dir.path(), PACK, PACK_SHA, PACK_SIG, TEST_KEY, "2026.11.20.1").unwrap();
        dir
    }

    #[test]
    fn empty_dir_is_not_installed() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(status(dir.path()), Status { installed: false, pack_version: None, docs: 0 });
        assert_eq!(list(dir.path()), Err(LibError::NotInstalled));
    }

    #[test]
    fn install_makes_library_available() {
        let dir = installed();
        assert_eq!(
            status(dir.path()),
            Status { installed: true, pack_version: Some("2026.11.20.1".into()), docs: 3 }
        );
        assert!(!dir.path().join("library.sqlite.new").exists());
    }

    #[test]
    fn wrong_checksum_keeps_previous_library() {
        let dir = installed();
        let before = fs::read(dir.path().join(DB_FILE)).unwrap();
        let bad_sha = "0".repeat(64);
        assert_eq!(install(dir.path(), PACK, &bad_sha, PACK_SIG, TEST_KEY, "2026.12.01.1"), Err(LibError::Checksum));
        assert_eq!(fs::read(dir.path().join(DB_FILE)).unwrap(), before);
        assert_eq!(status(dir.path()).pack_version.as_deref(), Some("2026.11.20.1"));
    }

    #[test]
    fn pack_not_signed_by_our_key_is_rejected() {
        let dir = installed();
        let before = fs::read(dir.path().join(DB_FILE)).unwrap();
        // чужие байты с верным для них хешем, но с подписью от другого файла
        let forged = b"this is not our pack";
        let sha = sha256_hex(forged);
        assert_eq!(
            install(dir.path(), forged, &sha, PACK_SIG, TEST_KEY, "2026.12.01.1"),
            Err(LibError::Signature)
        );
        assert_eq!(fs::read(dir.path().join(DB_FILE)).unwrap(), before);
        assert!(!dir.path().join("library.sqlite.new").exists());
    }

    #[test]
    fn pack_signed_by_another_key_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            install(dir.path(), PACK, PACK_SHA, PACK_SIG, PACK_PUBKEY, "2026.12.01.1"),
            Err(LibError::Signature)
        );
        assert!(!status(dir.path()).installed);
    }

    #[test]
    fn malformed_signature_or_key_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        for (sig, key) in [("", TEST_KEY), ("не base64 !!!", TEST_KEY), (PACK_SIG, ""), (PACK_SIG, "abc")] {
            assert_eq!(install(dir.path(), PACK, PACK_SHA, sig, key, "2026.12.01.1"), Err(LibError::Signature));
        }
    }

    #[test]
    fn pack_with_newer_schema_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let raw = dir.path().join("v2.sqlite");
        let mut plain = Vec::new();
        flate2::read::GzDecoder::new(PACK).read_to_end(&mut plain).unwrap();
        fs::write(&raw, plain).unwrap();
        assert_eq!(check_pack(&raw), Ok(3));
        Connection::open(&raw).unwrap().pragma_update(None, "user_version", 2).unwrap();
        assert_eq!(check_pack(&raw), Err(LibError::BadPack));
    }

    #[test]
    fn file_that_is_not_a_database_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let raw = dir.path().join("junk.sqlite");
        fs::write(&raw, b"not a database").unwrap();
        assert_eq!(check_pack(&raw), Err(LibError::BadPack));
    }

    #[test]
    fn list_is_ordered_by_list_number() {
        let dir = installed();
        let ids: Vec<String> = list(dir.path()).unwrap().into_iter().map(|d| d.id).collect();
        assert_eq!(ids, ["tk-rf", "lit-9", "fz-273"]);
    }

    #[test]
    fn doc_returns_info_and_table_of_contents() {
        let dir = installed();
        let d = doc(dir.path(), "tk-rf").unwrap();
        assert_eq!(d.info.modules, ["K", "R"]);
        assert_eq!(d.info.edition.as_deref(), Some("2026-09-01"));
        let anchors: Vec<&str> = d.sections.iter().map(|s| s.anchor.as_str()).collect();
        assert_eq!(anchors, ["st-255", "st-256", "st-257"]);
        assert_eq!(doc(dir.path(), "no-such-doc"), Err(LibError::Query));
    }

    #[test]
    fn sections_are_paged_in_order() {
        let dir = installed();
        let page = sections(dir.path(), "tk-rf", 1, 2).unwrap();
        let ords: Vec<u32> = page.iter().map(|s| s.ord).collect();
        assert_eq!(ords, [1, 2]);
        assert!(page[0].text.starts_with("По заявлению женщины"));
    }

    #[test]
    fn search_finds_section_and_returns_plain_snippet() {
        let dir = installed();
        let hits = search(dir.path(), "\"отпуск\"* \"уход\"*", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!((hits[0].doc_id.as_str(), hits[0].anchor.as_str()), ("tk-rf", "st-256"));
        assert!(hits[0].snippet.contains("отпуск по уходу"));
        assert!(!hits[0].snippet.contains('<'));
    }

    #[test]
    fn broken_fts_expression_is_an_error_not_a_panic() {
        let dir = installed();
        assert_eq!(search(dir.path(), "\"отпуск", 10), Err(LibError::Query));
        assert_eq!(search(dir.path(), "AND AND (", 10), Err(LibError::Query));
    }

    #[test]
    fn snippet_starts_near_the_match_in_long_text() {
        let long = format!("{} работник уходит в отпуск завтра. {}", "вода ".repeat(100), "хвост ".repeat(100));
        let s = snippet(&long, &["отпуск".to_string()]);
        assert!(s.starts_with('…') && s.ends_with('…'));
        assert!(s.contains("уходит в отпуск завтра"));
        assert!(s.chars().count() <= SNIPPET_CHARS + 2);
    }
}

// ---------- команды Tauri ----------

pub mod commands {
    use super::*;
    use tauri::ipc::{InvokeBody, Request};
    use tauri::{AppHandle, Manager};

    fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
        app.path().app_data_dir().map_err(|_| LibError::Io.code().to_string())
    }

    fn code<T>(r: Res<T>) -> Result<T, String> {
        r.map_err(|e| e.code().to_string())
    }

    #[tauri::command(async)]
    pub fn library_status(app: AppHandle) -> Result<Status, String> {
        Ok(status(&data_dir(&app)?))
    }

    /// Тело запроса — сжатый пакет; хеш, подпись и версия приходят в заголовках.
    #[tauri::command(async)]
    pub fn library_install(app: AppHandle, request: Request<'_>) -> Result<(), String> {
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
        code(install(
            &data_dir(&app)?,
            bytes,
            &header("x-sha256")?,
            &header("x-signature")?,
            PACK_PUBKEY,
            &header("x-pack-version")?,
        ))
    }

    #[tauri::command(async)]
    pub fn library_list(app: AppHandle) -> Result<Vec<DocInfo>, String> {
        code(list(&data_dir(&app)?))
    }

    #[tauri::command(async)]
    pub fn library_doc(app: AppHandle, id: String) -> Result<DocWithToc, String> {
        code(doc(&data_dir(&app)?, &id))
    }

    #[tauri::command(async, rename_all = "camelCase")]
    pub fn library_sections(
        app: AppHandle,
        doc_id: String,
        from_ord: u32,
        count: u32,
    ) -> Result<Vec<SectionBody>, String> {
        code(sections(&data_dir(&app)?, &doc_id, from_ord, count))
    }

    #[tauri::command(async, rename_all = "camelCase")]
    pub fn library_search(app: AppHandle, fts_query: String, limit: u32) -> Result<Vec<SearchHit>, String> {
        code(search(&data_dir(&app)?, &fts_query, limit))
    }
}
