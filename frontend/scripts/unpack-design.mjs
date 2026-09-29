#!/usr/bin/env node
/**
 * Распаковка бандла макета (design/<имя>.html) в design/_unpacked/<имя>/ (FRONTEND_SPEC §2.1).
 *
 *   node scripts/unpack-design.mjs design/Dispatcher_Flow.html
 *
 * Бандл — HTML с блоками <script type="__bundler/…">: manifest (uuid → base64, иногда gzip),
 * template (разметка со ссылками на uuid), ext_resources (id ресурса → uuid), page_order.
 * Результат:
 *   index.html   — разметка, uuid заменены путями к файлам;
 *   pages/*.html — вложенные страницы (DispatcherDay.dc.html и т. п.);
 *   assets/      — логотип, шрифты, скрипты (бандл дизайн-системы — assets/<uuid>.js, начинается с @ds-bundle);
 *   MANIFEST.md  — список файлов.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const EXT_BY_MIME = {
  'text/html': 'html',
  'text/javascript': 'js',
  'application/javascript': 'js',
  'text/css': 'css',
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'application/json': 'json',
};

function block(html, name) {
  const match = new RegExp(`<script type="__bundler/${name}">([\\s\\S]*?)</script>`).exec(html);
  return match ? JSON.parse(match[1]) : null;
}

function describe(text, mime) {
  if (mime.startsWith('font/')) return 'шрифт';
  if (text.startsWith('/* @ds-bundle')) return 'дизайн-система (DS_4fbbd1): исходник компонентов';
  if (text.includes('@license lucide')) return 'иконки lucide';
  if (text.startsWith('// GENERATED from dc-runtime')) return 'рантайм x-dc';
  if (text.includes('@license React')) return 'React UMD';
  if (mime === 'text/html') return 'вложенная страница';
  if (mime === 'image/svg+xml') return 'изображение';
  return '';
}

async function unpack(file) {
  const html = await readFile(file, 'utf8');
  const manifest = block(html, 'manifest');
  const template = block(html, 'template');
  if (!manifest || typeof template !== 'string') {
    throw new Error(`${file}: не бандл макета (нет __bundler/manifest или template)`);
  }
  const extResources = block(html, 'ext_resources') ?? [];
  const idByUuid = Object.fromEntries(extResources.map((entry) => [entry.uuid, entry.id]));

  const name = path.basename(file, path.extname(file));
  const outDir = path.join(path.dirname(file), '_unpacked', name);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(path.join(outDir, 'assets'), { recursive: true });
  await mkdir(path.join(outDir, 'pages'), { recursive: true });

  // 1. Декодируем и выбираем путь каждому ресурсу.
  const files = [];
  for (const [uuid, entry] of Object.entries(manifest)) {
    let bytes = Buffer.from(entry.data, 'base64');
    if (entry.compressed) bytes = gunzipSync(bytes);
    const ext = EXT_BY_MIME[entry.mime] ?? 'bin';
    const id = idByUuid[uuid];
    let rel;
    if (entry.mime === 'text/html') {
      rel = `pages/${id ? path.basename(id) : `${uuid}.html`}`;
    } else if (id === 'logo') {
      rel = `assets/logo.${ext}`;
    } else if (id && /^https?:/.test(id)) {
      rel = `assets/${path.basename(new URL(id).pathname)}`;
    } else {
      rel = `assets/${uuid}.${ext}`;
    }
    files.push({ uuid, rel, bytes, mime: entry.mime, id });
  }

  // 2. Ссылки на uuid → относительные пути (в разметке корня и во вложенных страницах).
  const relink = (text, fromDir) => {
    let out = text;
    for (const f of files) {
      if (!out.includes(f.uuid)) continue;
      const target = path.relative(fromDir, f.rel) || f.rel;
      out = out.split(`about:blank#${f.uuid}`).join(target).split(f.uuid).join(target);
    }
    return out;
  };

  for (const f of files) {
    let bytes = f.bytes;
    if (f.mime === 'text/html') bytes = Buffer.from(relink(f.bytes.toString('utf8'), 'pages'));
    await writeFile(path.join(outDir, f.rel), bytes);
  }
  await writeFile(path.join(outDir, 'index.html'), relink(template, '.'));

  // 3. MANIFEST.md
  const rows = files
    .sort((a, b) => a.rel.localeCompare(b.rel))
    .map((f) => {
      const note = describe(f.bytes.subarray(0, 400).toString('utf8'), f.mime);
      return `| \`${f.rel}\` | ${f.mime} | ${f.bytes.length} | ${f.id ?? ''} | ${note} |`;
    });
  const manifestMd = [
    `# ${name} — распаковка ${path.basename(file)}`,
    '',
    'Сгенерировано `npm run design:unpack` (scripts/unpack-design.mjs). Не редактировать, в git не кладём.',
    '',
    '- `index.html` — разметка макета (формат x-dc: `{{ … }}`, `<sc-for>`, `<sc-if>`, данные — `renderVals()` в конце файла).',
    '',
    '| Файл | MIME | Байт | id в бандле | Что это |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
  await writeFile(path.join(outDir, 'MANIFEST.md'), manifestMd);

  console.log(`${file} → ${outDir} (${files.length} файлов)`);
}

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  console.error('Использование: node scripts/unpack-design.mjs design/<файл>.html [...]');
  process.exit(1);
}
for (const input of inputs) await unpack(input);
