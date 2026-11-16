import { describe, expect, it } from 'vitest';
import { loadRegistry } from './corpus';

const reg = loadRegistry('..');
const LIST_SIZE = 258;

describe('реестр документов', () => {
  it('в реестре все позиции списка литературы, без пропусков и повторов', () => {
    const nos = reg.flatMap((e) => (e.list_no ? [e.list_no] : [])).sort((a, b) => a - b);
    expect(nos).toEqual(Array.from({ length: LIST_SIZE }, (_, i) => i + 1));
  });

  it('идентификаторы уникальны и по формату', () => {
    expect(new Set(reg.map((e) => e.id)).size).toBe(reg.length);
    for (const e of reg) expect(e.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('модули известных актов совпадают со списком', () => {
    const by = (n: number) => reg.find((e) => e.list_no === n)!;
    expect(by(1).modules).toEqual(['P']); // Конституция
    expect(by(6).modules).toEqual(['K', 'R', 'P', 'I']); // ГК РФ
    expect(by(7).modules).toEqual(['K']); // 181-ФЗ
  });

  it('без модуля только те четыре позиции, у которых его нет в PDF', () => {
    const empty = reg.filter((e) => e.modules.length === 0).map((e) => e.list_no);
    expect(empty).toEqual([224, 232, 242, 249]);
  });

  it('число отметок по модулям совпадает с подсчётом по PDF', () => {
    const count = (m: string) => reg.filter((e) => e.list_no && e.modules.includes(m as never)).length;
    expect(['K', 'R', 'P', 'Rez', 'I'].map(count)).toEqual([43, 73, 87, 45, 52]);
  });

  it('Р-144 (показатели деятельности) стоит в списке под номером 191', () => {
    expect(reg.find((e) => e.id === 'donm-r-144')?.list_no).toBe(191);
  });

  it('есть акты по аттестации', () => {
    const ids = reg.filter((e) => !e.list_no).map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['donm-pr-13', 'donm-pr-1182', 'donm-pr-560']));
  });
});
