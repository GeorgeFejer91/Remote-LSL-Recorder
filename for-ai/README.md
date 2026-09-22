# Remote-LSL-Recorder agent control plane

Read this file first. It is a router, not the complete project manual.

## Purpose

`for-ai/` separates AI orchestration from product output. Store durable project
context, skill routing, decisions, verification rules, and agent workflows
here. Keep product source, shipped assets, end-user documentation, and final
deliverables outside this directory.

## Authority order

1. System, developer, and current user instructions.
2. Applicable law, safety, privacy, and external contracts.
3. This repository's verified source, tests, schemas, and configuration.
4. Current canonical documents in `for-ai/`.
5. Historical decisions and external references.

If authorities disagree, stop and surface the conflict. Do not silently choose
the easiest interpretation.

## Read by task

| Need | Read |
| --- | --- |
| Scope, goals, boundaries, architecture, current state | [`PROJECT.md`](./PROJECT.md) |
| Which installed skills apply and in what order | [`SKILLS.md`](./SKILLS.md) |
| Acceptance criteria, commands, gates, evidence limits | [`VERIFICATION.md`](./VERIFICATION.md) |
| Session loop, updates, Git publication, handoff | [`WORKFLOW.md`](./WORKFLOW.md) |
| Why a durable choice was made or superseded | [`DECISIONS.md`](./DECISIONS.md) |

Do not read every file by default. Read this router, then only what the current
task touches.

## Session loop

1. Resolve the repository root and inspect Git status before changing anything.
2. State the requested observable outcome and select the task-owned documents,
   skills, and verification gates.
3. Inspect the existing owner before adding code, files, dependencies, or
   abstractions.
4. Make the smallest complete change and preserve unrelated work.
5. Run focused checks, then proportionate integration and publication gates.
6. Update the narrowest canonical control-plane file when a durable fact
   changed.
7. Report evidence, limitations, commit/remote state, and any blocker.

## New-project state

Created: 2026-09-22
Repository: https://github.com/GeorgeFejer91/Remote-LSL-Recorder
Visibility at initialization: private

No product stack or output tree is implied by this bootstrap.
