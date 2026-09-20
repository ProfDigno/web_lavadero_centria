const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("retira Google Calendar y conserva la agenda interna con Telegram", () => {
  const packageInfo = JSON.parse(read("package.json"));
  const server = read("src/server.js");
  const header = read("src/views/partials/header.ejs");

  assert.equal(packageInfo.dependencies.googleapis, undefined);
  assert.doesNotMatch(server, /app\.(?:get|post)\("\/google-calendar/);
  assert.doesNotMatch(header, /href="\/google-calendar/);
  assert.match(server, /app\.get\("\/calendario"/);
  assert.match(server, /queueReservationConfirmation\(reservationId\)/);
  assert.match(server, /omitReservationNotifications\(/);
  assert.match(header, /href="\/calendario"/);
  assert.match(header, /href="\/telegram\/config"/);
});
