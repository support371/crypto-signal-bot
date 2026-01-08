"""
Reconciliation engine to check for state drift between the OMS and the execution venue.
"""
from backend.oms.manager import OrderManagementSystem
from backend.execution.gateway import ExecutionGateway
from backend.governance.gates import Governance

class ReconciliationEngine:
    def __init__(self, oms: OrderManagementSystem, gateway: ExecutionGateway, governance: Governance):
        self._oms = oms
        self._gateway = gateway
        self._governance = governance
        self._mismatch_counter = 0
        self._DRIFT_TOLERANCE_CYCLES = 3 # Number of consecutive cycles a mismatch must persist

    def run_check(self):
        """
        Compares the state of open orders in the OMS with the state from the gateway.
        If a mismatch persists for several cycles, it triggers a governance freeze.
        """
        try:
            oms_open_orders = {o.client_order_id for o in self._oms.get_open_orders()}
            gateway_open_orders = {o.client_order_id for o in self._gateway.get_open_orders()}

            if oms_open_orders != gateway_open_orders:
                self._mismatch_counter += 1
                print(f"RECON WARNING: Mismatch detected. Cycle {self._mismatch_counter}/{self._DRIFT_TOLERANCE_CYCLES}")
                print(f"  - OMS open orders: {oms_open_orders}")
                print(f"  - Gateway open orders: {gateway_open_orders}")

                if self._mismatch_counter >= self._DRIFT_TOLERANCE_CYCLES:
                    print("RECON ERROR: Persistent state drift detected. Freezing trading.")
                    self._governance.set_freeze_mode(True, "Persistent state drift detected by recon engine.")
                    # In a real system, you would also send an alert here.
            else:
                # If the state is consistent, reset the counter
                if self._mismatch_counter > 0:
                    print("RECON INFO: State is consistent again. Resetting mismatch counter.")
                self._mismatch_counter = 0

        except Exception as e:
            print(f"ERROR during reconciliation check: {e}")
            # Potentially freeze on error as a safety measure
            # self._governance.freeze()
