(function () {
  const form = document.querySelector("[data-compra-form]");
  if (!form) return;
  const items = form.querySelector("[data-compra-items]");
  const template = document.querySelector("[data-compra-item-template]");
  const money = (value) => `Gs. ${new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(Number(value || 0))}`;
  const payment = form.querySelector("[data-compra-payment]");
  form.querySelectorAll("[data-compra-payment-option]").forEach((button) => button.addEventListener("click", () => {
    payment.value = button.dataset.compraPaymentOption;
    form.querySelectorAll("[data-compra-payment-option]").forEach((other) => {
      const active = other === button;
      other.classList.toggle("is-active", active);
      other.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }));
  form.querySelectorAll("[data-compra-condition-option]").forEach((radio) => radio.addEventListener("change", () => {
    if (radio.checked) form.querySelector("[data-compra-condition]").value = radio.value;
  }));
  function total() {
    let amount = 0;
    items.querySelectorAll("[data-compra-item]").forEach((row) => {
      const option = row.querySelector("[data-compra-product]").selectedOptions[0];
      row.querySelector("[data-compra-stock]").textContent = option?.value ? option.dataset.stock : "—";
      const subtotal = Number(row.querySelector("[data-compra-price]").value || 0) * Number(row.querySelector("[data-compra-quantity]").value || 0);
      row.querySelector("[data-compra-subtotal]").textContent = money(subtotal);
      amount += subtotal;
    });
    form.querySelector("[data-compra-total]").textContent = money(amount);
  }
  function bind(row) {
    row.querySelector("[data-compra-product]").addEventListener("change", (event) => {
      row.querySelector("[data-compra-price]").value = event.target.selectedOptions[0]?.dataset.price || "0";
      total();
    });
    row.querySelector("[data-compra-price]").addEventListener("input", total);
    row.querySelector("[data-compra-quantity]").addEventListener("input", total);
    row.querySelector("[data-remove-compra-item]").addEventListener("click", () => {
      if (items.querySelectorAll("[data-compra-item]").length > 1) row.remove();
      else {
        row.querySelector("[data-compra-product]").value = "";
        row.querySelector("[data-compra-price]").value = "0";
        row.querySelector("[data-compra-quantity]").value = "1";
      }
      total();
    });
  }
  items.querySelectorAll("[data-compra-item]").forEach(bind);
  document.querySelector("[data-add-compra-item]").addEventListener("click", () => {
    const row = template.content.cloneNode(true).firstElementChild;
    items.appendChild(row);
    bind(row);
    total();
  });
  form.addEventListener("submit", (event) => {
    const selected = [...items.querySelectorAll("[data-compra-product]")].map((node) => node.value).filter(Boolean);
    if (!selected.length || new Set(selected).size !== selected.length) {
      event.preventDefault();
      window.alert("Seleccione al menos un producto y no repita productos.");
    }
  });
  total();
})();
