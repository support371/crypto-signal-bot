# Runbook

This document provides operational procedures for the Lovable AI Crypto Risk Agent.

## Emergency Procedures

### Emergency Freeze

**Condition:** A critical issue is detected (e.g., reconciliation mismatch, unexpected losses).

**Action:**
1.  **Engage Global Kill Switch:**
    *   This is the fastest way to halt all trading. Send a `POST` request to the `/governance/killswitch/global/on` endpoint (to be created).
2.  **Set Freeze Mode:**
    *   For a more persistent halt, send a `POST` request to `/governance/freeze/on` with a reason in the request body. This will prevent trading from resuming until manually cleared.

### Reconciliation Mismatch

**Condition:** The reconciliation job detects a persistent mismatch between the internal portfolio and the exchange.

**Action:**
1.  The system will automatically enter **FREEZE** mode.
2.  An `AUDIT_EVENT` with `event_type="RECON_MISMATCH"` will be logged.
3.  **DO NOT** manually resume trading until the mismatch has been investigated and resolved.

## Go-Live Checklist

1.  [ ] **Confirm `TRADING_ENABLED` is `false`:** The system must start in a safe state.
2.  [ ] **Verify Exchange API Credentials:** Ensure `BITGET_API_KEY` and `BITGET_API_SECRET` are correctly set in the environment.
3.  [ ] **Run All Unit Tests:** `pytest`
4.  [ ] **Run End-to-End Paper Trading Test:** Execute a full trading cycle in paper mode to ensure all components are working together.
5.  [ ] **Review Governance State:** Check the `/status` endpoint to confirm all kill switches are off and the system is not frozen.
6.  [ ] **Enable Live Trading:** Set `TRADING_ENABLED=true` in the environment and restart the backend service.
7.  [ ] **Monitor Audit Log:** Closely monitor the `/audit/recent` endpoint for the first few minutes of live operation.
