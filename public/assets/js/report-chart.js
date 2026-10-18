(() => {
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const chartWidth = 720;
  const chartHeight = 400;
  const plot = { left: 72, right: 696, top: 36, bottom: 316 };
  const series = [
    { key: 'plastic_bottles', label: 'Plastic Bottles', color: '#3976b7' },
    { key: 'plastics', label: 'Plastics', color: '#7652a5' },
    { key: 'papers', label: 'Papers', color: '#d98719' },
  ];

  function makeSvgElement(name, attributes = {}, text = '') {
    const element = document.createElementNS(svgNamespace, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    if (text) element.textContent = text;
    return element;
  }

  function formatDate(value) {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())
      ? String(value ?? '')
      : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function getTickStep(maxValue) {
    const roughStep = maxValue / 5 || 1;
    const magnitude = 10 ** Math.floor(Math.log10(roughStep));
    const fraction = roughStep / magnitude;
    const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    return niceFraction * magnitude;
  }

  function renderWasteReportChart(svg, timeline) {
    if (!svg) return;

    const entries = Array.isArray(timeline) ? timeline : [];
    const values = entries.flatMap((entry) => series.map(({ key }) => {
      const value = Number(entry[key]);
      return Number.isFinite(value) ? Math.max(0, value) : 0;
    }));
    const rawMax = Math.max(...values, 0);
    const step = getTickStep(rawMax || 1);
    const maxValue = Math.max(step, Math.ceil(rawMax / step) * step);
    const tickCount = Math.round(maxValue / step);
    const xForIndex = (index) => entries.length <= 1
      ? (plot.left + plot.right) / 2
      : plot.left + index * ((plot.right - plot.left) / (entries.length - 1));
    const yForValue = (value) => plot.bottom - (value / maxValue) * (plot.bottom - plot.top);

    svg.setAttribute('viewBox', `0 0 ${chartWidth} ${chartHeight}`);
    svg.setAttribute('aria-label', entries.length
      ? `Waste totals over ${entries.length} recorded days`
      : 'No waste report data available');
    svg.replaceChildren();

    const grid = makeSvgElement('g', { fill: 'none', stroke: '#d9e0e5', 'stroke-width': 1 });
    for (let index = 0; index <= tickCount; index += 1) {
      const value = index * step;
      const y = yForValue(value);
      grid.append(makeSvgElement('path', { d: `M${plot.left} ${y}H${plot.right}` }));
      svg.append(makeSvgElement('text', {
        x: plot.left - 12,
        y: y + 4,
        fill: '#52606d',
        'font-size': 12,
        'font-family': 'system-ui, sans-serif',
        'text-anchor': 'end',
      }, String(value)));
    }
    entries.forEach((_, index) => {
      const x = xForIndex(index);
      grid.append(makeSvgElement('path', {
        d: `M${x} ${plot.top}V${plot.bottom}`,
        stroke: '#edf0f2',
      }));
    });
    svg.append(grid);
    svg.append(makeSvgElement('path', {
      d: `M${plot.left} ${plot.top}V${plot.bottom}H${plot.right}`,
      fill: 'none',
      stroke: '#687782',
      'stroke-width': 1.5,
    }));

    entries.forEach((entry, index) => {
      svg.append(makeSvgElement('text', {
        x: xForIndex(index),
        y: plot.bottom + 22,
        fill: '#52606d',
        'font-size': 12,
        'font-family': 'system-ui, sans-serif',
        'text-anchor': 'middle',
      }, formatDate(entry.date)));
    });

    if (entries.length === 0) {
      svg.append(makeSvgElement('text', {
        x: (plot.left + plot.right) / 2,
        y: (plot.top + plot.bottom) / 2,
        fill: '#52606d',
        'font-size': 15,
        'font-family': 'system-ui, sans-serif',
        'text-anchor': 'middle',
      }, 'No report data available'));
    }

    series.forEach(({ key, label, color }, seriesIndex) => {
      const points = entries.map((entry, index) => {
        const value = Number(entry[key]);
        const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
        return { x: xForIndex(index), y: yForValue(safeValue) };
      });
      if (points.length > 1) {
        svg.append(makeSvgElement('polyline', {
          points: points.map(({ x, y }) => `${x},${y}`).join(' '),
          fill: 'none',
          stroke: color,
          'stroke-width': 3,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }));
      }
      points.forEach(({ x, y }) => {
        svg.append(makeSvgElement('circle', {
          cx: x,
          cy: y,
          r: 4,
          fill: '#ffffff',
          stroke: color,
          'stroke-width': 2.5,
        }));
      });

      const legendX = 108 + seriesIndex * 210;
      const legendY = 380;
      svg.append(makeSvgElement('path', {
        d: `M${legendX} ${legendY}h24`,
        stroke: color,
        'stroke-width': 3,
        'stroke-linecap': 'round',
      }));
      svg.append(makeSvgElement('circle', {
        cx: legendX + 12,
        cy: legendY,
        r: 3,
        fill: '#ffffff',
        stroke: color,
        'stroke-width': 2,
      }));
      svg.append(makeSvgElement('text', {
        x: legendX + 32,
        y: legendY + 4,
        fill: '#34434d',
        'font-size': 12,
        'font-family': 'system-ui, sans-serif',
      }, label));
    });
  }

  window.renderWasteReportChart = renderWasteReportChart;
})();
