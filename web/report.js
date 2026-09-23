(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ReportFormatter = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function thaiDateShort(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const yy = (y + 543) % 100;
    return `${d}/${m}/${String(yy).padStart(2,'0')}`;
  }

  function formatReport(records) {
    return [...records].sort((a,b) => a.date.localeCompare(b.date)).map((r) => {
      const date = thaiDateShort(r.date);
      const inLine = `${date} เข้า ${r.clock_in ? `${r.clock_in}น.` : '—'}`;
      const outLine = `${date} ออก ${r.clock_out ? `${r.clock_out}น.` : '—'}`;
      return `${inLine}\n${outLine}`;
    }).join('\n\n');
  }

  return { thaiDateShort, formatReport };
});
