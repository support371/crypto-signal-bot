import { useMemo } from 'react';
import { CryptoPrice, Signal, RiskAssessment, MicrostructureFeatures } from '@/types/crypto';

interface SignalEngineConfig {
  riskTolerance: number;
  spreadStressThreshold: number;
  volatilitySensitivity: number;
  positionSizeFraction: number;
}

const DEFAULT_CONFIG: SignalEngineConfig = {
  riskTolerance: 0.5,
  spreadStressThreshold: 0.002,
  volatilitySensitivity: 0.5,
  positionSizeFraction: 0.1,
};

export function useSignalEngine(price: CryptoPrice | null, config: Partial<SignalEngineConfig> = {}) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  const microstructure = useMemo<MicrostructureFeatures | null>(() => {
    if (!price) return null;
    
    // Simulate microstructure features based on price data
    const volatility = Math.abs(price.change24h) / 100;
    const isSpike = volatility > 0.05;
    
    return {
      spreadPercentage: 0.001 + Math.random() * 0.003,
      orderBookImbalance: (Math.random() - 0.5) * 2,
      midPriceVelocity: price.change24h / 24,
      volatilitySpike: isSpike,
      depthDecay: 0.5 + Math.random() * 0.5,
    };
  }, [price]);

  const signal = useMemo<Signal | null>(() => {
    if (!price || !microstructure) return null;

    const change = price.change24h;
    const imbalance = microstructure.orderBookImbalance;
    
    // Determine direction based on momentum and order book
    let direction: Signal['direction'] = 'NEUTRAL';
    if (change > 2 && imbalance > 0.3) direction = 'UP';
    else if (change < -2 && imbalance < -0.3) direction = 'DOWN';
    
    // Calculate confidence
    const momentumStrength = Math.min(Math.abs(change) / 10, 1);
    const imbalanceStrength = Math.abs(imbalance);
    const confidence = (momentumStrength * 0.6 + imbalanceStrength * 0.4) * 100;
    
    // Determine regime
    let regime: Signal['regime'] = 'RANGE';
    if (microstructure.volatilitySpike) regime = 'CHAOS';
    else if (Math.abs(change) > 3) regime = 'TREND';
    
    return {
      direction,
      confidence: Math.round(confidence),
      regime,
      horizon: 60, // minutes
    };
  }, [price, microstructure]);

  const risk = useMemo<RiskAssessment | null>(() => {
    if (!price || !signal || !microstructure) return null;

    const { riskTolerance, spreadStressThreshold, volatilitySensitivity, positionSizeFraction } = mergedConfig;
    
    // Calculate risk score (0-100)
    let riskScore = 50;
    
    // Adjust for volatility
    if (microstructure.volatilitySpike) riskScore += 20;
    riskScore += Math.abs(price.change24h) * 2;
    
    // Adjust for spread stress
    if (microstructure.spreadPercentage > spreadStressThreshold) riskScore += 15;
    
    // Adjust for regime
    if (signal.regime === 'CHAOS') riskScore += 25;
    else if (signal.regime === 'TREND') riskScore -= 10;
    
    riskScore = Math.max(0, Math.min(100, riskScore));
    
    // Determine decision
    const riskThreshold = 100 - riskTolerance * 100;
    const approved = riskScore < riskThreshold;
    
    let decision: RiskAssessment['decision'] = 'HOLD';
    if (approved && signal.confidence > 60) {
      if (signal.direction === 'UP') decision = 'ENTER_LONG';
      else if (signal.direction === 'DOWN') decision = 'ENTER_SHORT';
    } else if (riskScore > 70) {
      decision = 'EXIT';
    }
    
    // Calculate position size
    const volatilityFactor = 1 - (Math.abs(price.change24h) / 20);
    const positionSize = positionSizeFraction * Math.max(0.2, volatilityFactor) * (approved ? 1 : 0);
    
    // Generate reasoning
    const reasons: string[] = [];
    if (signal.regime === 'CHAOS') reasons.push('High volatility detected');
    if (signal.regime === 'TREND') reasons.push('Strong trend momentum');
    if (microstructure.spreadPercentage > spreadStressThreshold) reasons.push('Spread stress elevated');
    if (signal.confidence > 70) reasons.push('High signal confidence');
    if (!approved) reasons.push('Risk exceeds tolerance threshold');
    
    return {
      score: Math.round(riskScore),
      decision,
      approved,
      positionSize: Math.round(positionSize * 100) / 100,
      reasoning: reasons.join('. ') || 'Analyzing market conditions...',
    };
  }, [price, signal, microstructure, mergedConfig]);

  return { signal, risk, microstructure };
}
