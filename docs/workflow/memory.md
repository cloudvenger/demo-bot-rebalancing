# Persistent Memory with MCP

By default, agents in Claude Code lose all context when a session ends. Every new session starts cold: agents re-read `CLAUDE.md`, `PLAN.md`, and `task.md` to re-establish context. For short features, this is acceptable. For longer projects (multiple sessions, multiple features, complex architectural decisions), this cold-start overhead compounds.

The MCP memory integration adds a **persistent, queryable memory layer** that survives session boundaries. Agents can write decisions, patterns, and discoveries to memory during a session, and recall them in future sessions without re-reading every file.

---

## When to use MCP memory

**Use it when:**
- A project spans more than 2–3 sessions
- Architectural decisions were made that future agents need to respect
- You have recurring patterns (e.g., "always use `cuid()` for IDs in this project", "the `users` table has a custom soft-delete pattern that differs from the default")
- A bug was discovered and fixed — future agents should know not to repeat the pattern that caused it

**Skip it when:**
- The project is a single feature or a few hours of work
- All necessary context fits cleanly in `PLAN.md` and `CLAUDE.md`

---

## Setup

### 1. Install the MCP memory server

The most common option is `@modelcontextprotocol/server-memory` (in-process, file-backed):

```bash
npm install -g @modelcontextprotocol/server-memory
```

Or use a custom SQLite-backed server if you want richer search:

```bash
npm install -g mcp-memory-sqlite
```

### 2. Register the MCP server in Claude Code

Add to your project's `~/.claude/claude_desktop_config.json` (or the project-level MCP config if your Claude Code version supports it):

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"],
      "env": {
        "MEMORY_FILE_PATH": ".claude/project-memory.json"
      }
    }
  }
}
```

> **Note:** Replace `.claude/project-memory.json` with any writable path. Using a project-relative path (`.claude/`) keeps memory scoped to this project and committed to git (if desired) or gitignored (if private).

### 3. Add `.claude/project-memory.json` to `.gitignore` (optional)

If your memory file contains session-specific content you don't want in version control:

```
# .gitignore
.claude/project-memory.json
```

If you want memory to be shared across team members (useful for architectural decisions), commit it.

### 4. Add memory tool permissions to `.claude/settings.json`

```json
{
  "permissions": {
    "allow": [
      "mcp__memory__store_memory(*)",
      "mcp__memory__retrieve_memory(*)",
      "mcp__memory__search_memory(*)"
    ]
  }
}
```

Restart Claude Code after changes to MCP config.

---

## Memory Contract: What Agents Write and When

Not everything should go into memory. Overfilled memory is as useless as no memory. Each agent has a specific contract for what it writes.

### Roles and triggers

| Agent | When to write memory | What to write |
|---|---|---|
| **Backend Agent** | After implementing a non-obvious architectural decision | Decision, rationale, and the files it affects. E.g.: "Used pull-payment pattern for `withdraw()` because [reason]. Affects: `contracts/Vault.sol`." |
| **Backend Agent** | After discovering a DB pattern deviation | "The `sessions` table uses hard-delete (not soft-delete) because of GDPR requirements. Do not apply soft-delete to this table." |
| **Frontend Agent** | After resolving a design ambiguity | "Paper node `node-047` (UserCard hover state) was missing. Implemented standard elevation shadow. Confirm with designer." |
| **QA Runner Agent** | After fixing a recurring test failure | Root cause + fix, so future agents don't repeat the bug. "Fixed: `TaskRepository.findByUserId` was missing `NULLS LAST` in ordering — always add when sorting nullable dates." |
| **Security Agent** | After finding a pattern to avoid | "Pattern: never use `req.query.id` directly in Prisma `where` — always parse as string and validate. Found in auth.controller.ts:44." |
| **Any agent** | After a phase exit gate passes | "Phase 4 exit gate passed on [date]. All 23 tasks complete. `/check` passing." |

### What NOT to write

- Transient state: "I am currently working on task B3" — this is session state, not persistent knowledge
- Information already in `PLAN.md` or `CLAUDE.md` — no duplication
- Raw file contents — use `Read` instead
- Speculation: only write confirmed facts

---

## Memory Key Conventions

Use dot-notation keys that are human-readable and searchable:

| Pattern | Example | Use for |
|---|---|---|
| `decision.<area>.<topic>` | `decision.backend.id-strategy` | Architectural decisions |
| `pattern.<area>.<topic>` | `pattern.backend.soft-delete` | Established patterns in the codebase |
| `bug.<area>.<topic>` | `bug.backend.task-ordering` | Fixed bugs — lessons learned |
| `ambiguity.<screen>.<element>` | `ambiguity.dashboard.hover-state` | Design ambiguities resolved |
| `phase.<number>.gate` | `phase.4.gate` | Phase exit gate status |
| `project.stack` | `project.stack` | Stack summary for quick agent onboarding |

---

## Agent Prompt Integration

When spawning an agent in a memory-enabled project, include a recall step in the On Start section. Update `.claude/agents/backend/SKILL.md` (and other agents) to add:

```markdown
## On start

1. Read `CLAUDE.md`
2. Read `backend/CLAUDE.md`
3. Read `PLAN.md`
4. **Recall project memory:** `mcp__memory__search_memory("backend decisions patterns")` — review any stored decisions or patterns before starting tasks
5. Review the task list provided in your prompt
```

And at the end of each agent's Report section, add:

```markdown
## Before reporting done

Store any new decisions or patterns discovered during this task:
- `mcp__memory__store_memory("decision.backend.<topic>", "<decision + rationale>")`
- Only write if the information is not already in PLAN.md or CLAUDE.md
```

---

## Memory-Powered Session Start

At the beginning of a new session on an existing project, the human can run:

```
Recall project memory and give me a 5-bullet summary of:
1. Current phase and exit gate status
2. Key architectural decisions
3. Any known patterns or constraints
4. Any open ambiguities or blockers
5. Last completed task
```

This replaces the "re-read everything" cold-start with a targeted recall, reducing context loading time.

---

## Example Memory Entries

After a completed build session on TodoFlow:

```json
{
  "project.stack": "Next.js 14 (App Router) + Hono + Prisma + PostgreSQL 16 + Tailwind v4 + React Query v5",

  "decision.backend.id-strategy": "Using cuid() for all entity IDs (User, Task). Reason: distributed-safe, Railway-compatible, no UUID extension needed.",

  "decision.backend.jwt-storage": "JWT stored in httpOnly cookie (not localStorage). Reason: SPEC.md requirement. Cookie name: 'auth_token', 7-day expiry.",

  "pattern.backend.soft-delete": "All Task records use soft-delete (deleted_at timestamp). Sessions table uses hard-delete for GDPR compliance — exception to the rule.",

  "pattern.backend.task-ordering": "Task list ordering: overdue first (due_date < now AND status = TODO), then due_date ASC NULLS LAST, then done tasks at bottom. Prisma: orderBy with raw SQL fragment — see task.repository.ts:34.",

  "bug.backend.task-ordering": "Bug: NULLS LAST was missing from ORDER BY due_date. Prisma's default NULL sorting placed undated tasks first. Fix: use Prisma.$queryRaw with explicit NULLS LAST. Committed in fix/task-ordering-nulls.",

  "ambiguity.dashboard.task-item-border": "Paper node-004 shows 1px solid border between tasks. Implemented with Tailwind divide-y (equivalent visual). Confirmed with designer: acceptable.",

  "phase.4.gate": "PASSED. 22/23 tasks complete. 1 E2E test pending CI stability. /check passing. Human approved 2026-03-12.",

  "phase.5.gate": "PASSED. 0 high security issues. 1 medium (CORS origin — deferred to deploy). 83% visual conformance (1 minor deviation). walkthrough.md generated."
}
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Agent cannot call `mcp__memory__*` tools | MCP server not registered or permissions not set | Check `~/.claude/claude_desktop_config.json` and `settings.json` allow list |
| Memory file not found | `MEMORY_FILE_PATH` directory doesn't exist | Create `.claude/` directory before first run |
| Memory search returns irrelevant results | Keys are too generic | Use dot-notation keys: `decision.backend.id-strategy` not `decisions` |
| Memory grows too large (> 50 entries) | Writing transient state or duplicating PLAN.md | Audit with `mcp__memory__search_memory("*")` and delete stale entries |
