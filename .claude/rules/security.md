---
description: Security checklist — run before marking any task complete
---

# Security Checklist

Run before marking any task complete:
- [ ] All user inputs validated before use
- [ ] No credentials, API keys, or secrets in code or strings
- [ ] API calls use HTTPS
- [ ] Error messages do not expose internal details
- [ ] No `eval()` or dynamic code execution
- [ ] No debug statements left in code
- [ ] Authentication checks on protected routes
