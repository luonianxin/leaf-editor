use leaf_file_core::{list_directory, read_text_file, save_text_file, Encoding, LineEnding, SaveRequest, SaveResult};
#[test]
fn save_roundtrips_all_encodings_without_losing_newline_or_bom_choice() {
    let dir = tempfile::tempdir().unwrap();
    for (index, (encoding, bytes)) in [
        (Encoding::Utf8, b"A\r\nB".to_vec()),
        (Encoding::Utf8Bom, b"\xef\xbb\xbfA\r\nB".to_vec()),
        (Encoding::Utf16le, b"\xff\xfeA\0\r\0\n\0B\0".to_vec()),
        (Encoding::Utf16be, b"\xfe\xff\0A\0\r\0\n\0B".to_vec()),
        (Encoding::Gbk, b"A\r\nB".to_vec()),
    ]
    .into_iter()
    .enumerate()
    {
        let path = dir.path().join(index.to_string()).to_string_lossy().into_owned();
        let result = save_text_file(SaveRequest {
            path: path.clone(),
            text: "A\nB".into(),
            encoding,
            line_ending: LineEnding::Crlf,
            expected_hash: None,
            expected_missing: true,
        })
        .unwrap();
        assert!(matches!(result, SaveResult::Written { .. }));
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert_eq!(read_text_file(&path, Some(encoding)).unwrap().text, "A\nB");
    }
}
#[test]
fn existing_files_require_the_observed_hash_and_missing_files_are_not_recreated() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("original.txt").to_string_lossy().into_owned();
    std::fs::write(&path, "original").unwrap();
    let original = read_text_file(&path, None).unwrap();
    let request = |hash, missing| SaveRequest {
        path: path.clone(),
        text: "updated".into(),
        encoding: Encoding::Utf8,
        line_ending: LineEnding::Lf,
        expected_hash: hash,
        expected_missing: missing,
    };
    assert!(matches!(save_text_file(request(None, false)).unwrap(), SaveResult::Conflict { .. }));
    assert!(matches!(save_text_file(request(None, true)).unwrap(), SaveResult::Conflict { .. }));
    std::fs::write(&path, "external").unwrap();
    assert!(matches!(
        save_text_file(request(Some(original.version.hash), false)).unwrap(),
        SaveResult::Conflict { .. }
    ));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "external");
    let current = read_text_file(&path, None).unwrap();
    assert!(matches!(
        save_text_file(request(Some(current.version.hash.clone()), false)).unwrap(),
        SaveResult::Written { .. }
    ));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "updated");
    std::fs::remove_file(&path).unwrap();
    assert!(matches!(save_text_file(request(Some(current.version.hash), false)).unwrap(), SaveResult::Missing));
    assert!(!std::path::Path::new(&path).exists());
}
#[test]
fn repeated_existing_saves_publish_complete_content_without_leaving_temp_files() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("replace.txt").to_string_lossy().into_owned();
    std::fs::write(&path, "initial").unwrap();
    for text in ["first replacement", "第二次保存", "third\nreplacement"] {
        let original = read_text_file(&path, None).unwrap();
        let result = save_text_file(SaveRequest {
            path: path.clone(),
            text: text.into(),
            encoding: Encoding::Utf8,
            line_ending: LineEnding::Lf,
            expected_hash: Some(original.version.hash),
            expected_missing: false,
        })
        .unwrap();
        assert!(matches!(result, SaveResult::Written { .. }));
        assert_eq!(std::fs::read(&path).unwrap(), text.as_bytes());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}

#[test]
fn rejected_encodings_mixed_newlines_and_readonly_saves_leave_original_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("safe.txt").to_string_lossy().into_owned();
    std::fs::write(&path, "original").unwrap();
    let hash = read_text_file(&path, None).unwrap().version.hash;
    for (text, encoding, ending) in [
        ("emoji 😀", Encoding::Gbk, LineEnding::Lf),
        ("a\nb", Encoding::Utf8, LineEnding::Mixed),
        ("a\0b", Encoding::Utf8, LineEnding::Lf),
    ] {
        assert!(save_text_file(SaveRequest {
            path: path.clone(),
            text: text.into(),
            encoding,
            line_ending: ending,
            expected_hash: Some(hash.clone()),
            expected_missing: false
        })
        .is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
    }
    let original_permissions = std::fs::metadata(&path).unwrap().permissions();
    let mut readonly = original_permissions.clone();
    readonly.set_readonly(true);
    std::fs::set_permissions(&path, readonly).unwrap();
    let result = save_text_file(SaveRequest {
        path: path.clone(),
        text: "changed".into(),
        encoding: Encoding::Utf8,
        line_ending: LineEnding::Lf,
        expected_hash: Some(hash),
        expected_missing: false,
    });
    std::fs::set_permissions(&path, original_permissions).unwrap();
    assert!(result.is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"original");
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}
#[test]
fn deleted_parent_is_missing_and_invalid_or_oversized_files_are_rejected() {
    use leaf_file_core::{get_text_file_status, FileStatus, MAX_FILE_SIZE};
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("deleted-parent").join("file.txt");
    assert!(matches!(get_text_file_status(missing.to_str().unwrap()).unwrap(), FileStatus::Missing));
    let path = dir.path().join("invalid.txt");
    for (bytes, encoding) in [
        (vec![0xff], Encoding::Utf8),
        (vec![0xff, 0xfe, 0x00], Encoding::Utf16le),
        (vec![0xff, 0xfe, 0x00, 0xd8], Encoding::Utf16le),
        (vec![0x81], Encoding::Gbk),
        (b"a\0b".to_vec(), Encoding::Utf8),
    ] {
        std::fs::write(&path, bytes).unwrap();
        assert!(read_text_file(path.to_str().unwrap(), Some(encoding)).is_err());
    }
    let file = std::fs::File::create(&path).unwrap();
    file.set_len(MAX_FILE_SIZE + 1).unwrap();
    drop(file);
    assert!(read_text_file(path.to_str().unwrap(), None).is_err());
}
#[test]
fn opening_encoded_text_preserves_encoding_and_newline_choice() {
    let dir = tempfile::tempdir().unwrap();
    let cases: &[(&[u8], Encoding, LineEnding, &str)] = &[
        (b"hello\r\nworld", Encoding::Utf8, LineEnding::Crlf, "hello\nworld"),
        (b"\xef\xbb\xbfhello\rworld", Encoding::Utf8Bom, LineEnding::Cr, "hello\nworld"),
        (b"\xff\xfeA\0\r\0\n\0B\0", Encoding::Utf16le, LineEnding::Crlf, "A\nB"),
        (b"\xfe\xff\0A\0\n\0B", Encoding::Utf16be, LineEnding::Lf, "A\nB"),
        (b"\xd6\xd0\xce\xc4\n", Encoding::Gbk, LineEnding::Lf, "中文\n"),
        (b"a\rb\nc\r\nd", Encoding::Utf8, LineEnding::Mixed, "a\nb\nc\nd"),
    ];
    for (index, (bytes, encoding, ending, text)) in cases.iter().enumerate() {
        let path = dir.path().join(index.to_string());
        std::fs::write(&path, bytes).unwrap();
        let snapshot = read_text_file(path.to_str().unwrap(), None).unwrap();
        assert_eq!(snapshot.text, *text);
        assert_eq!(snapshot.encoding, *encoding);
        assert_eq!(snapshot.line_ending, *ending);
    }
}

#[test]
fn directory_listing_is_shallow_sorted_and_rejects_non_directories() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("z-folder")).unwrap();
    std::fs::create_dir(dir.path().join("A-folder")).unwrap();
    std::fs::write(dir.path().join("z.txt"), "z").unwrap();
    std::fs::write(dir.path().join("A.txt"), "a").unwrap();
    std::fs::write(dir.path().join("z-folder").join("nested.txt"), "nested").unwrap();

    let listing = list_directory(dir.path().to_str().unwrap()).unwrap();
    assert_eq!(listing.root, dir.path().canonicalize().unwrap().to_string_lossy());
    assert_eq!(
        listing.parent.as_deref(),
        dir.path().canonicalize().unwrap().parent().map(|path| path.to_string_lossy()).as_deref()
    );
    assert_eq!(
        listing.entries.iter().map(|entry| (entry.name.as_str(), entry.kind)).collect::<Vec<_>>(),
        vec![
            ("A-folder", leaf_file_core::DirectoryEntryKind::Directory),
            ("z-folder", leaf_file_core::DirectoryEntryKind::Directory),
            ("A.txt", leaf_file_core::DirectoryEntryKind::File),
            ("z.txt", leaf_file_core::DirectoryEntryKind::File),
        ]
    );
    assert!(listing.entries.iter().all(|entry| !entry.path.ends_with("nested.txt")));
    assert!(list_directory(dir.path().join("A.txt").to_str().unwrap()).is_err());
}

#[test]
fn root_directory_has_no_parent() {
    let dir = tempfile::tempdir().unwrap();
    let canonical = dir.path().canonicalize().unwrap();
    let root = canonical.ancestors().last().unwrap();
    assert!(list_directory(root.to_str().unwrap()).unwrap().parent.is_none());
}

#[test]
fn start_directory_is_canonical_and_must_be_a_directory() {
    let dir = tempfile::tempdir().unwrap();
    let nested = dir.path().join("nested");
    std::fs::create_dir(&nested).unwrap();
    let resolved = leaf_file_core::resolve_start_directory(&nested).unwrap();
    assert_eq!(resolved, nested.canonicalize().unwrap().to_string_lossy());

    let file = nested.join("file.txt");
    std::fs::write(&file, "content").unwrap();
    assert!(leaf_file_core::resolve_start_directory(&file).is_err());
    assert!(leaf_file_core::resolve_start_directory(&nested.join("missing")).is_err());
}
