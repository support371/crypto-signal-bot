"""
Withdrawal Manager for live and paper trading.

Handles:
- Paper withdrawals (deduct from in-memory portfolio)
- Live withdrawals via exchange client API
- Address whitelisting for safety
- Withdrawal limits and cooldowns
"""

import time
import logging
from typing import Any, Dict, List, Optional

from backend.exchanges.base_client import BaseExchangeClient
from backend.logic.paper_trading import PaperPortfolio
from backend.logic.audit_store import append_withdrawal

logger = logging.getLogger("withdrawal_manager")


class WithdrawalManager:
    """
    Manages withdrawals for both paper and live trading modes.

    Safety features:
    - Address whitelist: only pre-approved addresses can receive funds
    - Daily withdrawal limit: caps total daily withdrawal amount
    - Cooldown period: minimum time between withdrawals
    """

    def __init__(
        self,
        paper_portfolio: PaperPortfolio,
        exchange_client: Optional[BaseExchangeClient] = None,
        trading_mode: str = "paper",
        daily_limit_usdt: float = 10000.0,
        cooldown_seconds: float = 60.0,
        whitelisted_addresses: Optional[List[str]] = None,
    ):
        self.paper_portfolio = paper_portfolio
        self.exchange_client = exchange_client
        self.trading_mode = trading_mode
        self.daily_limit_usdt = daily_limit_usdt
        self.cooldown_seconds = cooldown_seconds
        self.whitelisted_addresses = set(whitelisted_addresses or [])

        # Track withdrawals for limits
        self._daily_total = 0.0
        self._daily_reset_ts = time.time()
        self._last_withdrawal_ts = 0.0
        self._withdrawal_history: List[Dict[str, Any]] = []

    def add_whitelisted_address(self, address: str):
        """Add an address to the whitelist."""
        self.whitelisted_addresses.add(address)
        logger.info("Address whitelisted: %s...%s", address[:8], address[-6:])

    def remove_whitelisted_address(self, address: str):
        """Remove an address from the whitelist."""
        self.whitelisted_addresses.discard(address)

    def _check_daily_limit(self, amount: float) -> bool:
        """Check if withdrawal would exceed daily limit."""
        # Reset daily counter if new day
        now = time.time()
        if now - self._daily_reset_ts > 86400:
            self._daily_total = 0.0
            self._daily_reset_ts = now

        return (self._daily_total + amount) <= self.daily_limit_usdt

    def _check_cooldown(self) -> bool:
        """Check if enough time has passed since last withdrawal."""
        return (time.time() - self._last_withdrawal_ts) >= self.cooldown_seconds

    def withdraw(
        self,
        asset: str,
        amount: float,
        address: str,
        chain: str = "",
    ) -> Dict[str, Any]:
        """
        Process a withdrawal request.

        Args:
            asset: Asset to withdraw (e.g., "USDT")
            amount: Amount to withdraw
            address: Destination wallet address
            chain: Blockchain network (e.g., "TRC20", "ERC20")

        Returns:
            Withdrawal result dict

        Raises:
            WithdrawalError: If validation fails
        """
        # Validate address whitelist (skip for paper-wallet)
        if address != "paper-wallet" and self.whitelisted_addresses:
            if address not in self.whitelisted_addresses:
                raise WithdrawalError(
                    f"Address not whitelisted: {address[:8]}...{address[-6:]}",
                    "ADDRESS_NOT_WHITELISTED",
                )

        # Validate cooldown
        if not self._check_cooldown():
            remaining = self.cooldown_seconds - (time.time() - self._last_withdrawal_ts)
            raise WithdrawalError(
                f"Withdrawal cooldown: {remaining:.0f}s remaining",
                "COOLDOWN",
            )

        # Validate daily limit
        if not self._check_daily_limit(amount):
            remaining = self.daily_limit_usdt - self._daily_total
            raise WithdrawalError(
                f"Daily withdrawal limit reached. Remaining: {remaining:.2f} USDT",
                "DAILY_LIMIT",
            )

        # Route to appropriate handler
        if self.trading_mode == "live" and self.exchange_client and address != "paper-wallet":
            result = self._withdraw_live(asset, amount, address, chain)
        else:
            result = self._withdraw_paper(asset, amount, address)

        # Update tracking
        self._daily_total += amount
        self._last_withdrawal_ts = time.time()
        self._withdrawal_history.append(result)

        # Persist to audit trail
        append_withdrawal(result)

        return result

    def _withdraw_paper(self, asset: str, amount: float, address: str) -> Dict[str, Any]:
        """Process paper withdrawal."""
        balance = self.paper_portfolio.get_balance(asset)
        if balance < amount:
            raise WithdrawalError(
                f"Insufficient {asset} balance: {balance:.2f} < {amount:.2f}",
                "INSUFFICIENT_BALANCE",
            )

        self.paper_portfolio.balances[asset] = balance - amount

        logger.info("Paper withdrawal: %s %s to %s", amount, asset, address)

        return {
            "withdrawal_id": f"paper-{int(time.time()*1000)}",
            "asset": asset,
            "amount": amount,
            "address": address,
            "status": "COMPLETED",
            "mode": "paper",
            "timestamp": time.time(),
        }

    def _withdraw_live(
        self, asset: str, amount: float, address: str, chain: str
    ) -> Dict[str, Any]:
        """Process live withdrawal via exchange API."""
        # Verify balance on exchange first
        try:
            balances = self.exchange_client.get_balance()
            available = balances.get(asset.upper(), 0.0)
            if available < amount:
                raise WithdrawalError(
                    f"Insufficient {asset} on exchange: {available:.2f} < {amount:.2f}",
                    "INSUFFICIENT_BALANCE",
                )
        except WithdrawalError:
            raise
        except Exception as e:
            raise WithdrawalError(f"Failed to check balance: {e}", "BALANCE_CHECK_FAILED")

        # Execute withdrawal
        try:
            result = self.exchange_client.withdraw(
                asset=asset,
                amount=amount,
                address=address,
                chain=chain,
            )
            result["mode"] = "live"

            logger.info(
                "Live withdrawal initiated: %s %s to %s via %s (id: %s)",
                amount, asset, address[:12] + "...", self.exchange_client.name,
                result.get("withdrawal_id"),
            )

            return result

        except Exception as e:
            logger.error("Withdrawal failed: %s", e)
            raise WithdrawalError(f"Exchange withdrawal failed: {e}", "EXCHANGE_ERROR")

    def get_withdrawal_history(self) -> List[Dict[str, Any]]:
        """Get withdrawal history for current session."""
        return self._withdrawal_history

    def get_daily_remaining(self) -> float:
        """Get remaining daily withdrawal allowance."""
        now = time.time()
        if now - self._daily_reset_ts > 86400:
            return self.daily_limit_usdt
        return max(0, self.daily_limit_usdt - self._daily_total)


class WithdrawalError(Exception):
    """Withdrawal validation or execution error."""
    def __init__(self, message: str, code: str = "UNKNOWN"):
        super().__init__(message)
        self.code = code
