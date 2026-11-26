use leaf_file_core::{DirectoryListing, Encoding, FileSnapshot, FileStatus, SaveRequest, SaveResult};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    collections::HashSet,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::Instant,
};
use tauri::{Emitter, Manager, State, WebviewWindowBuilder};

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchTargets {
    files: Vec<String>,
    directories: Vec<String>,
}
struct LaunchQueue {
    ready: bool,
    targets: LaunchTargets,
}
struct NativeState {
    started: Instant,
    writes: Mutex<()>,
    launch: Mutex<LaunchQueue>,
    watcher: Mutex<Option<RecommendedWatcher>>,
}

#[tauri::command]
async fn read_text_file(path: String, encoding: Option<Encoding>) -> Result<FileSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || leaf_file_core::read_text_file(&path, encoding))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn get_text_file_status(path: String) -> Result<FileStatus, String> {
    tauri::async_runtime::spawn_blocking(move || leaf_file_core::get_text_file_status(&path))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn list_directory(path: String) -> Result<DirectoryListing, String> {
    tauri::async_runtime::spawn_blocking(move || leaf_file_core::list_directory(&path))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn get_start_directory(app: tauri::AppHandle) -> Result<String, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || leaf_file_core::resolve_start_directory(&home))
        .await
        .map_err(|error| error.to_string())?
}
#[tauri::command]
async fn save_text_file(app: tauri::AppHandle, request: SaveRequest) -> Result<SaveResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<NativeState>();
        let _guard = state.writes.lock().map_err(|e| e.to_string())?;
        leaf_file_core::save_text_file(request)
    })
    .await
    .map_err(|e| e.to_string())?
}

// Canonicalize existing files/directories; normalize absolute missing file paths
// without treating them as commands. Directory arguments open the workspace tree.
fn launch_targets(args: impl IntoIterator<Item = String>, cwd: &Path) -> LaunchTargets {
    let mut files = Vec::new();
    let mut directories = Vec::new();
    let mut seen_files = HashSet::new();
    let mut seen_directories = HashSet::new();

    for arg in args {
        if arg.is_empty() || arg.starts_with('-') || arg.starts_with("file://") {
            continue;
        }
        let path = PathBuf::from(arg);
        let absolute = if path.is_absolute() { path } else { cwd.join(path) };
        let (normalized, is_directory) = if absolute.exists() {
            let normalized = match absolute.canonicalize() {
                Ok(path) => path,
                Err(_) => continue,
            };
            let metadata = match std::fs::metadata(&normalized) {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            if !metadata.is_file() && !metadata.is_dir() {
                continue;
            }
            (normalized, metadata.is_dir())
        } else {
            let mut result = PathBuf::new();
            for component in absolute.components() {
                match component {
                    Component::CurDir => {}
                    Component::ParentDir => {
                        result.pop();
                    }
                    part => result.push(part.as_os_str()),
                }
            }
            (result, false)
        };
        if !normalized.is_absolute() {
            continue;
        }
        let value = normalized.to_string_lossy().into_owned();
        if is_directory {
            if seen_directories.insert(value.clone()) {
                directories.push(value);
            }
        } else if seen_files.insert(value.clone()) {
            files.push(value);
        }
    }

    LaunchTargets { files, directories }
}

#[tauri::command]
fn take_launch_targets(state: State<'_, NativeState>) -> Result<LaunchTargets, String> {
    let mut queue = state.launch.lock().map_err(|e| e.to_string())?;
    queue.ready = true;
    Ok(std::mem::take(&mut queue.targets))
}

#[tauri::command]
async fn set_watched_files(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<NativeState>();
        let mut guard = state.watcher.lock().map_err(|e| e.to_string())?;
        // A failed reinstallation releases stale watchers. Editing remains independent.
        *guard = None;
        if paths.is_empty() {
            return Ok(());
        }
        let targets: Vec<(String, PathBuf)> = paths
            .into_iter()
            .map(|path| {
                leaf_file_core::resolve_path(&path).map(|resolved| (resolved.to_string_lossy().into_owned(), resolved))
            })
            .collect::<Result<_, _>>()?;
        let parents: HashSet<PathBuf> =
            targets.iter().filter_map(|(_, path)| path.parent().map(Path::to_path_buf)).collect();
        let emitter = app.clone();
        let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            if let Ok(event) = event {
                if matches!(event.kind, notify::EventKind::Access(_)) {
                    return;
                }
                // Directory-level notification handles editor atomic replacement, deletion and renaming.
                let affected: Vec<String> = targets
                    .iter()
                    .filter(|(_, target)| {
                        event.paths.iter().any(|changed| changed == target || changed.parent() == target.parent())
                    })
                    .map(|(original, _)| original.clone())
                    .collect();
                if !affected.is_empty() {
                    let _ = emitter.emit("files-changed", affected);
                }
            }
        })
        .map_err(|e| e.to_string())?;
        for parent in parents {
            watcher.watch(&parent, RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;
        }
        *guard = Some(watcher);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadyReport {
    native_ms: f64,
    frontend_ms: f64,
}
#[tauri::command]
fn report_editor_ready(frontend_ms: f64, state: State<'_, NativeState>) -> ReadyReport {
    let report = ReadyReport { native_ms: state.started.elapsed().as_secs_f64() * 1000.0, frontend_ms };
    eprintln!("Leaf ready: nativeMs={:.2} frontendMs={:.2}", report.native_ms, report.frontend_ms);
    report
}

fn portable_data_root() -> Option<PathBuf> {
    if let Some(override_path) = std::env::var_os("LEAF_DATA_DIR") {
        return Some(PathBuf::from(override_path));
    }
    let exe = std::env::current_exe().ok()?;
    let folder = exe.parent()?;
    folder.join("portable.flag").is_file().then(|| folder.join("data"))
}

pub fn run() {
    let started = Instant::now();
    let cwd = std::env::current_dir().unwrap_or_default();
    let initial = launch_targets(std::env::args().skip(1), &cwd);
    let mut context = tauri::generate_context!();
    let portable_webview = portable_data_root().map(|data_root| {
        let webview_data = data_root.join("webview");
        let absolute = if webview_data.is_absolute() { webview_data } else { cwd.join(webview_data) };
        std::fs::create_dir_all(&absolute)
            .expect("Portable data folder is not writable; extract Leaf into a writable directory");
        absolute
    });
    let mut portable_windows = Vec::new();
    if portable_webview.is_some() {
        for window in &mut context.config_mut().app.windows {
            if window.create {
                portable_windows.push(window.clone());
                window.create = false;
            }
        }
    }
    tauri::Builder::default()
        .setup(move |app| {
            if let Some(data_directory) = &portable_webview {
                // The locked tauri-runtime does not forward config.data_directory to
                // WebviewAttributes. Use the public builder setter explicitly.
                for window in &portable_windows {
                    WebviewWindowBuilder::from_config(app, window)?.data_directory(data_directory.clone()).build()?;
                }
            }
            Ok(())
        })
        .manage(NativeState {
            started,
            writes: Mutex::new(()),
            launch: Mutex::new(LaunchQueue { ready: false, targets: initial }),
            watcher: Mutex::new(None),
        })
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let targets = launch_targets(args.into_iter().skip(1), Path::new(&cwd));
            let state = app.state::<NativeState>();
            if let Ok(mut queue) = state.launch.lock() {
                if queue.ready {
                    let _ = app.emit("launch-targets", targets);
                } else {
                    queue.targets.files.extend(targets.files);
                    queue.targets.directories.extend(targets.directories);
                }
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            get_text_file_status,
            list_directory,
            get_start_directory,
            save_text_file,
            set_watched_files,
            take_launch_targets,
            report_editor_ready
        ])
        .run(context)
        .expect("failed to run Leaf");
}
