const config = require("./config");
const { query } = require("./db");

const CHECK_INTERVAL_MS = 60 * 1000;
const MAX_ATTEMPTS = 3;

let telegramBot = null;
let workerTimer = null;
let processing = false;

function mergeRecipientChatIds(configuredIds, authorizedRows) {
  return [...new Set([
    ...(configuredIds || []).map(String),
    ...(authorizedRows || []).map((row) => String(row.chat_id || ""))
  ].map((value) => value.trim()).filter(Boolean))];
}

async function recipientChatIds() {
  const result = await query(
    `select chat_id from telegram_autorizaciones where activo = true order by autorizado_en, chat_id`
  );
  return mergeRecipientChatIds(config.telegram.allowedChatIds, result.rows);
}

function reservationDate(value) {
  if (value instanceof Date) return value;
  const date = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00`) : new Date(value);
}

function formatReservationDate(value) {
  return new Intl.DateTimeFormat("es-PY", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: config.telegram.reservationTimezone
  }).format(reservationDate(value));
}

function formatReservationTime(value) {
  return String(value || "").slice(0, 5);
}

function formatMoney(value) {
  return `${new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(Number(value || 0))} Gs.`;
}

function notificationMessage(notification) {
  const heading = notification.tipo === "RECORDATORIO"
    ? `⏰ Recordatorio: lavado en ${config.telegram.reservationReminderMinutes} minutos`
    : `🆕 Reserva #${notification.reservation_id} agendada`;
  return [
    heading,
    `📅 ${formatReservationDate(notification.fecha_reserva)} a las ${formatReservationTime(notification.hora_reserva)}`,
    `👤 Cliente: ${notification.cliente_nombre || "-"}`,
    `🚗 Chapa: ${notification.chapa || "-"}`,
    `📞 Teléfono: ${notification.telefono || "-"}`,
    `🧽 Servicios: ${notification.servicios || "-"}`,
    `💰 Monto: ${formatMoney(notification.monto)}`
  ].join("\n");
}

async function createNotifications(reservationIds, type) {
  const ids = [...new Set((reservationIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return 0;
  const chatIds = await recipientChatIds();
  if (!chatIds.length) return 0;
  const result = await query(
    `insert into telegram_reserva_notificaciones
       (fk_idreserva_lavado, chat_id, tipo, estado)
     select reservation_id, chat_id, $3, 'PENDIENTE'
     from unnest($1::int[]) as reservation_id
     cross join unnest($2::varchar[]) as chat_id
     on conflict (fk_idreserva_lavado, chat_id, tipo) do nothing
     returning idtelegram_reserva_notificacion`,
    [ids, chatIds, type]
  );
  return result.rows.length;
}

async function queueReservationConfirmation(reservationId) {
  await createNotifications([reservationId], "CONFIRMACION");
  if (telegramBot) await processPendingNotifications();
}

async function createDueReminderNotifications() {
  const result = await query(
    `select r.idreserva_lavado as id
     from reservas_lavado r
     where r.estado not in ('CANCELADO', 'CARGADO')
       and ((r.fecha_reserva + r.hora_reserva) at time zone $2) > now()
       and ((r.fecha_reserva + r.hora_reserva) at time zone $2) <= now() + ($1 * interval '1 minute')
     order by r.fecha_reserva, r.hora_reserva, r.idreserva_lavado`,
    [config.telegram.reservationReminderMinutes, config.telegram.reservationTimezone]
  );
  return createNotifications(result.rows.map((row) => row.id), "RECORDATORIO");
}

async function omitInvalidNotifications() {
  await query(
    `update telegram_reserva_notificaciones n
     set estado = 'OMITIDO', ultimo_error = null
     from reservas_lavado r
     where r.idreserva_lavado = n.fk_idreserva_lavado
       and n.estado in ('PENDIENTE', 'ERROR')
       and (
         r.estado in ('CANCELADO', 'CARGADO')
         or (n.tipo = 'RECORDATORIO'
             and ((r.fecha_reserva + r.hora_reserva) at time zone $1) <= now())
       )`,
    [config.telegram.reservationTimezone]
  );
}

async function pendingNotifications() {
  const result = await query(
    `select n.idtelegram_reserva_notificacion as notification_id,
            n.chat_id, n.tipo, n.intentos,
            r.idreserva_lavado as reservation_id,
            to_char(r.fecha_reserva, 'YYYY-MM-DD') as fecha_reserva,
            r.hora_reserva, r.monto,
            c.nombre as cliente_nombre, c.chapa, c.telefono,
            coalesce(string_agg(s.nombre, ', ' order by rls.idreserva_lavado_servicio), '') as servicios
     from telegram_reserva_notificaciones n
     join reservas_lavado r on r.idreserva_lavado = n.fk_idreserva_lavado
     join clientes c on c.idcliente = r.fk_idcliente
     left join reserva_lavado_servicios rls on rls.fk_idreserva_lavado = r.idreserva_lavado
     left join servicios s on s.idservicio = rls.fk_idservicio
     where n.estado in ('PENDIENTE', 'ERROR')
       and n.intentos < $1
       and r.estado not in ('CANCELADO', 'CARGADO')
       and (n.tipo <> 'RECORDATORIO'
            or ((r.fecha_reserva + r.hora_reserva) at time zone $2) > now())
     group by n.idtelegram_reserva_notificacion, r.idreserva_lavado, c.idcliente
     order by n.creado_en, n.idtelegram_reserva_notificacion`,
    [MAX_ATTEMPTS, config.telegram.reservationTimezone]
  );
  return result.rows;
}

async function recordSuccess(notificationId) {
  await query(
    `update telegram_reserva_notificaciones
     set estado = 'ENVIADO', intentos = intentos + 1, ultimo_error = null,
         ultimo_intento_en = now(), enviado_en = now()
     where idtelegram_reserva_notificacion = $1`,
    [notificationId]
  );
}

async function recordFailure(notificationId, error) {
  await query(
    `update telegram_reserva_notificaciones
     set estado = 'ERROR', intentos = intentos + 1, ultimo_error = $2,
         ultimo_intento_en = now()
     where idtelegram_reserva_notificacion = $1`,
    [notificationId, String(error.message || error).slice(0, 2000)]
  );
}

async function processPendingNotifications() {
  if (!telegramBot || processing) return;
  processing = true;
  try {
    await omitInvalidNotifications();
    const notifications = await pendingNotifications();
    for (const notification of notifications) {
      try {
        await telegramBot.sendMessage(notification.chat_id, notificationMessage(notification));
        await recordSuccess(notification.notification_id);
      } catch (error) {
        await recordFailure(notification.notification_id, error);
        console.error(`No se pudo enviar la notificación Telegram #${notification.notification_id}:`, error.message);
      }
    }
  } finally {
    processing = false;
  }
}

async function runWorker() {
  try {
    await createDueReminderNotifications();
    await processPendingNotifications();
  } catch (error) {
    console.error("No se pudo procesar las notificaciones de reservas por Telegram:", error.message);
  }
}

function startReservationNotificationWorker(bot) {
  telegramBot = bot || null;
  if (!telegramBot || workerTimer) return;
  runWorker();
  workerTimer = setInterval(runWorker, CHECK_INTERVAL_MS);
  workerTimer.unref();
  console.log(`Recordatorios Telegram activos: ${config.telegram.reservationReminderMinutes} minutos antes.`);
}

async function sendTestNotificationToAll() {
  if (!telegramBot) throw new Error("El bot de Telegram no está conectado.");
  const chatIds = await recipientChatIds();
  if (!chatIds.length) throw new Error("No hay celulares autorizados para recibir notificaciones.");
  for (const chatId of chatIds) {
    await telegramBot.sendMessage(
      chatId,
      "✅ Notificaciones de LAVADERO CENTRIA activadas correctamente. Este celular recibirá confirmaciones y recordatorios de reservas."
    );
  }
  return chatIds.length;
}

async function omitReservationNotifications(reservationId) {
  await query(
    `update telegram_reserva_notificaciones
     set estado = 'OMITIDO', ultimo_error = null
     where fk_idreserva_lavado = $1 and estado in ('PENDIENTE', 'ERROR')`,
    [reservationId]
  );
}

module.exports = {
  mergeRecipientChatIds,
  notificationMessage,
  omitReservationNotifications,
  processPendingNotifications,
  queueReservationConfirmation,
  sendTestNotificationToAll,
  startReservationNotificationWorker
};
