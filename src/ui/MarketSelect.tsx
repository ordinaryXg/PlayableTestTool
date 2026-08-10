import type { MarketModule } from '../types';
import { listMarkets, marketSelectLabel } from '../markets';

interface Props {
  value: string;
  onChange: (id: string) => void;
}

export function MarketSelect({ value, onChange }: Props) {
  const markets = listMarkets();
  return (
    <label className="market-select">
      <span>市场</span>
      <select
        value={value}
        onChange={(e) => {
          const m = markets.find((x: MarketModule) => x.id === e.target.value);
          if (m?.enabled) onChange(m.id);
        }}
      >
        {markets.map((m) => (
          <option key={m.id} value={m.id} disabled={!m.enabled}>
            {marketSelectLabel(m)}
          </option>
        ))}
      </select>
    </label>
  );
}
