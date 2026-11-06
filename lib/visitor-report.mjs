const DAY = 86400000;
const shiftDay = (day, offset) => new Date(Date.parse(day + 'T00:00:00Z') + offset * DAY).toISOString().slice(0, 10);
const measured = row => row && row.visitors !== null && row.views !== null;
const sums = rows => rows.reduce((sum, row) => measured(row) ? { visitors: sum.visitors + row.visitors, views: sum.views + row.views } : sum, { visitors: 0, views: 0 });
const percent = (delta, previous) => previous > 0 ? delta / previous * 100 : null;

// These are daily browser counts, summed across days. The daily rotating hash
// intentionally cannot establish a person's unique count across a whole period.
export function buildVisitorReport(range, rows, lookupDay, firstDay = null) {
  const { start, end, today } = range;
  const requestedDays = (Date.parse(end) - Date.parse(start)) / DAY + 1;
  const measuredRows = rows.filter(measured), measuredDays = measuredRows.length, totals = sums(measuredRows);
  const daily = rows.map(row => {
    const previous = lookupDay(shiftDay(row.day, -1));
    const comparable = row.day !== today && row.day !== firstDay && previous?.day !== firstDay && measured(row) && measured(previous);
    const deltaVisitors = comparable ? row.visitors - previous.visitors : null;
    const deltaViews = comparable ? row.views - previous.views : null;
    return {
      ...row, deltaVisitors, deltaViews,
      visitorsPercent: comparable ? percent(deltaVisitors, previous.visitors) : null,
      viewsPercent: comparable ? percent(deltaViews, previous.views) : null,
      repeatViews: measured(row) ? row.views - row.visitors : null,
      viewsPerVisitor: measured(row) && row.visitors > 0 ? row.views / row.visitors : null,
    };
  });
  // Today's observations are incomplete, so weekday averages use completed days.
  const weekdays = Array.from({ length: 7 }, (_, weekday) => {
    const matching = measuredRows.filter(row => row.day !== today && row.day !== firstDay && new Date(row.day + 'T00:00:00Z').getUTCDay() === weekday);
    const total = sums(matching), days = matching.length;
    return { weekday, days, ...total, averageVisitors: days ? total.visitors / days : null, averageViews: days ? total.views / days : null };
  });
  const precedingStart = shiftDay(start, -requestedDays), precedingEnd = shiftDay(start, -1), precedingRows = [];
  for (let day = precedingEnd; day >= precedingStart; day = shiftDay(day, -1)) precedingRows.push(lookupDay(day));
  const precedingMeasured = precedingRows.filter(measured), preceding = sums(precedingMeasured);
  const complete = Boolean(firstDay && start > firstDay && precedingStart > firstDay && measuredDays === requestedDays && precedingMeasured.length === requestedDays && end < today);
  const visitorsDelta = complete ? totals.visitors - preceding.visitors : null;
  const viewsDelta = complete ? totals.views - preceding.views : null;
  const peakDay = measuredRows.length ? measuredRows.reduce((peak, row) => row.visitors > peak.visitors || (row.visitors === peak.visitors && (row.views > peak.views || (row.views === peak.views && row.day > peak.day))) ? row : peak) : null;
  return {
    measuredDays, requestedDays, partialToday: start <= today && today <= end,
    partialFirstDay: Boolean(firstDay && start <= firstDay && firstDay <= end),
    averageVisitors: measuredDays ? totals.visitors / measuredDays : null,
    averageViews: measuredDays ? totals.views / measuredDays : null,
    viewsPerVisitor: totals.visitors > 0 ? totals.views / totals.visitors : null,
    repeatViews: measuredDays ? totals.views - totals.visitors : null,
    peakDay: peakDay ? { day: peakDay.day, visitors: peakDay.visitors, views: peakDay.views } : null,
    weekdays, daily,
    comparison: {
      start: precedingStart, end: precedingEnd, measuredDays: precedingMeasured.length, complete,
      ...preceding, visitorsDelta, viewsDelta,
      visitorsPercent: complete ? percent(visitorsDelta, preceding.visitors) : null,
      viewsPercent: complete ? percent(viewsDelta, preceding.views) : null,
    },
  };
}
