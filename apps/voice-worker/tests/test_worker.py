"""Offline tests for the india_voice.worker module.

These tests do not start a LiveKit server, contact any provider, or require
credentials. They verify that the module is importable, its public interface
is correct, and bad configuration fails fast with a clean error.
"""
import inspect
import unittest
from unittest.mock import patch

from livekit.agents import Agent

import india_voice.worker as worker_mod
from india_voice.worker import IndiaVoiceAgent, entrypoint, main


class WorkerModuleTests(unittest.TestCase):
    def test_entrypoint_is_module_level_and_picklable(self):
        # A nested closure cannot be pickled, which breaks the SDK's default
        # process executor on Linux/macOS. entrypoint must be a plain module-level
        # coroutine function, not a closure returned by a factory.
        self.assertTrue(inspect.iscoroutinefunction(entrypoint))
        self.assertEqual(entrypoint.__module__, "india_voice.worker")
        # Verify it is reachable by dotted name from the module (pickle requirement).
        self.assertIs(getattr(worker_mod, entrypoint.__name__), entrypoint)

    def test_india_voice_agent_is_agent_subclass(self):
        self.assertTrue(issubclass(IndiaVoiceAgent, Agent))

    def test_main_exits_with_code_1_on_missing_configuration(self):
        # Patch Settings.from_env to raise ConfigurationError as it would when
        # required environment variables are absent.
        from india_voice.config import ConfigurationError
        with patch("india_voice.worker.Settings.from_env",
                   side_effect=ConfigurationError("Missing: LIVEKIT_URL, SARVAM_API_KEY")):
            with self.assertRaises(SystemExit) as ctx:
                main()
        self.assertEqual(ctx.exception.code, 1)

    def test_main_error_does_not_expose_credential_values(self):
        # ConfigurationError must list variable names only, never values.
        import io
        import logging

        from india_voice.config import ConfigurationError
        log_output = io.StringIO()
        handler = logging.StreamHandler(log_output)
        logging.getLogger("india_voice.worker").addHandler(handler)
        try:
            with patch("india_voice.worker.Settings.from_env",
                       side_effect=ConfigurationError("Missing: LLM_API_KEY")):
                with self.assertRaises(SystemExit):
                    main()
            logged = log_output.getvalue()
            self.assertIn("LLM_API_KEY", logged)
            # The error message contains a field name, not a value, so this is safe.
            # Ensure no 'secret' or 'key=' value patterns appear.
            self.assertNotIn("=", logged.split("LLM_API_KEY")[0])
        finally:
            logging.getLogger("india_voice.worker").removeHandler(handler)
