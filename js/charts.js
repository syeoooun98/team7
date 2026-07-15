// 순수 DOM/SVG 기반 차트 컴포넌트 — 외부 차트 라이브러리 의존 없이
// 대시보드 전반에서 일관된 시각 언어(막대/라인 스타일, 색상, 빈 상태)를 재사용한다.

export const CATEGORY_COLORS = [
  '#5b8def', '#34c77b', '#f2b134', '#ef4444', '#a78bfa', '#22d3ee',
  '#f472b6', '#84cc16', '#38bdf8', '#fb923c', '#2dd4bf', '#c084fc',
  '#eab308', '#fb7185', '#4ade80', '#94a3b8',
];

const colorCache = new Map();
export function colorForKey(key) {
  if (colorCache.has(key)) return colorCache.get(key);
  const color = CATEGORY_COLORS[colorCache.size % CATEGORY_COLORS.length];
  colorCache.set(key, color);
  return color;
}

/**
 * rows: [{ label, value, colorKey? }]
 * options: { valueSuffix, showPercentOfTotal, emptyMessage }
 */
export function renderHBarChart(container, rows, options = {}) {
  const { valueSuffix = '건', showPercentOfTotal = true, emptyMessage = '표시할 데이터가 없습니다.' } = options;

  container.innerHTML = '';

  if (!rows || rows.length === 0) {
    container.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
    return;
  }

  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const max = Math.max(...rows.map((r) => r.value), 1);

  const list = document.createElement('div');
  list.className = 'hbar-list';

  rows.forEach((row) => {
    const pct = total > 0 ? ((row.value / total) * 100).toFixed(1) : '0.0';
    const widthPct = (row.value / max) * 100;
    const color = row.color || colorForKey(row.colorKey || row.label);

    const item = document.createElement('div');
    item.className = 'hbar-row';
    item.innerHTML = `
      <div class="hbar-label" title="${row.label}">${row.label}</div>
      <div class="hbar-track">
        <div class="hbar-fill" style="width:${widthPct}%; background:${color};"></div>
      </div>
      <div class="hbar-value">${row.value.toLocaleString()}${valueSuffix}${
        showPercentOfTotal ? ` <span class="hbar-percent">(${pct}%)</span>` : ''
      }</div>
    `;
    list.appendChild(item);
  });

  container.appendChild(list);
}

/**
 * points: [{ date: 'YYYY-MM-DD', value: number }] — 시간순 오름차순 정렬된 상태로 전달
 */
export function renderSparkline(container, points, options = {}) {
  const { height = 64, color = '#5b8def', emptyMessage = '표시할 데이터가 없습니다.' } = options;
  container.innerHTML = '';

  if (!points || points.length === 0) {
    container.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
    return;
  }

  const width = 100;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;

  const coords = points.map((p, i) => {
    const x = points.length > 1 ? i * stepX : width / 2;
    const y = height - ((p.value - min) / range) * (height - 14) - 7;
    return { x, y, ...p };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`).join(' ');
  const lastX = coords[coords.length - 1].x.toFixed(2);
  const areaPath = `${linePath} L ${lastX} ${height} L 0 ${height} Z`;

  const wrap = document.createElement('div');
  wrap.className = 'sparkline';
  wrap.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="sparkline-svg">
      <path d="${areaPath}" fill="${color}22" stroke="none"></path>
      <path d="${linePath}" fill="none" stroke="${color}" stroke-width="1.8" vector-effect="non-scaling-stroke"></path>
      ${coords
        .map((c) => `<circle cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="1.6" fill="${color}"></circle>`)
        .join('')}
    </svg>
    <div class="sparkline-labels">
      <span>${formatShortDate(points[0].date)}</span>
      <span class="sparkline-labels__last">${formatShortDate(points[points.length - 1].date)} · ${points[points.length - 1].value.toLocaleString()}건</span>
    </div>
  `;
  container.appendChild(wrap);
}

function formatShortDate(dateStr) {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  return parts.length === 3 ? `${Number(parts[1])}.${Number(parts[2])}` : dateStr;
}

/** percentile: 0~100 사이 근사 백분위 값 */
export function renderGaugeBar(container, percentile, options = {}) {
  const { sublabel = '' } = options;
  container.innerHTML = '';

  if (percentile == null) {
    container.innerHTML = '<div class="empty-state">비교할 시장 데이터가 없습니다.</div>';
    return;
  }

  const clamped = Math.max(1, Math.min(99, percentile));
  const el = document.createElement('div');
  el.className = 'gauge';
  el.innerHTML = `
    <div class="gauge-track">
      <div class="gauge-fill" style="width:${clamped}%"></div>
      <div class="gauge-marker" style="left:${clamped}%"></div>
    </div>
    <div class="gauge-scale"><span>0%</span><span>50%</span><span>100%</span></div>
    <p class="gauge-readout"><strong>상위 ${Math.max(1, 100 - clamped)}%</strong> 수준 (백분위 약 ${clamped}%)${
      sublabel ? ` · ${sublabel}` : ''
    }</p>
  `;
  container.appendChild(el);
}

export function formatWon(amount) {
  if (amount == null) return '-';
  if (amount >= 10000) {
    const man = amount / 10000;
    return `${Number.isInteger(man) ? man : man.toFixed(1)}만원`;
  }
  return `${amount.toLocaleString()}원`;
}

export function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export function formatPct(value, { withSign = true, digits = 1 } = {}) {
  if (value == null || Number.isNaN(value)) return '-';
  const sign = withSign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function pctTone(value) {
  if (value == null) return 'neutral';
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'neutral';
}

export function ddayBadge(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return { text: '상시채용', tone: 'neutral' };
  if (daysLeft < 0) return { text: '마감', tone: 'closed' };
  if (daysLeft === 0) return { text: 'D-day 마감임박!', tone: 'urgent' };
  if (daysLeft <= 3) return { text: `D-${daysLeft} 마감임박!`, tone: 'urgent' };
  if (daysLeft <= 7) return { text: `D-${daysLeft}`, tone: 'warn' };
  return { text: `D-${daysLeft}`, tone: 'normal' };
}

const APPLY_TYPE_LABEL = {
  foreigner: '외국인 우대',
  alternative_military: '병역특례',
  disabled_person: '장애인 우대',
};
export function applyTypeLabel(type) {
  return APPLY_TYPE_LABEL[type] || type;
}
