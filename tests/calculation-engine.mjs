import test from 'node:test';
import assert from 'node:assert/strict';
import { engine, pageEngine, plain, permitRefresh, pointsFromK, statsForValues } from './calculator-harness.mjs';

test('point inputs: units, fullwidth, minimum-point rounding and invalid values', () => {
  const e = engine();
  const accepted = [
    ['', 0], ['  ', 0], [0, 0], ['12500', 12500], ['12,500', 12500],
    ['12.5K', 12500], ['12.5k', 12500], ['１．２万', 12000],
    ['１２，５００', 12500], ['１．２Ｍ', 1200000], ['.5', 1], ['.49', 0],
    ['0.0005K', 1], ['0.00049K', 0], ['0.00005万', 1], ['1000.0005K', 1000001],
    ['001.50', 2], [String(e.MAX_VALUE), e.MAX_VALUE],
  ];
  for (const [input, expected] of accepted) {
    assert.equal(e.readNumber(input), expected, `${JSON.stringify(input)} must mean ${expected}pt`);
  }
  for (const input of [null, undefined, '1,23', '1,234,56', '1 000', '-1', '+1',
    '1e3', 'NaN', 'Infinity', '12pt', '1K万', '.', '0x10', String(e.MAX_VALUE + 1),
    '9'.repeat(257), '123456789012345678901234567890K']) {
    assert.equal(e.readNumber(input), null, `Reject malformed/out-of-range ${String(input)}`);
  }
});

test('core counts use a separate integer-only domain', () => {
  const e = engine();
  assert.equal(typeof e.readCoreCount, 'function', 'Core validation must be shared by input/storage/import');
  for (const [input, expected] of [[0, 0], ['0', 0], [' ４０ ', 40], ['0040', 40],
    [1000, 1000], ['1000', 1000]]) assert.equal(e.readCoreCount(input), expected);
  for (const input of [null, undefined, '', ' ', '-1', '+1', '1.5', 1.5, '40.0',
    '1K', '1e2', '1001', 1001, NaN, Infinity, {}]) {
    assert.equal(e.readCoreCount(input), null, `Reject core count ${String(input)}`);
  }
});

test('32,032 coin/item cases are sufficient and minimal across every supported core count', () => {
  const e = engine();
  const remaining = [0, 1, 4, 436, 437, 1000, 100001, e.MAX_VALUE];
  let previousBonus = -1;
  let itemCases = 0;
  for (let core = 0; core <= 1000; core++) {
    e.state.coreCount = String(core);
    const info = e.coreInfo();
    assert.equal(info.count, core);
    assert.ok(Number.isInteger(info.bonus) && info.bonus >= previousBonus,
      'Adding a core cannot reduce the coefficient');
    previousBonus = info.bonus;
    const coefficient = BigInt(100 + info.bonus);
    for (const rem of remaining) {
      const requiredPoints = BigInt(rem) * 25n;
      const coins = BigInt(e.needCoins(rem));
      assert.ok(coins * coefficient >= requiredPoints, `Coins cover core=${core}, rem=${rem}`);
      if (rem > 0) assert.ok((coins - 1n) * coefficient < requiredPoints);
      else assert.equal(coins, 0n);
      for (const price of [55, 111, 1080, 5555]) {
        const count = BigInt(e.itemRange(rem, price).replaceAll(',', ''));
        assert.ok(count * BigInt(price) * coefficient >= requiredPoints,
          `Items cover core=${core}, rem=${rem}, price=${price}`);
        if (rem > 0) assert.ok((count - 1n) * BigInt(price) * coefficient < requiredPoints);
        else assert.equal(count, 0n);
        itemCases++;
      }
    }
  }
  assert.equal(itemCases, 32032);
});

test('K displays preserve each point, including prior 1001 → 1K regression', () => {
  const e = engine();
  for (const amount of [0n, 1n, 999n, 1000n, 1001n, 1049n, 1499n, 99999n,
    100001n, 100499n, BigInt(e.MAX_VALUE), BigInt(e.MAX_VALUE) * 3600000n]) {
    assert.equal(pointsFromK(e.fmtPaceK(amount)), amount, `Exact required pace ${amount}`);
    if (amount <= BigInt(e.MAX_VALUE)) {
      assert.equal(pointsFromK(e.fmtRemainingK(Number(amount))), amount);
      assert.equal(pointsFromK(e.fmtK(Number(amount))), amount,
        'Announcement and border remainder must match the exact main display');
    }
  }
});

test('required pace is sufficient, minimal and exact at millisecond boundaries', () => {
  const e = engine();
  let cases = 0;
  for (const amount of [1, 1001, 100001, e.MAX_VALUE]) {
    for (const remainingMs of [1, 999, 1000, 600000, 3600000, 86399999]) {
      for (const unitMs of [600000, 3600000]) {
        const pace = e.ceilPace(amount, unitMs, remainingMs);
        const required = BigInt(amount) * BigInt(unitMs);
        assert.ok(pace * BigInt(remainingMs) >= required);
        assert.ok((pace - 1n) * BigInt(remainingMs) < required);
        assert.equal(pointsFromK(e.fmtPaceK(pace)), pace);
        cases++;
      }
    }
  }
  assert.equal(cases, 48);
  assert.equal(e.ceilPace(0, 3600000, 1), 0n);
  assert.equal(e.ceilPace(1, 3600000, 0), 0n);
  assert.equal(e.ceilPace(1, 3600000, -1), 0n);
});

test('JST meter periods roll at the exact cutoff and support all configured hours', () => {
  const e = engine();
  for (const deadline of ['00:00', '13:00', '22:00', '03:30']) {
    e.state.deadline = deadline;
    const cutoff = Date.parse(`2026-10-03T${deadline}:00+09:00`);
    const before = e.meterWindow(cutoff - 1);
    assert.equal(before.end, cutoff);
    assert.equal(before.left * 60000, 1);
    const at = e.meterWindow(cutoff);
    assert.equal(at.start, cutoff);
    assert.equal(at.end, cutoff + 86400000);
    assert.equal(at.left, 1440);
    for (const now of [cutoff - 86400000, cutoff - 1, cutoff, cutoff + 1,
      cutoff + 86399999, cutoff + 86400000]) {
      const period = e.meterWindow(now);
      assert.ok(period.start <= now && now < period.end);
      assert.equal(period.end - period.start, 86400000);
    }
  }
  for (const [input, expected] of [['00:00', 0], ['13:00', 780], ['22:00', 1320],
    ['23:59', 1439], ['24:00', null], ['12:60', null], ['3:30', null], ['', null]]) {
    assert.equal(e.toMins(input), expected);
  }
  for (const [input, expected] of [[0, '00:00:00'], [1, '00:00:01'],
    [999, '00:00:01'], [1000, '00:00:01'], [1001, '00:00:02'],
    [86400000, '24:00:00']]) assert.equal(e.countdownTime(input), expected);
});

test('known statistics and candidate targets handle median/p75, buffer and rounding', () => {
  const e = engine();
  const stats = statsForValues(e, [1, 2, 3, 100]);
  const expected = {
    mean: { numerator: 106n, denominator: 4n, target: 27, display: '26.5' },
    median: { numerator: 5n, denominator: 2n, target: 3, display: '2.5' },
    p75: { numerator: 3n, denominator: 1n, target: 3, display: '3' },
    min: { numerator: 1n, denominator: 1n, target: 1, display: '1' },
    max: { numerator: 100n, denominator: 1n, target: 100, display: '100' },
  };
  for (const [method, answer] of Object.entries(expected)) {
    const ratio = e.statRatio(stats, method);
    assert.equal(ratio.numerator * answer.denominator, answer.numerator * ratio.denominator,
      `${method} must preserve the exact statistic`);
    assert.equal(e.targetCalc(stats, method, 0, 1).target, answer.target);
    assert.equal(e.displayStatistic(stats, method), answer.display);
  }
  assert.equal(e.targetCalc(stats, 'mean', 10, 100).target, 100);
  assert.equal(e.targetCalc(stats, 'max', 50, 100).target, 200);
  assert.equal(e.targetCalc(stats, 'min', 0.1, 1).target, 2);
  assert.equal(e.targetCalc(statsForValues(e, [1, 2, 3]), 'median', 0, 1).target, 2);
  assert.equal(e.targetCalc(statsForValues(e, [2]), 'p75', 0, 1).target, 2);
  assert.equal(e.targetCalc(statsForValues(e, [1, 2, 3, 4, 5]), 'p75', 0, 1).target, 4);
  assert.equal(e.targetCalc({ n: 0 }, 'mean', 0, 1), null);
  assert.equal(e.targetCalc(stats, 'unknown', 0, 1), null);
  for (const buffer of [-1, 50.1, 0.15, NaN, Infinity]) {
    assert.equal(e.targetCalc(stats, 'mean', buffer, 1), null);
  }
  assert.equal(e.targetCalc(stats, 'mean', 0, 10), null);
});

test('large-value statistic display and targets never lose integer precision', () => {
  const e = engine();
  const high = statsForValues(e, [350000000000002, 350000000000000, 350000000000001]);
  assert.equal(e.targetCalc(high, 'mean', 0, 1).target, 350000000000001);
  assert.equal(e.displayStatistic(high, 'mean'), '350,000,000,000,001');
  assert.equal(e.displayStat(1.05, 21n, 20n), '1.1', 'Half a tenth rounds upward');
  assert.equal(e.displayStat(1.049, 1049n, 1000n), '1');
  assert.equal(e.displayStat(null), '—');
  const fractional = statsForValues(e, [350000000000000, 350000000000001, 350000000000001]);
  assert.equal(e.displayStatistic(fractional, 'mean'), '350,000,000,000,000.7');
  assert.equal(e.targetCalc(fractional, 'mean', 0, 1).target, 350000000000001);
  const maximum = statsForValues(e, [e.MAX_VALUE, e.MAX_VALUE]);
  assert.equal(e.targetCalc(maximum, 'mean', 0, 1).target, e.MAX_VALUE);
  assert.equal(e.targetCalc(maximum, 'mean', 0.1, 1), null);
  assert.equal(e.targetCalc(maximum, 'mean', 0, 100), null);
  const ratio = e.statRatio(high, 'mean');
  for (const buffer of [0, 0.1, 10, 50]) {
    for (const unit of [1, 100, 1000, 10000]) {
      const result = e.targetCalc(high, 'mean', buffer, unit);
      if (!result) continue;
      const numerator = ratio.numerator * BigInt(1000 + Math.round(buffer * 10));
      const denominator = ratio.denominator * 1000n;
      assert.equal(result.target % unit, 0);
      assert.ok(BigInt(result.target) * denominator >= numerator);
      assert.ok(BigInt(result.target - unit) * denominator < numerator);
    }
  }
});

test('rational formatting rounds ties consistently and preserves values beyond Number precision', () => {
  const e = engine();
  for (const [numerator, denominator, digits, grouped, trim, answer] of [
    [1n, 3n, 1, false, true, '0.3'], [1n, 8n, 2, false, true, '0.13'],
    [-1n, 8n, 2, false, true, '-0.13'], [-1n, 1000n, 1, false, false, '0.0'],
    [123400n, 100n, 2, true, false, '1,234.00'],
    [123400n, 100n, 2, true, true, '1,234'],
    [90071992547409931n, 10n, 1, true, true, '9,007,199,254,740,993.1'],
    [1n, 0n, 1, false, false, '—'],
  ]) {
    assert.equal(e.formatRatio(numerator, denominator, digits, grouped, trim), answer);
  }
});

test('statistics omit missing/invalid/legacy days and current/future records', () => {
  const e = engine();
  e.state.log = {
    '2026-09-02': { S2: [50, 50, 50] },
    '2026-09-03': { S2: [100, 200, 300] },
    '2026-09-04': { S2: [1000, 2000, 3000] },
    '2026-09-05': { S2: [0, 2000, 3000] },
    '2026-10-02': { S2: [300, 500, 700] },
    '2026-10-03': { S2: [100000, 200000, 300000] },
    '2026-10-04': { S2: [100000, 200000, 300000] },
  };
  e.state.provenance = { 22: { '2026-09-04': { S2: { origin: 'legacy' } } } };
  e.state.asOfDate = '';
  e.state.period = '30d';
  let stats = e.selectedStats('S2', 0);
  assert.equal(stats.window.start, '2026-09-03');
  assert.equal(stats.window.end, '2026-10-02');
  assert.equal(stats.window.dates.length, 30);
  assert.equal(stats.n, 2);
  assert.equal(stats.sum, '400');
  assert.equal(stats.mean, 200, 'Missing days do not dilute the mean');
  assert.equal(stats.missing.length, 28);
  assert.equal(stats.legacy, 1);
  assert.deepEqual(Array.from(stats.days, day => day.date), ['2026-09-03', '2026-10-02']);
  e.state.period = 'all';
  stats = e.selectedStats('S2', 0);
  assert.equal(stats.n, 4);
  assert.equal(stats.sum, '1450');
  assert.equal(stats.mean, 362.5);
  e.state.period = 'month';
  stats = e.selectedStats('S2', 0);
  assert.equal(stats.n, 1);
  assert.equal(stats.mean, 300);
  e.state.period = '30d';
  e.state.asOfDate = '2026-09-03';
  stats = e.selectedStats('S2', 0);
  assert.equal(stats.window.end, '2026-09-03');
  assert.equal(stats.n, 2);
  e.state.asOfDate = '2026-10-04';
  assert.equal(e.recentWindow().end, '2026-10-02', 'As-of cannot include future/current days');
});

test('malformed core backup is rejected before any state mutation', () => {
  for (const invalidCore of ['1.5', '1001', '-1', '1K', '', '1e2', null, 40.5]) {
    const e = engine();
    e.state.target = '100001';
    e.state.current = '500';
    e.state.log = { '2026-10-02': { S2: [100, 200, 300] } };
    const before = JSON.stringify(e.state);
    e.validateBackupPayload({ pmcBackup: 1, log: {}, settings: plain(e.state) });
    const settings = { ...plain(e.state), coreCount: invalidCore };
    const backup = { pmcBackup: 1, log: { '2026-10-01': { S2: [900, 1000, 1100] } }, settings };
    assert.throws(() => e.validateBackupPayload(backup), undefined,
      `Reject invalid imported core ${String(invalidCore)}`);
    assert.equal(JSON.stringify(e.state), before);
    e.element('paste').value = JSON.stringify(backup);
    e.element('importBtn').onclick();
    assert.equal(e.element('importMsg').className, 'toast err');
    assert.match(e.element('importMsg').textContent, /形式が正しくありません/);
    assert.equal(JSON.stringify(e.state), before,
      'A failed backup must not partially install its log, settings or current value');
  }
  const e = engine();
  const accepted = { pmcBackup: 1, log: {}, settings: plain(e.state) };
  assert.equal(e.validateBackupPayload(accepted), accepted, 'A valid core backup remains compatible');
});

test('valid K/万 backup is canonicalized and merges rather than erasing existing records', () => {
  const e = engine();
  e.state.log = { '2026-10-02': { S2: [100, 200, 300] } };
  permitRefresh(e);
  const settings = { ...plain(e.state), target: '12.5K', current: '１．２万', coreCount: '４０' };
  e.element('paste').value = JSON.stringify({ pmcBackup: 1,
    log: { '2026-10-01': { S2: [900, 1000, 1100] } }, settings });
  e.element('importBtn').onclick();
  assert.equal(e.element('importMsg').className, 'toast');
  assert.equal(e.state.target, '12500');
  assert.equal(e.state.current, '12000');
  assert.equal(e.state.coreCount, '40');
  assert.deepEqual(plain(e.state.log['2026-10-02'].S2), [100, 200, 300]);
  assert.deepEqual(plain(e.state.log['2026-10-01'].S2), [900, 1000, 1100]);
  assert.equal(e.state.provenance['22']['2026-10-01'].S2.origin, 'backup');
});

test('negative point backup never overwrites a valid current value', () => {
  for (const key of ['target', 'current']) {
    const e = engine();
    e.state.target = '12500';
    e.state.current = '500';
    const before = JSON.stringify(e.state);
    e.element('paste').value = JSON.stringify({ pmcBackup: 1, log: {},
      settings: { ...plain(e.state), [key]: '-1' } });
    e.element('importBtn').onclick();
    assert.equal(e.element('importMsg').className, 'toast err');
    assert.equal(JSON.stringify(e.state), before);
  }
});

test('current adjustments report the actual delta when bounded by zero or the input maximum', () => {
  const e = engine();
  permitRefresh(e);
  e.state.current = '500';
  e.element('adjustAmount').value = '1K';
  e.adjustCurrent(-1);
  assert.equal(e.state.current, '0');
  assert.match(e.element('adjustStatus').textContent, /−500 pt/);
  assert.match(e.element('adjustStatus').textContent, /0/);
  e.state.current = String(e.MAX_VALUE - 1);
  e.adjustCurrent(1);
  assert.equal(e.state.current, String(e.MAX_VALUE));
  assert.match(e.element('adjustStatus').textContent, /＋1 pt/);
  assert.match(e.element('adjustStatus').textContent, /上限/);
  const before = e.state.current;
  e.element('adjustAmount').value = '-1';
  e.adjustCurrent(1);
  assert.equal(e.state.current, before);
  assert.equal(e.element('inputStatus').hidden, false);
});

test('the entire shipped script initializes and updates displayed values through real input handlers', () => {
  const baseline = plain(engine().state);
  const page = pageEngine({ ...baseline, target: '100001', current: '0', coreCount: '0' });
  assert.equal(page.element('remain').textContent, '100.001K');
  assert.equal(page.element('coinNeed').textContent, '25,001');
  assert.equal(page.element('hanabiNeed').textContent, '24 発');
  assert.equal(page.element('perHour').textContent, '100.001K');
  assert.equal(page.element('per10').textContent, '16.667K');
  assert.equal(page.element('left').textContent, '01:00:00.0');
  page.element('currentTop').value = '１００Ｋ';
  page.element('currentTop').dispatchEvent(new Event('input'));
  assert.equal(page.element('remain').textContent, '1');
  assert.equal(page.element('coinNeed').textContent, '1');
  assert.equal(page.element('pct').textContent, '99.99%');
  page.element('target').value = '12.5K';
  page.element('target').dispatchEvent(new Event('input'));
  assert.equal(page.element('remain').textContent, '達成！');
  assert.equal(page.element('coinNeed').textContent, '0');
  assert.equal(page.element('pct').textContent, '100%');
  const saved = JSON.parse(page.stored.get('pococha-meter-calc-v1'));
  assert.equal(saved.target, '12500');
  assert.equal(saved.current, '100000');
});

test('analysis CSV has aligned columns, exact statistic fractions and re-importable record values', () => {
  const e = engine();
  e.state.targetMethod = 'mean';
  const values = [350000000000000, 350000000000001, 350000000000001];
  statsForValues(e, values);
  e.state.period = 'all';
  e.state.rank = 'S2';
  e.state.analysisBorder = 0;
  const csv = e.makeAnalysisCSV();
  const rows = e.parseCSV(csv.replace(/^\uFEFF/, ''), ',');
  const header = Array.from(rows[0]);
  assert.equal(header.length, 23);
  assert.equal(rows.length, 4);
  for (const row of rows.slice(1)) {
    assert.equal(row.length, header.length);
    assert.equal(row[header.indexOf('base_value')], '350000000000000.666667');
    assert.equal(row[header.indexOf('base_numerator')], '1050000000000002');
    assert.equal(row[header.indexOf('base_denominator')], '3');
    assert.equal(row[header.indexOf('candidate_target')], '350000000000001');
  }
  const imports = e.parseImports(csv, '2026-10-02');
  assert.equal(imports.length, 3);
  for (let index = 0; index < values.length; index++) {
    assert.equal(imports[index].close, '22');
    assert.equal(imports[index].rank, 'S2');
    assert.deepEqual(plain(imports[index].vals), [values[index], values[index], values[index]]);
  }
});
