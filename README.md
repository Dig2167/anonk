# Vercel + Supabase anonymous bot

Это версия Telegram-бота под:

- **Vercel** — для webhook-обработчика;
- **Supabase** — для хранения анонимных сообщений и сессий deep link.

## Что делает бот

- принимает анонимные сообщения от пользователей;
- показывает админу:
  - anon ID;
  - Telegram ID;
  - target ID профиля;
  - username;
  - имя;
  - тип сообщения;
  - время отправки;
  - текст;
- позволяет админу проверить автора через `/who <номер>`;
- позволяет админу посмотреть статистику через `/stats`;
- позволяет админу отвечать через reply на сообщение бота;
- даёт пользователю персональную ссылку через `/profile`;
- автоматически удаляет старые сообщения после превышения лимита.

## Как работает `/profile`

Пользователь пишет боту `/profile`.  
Бот собирает deep link из `TELEGRAM_BOT_USERNAME` и Telegram ID пользователя.

Когда человек переходит по такой ссылке:
1. Telegram открывает чат с ботом;
2. бот получает `u_123456`;
3. бот сохраняет сессию в `anon_sessions`;
4. дальше сообщения отправляются анонимно нужному человеку.

## Структура

- `api/webhook.js` — webhook-обработчик для Vercel;
- `supabase/schema.sql` — схема таблиц в Supabase;
- `vercel.json` — конфиг Vercel.

## Переменные окружения

Нужно задать:

- `TELEGRAM_BOT_TOKEN` — токен от BotFather;
- `TELEGRAM_BOT_USERNAME` — username бота без `@`;
- `TELEGRAM_ADMIN_ID` — твой Telegram ID;
- `TELEGRAM_WEBHOOK_SECRET` — секрет для webhook;
- `SUPABASE_URL` — URL проекта Supabase;
- `SUPABASE_SERVICE_ROLE_KEY` — service role key из Supabase;
- `SUPABASE_TABLE` — имя таблицы сообщений, по умолчанию `anonymous_messages`;
- `SUPABASE_SESSIONS_TABLE` — имя таблицы сессий, по умолчанию `anon_sessions`;
- `MAX_STORED_MESSAGES` — сколько сообщений хранить, по умолчанию `1000`.

## Таблица в Supabase

Смотри `supabase/schema.sql`.

Там есть:
- `anonymous_messages` — логи сообщений;
- `anon_sessions` — сессии для deep link.

## Деплой на Vercel

### 1. Создай проект в Vercel
Загрузи папку `Новая папка/vercel-supabase-bot` как отдельный проект.

### 2. Настрой переменные окружения
Добавь все переменные из списка выше в Vercel Project Settings.

### 3. Примени SQL в Supabase
Открой SQL Editor в Supabase и выполни `supabase/schema.sql`.

### 4. Деплой
После деплоя webhook будет доступен по адресу:

```text
https://your-project.vercel.app/api/webhook
```

## Настройка webhook в Telegram

После деплоя вызови Telegram API `setWebhook`:

```bash
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://your-project.vercel.app/api/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

Пример через браузер или curl:

```bash
curl "https://api.telegram.org/bot123456:ABC/setWebhook?url=https://your-project.vercel.app/api/webhook&secret_token=my-secret"
```

## Команды админа

- `/who <номер>` — показать автора сообщения;
- `/lookup <номер>` — то же самое;
- `/stats` — показать количество сообщений и последний anon ID.

## Лимит логов

`MAX_STORED_MESSAGES` управляет автоочисткой.

Рекомендация:
- старт: `1000`;
- если сообщений мало: `2000–5000`;
- если сообщений много, держи лимит ближе к `1000`.

Когда лимит превышен, самые старые записи удаляются автоматически.

## Важное

- Vercel работает только через webhook, не через polling;
- Supabase нужен для постоянного хранения;
- не используй public anon key для записи — нужен `service_role` key;
- `TELEGRAM_WEBHOOK_SECRET` обязателен для защиты webhook;
- username бота нужен для генерации персональной ссылки `/profile`.
