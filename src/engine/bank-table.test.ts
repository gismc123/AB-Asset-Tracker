import { describe, expect, it } from 'vitest';
import { generateSchedule, lockRow } from './amortize.js';
import { guessDateFormat, guessMapping, guessNumberFormat, parseAmountText, parseCsv, parseDateText, readBankTable } from './bank-table.js';
import type { LoanSetup, LockedPayment } from './types.js';

/** Made-up loan: $12,000 at 12% for 12 months, monthly interest. */
const LOAN: LoanSetup = {
  originalAmount: 1_200_000,
  annualRatePercent: 12,
  termYears: 1,
  termMonths: 12,
  openDate: '2025-01-01',
  firstPaymentDate: '2025-02-01',
  paymentDay: 1,
  piPaymentOverride: null,
  originalHomeValue: 0,
  pmiMonthly: 0,
  pmiStartDate: null,
  pmiRemovalRule: 'auto78Scheduled',
  escrowMonthly: 0,
  extraPrincipal: 0,
  modules: { pmi: false, escrow: false },
};
const plain = generateSchedule(LOAN);

describe('reading a CSV file', () => {
  it('splits rows and cells, with quotes, a byte-order mark, CRLF and other delimiters', () => {
    expect(parseCsv('﻿a,b,"c, d"\r\n1,"2 ""x""",3\n\n')).toEqual([['a', 'b', 'c, d'], ['1', '2 "x"', '3']]);
    expect(parseCsv('Date;Interest\n01.02.2025;120,00')).toEqual([['Date', 'Interest'], ['01.02.2025', '120,00']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('reads amounts in either number format', () => {
    expect(parseAmountText('$1,234.56')).toBe(123_456);
    expect(parseAmountText(' 1234.5 ')).toBe(123_450);
    expect(parseAmountText('(12.34)')).toBe(-1_234);
    expect(parseAmountText('12.34-')).toBe(-1_234);
    expect(parseAmountText('1.234,56 €', 'comma')).toBe(123_456);
    expect(parseAmountText('')).toBeNull();
    expect(parseAmountText('Total')).toBeNull();
  });

  it('reads dates in each order, and four-digit years first always', () => {
    expect(parseDateText('2025-03-01', 'dmy')).toBe('2025-03-01');
    expect(parseDateText('03/01/2025', 'mdy')).toBe('2025-03-01');
    expect(parseDateText('01.03.2025', 'dmy')).toBe('2025-03-01');
    expect(parseDateText('3/1/25', 'mdy')).toBe('2025-03-01');
    expect(parseDateText('31/02/2025', 'dmy')).toBeNull();
    expect(parseDateText('Totals', 'mdy')).toBeNull();
  });

  it('guesses the columns and formats', () => {
    expect(guessMapping(['Pmt #', 'Payment Date', 'Payment', 'Principal', 'Interest', 'Ending Balance'])).toEqual({
      number: 0, date: 1, payment: 2, principal: 3, interest: 4, balance: 5,
    });
    expect(guessMapping(['Due', 'Int', 'Princ', 'Remaining'])).toEqual({ date: 0, interest: 1, principal: 2, balance: 3 });
    expect(guessMapping(['No.', 'Date', 'Interest', 'Principal'])).toEqual({ number: 0, date: 1, interest: 2, principal: 3 });
    expect(guessDateFormat(['01/02/2025', '13/02/2025'])).toBe('dmy');
    expect(guessDateFormat(['02/13/2025'])).toBe('mdy');
    expect(guessNumberFormat(['1.234,56'])).toBe('comma');
    expect(guessNumberFormat(['1,234.56'])).toBe('dot');
  });

  it('matches rows by date or number, and says which lines it left out', () => {
    const cells = parseCsv([
      'Date,Payment,Principal,Interest,Balance',
      '01/01/2025,,,,"12,000.00"',
      '02/01/2025,"1,066.19",946.19,120.00,"11,053.81"',
      '03/01/2025,"1,066.19",,110.54,"10,098.16"',
      '01/01/2030,"1,066.19",900.00,10.00,0',
      'Totals,"12,794.28",,794.28,',
    ].join('\n'));
    const r = readBankTable(cells, guessMapping(cells[0]!), { header: true, dateFormat: 'mdy', numberFormat: 'dot' }, plain.rows);
    expect(r.rows).toEqual([
      { payment: 1, dueDate: '2025-02-01', paymentAmount: 106_619, principal: 94_619, interest: 12_000, balance: 1_105_381 },
      // Principal worked out from the payment when its column is empty.
      { payment: 2, dueDate: '2025-03-01', paymentAmount: 106_619, principal: 95_565, interest: 11_054, balance: 1_009_816 },
    ]);
    expect(r.skipped).toEqual([
      { line: 2, reason: 'No interest amount' },
      { line: 5, reason: 'Its date is not on the schedule' },
      { line: 6, reason: 'No date' },
    ]);
  });
});

describe("the lender's table in the schedule", () => {
  // The lender's interest differs from the calculation (say, a different day count) for months 1 to 3.
  const bank = new Map([
    [1, { principal: 94_219, interest: 12_400 }],
    [2, { principal: 95_000, interest: 11_619 }],
    [3, { principal: 96_000, interest: 10_619 }],
  ]);

  it("uses the lender's interest and principal exactly, and carries on from the balance they leave", () => {
    const s = generateSchedule(LOAN, { bankRows: bank });
    expect(s.rows.slice(0, 3).map((r) => [r.interest, r.scheduledPrincipal, r.fromBank])).toEqual([
      [12_400, 94_219, true],
      [11_619, 95_000, true],
      [10_619, 96_000, true],
    ]);
    const after3 = 1_200_000 - 94_219 - 95_000 - 96_000;
    expect(s.rows[2]!.endingBalance).toBe(after3);
    // Month 4 is calculated again, from that balance: 1% of it.
    expect(s.rows[3]).toMatchObject({ fromBank: false, beginningBalance: after3, interest: Math.round(after3 * 0.01) });
    expect(s.rows.at(-1)!.endingBalance).toBe(0);
  });

  it('keeps penny offsets and the P&I override working', () => {
    const s = generateSchedule(LOAN, { bankRows: bank, adjustments: [{ kind: 'pennyOffset', payment: 2, amount: 1 }] });
    expect(s.rows[1]).toMatchObject({ interest: 11_619, scheduledPrincipal: 95_000, pennyOffset: 1, principal: 95_001 });
    const o = generateSchedule({ ...LOAN, piPaymentOverride: 107_000 }, { bankRows: bank });
    expect(o.rows[0]!.interest).toBe(12_400);
    expect(o.rows[3]!.principalAndInterest).toBe(107_000);
  });

  it('leaves reconciled and skipped months alone', () => {
    const locked = new Map<number, LockedPayment>([[1, lockRow(plain.rows[0]!)]]);
    const s = generateSchedule(LOAN, { bankRows: bank, locked, adjustments: [{ kind: 'skip', payment: 2, mode: 'capitalize' }] });
    expect(s.rows[0]).toMatchObject({ locked: true, interest: plain.rows[0]!.interest, fromBank: false });
    expect(s.rows[1]).toMatchObject({ skipped: 'capitalize', fromBank: false });
    expect(s.rows[2]).toMatchObject({ interest: 10_619, fromBank: true });
  });

  it('a removed table goes back to the calculation', () => {
    expect(generateSchedule(LOAN, { bankRows: new Map() }).rows).toEqual(plain.rows);
  });
});
