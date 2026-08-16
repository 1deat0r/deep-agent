"""Entry point: ``python3 -m deep_agent_runtime`` starts the kernel process."""

from .kernel import Kernel, main

__all__ = ["Kernel", "main"]

if __name__ == "__main__":
    main()
