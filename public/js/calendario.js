(function () {
  const root = document.querySelector("[data-calendar-root]");
  if (!root) return;

  const createModal = document.querySelector("[data-calendar-create-modal]");
  const createOpen = document.querySelector("[data-calendar-create-open]");
  const createClose = createModal?.querySelector("[data-calendar-create-close]");
  const modal = document.querySelector("[data-calendar-modal]");
  const list = modal?.querySelector("[data-calendar-reservation-list]");
  const modalDate = modal?.querySelector("[data-calendar-modal-date]");
  const clientSearch = document.querySelector("[data-calendar-client-search]");
  const clientSelect = document.querySelector("[data-calendar-client-select]");
  const serviceSelect = document.querySelector("[data-calendar-service-select]");
  const total = document.querySelector("[data-calendar-total]");

  const money = (value) => new Intl.NumberFormat("es-PY", {
    style: "currency",
    currency: "PYG",
    maximumFractionDigits: 0
  }).format(Number(value || 0));

  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  const dateLabel = (iso) => new Intl.DateTimeFormat("es-PY", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(new Date(`${iso}T12:00:00`));

  function updateTotal() {
    if (!serviceSelect || !total) return;
    const amount = Array.from(serviceSelect.selectedOptions)
      .reduce((sum, option) => sum + Number(option.dataset.price || 0), 0);
    total.textContent = money(amount);
  }

  function filterClients() {
    if (!clientSearch || !clientSelect) return;
    const query = clientSearch.value.trim().toLocaleLowerCase();
    Array.from(clientSelect.options).forEach((option, index) => {
      if (index === 0) return;
      option.hidden = Boolean(query) && !option.textContent.toLocaleLowerCase().includes(query);
    });
  }

  clientSearch?.addEventListener("input", filterClients);
  serviceSelect?.addEventListener("change", updateTotal);
  updateTotal();

  function setCreateModal(open) {
    if (!createModal) return;
    createModal.classList.toggle("is-hidden", !open);
    createModal.setAttribute("aria-hidden", String(!open));
    if (open) createModal.querySelector("select, input")?.focus();
  }

  createOpen?.addEventListener("click", () => setCreateModal(true));
  createClose?.addEventListener("click", () => setCreateModal(false));
  createModal?.addEventListener("click", (event) => {
    if (event.target === createModal) setCreateModal(false);
  });

  async function loadDay(date) {
    if (!modal || !list) return;
    modal.classList.remove("is-hidden");
    modalDate.textContent = dateLabel(date);
    list.innerHTML = '<p class="muted">Cargando reservas...</p>';
    try {
      const response = await fetch(`/calendario/reservas?fecha=${encodeURIComponent(date)}`, { headers: { Accept: "application/json" } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "No se pudieron cargar las reservas.");
      if (!data.reservas.length) {
        list.innerHTML = '<p class="empty-state">No hay reservas para este día.</p>';
        return;
      }
      list.innerHTML = data.reservas.map(renderReservation).join("");
    } catch (error) {
      list.innerHTML = `<div class="flash error">${escapeHtml(error.message)}</div>`;
    }
  }

  function renderReservation(reservation) {
    const terminal = ["CANCELADO", "CARGADO"].includes(reservation.estado);
    const phone = reservation.telefono || "Sin teléfono";
    return `
      <article class="calendar-reservation estado-${escapeHtml(String(reservation.estado).toLowerCase())}">
        <div class="calendar-reservation-main">
          <div class="calendar-reservation-time">${escapeHtml(reservation.hora)}</div>
          <div>
            <strong>${escapeHtml(reservation.cliente_label || "Cliente sin nombre")}</strong>
            <p>${escapeHtml(reservation.servicios || "Sin servicios")}</p>
            <small>${escapeHtml(phone)}</small>
          </div>
        </div>
        <div class="calendar-reservation-footer">
          <div class="calendar-reservation-summary">
            <strong class="calendar-reservation-amount">${escapeHtml(money(reservation.monto))}</strong>
            <span class="calendar-status">${escapeHtml(reservation.estado)}</span>
          </div>
          <div class="calendar-reservation-actions">
            ${!terminal ? `<button type="button" class="secondary" data-calendar-action="notify" data-reservation-id="${reservation.id}">Notificar</button>` : ""}
            ${!terminal ? `<a class="button secondary" href="/lavados?reserva_id=${encodeURIComponent(reservation.id)}">Cargar</a>` : ""}
            ${!terminal ? `<button type="button" class="danger" data-calendar-action="cancel" data-reservation-id="${reservation.id}">Cancelar</button>` : ""}
          </div>
        </div>
      </article>`;
  }

  root.querySelectorAll("[data-calendar-day]").forEach((day) => {
    day.addEventListener("click", () => loadDay(day.dataset.calendarDay));
  });

  modal?.querySelector("[data-calendar-close]")?.addEventListener("click", () => modal.classList.add("is-hidden"));
  modal?.addEventListener("click", (event) => {
    if (event.target === modal) modal.classList.add("is-hidden");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (createModal && !createModal.classList.contains("is-hidden")) {
      setCreateModal(false);
      return;
    }
    if (modal && !modal.classList.contains("is-hidden")) modal.classList.add("is-hidden");
  });

  list?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-calendar-action]");
    if (!button) return;
    const id = button.dataset.reservationId;
    const action = button.dataset.calendarAction;
    if (action === "cancel" && !window.confirm("¿Desea cancelar esta reserva?")) return;
    button.disabled = true;
    try {
      const response = await fetch(`/calendario/reservas/${encodeURIComponent(id)}/${action === "notify" ? "notificar" : "cancelar"}`, {
        method: "POST",
        headers: { Accept: "application/json" }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "No se pudo completar la acción.");
      if (action === "notify") {
        const encodedMessage = encodeURIComponent(data.message || "");
        const isMobile = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const url = isMobile
          ? `whatsapp://send?phone=${data.phone}&text=${encodedMessage}`
          : `https://web.whatsapp.com/send?phone=${data.phone}&text=${encodedMessage}`;
        if (isMobile) window.location.href = url;
        else window.open(url, "_blank", "noopener,noreferrer");
      }
      window.location.reload();
    } catch (error) {
      window.alert(error.message);
      button.disabled = false;
    }
  });

  root.querySelectorAll("[data-calendar-day]").forEach((day) => day.addEventListener("click", () => {
    root.querySelectorAll("[data-calendar-day]").forEach((item) => item.classList.remove("is-selected"));
    day.classList.add("is-selected");
    if (modalDate) modalDate.dataset.iso = day.dataset.calendarDay;
  }));
})();
