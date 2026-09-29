/**
 * Справочники и помощники подписей (FRONTEND_SPEC §10.1, §6.8, §8.3.7).
 * `*_display` с бэка важнее словаря: словарь — запасной путь.
 */
import { Bike, Bus, Car, Footprints, Plug, Wrench, Zap, type LucideIcon } from 'lucide-react';
import {
  labelOf,
  REGION_LABEL,
  SKILL_LABEL,
  TRANSPORT_LABEL,
  type Skill,
  type Transport,
} from './statuses';
import { knownRegionName } from './regions';

export const SKILL_SHORT: Record<Skill, string> = {
  local: 'Лок.',
  installation: 'Подкл.',
  emergency: 'Авария',
};

export const SKILL_ICON: Record<Skill, LucideIcon> = {
  local: Wrench,
  installation: Plug,
  emergency: Zap,
};

export const TRANSPORT_ICON: Record<Transport, LucideIcon> = {
  car: Car,
  public_transport: Bus,
  walk: Footprints,
  bike: Bike,
};

/** Короткие подписи транспорта для узких мест (select в «Составе и ресурсах»). */
export const TRANSPORT_SHORT: Record<Transport, string> = {
  car: 'Автомобиль',
  public_transport: 'Общ. транспорт',
  walk: 'Пешком',
  bike: 'Велосипед',
};

export const skillLabel = (skill: string | null | undefined, display?: string | null) =>
  display || labelOf(SKILL_LABEL, skill);
export const transportLabel = (transport: string | null | undefined, display?: string | null) =>
  display || labelOf(TRANSPORT_LABEL, transport);
/** Название участка: с бэка (свои участки, §14), иначе справочник; незнакомый — как есть. */
export const regionLabel = (region: string | null | undefined) =>
  knownRegionName(region) ?? labelOf(REGION_LABEL, region);

/** Типы заявки BK — строки из выданных CSV (§8.3.7). */
export const BK = {
  connection: 'Подключение',
  local: 'Локальная заявка',
  emergency: 'Глобальная проблема',
  extra: 'Дозаказ',
} as const;

/** HD аварии: по ответу кейсодержателя №80 аварию определяет поле HD (D-37). */
export const HD_EMERGENCY = 'Авария';
/** HD «Информация» у BK «Глобальная проблема» — обычная заявка, не авария (D-37). */
export const HD_INFO = 'Информация';

/**
 * Авария (D-37, ответ №80): есть HD — только HD «Авария»; нет HD, но есть BK — BK «Глобальная
 * проблема»; нет ни BK, ни HD (синтетика) — навык «Аварийные работы».
 */
export function isEmergency(request: {
  type_hd?: string | null;
  type_bk?: string | null;
  required_skill?: string | null;
}): boolean {
  const hd = request.type_hd?.trim();
  if (hd) return hd === HD_EMERGENCY;
  const bk = request.type_bk?.trim();
  if (bk) return bk === BK.emergency;
  return request.required_skill === 'emergency';
}

/**
 * BK обычной записи оператора. «Глобальная проблема» — только с HD «Информация»: аварию (HD
 * «Авария») оператор передаёт вкладкой «Авария» (D-37).
 */
export const BK_REGULAR: readonly string[] = [BK.connection, BK.local, BK.extra, BK.emergency];

/** HD по BK, первая строка — самая частая. */
export const HD_BY_BK: Record<string, readonly string[]> = {
  [BK.connection]: [
    'Конвергенция абонента',
    'Заявка на подключение',
    'Заказ подключения/Дозаказ оборудования',
  ],
  [BK.local]: [
    'Нет линка',
    'Работа с кабелем',
    'Переключение на Гбит/с',
    'IP-адрес 169...',
    'Разрывы',
    'Рост ошибок на порту',
    'Низкая скорость',
    'Роутер. Замена техническим специалистом',
    'TVE/ENT. Замена приставки техником',
    'ТВ. Замена приставки техником',
    'TVE/ENT. Другие ошибки',
    'Мониторинг',
  ],
  [BK.extra]: [
    'Дозаказ оборудования',
    'Заказ подключения/Дозаказ оборудования',
    'Конвергенция абонента',
  ],
  // в обычной записи — только «Информация»; «Авария» — вкладка «Авария» (D-37)
  [BK.emergency]: [HD_INFO],
};

/**
 * Короткий тип для таймлайна и тултипов диспетчера (§8.2): «Подкл.», «Лок.», «Дозак.», «Авария»;
 * «Глобальная проблема» с HD «Информация» — «Информ.» (D-37).
 */
const BK_SHORT: Record<string, string> = {
  [BK.connection]: 'Подкл.',
  [BK.local]: 'Лок.',
  [BK.extra]: 'Дозак.',
  [BK.emergency]: 'Авария',
};

/**
 * Тип в карточке неназначенной (§8.2 «№… {Тип} · окно …»): BK, а «Глобальная проблема» — «Авария»
 * или «Информация» по HD (D-37).
 */
export function typeTitle(typeBk: string | null | undefined, typeHd: string | null | undefined): string {
  if (typeBk === BK.emergency) return typeHd?.trim() === HD_INFO ? HD_INFO : HD_EMERGENCY;
  return typeBk ?? '';
}

/** Полный тип по навыку, когда нет type_bk (синтетика, §6.8). */
const SKILL_TYPE_FULL: Record<Skill, string> = {
  emergency: 'Авария',
  installation: 'Подключение и дозаказ',
  local: 'Локальные работы',
};

export function typeShort(
  typeBk: string | null | undefined,
  skill: string | null | undefined,
  typeHd?: string | null,
) {
  if (typeBk === BK.emergency && typeHd?.trim() === HD_INFO) return 'Информ.';
  if (typeBk) return BK_SHORT[typeBk] ?? typeBk;
  return labelOf(SKILL_SHORT, skill);
}

/** «Подключение · Конвергенция абонента»; нет BK — подпись по навыку. */
export function typeFull(
  typeBk: string | null | undefined,
  typeHd: string | null | undefined,
  skill?: string | null,
): string {
  if (typeBk) return typeHd ? `${typeBk} · ${typeHd}` : typeBk;
  return labelOf(SKILL_TYPE_FULL, skill);
}

/** Тип одним словом: BK, иначе по навыку. */
export function typeBkOrSkill(typeBk: string | null | undefined, skill: string | null | undefined) {
  return typeBk || labelOf(SKILL_TYPE_FULL, skill);
}

/** №: id до 6 символов — целиком («T012»), длиннее — последние 4 цифры («…7741»). */
export function shortId(id: string | null | undefined): string {
  if (!id) return '';
  return id.length <= 6 ? id : `…${id.slice(-4)}`;
}

const BRIGADE = /^Бригада\s+/i;

/** «Бригада Соколов». Пустое имя или имя = id (синтетика) → «Бригада E00». */
export function engineerLabel(name: string | null | undefined, id: string): string {
  const clean = (name ?? '').trim();
  if (!clean || clean === id) return `Бригада ${id}`;
  return clean;
}

/**
 * Глагол к подписи бригады: «Бригада 1 выполнила» — женский род, имя инженера («Капитанчук
 * Александр») — мужской.
 */
export function engineerVerb(label: string, masculine: string, feminine: string): string {
  return BRIGADE.test(label.trim()) ? feminine : masculine;
}

/** Имя без «Бригада»: «Соколов»; «Капитанчук Александр» → «Капитанчук»; нет имени → id. */
export function engineerShort(name: string | null | undefined, id: string): string {
  const clean = (name ?? '').trim();
  if (!clean || clean === id) return id;
  const withoutPrefix = clean.replace(BRIGADE, '');
  // «Бригада 1» (демо-набор): одна цифра в чипе непонятна — оставляем имя целиком
  if (/^\d+$/.test(withoutPrefix)) return clean;
  return withoutPrefix.split(/\s+/)[0] || id;
}
