"""
5-Rule Risk Engine for live trading.

Individual rule classes that each evaluate a specific risk dimension:
1. MaxPositionRule   — Reject if position exceeds % of account
2. MaxDailyLossRule  — Reject if daily loss exceeds threshold
3. VolatilityRule    — Reject/reduce in high-volatility conditions
4. LeverageRule      — Reject if effective leverage exceeds limit
5. SlippageRule      — Reject if expected slippage exceeds tolerance

Each rule returns a RuleResult. The engine aggregates all results.
"""

import logging
from dataclasses import dataclass
from typing import List, Optional

from backend.models.risk import RiskContext

logger = logging.getLogger("risk_rules")


@dataclass
class RuleResult:
    """Result from a single risk rule evaluation."""
    rule_name: str
    passed: bool
    reason: str
    size_multiplier: float = 1.0  # 1.0 = no adjustment, <1.0 = reduce size


class RiskRule:
    """Base class for risk rules."""

    def __init__(self, name: str):
        self.name = name

    def evaluate(self, ctx: RiskContext) -> RuleResult:
        raise NotImplementedError


class MaxPositionRule(RiskRule):
    """
    Rule 1: Max position size as % of account balance.

    Rejects if the new position value would exceed max_position_pct of account.
    """

    def __init__(self, max_position_pct: float = 0.05):
        super().__init__("MaxPosition")
        self.max_position_pct = max_position_pct

    def evaluate(self, ctx: RiskContext) -> RuleResult:
        if ctx.account_balance <= 0:
            return RuleResult(self.name, False, "Account balance is zero or negative")

        order_value = ctx.quantity * (ctx.price or 0)
        position_after = ctx.current_position_value + order_value
        position_pct = position_after / ctx.account_balance

        if position_pct > self.max_position_pct:
            return RuleResult(
                self.name, False,
                f"Position would be {position_pct:.1%} of account "
                f"(max {self.max_position_pct:.1%})",
            )

        # Scale down if approaching limit
        if position_pct > self.max_position_pct * 0.8:
            multiplier = 1.0 - (position_pct - self.max_position_pct * 0.8) / (
                self.max_position_pct * 0.2
            )
            return RuleResult(
                self.name, True,
                f"Position at {position_pct:.1%}, reducing size",
                size_multiplier=max(multiplier, 0.3),
            )

        return RuleResult(self.name, True, "Position size within limits")


class MaxDailyLossRule(RiskRule):
    """
    Rule 2: Max daily loss as % of account balance.

    Rejects if daily P&L loss exceeds threshold.
    """

    def __init__(self, max_daily_loss_pct: float = 0.03):
        super().__init__("MaxDailyLoss")
        self.max_daily_loss_pct = max_daily_loss_pct

    def evaluate(self, ctx: RiskContext) -> RuleResult:
        if ctx.account_balance <= 0:
            return RuleResult(self.name, False, "Account balance is zero or negative")

        daily_loss_pct = abs(min(ctx.daily_pnl, 0)) / ctx.account_balance

        if daily_loss_pct >= self.max_daily_loss_pct:
            return RuleResult(
                self.name, False,
                f"Daily loss {daily_loss_pct:.1%} exceeds max {self.max_daily_loss_pct:.1%}",
            )

        # Reduce size if approaching limit
        if daily_loss_pct >= self.max_daily_loss_pct * 0.7:
            remaining = self.max_daily_loss_pct - daily_loss_pct
            multiplier = remaining / (self.max_daily_loss_pct * 0.3)
            return RuleResult(
                self.name, True,
                f"Daily loss at {daily_loss_pct:.1%}, reducing size",
                size_multiplier=max(multiplier, 0.2),
            )

        return RuleResult(self.name, True, "Daily loss within limits")


class VolatilityRule(RiskRule):
    """
    Rule 3: Volatility-based risk gating.

    Rejects or reduces size when 24h volatility is elevated.
    """

    def __init__(self, volatility_threshold: float = 0.08):
        super().__init__("Volatility")
        self.volatility_threshold = volatility_threshold

    def evaluate(self, ctx: RiskContext) -> RuleResult:
        vol = ctx.volatility_24h

        if vol >= self.volatility_threshold:
            return RuleResult(
                self.name, False,
                f"24h volatility {vol:.1%} exceeds threshold {self.volatility_threshold:.1%}",
            )

        # Scale down as volatility approaches threshold
        if vol >= self.volatility_threshold * 0.6:
            ratio = vol / self.volatility_threshold
            multiplier = 1.0 - (ratio - 0.6) / 0.4 * 0.7
            return RuleResult(
                self.name, True,
                f"Elevated volatility {vol:.1%}, reducing size",
                size_multiplier=max(multiplier, 0.3),
            )

        return RuleResult(self.name, True, f"Volatility {vol:.1%} within normal range")


class LeverageRule(RiskRule):
    """
    Rule 4: Effective leverage limit.

    Rejects if total exposure / account balance exceeds max leverage.
    """

    def __init__(self, max_leverage: float = 1.0):
        super().__init__("Leverage")
        self.max_leverage = max_leverage

    def evaluate(self, ctx: RiskContext) -> RuleResult:
        if ctx.account_balance <= 0:
            return RuleResult(self.name, False, "Account balance is zero or negative")

        order_value = ctx.quantity * (ctx.price or 0)
        total_exposure = ctx.current_position_value + order_value
        effective_leverage = total_exposure / ctx.account_balance

        if effective_leverage > self.max_leverage:
            return RuleResult(
                self.name, False,
                f"Effective leverage {effective_leverage:.2f}x exceeds "
                f"max {self.max_leverage:.2f}x",
            )

        return RuleResult(
            self.name, True,
            f"Leverage {effective_leverage:.2f}x within {self.max_leverage:.2f}x limit",
        )


class SlippageRule(RiskRule):
    """
    Rule 5: Expected slippage tolerance.

    Estimates slippage based on order size relative to typical volume,
    and rejects if expected slippage exceeds tolerance.
    """

    def __init__(self, max_slippage_pct: float = 0.005):
        super().__init__("Slippage")
        self.max_slippage_pct = max_slippage_pct

    def evaluate(self, ctx: RiskContext) -> RuleResult:
        if not ctx.price or ctx.price <= 0:
            return RuleResult(self.name, True, "No price data, skipping slippage check")

        order_value = ctx.quantity * ctx.price

        # Estimate slippage: larger orders relative to balance = more slippage
        # Simple model: slippage_pct ~ order_value / (account_balance * 10)
        if ctx.account_balance > 0:
            estimated_slippage = order_value / (ctx.account_balance * 10)
        else:
            estimated_slippage = 0.01  # default 1% if no balance info

        if estimated_slippage > self.max_slippage_pct:
            return RuleResult(
                self.name, False,
                f"Estimated slippage {estimated_slippage:.3%} exceeds "
                f"max {self.max_slippage_pct:.3%}",
            )

        return RuleResult(
            self.name, True,
            f"Estimated slippage {estimated_slippage:.3%} within tolerance",
        )


class RiskRuleEngine:
    """
    Aggregates all 5 risk rules and produces a combined decision.

    All rules must pass for the order to be approved.
    Size multipliers are combined multiplicatively.
    """

    def __init__(
        self,
        max_position_pct: float = 0.05,
        max_daily_loss_pct: float = 0.03,
        volatility_threshold: float = 0.08,
        max_leverage: float = 1.0,
        max_slippage_pct: float = 0.005,
    ):
        self.rules: List[RiskRule] = [
            MaxPositionRule(max_position_pct),
            MaxDailyLossRule(max_daily_loss_pct),
            VolatilityRule(volatility_threshold),
            LeverageRule(max_leverage),
            SlippageRule(max_slippage_pct),
        ]

    def evaluate(self, ctx: RiskContext) -> "RiskEngineResult":
        """Run all rules and return aggregated result."""
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
    """Aggregated result from the 5-rule risk engine."""
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
