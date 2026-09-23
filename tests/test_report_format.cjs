const { formatReport } = require('../web/report.js');
const actual = formatReport([
  {date:'2026-09-24', clock_in:'11:00', clock_out:'21:22'},
  {date:'2026-09-23', clock_in:'11:03', clock_out:'21:18'}
]);
const expected = '23/9/69 เข้า 11:03น.\n23/9/69 ออก 21:18น.\n\n24/9/69 เข้า 11:00น.\n24/9/69 ออก 21:22น.';
if (actual !== expected) {
  console.error('Expected:\n' + expected + '\nActual:\n' + actual);
  process.exit(1);
}
console.log('PASS report format');
