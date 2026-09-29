#!/usr/bin/env bash
# Очистка дней на стенде бэка. Запускает владелец сервера (root) на сервере бэка.
# Удаляет дни целиком: сценарии дня и версии после событий, планы, события, действия инженеров.
# Учётки (users) и кэш геокодера (geocode_cache) не трогает. Перед удалением — копия базы.
#
#   clear-days.sh                        все дни: показать, что удалится (ничего не удаляет)
#   clear-days.sh --yes                  все дни: копия базы, затем удаление
#   clear-days.sh east 2026-10-05        один день региона: показать
#   clear-days.sh east 2026-10-05 --yes  один день региона: копия базы, затем удаление
#
# Регионы: east, south_east, south_center. Копии — в /root/backups. Восстановить:
#   docker exec -i beeline_rps-db-1 sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < /root/backups/<файл>.dump
# Демо-день на сегодня бэк создаст сам, когда откроют календарь (если SEED_DEMO_DAY включён).
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-beeline_rps-db-1}"
BACKUP_DIR="${BACKUP_DIR:-/root/backups}"
# имя для подсказок: через `ssh … 'bash -s' < clear-days.sh` у скрипта нет файла
SELF="${BASH_SOURCE[0]:-clear-days.sh}"

usage() {
  cat <<USAGE
$SELF                        все дни: показать, что удалится (ничего не удаляет)
$SELF --yes                  все дни: копия базы, затем удаление
$SELF east 2026-10-05        один день региона: показать
$SELF east 2026-10-05 --yes  один день региона: копия базы, затем удаление
Регионы: east, south_east, south_center.
USAGE
}

region=""
day=""
yes=0
for arg in "$@"; do
  case "$arg" in
    --yes) yes=1 ;;
    -h | --help) usage; exit 0 ;;
    east | south_east | south_center) region="$arg" ;;
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) day="$arg" ;;
    *) echo "Непонятный аргумент: $arg" >&2; usage >&2; exit 2 ;;
  esac
done
if [[ -n "$region" && -z "$day" ]] || [[ -z "$region" && -n "$day" ]]; then
  echo "Для одного дня нужны регион и дата: $SELF east 2026-10-05" >&2
  exit 2
fi

# psql и pg_dump в контейнере базы; DB_PSQL / DB_PG_DUMP — свои команды (проверка на копии базы)
psql_db() {
  if [[ -n "${DB_PSQL:-}" ]]; then
    # shellcheck disable=SC2086
    $DB_PSQL -X -q -v ON_ERROR_STOP=1 -P pager=off "$@"
  else
    docker exec -i "$DB_CONTAINER" sh -c \
      'psql -X -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -P pager=off "$@"' sh "$@"
  fi
}
pg_dump_db() {
  if [[ -n "${DB_PG_DUMP:-}" ]]; then
    # shellcheck disable=SC2086
    $DB_PG_DUMP -Fc
  else
    docker exec "$DB_CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'
  fi
}

# Что удаляем. Без региона — всё. С регионом и датой — исходные сценарии дня (записи оператора,
# CSV, демо, в том числе архивные) и все их версии после событий; планы этих сценариев и их потомки.
SELECT_SQL=$(
  cat <<'SQL'
CREATE TEMP TABLE s_del AS
WITH RECURSIVE t(id) AS (
  SELECT id FROM scenarios
   WHERE :'region' = ''
      OR (scenario_metadata->>'region_id' = :'region' AND scenario_metadata->>'date' = :'day')
  UNION
  SELECT s.id FROM scenarios s JOIN t
    ON s.scenario_metadata->>'derived_from_scenario' = t.id
    OR s.scenario_metadata->>'root_scenario_id' = t.id
)
SELECT id FROM t;

CREATE TEMP TABLE p_del AS
WITH RECURSIVE t(id) AS (
  SELECT id FROM plans WHERE :'region' = '' OR scenario_id IN (SELECT id FROM s_del)
  UNION
  SELECT p.id FROM plans p JOIN t ON p.parent_plan_id = t.id
)
SELECT id FROM t;

CREATE TEMP TABLE e_del AS
SELECT id FROM events
 WHERE plan_id IN (SELECT id FROM p_del)
    OR result_plan_id IN (SELECT id FROM p_del)
    OR scenario_id IN (SELECT id FROM s_del);

CREATE TEMP TABLE a_del AS
SELECT id FROM engineer_actions WHERE :'region' = '' OR scenario_id IN (SELECT id FROM s_del);
SQL
)

REPORT_SQL=$(
  cat <<'SQL'
\echo 'Дни:'
SELECT scenario_metadata->>'region_id' AS region,
       scenario_metadata->>'date' AS date,
       coalesce(scenario_metadata->>'source', '-') AS source,
       json_array_length(requests) AS requests,
       coalesce(scenario_metadata->>'archived', 'false') AS archived,
       left(id, 8) AS scenario
  FROM scenarios
 WHERE id IN (SELECT id FROM s_del) AND scenario_metadata->>'date' IS NOT NULL
 ORDER BY 2, 1, created_at;
\echo 'Всего:'
SELECT (SELECT count(*) FROM s_del) AS scenarios,
       (SELECT count(*) FROM p_del) AS plans,
       (SELECT count(*) FROM e_del) AS events,
       (SELECT count(*) FROM a_del) AS engineer_actions;
SQL
)

DELETE_SQL=$(
  cat <<'SQL'
DELETE FROM events WHERE id IN (SELECT id FROM e_del);
DELETE FROM engineer_actions WHERE id IN (SELECT id FROM a_del);
DELETE FROM plans WHERE id IN (SELECT id FROM p_del);
DELETE FROM scenarios WHERE id IN (SELECT id FROM s_del);
SQL
)

target="все дни"
[[ -n "$region" ]] && target="день $day, регион $region"

if [[ "$yes" -ne 1 ]]; then
  echo "Удалится ($target) — пока ничего не удалено:"
  printf '%s\n%s\n' "$SELECT_SQL" "$REPORT_SQL" | psql_db -v region="$region" -v day="$day"
  echo
  echo "Удалить: $SELF ${region:+$region $day }--yes"
  exit 0
fi

mkdir -p "$BACKUP_DIR"
backup="$BACKUP_DIR/beeline-$(date +%Y%m%d-%H%M%S).dump"
echo "→ копия базы: $backup"
pg_dump_db >"$backup"
if [[ ! -s "$backup" ]]; then
  echo "Копия пустая — ничего не удаляю" >&2
  exit 1
fi

echo "→ удаление ($target)"
# одна транзакция: ошибка на любом шаге — база остаётся как была
printf 'BEGIN;\n%s\n%s\n%s\nCOMMIT;\n' "$SELECT_SQL" "$REPORT_SQL" "$DELETE_SQL" |
  psql_db -v region="$region" -v day="$day"
echo "готово. Вернуть как было: pg_restore из $backup (команда — в начале скрипта)"
