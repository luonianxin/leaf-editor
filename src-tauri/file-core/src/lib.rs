use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Encoding {
    Utf8,
    Utf8Bom,
    Utf16le,
    Utf16be,
    Gbk,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineEnding {
    Lf,
    Crlf,
    Cr,
    Mixed,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileVersion {
    pub hash: String,
    pub size_bytes: u64,
    pub modified_ms: u64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSnapshot {
    pub path: String,
    pub name: String,
    pub text: String,
    pub encoding: Encoding,
    pub line_ending: LineEnding,
    pub version: FileVersion,
}
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
pub const MAX_FILE_SIZE: u64 = 16 * 1024 * 1024;
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    pub path: String,
    pub text: String,
    pub encoding: Encoding,
    pub line_ending: LineEnding,
    pub expected_hash: Option<String>,
    pub expected_missing: bool,
}
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SaveResult {
    Written {
        path: String,
        version: FileVersion,
    },
    Conflict {
        #[serde(rename = "currentVersion")]
        current_version: FileVersion,
    },
    Missing,
}
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileStatus {
    Present { version: FileVersion },
    Missing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DirectoryEntryKind {
    Directory,
    File,
    Symlink,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub path: String,
    pub name: String,
    pub kind: DirectoryEntryKind,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    pub root: String,
    pub name: String,
    pub parent: Option<String>,
    pub entries: Vec<DirectoryEntry>,
}

pub fn list_directory(path: &str) -> Result<DirectoryListing, String> {
    let root = resolve_path(path)?;
    if !fs::metadata(&root).map_err(|error| error.to_string())?.is_dir() {
        return Err("Not a directory".into());
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(&root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        let kind = if file_type.is_symlink() {
            DirectoryEntryKind::Symlink
        } else if file_type.is_dir() {
            DirectoryEntryKind::Directory
        } else if file_type.is_file() {
            DirectoryEntryKind::File
        } else {
            continue;
        };
        entries.push(DirectoryEntry {
            path: entry.path().to_string_lossy().into_owned(),
            name: entry.file_name().to_string_lossy().into_owned(),
            kind,
        });
    }
    entries.sort_by(|left, right| {
        let rank = |kind| match kind {
            DirectoryEntryKind::Directory => 0,
            DirectoryEntryKind::File => 1,
            DirectoryEntryKind::Symlink => 2,
        };
        rank(left.kind)
            .cmp(&rank(right.kind))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(DirectoryListing {
        parent: root.parent().map(|parent| parent.to_string_lossy().into_owned()),
        name: root.file_name().unwrap_or(root.as_os_str()).to_string_lossy().into_owned(),
        root: root.to_string_lossy().into_owned(),
        entries,
    })
}

pub fn resolve_start_directory(path: &Path) -> Result<String, String> {
    let resolved = path.canonicalize().map_err(|error| error.to_string())?;
    if !fs::metadata(&resolved).map_err(|error| error.to_string())?.is_dir() {
        return Err("Start path is not a directory".into());
    }
    Ok(resolved.to_string_lossy().into_owned())
}

pub fn get_text_file_status(path: &str) -> Result<FileStatus, String> {
    match fs::metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(FileStatus::Missing),
        Err(error) => return Err(error.to_string()),
        Ok(_) => {}
    }
    let path = resolve_path(path)?;
    match fs::metadata(&path) {
        Ok(_) => Ok(FileStatus::Present { version: read_bytes(&path)?.1 }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(FileStatus::Missing),
        Err(error) => Err(error.to_string()),
    }
}
fn encode(text: &str, encoding: Encoding, ending: LineEnding) -> Result<Vec<u8>, String> {
    if text.contains('\0') {
        return Err("Binary content (NUL) is not supported".into());
    }
    if ending == LineEnding::Mixed {
        return Err("Choose a uniform line ending before saving mixed newlines".into());
    }
    let (text, _) = normalize(text);
    let text = match ending {
        LineEnding::Crlf => text.replace('\n', "\r\n"),
        LineEnding::Cr => text.replace('\n', "\r"),
        _ => text,
    };
    let bytes = match encoding {
        Encoding::Utf8 => text.into_bytes(),
        Encoding::Utf8Bom => {
            let mut bytes = vec![0xef, 0xbb, 0xbf];
            bytes.extend(text.as_bytes());
            bytes
        }
        Encoding::Utf16le | Encoding::Utf16be => {
            let mut bytes = if encoding == Encoding::Utf16le { vec![0xff, 0xfe] } else { vec![0xfe, 0xff] };
            for unit in text.encode_utf16() {
                bytes.extend(if encoding == Encoding::Utf16le { unit.to_le_bytes() } else { unit.to_be_bytes() });
            }
            bytes
        }
        Encoding::Gbk => {
            let (bytes, _, errors) = encoding_rs::GBK.encode(&text);
            if errors {
                return Err("Text cannot be represented in GBK".into());
            }
            bytes.into_owned()
        }
    };
    if bytes.len() as u64 > MAX_FILE_SIZE {
        return Err("Encoded file exceeds 16 MiB".into());
    }
    Ok(bytes)
}
fn check_target(path: &Path, request: &SaveRequest) -> Result<Option<SaveResult>, String> {
    match get_text_file_status(&path.to_string_lossy())? {
        FileStatus::Missing if !request.expected_missing => Ok(Some(SaveResult::Missing)),
        FileStatus::Missing => Ok(None),
        FileStatus::Present { version }
            if request.expected_missing || request.expected_hash.as_deref() != Some(version.hash.as_str()) =>
        {
            Ok(Some(SaveResult::Conflict { current_version: version }))
        }
        FileStatus::Present { .. } => Ok(None),
    }
}
/// Own application writes are serialized by the shell. This hash recheck is NOT
/// an atomic compare-and-swap against external writers: an external edit can race
/// between the last check and replacement. Atomic publication prevents partial files.
pub fn save_text_file(request: SaveRequest) -> Result<SaveResult, String> {
    if !request.expected_missing && matches!(get_text_file_status(&request.path)?, FileStatus::Missing) {
        return Ok(SaveResult::Missing);
    }
    let bytes = encode(&request.text, request.encoding, request.line_ending)?;
    let path = resolve_path(&request.path)?;
    if let Some(result) = check_target(&path, &request)? {
        return Ok(result);
    }
    let permissions = if request.expected_missing {
        None
    } else {
        let permissions = fs::metadata(&path).map_err(|e| e.to_string())?.permissions();
        if permissions.readonly() {
            return Err("File is read-only".into());
        }
        Some(permissions)
    };
    let mut temp =
        tempfile::NamedTempFile::new_in(path.parent().ok_or("Missing parent")?).map_err(|e| e.to_string())?;
    temp.write_all(&bytes).map_err(|e| e.to_string())?;
    if let Some(permissions) = permissions {
        temp.as_file().set_permissions(permissions).map_err(|e| e.to_string())?;
    }
    temp.flush().map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    // Reject a changed symlink/directory resolution rather than silently redirecting a save.
    if resolve_path(&request.path)? != path {
        return Err("Target path changed while saving; reopen before saving".into());
    }
    if let Some(result) = check_target(&path, &request)? {
        return Ok(result);
    }
    if !request.expected_missing && fs::metadata(&path).map_err(|e| e.to_string())?.permissions().readonly() {
        return Err("File became read-only".into());
    }
    // Derive the returned version from our written file, not a racing external replacement.
    let version = version(&bytes, &temp.as_file().metadata().map_err(|e| e.to_string())?);
    let persisted = if request.expected_missing {
        temp.persist_noclobber(&path).map(|_| ()).map_err(|error| error.error)
    } else {
        replace_existing(temp, &path)
    };
    if let Err(error) = persisted {
        if let Some(result) = check_target(&path, &request)? {
            return Ok(result);
        }
        return Err(format!("Atomic save failed: {error}"));
    }
    Ok(SaveResult::Written { path: path.to_string_lossy().into_owned(), version })
}

// ReplaceFileW preserves the replaced file's ACL and metadata and requires an
// existing destination; unlike MoveFileEx it will not recreate a deleted original.
#[cfg(windows)]
fn replace_existing(temp: tempfile::NamedTempFile, path: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    // ReplaceFileW must reopen the replacement file with its own sharing modes.
    // Keep RAII cleanup of the temp path, but release NamedTempFile's open handle first.
    let temp_path = temp.into_temp_path();
    let destination: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let source: Vec<u16> = temp_path.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe {
        windows_sys::Win32::Storage::FileSystem::ReplaceFileW(
            destination.as_ptr(),
            source.as_ptr(),
            std::ptr::null(),
            0,
            std::ptr::null(),
            std::ptr::null(),
        )
    };
    if result == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}
#[cfg(not(windows))]
fn replace_existing(temp: tempfile::NamedTempFile, path: &Path) -> std::io::Result<()> {
    temp.persist(path).map(|_| ()).map_err(|error| error.error)
}
pub fn resolve_path(path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path);
    if path.exists() {
        return path.canonicalize().map_err(|e| e.to_string());
    }
    if fs::symlink_metadata(path).is_ok() {
        return Err("Dangling symlink is not a save target".into());
    }
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().map_err(|e| e.to_string())?.join(path)
    };
    let parent = absolute.parent().ok_or("Missing parent directory")?.canonicalize().map_err(|e| e.to_string())?;
    Ok(parent.join(absolute.file_name().ok_or("Missing file name")?))
}
fn read_bytes(path: &Path) -> Result<(Vec<u8>, FileVersion), String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("Not a regular file".into());
    }
    if metadata.len() > MAX_FILE_SIZE {
        return Err("File exceeds 16 MiB".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_FILE_SIZE + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_FILE_SIZE {
        return Err("File exceeds 16 MiB".into());
    }
    let version = version(&bytes, &metadata);
    Ok((bytes, version))
}
fn version(bytes: &[u8], metadata: &fs::Metadata) -> FileVersion {
    FileVersion {
        hash: format!("{:x}", Sha256::digest(bytes)),
        size_bytes: bytes.len() as u64,
        modified_ms: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|time| time.as_millis() as u64)
            .unwrap_or(0),
    }
}
fn decode(bytes: &[u8], requested: Option<Encoding>) -> Result<(String, Encoding), String> {
    let encoding = requested.unwrap_or_else(|| {
        if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
            Encoding::Utf8Bom
        } else if bytes.starts_with(&[0xff, 0xfe]) {
            Encoding::Utf16le
        } else if bytes.starts_with(&[0xfe, 0xff]) {
            Encoding::Utf16be
        } else if std::str::from_utf8(bytes).is_ok() {
            Encoding::Utf8
        } else {
            Encoding::Gbk
        }
    });
    let text = match encoding {
        Encoding::Utf8 | Encoding::Utf8Bom => {
            let bytes = if encoding == Encoding::Utf8Bom {
                bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes)
            } else {
                bytes
            };
            std::str::from_utf8(bytes).map_err(|_| "Invalid UTF-8 bytes")?.to_owned()
        }
        Encoding::Utf16le | Encoding::Utf16be => {
            let bom: &[u8] = if encoding == Encoding::Utf16le { &[0xff, 0xfe] } else { &[0xfe, 0xff] };
            let bytes = bytes.strip_prefix(bom).unwrap_or(bytes);
            if bytes.len() % 2 != 0 {
                return Err("Invalid UTF-16 byte length".into());
            }
            let units: Vec<u16> = bytes
                .chunks_exact(2)
                .map(|pair| {
                    if encoding == Encoding::Utf16le {
                        u16::from_le_bytes([pair[0], pair[1]])
                    } else {
                        u16::from_be_bytes([pair[0], pair[1]])
                    }
                })
                .collect();
            String::from_utf16(&units).map_err(|_| "Invalid UTF-16 surrogate sequence")?
        }
        Encoding::Gbk => encoding_rs::GBK
            .decode_without_bom_handling_and_without_replacement(bytes)
            .ok_or("Invalid GBK bytes")?
            .into_owned(),
    };
    if text.contains('\0') {
        return Err("Binary content (NUL) is not supported".into());
    }
    Ok((text, encoding))
}
fn normalize(text: &str) -> (String, LineEnding) {
    let crlf = text.matches("\r\n").count();
    let cr = text.matches('\r').count() - crlf;
    let lf = text.matches('\n').count() - crlf;
    let kinds = usize::from(crlf > 0) + usize::from(cr > 0) + usize::from(lf > 0);
    let ending = if kinds > 1 {
        LineEnding::Mixed
    } else if crlf > 0 {
        LineEnding::Crlf
    } else if cr > 0 {
        LineEnding::Cr
    } else {
        LineEnding::Lf
    };
    (text.replace("\r\n", "\n").replace('\r', "\n"), ending)
}
pub fn read_text_file(path: &str, encoding: Option<Encoding>) -> Result<FileSnapshot, String> {
    let path = resolve_path(path)?;
    let (bytes, version) = read_bytes(&path)?;
    let (text, encoding) = decode(&bytes, encoding)?;
    let (text, line_ending) = normalize(&text);
    Ok(FileSnapshot {
        name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        path: path.to_string_lossy().into_owned(),
        text,
        encoding,
        line_ending,
        version,
    })
}
