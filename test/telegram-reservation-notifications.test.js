const test = require("node:test");
const assert = require("node:assert/strict");

const {
  mergeRecipientChatIds,
  notificationMessage
} = require("../src/telegram-reservation-notifications");

test("combina y elimina destinatarios duplicados", () => {
  assert.deepEqual(
    mergeRecipientChatIds(["100", " 200 ", ""], [{ chat_id: "200" }, { chat_id: "300" }]),
    ["100", "200", "300"]
  );
});

test("genera una confirmación con todos los datos de la reserva", () => {
  const message = notificationMessage({
    tipo: "CONFIRMACION",
    reservation_id: 42,
    fecha_reserva: "2026-09-21",
    hora_reserva: "14:30:00",
    cliente_nombre: "CLIENTE PRUEBA",
    chapa: "ABC123",
    telefono: "+595981000000",
    servicios: "LAVADO COMPLETO",
    monto: 75000
  });

  assert.match(message, /Reserva #42 agendada/);
  assert.match(message, /14:30/);
  assert.match(message, /CLIENTE PRUEBA/);
  assert.match(message, /ABC123/);
  assert.match(message, /\+595981000000/);
  assert.match(message, /LAVADO COMPLETO/);
  assert.match(message, /75\.000 Gs\./);
});

test("identifica claramente el recordatorio", () => {
  const message = notificationMessage({
    tipo: "RECORDATORIO",
    reservation_id: 7,
    fecha_reserva: "2026-09-21",
    hora_reserva: "09:00:00",
    cliente_nombre: "CLIENTE",
    chapa: "XYZ789",
    servicios: "LAVADO",
    monto: 30000
  });

  assert.match(message, /Recordatorio: lavado en 60 minutos/);
});
