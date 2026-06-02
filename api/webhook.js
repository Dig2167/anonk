const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || '';
const TELEGRAM_ADMIN_ID = Number(process.env.TELEGRAM_ADMIN_ID || 0);
const TELEGRAM_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'anonymous_messages';
const SUPABASE_SESSIONS_TABLE = process.env.SUPABASE_SESSIONS_TABLE || 'anon_sessions';
const MAX_STORED_MESSAGES = Number(process.env.MAX_STORED_MESSAGES || 1000);
const ADMIN_HANDLE = '@mandlail';

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function text(res, statusCode, message) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(message);
}

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
}

function telegramRequest(method, payload) {
  return fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.ok === false) {
      throw new Error(data.description || `Telegram API error: ${method}`);
    }

    return data.result;
  });
}

async function safeTelegramRequest(method, payload, context) {
  try {
    return await telegramRequest(method, payload);
  } catch (error) {
    console.error(context, error);
    return null;
  }
}

function supabaseRequest(path, options = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {}),
    },
  }).then(async (response) => {
    const textBody = await response.text();
    const parsedBody = textBody ? JSON.parse(textBody) : null;

    if (!response.ok) {
      const errorMessage =
        parsedBody?.message || parsedBody?.error || parsedBody?.details || response.statusText;
      throw new Error(errorMessage);
    }

    return {
      body: parsedBody,
      headers: response.headers,
    };
  });
}

function formatAnonId(anonId) {
  return `#${String(anonId).padStart(4, '0')}`;
}

function getSenderName(from = {}) {
  const parts = [from.first_name, from.last_name].filter(Boolean);
  if (parts.length) return parts.join(' ');
  if (from.username) return `@${from.username}`;
  return `user ${from.id || 'unknown'}`;
}

function getMessageKind(message) {
  if (message.text) return 'text';
  if (message.photo) return 'photo';
  if (message.video) return 'video';
  if (message.document) return 'document';
  if (message.voice) return 'voice';
  if (message.audio) return 'audio';
  if (message.sticker) return 'sticker';
  return 'unsupported';
}

function getMessageText(message) {
  return typeof message.text === 'string'
    ? message.text
    : typeof message.caption === 'string'
      ? message.caption
      : '';
}

function getMessageDate(message) {
  return message.date
    ? new Date(message.date * 1000).toLocaleString('ru-RU')
    : new Date().toLocaleString('ru-RU');
}

function getDeepLinkPayload(text = '') {
  const match = text.trim().match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
  return match?.[1] || '';
}

function getDeepLinkTargetId(text = '') {
  const payload = getDeepLinkPayload(text);
  const match = payload.match(/(?:^|\s)u_(\d+)(?:\s|$)/i);

  if (!match) {
    return 0;
  }

  const targetId = Number(match[1]);
  return Number.isFinite(targetId) ? targetId : 0;
}

function buildAdminText(record) {
  const username = record.username ? `@${record.username}` : 'нет username';
  const textLine = record.text ? `Текст: ${record.text}` : 'Текст: [не текстовое сообщение]';

  return [
    'У тебя новое сообщение!',
    `Anon ID: ${formatAnonId(record.anon_id)}`,
    `Отправитель: ${record.name}`,
    `Telegram ID: ${record.user_id}`,
    `Target ID: ${record.target_user_id || TELEGRAM_ADMIN_ID}`,
    `Username: ${username}`,
    `Тип: ${record.kind}`,
    `Время: ${record.created_at}`,
    textLine,
    '',
    `Ответь reply на это сообщение, чтобы написать пользователю.`,
    `Проверка автора: /who ${record.anon_id}`,
    `Контакт: ${ADMIN_HANDLE}`,
  ].join('\n');
}

function buildLookupText(record) {
  const username = record.username ? `@${record.username}` : 'нет username';

  return [
    `Проверка сообщения ${formatAnonId(record.anon_id)}`,
    `Отправитель: ${record.name}`,
    `Telegram ID: ${record.user_id}`,
    `Target ID: ${record.target_user_id || TELEGRAM_ADMIN_ID}`,
    `Username: ${username}`,
    `Тип: ${record.kind}`,
    `Время: ${record.created_at}`,
    record.text ? `Текст: ${record.text}` : 'Текст: [не текстовое сообщение]',
  ].join('\n');
}

function buildInviteText(userId) {
  if (!TELEGRAM_BOT_USERNAME) {
    return 'Задай TELEGRAM_BOT_USERNAME в Vercel.';
  }

  const link = `t.me/${TELEGRAM_BOT_USERNAME}?start=u_${userId}`;

  return [
    'Делитесь этой ссылкой, чтобы получать анонимные сообщения:',
    '',
    link,
  ].join('\n');
}

function buildInviteKeyboard(userId) {
  if (!TELEGRAM_BOT_USERNAME) {
    return undefined;
  }

  const link = `t.me/${TELEGRAM_BOT_USERNAME}?start=u_${userId}`;

  return {
    inline_keyboard: [
      [
        {
          text: 'Скопировать ссылку',
          copy_text: { text: link },
        },
      ],
    ],
  };
}

function buildRecipientText(record) {
  const lines = ['💬 У тебя новое сообщение!'];

  if (record.text) {
    lines.push('', `«${record.text}»`);
  }

  lines.push('', `${formatAnonId(record.anon_id)} ↩️ Свайпни для ответа.`);
  return lines.join('\n');
}

async function insertMessage(message, targetUserId) {
  const payload = {
    telegram_message_id: message.message_id,
    target_user_id: targetUserId,
    user_id: message.from.id,
    username: message.from.username || '',
    name: getSenderName(message.from),
    kind: getMessageKind(message),
    text: getMessageText(message),
    created_at: getMessageDate(message),
    raw: message,
  };

  const { body } = await supabaseRequest(`${SUPABASE_TABLE}?on_conflict=user_id,telegram_message_id`, {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(payload),
  });

  return Array.isArray(body) ? body[0] : body;
}

async function updateAdminMessageId(anonId, adminMessageId) {
  await supabaseRequest(`${SUPABASE_TABLE}?anon_id=eq.${anonId}`, {
    method: 'PATCH',
    body: JSON.stringify({ admin_message_id: adminMessageId }),
  });
}

async function findMessageByAnonId(anonId) {
  const { body } = await supabaseRequest(`${SUPABASE_TABLE}?anon_id=eq.${anonId}&select=*`, {
    method: 'GET',
    headers: {
      Prefer: 'return=representation',
    },
  });

  return Array.isArray(body) ? body[0] || null : body || null;
}

async function findMessageByAdminMessageId(adminMessageId) {
  const { body } = await supabaseRequest(
    `${SUPABASE_TABLE}?admin_message_id=eq.${adminMessageId}&select=*`,
    {
      method: 'GET',
      headers: {
        Prefer: 'return=representation',
      },
    }
  );

  return Array.isArray(body) ? body[0] || null : body || null;
}

async function getStats() {
  const { headers, body } = await supabaseRequest(
    `${SUPABASE_TABLE}?select=anon_id&order=anon_id.desc&limit=1`,
    {
      method: 'GET',
      headers: {
        Prefer: 'count=exact',
      },
    }
  );

  const contentRange = headers.get('content-range') || '';
  const totalMatch = contentRange.match(/\/(\d+|\*)$/);
  const totalCount = totalMatch && totalMatch[1] !== '*' ? Number(totalMatch[1]) : 0;
  const latest = Array.isArray(body) && body.length ? Number(body[0].anon_id || 0) : 0;

  return {
    totalCount,
    latest,
  };
}

async function trimOldMessages() {
  if (!MAX_STORED_MESSAGES || MAX_STORED_MESSAGES <= 0) return;

  const { headers } = await supabaseRequest(
    `${SUPABASE_TABLE}?select=anon_id&order=anon_id.desc&limit=1`,
    {
      method: 'GET',
      headers: {
        Prefer: 'count=exact',
      },
    }
  );

  const contentRange = headers.get('content-range') || '';
  const totalMatch = contentRange.match(/\/(\d+|\*)$/);
  const totalCount = totalMatch && totalMatch[1] !== '*' ? Number(totalMatch[1]) : 0;

  const overflow = totalCount - MAX_STORED_MESSAGES;
  if (overflow <= 0) return;

  const { body } = await supabaseRequest(
    `${SUPABASE_TABLE}?select=anon_id&order=anon_id.asc&limit=${overflow}`,
    {
      method: 'GET',
    }
  );

  const ids = Array.isArray(body) ? body.map((row) => row.anon_id).filter(Boolean) : [];
  if (!ids.length) return;

  await supabaseRequest(`${SUPABASE_TABLE}?anon_id=in.(${ids.join(',')})`, {
    method: 'DELETE',
  });
}

async function upsertSession(chatId, targetUserId) {
  const payload = {
    chat_id: chatId,
    target_user_id: targetUserId,
    updated_at: new Date().toISOString(),
  };

  const { body } = await supabaseRequest(`${SUPABASE_SESSIONS_TABLE}?on_conflict=chat_id`, {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(payload),
  });

  return Array.isArray(body) ? body[0] : body;
}

async function findSessionByChatId(chatId) {
  const { body } = await supabaseRequest(
    `${SUPABASE_SESSIONS_TABLE}?chat_id=eq.${chatId}&select=*`,
    {
      method: 'GET',
      headers: {
        Prefer: 'return=representation',
      },
    }
  );

  return Array.isArray(body) ? body[0] || null : body || null;
}

async function sendToAdmin(record) {
  const sent = await safeTelegramRequest(
    'sendMessage',
    {
      chat_id: TELEGRAM_ADMIN_ID,
      text: buildAdminText(record),
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Ответить пользователю',
              callback_data: `reply:${record.anon_id}`,
            },
          ],
        ],
      },
    },
    'Failed to send admin notification'
  );

  if (!sent?.message_id) {
    return null;
  }

  await updateAdminMessageId(record.anon_id, sent.message_id);
  return sent;
}

async function sendToRecipient(record) {
  if (!record.target_user_id) {
    return { ok: false, skipped: true, error: 'missing-target' };
  }

  try {
    const result = await telegramRequest('sendMessage', {
      chat_id: record.target_user_id,
      text: buildRecipientText(record),
    });

    return { ok: true, result };
  } catch (error) {
    console.error('Failed to forward anonymous message to recipient', error);
    return { ok: false, error: error.message || 'Failed to forward anonymous message to recipient' };
  }
}

async function replyToUser(target, text) {
  await safeTelegramRequest(
    'sendMessage',
    {
      chat_id: target.user_id,
      text,
    },
    'Failed to reply to user'
  );
}

async function handleAdminCommand(message) {
  const parts = message.text.trim().split(/\s+/);
  const command = parts[0].toLowerCase();

  if (command === '/who' || command === '/lookup') {
    const anonId = Number((parts[1] || '').replace(/[^0-9]/g, ''));

    if (!anonId) {
      await safeTelegramRequest(
        'sendMessage',
        {
          chat_id: TELEGRAM_ADMIN_ID,
          text: 'Используй так: /who 12',
        },
        'Failed to send /who usage hint'
      );
      return;
    }

    const record = await findMessageByAnonId(anonId);
    if (!record) {
      await safeTelegramRequest(
        'sendMessage',
        {
          chat_id: TELEGRAM_ADMIN_ID,
          text: `Сообщение ${formatAnonId(anonId)} не найдено.`,
        },
        'Failed to send lookup miss message'
      );
      return;
    }

    await safeTelegramRequest(
      'sendMessage',
      {
        chat_id: TELEGRAM_ADMIN_ID,
        text: buildLookupText(record),
      },
      'Failed to send lookup result'
    );
    return;
  }

  if (command === '/clear' || command === '/delete') {
    const rawId = parts[1] || '';
    const anonId = Number(rawId.replace(/[^0-9]/g, ''));

    if (anonId) {
      await supabaseRequest(`${SUPABASE_TABLE}?anon_id=eq.${anonId}`, {
        method: 'DELETE',
      });

      await safeTelegramRequest(
        'sendMessage',
        {
          chat_id: TELEGRAM_ADMIN_ID,
          text: `Сообщение ${formatAnonId(anonId)} удалено.`,
        },
        'Failed to send delete confirmation'
      );
    } else {
      await supabaseRequest(`${SUPABASE_TABLE}?anon_id=gte.0`, {
        method: 'DELETE',
      });

      await supabaseRequest(`${SUPABASE_SESSIONS_TABLE}?chat_id=gte.0`, {
        method: 'DELETE',
      });

      await safeTelegramRequest(
        'sendMessage',
        {
          chat_id: TELEGRAM_ADMIN_ID,
          text: 'Все сообщения и сессии удалены.',
        },
        'Failed to send clear confirmation'
      );
    }

    return;
  }

  if (command === '/stats') {
    const stats = await getStats();
    await safeTelegramRequest(
      'sendMessage',
      {
        chat_id: TELEGRAM_ADMIN_ID,
        text: `Хранится ${stats.totalCount} сообщений. Последний anon ID: ${formatAnonId(stats.latest)}`,
      },
      'Failed to send stats message'
    );
    return;
  }

  await safeTelegramRequest(
    'sendMessage',
    {
      chat_id: TELEGRAM_ADMIN_ID,
      text: 'Команды: /who <номер>, /lookup <номер>, /stats, /clear <номер> или /clear (всё)',
    },
    'Failed to send admin help message'
  );
}

async function handleProfileCommand(message) {
  const text = buildInviteText(message.from.id);
  const reply_markup = buildInviteKeyboard(message.from.id);

  await safeTelegramRequest(
    'sendMessage',
    {
      chat_id: message.chat.id,
      text,
      reply_markup,
    },
    'Failed to send profile link'
  );
}

async function handleStartCommand(message) {
  const targetUserId = getDeepLinkTargetId(message.text || '');

  if (targetUserId) {
    await upsertSession(message.from.id, targetUserId);
    await safeTelegramRequest(
      'sendMessage',
      {
        chat_id: message.chat.id,
        text: [
          'Ок, теперь пиши сообщение.',
          'Я отправлю его анонимно.',
        ].join('\n'),
      },
      'Failed to send deep link confirmation'
    );
    return true;
  }

  const text = buildInviteText(message.from.id);
  const reply_markup = buildInviteKeyboard(message.from.id);

  await safeTelegramRequest(
    'sendMessage',
    {
      chat_id: message.chat.id,
      text,
      reply_markup,
    },
    'Failed to send default start message'
  );

  return true;
}

async function handleMessage(message) {
  if (typeof message.text === "string" && message.text.startsWith("/profile")) {
    await handleProfileCommand(message);
    return;
  }

  if (typeof message.text === "string" && message.text.startsWith("/start")) {
    await handleStartCommand(message);
    return;
  }

  if (message.from?.id === TELEGRAM_ADMIN_ID) {
    if (typeof message.text === "string" && message.text.startsWith("/")) {
      await handleAdminCommand(message);
      return;
    }

    if (message.reply_to_message && message.text) {
      let target = await findMessageByAdminMessageId(message.reply_to_message.message_id);

      if (!target) {
        const anonMatch = (message.reply_to_message.text || '').match(/#(\d+)/);
        if (anonMatch) {
          target = await findMessageByAnonId(Number(anonMatch[1]));
        }
      }

      if (!target) {
        await safeTelegramRequest(
          'sendMessage',
          {
            chat_id: TELEGRAM_ADMIN_ID,
            text: 'Не удалось найти пользователя. Ответь именно на сообщение бота с логом.',
          },
          'Failed to send reply lookup miss message'
        );
        return;
      }

      await replyToUser(target, message.text);
      await safeTelegramRequest(
        'sendMessage',
        {
          chat_id: TELEGRAM_ADMIN_ID,
          text: `Ответ отправлен пользователю ${target.name} (${formatAnonId(target.anon_id)}).`,
        },
        'Failed to send reply confirmation'
      );
      return;
    }
  }

  const session = await findSessionByChatId(message.from.id);
  if (!session?.target_user_id) {
    const text = buildInviteText(message.from.id);
    const reply_markup = buildInviteKeyboard(message.from.id);

    await safeTelegramRequest(
      'sendMessage',
      {
        chat_id: message.chat.id,
        text,
        reply_markup,
      },
      'Failed to send invite'
    );
    return;
  }

  const record = await insertMessage(message, Number(session.target_user_id));
  await trimOldMessages();

  const targetChatId = Number(session.target_user_id);
  const kind = getMessageKind(message);

  if (kind !== 'text') {
    await safeTelegramRequest(
      'copyMessage',
      {
        chat_id: targetChatId,
        from_chat_id: message.chat.id,
        message_id: message.message_id,
      },
      'Failed to copy media'
    );
  }

  const text = buildRecipientText(record);
  const sent = await safeTelegramRequest(
    'sendMessage',
    {
      chat_id: targetChatId,
      text,
    },
    'Failed to forward text'
  );

  if (sent?.message_id) {
    try {
      await updateAdminMessageId(record.anon_id, sent.message_id);
    } catch (_) {}
  }

  await safeTelegramRequest(
    'sendMessage',
    {
      chat_id: message.chat.id,
      text: 'Сообщение отправлено.',
    },
    'Failed to send user acknowledgement'
  );
}

async function handleCallback(callbackQuery) {
  if (!callbackQuery.data) return;

  if (callbackQuery.data.startsWith('reply:')) {
    await safeTelegramRequest(
      'answerCallbackQuery',
      {
        callback_query_id: callbackQuery.id,
        text: 'Ответь на сообщение бота текстом, чтобы отправить его пользователю.',
      },
      'Failed to answer callback query'
    );
    return;
  }

}

module.exports = async (req, res) => {
  try {
    requireEnv('TELEGRAM_BOT_TOKEN', TELEGRAM_TOKEN);
    requireEnv('TELEGRAM_ADMIN_ID', TELEGRAM_ADMIN_ID);
    requireEnv('SUPABASE_URL', SUPABASE_URL);
    requireEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY);

    if (TELEGRAM_SECRET) {
      const incomingSecret = req.headers['x-telegram-bot-api-secret-token'];
      if (incomingSecret !== TELEGRAM_SECRET) {
        return text(res, 401, 'Unauthorized');
      }
    }

    if (req.method === 'GET') {
      return json(res, 200, { ok: true, status: 'webhook-ready' });
    }

    if (req.method !== 'POST') {
      return text(res, 405, 'Method Not Allowed');
    }

    const update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    if (update.message) {
      await handleMessage(update.message);
    } else if (update.callback_query) {
      await handleCallback(update.callback_query);
    }

    return json(res, 200, { ok: true });
  } catch (error) {
    console.error(error);
    return json(res, 500, { ok: false, error: error.message || 'Internal Server Error' });
  }
};
