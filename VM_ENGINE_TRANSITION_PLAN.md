# WinBoat VM Engine Transition Plan

## Executive Summary

WinBoat's current runtime is tightly coupled to one container image and one VM launch model:

- Docker Compose config generation in [src/renderer/lib/install.ts](src/renderer/lib/install.ts)
- Runtime control in [src/renderer/lib/winboat.ts](src/renderer/lib/winboat.ts)
- QMP transport assumptions in [src/renderer/lib/qmp.ts](src/renderer/lib/qmp.ts)
- RDP launcher reading credentials directly from compose in [scripts/winboat-freerdp-launcher.sh](scripts/winboat-freerdp-launcher.sh)

This coupling blocks advanced graphics features and slows product polish. The cleanest transition is not "remove QEMU". It is:

1. Keep QEMU as the core hypervisor.
2. Replace the single hardcoded runtime with a backend abstraction.
3. Make backend implementations pluggable.
4. Introduce a graphics profile system with capability detection and guided fallbacks.

This produces a polished product experience while preserving compatibility.

## Target End State

WinBoat supports multiple VM backends behind one stable interface:

- Backend A (default for existing users): Docker QEMU backend (current behavior, compatibility mode)
- Backend B (recommended for performance users): Managed QEMU backend (native host-managed process or libvirt-managed QEMU)

Both backends expose identical product capabilities:

- start/stop/pause/unpause/reset
- health, metrics, app listing, guest update
- launch apps via existing FreeRDP pipeline
- optional QMP integration

## Why This Is The Cleanest Transition

- Zero hard break: existing installs continue to run.
- Progressive migration: users can switch backend from settings.
- Minimal UX churn: app launch model and guest API remain stable.
- Better graphics runway: backend-specific GPU/capture paths become selectable.
- Better supportability: feature gating by detected capabilities instead of one-size-fits-all assumptions.

## Product Decisions (Recommended)

### 1. Keep RemoteApp as the primary UX
RemoteApp remains the primary "polished" integration path. Looking Glass becomes an optional desktop mode, not a hard dependency for product success.

### 2. Graphics Profiles, not one graphics path
Define explicit profiles:

- Balanced (default): maximum compatibility, stable behavior.
- Performance: enables advanced GPU/capture options when available.
- Passthrough: expert profile for dedicated GPU workflows.

### 3. Capability-driven UI
Expose what the host can actually do and explain why. Do not expose options that cannot work on the current machine.

## Architecture Changes

## A. Introduce Backend Interface

Create a new backend contract, for example in src/renderer/lib/backend/types.ts:

- getStatus
- start/stop/pause/unpause/reset
- getPorts/getCredentials
- getHealth/getMetrics/getRdpStatus
- pushGuestUpdate
- read/write runtime config
- optional qmpConnection

Current Winboat singleton in [src/renderer/lib/winboat.ts](src/renderer/lib/winboat.ts) becomes orchestrator logic that delegates to selected backend.

## B. Backend Implementations

### B1. DockerQemuBackend (Phase 1)
Wrap existing logic from:

- compose generation in [src/renderer/lib/install.ts](src/renderer/lib/install.ts)
- container control in [src/renderer/lib/winboat.ts](src/renderer/lib/winboat.ts)

No behavior changes initially. This is a refactor-only extraction.

### B2. ManagedQemuBackend (Phase 2)
Introduce runtime that manages QEMU outside the Dockur image assumptions.
Two acceptable implementations:

- libvirt (preferred for lifecycle and tooling)
- direct managed qemu process (if libvirt dependency is undesired)

Initial requirement: keep guest API + RDP contract identical so launcher UX remains unchanged.

## C. Runtime Config Model

Move from implicit compose-only configuration to backend-neutral config file, for example:

- ~/.winboat/runtime.json

Include:

- selected backend
- guest resources (cpu, ram, disk)
- networking mode
- ports
- graphics profile
- backend-specific overrides

Compose remains an implementation detail of DockerQemuBackend.

## D. Capability Detection Layer

Add host probing service to detect:

- KVM availability
- container runtime health
- libvirt availability (if used)
- graphics feature support by backend
- QMP reachability

UI should show:

- Available profiles
- Why unavailable features are disabled
- One-click migration recommendations

## E. Graphics and Capture Strategy

Define a product-safe fallback tree:

1. RemoteApp (always preferred for app windows)
2. Full desktop via RDP/noVNC fallback
3. Optional advanced desktop capture path (backend-specific)

Important: avoid exposing a capture path unless host capability checks pass.

## Migration Path For Existing Users

## Phase 0 - Stabilization (1-2 days)

- Freeze current Docker path as compatibility baseline.
- Add telemetry/log labels to distinguish backend actions.
- Add integration snapshot tests around current install/start/launch flow.

Acceptance:

- Existing users unaffected.
- No regression in install/start/RemoteApp launch.

## Phase 1 - Internal Refactor (3-5 days)

- Extract Docker behavior into DockerQemuBackend.
- Keep existing UI and data model unchanged.
- Keep compose file generation exactly as current output.

Acceptance:

- Binary behavior parity with pre-refactor builds.
- Existing compose-based installs continue without migration.

## Phase 2 - Runtime Config + Backend Selector (3-4 days)

- Introduce runtime.json.
- Add hidden feature flag for backend selection.
- Add one-way import from compose into runtime config.

Acceptance:

- Users can keep Docker backend by default.
- App can load from either old compose or runtime config.

## Phase 3 - Managed Backend MVP (5-10 days)

- Implement ManagedQemuBackend lifecycle.
- Keep guest API endpoint contract same for renderer.
- Add health and status reporting parity with Docker backend.

Acceptance:

- Start/stop/launch works on managed backend for a clean install.
- Existing Docker users unaffected.

## Phase 4 - Polished UX Rollout (3-5 days)

- Expose backend selector in settings with recommended default.
- Add graphics profile UI with capability-gated options.
- Add migration assistant:
  - "Keep current backend"
  - "Switch to recommended backend"
  - backup/rollback in one step

Acceptance:

- Users can switch backend safely.
- Clear rollback path to Docker backend.

## Rollback and Safety

Mandatory safeguards:

- Backup previous runtime config before each migration.
- Keep compose backup behavior equivalent to current replaceCompose flow.
- If backend switch fails, auto-revert to last known working backend and surface actionable error.

## Testing Matrix (Must-Have)

- Fresh install on Docker backend
- Upgrade existing user install to refactored build
- Backend switch Docker -> Managed -> Docker
- Launch app via desktop shortcut and open-with integration
- Guest server update flow on both backends
- QMP-enabled and QMP-disabled scenarios

## Code-Level Change List

1. Add backend types and orchestrator
   - new: src/renderer/lib/backend/types.ts
   - new: src/renderer/lib/backend/factory.ts

2. Extract Docker backend
   - new: src/renderer/lib/backend/dockerQemuBackend.ts
   - move logic from [src/renderer/lib/install.ts](src/renderer/lib/install.ts)
   - move lifecycle logic from [src/renderer/lib/winboat.ts](src/renderer/lib/winboat.ts)

3. Add runtime config manager
   - new: src/renderer/lib/runtimeConfig.ts

4. Add managed backend scaffold
   - new: src/renderer/lib/backend/managedQemuBackend.ts

5. Wire launcher script to backend-neutral credential/port source
   - update [scripts/winboat-freerdp-launcher.sh](scripts/winboat-freerdp-launcher.sh)

6. Keep QMP manager reusable
   - reuse [src/renderer/lib/qmp.ts](src/renderer/lib/qmp.ts)
   - move connection details behind backend interface

## Product Messaging

User-facing language should be:

- "WinBoat now supports multiple virtualization runtimes for better compatibility and performance."
- "Your current setup remains supported."
- "Recommended profile is selected automatically based on your system capabilities."

Avoid messaging that implies mandatory migration.

## Recommended Immediate Next Step

Execute Phase 1 now: backend extraction with strict behavior parity. This gives the biggest long-term leverage with the lowest product risk.
