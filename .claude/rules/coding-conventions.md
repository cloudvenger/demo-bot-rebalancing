---
description: Coding conventions — applies to all source files in this project
---

# Coding Conventions

- Write small, focused functions — one responsibility per function
- No magic numbers or hardcoded strings; use named constants
- Never commit secrets or `.env` files
- All new features require at least one test
- Prefer editing existing files over creating new ones
- Run lint and type-check before every commit
- Never leave debug statements in committed code (`console.log`, `debugger`, `print`, `dbg!`, `println!`)
