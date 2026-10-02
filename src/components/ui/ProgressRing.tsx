import { cx } from './Card';

interface ProgressRingProps {
  /** 0-100. Clamped, because a caller computing a ratio must not be able to
   *  render a 140% ring. */
  percent: number;
  size?: number;
  label?: string;
  caption?: string;
}

/**
 * Circular progress, as used in the references for task-history and completion.
 *
 * Decorative by default: the numeric value is rendered as real text so the
 * information is never conveyed by the arc alone. A screen reader gets the
 * number, not a shape.
 */
export function ProgressRing({ percent, size = 96, label, caption }: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-ink-100"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="stroke-brand-500 transition-[stroke-dashoffset] duration-500"
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cx('text-lg font-semibold tabular-nums text-ink-900')}>
          {label ?? `${clamped}%`}
        </span>
        {caption ? (
          <span className="text-[0.625rem] leading-tight text-ink-500">{caption}</span>
        ) : null}
      </div>
    </div>
  );
}

interface StatTileProps {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'brand' | 'gamify';
}

const TILE_TONE = {
  default: 'bg-surface border-ink-100 shadow-tile text-ink-900',
  brand: 'bg-brand-50 border-brand-100 text-brand-900',
  // Gamification tone is for XP and levels only, never for money (doc 47).
  gamify: 'bg-gamify-400/15 border-gamify-400/40 text-gamify-600',
} as const;

/** A compact metric. Used for non-financial progress and counts. */
export function StatTile({ label, value, hint, tone = 'default' }: StatTileProps) {
  return (
    <div className={cx('rounded-tile border p-4', TILE_TONE[tone])}>
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs opacity-70">{hint}</p> : null}
    </div>
  );
}
