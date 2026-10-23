# Konspects

Локальная библиотека конспектов для macOS (Apple Silicon).  
Personal offline conspect library for macOS (Apple Silicon).

Сжимаете текст в **Merlin** сами → вставляете готовый конспект сюда → читаете офлайн и переписываете в тетрадь.  
Compress in **Merlin** yourself → paste the finished conspect here → read offline and hand-copy into a notebook.

**Без AI / без API-ключей.** Данные — обычные файлы в `Документы/Konspects` (`~/Documents/Konspects`).

```text
Документы/Konspects/
  Предмет А/
    Глава 1/            ← папка главы с разделами
      chapter.json
      s_….md
    Глава 2/
      …
```

## Требования / Requirements (Mac)

- macOS 12+ на Apple Silicon (M1–M4)
- [Node.js 20+](https://nodejs.org/) (LTS)
- [Rust](https://rustup.rs/) (нужен для Tauri; в репозитории `rust-toolchain.toml` просит **1.99** — `rustup` подхватит сам)
- Xcode Command Line Tools: `xcode-select --install`

## Установка и запуск / Install & run

В терминале (скопируйте по очереди):

```bash
git clone https://github.com/kruzak200/konspects.git
cd konspects
git checkout cursor/konspects-mvp-c221
npm install
```

### Режим разработки / Dev

```bash
npm run tauri dev
```

Откроется окно приложения. UI на русском.

### Сборка .app / Build

```bash
npm run tauri build
```

Готовое приложение будет в:

`src-tauri/target/release/bundle/macos/Konspects.app`

(и `.dmg`, если сборка его создала)

Можно перетащить `Konspects.app` в «Программы».

### Если сборка на Mac падала с `phf_macros` / `can't find crate`

Это уже исправлено в проекте (нельзя «strip»-ать proc-macros при release-сборке на новых macOS/Xcode).  
Обновите код и пересоберите **с чистого target**:

```bash
cd konspects
git fetch origin
git checkout cursor/konspects-mvp-c221
git pull origin cursor/konspects-mvp-c221
rustup show
npm install
cd src-tauri
cargo clean
cd ..
npm run tauri build
```

После успеха приложение будет здесь:

`src-tauri/target/release/bundle/macos/Konspects.app`

Не копируйте `.app` вручную, пока команда `npm run tauri build` не завершится без ошибок.

### Обновление уже установленного приложения

```bash
cd konspects
git pull origin cursor/konspects-mvp-c221
npm install
cd src-tauri && cargo clean && cd ..
npm run tauri build
```

Потом снова откройте новое `Konspects.app` из `src-tauri/target/release/bundle/macos/`.

### Только фронтенд в браузере (удобно проверить UI)

```bash
npm run dev
```

Откройте `http://localhost:1420`. В браузере данные живут в `localStorage` (это превью). На Mac через `tauri` всё пишется в `Документы/Konspects`.

## Как пользоваться / How to use

1. Создайте **предмет**
2. Внутри создайте **главу**
3. В главе слева список **разделов** — вставляйте текст из Merlin **по одному разделу**:
   - **+ Раздел** — новый пустой раздел
   - клик по разделу — переключение (чтение / правка)
   - название раздела = **первая строка** текста (пока вы не зададите своё через «Название…»)
   - **Автоимя** — снова брать имя из первой строки
4. Вкладка **«Править»** — правка раздела (заголовки, **жирный**, *курсив*, таблицы)
5. **Сохранить** — раздел на диске
6. **«Читать»** — спокойный вид для тетради
7. **Экспорт в DOCX / PDF** — вся глава (все сохранённые разделы)
8. Можно закрыть приложение и открыть позже **без интернета**

### Файлы на диске / On-disk layout

```text
Документы/Konspects/
  Предмет/
    Глава/                 ← папка главы
      chapter.json         ← порядок разделов + свои названия
      s_….md               ← текст раздела
```

Старые главы в виде одного файла `Глава.md` при открытии **автоматически** превращаются в папку с одним разделом.

### Экспорт / Export

- **DOCX** — библиотека `docx` (заголовки, абзацы, жирный/курсив, таблицы)
- **PDF** — `jspdf` + шрифт DejaVu Sans (кириллица), встроен в приложение
- Доп. системных зависимостей для экспорта **не нужно** (только обычный Tauri/Rust/Node для сборки приложения)
- Ограничения PDF: сложные таблицы и очень длинные ячейки могут переноситься упрощённо; для идеальной вёрстки удобнее DOCX → печать из Word/Pages

## Стек / Stack

Tauri 2 · Vite · React · TypeScript

## Вне MVP / Out of scope

Поиск, синхронизация, iCloud, интеграция с Merlin, платные API, упаковка под Windows/Linux (сначала Mac).
