"""
Pytest configuration and shared fixtures for backend tests.

Ensures proper test isolation, random seed management, and environment setup.
"""
import os
import random
import pytest


@pytest.fixture(autouse=True)
def reset_random_seed():
    """Reset random seed before each test for deterministic output."""
    random.seed(42)
    yield


@pytest.fixture(autouse=True)
def clean_env():
    """Clean up environment variables between tests."""
    original_env = os.environ.copy()
    yield
    # Restore original environment
    os.environ.clear()
    os.environ.update(original_env)


def pytest_configure(config):
    """Configure pytest with custom markers and options."""
    config.addinivalue_line(
        "markers", "integration: mark test as an integration test"
    )
    config.addinivalue_line(
        "markers", "slow: mark test as slow (deselect with '-m \"not slow\"')"
    )


@pytest.fixture
def random_prices():
    """Fixture providing a function to generate random price series."""
    def _generate(n: int, start: float = 100.0, step: float = 1.0):
        return [start + i * step for i in range(n)]
    return _generate
