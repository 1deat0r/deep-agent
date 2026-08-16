---
name: project-stats
description: Python-backed skill: workspace statistics. Compute file counts by extension, lines of code, and the largest files in the workspace.
python-package: project_stats
---

# Project Stats

A Python-backed skill. Import the package and call its functions:

```python
import project_stats

project_stats.file_counts()          # {"py": 12, "md": 5, ...}
project_stats.lines_of_code(".py")   # total lines across matching files
project_stats.largest_files(5)       # [(path, bytes), ...] biggest files
```

All functions scan the current working directory (the session workspace).
