import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

export interface IndicatorState {
  rsi: boolean;
  macd: boolean;
  bollinger: boolean;
}

interface IndicatorTogglesProps {
  indicators: IndicatorState;
  onToggle: (indicator: keyof IndicatorState) => void;
}

export function IndicatorToggles({ indicators, onToggle }: IndicatorTogglesProps) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <div className="flex items-center gap-2">
        <Switch id="rsi" checked={indicators.rsi} onCheckedChange={() => onToggle('rsi')} />
        <Label htmlFor="rsi" className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors">RSI</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="macd" checked={indicators.macd} onCheckedChange={() => onToggle('macd')} />
        <Label htmlFor="macd" className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors">MACD</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="bollinger" checked={indicators.bollinger} onCheckedChange={() => onToggle('bollinger')} />
        <Label htmlFor="bollinger" className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors">Bollinger</Label>
      </div>
    </div>
  );
}
