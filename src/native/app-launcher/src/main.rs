use anyhow::{Context, Result};
use native_dialog::{MessageDialog, MessageType};
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

const GUEST_API_PORT: u16 = 7148;
const MAX_WAIT_SECONDS: u64 = 60;
const POLL_INTERVAL_MS: u64 = 500;

fn main() {
    if let Err(e) = run() {
        eprintln!("[WinBoat Launcher] Error: {}", e);
        MessageDialog::new()
            .set_type(MessageType::Error)
            .set_title("WinBoat Launcher Error")
            .set_text(&format!("Failed to launch app:\n\n{}", e))
            .show_alert()
            .ok();
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    // Get app path from command line
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        anyhow::bail!("Usage: winboat-launcher <app_path>");
    }
    let app_path = &args[1];
    
    println!("[WinBoat Launcher] Launching: {}", app_path);
    
    // Check container status
    let container_status = get_container_status()?;
    println!("[WinBoat Launcher] Container status: {}", container_status);
    
    // Start container if not running
    if container_status != "running" {
        println!("[WinBoat Launcher] Starting container...");
        start_container()?;
    }
    
    // Wait for guest API to be ready
    println!("[WinBoat Launcher] Waiting for guest API...");
    wait_for_guest_api()?;
    
    // Get apps list
    println!("[WinBoat Launcher] Fetching apps list...");
    let apps = get_apps()?;
    
    // Find the app by path
    let app = apps
        .iter()
        .find(|a| a["Path"].as_str() == Some(app_path))
        .with_context(|| format!("App not found: {}", app_path))?;
    
    let app_name = app["Name"]
        .as_str()
        .unwrap_or("Unknown");
    
    println!("[WinBoat Launcher] Launching: {}", app_name);
    
    // Launch the app
    launch_app(app_name)?;
    
    println!("[WinBoat Launcher] Success!");
    Ok(())
}

fn get_container_status() -> Result<String> {
    let output = Command::new("docker")
        .args(["inspect", "--format={{.State.Status}}", "WinBoat"])
        .output()
        .context("Failed to check container status")?;
    
    if !output.status.success() {
        return Ok("not-found".to_string());
    }
    
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn start_container() -> Result<()> {
    let output = Command::new("docker")
        .args(["container", "start", "WinBoat"])
        .output()
        .context("Failed to start container")?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("Failed to start container: {}", stderr);
    }
    
    Ok(())
}

fn wait_for_guest_api() -> Result<()> {
    let start = Instant::now();
    let max_duration = Duration::from_secs(MAX_WAIT_SECONDS);
    
    loop {
        if check_guest_api_health() {
            return Ok(());
        }
        
        if start.elapsed() > max_duration {
            anyhow::bail!("Guest API did not start within {} seconds", MAX_WAIT_SECONDS);
        }
        
        thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));
    }
}

fn check_guest_api_health() -> bool {
    let url = format!("http://127.0.0.1:{}/health", GUEST_API_PORT);
    
    match reqwest::blocking::get(&url) {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

fn get_apps() -> Result<Vec<serde_json::Value>> {
    let url = format!("http://127.0.0.1:{}/apps", GUEST_API_PORT);
    
    let response = reqwest::blocking::get(&url)
        .context("Failed to fetch apps")?;
    
    if !response.status().is_success() {
        anyhow::bail!("Guest API returned error: {}", response.status());
    }
    
    let apps: Vec<serde_json::Value> = response
        .json()
        .context("Failed to parse apps JSON")?;
    
    Ok(apps)
}

fn launch_app(app_name: &str) -> Result<()> {
    let url = format!("http://127.0.0.1:{}/launch", GUEST_API_PORT);
    
    let client = reqwest::blocking::Client::new();
    let response = client
        .post(&url)
        .json(&serde_json::json!({ "name": app_name }))
        .send()
        .context("Failed to launch app")?;
    
    if !response.status().is_success() {
        let body = response.text().unwrap_or_default();
        anyhow::bail!("Failed to launch app: {}", body);
    }
    
    Ok(())
}
