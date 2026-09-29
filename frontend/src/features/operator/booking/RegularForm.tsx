import { CircleSlash, List, ListTree, Phone } from 'lucide-react';
import { useState, type Dispatch } from 'react';
import type { SlotsModel } from '@/adapters/booking';
import { phoneValid } from '@/lib/booking';
import { BK_REGULAR, HD_BY_BK, TRANSPORT_ICON } from '@/lib/dictionaries';
import { isTransport, TRANSPORT_LABEL, TRANSPORTS } from '@/lib/statuses';
import { cx, Input, Select, Switch } from '@/ui';
import { AddressInput } from '../../shared/AddressInput';
import { T } from '../operatorTexts';
import type { OperatorRegion } from '../useOperatorRegion';
import { TECHNOLOGY_REGION } from './bookingRequest';
import { RegionField } from './RegionField';
import { SkillLine } from './SkillLine';
import {
  TECHNOLOGIES,
  transportByRule,
  type BookingForm,
  type BookingFormAction,
} from './useBookingForm';
import styles from './forms.module.css';

/** «Не требуется» — непустое значение списка, иначе select покажет его серым, как подсказку. */
const TRANSPORT_NONE = 'none';

const BK_OPTIONS = BK_REGULAR.map((bk) => ({ value: bk, label: bk }));
const TRANSPORT_OPTIONS = [
  { value: TRANSPORT_NONE, label: T.new.transportNone },
  ...TRANSPORTS.map((transport) => ({ value: transport, label: TRANSPORT_LABEL[transport] })),
];

export interface RegionPicker {
  regions: readonly OperatorRegion[];
  region: string | null;
  setRegion: (region: string) => void;
  failed: boolean;
  retry: () => unknown;
}

/** Поля обычной записи, шаг 1 из 2 (FRONTEND_SPEC §8.3.7), и строка навыка под ними. */
export function RegularForm({
  form,
  dispatch,
  regions,
  slots,
}: {
  form: BookingForm;
  dispatch: Dispatch<BookingFormAction>;
  regions: RegionPicker;
  /** Фоновый ответ окон: навык, длительность, район (⏳ 9.7). */
  slots?: SlotsModel;
}) {
  // ошибку телефона показываем, когда оператор ушёл из поля
  const [contactLeft, setContactLeft] = useState(false);
  // свой участок (§14): типы — из его нормативов, подтипов у них нет
  const regionTypes = regions.regions.find((item) => item.id === regions.region)?.types ?? null;
  const bkOptions = regionTypes ? regionTypes.map((bk) => ({ value: bk, label: bk })) : BK_OPTIONS;
  const hdOptions = regionTypes
    ? []
    : (HD_BY_BK[form.typeBk] ?? []).map((hd) => ({ value: hd, label: hd }));
  const withTechnology = regions.region === TECHNOLOGY_REGION;

  return (
    <>
      <div className={styles.grid}>
        <RegionField
          className={styles.wide}
          regions={regions.regions}
          value={regions.region}
          onChange={regions.setRegion}
          failed={regions.failed}
          onRetry={() => void regions.retry()}
        />
        <AddressInput
          fieldClassName={styles.wide}
          label={T.new.address}
          value={form.address}
          onChange={(value) => dispatch({ type: 'address', value })}
          suffix={slots?.district}
        />
        <Select
          label={T.new.typeBk}
          icon={List}
          options={bkOptions}
          value={regionTypes && !regionTypes.includes(form.typeBk) ? '' : form.typeBk}
          placeholder={T.new.choose}
          onChange={(value) => dispatch({ type: 'typeBk', value })}
        />
        <Select
          label={T.new.typeHd}
          icon={ListTree}
          options={hdOptions}
          value={form.typeHd}
          placeholder={T.new.choose}
          disabled={!form.typeBk || hdOptions.length === 0}
          onChange={(value) => dispatch({ type: 'typeHd', value })}
        />
        <Input
          label={T.new.contact}
          icon={Phone}
          inputMode="tel"
          autoComplete="off"
          value={form.contact}
          error={contactLeft && !phoneValid(form.contact) ? T.new.phoneIncomplete : undefined}
          onChange={(event) => dispatch({ type: 'contact', value: event.target.value })}
          onFocus={() => setContactLeft(false)}
          onBlur={() => setContactLeft(true)}
        />
        <Select
          label={T.new.transport}
          icon={form.transport ? TRANSPORT_ICON[form.transport] : CircleSlash}
          aside={transportByRule(form) ? T.new.byRule : undefined}
          options={TRANSPORT_OPTIONS}
          value={form.transport ?? TRANSPORT_NONE}
          onChange={(value) =>
            dispatch({ type: 'transport', value: isTransport(value) ? value : null })
          }
        />
        <div className={styles.gigabit}>
          <Switch
            checked={form.gigabit}
            onChange={(value) => dispatch({ type: 'gigabit', value })}
            label={T.new.gigabit}
          />
        </div>
        {withTechnology && (
          <div className={styles.technology} role="group" aria-label={T.new.technology}>
            {TECHNOLOGIES.map((technology) => (
              <button
                key={technology}
                type="button"
                className={cx(
                  styles.technologyOption,
                  technology === form.technology && styles.technologyActive,
                )}
                aria-pressed={technology === form.technology}
                onClick={() => dispatch({ type: 'technology', value: technology })}
              >
                {technology}
              </button>
            ))}
          </div>
        )}
      </div>
      <SkillLine slots={slots} />
    </>
  );
}
