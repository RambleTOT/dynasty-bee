import {
  Building2,
  Car,
  CircleAlert,
  CircleCheck,
  Clock3,
  MapPin,
  MapPinPlus,
  TriangleAlert,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import {
  IMPORT_BADGE_LABEL,
  IMPORT_BADGE_TONE,
  type ImportBadge,
  type ImportLineKind,
  type ImportRegionReport,
} from '@/adapters/importReport';
import { regionLabel } from '@/lib/dictionaries';
import { cx, ToneChip } from '@/ui';
import styles from './ImportModal.module.css';

const LINE_ICON: Record<ImportLineKind, LucideIcon> = {
  loaded: CircleCheck,
  region: MapPinPlus,
  office: Building2,
  points: MapPin,
  roster: UsersRound,
  norms: Clock3,
  transport: Car,
  dispatcher: Users,
  warning: TriangleAlert,
  error: CircleAlert,
};

const BADGE_ICON: Record<ImportBadge, LucideIcon> = {
  ready: CircleCheck,
  remarks: TriangleAlert,
  error: CircleAlert,
};

/** Карточка региона в отчёте импорта (DS-02, шаг 2): бейдж и строки с иконками. */
export function ReportCard({ report }: { report: ImportRegionReport }) {
  const name = regionLabel(report.regionId);
  return (
    <section className={styles.report} aria-label={name}>
      <div className={styles.reportHead}>
        <h3 className={styles.reportName}>{name}</h3>
        <ToneChip tone={IMPORT_BADGE_TONE[report.badge]} icon={BADGE_ICON[report.badge]}>
          {IMPORT_BADGE_LABEL[report.badge]}
        </ToneChip>
      </div>
      <ul className={styles.lines}>
        {report.lines.map((line, index) => {
          const Icon = LINE_ICON[line.kind];
          return (
            <li key={index} className={styles.line}>
              <Icon
                size={18}
                className={cx(styles.lineIcon, styles[`tone_${line.tone}`])}
                aria-hidden
              />
              <span className={styles.lineText}>{line.text}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
