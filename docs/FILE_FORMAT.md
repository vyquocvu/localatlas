# File format (proposed, M3)

Documents are UTF-8 Markdown with optional YAML frontmatter. Do not require frontmatter for ordinary notes. Preserve unrecognized keys and text when making structured edits.

Example:

```markdown
---
id: SAV-024
type: task
status: todo
priority: high
milestone: MVP
---
# Implement comparison

- [ ] Implement logic
- [ ] Add tests
```

Document identity must survive rename/move; IDs are scoped to project. Managed docs are canonical, and a future index may be rebuilt by scanning files. Do not mirror source repository docs into managed storage silently.
