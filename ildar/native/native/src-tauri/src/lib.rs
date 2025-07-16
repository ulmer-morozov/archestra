use bollard::container::RemoveContainerOptions;
use bollard::models::ContainerCreateBody;
use bollard::query_parameters::{CreateContainerOptions, StartContainerOptions};
use bollard::Docker;
use tauri::command;
use tauri::tray::TrayIconBuilder;
use wasmtime::*;
// use wasmtime_wasi::preview1::{WasiCtx, WasiCtxBuilder, add_to_linker};
use wasmtime::component::ResourceTable;

// pub struct ComponentRunStates {
//     pub wasi_ctx: WasiCtx,
//     pub resource_table: ResourceTable,
// }

// impl IoView for ComponentRunStates {
//     fn table(&mut self) -> &mut ResourceTable {
//         &mut self.resource_table
//     }
// }
// impl WasiView for ComponentRunStates {
//     fn ctx(&mut self) -> &mut WasiCtx {
//         &mut self.wasi_ctx
//     }
// }

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
async fn start_alpine_container() -> Result<String, String> {
    println!("Starting Alpine container");
    let docker = Docker::connect_with_local_defaults().map_err(|e| e.to_string())?;

    // Create the container
    let create_options = CreateContainerOptions {
        name: Some("alpine-tauri".to_string()),
        ..Default::default()
    };

    let config = ContainerCreateBody {
        image: Some("alpine".to_string()),
        cmd: Some(vec!["echo".to_string(), "Hello from Alpine!".to_string()]),
        ..Default::default()
    };

    let create_result = docker
        .create_container(Some(create_options), config)
        .await
        .map_err(|e| format!("Create error: {e}"))?;

    // Start the container
    docker
        .start_container(&create_result.id, None::<StartContainerOptions>)
        .await
        .map_err(|e| format!("Start error: {e}"))?;

    println!("Container started: {}", create_result.id);

    // Get the logs
    let mut logs_stream = docker.logs(
        &create_result.id,
        Some(bollard::container::LogsOptions::<String> {
            stdout: true,
            stderr: true,
            follow: true,
            ..Default::default()
        }),
    );

    Ok("Hello!23".to_string())
}

struct MyState {
    name: String,
    count: usize,
}

#[tauri::command]
fn run_wasm(path: String) -> Result<String, String> {
    println!("Running WASM");

    Ok("Hello, world!".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_notification::init());

    // #[cfg(target_os = "macos")]
    // {
    //   // You can safely init the plugin on any platform.
    //   // Or choose to only initialize it on macos.
    //   builder = builder.plugin(tauri_plugin_macos_haptics::init());
    // }

    builder
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            use tauri::{
                menu::{Menu, MenuItem},
                tray::TrayIconBuilder,
            };

            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit_i])?;

            let tray = TrayIconBuilder::new()
                .menu(&menu)
                .menu_on_left_click(true)
                .build(app)?;

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, run_wasm])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
