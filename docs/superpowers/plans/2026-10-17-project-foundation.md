# Project Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Establish concise project guidance, module ownership boundaries, interface documentation, and sample locations for the browser-hosted container planner and trade document workflow.

**Architecture:** Keep the existing portable executable as the current launch artifact while documenting the intended browser host and two sibling feature modules. This phase creates governance and documentation scaffolding only; it does not claim to extract unavailable source or implement document processing.

**Tech Stack:** Markdown documentation, JSON Schema only where fields are sufficiently known; current packaged Windows executable and bundled web assets remain the reference runtime.

**Spec:** `docs/superpowers/specs/2026-10-17-project-architecture-design.md`

## Global Constraints

- Preserve the portable launch flow: double-click `ContainerPlanner.exe`, open the local browser interface, and require no programming environment on the user's destination computer.
- The browser application is the host and navigation entry; container planning and trade documents are sibling features.
- Feature modules must not depend on another feature's internal files; module collaboration uses documented public contracts.
- Existing real business files remain in place and are not copied into sample folders or release packages by default.
- Do not claim that the current packaged executable is complete, reproducible source code.
- This phase changes documentation and empty sample organization only; it does not modify the current UI, executable, or release archives.

## Review Focus

- New contributors might mistake the executable bundle for maintained source; root and container module docs must label the packaged-only state.
- The trade document module might be treated as part of container planning; directory and ownership docs must show sibling modules under the web host.
- Agents might edit another module's internals; root and local `AGENTS.md` files must state the owner-only rule and contract path.
- Real customer files might leak into samples; sample guidance must require approved, preferably anonymized files.
- Proposed interface fields might be mistaken for implemented APIs; interface docs must label unverified contracts as proposals until source inspection.

---

### Task 1: Root project guidance and ownership rules

**Files:**
- Create: `README.md`
- Create: `AGENTS.md`
- Create: `docs/architecture.md`
- Create: `docs/project-management.md`
- Modify: `README-目录.md`

**Interfaces:**
- Consumes: approved design `docs/superpowers/specs/2026-10-17-project-architecture-design.md`.
- Produces: project entry point, directory/ownership rules, naming conventions, and cross-feature work policy for all later tasks.

- [x] Write `README.md` with project purpose, current double-click launch instructions, local-only runtime description from existing usage documentation, source/package status, and links to architecture, project-management, and module READMEs.
- [x] Write a short root `AGENTS.md` that requires reading only relevant module docs, confines edits to the assigned feature, routes cross-feature work through documented contracts, and forbids copying real business data into samples by default.
- [x] Write `docs/architecture.md` with the web host, sibling feature modules, shared contract layer, packaging boundary, and dependency direction from the approved design.
- [x] Write `docs/project-management.md` with directory taxonomy, ASCII kebab-case naming for new source directories, Chinese names retained for existing business-data folders, sample classification, and the owner-only change workflow.
- [x] Replace the directory-only summary in `README-目录.md` with a short compatibility pointer to `README.md` and the existing data folders.
- [x] Review local links and confirm each path named in the root README exists or is explicitly marked as a future source location.

### Task 2: Browser host and container module documentation

**Files:**
- Create: `web-app/README.md`
- Create: `web-app/AGENTS.md`
- Create: `features/container-planner/README.md`
- Create: `features/container-planner/AGENTS.md`

**Interfaces:**
- Consumes: `docs/architecture.md` and `docs/project-management.md` from Task 1.
- Produces: ownership instructions for the browser host and container planner, including the current packaged-only implementation status.

- [x] Document `web-app/README.md` as the future host for startup, local service, shared navigation, and feature assembly; label source availability as not yet established.
- [x] Keep `web-app/AGENTS.md` limited to host responsibilities and require feature behavior to remain in its owning module.
- [x] Document `features/container-planner/README.md` with current user-visible capabilities from the existing usage guide, its expected module boundary, current executable/web-asset locations, and the fact that independent source/build files have not been found.
- [x] Keep `features/container-planner/AGENTS.md` limited to container-specific files and state that consumers use its public contract rather than internal algorithms or UI files.
- [x] Review links and ensure no document describes the current executable as already split into modules.

### Task 3: Trade document module and sample organization

**Files:**
- Create: `features/trade-documents/README.md`
- Create: `features/trade-documents/AGENTS.md`
- Create: `features/trade-documents/samples/input/README.md`
- Create: `features/trade-documents/samples/templates/README.md`
- Create: `features/trade-documents/samples/expected/README.md`

**Interfaces:**
- Consumes: root ownership rules from Task 1 and host/module boundaries from Task 2.
- Produces: isolated module scope and stable locations for approved import examples, output templates, and expected output notes.

- [x] Describe the intended workflow in `features/trade-documents/README.md`: import Excel/Word/PDF, extract business fields with source evidence, let the user review uncertain values, generate selected INV/PL outputs from supplied templates, and expose confirmed cargo data through the container planner contract.
- [x] State that format support and field mappings are proposals until the user's samples and output templates are reviewed.
- [x] In `features/trade-documents/AGENTS.md`, require changes to stay in this module and its contracts, preserve evidence/source information, and never silently infer missing weights or dimensions.
- [x] Add brief placement rules to each sample `README.md`; only place user-approved examples there and prefer anonymized copies.
- [x] Confirm no existing file from `真实数据/` was copied or moved into the feature tree.

### Task 4: Cross-module interface documentation

**Files:**
- Create: `docs/interfaces/README.md`
- Create: `docs/interfaces/web-app-module-interface.md`
- Create: `docs/interfaces/trade-document-record.md`
- Create: `docs/interfaces/container-planner-api.md`
- Create: `docs/interfaces/document-export.md`

**Interfaces:**
- Consumes: feature responsibilities documented in Tasks 2 and 3.
- Produces: public contracts with owner, purpose, input/output concepts, errors, versioning policy, and verification expectations.

- [x] Document module registration/navigation and host-to-module responsibilities without binding to an uninspected implementation mechanism.
- [x] Define the proposed trade record concepts: normalized buyer/seller, products, packaging, quantities, prices, weights, dimensions, source evidence, extraction status, and user confirmation state.
- [x] Document the proposed container request/response concepts and explicitly mark concrete fields as requiring verification against the existing packaged app's actual endpoints/source.
- [x] Document output selection for Excel, Word, and PDF, template ownership, missing-field errors, and a downloadable result; do not claim layout preservation until verified with supplied templates.
- [x] Add an interface index that identifies each contract owner and marks each contract `proposed` or `verified`.
- [x] Review all interface pages for accidental dependencies on another feature's internal paths.

### Task 5: Documentation consistency review

**Files:**
- Review: `README.md`
- Review: `AGENTS.md`
- Review: `docs/architecture.md`
- Review: `docs/project-management.md`
- Review: `docs/interfaces/`
- Review: `web-app/`
- Review: `features/`
- Review: `README-目录.md`

**Interfaces:**
- Consumes: completed documentation from Tasks 1–4.
- Produces: a consistent project map with no claims that future module code already exists.

- [x] Check all relative Markdown links and named directory paths.
- [x] Check that root and child `AGENTS.md` rules are concise, hierarchical, and non-contradictory.
- [x] Check that each feature's contract is owned by the correct module and no instructions require reading another module's internals.
- [x] Check that current launch behavior, local data flow, and source availability are described consistently.
- [x] Check that sample guidance excludes unapproved real customer files.

## Execution record

Completed 2026-10-17: all five documentation tasks were completed. A PowerShell scan checked 20 Markdown files and found all relative links resolving. No application code, tests, executable, real business files, or release archives were changed. The project is not a Git repository, so no commits were created.

## Follow-on plans (not part of this documentation phase)

- **Container source and host extraction:** write a separate implementation plan after source/build discovery establishes what can be recovered from the current executable and bundled web assets.
- **Trade document processing:** write a separate implementation plan after the user supplies representative source documents and INV/PL templates, so extraction mappings, generated formats, and field-level rules can be specified from real examples.
- **Portable release integration:** plan after both feature implementations and the host build path are known; acceptance must include running the copied release on a clean Windows computer without a development environment.

