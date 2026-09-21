(function () {
  const dataNode = document.getElementById("analysis-compras-data");
  if (!dataNode || !window.Chart) return;
  const data = JSON.parse(dataNode.textContent || "{}");
  const money = (value) => `Gs. ${new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(Number(value || 0))}`;
  function chart(name) { return document.querySelector(`[data-purchases-chart="${name}"]`); }
  function horizontal(name, values, label, isMoney, colors) {
    const node = chart(name);
    if (!node || !values.length) return;
    new Chart(node, {
      type: "bar",
      data: { labels: values.map((item) => item.label), datasets: [{ label, data: values.map((item) => item.value), backgroundColor: colors || "#0f766e", borderRadius: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => isMoney ? money(ctx.raw) : String(ctx.raw) } } }, scales: { x: { beginAtZero: true, ticks: { callback: (v) => isMoney ? money(v) : v } }, y: { grid: { display: false } } } }
    });
  }
  if (data.daily?.length) new Chart(chart("daily"), {
    type: "bar",
    data: { labels: data.daily.map((item) => item.label), datasets: [
      { label: "Monto comprado", data: data.daily.map((item) => item.total), backgroundColor: "rgba(31, 111, 235, .72)", yAxisID: "money", borderRadius: 6 },
      { type: "line", label: "Compras", data: data.daily.map((item) => item.compras), borderColor: "#0f766e", backgroundColor: "#0f766e", yAxisID: "count", tension: .25 }
    ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, scales: { count: { beginAtZero: true, position: "left", grid: { display: false } }, money: { beginAtZero: true, position: "right", ticks: { callback: money } } } }
  });
  horizontal("payments", data.payments || [], "Total", true, (data.payments || []).map((item) => item.color || "#0f766e"));
  horizontal("products", data.products || [], "Unidades", false, "#7c3aed");
  horizontal("suppliers", data.suppliers || [], "Total", true, "#b45309");
})();
