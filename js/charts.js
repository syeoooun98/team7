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

<<<<<<< HEAD
=======
/**
 * 직군 평균 요구 연차와 내 연차를 같은 트랙 위 마커 두 개로 겹쳐서 갭을 한 번에 보여준다.
 * "내 연차" 마커는 드래그(마우스/터치)와 방향키로 직접 옮길 수 있는 슬라이더 겸용 컴포넌트다.
 * avgYears: 직군 평균 요구 연차(null이면 표본 자체가 없어 비교 불가). myYears: 초기 위치로 쓸 연차.
 * onChange(years): 사용자가 마커를 옮길 때마다(드래그 중 실시간) 호출된다.
 */
export function renderYearsGapBar(container, { avgYears, myYears, onChange } = {}) {
  container.innerHTML = '';

  if (avgYears == null) {
    container.innerHTML = '<div class="empty-state">비교할 연차 데이터가 없습니다.</div>';
    return;
  }

  // 스케일은 avgYears만 기준으로 고정한다 — myYears로도 계산하면 드래그로 myYears가 커질 때마다
  // 스케일 자체가 같이 늘어나 마커가 계속 도망가는 문제가 생긴다.
  const maxScale = Math.max(Math.ceil(avgYears * 2.2), 8);
  const clampYears = (y) => Math.min(maxScale, Math.max(0, y));
  const toPct = (y) => Math.min(97, Math.max(3, (y / maxScale) * 100));

  let currentYears = clampYears(myYears);

  const el = document.createElement('div');
  el.className = 'years-gap';
  el.innerHTML = `
    <div class="years-gap-track" role="slider" tabindex="0" aria-label="내 연차 (드래그 또는 방향키로 조절)"
         aria-valuemin="0" aria-valuemax="${maxScale}" aria-valuenow="${currentYears}">
      <div class="years-gap-band"></div>
      <div class="years-gap-marker years-gap-marker--avg" style="left:${toPct(avgYears)}%;">
        <span class="years-gap-marker__label years-gap-marker__label--gap"></span>
        <span class="years-gap-marker__dot"></span>
      </div>
      <div class="years-gap-marker years-gap-marker--me" style="left:${toPct(currentYears)}%;">
        <span class="years-gap-marker__dot"></span>
        <span class="years-gap-marker__label">내 연차 ${currentYears.toFixed(1)}년</span>
      </div>
    </div>
    <div class="years-gap-scale"><span>0년</span><span>${maxScale}년</span></div>
    <p class="years-gap-readout">직군 평균 요구 연차 <strong class="years-gap-readout__value">${avgYears.toFixed(1)}년</strong></p>
  `;
  container.appendChild(el);

  const track = el.querySelector('.years-gap-track');
  const band = el.querySelector('.years-gap-band');
  const meMarker = el.querySelector('.years-gap-marker--me');
  const meLabel = meMarker.querySelector('.years-gap-marker__label');
  const gapLabel = el.querySelector('.years-gap-marker__label--gap');

  // 라벨이 카드 좌우 경계를 넘어가면(마커가 트랙 양 끝 근처일 때) 가운데 정렬 대신
  // 안쪽으로 밀어서 절대 container 밖으로 나가지 않게 한다.
  function clampLabelToContainer(labelEl) {
    labelEl.style.transform = 'translateX(-50%)';
    const labelRect = labelEl.getBoundingClientRect();
    const boundsRect = container.getBoundingClientRect();
    const SAFE_MARGIN = 4;
    let shift = 0;
    if (labelRect.left < boundsRect.left + SAFE_MARGIN) {
      shift = boundsRect.left + SAFE_MARGIN - labelRect.left;
    } else if (labelRect.right > boundsRect.right - SAFE_MARGIN) {
      shift = boundsRect.right - SAFE_MARGIN - labelRect.right;
    }
    if (shift !== 0) {
      labelEl.style.transform = `translateX(calc(-50% + ${shift}px))`;
    }
  }

  function paint(y) {
    currentYears = clampYears(y);
    const myPct = toPct(currentYears);
    const avgPct = toPct(avgYears);
    const lo = Math.min(avgPct, myPct);
    const hi = Math.max(avgPct, myPct);
    const gap = currentYears - avgYears;
    const tone = gap >= 0 ? 'up' : 'down';

    band.style.left = `${lo}%`;
    band.style.width = `${Math.max(hi - lo, 0)}%`;
    band.className = `years-gap-band years-gap-band--${tone}`;
    meMarker.style.left = `${myPct}%`;
    meLabel.textContent = `내 연차 ${currentYears.toFixed(1)}년`;
    track.setAttribute('aria-valuenow', String(currentYears));
    gapLabel.textContent = `${gap >= 0 ? '+' : '-'}${Math.abs(gap).toFixed(1)}년`;
    gapLabel.className = `years-gap-marker__label years-gap-marker__label--gap years-gap-marker__label--${tone}`;

    clampLabelToContainer(meLabel);
    clampLabelToContainer(gapLabel);
  }

  paint(currentYears);

  function yearsFromClientX(clientX) {
    const rect = track.getBoundingClientRect();
    const ratio = rect.width ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
    return Math.round((ratio * maxScale) / 0.5) * 0.5;
  }

  function onPointerMove(e) {
    paint(yearsFromClientX(e.clientX));
    onChange?.(currentYears);
  }
  function onPointerUp() {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
  }
  track.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    track.focus();
    paint(yearsFromClientX(e.clientX));
    onChange?.(currentYears);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  });

  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      paint(currentYears + 0.5);
      onChange?.(currentYears);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      paint(currentYears - 0.5);
      onChange?.(currentYears);
    }
  });
}

>>>>>>> 870c06104acbc85d822ac30db06141e62ddb4cd1
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
