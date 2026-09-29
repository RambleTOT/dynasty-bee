import { Callout, Button, cx, SegmentedControl, Skeleton } from '@/ui';
import { T } from '../operatorTexts';
import type { OperatorRegion } from '../useOperatorRegion';
import styles from './forms.module.css';

/**
 * «Регион» обычной записи: SegmentedControl по регионам пользователя; один регион — просто
 * текст (FRONTEND_SPEC §8.3.5).
 */
export function RegionField({
  regions,
  value,
  onChange,
  failed,
  onRetry,
  className,
}: {
  regions: readonly OperatorRegion[];
  value: string | null;
  onChange: (region: string) => void;
  failed: boolean;
  onRetry: () => void;
  className?: string;
}) {
  let control;
  if (regions.length > 1) {
    control = (
      <SegmentedControl
        label={T.new.region}
        fullWidth
        options={regions.map((region) => ({ value: region.id, label: region.name }))}
        value={value ?? ''}
        onChange={onChange}
      />
    );
  } else if (regions.length === 1) {
    control = <span className={styles.single}>{regions[0].name}</span>;
  } else if (failed) {
    control = (
      <Callout
        tone="danger"
        action={
          <Button variant="tertiary" size="sm" onClick={onRetry}>
            {T.retry}
          </Button>
        }
      >
        {T.net.error}
      </Callout>
    );
  } else {
    control = <Skeleton height={40} radius="var(--radius-pill)" />;
  }

  return (
    <div className={cx(styles.field, className)}>
      <span className={styles.label}>{T.new.region}</span>
      {control}
    </div>
  );
}
