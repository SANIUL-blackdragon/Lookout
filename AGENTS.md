# Session XYxMJ — Visual Beauty Archive (Nested Context)

> This file ONLY applies to operations within `d:/experimental/XYxMJ`.
> It does NOT apply to other subfolders. It does NOT apply to the root.

## Global, Reusable Agent Operating Contract

> **MANDATORY**: This contract applies to **ALL** operations within this repository, including the root and all subfolders. These rules override default model behavior.

### 1. Authority & Permissions
- The agent is not read-only by default.
- The agent may read, write, create, modify, and delete files as explicitly permitted by the user or CLI.
- The agent must not discourage actions that are explicitly allowed by the CLI or user permissions.
- If an action is potentially destructive or irreversible, the agent must alert the user before proceeding.
- The agent may self-terminate execution if risk or ambiguity is detected, but only after notifying the user.

### 2. Operating Mode
- **Default operating mode is Hybrid**:
    - Act only when instructions are explicit and unambiguous.
    - Otherwise, stop and ask for clarification.
- The agent must explain its reasoning only when actions are significant (e.g., file deletion, large refactors, multi-step automation).

### 3. Assumptions Policy (Hard Rule)
- **Zero assumptions are allowed.**
- The agent must not infer intent, preferences, constraints, or goals.
- Every decision must be based on:
    - Explicit user instructions, or
    - Verifiable facts directly observable in the environment.
- If required information is missing, the agent must hard-stop and ask.

### 4. Planning & Execution
- Before executing any non-trivial action, the agent must:
    1.  Produce a step-by-step execution plan.
    2.  Validate that the plan complies with this document.
- Multi-step execution is allowed without re-confirmation, once the plan is accepted or implicitly approved by the user.

### 5. Scratchpad Rules
- `agent-playground/` is a sandboxed scratchpad (if present).
- Cleanup rule: Delete everything not necessary moving forward.

### 6. Safety & Hard Stops
- Stop and ask if: Ambiguous instructions, conflicting instructions, missing permissions, or missing required information.

### 7. Never-Do List
- Never act on assumptions.
- Never hide uncertainty.
- Never perform irreversible actions without generic alerts.
- Never modify behavior to be "helpful" at the cost of correctness.
- Never spawn subagents. Do all work inline in this session and talk to the user first before starting.

### 8. Failure Handling
- Stop immediately. Do not retry automatically. Do not rollback unless instructed. Report failure.

### 9. Logging & Traceability
- Log significant actions if a mechanism exists.

### 10. Reusability Principles
- Tool, Vendor, and Model agnostic.

### 11. Enforcement
- This document wins in conflicts. CLI rules win over this document.

### 12. LocalHost Implementation (Mandatory)
- **Always Serve**: Do not rely on file:// access. Experiments must be served over HTTP.
- **Mechanism**: Use `npx serve .` for static sites or `node server.js` for dynamic ones.
- **Port Discipline**: Use standard ports (3000, 5000, 8080) and log them clearly.
- **Behavior**: Treat `localhost` as a real remote server. Respect HTTP methods (GET/POST).

### 13. Commit & Push Discipline (Mandatory)
- **1 unit of mutation = 1 commit.** One unit is one group of work that stands alone as a single granular commit. Examples: one new file with its purpose, one focused edit, one config addition. Never batch several units into one commit. Never wait for PR-sized work.
- **Commit immediately after each unit**, before starting the next unit.
- **Message style is `$unslop`.** Plain human words, no AI tells, active voice, specific file names and reasons. Every message is elaborately detailed: a short subject line, then a body that states what changed, why it changed, which files are in the commit, and what verification was run.
- **Push immediately after each commit** to the branch in use on the repo remote (`origin`). Stage only that unit's files. Never use `--force` on a shared branch. If the push fails, stop and report. Do not retry with force.

---

## Session Goal: Visual Beauty Archive Library

**Purpose (verbatim from user):** Create a repository as an archive for very visually appealing websites. The archive itself will be a website, like a library leading to all the stored beauties, in the library site each website will have a preview, url to the original site, credits, some basic info and metadata and button taking it to the archived save of the website. It's because this will give me data for visually beautiful websites, great inspirations if you ask me for UI-UX. The main website will easily be locally hostable.

### 1. What to Build in `d:/experimental/XYxMJ`
- A static, locally-hostable library site:
  - `index.html` (library home, grid/list of archived sites)
  - `sites/` — one subfolder per archived site (e.g. `sites/example-com/`)
  - `data/sites.json` — structured metadata for all entries
  - `assets/` — thumbnails, screenshots, styles
  - `archive/` — saved copies of original sites (SingleFile HTML or alternatives)
  - `server.js` or use `npx serve .` per §12
  - `LOCALHOST.md` — copy of root explainer (present in this folder)
  - `README.md` — how to add a new site, how to serve locally
- Per-entry card/detail must include:
  1. Title + screenshot/thumbnail
  2. Review (why it is beautiful, UI-UX notes)
  3. URL to original site
  4. Credits (designer/studio/year if known)
  5. Basic info + metadata (category, colors, fonts, stack, date archived)
  6. Button → archived save (`archive/<slug>.html` or `sites/<slug>/`)

### 2. Localhost Discipline
- Do NOT use `file://`. Always verify via `http://localhost:3000` (or 5000/8080).
- Keep a copy of `LOCALHOST.md` in this folder as reference.
- Log chosen port clearly on every serve.

### 3. Archiving Strategy (to research, no assumptions)
- Known tool: `https://github.com/gildas-lormeau/SingleFile` — single HTML save, good for static + many dynamic pages.
- Must evaluate alternatives for exact saves — no matter how dynamic:
  - `SingleFile CLI` vs browser extension
  - `Monolith` (rust single-file bundler), `wget --page-requisites`, `httrack`
  - Full-fidelity interactive: `ReplayWeb.page / pywb / warc` + `ArchiveWeb.page`, `Browsertrix crawler`
  - Headless screenshots/video as fallback for WebGL/canvas-heavy sites
- Decision must note: fidelity vs single-file portability vs interactivity vs size.
- Do NOT archive any site without checking its license/ToS for local archival. If unclear, STOP and ask.

### 4. Immediate Next Steps
1. Scaffold folder structure + minimal `index.html` + `data/sites.json` with 1-2 placeholder entries.
2. Add `server.js` (Node http, GET only initially) and verify on localhost.
3. Document archiving workflow in `README.md`.
4. Ask user for first 2-3 real beautiful sites to archive as pilot data.

### 5. Scope Guard
- All paths are relative to `d:/experimental/XYxMJ`.
- Do not touch parent or sibling session folders.
