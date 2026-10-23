#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::error::Error;
use std::io::{BufRead, BufReader, Error as IoError, ErrorKind};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

struct BackendProcess(Mutex<Child>);

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let (mut backend, url) = launch_backend(app.handle())?;
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse()?))
                .title("LocalAtlas")
                .inner_size(1440.0, 960.0)
                .min_inner_size(980.0, 640.0)
                .build();

            if let Err(error) = window {
                let _ = backend.kill();
                let _ = backend.wait();
                return Err(error.into());
            }

            app.manage(BackendProcess(Mutex::new(backend)));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to initialize the LocalAtlas desktop app");

    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            if let Some(backend) = handle.try_state::<BackendProcess>() {
                if let Ok(mut child) = backend.0.lock() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    });
}

fn launch_backend(app: &tauri::AppHandle) -> Result<(Child, String), Box<dyn Error>> {
    let node_path = find_node_runtime()?;
    let server_path = backend_path(app)?;
    if !server_path.is_file() {
        return Err(format!(
            "Bundled LocalAtlas server is missing: {}",
            server_path.display()
        )
        .into());
    }

    let mut child = Command::new(&node_path)
        .arg(&server_path)
        .arg("serve")
        .env("PORT", "0")
        .env("LOCALATLAS_DESKTOP", "true")
        .env("LOCALATLAS_CLI_ENTRY_PATH", &server_path)
        .env_remove("LOCALATLAS_ALLOW_REMOTE")
        .current_dir(server_path.parent().unwrap_or_else(|| Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()?;

    let stdout = child.stdout.take().ok_or_else(|| {
        IoError::new(
            ErrorKind::Other,
            "failed to capture LocalAtlas backend output",
        )
    })?;
    let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<String, String>>(1);
    thread::spawn(move || read_backend_output(stdout, ready_tx));

    let url = match ready_rx.recv_timeout(Duration::from_secs(30)) {
        Ok(Ok(url)) => url,
        Ok(Err(message)) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(IoError::new(ErrorKind::Other, message).into());
        }
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(IoError::new(
                ErrorKind::TimedOut,
                format!("LocalAtlas backend did not start: {error}"),
            )
            .into());
        }
    };

    Ok((child, url))
}

fn read_backend_output(
    stdout: impl std::io::Read,
    ready_tx: mpsc::SyncSender<Result<String, String>>,
) {
    let mut ready_sent = false;
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { break };
        if !ready_sent {
            if let Some(url) = line.strip_prefix("LOCALATLAS_READY=") {
                if url.starts_with("http://127.0.0.1:") {
                    let _ = ready_tx.send(Ok(url.to_owned()));
                    ready_sent = true;
                    continue;
                }
                let _ = ready_tx.send(Err(
                    "LocalAtlas backend returned a non-loopback URL".to_owned()
                ));
                return;
            }
        }
        eprintln!("[LocalAtlas] {line}");
    }
    if !ready_sent {
        let _ = ready_tx.send(Err(
            "LocalAtlas backend exited before becoming ready".to_owned()
        ));
    }
}

fn backend_path(_app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn Error>> {
    #[cfg(debug_assertions)]
    {
        let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or_else(|| IoError::new(ErrorKind::NotFound, "project root is missing"))?
            .to_path_buf();
        return Ok(project_root.join("dist-tauri/localatlas.mjs"));
    }

    #[cfg(not(debug_assertions))]
    {
        let resources = _app.path().resource_dir()?;
        Ok(resources.join("server/localatlas.mjs"))
    }
}

fn find_node_runtime() -> Result<PathBuf, Box<dyn Error>> {
    let mut candidates = Vec::new();
    if let Some(configured) = std::env::var_os("LOCALATLAS_NODE_PATH") {
        let path = PathBuf::from(configured);
        if !node_version_is_supported(&path) {
            return Err(format!(
                "LOCALATLAS_NODE_PATH must point to Node.js 22.5.0 or newer: {}",
                path.display()
            )
            .into());
        }
        return Ok(path);
    }

    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|dir| dir.join(node_executable())));
    }

    #[cfg(target_os = "macos")]
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
        PathBuf::from("/usr/bin/node"),
    ]);

    #[cfg(target_os = "linux")]
    candidates.extend([
        PathBuf::from("/usr/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
        PathBuf::from("/snap/bin/node"),
    ]);

    #[cfg(target_os = "windows")]
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        candidates.push(PathBuf::from(program_files).join("nodejs/node.exe"));
    }

    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        let home = PathBuf::from(home);
        candidates.push(home.join(".volta/bin").join(node_executable()));
        candidates.extend(versioned_node_paths(
            &home.join(".nvm/versions/node"),
            false,
        ));
        candidates.extend(versioned_node_paths(
            &home.join(".local/share/mise/installs/node"),
            false,
        ));
        candidates.extend(versioned_node_paths(
            &home.join(".asdf/installs/node"),
            false,
        ));
        candidates.extend(versioned_node_paths(
            &home.join(".local/share/fnm/node-versions"),
            true,
        ));
    }

    let mut checked = Vec::new();
    for path in candidates {
        if checked.contains(&path) {
            continue;
        }
        checked.push(path.clone());
        if node_version_is_supported(&path) {
            return Ok(path);
        }
    }

    Err("LocalAtlas desktop requires Node.js 22.5.0 or newer. Install Node.js or set LOCALATLAS_NODE_PATH to its executable.".into())
}

fn node_executable() -> &'static str {
    if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    }
}

fn versioned_node_paths(root: &Path, has_installation_directory: bool) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut paths: Vec<_> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .map(|path| {
            let root = if has_installation_directory {
                path.join("installation")
            } else {
                path
            };
            root.join("bin").join(node_executable())
        })
        .collect();
    paths.reverse();
    paths
}

fn node_version_is_supported(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    let Ok(output) = Command::new(path).arg("--version").output() else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let version = String::from_utf8_lossy(&output.stdout);
    let mut parts = version.trim().trim_start_matches('v').split('.');
    let (Some(Ok(major)), Some(Ok(minor)), Some(Ok(_patch))) = (
        parts.next().map(str::parse::<u64>),
        parts.next().map(str::parse::<u64>),
        parts.next().map(str::parse::<u64>),
    ) else {
        return false;
    };
    major > 22 || (major == 22 && minor >= 5)
}
