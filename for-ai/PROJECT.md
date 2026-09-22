# Project contract

## Purpose

A Windows-first Tauri application for discovering, viewing, and recording LSL streams with an opt-in BRSP smartphone companion.

## Primary goal

Deliver the smallest usable result that satisfies the current user request and
can be verified at its real output surface.

## Non-goals

- No speculative framework, service, abstraction, compatibility layer, or
  deployment system.
- No second implementation tree or duplicate source of truth.
- No capability claim without matching evidence.

Add project-specific non-goals only after they prevent a plausible wrong turn.

## Product/control-plane boundary

- Product source and deliverables: outside `for-ai/`; exact roots are
  **Undecided until the first deliverable selects them**.
- Agent orchestration and durable project memory: `for-ai/`.
- Local generated diagnostics and scratch evidence: `.for-ai-local/` (ignored).

## Architecture and ownership

The implementation stack, modules, external contracts, and deployment surface
are currently **Undecided**. Once selected, record only the top-level ownership
map here and route detailed protocols to task-specific files.

## Current verified state

- Fresh Git repository initialized on 2026-09-22.
- AI control plane created and mechanically checked.
- No product implementation has been scaffolded.

Git and runnable checks are the authority for branch, revision, and behavior.
Do not turn this section into a second status ledger.
