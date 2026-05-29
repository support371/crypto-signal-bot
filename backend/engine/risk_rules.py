"""
Risk rule engine for live trading.

Rules evaluate position size, portfolio exposure, daily loss, volatility,
leverage, and slippage before execution.
"""

import logging
from dataclasses import dataclass
from typing import List

from backend.models.risk import RiskContext

logger = logging.getLogger("risk_rules")


@dataclass
class RuleResult:
    """Result from a single risk rule evaluation."""
    rule_name: str
    passed: bool
    reason: str
    size_multiplier: float = 1.0


class RiskRule:
    """Base class for risk rules."""

    def __init__(self, name: str):
        self.name = name

    def evaluate(self, ctx: RiskContext) -> RuleResult:
        raise NotImplementedError


class MaxPositionRule(RiskRule):
    """Reject if the new symbol position exceeds a percentage of account equity."""

    def __init__(self, max_position_pct: float = 0.05):
        super().__init__("MaxPosition")
        self.max_position_pct = max_position_pct

    def evaluate(self, ctx: RiskContext) -> RuleResult:
        if ctx.account_balance <= 0:
            return RuleResult(self.name, False, "Account balance is zero or negative")

        order_value = ctx.quantity * (ctx.price or 0)

        # SELL reduces position; only BUY increases it
        if ctx.side == "SELL":
            return RuleResult(self.name, True, "SELL reduces position — always allowed")

        position_after = ctx.current_position_value + order_value
        position_pct = position_after / ctx.account_balance

        if position_pct > self.max_position_pct:
            return RuleResult(
                self.name,
                False,
                f"Position would be {position_pct:.1%} of account (max {self.max_position_pct:.1%})",
            )

        if position_pct > self.max_position_pct * 0.8:
            multiplier = 1.0 - (position_pct - self.max_position_pct * 0.8) / (
                self.max_position_pct * 0.2
            )
            return RuleResult(
                self.name,
                True,
                f"Position at {position_pct:.1%}, reducing size",
                size_multiplier=max(multiplier, 0.3),
            )

        return RuleResult(self.name, True, "Position size within limits")


class PortfolioExposureRule(RiskRule):
    """Reject if total portfolio exposure would exceed a configured cap."""

    def __init__(self, max_total_exposure_pct: float = 1.0):
        super().__init__("PortfolioExposure")
        self.max_total_exposure_pct = max_total_exposure_pct

    def evaluate(self, ctx: RiskContext) -> RuleResult:
        if ctx.account_balance <= 0:
            return RuleResult(self.name, False, "Account balance is zero or negative")

        order_value = ctx.quantity * (ctx.price or 0)
        exposure_before = max(ctx.current_total_exposure, ctx.current_position_value)

        # SELL reduces exposure; only BUY increases it
        if ctx.side == "SELL":
            return RuleResult(self.name, True, "SELL reduces exposure — always allowed")

        exposure_after = exposure_before + order_value
        exposure_pct = exposure_after / ctx.account_balance

        if exposure_pct > self.max_total_exposure_pct:
            return RuleResult(
                self.name,
                False,
                f"Portfolio exposure would be {exposure_pct:.1%} of account "
                f"(max {self.max_total_exposure_pct:.1%})",
            )

        if exposure_pct > self.max_total_exposure_pct * 0.85:
            remaining = self.max_total_exposure_pct - exposure_pct
            buffer = self.max_total_exposure_pct * 0.15
            multiplier = remaining / buffer if buffer > 0 else 0.0
            return RuleResult(
                self.name,
                True,
                f"Portfolio exposure at {exposure_pct:.1%}, reducing size",
                size_multiplier=max(min(multiplier, 1.0), 0.25),
            )

        return RuleResult(self.name, True, "Portfolio exposure within limits")


class MaxDailyLossRule(RiskRule):
    """Reject if daily realized/unrealized loss exceeds threshold."""

    def __init__(self, max_daily_loss_pct: float = 0.03):
        super().__init__("MaxDailyLoss")
        self.max_daily_loss_pct = max_daily_loss_pct

    def evaluate(self, ctx: RiskContext) -> RuleResult:
        if ctx.account_balance <= 0:
            return RuleResult(self.name, False, "Account balance is zero or negative")

        daily_loss_pct = abs(min(ctx.daily_pnl, 0)) / ctx.account_balance

        if daily_loss_pct >= self.max_daily_loss_pct:
            return RuleResult(
                self.name,
                False,
                f"Daily loss {daily_loss_pct:.1%} exceeds max {self.max_daily_loss_pct:.1%}",
            )

        if daily_loss_pct >= self.max_daily_loss_pct * 0.7:
            remaining = self.max_daily_loss_pct - daily_loss_pct
            multiplier = remaining / (self.max_daily_loss_pct * 0.3)
            return RuleResult(
                self.name,
                True,
                f"Daily loss at {daily_loss_pct:.1%}, reducing size",
                size_multiplier=max(multiplier, 0.2),
            )

        return RuleResult(self.name, True, "Daily loss within limits")


class VolatilityRule(RiskRule):
    """Reject or reduce size when 24h volatility is elevated."""

    def __init__(self, volatility_threshold: float = 0.08):
        super().__init__("Volatility")
        self.volatility_threshold = volatility_threshold

    def evaluate(self, ctx: RiskContext) -> RuleResult:
        vol = ctx.volatility_24h

        if vol >= self.volatility_threshold:
            return RuleResult(
                self.name,
                False,
                f"24h volatility {vol:.1%} exceeds threshold {self.volatility_threshold:.1%}",
            )

        if vol >= self.volatility_threshold * 0.6:
            ratio = vol / self.volatility_threshold
            multiplier = 1.0 - (ratio - 0.6) / 0.4 * 0.7
            return RuleResult(
                self.name,
                True,
                f"Elevated volatility {vol:.1%}, reducing size",
                size_multiplier=max(multiplier, 0.3),
            )

        return RuleResult(self.name, True, f"Volatility {vol:.1%} within normal range")


class LeverageRule(RiskRule):
    """Reject if effective leverage exceeds limit."""

    def __init__(self, max_leverage: float = 1.0):
        super().__init__("Leverage")
        self.max_leverage = max_leverage

    def evaluate(self, ctx: RiskContext) -> RuleResult:
        if ctx.account_balance <= 0:
            return RuleResult(self.name, False, "Account balance is zero or negative")

        order_value = ctx.quantity * (ctx.price or 0)
        base_exposure = max(ctx.current_total_exposure, ctx.current_position_value)

        # SELL reduces leverage; only BUY increases it
        if ctx.side == "SELL":
            return RuleResult(self.name, True, "SELL reduces leverage — always allowed")

        total_exposure = base_exposure + order_value
        effective_leverage = total_exposure / ctx.account_balance

        if effective_leverage > self.max_leverage:
            return RuleResult(
                self.name,
                False,
                f"Effective leverage {effective_leverage:.2f}x exceeds max {self.max_leverage:.2f}x",
            )

        return RuleResult(
            self.name,
            True,
            f"Leverage {effective_leverage:.2f}x within {self.max_leverage:.2f}x limit",
        )


class SlippageRule(RiskRule):
    """Estimate slippage from order size relative to account balance."""

    def __init__(self, max_slippage_pct: float = 0.005):
        super().__init__("Slippage")
        self.max_slippage_pct = max_slippage_pct

    def evaluate(self, ctx: RiskContext) -> RuleResult:
        if not ctx.price or ctx.price <= 0:
            return RuleResult(self.name, True, "No price data, skipping slippage check")

        order_value = ctx.quantity * ctx.price
        if ctx.account_balance > 0:
            estimated_slippage = order_value / (ctx.account_balance * 10)
        else:
            estimated_slippage = 0.01

        if estimated_slippage > self.max_slippage_pct:
            return RuleResult(
                self.name,
                False,
                f"Estimated slippage {estimated_slippage:.3%} exceeds max {self.max_slippage_pct:.3%}",
            )

        return RuleResult(
            self.name,
            True,
            f"Estimated slippage {estimated_slippage:.3%} within tolerance",
        )


class RiskRuleEngine:
    """Aggregates risk rules and produces a combined decision."""

    def __init__(
        self,
        max_position_pct: float = 0.05,
        max_daily_loss_pct: float = 0.03,
        volatility_threshold: float = 0.08,
        max_leverage: float = 1.0,
        max_slippage_pct: float = 0.005,
        max_total_exposure_pct: float = 1.0,
    ):
        self.rules: List[RiskRule] = [
            MaxPositionRule(max_position_pct),
            PortfolioExposureRule(max_total_exposure_pct),
            MaxDailyLossRule(max_daily_loss_pct),
            VolatilityRule(volatility_threshold),
            LeverageRule(max_leverage),
            SlippageRule(max_slippage_pct),
        ]

    def evaluate(self, ctx: RiskContext) -> "RiskEngineResult":
        results: List[RuleResult] = []
        approved = True
        combined_multiplier = 1.0
        rejection_reasons: List[str] = []

        for rule in self.rules:
            result = rule.evaluate(ctx)
            results.append(result)

            if not result.passed:
                approved = False
                rejection_reasons.append(f"[{result.rule_name}] {result.reason}")
                logger.warning("Risk rule FAILED: %s — %s", result.rule_name, result.reason)
            else:
                combined_multiplier *= result.size_multiplier

        if approved:
            reason = "All risk rules passed"
            if combined_multiplier < 1.0:
                reason += f" (size reduced to {combined_multiplier:.0%})"
        else:
            reason = "; ".join(rejection_reasons)

        return RiskEngineResult(
            approved=approved,
            reason=reason,
            size_multiplier=combined_multiplier if approved else 0.0,
            rule_results=results,
        )


@dataclass
class RiskEngineResult:
    """Aggregated result from the risk engine."""
    approved: bool
    reason: str
    size_multiplier: float
    rule_results: List[RuleResult]

    def to_dict(self):
        return {
            "approved": self.approved,
            "reason": self.reason,
            "size_multiplier": self.size_multiplier,
            "rules": [
                {
                    "name": r.rule_name,
                    "passed": r.passed,
                    "reason": r.reason,
                    "size_multiplier": r.size_multiplier,
                }
                for r in self.rule_results
            ],
        }
