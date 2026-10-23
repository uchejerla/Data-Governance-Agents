import { describe, expect, it } from 'vitest';
import { csvCell, downloadTextFile, toCsv } from './csv';

describe('csv export', () => {
  it('quotes separators, quotes and newlines', () => {
    expect(csvCell('Plain name')).toBe('Plain name');
    expect(csvCell('Raman, Priya')).toBe('"Raman, Priya"');
    expect(csvCell('He said "no"')).toBe('"He said ""no"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('')).toBe('');
    expect(csvCell(null)).toBe('');
    expect(csvCell(0)).toBe('0');
  });

  it('neutralises values a spreadsheet would treat as a formula', () => {
    expect(csvCell('=HYPERLINK("http://evil.example")')).toBe(
      `"'=HYPERLINK(""http://evil.example"")"`,
    );
    expect(csvCell('+41 79 000 00 00')).toBe("'+41 79 000 00 00");
    expect(csvCell('-5')).toBe("'-5");
    expect(csvCell('@team')).toBe("'@team");
  });

  it('writes CRLF rows and terminates the last one', () => {
    const csv = toCsv([
      ['Item key', 'Activity'],
      ['AST-1050-owner', 'Accepted'],
    ]);
    expect(csv).toBe('Item key,Activity\r\nAST-1050-owner,Accepted\r\n');
  });

  it('does nothing outside a browser', () => {
    expect(downloadTextFile('audit.csv', 'a,b\r\n')).toBe(false);
  });
});
