# Prompt Keeper Business Model Document

| Item | Content |
| --- | --- |
| Document title | Prompt Keeper Business Model Document |
| Version | v0.1 (draft) |
| Date | 2026-11-18 |
| Status | Pending business review; not a financial forecast, not a PRD |
| Basis | [`docs/interaction-design.md`](./interaction-design.md) v0.5, [`README.md`](../README.md), [`design/prototype/README.md`](../design/prototype/README.md), the implemented `src/` application, `package.json` v0.5.0 |
| Audience | Founder / product lead, design partners, prospective partners and investors (selected sections) |
| Annotation rules | `[FACT]` established by the prototype or an existing document; `[ASSUMPTION]` hypothesis to validate; `[TBD-BIZ]` pending business decision; `[CONFLICT]` documentation conflict |

> **Implementation note (2026-11-19):** the desktop MVP described in this draft has now been implemented in this repository. References below to "the prototype" describe the original browser validation stage and are retained as business context, not as a claim about the current runtime.

> Note: this document splits "business model" into two layers — the **operating model** (how the product creates and delivers value; Chapter 5) and the **commercial model** (how revenue and growth are captured; Chapters 6–8). All prices, conversion rates, costs, and timelines are hypotheses to validate and do not constitute commitments.

---

## 0. One-page summary

**What the product is.** Prompt Keeper is a local-first control plane for AI coding assets: it brings **Prompts, Agent Instructions (AGENTS.md / CLAUDE.md / .cursor/rules, etc.), Skills (SKILL.md), and MCP configuration** into one workspace, syncs them across machines and teams through Git, and then dispatches or projects them into multiple AI coding tools. [FACT: `README.md`, `docs/interaction-design.md` §1.1]

**What problem it solves.** After developers adopt multiple Agent tools, the same rules, prompts, skills, and MCP configuration get copied into different directories, producing version drift, manual syncing, credential leaks, no review path, and no rollback. Teams lack a vendor-neutral, auditable shared control plane. [ASSUMPTION: generalized from prototype scenarios; requires user interviews to validate]

**Business logic.** Acquire individual developers with a complete, usable free local core → build team network effects through shared Git repositories → charge teams and enterprises for governance, auditing, security integration, and support. The core is not "another AI client" but a **cross-tool asset and delivery control plane**. [ASSUMPTION: commercial model choice, see §6.2]

**Revenue model.** Open-core subscription: Free / Pro / Team / Enterprise; later additions may include marketplace take rates, migration, and custom services. Baseline security capabilities are not charged for; the paid value sits in collaboration, governance, compliance, and support. [ASSUMPTION: see §6.3–6.5]

**North-star metric.** Weekly Successful Deliveries (WSD), deduplicated by "asset × target tool." It directly measures whether assets actually reach the Agent, not installs or edit volume. [ASSUMPTION: see §9.1]

**Biggest risks.** Platform vendors absorbing the capability natively, open-source clones and upstream competition, low willingness to pay among individual developers, security liability from writing to Agent directories, and license compliance for the upstream PromptHub. [ASSUMPTION: see §10]

**Current stage.** Interactive prototype v0.5 has completed clickable validation of the four asset types + Sync Center + global dispatch; the next step is a desktop MVP, 10–15 design partners, and pricing validation — not a direct market launch. [FACT: prototype scope; ASSUMPTION: next steps]

**One-line positioning.** Turn AI coding assets from "configuration owned by each tool" into **versioned, reviewable, cross-tool team infrastructure**.

---

## 1. Purpose, basis, and method

### 1.1 Purpose

1. Clarify for whom the product creates value, how that value is delivered, what drives cost, and where revenue comes from.
2. Translate the "product rules" in interaction flows into "business rules," and determine which capabilities are acquisition hooks, which are team value, and which are enterprise purchase points.
3. Provide testable hypotheses, metrics, phase exit criteria, and kill criteria so that prototype completeness is not mistaken for commercial viability.

### 1.2 Out of scope

- No financial forecasts or fundraising material; the figures in §6.5 and §8.4 only illustrate drivers.
- Does not replace the PRD; interaction details are governed by `docs/interaction-design.md`.
- Does not present unvalidated market conclusions as facts; gaps are marked `[ASSUMPTION]` / `[TBD-BIZ]`.

### 1.3 Basis and boundaries of fact

| Basis | Use | Confidence |
| --- | --- | --- |
| `docs/interaction-design.md` v0.5 | Product positioning, four asset types, sync and dispatch rules, acceptance checklist | High: formal in-project design document |
| `README.md` | Feature overview, repository layout, prototype coverage | High |
| `design/prototype/` | Frozen visual and interaction prototype, responsive behavior, acceptance records | High: clickable prototype |
| `src/` | Domain objects, state machines, seed data | High: runnable code |
| `package.json` v0.5.0, `LICENSE` | Version and license facts | High |
| External market data | This document cites no specific figures; it only provides a measurement framework | `[TBD-BIZ]` |

### 1.4 What the prototype has and has not proven

| Proven (interaction and information architecture) | Not proven (commercial and engineering) |
| --- | --- |
| Four asset types can share a "folder tree + list + detail" information architecture [FACT] | Reliability of real Git with large repositories, conflicts, and poor networks [ASSUMPTION] |
| The three-layer model "repo ⇄ local library → Agent" can be explained clearly [FACT] | Whether users will let the tool write to directories such as `~/.claude` and `~/.codex` [ASSUMPTION] |
| Trust gates such as per-item preview, secret scanning, and drift protection can be productized [FACT: interaction layer] | Whether teams will pay for governance, and at what price point [TBD-BIZ] |
| Instruction contracts can be compiled into the native formats of multiple tools [FACT: static simulation] | Whether each tool's real merge order and format match the simulation [ASSUMPTION] |
| A local-first, backend-free product shape is viable [FACT] | Whether retention, conversion, and measurement work under local-first [ASSUMPTION] |
| Versioning, rollback, and audit events close the loop in the interaction [FACT] | Whether security liability, enterprise procurement, and compliance requirements can be met [TBD-BIZ] |

---

## 2. Market problem and opportunity

### 2.1 Problem definition

AI coding tools have evolved from "one IDE plugin" to "multiple coexisting Agents": Claude Code, Codex, Cursor, Windsurf, OpenCode, Cline, Kiro, Qoder, and others each have their own rules files, skill directories, and MCP configuration. [FACT: the prototype covers 8 local Agent global targets, see §6.2.6]

This creates five structural problems:

| # | Problem | Current state | Business consequence |
| --- | --- | --- | --- |
| 1 | Asset fragmentation | The same Prompt / rules / Skill / MCP configuration is stored separately in multiple tool directories | Duplicated work, version inconsistency, high migration cost |
| 2 | Rule drift | `AGENTS.md`, `CLAUDE.md`, and `.cursor/rules` are maintained by hand and gradually diverge | Inconsistent Agent behavior; code review and security standards stop working |
| 3 | Missing collaboration | Files live in Git, but there is no asset semantics, per-item review, three-way merge, or dispatch record | Conflicts are resolved manually; teams are afraid to share |
| 4 | Security gaps | MCP secrets are plaintext, Skills may carry scripts, pulling means writing | Credential leaks, supply-chain attacks, no audit trail |
| 5 | Missing governance | No one knows "which version, when, and to which tool," and there is no rollback | Enterprises cannot buy; teams cannot assign accountability |

### 2.2 Why now

1. **Multiple Agents are the norm.** Developers do not use just one tool; cross-tool consistency matters more than single-tool optimization. [ASSUMPTION: requires user research on tool-count distribution]
2. **Configuration formats are becoming file-based.** `AGENTS.md`, `CLAUDE.md`, `.cursor/rules`, `copilot-instructions`, `SKILL.md`, and MCP JSON are all files, making "unified management + compile-time projection" technically feasible. [FACT: prototype target registry]
3. **The MCP and Skill ecosystem expands the attack surface.** Pulling a Skill may bring executable scripts; MCP configuration may launch local processes. Review and secret isolation move from "best practice" to "launch prerequisite." [ASSUMPTION: strength of the security requirement needs interview validation]
4. **Team adoption of AI coding is rising while governance tooling lags.** Individual usage comes first; team standards, auditing, and onboarding are not yet productized. [ASSUMPTION]
5. **Git is an existing developer habit.** There is no need to teach users "what version control is"; the product can use Git as the transport layer instead of inventing another cloud drive. [FACT: the prototype treats Git as the shared source of truth]

### 2.3 Existing alternatives and gaps

| Alternative | What it does well | Key gap | Prompt Keeper's difference |
| --- | --- | --- | --- |
| Native configuration per tool | Zero cost, official support | Single-tool silos; no cross-tool sync, review, or audit | Vendor-neutral control plane |
| Manual copying / personal notes | Simple | Severe drift; no versioning; secrets leak easily | Structured assets + versioning + scanning |
| Dotfiles management (chezmoi / stow, etc.) | Mature file-level sync | Does not understand Prompt / Skill / MCP semantics; no projection, drift, or review | Asset semantics + target adapters |
| Git repository + custom scripts | Customizable, team-controlled | High maintenance; no UI, no conflict workflow, no security gates | Productized workflow and trust gates |
| Asset management tools such as PromptHub | Strong Prompt / Skill / MCP management | This prototype's increment is Git sync, cross-Agent dispatch, and a separate Agent Instructions domain [FACT: per the design document] | Completes "shared source of truth + delivery control plane" |
| MCP gateway / secret manager | Strong secret and network governance | Does not handle asset authoring, versioning, or cross-tool projection | Integrate with it rather than replace it |
| Internal platform team build | Fits organizational process | High cost, hard to productize, hard to reuse across teams | Standardized product + configurable policy |

### 2.4 Market sizing framework (no fabricated numbers)

This document cites no unverified TAM figures. It recommends a bottom-up framework for the business owner to fill in during Phase 0:

```text
TAM = professional developers worldwide using AI coding Agents
      × average annual amount they are willing to pay for "asset/configuration governance"

SAM = developers in TAM who use ≥2 Agents at once, or who need team sharing and auditing

SOM = the portion of SAM reachable and convertible within 3 years through open source, content, community, and partnerships
```

| Variable | Definition | Suggested data source | Current state |
| --- | --- | --- | --- |
| Professional developers using AI coding Agents | Active-developer definition | Industry reports, public GitHub / IDE data | `[TBD-BIZ]` |
| Share of multi-Agent users | Uses ≥2 tools at once | Custom survey, community research | `[TBD-BIZ]` |
| Share with team sharing/governance needs | Has team standards, audit, or security requirements | Interviews, enterprise procurement records | `[TBD-BIZ]` |
| Annual willingness to pay | Split by individual / team / enterprise | Van Westendorp, design-partner price tests | `[TBD-BIZ]` |
| Reachable share | Market share attainable in 3 years | Channel and content experiments | `[TBD-BIZ]` |

### 2.5 Opportunity assessment

**The opportunity is not "manage more Prompts" but "become the cross-tool delivery control plane."** Prompt management is a high-frequency entry point, but a point tool is easy to clone. What is genuinely hard to replace:

1. Consistent modeling of the four asset types and their lifecycles;
2. Continuous adaptation to the native formats of multiple Agent targets;
3. Review, drift, and rollback mechanisms before writing to Agent directories;
4. Collaboration habits and audit records formed by team-shared repositories.

The business wedge should therefore be **individual multi-tool users** (high frequency, low decision cost), revenue expansion should be **team governance**, and the long-term moat should be **enterprise compliance and breadth of ecosystem adaptation**.

---

## 3. Users and segments

### 3.1 Customer segments

| Segment | Typical size | Core pain | Buyer role | Business priority |
| --- | --- | --- | --- | --- |
| Individual multi-tool developer | 1 person | Duplicate configuration, migration, lost versions, secret safety | Themselves | P1: acquisition and word of mouth |
| AI-native engineering team | 5–50 people | Inconsistent rules, slow onboarding, drift, missing review | Tech Lead / Eng Manager | P2: primary revenue |
| Enterprise platform / security team | 50+ people | Secret compliance, supply-chain risk, audit, unified policy | Security / Platform / VP Eng | P3: deal size and moat |
| Asset authors / ecosystem partners | Individual or small team | Skill / Prompt distribution, versioning, feedback | Author / Platform | P4: supply side and channel |

### 3.2 Personas

#### P1: "Alex," multi-tool individual developer

- Uses Claude Code, Cursor, and Codex at the same time, and occasionally switches to Windsurf.
- Has 50–200 Prompts, 10–30 Skills, and 5–10 MCP configurations.
- Pain: manual copying when changing machines or tools; not knowing which rules are current; an MCP token almost got committed to Git.
- Willingness to pay: low–medium; would pay $6–10/month for "save time + lose nothing + leak nothing."
- Success criteria: one dispatch to all tools; restore on a new machine in 10 minutes; secrets never appear in the repository.
- Reach: GitHub, developer communities, content search, friend referrals.

#### P2: "Priya," AI engineering productivity lead

- 10–30 person team, 3+ Agents coexisting, already has a shared Git repository.
- Pain: rules differ per project; new hires must manually configure 5 tools; someone hand-edited `CLAUDE.md` and it got overwritten; cannot prove "which version went where."
- Willingness to pay: medium; team budget $10–20/seat/month; needs approval flow, audit export, and unified policy.
- Success criteria: one repository as the single source of truth; one-click sync for new members; visible drift; quarterly audit export.
- Reach: design partners, internal propagation, technical content, open-source template repositories.

#### P3: "Sam," security / platform / compliance

- Enterprise platform engineering or security team focused on credentials, supply chain, and compliance.
- Pain: plaintext tokens scattered across MCP configuration; Skills may execute scripts; no centralized policy or audit; cannot answer "who wrote what to which tools and when."
- Willingness to pay: high, enterprise budget, but long procurement cycle; requires SSO, audit, secret integration, penetration testing, and legal terms.
- Success criteria: secrets only in OS keychain / secret manager; enforced policy; exportable audit; passes security review.
- Reach: enterprise sales, security community, partners, compliance material.

### 3.3 Jobs To Be Done

1. **When changing machines or tools**: I want Prompts, rules, Skills, and MCP configuration to be immediately usable so I don't have to reconfigure everything.
2. **When team rules change**: I want to change one place and sync it to all Agents so everyone follows the same standard.
3. **When pulling shared assets**: I want to see exactly what will be written, what will execute, and where secrets will go so I don't compromise local security.
4. **When target files were edited by hand**: I want to see the drift before deciding whether to overwrite so I don't destroy a colleague's work.
5. **Before committing**: I want suspected secrets to be blocked and templated so credentials never enter Git.
6. **When something breaks**: I want to know which version went where and be able to roll back so I can recover quickly.

### 3.4 Non-target users (current stage)

- Users with only one Agent and no team-sharing need: weak pain; free alternatives are sufficient.
- Users who do not write code and only consume chat prompts: not the core scenario for this product.
- Extremely strict environments that require full offline operation and forbid any local file writes: incompatible with the current product model; would need a dedicated edition.
- Users who want an "AI chat client / model aggregator": not this product's positioning.

### 3.5 Users, buyers, and influencers

| Role | Individual | Team | Enterprise |
| --- | --- | --- | --- |
| Daily user | The developer | Team members | Developers |
| Buyer | The developer | Tech Lead / Eng Manager | Security / Platform / VP Eng |
| Influencer | Community reputation | Internal referrals, design partners | Security review, legal, IT |
| Decision cycle | Minutes | Days–weeks | Weeks–months |
| Primary purchase reason | Save time, don't lose assets | Consistency, onboarding, audit | Compliance, secrets, supply-chain security |

**Business implication:** the individual edition must be "immediately useful, no sales required"; the team edition must show Tech Leads the value of "unification and audit"; the enterprise edition must come with security questionnaires, SSO, secret integration, and legal terms. One feature bundle cannot satisfy all three.

---

## 4. Value proposition and competitive positioning

### 4.1 Positioning statement

> For developers and teams who use multiple AI coding Agents, Prompt Keeper is a local-first asset and delivery control plane: it unifies Prompts, Agent Instructions, Skills, and MCP configuration, shares them through Git, and provides per-item review, drift protection, secret isolation, and rollback before writing to each tool. Unlike native configuration per tool or generic dotfiles, it understands asset semantics, delivery targets, and security boundaries.

### 4.2 Four value pillars

| Value pillar | How the prototype expresses it | User value | Commercial role |
| --- | --- | --- | --- |
| **Unified asset control plane** | Four asset types share "folder tree + list + detail"; folders map to repository directories [FACT: §1.2 #17, #18] | Learn once, use for all four; no more hunting for configuration | Acquisition hook; high-frequency usage |
| **Git-native collaboration and portability** | One asset per file; three-way merge; per-item conflict resolution; stable ids [FACT: §6.1.7, §6.5.4] | Team sharing, reviewable, migratable, no vendor lock-in | Team value; word-of-mouth |
| **Trusted delivery and security boundaries** | Per-item preview, secret scanning and templating, drift protection, no silent overwrite or automatic writes [FACT: §1.2 #5–8, #15, #20] | No leaks, no destroyed files, traceable, rollback-able | Enterprise purchase prerequisite; trust brand |
| **Breadth of cross-tool adaptation** | 6 project-level instruction targets, 8 global Agent targets, 8 Skill platforms; data-driven target registry [FACT: §6.2.1, §6.2.6] | Write once, take effect across tools | Competitive difference; maintenance cost center |

### 4.3 Competitive comparison

| Capability | Native per tool | Dotfiles / scripts | PromptHub-type tools | MCP gateway / secret management | Prompt Keeper |
| --- | --- | --- | --- | --- | --- |
| Unified management of four asset types | ○ | ○ | ◐ (leans Prompt / Skill / MCP) | ○ | ● |
| Git three-way sync and conflict workflow | ○ | ◐ | ◐ | ○ | ● |
| Cross-Agent dispatch / projection | ○ | ○ | ◐ | ○ | ● |
| Instruction resolution preview and target compilation | ○ | ○ | ○ | ○ | ● |
| Drift detection and per-item overwrite | ○ | ○ | ○ | ○ | ● |
| Secret isolation and templating | ○ | ○ | ◐ | ● | ● |
| Local-first / data sovereignty | ● | ● | ● | ◐ | ● |
| Team governance / audit | ○ | ○ | ○ | ◐ | ◐ (Enterprise build pending) |

Legend: ● Strong; ◐ Partial; ○ Weak or missing. This table is a qualitative judgment `[ASSUMPTION]` and must be calibrated with competitor trial records in Phase 0.

### 4.4 Moat and anti-moat

| Possible moat | Strength | Explanation |
| --- | --- | --- |
| Target registry and adaptation breadth | Medium | Data-driven design lowers the cost of adding tools, but formats and paths can be copied; continuous maintenance and testing are the real moat |
| Depth of the trust model and workflow | Medium–strong | Per-item review, drift protection, rollback, and audit become product habits; copying them takes time and reputation |
| Git-native portability | Medium | Lowers user lock-in and helps acquisition, but also lowers switching costs; must be reinforced with team collaboration and audit records |
| Community and asset ecosystem | Weak–medium (early) | Template repositories, Skill / rule packs, and contributors can create network effects, but require long-term operation |
| Brand and security reputation | Strong (long term) | Writing to Agent directories is a high-risk action; once trust is established, it is hard to replace |

**Honest conclusion:** the code itself is not a moat; the current repository is still an MIT-licensed prototype [FACT: `LICENSE`]. The real barriers are **sustained adaptation speed + security reputation + team workflow habits + enterprise compliance capability**. The business plan must not assume that "technical leadership" can stop clones.

### 4.5 Product boundaries (deliberately excluded)

- No AI chat client, model aggregator, or inference provider.
- No general-purpose secret manager or MCP gateway; integrate with them, do not replace them.
- No full dotfiles manager; only AI coding assets with semantics.
- No content marketplace in the early stage; prove tool value first, then consider a supply ecosystem.
- No automatic execution of Skill scripts or MCP processes; only configuration and file delivery. [FACT: prototype security boundary]
- No uploading asset content to the cloud by default; local-first is the foundation of trust.

---

## 5. Operating model (derived from interaction flows)

### 5.1 Asset object model

| Object | Definition | Repository path | Key states |
| --- | --- | --- | --- |
| Prompt | Reusable prompt template with variables and System / User sections | `prompts/<folder>/<slug>.prompt.md` | Local / in sync / local-only; version; sync status |
| Agent Contract | Persistent Agent instruction contract with scope / activation / priority / targets | `instructions/<folder>/<slug>.contract.md` | `synced` / `stale` / `drifted` / `missing` |
| Skill | Installable skill with `SKILL.md` and optional scripts | `skills/<folder>/<name>/SKILL.md` | Installed / externally installed / drifted / pending push |
| MCP Server | MCP server configuration with transport and `${VAR}` templates | `mcp/<folder>/<name>.json` | Enabled / disabled / health check / drift |
| Projection / Deployment | Record of one write to a target | Target tool directory or project file | `synced` / `stale` / `drifted` / `missing` |
| SyncChange | Pending pull, pending push, or conflict | Sync Center | `incoming` / `outgoing` / `conflict` |
| VersionSnapshot | Local version snapshot | Local library | Comparable, restorable, current version not deletable |

### 5.2 End-to-end lifecycle

```text
Discovery → Author / edit → Version → Git sync → Dispatch / projection → Observe and handle drift → Rollback / audit
```

| Stage | User action | Product mechanism | Business value | Prototype evidence |
| --- | --- | --- | --- | --- |
| Discovery | Platform discovery, Skill Store, MCP Store, team repository | Search, preview, copy, save locally | Lower cold start; content entry point | §6.1.1, §6.3.2, §6.4.4 |
| Author / edit | Create, edit, fill variables, AI test | List-detail, variable form, version snapshot | High-frequency use forms habits | §6.1.3–6.1.6 |
| Version | Save, compare, restore | Automatic snapshot, diff, restore creates a new version | Lower risk of accidental edits | §6.1.5 |
| Git sync | Pull, push, resolve conflicts | Three-way merge, per-item preview, secret scan | Team sharing and reviewability | §6.5.4 |
| Dispatch / projection | Install Skill, apply MCP, project instructions, global dispatch | Target adapters, write preview, per-item confirmation | Core delivery value | §6.2.4, §6.2.6, §6.5.5 |
| Observe / drift | View matrix, handle drift | State machine, no bulk overwrite, per-item confirmation | Safety and trust | §6.2.4, §6.5.5 |
| Rollback / audit | Roll back versions, export history | Version rollback, audit events | Enterprise compliance and accountability | §6.5.6 |

### 5.3 Two-layer dispatch model

```text
Git repository (shared source of truth)
   ⇅  pull / push: three-way merge, per-item conflict resolution
Local asset library (on-machine control plane)
   ├─ Prompt / Agent Instructions: only repo ⇄ local library
   ├─ Skill / MCP: local library → each Agent's default directory (symlink / copy)
   └─ Agent Instructions: project-level projection + user-level global directory projection
Agents (Claude Code / Codex / Cursor / Windsurf / OpenCode / Cline / Kiro / Qoder)
```

**Business implications:**

- Git handles cross-machine and cross-team sharing; the local library handles review, conflict resolution, projection, and dispatch; Agent directories are only the final consumption point and are never the source of truth. [FACT: §6.5.1]
- Prompts and instructions move only in the upper half, avoiding the mess of "prompts written into multiple tool directories"; only Skills and MCP enter the dispatch matrix. [FACT: product boundary]
- Global directory projection is separate from project-level projection, addressing the different governance needs of "machine-default rules" and "project rules." [FACT: §6.2.6]

### 5.4 Trust gates (business rules)

These rules are not interaction details but the product's "trust contract," and the prerequisite for team / enterprise revenue:

| Rule | How the prototype expresses it | Commercial value |
| --- | --- | --- |
| Any write must be previewed first | Dispatch / projection / global dispatch all show the target path and content | Fewer miswrites; enterprise auditability |
| Prompt / Instructions pulls are previewed per item | Bulk accept is prohibited; confirmation by checkbox is required | Prevents malicious instructions and privacy leaks |
| New Skills / Skills with scripts must be reviewed | Full `SKILL.md` + file list + trust checkbox | Supply-chain security |
| Secrets never enter Git | MCP uses `${VAR}`; Prompts / instructions use `{{variable}}` | Compliance and brand trust |
| Bulk overwrite of drift is prohibited | `drifted` can only be overwritten after per-item confirmation | Prevents destroying colleagues' work |
| No automatic merge / commit / push / write | Automatic fetch is read-only; all writes require confirmation | Controllable and explainable |
| All dispatches are traceable and rollback-able | Record version, time, target, mode | Enterprise accountability and recovery |
| Global paths are stored locally only | Not committed to Git | Data sovereignty and privacy |

### 5.5 Roles and collaboration model (current gap)

The prototype is a single-user local tool and **has no login, roles, approval, or organization model**. [FACT: prototype scope] This directly limits Team / Enterprise revenue:

| Role | Required permissions | Prototype status | Commercial requirement |
| --- | --- | --- | --- |
| Owner / Admin | Manage repositories, members, policies, billing | None | Required |
| Editor | Create / edit assets, initiate pushes | None | Required |
| Approver | Approve pushes, overwrite drift, publish policies | None | Required for Team |
| Viewer | Read-only, copy, view audit | None | Recommended |
| Auditor | Export audit, view compliance reports | None | Required for Enterprise |

**Conclusion:** a Team / Enterprise commercial model cannot rely on "the same local app plus a pricing page"; it must add RBAC, approval flows, audit export, and policy enforcement. These are Phase 2 product work and the prerequisite for revenue.

### 5.6 Delivery form and technical boundaries

| Dimension | Current prototype | Commercial product direction | Business impact |
| --- | --- | --- | --- |
| Form factor | Web prototype (React + Vite + localStorage) [FACT] | Desktop app (Electron + SQLite + local filesystem) [ASSUMPTION: per design-document backlog] | Desktop is a prerequisite for writing to local directories |
| Data | In-memory seed + localStorage [FACT] | SQLite + local clone + OS keychain | Reliability and security |
| Git | Simulated [FACT] | Real Git (system credentials / SSH) | Core of team collaboration |
| Secrets | Display-layer `[REDACTED]` [FACT] | OS keychain / secret manager integration | Enterprise procurement threshold |
| Server | None [FACT] | Optional: license validation, updates, encrypted backup, policy distribution, marketplace API | Low cost, high trust |
| Measurement | None [FACT] | Optional anonymous telemetry + local metrics panel | Growth measurement under local-first |

**Business implication:** local-first significantly lowers infrastructure cost and raises trust and data sovereignty; the price is difficulty with real-time collaboration, unified measurement, and enforced policy. The revenue model should rely on **license and governance value**, not cloud usage.

### 5.7 Mapping from prototype to commercial capabilities

| Prototype capability | Commercial capability | Revenue tier | Note |
| --- | --- | --- | --- |
| Four asset types + folder tree | Unified asset library | Free | Acquisition hook |
| Version history / rollback | Risk management | Free | Baseline safety is not charged |
| Git sync / conflicts | Team sharing | Free → Team | Basic sync free, governance paid |
| Prompt / instruction per-item preview | Review and compliance | Free → Enterprise | Enterprises need policy enforcement and export |
| Skill review + symlink/copy | Supply-chain security | Free → Team | Enterprises need allowlists and signing |
| MCP secret templating | Secret compliance | Free → Enterprise | Enterprises need secret manager integration |
| Project-level projection + drift | Rule consistency | Free → Team | Core team value |
| Global directory dispatch | On-machine fleet management | Team → Enterprise | Enterprise multi-tool management |
| Audit history / rollback | Accountability and recovery | Team → Enterprise | Needs export and retention policy |
| Sync Center overview | Operational visibility | Team → Enterprise | Needs team dashboard |

---

## 6. Commercial model

### 6.1 Business model canvas (one page)

| Module | Content |
| --- | --- |
| **Customer segments** | Multi-tool individual developers; 5–50 person AI-native engineering teams; enterprise platform/security teams; Skill / rule authors |
| **Value proposition** | Unified cross-tool management of four AI coding asset types; Git sharing; secure, reviewable, rollback-able delivery to each Agent |
| **Channels** | Open-source repository, documentation and SEO, developer communities, design partners, Agent vendor partnerships, enterprise sales |
| **Customer relationships** | Self-service (PLG); co-creation with design partners; Team customer success; Enterprise security review and support |
| **Revenue streams** | Pro subscription; Team per seat; Enterprise annual/platform fee; migration and custom services; later marketplace take rate |
| **Key resources** | Target registry and adapters, codebase, trust brand, community, template repositories, audit data model |
| **Key activities** | Product R&D, adapter maintenance, security review, community operations, enterprise support |
| **Key partners** | Agent vendors, Git hosting platforms, secret managers, MCP ecosystem, Skill authors, design partners |
| **Cost structure** | R&D (largest), adapter maintenance, support, security/legal, GTM, infrastructure (low) |

### 6.2 Model selection

| Option | Description | Pros | Cons | Verdict |
| --- | --- | --- | --- | --- |
| A. Pure open source + sponsorship | MIT core + GitHub Sponsors | High trust, fast propagation | Unstable revenue, hard to fund full-time maintenance | Not the primary model |
| B. One-time desktop license | One-time payment | Simple, easy for users to accept | Cannot cover continuous adaptation and security maintenance | Not recommended |
| C. **Open-core subscription** | Free core + paid Team / Enterprise modules and services | Matches ongoing maintenance cost; PLG-friendly; controllable trust | Requires a clear open-source boundary; enterprise features must be genuinely valuable | **Recommended** |
| D. SaaS team workspace | Cloud-hosted assets and policies | Easy collaboration and measurement | Conflicts with local-first / secret safety; high COGS | Only as optional encrypted backup / policy service |
| E. Marketplace take rate | Skill / Prompt / rule-pack transactions | Ecosystem network effects | Heavy content moderation and security liability; too early | Re-evaluate later |

**Recommended combination:** C as the primary model, D only as an optional value-added service for encrypted backup and policy distribution, and E only after tool value is proven. Rationale:

1. Adapters and security maintenance are ongoing costs; subscription matches them better than a one-time license.
2. A free core maximizes individual users and repository network effects; charge for team governance, and do not penalize baseline security.
3. Local-first is the trust differentiator and should not be forced into SaaS for revenue.
4. Marketplace content liability and moderation costs are high and would distract in the early stage.

### 6.3 Editions and packaging (draft)

| Capability | Free | Pro | Team | Enterprise |
| --- | --- | --- | --- | --- |
| Four asset types + local library | ✓ | ✓ | ✓ | ✓ |
| Version history / rollback | ✓ | ✓ | ✓ | ✓ |
| Git sync (personal repository) | ✓ | ✓ | ✓ | ✓ |
| Multiple repositories / multiple workspaces | — | ✓ (after the backlog feature ships) | ✓ | ✓ |
| Project-level projection + drift protection | ✓ | ✓ | ✓ | ✓ |
| Global directory dispatch | ✓ (personal machine) | ✓ | ✓ | ✓ |
| Secret scanning / templating | ✓ | ✓ | ✓ | ✓ |
| Team policy packs / approval flows | — | — | ✓ | ✓ |
| RBAC / member management | — | — | Basic | Advanced |
| Audit export / retention policy | Local history only | Local history only | ✓ | ✓ + compliance reports |
| SSO / SCIM | — | — | Add-on | ✓ |
| Secret manager integration | — | — | — | ✓ |
| Encrypted cloud backup (optional) | — | ✓ | ✓ | ✓ |
| AI test | Bring your own key | BYO key + advanced configuration | Team-shared configuration | Enterprise policy |
| Support | Community | Priority | SLA | Dedicated |
| Deployment | Direct download | Direct download | Direct download | Direct download / offline license |
| Price (hypothesis) | $0 | $6–10/month | $12–20/seat/month (annual) | $25–40/seat/month or platform annual fee |

**Notes:**

- All prices are `[ASSUMPTION]` and must be validated through design partners and pricing experiments; they are not fixed in this document.
- Baseline security (scanning, drift protection, per-item review) remains in Free; **security is not put behind a paywall**, otherwise trust and reputation suffer.
- Team's paid value is "governance for multi-person collaboration," not "whether Git can be used."
- Enterprise's paid value is "compliance, integration, support, and risk transfer," not "more buttons."

### 6.4 Pricing logic

**Charging principles:**

1. **Charge for coordination and governance, not for local security.** Individual users should get the complete security workflow for free.
2. **Charge per seat, not per asset or per dispatch.** Per-asset or per-dispatch billing punishes heavy usage and is hard to meter accurately locally.
3. **The free tier must be "worth recommending."** A fully usable individual edition is what drives team propagation.
4. **Enterprise is priced as an annual/platform fee plus seats.** This matches procurement processes and support costs.
5. **Do not bundle model inference.** AI test defaults to bring-your-own-key (BYO key) to avoid uncontrollable inference costs and data liability.

**Value metric choice:**

| Candidate | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| Per seat | Predictable, easy to explain, aligned with collaboration value | Small teams may find it expensive | **Primary metric** |
| Per asset | Correlates with usage | Punishes accumulation; hard to audit locally | Rejected |
| Per dispatch | Correlates with core value | Punishes heavy usage; easily polluted by retries | Rejected |
| Per repository | Suits multi-repository teams | Feature not available early | Use as a Pro/Team packaging item |
| Enterprise platform fee | Matches procurement and support | Decoupled from scale | Enterprise supplement |

### 6.5 Revenue structure and example model

Revenue streams:

| Revenue stream | Customer | Pricing | Launch stage | Note |
| --- | --- | --- | --- | --- |
| Pro subscription | Individual | Monthly/annual | Phase 1 | Convenience and advanced features |
| Team subscription | Team | Seat/month, annual discount | Phase 2 | Governance, audit, approval |
| Enterprise | Enterprise | Annual fee + seat | Phase 3 | SSO, compliance, support |
| Migration / onboarding services | Team/enterprise | Project-based | Phase 1–2 | Early cash flow |
| Custom adapters | Enterprise | Project-based / annual | Phase 3 | High value but people-intensive |
| Marketplace take rate | Ecosystem | 15–30% of transaction value | Phase 4 | Requires review and liability system |

Example model (**illustrates drivers only, not a forecast**; all figures are `[ASSUMPTION]`):

| Metric | Conservative | Base | Aggressive |
| --- | --- | --- | --- |
| Monthly active users (MAU) | 5,000 | 20,000 | 60,000 |
| Pro conversion | 2% | 3% | 4% |
| Pro price/month | $8 | $8 | $9 |
| Pro MRR | $800 | $4,800 | $21,600 |
| Paying teams | 20 | 80 | 250 |
| Average seats | 6 | 8 | 10 |
| Team price/seat/month | $12 | $15 | $18 |
| Team MRR | $1,440 | $9,600 | $45,000 |
| Enterprise customers | 1 | 4 | 15 |
| Enterprise ACV | $25,000 | $30,000 | $40,000 |
| Enterprise MRR equivalent | $2,083 | $10,000 | $50,000 |
| **Total MRR** | **$4,323** | **$24,400** | **$116,600** |
| **Annualized ARR** | **~$52k** | **~$293k** | **~$1.4M** |

**How to read this:** revenue is most sensitive to "team conversion" and "number of enterprise customers," not to the individual Pro price. GTM should therefore validate team pain and willingness to pay first, rather than chasing individual-edition price increases.

### 6.6 Unit economics (example)

| Metric | Pro | Team (8 seats) | Enterprise |
| --- | --- | --- | --- |
| Annual revenue | $96 | $1,440 | $30,000 |
| Gross margin assumption | 90% | 85% | 75% |
| CAC assumption | $30 | $600 | $10,000 |
| CAC payback | ~4 months | ~6 months | ~5 months |
| 3-year gross profit | ~$259 | ~$3,672 | ~$67,500 |
| LTV / CAC | ~8.6 | ~6.1 | ~6.8 |

**Note:** the above excludes churn, expansion, support costs, and payment-channel fees; it only illustrates that "Team and enterprise customers are the revenue base." The real model should replace these with actual CAC, retention, and gross margin in Phase 2.

### 6.7 Open-source boundary and license strategy

**Fact:** the current repository is MIT-licensed, copyright Tony (2026). [FACT: `LICENSE`]

Commercial implications of MIT:

- Anyone may use, modify, distribute, and relicense it, including competitors.
- Grants for published MIT code are irrevocable; even if the license changes in the future, existing versions can still be used and forked indefinitely.
- If open-core is adopted, decide **before the formal public release** which code goes into the open-source core and which goes into a separate commercial package, and handle contributor licensing (CLA/DCO) and trademarks.

| Strategy | Applicable conditions | Pros | Risks |
| --- | --- | --- | --- |
| MIT core + closed-source commercial modules | Want to maximize adoption while retaining enterprise features | Community trust, fast propagation; clear commercial boundary | Requires strict module isolation; community may object |
| Future versions move to source-available | Need to protect commercial features | Can restrict direct competition | Published MIT versions cannot be revoked; may damage reputation |
| Pure open source + services/support | Community-first, small team | Simple, highest trust | Low revenue ceiling |
| Keep the source closed for now | Commercial-first | Protects implementation | Loses open-source propagation and trust advantages |

**Recommendation:** complete the legal and commercial decision `[TBD-BIZ]` before the public release. If open-core is chosen, keep the core runtime and file formats under MIT, and put Team/Enterprise governance, audit, SSO, and secret manager integration in a separate commercial package or service; also register the trademark to avoid fork confusion.

**Upstream compliance:** the design document states that features were sourced from PromptHub v0.6.2 through scripted extraction. [FACT: `docs/interaction-design.md` document header] This repository records no upstream license or derivative relationship. Before public release, the following must be completed:

1. Verify PromptHub's license and attribution requirements;
2. Determine whether "feature extraction" constitutes a derivative work;
3. Retain the necessary NOTICE / attribution;
4. Communicate or collaborate with the upstream author where needed.

All of the above are `[TBD-BIZ]`; until legal conclusions are available, do not publicly claim "independent implementation" or "no copyright risk."

### 6.8 Ecosystem and marketplace (later stage)

Potential value of a marketplace: discovery and distribution of Skills / Prompts / rule packs, creating supply-side network effects. But not in the early stage, because:

- Content safety review is expensive (scripts, prompt injection, privacy);
- Liability allocation is complex (author, platform, enterprise);
- There must first be enough users and willingness to pay.

If launched, the recommended sequence:

1. Start with "official curation + private team repositories," not public transactions;
2. Establish author verification, content scanning, version signing, and takedown mechanisms;
3. Then introduce paid content and take rates (15–30%);
4. Offer a private marketplace / allowlist for Enterprise.

---

## 7. Go-to-market strategy (GTM)

### 7.1 Entry path

**Beachhead:** advanced individual users in English- and Chinese-speaking developer communities who use ≥2 Agents at once. Rationale:

- Real pain, short decision chain, fast feedback;
- Willing to try new tools and act as word-of-mouth nodes;
- Their shared repositories naturally bring in teams.

**Expansion path:**

```text
Individual free use → Asset accumulation → Share / co-build a Git repository → Colleagues install → Team governance needs → Team pays
       ↑                                                                             ↓
       └──────────── Template repositories / rule packs / best-practice content ←───────────┘
```

### 7.2 Growth flywheel

1. **Individual utility flywheel:** daily use → more assets → higher switching cost (habit) → recommend to colleagues.
2. **Team repository flywheel:** one person creates a shared repository → colleagues pull and use it → team size grows → governance and audit needs → Team pays.
3. **Content/ecosystem flywheel:** public template repositories, rule packs, migration guides → search and community traffic → new users → more templates.

### 7.3 Channels and content

| Channel | Priority | Action | Measurement |
| --- | --- | --- | --- |
| GitHub / open source | P0 | Open-source core, example repositories, issue templates, contribution guide | stars, forks, external PRs, issue quality |
| Documentation and SEO | P0 | Tutorials such as "AGENTS.md vs CLAUDE.md," "cross-tool MCP sync," "Skill management" | Organic search traffic, sign-ups/downloads |
| Developer communities | P0 | HN, Reddit, Discord, Chinese-language technical communities, product launches | Activation, word of mouth, feedback |
| Design partners | P0 | Co-create with 10–15 teams in exchange for case studies and feedback | LOIs, paid conversion, case studies |
| Agent vendor partnerships | P1 | Adapter mutual recognition, documentation cross-links, joint content | Partner-driven activation |
| Content creators | P1 | Tutorials, videos, comparison reviews | Attributed traffic |
| Enterprise sales | P2 | Security review material, SSO/audit demos | Opportunities, ACV, cycle time |

### 7.4 Release cadence

| Stage | Timeline (hypothesis) | Actions | Success criteria |
| --- | --- | --- | --- |
| Pre-launch | 0–3 months | 15–20 interviews, 10 design partners, threat modeling, legal review, waitlist | ≥5 beta commitments; problem validation |
| Public beta | 3–9 months | Desktop MVP (macOS first, Windows next), free beta, template repositories, documentation | 100 activated users; W4 retention ≥30% |
| Team beta | 9–18 months | RBAC, approval, audit export, policy packs, billing; 10 paying teams | $10k MRR; NPS ≥30 |
| Enterprise | 18–30 months | SSO/SCIM, secret manager, compliance reports, offline license | 3 enterprise customers; $300k ARR |

Timelines and targets are all `[ASSUMPTION]` and must be adjusted to team size and funding.

### 7.5 Pricing validation plan

1. **20 user interviews:** current tool stack, configuration maintenance time, incident history, team budget, procurement process.
2. **Van Westendorp four questions:** too cheap / cheap / expensive / too expensive, asked separately for Pro, Team, and Enterprise.
3. **Fake-door test:** put three price tiers on documentation and waitlist pages; observe clicks and lead capture.
4. **Design-partner LOIs:** trade a 6-month discount for written intent and case-study permission.
5. **A/B packaging:** Team per seat vs. team bundle; 15–20% annual discount.
6. **Enterprise interviews:** rank priorities for security questionnaires, SSO, audit export, and secret integration.

---

## 8. Cost structure and operations

### 8.1 Cost drivers

| Cost item | Driver | Scaling behavior | Mitigation |
| --- | --- | --- | --- |
| R&D | Four asset types, desktop, Git, adapters | Fixed early, grows with target count later | Data-driven registry, reuse of the compilation layer |
| Adapter maintenance | Agent tool updates, path/format changes | Grows linearly with the number of supported tools | Tiered support, consistency tests, community contributions, deprecation policy |
| Support | Local path/permission/OS differences, enterprise onboarding | Grows with users and customers | Documentation, diagnostic tools, tiered SLAs |
| Security/legal | Penetration testing, compliance, terms, insurance | Fixed + event-driven | Threat modeling, least privilege, audit |
| GTM | Content, community, DevRel, conferences | Adjustable | Content and PLG first; enterprise sales later |
| Infrastructure | Licensing, updates, optional cloud backup | Very low (local-first) | Keep no mandatory backend |
| Payments/channels | Subscription payments, app stores | Grows with revenue | Direct download first, minimizing store fees |

**Key operational insight:** local-first makes infrastructure cost close to zero, but **adapter maintenance and security support are the real cost centers**. The more tools supported, the larger the maintenance matrix; commercially, support tiers must be chosen, and unlimited tools and formats must not be promised.

### 8.2 Economies and diseconomies of scale in adapter maintenance

- **Economies of scale:** the target registry is data-driven; adding a tool is mainly configuration + compilation tests, so marginal R&D cost is manageable. [FACT: design principle §6.2.1]
- **Diseconomies of scale:** each tool has different paths, frontmatter, merge order, and priority semantics; tool upgrades break compatibility. The prototype already covers 6 project targets, 8 global targets, and 8 Skill platforms — already a substantial maintenance surface. [FACT]
- **Mitigation strategies:**
  1. Support tiers (Tier 1 officially verified / Tier 2 community verified / Tier 3 experimental);
  2. Contract tests and fixtures for every target;
  3. Community adapter contributions and certification;
  4. A clear deprecation and migration policy;
  5. Enterprise promises only Tier 1 targets.

### 8.3 Example cost structure (illustrative only)

Assuming a 5-person small team, annual costs (`[ASSUMPTION]`; regional differences are large):

| Item | Annual cost |
| --- | --- |
| 3 engineers | $450k |
| Design / product | $150k |
| DevRel / support | $100k |
| Security / legal | $60k |
| GTM / content | $100k |
| Infrastructure / tools | $30k |
| **Total** | **~$890k** |

At an 85% gross margin, break-even ARR is about **$1.05M**; at $15/seat/month, that requires about **5,800 paying seats**; at a $30k enterprise ACV, about **35 enterprise customers** (or a mix). This shows that **individual Pro subscriptions alone can hardly support a full-time team; Team and Enterprise are mandatory.**

---

## 9. Metrics system

### 9.1 North-star metric

**Primary metric: Weekly Successful Deliveries (WSD)** — the number of successful dispatch/projection operations per week, deduplicated by "asset × target tool," counting only real writes confirmed by the user, excluding previews, retries, and simulations.

Why not something else:

- Installs/downloads: only show curiosity, not value.
- Edit volume: users may just be organizing, not delivering.
- Asset count: encourages hoarding, not usage.
- WSD directly corresponds to "whether assets reach the Agent" and is the core measure of cross-tool value.

**Supporting metric:** Weekly Active Managed Assets (WAMA) — the number of unique assets edited, synced, or dispatched at least once per week, used to observe asset depth.

### 9.2 Metric tree

| Layer | Metric | Definition / target (hypothesis) |
| --- | --- | --- |
| Acquisition | Downloads / installs | Channel attribution; 1,000+ during beta |
| Activation | Completes first real dispatch/projection within 7 days, with ≥3 assets in the library | ≥40% |
| Activation | Connects a repository or creates a shared repository | ≥30% |
| Retention | W4 workspace retention (≥1 WSD per week) | ≥30% |
| Retention | WSD per active workspace per week | ≥3 |
| Monetization | Free → Pro | ≥3% |
| Monetization | Team created → Team paying | ≥5% (within 6 months) |
| Expansion | Average seats per team | 6–10 |
| Expansion | NRR (net revenue retention) | ≥110% |
| Trust | Correct replacement rate after secret interception | ≥90% |
| Trust | Silent overwrite / data-loss incidents | 0 (hard requirement) |
| Quality | Sync success rate | ≥99% |
| Quality | Crash-free sessions | ≥99.5% |
| Efficiency | Time to first value (install → first WSD) | <24 hours |

All targets above are `[ASSUMPTION]` and should be adjusted to actual baselines after beta.

### 9.3 Measurement approach under local-first

Local-first means asset content cannot be collected by default. Recommendations:

1. **Anonymous telemetry that is off by default and explicitly opt-in:** report only event type, asset type, target type, success/failure, OS, and version; never titles, bodies, paths, secrets, or repository names.
2. **Local metrics panel:** let users see their own dispatch counts, drift counts, and interception counts as a trust feature.
3. **Design-partner data:** obtain qualitative data through interviews and voluntary exports.
4. **Licensing service for paying customers:** only license validation and seat counting, never reading asset content.
5. **Privacy policy and security whitepaper:** define the "no content collection" boundary explicitly and make it a selling point rather than a compliance burden.

### 9.4 Anti-metrics (not for bragging)

- Dispatch counts can be inflated by repeated retries → must be deduplicated and distinguish real writes.
- Asset counts can be inflated by imports → do not use as the north star.
- GitHub stars are not retention → only an acquisition metric.
- "Number of supported tools" is not quality → must be read together with Tier 1 adapter success rates.

---

## 10. Risks, assumptions, and responses

### 10.1 Risk matrix

| Risk | Likelihood | Impact | Response | Trigger signal |
| --- | --- | --- | --- | --- |
| Platform vendors natively absorb cross-tool management | Medium | High | Stay vendor-neutral; go deep on governance, audit, and security; partner with vendors rather than fight them | A vendor ships cross-tool sync/governance |
| Configuration standards converge (AGENTS.md unified) | Medium | Medium | Shift value toward versioning, audit, team governance, and asset quality | Major tools jointly adopt a single standard |
| Open-source clones / upstream competition | High | High | Brand, community, enterprise features, execution speed; clear license boundary | A fork/competitor with highly overlapping features appears |
| Upstream PromptHub license/derivative risk | Medium | High | Legal review before public release; attribution; collaborate if needed | Legal objection or takedown request |
| Security incident (secret leak, malicious Skill/MCP) | Medium | Very high | Local keychain, scanning, review gates, no auto-execution, backups, incident response, insurance | Any real leak or supply-chain event |
| Low willingness to pay among individuals | High | Medium | Free core + team/enterprise revenue; Pro sells only convenience | Pro conversion persistently <2% |
| Adapter maintenance costs out of control | Medium | High | Tiered support, contract tests, community contributions, deprecation policy | >20% of hours per month spent on adapter fixes |
| Local-first makes measurement difficult | High | Medium | Opt-in telemetry, local panel, design partners, licensing service | Cannot determine retention and conversion |
| Desktop distribution/signing/updating complexity | Medium | Medium | Code signing, notarization, auto-update, enterprise installer | Install failure rate >5% |
| Naming/trademark conflict | Low | Medium | Trademark search and registration; prepare a backup name | Search finds a similar trademark |
| Marketplace content liability | Medium (later) | High | Review, signing, takedown, author agreement, insurance | Complaints about malicious content |
| Key-person dependency | Medium | Medium | Documentation, open-source community, hiring, distributed code ownership | Core maintainer unavailable |

### 10.2 Key assumptions and validation

| # | Assumption | Validation method | Success criteria | Phase |
| --- | --- | --- | --- | --- |
| A1 | Multi-tool users consider configuration fragmentation a top-3 pain | 15–20 interviews | ≥50% of interviewees rank it top-3 | Phase 0 |
| A2 | Users are willing to let the tool write to Agent directories | Prototype usability test + beta behavior | ≥60% complete a first write | Phase 0–1 |
| A3 | Teams will pay for governance/audit | Design-partner LOIs + pricing test | ≥5 teams willing to pay per seat | Phase 0–2 |
| A4 | Git is an acceptable sharing mechanism | Beta repository connection rate | ≥30% of activated users connect a repository | Phase 1 |
| A5 | Cross-tool adaptation breadth matters more than single-tool depth | Feature ranking + usage data | Users use ≥2 targets | Phase 1 |
| A6 | Local secret handling does not significantly hurt UX | Security-flow usability test | ≥80% can complete templating | Phase 1 |
| A7 | Open source does not significantly cannibalize paid | Free/paid feature boundary test | Paid conversion ≥3% | Phase 2 |
| A8 | Enterprises have reachable procurement budget | Enterprise interviews + security review | 3 enterprises enter procurement | Phase 3 |
| A9 | Opt-in telemetry under local-first is sufficient for decisions | Data completeness assessment | Key-metric coverage ≥70% | Phase 1–2 |
| A10 | Desktop app covers mainstream OSes | Beta install/crash data | macOS/Windows crash-free ≥99.5% | Phase 1 |

### 10.3 Kill criteria / pivot options

| Condition | Interpretation | Action |
| --- | --- | --- |
| <30% of interviewees rank the pain top-3 | Problem not real or wrong segment | Narrow the ICP or pivot to team scenarios |
| Beta 7-day activation <20% | Onboarding barrier too high | Simplify onboarding; add templates; defer advanced features |
| W4 retention <20% and low WSD | Weak value | Pivot to asset quality/content, or focus on core team needs |
| Team paid conversion <5% within 6 months | Packaging/price/value mismatch | Redo pricing; try enterprise/services; or pure open source + sponsorship |
| Silent overwrite/data loss during beta | Trust unacceptable | Stop releases immediately, fix, and publish a postmortem |
| Upstream license or trademark blocked | Legal risk | Rename/rewrite affected parts/collaborate with upstream |
| Platform vendors offer 80% of the functionality for free | Value absorbed | Pivot to governance, audit, enterprise integration; or become a plugin |

---

## 11. Roadmap and resources

### 11.1 Phase roadmap

| Phase | Timeline (hypothesis) | Goal | Scope | Business question | Exit criteria |
| --- | --- | --- | --- | --- | --- |
| Phase 0: Validation | 0–3 months | Validate the problem and willingness | Interviews, design partners, threat modeling, legal review, pricing tests | Who hurts most? What will they pay for? | 5 beta commitments; problem top-3 |
| Phase 1: Desktop MVP | 3–9 months | Turn the prototype into a trustworthy tool | Electron + SQLite, real Git, file writes, keychain, backups, four asset types, Tier 1 adapters | Can users complete their first delivery safely? | 100 activated; W4 ≥30%; 0 data loss |
| Phase 2: Team beta | 9–18 months | Validate team payments | RBAC, approval, audit export, policy packs, shared templates, billing | Will teams pay for governance? | 10 paying teams; $10k MRR; NPS ≥30 |
| Phase 3: Enterprise | 18–30 months | Validate enterprise procurement | SSO/SCIM, secret manager, compliance reports, offline license, SLA | Will enterprises buy? | 3 enterprise customers; $300k ARR |
| Phase 4: Ecosystem | 30+ months | Expand network effects | Marketplace, more targets, CLI/CI, Linux, plugins | Can the ecosystem feed growth? | Growth on both supply and demand sides |

### 11.2 Core deliverables per phase

**Phase 0**

- 15–20 user interview records and persona calibration;
- List of 10 design partners and LOIs;
- Security threat model and data-flow diagrams;
- Legal opinion on upstream license and trademark;
- Fake-door test results for three price tiers.

**Phase 1**

- Desktop MVP with macOS first and Windows next;
- Real Git (clone / fetch / pull / push / conflicts);
- Local file writes with backup/rollback;
- OS keychain secret storage;
- Four asset types + Sync Center + project projection + global dispatch;
- At least 3 of the 8 global targets Tier 1 verified;
- Auto-update, code signing, notarization;
- Privacy policy and telemetry opt-in.

**Phase 2**

- Team licensing and billing;
- Owner/Admin/Editor/Approver/Viewer roles;
- Approval flows (push, drift overwrite, policy publication);
- Audit export (CSV/JSON) and retention policy;
- Team policy packs and shared templates;
- Customer success and SLA.

**Phase 3**

- SSO (SAML/OIDC) and SCIM;
- Secret manager integration (e.g., Vault/1Password/Doppler, per customer needs);
- Compliance reports and a security questionnaire pack;
- Offline license / self-hosted licensing service;
- Dedicated enterprise support and training.

### 11.3 Resource requirements (hypothesis)

| Phase | Team | Key roles | Note |
| --- | --- | --- | --- |
| Phase 0 | 2–3 people | Founder/product, design (part-time), engineering (part-time) | Low-cost validation |
| Phase 1 | 4–5 people | 2–3 engineers, 1 designer, 1 product/founder, security advisor | Desktop and Git are the hard parts |
| Phase 2 | 6–7 people | +1 full-stack (billing/licensing), +1 DevRel/support | Team features and GTM |
| Phase 3 | 8–10 people | +enterprise sales/SE, +security compliance, customer success | Enterprise procurement cycle |

These are `[ASSUMPTION]`; if funding or revenue falls short, reduce the number of target tools and prioritize Tier 1 adapters.

---

## 12. Open items (TBD-BIZ)

| # | Item | Why it matters | Owner | Deadline phase |
| --- | --- | --- | --- | --- |
| 1 | Upstream PromptHub license and derivative compliance | May require takedown or rewrite | Founder + legal | Before public release |
| 2 | Open-source boundary and future license | Determines moat and community strategy | Founder + legal | Before public release |
| 3 | Target market and language (English-first / Chinese-first / dual market) | Affects GTM, content, and support | Founder | Phase 0 |
| 4 | Three-tier pricing and packaging | Core of the revenue model | Founder + design partners | Phase 0–1 |
| 5 | Team/Enterprise feature priority (RBAC/approval/SSO/secret manager) | Sets Phase 2–3 scope | Product | Phase 1 |
| 6 | Support matrix and Tier 1 tool list | Controls maintenance cost | Product + engineering | Phase 1 |
| 7 | Secret storage and security architecture | Enterprise procurement prerequisite | Engineering + security | Phase 1 |
| 8 | Telemetry and privacy policy | Affects trust and measurement | Product + legal | Phase 1 |
| 9 | Desktop distribution (direct download/store) and signing | Affects install rate and store fees | Engineering + business | Phase 1 |
| 10 | Brand/trademark search and registration | Avoids rename costs | Founder + legal | Phase 0 |
| 11 | Marketplace strategy and content liability | Key to the later ecosystem | Product + legal | Phase 3 |
| 12 | AI test cost and data policy (BYO key / hosted) | Avoids uncontrollable costs and privacy risk | Product + engineering | Phase 1 |
| 13 | Packaging for multiple repositories/workspaces | Affects Pro/Team value | Product | Phase 1–2 |
| 14 | Migration strategy from PromptHub / other tools | Lowers switching cost | Product | Phase 1 |

---

## Appendix A: Interaction flow → business capability → commercial value mapping

| Interaction flow | Product mechanism | Business capability | Commercial value | Evidence |
| --- | --- | --- | --- | --- |
| Folders as repository directories | Four asset types share the folder tree and repo path | Portable asset organization | Lowers lock-in, helps team sharing | §1.2 #17, §6.5.1 |
| Prompt variable form and copy | `{{var}}` parsing, form, clipboard | Individual productivity | Free-tier high-frequency hook | §6.1.3 |
| Platform Discovery | Search, preview, copy, save locally | Content acquisition | Ecosystem/content entry point | §6.1.1 |
| Version history and restore | Snapshot, diff, restore | Risk management | Foundation of team trust | §6.1.5 |
| Structured `.prompt.md` sync | frontmatter + System/User | Reviewable Git collaboration | Reason to pay for Team | §6.1.7 |
| Instruction contracts + target registry | 6 project targets, 8 global targets | Cross-tool rule governance | Core enterprise value | §6.2.1, §6.2.6 |
| Resolution preview | target × path → match chain/skip reason/byte budget | Explainability | Enterprise audit and trust | §6.2.3 |
| Projection drift | `synced/stale/drifted/missing` | Safe overwrite | Team/enterprise must-have | §6.2.4 |
| Global directory dispatch | multiple instructions × multiple tools, editable paths | On-machine fleet management | Enterprise scenario | §6.2.6 |
| Skill Store review + symlink/copy | three-step install, content review | Supply-chain security | Ecosystem trust | §6.3.2 |
| MCP redaction and templating | `[REDACTED]`, `${VAR}` | Secret isolation | Enterprise procurement threshold | §6.4.1 |
| Three-way merge and conflicts | remote/local/base, per-item resolution | Team collaboration | Core Team value | §6.5.4 |
| Dispatch matrix and drift | Skill/MCP × Agent | Operational visibility | Team/Enterprise | §6.5.5 |
| History and rollback | audit events, version rollback | Accountability and recovery | Enterprise compliance | §6.5.6 |
| Local-first, no backend | localStorage prototype → desktop + SQLite | Data sovereignty, low COGS | Trust and gross margin | §8.2 |

---

## Appendix B: Qualitative competitor capability comparison

| Dimension | Native per tool | Dotfiles / scripts | PromptHub-type | MCP gateway / secret management | Prompt Keeper target |
| --- | --- | --- | --- | --- | --- |
| Asset semantics (4 types) | ○ | ○ | ◐ | ○ | ● |
| Versioning and rollback | ◐ | ◐ | ● | ○ | ● |
| Git three-way collaboration | ○ | ◐ | ◐ | ○ | ● |
| Cross-tool dispatch | ○ | ○ | ◐ | ○ | ● |
| Instruction resolution preview | ○ | ○ | ○ | ○ | ● |
| Drift and audit | ○ | ○ | ○ | ◐ | ● (strengthened in Enterprise) |
| Secret isolation | ○ | ○ | ◐ | ● | ● |
| Local-first | ● | ● | ● | ◐ | ● |
| Team governance | ○ | ○ | ○ | ◐ | ◐ → ● (Phase 2–3) |
| Ecosystem content | ○ | ○ | ◐ | ○ | ◐ (later) |

Legend: ● Strong; ◐ Partial; ○ Weak/missing. Qualitative judgment that requires calibration against hands-on competitor testing `[ASSUMPTION]`.

---

## Appendix C: Pricing-validation interview outline

**User's current state**

1. Which AI coding tools do you use now? How do you manage Prompts / rules / Skills / MCP for each?
2. The last time you changed machines or tools, how long did it take to restore your configuration?
3. Have you had inconsistent rules, configuration drift, secret leaks, or accidental overwrites? What was the cost?
4. Who on the team owns this configuration? How do new hires get set up?

**Value and alternatives**

5. If a tool could manage everything in one place and review each item before writing, which three capabilities would you want most?
6. Would you let it write directly to directories such as `~/.claude` and `~/.codex`? Under what conditions?
7. Do you trust a local tool or a cloud service more? Why?

**Payment**

8. For the individual edition, how do $6 / $10 / $15 per month feel? Which is too expensive?
9. For the team edition, at $10 / $15 / $20 per seat per month, what are your budget and decision process?
10. Which capabilities would an enterprise edition need to enter procurement? What is the priority of SSO, audit, secret manager, and offline license?
11. If the free edition already covers 80%, what would you still pay for?

**Decision**

12. Who approves the purchase? How long does it take? What security/legal material is required?
13. Would you be willing to become a design partner and provide a case study?

---

## Appendix D: Glossary

| Term | Meaning |
| --- | --- |
| Agent Instructions | Persistent Agent instructions such as `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` |
| Contract | A canonical instruction contract compiled to multiple target formats |
| Projection | The process and record of writing a contract into a project-level target file |
| Global Dispatch | Writing instructions into a user-level global directory (e.g., `~/.claude/CLAUDE.md`) |
| Dispatch | Writing Skills / MCP into an Agent's default directory |
| Drift | A target file was hand-modified and differs from the source |
| Managed Block | A managed region marked with `<!-- pk:begin/end -->` in a single-file target |
| Three-way Merge | A merge based on remote / local / base |
| Tier 1 Target | An officially verified target tool with a support commitment |
| WSD | Weekly Successful Deliveries, the number of successful dispatches/projections per week |
| PLG | Product-Led Growth |
| Open-core | A free open-source core plus paid commercial features/services |

---

## Appendix E: Reference and evidence index

| Topic | Location |
| --- | --- |
| Product positioning and design goals | `docs/interaction-design.md` §1.1–1.2 |
| Sync domain design decisions | `docs/interaction-design.md` §1.4 |
| v0.5 gaps and fixes | `docs/interaction-design.md` §1.5 |
| User scenarios S1–S17 | `docs/interaction-design.md` §2 |
| Feature extraction summary | `docs/interaction-design.md` §3 |
| Information architecture | `docs/interaction-design.md` §4 |
| Global layout and visual design | `docs/interaction-design.md` §5 |
| Prompt interactions | `docs/interaction-design.md` §6.1 |
| Agent Instructions interactions | `docs/interaction-design.md` §6.2 |
| Skill / MCP interactions | `docs/interaction-design.md` §6.3–6.4 |
| Sync workspace | `docs/interaction-design.md` §6.5 |
| Automatic sync and security boundaries | `docs/interaction-design.md` §6.5.7 |
| Prototype scope and differences | `docs/interaction-design.md` §8 |
| Acceptance checklist | `docs/interaction-design.md` §8.3 |
| Backlog | `docs/interaction-design.md` §9 |
| Repository directory structure | `README.md` "Repository directory structure" |
| High-fidelity acceptance | `design/prototype/README.md` |
| Version and license | `package.json`, `LICENSE` |

---

**End of document.** All commercial figures in this document are hypotheses and must be replaced in Phase 0–2 with interviews, LOIs, beta behavior, and pricing experiments. Recommended next step: complete the A1–A3 validation in §10.2 before deciding whether to invest in the desktop MVP.
