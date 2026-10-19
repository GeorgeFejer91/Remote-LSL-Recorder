# Remote-LSL-Recorder agent instructions

Before inspecting, planning, editing, testing, or publishing this repository,
read [`for-ai/README.md`](./for-ai/README.md). It is the canonical router to the
project context, skill rules, verification gates, decisions, and workflow.

Keep `AGENTS.md` short. Durable orchestration belongs in `for-ai/`; product
source, shipped assets, end-user documentation, and deliverables belong outside
it. Read only the task-routed documents and skills, preserve unrelated work,
apply YAGNI, and never claim a check or deployment that was not observed.

System, developer, and current user instructions take precedence. Before
handoff, run the applicable gates in `for-ai/VERIFICATION.md` and update the
control plane only when a durable fact or rule changed.

<!-- for-ai:shared-skills:start -->
## Shared project workflow

At project entry, also read [for-ai/SKILLS.md](for-ai/SKILLS.md) for the required RTK, GSD Core,
and Superpowers baseline, conditional Rust/Tauri/HTML routes, and Git worktree
policy. Preserve this project's product and evidence contracts.

Read the durable project goal and resume its active checklist at session
start. Before ending, update that same state with evidence, blockers, the
next action, and observed Git/publication state. Keep the overall goal open
until its own acceptance criteria pass.
<!-- for-ai:shared-skills:end -->
