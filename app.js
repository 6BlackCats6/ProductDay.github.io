const dashboard = document.querySelector("#dashboard");
const engagementFooter = document.querySelector("#engagement-footer");
const attentionSummary = document.querySelector("#attention-summary");
const template = document.querySelector("#metric-card-template");

const alertRules = {
  "Outdated fulfilments rate": { direction: "higher", warning: 0.2, critical: 0.35, minimum: 0.5 },
  "Funnel time: new → delivered": { direction: "higher", warning: 0.15, critical: 0.3, minimum: 8 },
  "Rejected fulfilments": { direction: "higher", warning: 0.2, critical: 0.35, minimum: 0.3 },
  "Stock-related cancellations": { direction: "higher", warning: 0.2, critical: 0.35, minimum: 0.15 },
  "Ops support tickets / active user": { direction: "higher", warning: 0.2, critical: 0.35, minimum: 0.005 },
  "Customer support tickets / active seller": { direction: "higher", warning: 0.2, critical: 0.35, minimum: 0.03 },
  "Funnel conversion: new → delivered": { direction: "lower", warning: 0.1, critical: 0.2, minimum: 3 },
  "VP bookings adoption": { direction: "lower", warning: 0.1, critical: 0.2, minimum: 5 },
  "Approved POs without changes": { direction: "lower", warning: 0.1, critical: 0.2, minimum: 3 },
  "FBO on-time stock availability": { direction: "lower", warning: 0.15, critical: 0.3, minimum: 3 },
  "GFR on-time stock availability": { direction: "lower", warning: 0.15, critical: 0.3, minimum: 3 },
  "Seller promo coverage": { direction: "lower", warning: 0.1, critical: 0.2, minimum: 2 },
  "SKU promo coverage": { direction: "lower", warning: 0.1, critical: 0.2, minimum: 2 },
  "VP monthly active users": { direction: "lower", warning: 0.1, critical: 0.2, minimum: 100 },
  "Seller adoption rate": { direction: "lower", warning: 0.1, critical: 0.2, minimum: 3 },
  "Average GMV per active seller": { direction: "lower", warning: 0.1, critical: 0.2, minimum: 0.3 },
  "GFR supplier adoption rate": { direction: "lower", warning: 0.1, critical: 0.2, minimum: 3 }
};

fetch("./data/metrics.json")
  .then((response) => {
    if (!response.ok) throw new Error("Could not load metrics snapshot.");
    return response.json();
  })
  .then(renderDashboard)
  .catch(() => {
    dashboard.innerHTML = '<p class="section__description">The dashboard snapshot is temporarily unavailable.</p>';
  });

function renderDashboard(data) {
  document.querySelector("#snapshot-date").textContent = `Source snapshot: ${data.snapshotDate}`;
  const analyses = data.sections.flatMap((section) => section.metrics.map(analyseMetric));
  renderAttentionSummary(analyses);
  data.sections.forEach((section) => {
    const destination = section.placement === "footer" ? engagementFooter : dashboard;
    const sectionElement = document.createElement("section");
    sectionElement.className = "section";
    sectionElement.innerHTML = `<h2 class="section__title">${section.title}</h2><p class="section__description">${section.description}</p>`;
    const grid = document.createElement("div");
    grid.className = "card-grid";
    section.metrics.forEach((metric) => grid.append(createMetricCard(metric, analyses.find((analysis) => analysis.metric === metric))));
    sectionElement.append(grid);
    destination.append(sectionElement);
  });
}

function createMetricCard(metric, analysis) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector(".metric-card");
  const latest = metric.history.at(-1);
  const badge = fragment.querySelector(".trend-badge");
  const value = fragment.querySelector(".metric-value");

  card.id = metricId(metric.name);
  if (analysis.severity) {
    card.dataset.severity = analysis.severity;
    const attentionBadge = fragment.querySelector(".attention-badge");
    attentionBadge.hidden = false;
    attentionBadge.dataset.severity = analysis.severity;
    attentionBadge.textContent = analysis.severity;
  }
  fragment.querySelector("h3").textContent = metric.name;
  badge.textContent = metric.trend.label;
  badge.dataset.trend = metric.trend.kind;
  value.textContent = latest.value;
  value.classList.toggle("is-pending", latest.status === "pending");
  fragment.querySelector(".metric-period").textContent = latest.label;
  fragment.querySelector(".metric-target").textContent = metric.target ? `Target: ${metric.target}` : "";

  const chartHost = fragment.querySelector(".sparkline");
  const numericPoints = metric.history.filter((point) => Number.isFinite(point.numeric));
  if (numericPoints.length > 1) chartHost.append(drawSparkline(numericPoints, metric.trend.kind));

  const history = fragment.querySelector(".history ul");
  metric.history.slice().reverse().forEach((point) => {
    const item = document.createElement("li");
    item.textContent = `${point.label}: ${point.value}`;
    history.append(item);
  });
  return card;
}

function analyseMetric(metric) {
  const rule = alertRules[metric.name];
  if (!rule) return { metric, severity: null };
  const completed = metric.history.filter((point) => Number.isFinite(point.numeric) && !point.partial);
  if (completed.length < 4) return { metric, severity: null, reason: "insufficient_history" };

  const latest = completed.at(-1);
  const baselinePoints = completed.slice(-4, -1);
  const baseline = median(baselinePoints.map((point) => point.numeric));
  const absoluteChange = Math.abs(latest.numeric - baseline);
  const adverseChange = rule.direction === "higher"
    ? (latest.numeric - baseline) / baseline
    : (baseline - latest.numeric) / baseline;
  const severity = adverseChange >= rule.critical && absoluteChange >= rule.minimum
    ? "critical"
    : adverseChange >= rule.warning && absoluteChange >= rule.minimum
      ? "warning"
      : null;

  return { metric, severity, latest, baselinePoints, adverseChange };
}

function renderAttentionSummary(analyses) {
  const flagged = analyses.filter((analysis) => analysis.severity).sort((left, right) => right.adverseChange - left.adverseChange);
  if (!flagged.length) {
    attentionSummary.innerHTML = `<div class="attention-summary__panel" data-state="clear"><div class="attention-summary__header"><h2>No unusual movement detected</h2><p>Based on the latest completed snapshots.</p></div></div>`;
    return;
  }

  const items = flagged.map((analysis) => {
    const direction = alertRules[analysis.metric.name].direction === "higher" ? "increase" : "drop";
    const comparedMonths = analysis.baselinePoints.map((point) => point.label).join("–");
    return `<li><a href="#${metricId(analysis.metric.name)}"><span><strong>${analysis.metric.name} · ${analysis.latest.value}</strong><span>${capitalize(analysis.severity)} ${direction}: +${Math.round(analysis.adverseChange * 100)}% vs. ${comparedMonths} median</span></span><b class="severity-label" data-severity="${analysis.severity}">${analysis.severity}</b></a></li>`;
  }).join("");
  attentionSummary.innerHTML = `<div class="attention-summary__panel"><div class="attention-summary__header"><h2>Needs attention · ${flagged.length}</h2><p>Latest completed snapshots only.</p></div><ul class="attention-list">${items}</ul></div>`;
}

function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function metricId(name) {
  return `metric-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
}

function capitalize(text) {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function drawSparkline(points, trend) {
  const width = 220;
  const height = 42;
  const values = points.map((point) => point.numeric);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const color = trend === "watch" ? "#bb3d3d" : trend === "down" ? "#b76b00" : "#0a8378";
  const coordinates = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - 4 - ((value - min) / range) * (height - 10);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = `<path d="M0 ${height - 3} H${width}" stroke="#e5eaed" stroke-width="1"/><polyline points="${coordinates.join(" ")}" fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"/>`;
  return svg;
}
