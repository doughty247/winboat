package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"
)

const (
	guestAPIPortInternal = 7148
	maxWaitSeconds       = 60
	pollIntervalMs       = 500
	containerName        = "WinBoat"
)

type App struct {
	Name string `json:"Name"`
	Path string `json:"Path"`
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "Usage: winboat-launcher <app_path>")
		showError("Usage: winboat-launcher <app_path>")
		os.Exit(1)
	}

	appPath := os.Args[1]
	fmt.Printf("[WinBoat Launcher] Launching: %s\n", appPath)

	if err := run(appPath); err != nil {
		fmt.Fprintf(os.Stderr, "[WinBoat Launcher] Error: %v\n", err)
		showError(fmt.Sprintf("Failed to launch app:\n\n%v", err))
		os.Exit(1)
	}

	fmt.Println("[WinBoat Launcher] Success!")
}

func run(appPath string) error {
	// Check container status
	status, err := getContainerStatus()
	if err != nil {
		return fmt.Errorf("failed to check container status: %w", err)
	}
	fmt.Printf("[WinBoat Launcher] Container status: %s\n", status)

	// Start container if not running
	if status != "running" {
		fmt.Println("[WinBoat Launcher] Starting container...")
		if err := startContainer(); err != nil {
			return fmt.Errorf("failed to start container: %w", err)
		}
	}

	// Detect the actual host port for guest API
	guestAPIPort, err := detectGuestAPIPort()
	if err != nil {
		return fmt.Errorf("failed to detect guest API port: %w", err)
	}
	fmt.Printf("[WinBoat Launcher] Guest API port: %d\n", guestAPIPort)

	// Wait for guest API
	fmt.Println("[WinBoat Launcher] Waiting for guest API...")
	if err := waitForGuestAPI(guestAPIPort); err != nil {
		return fmt.Errorf("guest API not ready: %w", err)
	}

	// Get apps list
	fmt.Println("[WinBoat Launcher] Fetching apps...")
	apps, err := getApps(guestAPIPort)
	if err != nil {
		return fmt.Errorf("failed to get apps: %w", err)
	}

	// Find the app
	var targetApp *App
	for _, app := range apps {
		if app.Path == appPath {
			targetApp = &app
			break
		}
	}

	if targetApp == nil {
		return fmt.Errorf("app not found: %s", appPath)
	}

	fmt.Printf("[WinBoat Launcher] Launching: %s\n", targetApp.Name)

	// Launch the app
	if err := launchApp(targetApp.Name, guestAPIPort); err != nil {
		return fmt.Errorf("failed to launch app: %w", err)
	}

	return nil
}

func getContainerStatus() (string, error) {
	cmd := exec.Command("docker", "inspect", "--format={{.State.Status}}", containerName)
	output, err := cmd.Output()
	if err != nil {
		// Container doesn't exist or docker error
		return "not-found", nil
	}
	return strings.TrimSpace(string(output)), nil
}

func startContainer() error {
	cmd := exec.Command("docker", "container", "start", containerName)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%w: %s", err, string(output))
	}
	return nil
}

func detectGuestAPIPort() (int, error) {
	// Use docker port command to get the actual host port mapping
	cmd := exec.Command("docker", "port", containerName, fmt.Sprintf("%d/tcp", guestAPIPortInternal))
	output, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("failed to get port mapping: %w", err)
	}

	// Output format: "0.0.0.0:7154" or "[::]:7154"
	portStr := strings.TrimSpace(string(output))
	parts := strings.Split(portStr, ":")
	if len(parts) < 2 {
		return 0, fmt.Errorf("unexpected port format: %s", portStr)
	}

	var port int
	_, err = fmt.Sscanf(parts[len(parts)-1], "%d", &port)
	if err != nil {
		return 0, fmt.Errorf("failed to parse port: %w", err)
	}

	return port, nil
}

func waitForGuestAPI(port int) error {
	start := time.Now()
	maxDuration := time.Duration(maxWaitSeconds) * time.Second
	pollInterval := time.Duration(pollIntervalMs) * time.Millisecond

	for {
		if checkGuestAPIHealth(port) {
			return nil
		}

		if time.Since(start) > maxDuration {
			return fmt.Errorf("timeout waiting for guest API after %d seconds", maxWaitSeconds)
		}

		time.Sleep(pollInterval)
	}
}

func checkGuestAPIHealth(port int) bool {
	url := fmt.Sprintf("http://127.0.0.1:%d/health", port)
	resp, err := http.Get(url)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func getApps(port int) ([]App, error) {
	url := fmt.Sprintf("http://127.0.0.1:%d/apps", port)
	resp, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("guest API returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var apps []App
	if err := json.Unmarshal(body, &apps); err != nil {
		return nil, err
	}

	return apps, nil
}

func launchApp(appName string, port int) error {
	url := fmt.Sprintf("http://127.0.0.1:%d/launch", port)
	payload := map[string]string{"name": appName}
	jsonData, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	resp, err := http.Post(url, "application/json", strings.NewReader(string(jsonData)))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("launch failed with status %d: %s", resp.StatusCode, string(body))
	}

	return nil
}

func showError(message string) {
	// Try to show a GUI error dialog using zenity (common on Linux)
	cmd := exec.Command("zenity", "--error", "--title=WinBoat Launcher Error", "--text="+message, "--width=400")
	cmd.Run() // Ignore errors - if zenity isn't available, we already printed to stderr
}
