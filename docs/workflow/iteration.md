# Iteration & Re-entry

The 6-phase loop is not a one-shot pipeline. Real projects iterate — within phases and across them.

## Inter-phase re-entry (new features, post-launch)

After Phase 6 (Ship), the loop restarts for the next feature:

```
v1 shipped
  └─> New feature idea
        └─> Phase 1: append to SPEC.md (new user stories)
              └─> Phase 2: add new screens to designs/app.paper (Paper design)
                    └─> Phase 3: update PLAN.md (new endpoints, models)
                          └─> Phase 4–6: build, validate, ship
```

## How SPEC.md evolves over iterations

- **v1**: create `SPEC.md` from scratch
- **v2+**: append new user stories to the existing `SPEC.md`, do not overwrite
- Mark completed stories with `[x]` to track what has been shipped vs. what is new
- If the scope changes significantly (pivot), archive the old spec as `SPEC.v1.md` and start fresh

## How designs evolve

- New screens are added to the existing Paper design file
- Existing screens can be updated — use `mcp__paper__get_screenshot` to verify changes don't break other screens
- If a full redesign is needed, archive the old file as `designs/app.v1.paper`

## How PLAN.md evolves

- New data models and API endpoints are appended to the existing `PLAN.md`
- Stack decisions from v1 are preserved unless there is a strong reason to change
- If the plan diverges significantly, document the rationale in a "Changes from v1" section
