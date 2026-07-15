// 순수 DOM/SVG 기반 차트 컴포넌트 — 외부 차트 라이브러리 의존 없이
// 대시보드 전반에서 일관된 시각 언어(막대/라인 차트 스타일, 색상, 빈 상태)를 재사용한다.

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
 * options: { valueSuffix, showPercentOfTotal, emptyMessage, stagger }
 * stagger: true면 각 행이 1초 간격으로 순서대로 튀어나오는 등장 애니메이션을 적용한다(트렌드 탭 전용).
 */
export function renderHBarChart(container, rows, options = {}) {
  const {
    valueSuffix = '건',
    showPercentOfTotal = true,
    emptyMessage = '표시할 데이터가 없습니다.',
    stagger = false,
  } = options;

  container.innerHTML = '';

  if (!rows || rows.length === 0) {
    container.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
    return;
  }

  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const max = Math.max(...rows.map((r) => r.value), 1);

  const list = document.createElement('div');
  list.className = 'hbar-list';

  rows.forEach((row, i) => {
    const pct = total > 0 ? ((row.value / total) * 100).toFixed(1) : '0.0';
    const widthPct = (row.value / max) * 100;
    const color = row.color || colorForKey(row.colorKey || row.label);

    const item = document.createElement('div');
    item.className = stagger ? 'hbar-row stagger-pop' : 'hbar-row';
    if (stagger) item.style.animationDelay = `${i}s`;
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

function hexToHsl(hex) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslCss(h, s, l) {
  return `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%)`;
}

/**
 * 도넛 랭킹 차트 — 처음엔 이름표만 초라락 펼쳐지고(값은 아직 안 보임), 그 다음 비율이 가장 큰
 * 조각(1위, 12시 방향)부터 시계 방향으로 한 칸씩 0.7초간 살짝 커졌다 작아지며 인출선으로 연결된
 * 구체적인 수치·비율을 보여준다. 한 바퀴를 다 돌면 멈추고 이후로는 정적인 상태를 유지하되,
 * 마우스를 조각 위에 올리면 언제든 그 조각의 수치를 다시 볼 수 있다.
 * 각 조각의 윗면은 라벨별 원래 색(단색)을 그대로 쓰고, 입체감은 오직 앞쪽에 보이는 옆면(두께,
 * 같은 색의 어두운 톤)과 그림자로만 낸다. 카드 우측 상단에는 같은 색으로 매칭한 작은 범례를 띄운다.
 * rows: [{ label, value, colorKey? }] — 이미 정렬/topN 적용된 상태로 넘겨받는다(내림차순 랭킹 순서).
 * options: { valueSuffix, emptyMessage }
 */
export function renderDonutRanking(container, rows, options = {}) {
  const { valueSuffix = '건', emptyMessage = '표시할 데이터가 없습니다.' } = options;

  // 탭 재방문 등으로 다시 렌더링될 때 이전 사이클의 타이머가 계속 누적되지 않도록 먼저 멈추다.
  if (container._donutStop) {
    container._donutStop();
    container._donutStop = null;
  }

  const card = container.closest('.chart-card');
  const oldLegend = card && card.querySelector(':scope > .donut-legend');
  if (oldLegend) oldLegend.remove();

  container.innerHTML = '';

  if (!rows || rows.length === 0) {
    container.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
    return;
  }

  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const width = 240;
  const height = 262;
  const cx = width / 2;
  const cy = 112;
  const rOuter = 92;
  const rInner = 58;
  const RATIO = 0.55; // 위에서 살짝 내려다보는 느낌을 주는 타원 눈림 비율
  const DEPTH = 15; // 옆면(두께) 높이
  const gapDeg = rows.length > 1 ? 1.6 : 0;

  // 타원 굤도 위의 좌표 — 원 대신 눈린 타원을 쓰여 "위에서 내려다본" 입체 느낌을 만든다.
  const ellipsePoint = (r, angleDeg) => {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * RATIO * Math.sin(rad) };
  };

  const topFacePath = (startAngle, endAngle) => {
    const so = ellipsePoint(rOuter, endAngle);
    const eo = ellipsePoint(rOuter, startAngle);
    const si = ellipsePoint(rInner, startAngle);
    const ei = ellipsePoint(rInner, endAngle);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return [
      `M ${so.x.toFixed(2)} ${so.y.toFixed(2)}`,
      `A ${rOuter} ${(rOuter * RATIO).toFixed(2)} 0 ${largeArc} 0 ${eo.x.toFixed(2)} ${eo.y.toFixed(2)}`,
      `L ${si.x.toFixed(2)} ${si.y.toFixed(2)}`,
      `A ${rInner} ${(rInner * RATIO).toFixed(2)} 0 ${largeArc} 1 ${ei.x.toFixed(2)} ${ei.y.toFixed(2)}`,
      'Z',
    ].join(' ');
  };

  // 도넛 앞쪽(아래 절반, 90°~270°)에서만 옆면 두께가 눈에 보인다 — 뒤쪽은 윗면에 가려지므로 생략한다.
  const FRONT_START = 90;
  const FRONT_END = 270;
  const clipToFront = (startAngle, endAngle) => {
    const lo = Math.max(startAngle, FRONT_START);
    const hi = Math.min(endAngle, FRONT_END);
    return lo < hi ? [lo, hi] : null;
  };

  const wallPath = (startAngle, endAngle) => {
    const topStart = ellipsePoint(rOuter, startAngle);
    const topEnd = ellipsePoint(rOuter, endAngle);
    const botStart = { x: topStart.x, y: topStart.y + DEPTH };
    const botEnd = { x: topEnd.x, y: topEnd.y + DEPTH };
    return [
      `M ${topEnd.x.toFixed(2)} ${topEnd.y.toFixed(2)}`,
      `A ${rOuter} ${(rOuter * RATIO).toFixed(2)} 0 0 0 ${topStart.x.toFixed(2)} ${topStart.y.toFixed(2)}`,
      `L ${botStart.x.toFixed(2)} ${botStart.y.toFixed(2)}`,
      `A ${rOuter} ${(rOuter * RATIO).toFixed(2)} 0 0 1 ${botEnd.x.toFixed(2)} ${botEnd.y.toFixed(2)}`,
      'Z',
    ].join(' ');
  };

  let cursor = 0;
  const segments = rows.map((row, i) => {
    const fraction = total > 0 ? row.value / total : 0;
    const angleSpan = fraction * 360;
    const startAngle = cursor + gapDeg / 2;
    const endAngle = cursor + Math.max(angleSpan - gapDeg, 0) + gapDeg / 2;
    cursor += angleSpan;
    const baseColor = row.color || colorForKey(row.colorKey || row.label);
    const { h, s, l } = hexToHsl(baseColor);
    return {
      ...row,
      i,
      startAngle,
      endAngle,
      midAngle: (startAngle + endAngle) / 2,
      baseColor,
      color: baseColor, // 윗면은 순위와 무관하게 원래 색 그대로(단색)
      wallColor: hslCss(h, s, Math.max(10, l - 26)), // 옆면만 같은 색의 어두운 톤으로 입체감을 준다
      pct: total > 0 ? ((row.value / total) * 100).toFixed(1) : '0.0',
    };
  });

  const NS = 'http://www.w3.org/2000/svg';
  const wrap = document.createElement('div');
  wrap.className = 'donut-chart';
  wrap.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="donut-svg">
      <ellipse class="donut-shadow-disc" cx="${cx}" cy="${cy}" rx="${rOuter}" ry="${(rOuter * RATIO).toFixed(2)}"></ellipse>
      <g class="donut-walls"></g>
      <g class="donut-segments"></g>
      <g class="donut-labels"></g>
      <g class="donut-callout donut-callout--hidden">
        <line class="donut-callout-line"></line>
        <circle class="donut-callout-dot" r="2.5"></circle>
        <text class="donut-callout-text"></text>
      </g>
    </svg>
  `;
  container.appendChild(wrap);

  const wallGroup = wrap.querySelector('.donut-walls');
  const segGroup = wrap.querySelector('.donut-segments');
  const labelGroup = wrap.querySelector('.donut-labels');
  const callout = wrap.querySelector('.donut-callout');
  const calloutLine = wrap.querySelector('.donut-callout-line');
  const calloutDot = wrap.querySelector('.donut-callout-dot');
  const calloutText = wrap.querySelector('.donut-callout-text');

  segments.forEach((seg) => {
    const d = topFacePath(seg.startAngle, seg.endAngle);
    seg.elements = [];

    // 앞쪽(아래 절반)에 걸치는 조각만 옆면(두께)을 그린다 — 실제 케이크를 자른 단면처럼 보이게 한다.
    const frontRange = clipToFront(seg.startAngle, seg.endAngle);
    if (frontRange) {
      const wall = document.createElementNS(NS, 'path');
      wall.setAttribute('d', wallPath(frontRange[0], frontRange[1]));
      wall.setAttribute('fill', seg.wallColor);
      wall.setAttribute('class', 'donut-segment donut-wall donut-segment--reveal');
      wall.style.setProperty('--donut-delay', `${seg.i * 0.045}s`);
      wall.addEventListener('animationend', () => wall.classList.remove('donut-segment--reveal'), { once: true });
      wallGroup.appendChild(wall);
      seg.elements.push(wall);
    }

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', seg.color);
    path.setAttribute('class', 'donut-segment donut-segment--reveal');
    path.style.setProperty('--donut-delay', `${seg.i * 0.045}s`);
    path.addEventListener('animationend', () => path.classList.remove('donut-segment--reveal'), { once: true });
    segGroup.appendChild(path);
    seg.pathEl = path;
    seg.elements.push(path);

    const labelPos = ellipsePoint(rOuter + 16, seg.midAngle);
    const normalizedMid = ((seg.midAngle % 360) + 360) % 360;
    const anchor = normalizedMid > 90 && normalizedMid < 270 ? 'end' : 'start';
    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', labelPos.x.toFixed(2));
    label.setAttribute('y', labelPos.y.toFixed(2));
    label.setAttribute('text-anchor', anchor);
    label.setAttribute('class', 'donut-label donut-label--reveal');
    label.style.setProperty('--donut-delay', `${seg.i * 0.045}s`);
    label.textContent = seg.label;
    label.addEventListener('animationend', () => label.classList.remove('donut-label--reveal'), { once: true });
    labelGroup.appendChild(label);

    // 자동 사이클이 끝나 정적인 상태가 된 뒤에도, 마우스를 올리면 언제든 수치를 볼 수 있게 한다.
    path.style.cursor = 'pointer';
    path.addEventListener('pointerenter', () => pulse(seg));
    path.addEventListener('pointerleave', () => {
      seg.elements.forEach((el) => el.classList.remove('donut-segment--active'));
      hideCallout();
    });
  });

  function showCallout(seg) {
    const lineStart = ellipsePoint(rOuter + 4, seg.midAngle);
    const lineEnd = ellipsePoint(rOuter + 30, seg.midAngle);
    const normalizedMid = ((seg.midAngle % 360) + 360) % 360;
    const anchor = normalizedMid > 90 && normalizedMid < 270 ? 'end' : 'start';

    calloutLine.setAttribute('x1', lineStart.x.toFixed(2));
    calloutLine.setAttribute('y1', lineStart.y.toFixed(2));
    calloutLine.setAttribute('x2', lineEnd.x.toFixed(2));
    calloutLine.setAttribute('y2', lineEnd.y.toFixed(2));
    calloutLine.setAttribute('stroke', seg.baseColor);

    calloutDot.setAttribute('cx', lineStart.x.toFixed(2));
    calloutDot.setAttribute('cy', lineStart.y.toFixed(2));
    calloutDot.setAttribute('fill', seg.baseColor);

    calloutText.setAttribute('x', (lineEnd.x + (anchor === 'end' ? -4 : 4)).toFixed(2));
    calloutText.setAttribute('y', lineEnd.y.toFixed(2));
    calloutText.setAttribute('text-anchor', anchor);
    calloutText.setAttribute('fill', seg.baseColor);
    calloutText.textContent = `${seg.label} · ${seg.value.toLocaleString()}${valueSuffix} (${seg.pct}%)`;

    callout.classList.remove('donut-callout--hidden');
  }

  function hideCallout() {
    callout.classList.add('donut-callout--hidden');
  }

  let stopped = false;
  let timerId = null;
  const revealMs = segments.length * 45 + 380; // 마지막 조각 등장 지연 + 등장 애니메이션 지속시간

  function pulse(seg) {
    // 같은 조각이 다시 활성화될 때도 애니메이션이 처음부터 재생되도록 강제 리플로우한다.
    seg.elements.forEach((el) => {
      el.classList.remove('donut-segment--active');
      void el.getBoundingClientRect();
      el.classList.add('donut-segment--active');
    });
    showCallout(seg);
  }

  // 비율이 가장 큰 조각(0번)부터 시계 방향으로 한 바퀴만 자동으로 돌고, 마지막 조각 이후에는 멈추다.
  // (멈춘 뒤에도 위 pointerenter 핸들러로 각 조각에 마우스를 올리면 수치를 볼 수 있다.)
  function cycle(idx) {
    if (stopped) return;
    pulse(segments[idx]);
    timerId = setTimeout(() => {
      if (stopped) return;
      segments[idx].elements.forEach((el) => el.classList.remove('donut-segment--active'));
      hideCallout();
      if (idx + 1 < segments.length) {
        timerId = setTimeout(() => cycle(idx + 1), 180);
      }
    }, 700);
  }

  timerId = setTimeout(() => cycle(0), revealMs);

  container._donutStop = () => {
    stopped = true;
    if (timerId) clearTimeout(timerId);
  };

  // 범례 — 카드 우측 상단에 작게, 랭킹 순서(진한 색 → 옅은 색)와 같은 순서로 표시한다.
  if (card) {
    const legend = document.createElement('div');
    legend.className = 'donut-legend';
    legend.innerHTML = segments
      .map(
        (seg) => `
      <span class="donut-legend__item">
        <span class="donut-legend__swatch" style="background:${seg.color}"></span>
        <span class="donut-legend__label" title="${seg.label}">${seg.label}</span>
      </span>`
      )
      .join('');
    card.appendChild(legend);
  }
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

/**
 * 세로형 랭킹 사다리 — "위로 갈수록 좋다"는 의미를 직관적으로 전달한다.
 * 트랙 배경은 0~80% 구간은 완만하게(회색→파랑→초록), 80~100% 구간은 급격하게(초록→금색→주황→빨간)
 * 변하는 비선형 그라디언트를 쓰서, 상위로 갈수록(예: 상위 0.001%에 가까워질수록) 훨씬 더 특별하다는
 * 느낌을 색으로 압축해 보여준다. 마커 위치 자체는 실제 백분위를 선형으로 정확히 표시한다.
 * percentile: 0~100 사이 값(높을수록 상위)
 */
export function renderRankLadder(container, percentile, options = {}) {
  const { sublabel = '' } = options;
  container.innerHTML = '';

  if (percentile == null) {
    container.innerHTML = '<div class="empty-state">비교할 시장 데이터가 없습니다.</div>';
    return;
  }

  const clamped = Math.max(1, Math.min(99, percentile));
  const markerFromTop = 100 - clamped;

  const tier =
    clamped >= 99
      ? { label: '🔥 최상위권', className: 'rank-tier--top' }
      : clamped >= 90
      ? { label: '⭐ 상위권', className: 'rank-tier--high' }
      : clamped >= 50
      ? { label: '평균 이상', className: 'rank-tier--mid' }
      : { label: '평균 이하', className: 'rank-tier--low' };

  const el = document.createElement('div');
  el.className = 'rank-ladder';
  el.innerHTML = `
    <div class="rank-ladder__scale">
      <span>100%</span>
      <span>90%</span>
      <span>50%</span>
      <span>0%</span>
    </div>
    <div class="rank-ladder__track">
      <div class="rank-ladder__marker" style="top:${markerFromTop}%">
        <span class="rank-ladder__marker-label">${clamped}%</span>
      </div>
    </div>
    <div class="rank-ladder__readout">
      <p class="rank-ladder__tier ${tier.className}">${tier.label}</p>
      <p class="rank-ladder__desc"><strong>상위 ${Math.max(1, 100 - clamped)}%</strong> 수준 (백분위 약 ${clamped}%)${
    sublabel ? ` · ${sublabel}` : ''
  }</p>
    </div>
  `;
  container.appendChild(el);
}

/**
 * 직군 평균 요구 연차와 내 연차를 같은 트랙 위 마커 두 개로 격쳐서 갭을 한 번에 보여준다.
 * "내 연차" 마커는 드래그(마우스/터치)와 방향키로 직접 옥길 수 있는 슬라이더 겸용 컴포넌트다.
 * avgYears: 직군 평균 요구 연차(null이면 표본 자체가 없어 비교 불가). myYears: 초기 위치로 쓸 연차.
 * onChange(years): 사용자가 마커를 옥길 때마다(드래그 중 실시간) 호출된다.
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
