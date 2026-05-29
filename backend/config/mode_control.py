# backend/config/mode_control.py
"""
Trading mode is resolved exclusively by ``backend.config.runtime.get_runtime_config()``
which reads ``TRADING_MODE`` from the environment or ``config.yaml``.

The legacy ``ModeControl`` class that previously lived here was dead code and has
been removed.  All runtime mode checks should reference ``RuntimeConfig.trading_mode``.
"""
