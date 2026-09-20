const config = require("./config");
const { query } = require("./db");

function maskSecret(value) {
  const text = String(value || "");
  if (!text) return "";
  return text.length <= 4 ? "••••" : `${"•".repeat(Math.min(12, text.length - 4))}${text.slice(-4)}`;
}

function validTimezone(value) {
  try {
    new Intl.DateTimeFormat("es-PY", { timeZone: value }).format();
    return true;
  } catch (_error) {
    return false;
  }
}

function validateTelegramSettingsInput(input) {
  const name = String(input.botName || "").trim();
  const timezone = String(input.timezone || "").trim();
  const reminderMinutes = Number(input.reminderMinutes);
  const pin = String(input.pin || "").trim();
  if (!name || name.length > 120) throw new Error("El nombre del bot es obligatorio y no puede superar 120 caracteres.");
  if (!Number.isInteger(reminderMinutes) || reminderMinutes < 1 || reminderMinutes > 1440) {
    throw new Error("El recordatorio debe estar entre 1 y 1440 minutos.");
  }
  if (!validTimezone(timezone)) throw new Error("La zona horaria no es válida.");
  if (pin && !/^\d{4,10}$/.test(pin)) throw new Error("El PIN debe tener entre 4 y 10 dígitos.");
  return { name, timezone, reminderMinutes, pin };
}

async function getRawTelegramSettings() {
  const result = await query(
    `select idtelegram_config, nombre_bot, bot_token, pin_universal, activo,
            reminder_minutes, timezone, actualizado_en, actualizado_por
     from telegram_config where idtelegram_config = 1`
  );
  if (result.rows[0]) {
    if (result.rows[0].bot_token !== null) return result.rows[0];
    const seeded = await query(
      `update telegram_config
       set nombre_bot = $1, bot_token = $2, pin_universal = $3, activo = $4,
           reminder_minutes = $5, timezone = $6, actualizado_en = now(), actualizado_por = 'Sistema'
       where idtelegram_config = 1
       returning idtelegram_config, nombre_bot, bot_token, pin_universal, activo,
                 reminder_minutes, timezone, actualizado_en, actualizado_por`,
      [
        config.telegram.botName,
        config.telegram.token || "",
        config.telegram.universalPin || "",
        config.telegram.enabled,
        config.telegram.reservationReminderMinutes,
        config.telegram.reservationTimezone
      ]
    );
    return seeded.rows[0];
  }

  const seeded = await query(
    `insert into telegram_config
       (idtelegram_config, nombre_bot, bot_token, pin_universal, activo, reminder_minutes, timezone, actualizado_por)
     values (1, $1, $2, $3, $4, $5, $6, 'Sistema')
     returning idtelegram_config, nombre_bot, bot_token, pin_universal, activo,
               reminder_minutes, timezone, actualizado_en, actualizado_por`,
    [
      config.telegram.botName,
      config.telegram.token || "",
      config.telegram.universalPin || "",
      config.telegram.enabled,
      config.telegram.reservationReminderMinutes,
      config.telegram.reservationTimezone
    ]
  );
  return seeded.rows[0];
}

function applyTelegramSettings(settings) {
  config.telegram.botName = settings.nombre_bot || "Lavadero Centria";
  config.telegram.token = settings.activo ? String(settings.bot_token || "") : "";
  config.telegram.universalPin = String(settings.pin_universal || "").trim();
  config.telegram.enabled = Boolean(settings.activo);
  config.telegram.reservationReminderMinutes = Number(settings.reminder_minutes) || 60;
  config.telegram.reservationTimezone = settings.timezone || "America/Asuncion";
  return settings;
}

async function loadTelegramSettings() {
  const settings = await getRawTelegramSettings();
  return applyTelegramSettings(settings);
}

async function getTelegramConfigForView() {
  const settings = await getRawTelegramSettings();
  return {
    nombre_bot: settings.nombre_bot,
    activo: Boolean(settings.activo),
    reminder_minutes: Number(settings.reminder_minutes),
    timezone: settings.timezone,
    token_configurado: Boolean(settings.bot_token),
    token_enmascarado: maskSecret(settings.bot_token),
    pin_configurado: Boolean(settings.pin_universal),
    actualizado_en: settings.actualizado_en,
    actualizado_por: settings.actualizado_por
  };
}

async function saveTelegramSettings(input, updatedBy) {
  const validated = validateTelegramSettingsInput(input);
  const current = await getRawTelegramSettings();
  const token = String(input.botToken || "").trim() || (input.clearToken ? "" : String(current.bot_token || ""));
  const pin = validated.pin || (input.clearPin ? "" : String(current.pin_universal || ""));
  const result = await query(
    `update telegram_config
     set nombre_bot = $1, bot_token = $2, pin_universal = $3,
         activo = $4, reminder_minutes = $5, timezone = $6,
         actualizado_en = now(), actualizado_por = $7
     where idtelegram_config = 1
     returning idtelegram_config, nombre_bot, bot_token, pin_universal, activo,
               reminder_minutes, timezone, actualizado_en, actualizado_por`,
    [validated.name, token, pin, Boolean(input.active), validated.reminderMinutes, validated.timezone, updatedBy || "Sistema"]
  );
  return applyTelegramSettings(result.rows[0]);
}

async function listTelegramAuthorizations() {
  const result = await query(
    `select chat_id, nombre_usuario, nombre_visible, autorizado_en, ultimo_acceso, activo
     from telegram_autorizaciones order by activo desc, nombre_visible nulls last, chat_id`
  );
  return result.rows;
}

async function setTelegramAuthorizationStatus(chatId, active) {
  const result = await query(
    `update telegram_autorizaciones set activo = $2, ultimo_acceso = now() where chat_id = $1 returning chat_id`,
    [String(chatId), Boolean(active)]
  );
  if (!result.rows[0]) throw new Error("El celular autorizado no existe.");
}

module.exports = {
  applyTelegramSettings,
  getTelegramConfigForView,
  listTelegramAuthorizations,
  loadTelegramSettings,
  maskSecret,
  saveTelegramSettings,
  setTelegramAuthorizationStatus,
  validateTelegramSettingsInput
};
