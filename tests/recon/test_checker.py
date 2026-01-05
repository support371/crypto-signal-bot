"""
Unit tests for the Reconciliation Engine.
"""
import pytest
from unittest.mock import MagicMock
from backend.portfolio.manager import PortfolioManager
from backend.governance.gates import Governance
from backend.recon.checker import reconcile

def test_reconciliation_match():
    pm = PortfolioManager(10000, supabase_client=MagicMock())
    gov = Governance()
    venue_positions = {}

    assert reconcile(pm, gov, venue_positions) is True
    assert gov.is_frozen is False

def test_reconciliation_mismatch_triggers_freeze():
    pm = PortfolioManager(10000, supabase_client=MagicMock())
    gov = Governance()
    venue_positions = {"BTC/USDT": 0.1} # Mismatch

    assert reconcile(pm, gov, venue_positions) is False
    assert gov.is_frozen is True
