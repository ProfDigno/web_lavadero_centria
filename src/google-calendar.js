const crypto = require("crypto");
const config = require("./config");
const { query } = require("./db");

const SCOPES = ["https://www.googleapis.com/auth/calendar"];
let google;

function googleApi() {
  if (!google) ({ google } = require("googleapis"));
  return google;
}

function isConfigured() {
  return Boolean(config.googleCalendar.clientId && config.googleCalendar.clientSecret);
}

function encryptionKey() {
  return crypto.createHash("sha256").update(String(config.sessionSecret)).digest();
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(":");
}

function decrypt(value) {
  const [iv, tag, encrypted] = String(value || "").split(":");
  if (!iv || !tag || !encrypted) throw new Error("El token de Google Calendar es invalido.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]).toString("utf8");
}

function createOAuthClient() {
  if (!isConfigured()) throw new Error("Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en la configuracion.");
  return new (googleApi().auth.OAuth2)(
    config.googleCalendar.clientId,
    config.googleCalendar.clientSecret,
    config.googleCalendar.redirectUri
  );
}

async function getConfig() {
  const result = await query(`select id, account_email, calendar_id, calendar_name, reminder_minutes,
                                     sync_enabled, connected_at, updated_at, refresh_token_encrypted is not null as connected
                              from google_calendar_config where id = 1`);
  return result.rows[0] || {
    id: 1,
    account_email: null,
    calendar_id: null,
    calendar_name: config.googleCalendar.calendarName,
    reminder_minutes: config.googleCalendar.reminderMinutes,
    sync_enabled: true,
    connected: false
  };
}

function authorizationUrl(state) {
  return createOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state
  });
}

async function saveOAuthTokens(tokens) {
  if (!tokens.refresh_token) throw new Error("Google no devolvio un token de actualizacion.");
  const oauth = createOAuthClient();
  oauth.setCredentials(tokens);
  const oauth2 = googleApi().oauth2({ version: "v2", auth: oauth });
  const about = await oauth2.userinfo.get();
  await query(`update google_calendar_config
               set refresh_token_encrypted = $1, account_email = $2, calendar_id = null,
                   calendar_name = $3, connected_at = now(), updated_at = now()
               where id = 1`, [encrypt(tokens.refresh_token), about.data.email || null, config.googleCalendar.calendarName]);
  return about.data;
}

async function exchangeCode(code) {
  const oauth = createOAuthClient();
  const { tokens } = await oauth.getToken(code);
  return saveOAuthTokens(tokens);
}

async function getAuthorizedClient() {
  const result = await query(`select refresh_token_encrypted from google_calendar_config where id = 1`);
  const encrypted = result.rows[0]?.refresh_token_encrypted;
  if (!encrypted) return null;
  const oauth = createOAuthClient();
  oauth.setCredentials({ refresh_token: decrypt(encrypted) });
  return oauth;
}

async function listCalendars() {
  const oauth = await getAuthorizedClient();
  if (!oauth) return [];
  const calendar = googleApi().calendar({ version: "v3", auth: oauth });
  const items = [];
  let pageToken;
  do {
    const response = await calendar.calendarList.list({ pageToken, minAccessRole: "writer", showDeleted: false });
    items.push(...(response.data.items || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);
  return items;
}

async function chooseCalendar(calendarId, calendarName, reminderMinutes) {
  const oauth = await getAuthorizedClient();
  if (!oauth) throw new Error("Conecte primero la cuenta de Google.");
  const calendarApi = googleApi().calendar({ version: "v3", auth: oauth });
  let target;
  if (calendarId) {
    target = (await calendarApi.calendars.get({ calendarId })).data;
  } else {
    const calendars = await listCalendars();
    target = calendars.find((item) => item.summary === calendarName);
    if (!target) {
      target = (await calendarApi.calendars.insert({ requestBody: { summary: calendarName, timeZone: config.googleCalendar.timezone } })).data;
    }
  }
  const minutes = Math.max(0, Math.min(40320, Number(reminderMinutes || 60)));
  await query(`update google_calendar_config
               set calendar_id = $1, calendar_name = $2, reminder_minutes = $3,
                   sync_enabled = true, updated_at = now() where id = 1`, [target.id, target.summary || calendarName, minutes]);
  return target;
}

async function disconnect() {
  const oauth = await getAuthorizedClient();
  if (oauth) {
    try { await oauth.revokeCredentials(); } catch (_error) {}
  }
  await query(`update google_calendar_config
               set refresh_token_encrypted = null, account_email = null, calendar_id = null,
                   sync_enabled = false, connected_at = null, updated_at = now() where id = 1`);
}

function eventDateTime(date, time) {
  const normalizedTime = String(time || "00:00").slice(0, 5);
  return `${String(date).slice(0, 10)}T${normalizedTime}:00`;
}

function addMinutesToEventDateTime(date, time, minutes) {
  const [year, month, day] = String(date).slice(0, 10).split("-").map(Number);
  const [hour, minute] = String(time || "00:00").slice(0, 5).split(":").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day, hour, minute));
  value.setUTCMinutes(value.getUTCMinutes() + Number(minutes || 0));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}T${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}:00`;
}

function buildEvent(reservation, settings) {
  const title = `Reserva - ${reservation.cliente_nombre || "Cliente"}${reservation.chapa ? ` (${reservation.chapa})` : ""}`;
  const description = [
    `Cliente: ${reservation.cliente_nombre || "-"}`,
    `Chapa: ${reservation.chapa || "-"}`,
    `Teléfono: ${reservation.telefono || "-"}`,
    `Servicios: ${reservation.servicios || "-"}`,
    `Monto estimado: ${reservation.monto || 0}`
  ].join("\n");
  const start = eventDateTime(reservation.fecha_reserva, reservation.hora_reserva);
  const end = addMinutesToEventDateTime(reservation.fecha_reserva, reservation.hora_reserva, 60);
  return {
    summary: title,
    description,
    location: "LAVADERO CENTRIA",
    start: { dateTime: start, timeZone: config.googleCalendar.timezone },
    end: { dateTime: end, timeZone: config.googleCalendar.timezone },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: Number(settings.reminder_minutes || 60) }] },
    extendedProperties: { private: { lavaderoReservationId: String(reservation.id) } }
  };
}

async function syncReservation(reservation) {
  const settings = await getConfig();
  if (!settings.connected || !settings.calendar_id || !settings.sync_enabled) return { skipped: true };
  const oauth = await getAuthorizedClient();
  const calendarApi = googleApi().calendar({ version: "v3", auth: oauth });
  const body = buildEvent(reservation, settings);
  let response;
  if (reservation.google_event_id) {
    try {
      response = await calendarApi.events.update({ calendarId: settings.calendar_id, eventId: reservation.google_event_id, requestBody: body });
    } catch (error) {
      if (error.code !== 404) throw error;
      response = await calendarApi.events.insert({ calendarId: settings.calendar_id, requestBody: body });
    }
  } else {
    response = await calendarApi.events.insert({ calendarId: settings.calendar_id, requestBody: body });
  }
  await query(`update reservas_lavado set google_event_id = $1, google_sync_status = 'SINCRONIZADO',
               google_synced_at = now(), google_sync_error = null where idreserva_lavado = $2`, [response.data.id, reservation.id]);
  return response.data;
}

async function removeReservationEvent(reservation) {
  if (!reservation?.google_event_id) return { skipped: true };
  const settings = await getConfig();
  if (settings.connected && settings.calendar_id) {
    const oauth = await getAuthorizedClient();
    const calendarApi = googleApi().calendar({ version: "v3", auth: oauth });
    try {
      await calendarApi.events.delete({ calendarId: settings.calendar_id, eventId: reservation.google_event_id });
    } catch (error) {
      if (error.code !== 404) throw error;
    }
  }
  await query(`update reservas_lavado set google_event_id = null, google_sync_status = 'NO_APLICA',
               google_synced_at = now(), google_sync_error = null where idreserva_lavado = $1`, [reservation.id]);
  return { removed: true };
}

async function markSyncError(reservationId, error) {
  await query(`update reservas_lavado set google_sync_status = 'ERROR', google_sync_error = $1 where idreserva_lavado = $2`,
    [String(error.message || error).slice(0, 2000), reservationId]);
}

module.exports = {
  authorizationUrl,
  chooseCalendar,
  disconnect,
  exchangeCode,
  getConfig,
  isConfigured,
  listCalendars,
  markSyncError,
  removeReservationEvent,
  syncReservation
};
