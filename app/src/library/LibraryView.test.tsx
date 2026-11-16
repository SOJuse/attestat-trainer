import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakeLibrary } from '../platform/fake';
import { LibraryError, type DocInfo, type LibraryStore, type SectionBody } from '../platform/Library';
import { LibraryView } from './LibraryView';

const info = (over: Partial<DocInfo>): DocInfo => ({
  id: 'tk-rf',
  title: 'Трудовой кодекс Российской Федерации',
  short: 'ТК РФ',
  kind: 'federal-law',
  number: '197-ФЗ',
  date: '2001-12-30',
  edition: '2026-09-01',
  sourceUrl: 'http://actual.pravo.gov.ru/text.html#hash=abc',
  fetched: '2026-11-16',
  modules: ['K', 'R'],
  textStatus: 'full',
  note: null,
  listNo: 8,
  editionStatus: 'current',
  amendedBy: [],
  ...over,
});

const DOCS = [
  info({}),
  info({ id: 'fz-273', title: 'Об образовании в Российской Федерации', short: '273-ФЗ', modules: ['P'], listNo: 14 }),
  info({ id: 'lit-242', title: 'Письмо заместителя руководителя', short: null, modules: ['I'], textStatus: 'missing', sourceUrl: null, edition: null, listNo: 242 }),
];

const body = (ord: number): SectionBody => ({
  anchor: `st-${ord + 1}`,
  heading: `Статья ${ord + 1}. Заголовок`,
  ord,
  text: `Текст статьи ${ord + 1}.`,
  // первые две статьи в главе 1, дальше глава 2
  context: ord < 2 ? 'Глава 1. Общие положения' : 'Глава 2. Трудовые отношения',
});

function library(over: Partial<LibraryStore> = {}, total = 3): LibraryStore {
  return createFakeLibrary({
    status: async () => ({ installed: true, packVersion: '2026.11.20.1', docs: DOCS.length }),
    list: async () => DOCS,
    doc: async (id) => {
      const d = DOCS.find((x) => x.id === id)!;
      const n = d.textStatus === 'full' ? total : 0;
      return { info: d, sections: Array.from({ length: n }, (_, ord) => ({ ...body(ord), text: undefined })) };
    },
    sections: vi.fn(async (_id, from, count) =>
      Array.from({ length: Math.max(0, Math.min(count, total - from)) }, (_, i) => body(from + i)),
    ),
    ...over,
  });
}

const notInstalled = (over: Partial<LibraryStore> = {}) =>
  library({
    status: async () => ({ installed: false, packVersion: null, docs: 0 }),
    available: async () => ({ packVersion: '2026.11.20.1', bytes: 18 * 1024 * 1024, docs: 263 }),
    ...over,
  });

describe('LibraryView: установка', () => {
  it('объясняет, что библиотеку нужно скачать, и называет размер', async () => {
    render(<LibraryView library={notInstalled()} openExternal={async () => {}} />);
    expect(await screen.findByText(/скачивается один раз/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Скачать, 18 МБ' })).toBeInTheDocument();
  });

  it('скачивает по кнопке, показывает ход и открывает список', async () => {
    let finish: (value: 'installed') => void = () => {};
    let installed = false;
    const lib = notInstalled({
      status: async () => ({ installed, packVersion: installed ? '2026.11.20.1' : null, docs: installed ? 3 : 0 }),
      update: vi.fn((onProgress) => {
        onProgress?.(0.4);
        return new Promise<'installed'>((resolve) => {
          finish = resolve;
        });
      }),
    });
    render(<LibraryView library={lib} openExternal={async () => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /Скачать/ }));
    expect(await screen.findByText('Загрузка: 40%')).toBeInTheDocument();
    installed = true;
    finish('installed');
    expect(await screen.findByRole('searchbox', { name: 'Поиск по документам' })).toBeInTheDocument();
  });

  it('без сети объясняет причину и даёт повторить', async () => {
    const update = vi.fn().mockRejectedValueOnce(new LibraryError('network')).mockResolvedValueOnce('installed');
    render(<LibraryView library={notInstalled({ update })} openExternal={async () => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /Скачать/ }));
    expect(await screen.findByText(/Не удалось скачать библиотеку/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('если сервер недоступен ещё до скачивания, остальные слова на месте и есть «Повторить»', async () => {
    const lib = notInstalled({ available: async () => Promise.reject(new LibraryError('network')) });
    render(<LibraryView library={lib} openExternal={async () => {}} />);
    expect(await screen.findByText(/нужно подключение к интернету/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });

  it('пакет новее программы: просит обновить программу, повтора нет', async () => {
    const lib = notInstalled({ available: async () => Promise.reject(new LibraryError('app-too-old')) });
    render(<LibraryView library={lib} openExternal={async () => {}} />);
    expect(await screen.findByText(/Обновите программу/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument();
  });

  it.each(['checksum', 'signature', 'bad-pack'] as const)('повреждённый пакет (%s) не ставится, есть повтор', async (c) => {
    const update = vi.fn().mockRejectedValue(new LibraryError(c));
    render(<LibraryView library={notInstalled({ update })} openExternal={async () => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /Скачать/ }));
    expect(await screen.findByText(/Файл библиотеки пришёл повреждённым/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});

describe('LibraryView: список и поиск', () => {
  it('показывает документы и фильтрует по модулю', async () => {
    render(<LibraryView library={library()} openExternal={async () => {}} />);
    const list = await screen.findByRole('list', { name: 'Документы' });
    // список появляется пустым и заполняется, когда придёт ответ библиотеки
    expect(await within(list).findAllByRole('button')).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'Процессы' }));
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringContaining('Об образовании'),
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Все' }));
    expect(within(list).getAllByRole('button')).toHaveLength(3);
  });

  it('ищет один раз после паузы и открывает найденный раздел', async () => {
    const search = vi.fn(async () => [
      { docId: 'tk-rf', docTitle: 'Трудовой кодекс Российской Федерации', anchor: 'st-2', heading: 'Статья 2. Заголовок', snippet: '…отпуск по уходу…' },
    ]);
    const lib = library({ search });
    render(<LibraryView library={lib} openExternal={async () => {}} />);
    await userEvent.type(await screen.findByRole('searchbox'), 'отпуск по уходу');
    const hit = await screen.findByRole('button', { name: /Статья 2\. Заголовок/ });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('отпуск по уходу', 50);
    await userEvent.click(hit);
    expect(await screen.findByRole('heading', { level: 1, name: 'Трудовой кодекс Российской Федерации' })).toBeInTheDocument();
    await waitFor(() => expect(lib.sections).toHaveBeenCalledWith('tk-rf', 1, 30));
    expect(await screen.findByText('Текст статьи 2.')).toBeInTheDocument();
  });

  it('после возврата из читалки поиск и фильтр остаются как были', async () => {
    const search = vi.fn(async () => [
      { docId: 'tk-rf', docTitle: 'Трудовой кодекс Российской Федерации', anchor: 'st-2', heading: 'Статья 2. Заголовок', snippet: '…отпуск…' },
    ]);
    render(<LibraryView library={library({ search })} openExternal={async () => {}} />);
    await userEvent.type(await screen.findByRole('searchbox'), 'отпуск');
    await userEvent.click(await screen.findByRole('button', { name: /Статья 2\. Заголовок/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'К списку' }));
    expect(screen.getByRole('searchbox')).toHaveValue('отпуск');
    expect(await screen.findByRole('button', { name: /Статья 2\. Заголовок/ })).toBeInTheDocument();
  });

  it('фильтр по модулю тоже переживает возврат из читалки', async () => {
    render(<LibraryView library={library()} openExternal={async () => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Процессы' }));
    await userEvent.click(await screen.findByRole('button', { name: /Об образовании/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'К списку' }));
    expect(screen.getByRole('button', { name: 'Процессы' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('пустой результат подсказывает, что попробовать', async () => {
    render(<LibraryView library={library({ search: async () => [] })} openExternal={async () => {}} />);
    await userEvent.type(await screen.findByRole('searchbox'), 'абракадабра');
    expect(await screen.findByText(/Ничего не нашлось/)).toBeInTheDocument();
  });

  it('ошибка поиска не роняет раздел', async () => {
    const lib = library({ search: async () => Promise.reject(new LibraryError('query')) });
    render(<LibraryView library={lib} openExternal={async () => {}} />);
    await userEvent.type(await screen.findByRole('searchbox'), 'отпуск');
    expect(await screen.findByText(/Ничего не нашлось/)).toBeInTheDocument();
  });
});

describe('LibraryView: чтение', () => {
  it('большой документ грузит первые 30 разделов и догружает по кнопке', async () => {
    const lib = library({}, 500);
    render(<LibraryView library={lib} openExternal={async () => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /Трудовой кодекс/ }));
    expect(await screen.findByText('Текст статьи 30.')).toBeInTheDocument();
    expect(lib.sections).toHaveBeenCalledTimes(1);
    expect(lib.sections).toHaveBeenCalledWith('tk-rf', 0, 30);
    expect(screen.queryByText('Текст статьи 31.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Показать дальше' }));
    expect(await screen.findByText('Текст статьи 60.')).toBeInTheDocument();
  });

  it('название главы показывает один раз, над первой её статьёй', async () => {
    render(<LibraryView library={library({}, 4)} openExternal={async () => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /Трудовой кодекс/ }));
    await screen.findByText('Текст статьи 4.');
    expect(screen.getAllByText('Глава 1. Общие положения')).toHaveLength(1);
    expect(screen.getAllByText('Глава 2. Трудовые отношения')).toHaveLength(1);
    const order = [...document.querySelectorAll('.section__context, .section h2')].map((e) => e.textContent);
    expect(order).toEqual([
      'Глава 1. Общие положения',
      'Статья 1. Заголовок',
      'Статья 2. Заголовок',
      'Глава 2. Трудовые отношения',
      'Статья 3. Заголовок',
      'Статья 4. Заголовок',
    ]);
  });

  it('показывает редакцию и открывает источник', async () => {
    const openExternal = vi.fn(async () => {});
    render(<LibraryView library={library()} openExternal={openExternal} />);
    await userEvent.click(await screen.findByRole('button', { name: /Трудовой кодекс/ }));
    expect(await screen.findByText(/Редакция от 01\.09\.2026/)).toBeInTheDocument();
    expect(screen.getByText(/скачано 16\.11\.2026/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Открыть источник' }));
    expect(openExternal).toHaveBeenCalledWith('http://actual.pravo.gov.ru/text.html#hash=abc');
  });

  it('переход по оглавлению грузит нужное место', async () => {
    const lib = library({}, 500);
    render(<LibraryView library={lib} openExternal={async () => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /Трудовой кодекс/ }));
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Перейти к разделу' }), 'st-256');
    expect(await screen.findByText('Текст статьи 256.')).toBeInTheDocument();
    expect(lib.sections).toHaveBeenLastCalledWith('tk-rf', 255, 30);
  });

  it('у распознанного со скана документа есть предупреждение, текст при этом показан', async () => {
    const scanned = info({ id: 'prikaz-373', title: 'Порядок дошкольного образования', short: null, textStatus: 'ocr', listNo: 100 });
    const lib = library({
      list: async () => [scanned],
      doc: async () => ({ info: scanned, sections: [{ anchor: 'st-1', heading: 'Статья 1. Заголовок', ord: 0 }] }),
    });
    render(<LibraryView library={lib} openExternal={async () => {}} />);
    const item = await screen.findByRole('button', { name: /Порядок дошкольного образования/ });
    expect(item).toHaveTextContent('распознан со скана');
    await userEvent.click(item);
    expect(await screen.findByText(/Текст распознан со скана/)).toBeInTheDocument();
    expect(screen.getByText(/сверяйте с источником/)).toBeInTheDocument();
    expect(await screen.findByText('Текст статьи 1.')).toBeInTheDocument();
    expect(screen.queryByText(/Текста этого документа в библиотеке нет/)).not.toBeInTheDocument();
  });

  it('переход к разделу, с которого документ открыт, не оставляет страницу пустой', async () => {
    const lib = library({}, 100);
    render(<LibraryView library={lib} openExternal={async () => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /Трудовой кодекс/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Показать дальше' }));
    expect(await screen.findByText('Текст статьи 60.')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Перейти к разделу' }), 'st-1');
    expect(await screen.findByText('Текст статьи 1.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Текст статьи 60.')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Показать дальше' })).toBeInTheDocument();
  });

  it('двойной щелчок по «Показать дальше» не дублирует разделы', async () => {
    const lib = library({}, 100);
    render(<LibraryView library={lib} openExternal={async () => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /Трудовой кодекс/ }));
    const more = await screen.findByRole('button', { name: 'Показать дальше' });
    await userEvent.dblClick(more);
    await screen.findByText('Текст статьи 60.');
    expect(screen.getAllByText('Текст статьи 31.')).toHaveLength(1);
  });

  it('у текста в исходной редакции сказано, что изменения не внесены, и названы изменившие акты', async () => {
    const original = info({
      id: 'prikaz-373', title: 'Порядок дошкольного образования', short: null, listNo: 100,
      editionStatus: 'original', edition: '2020-07-31',
      amendedBy: ['приказ Минпросвещения России от 01.12.2022 № 1048', 'приказ Минпросвещения России от 29.09.2023 № 731'],
    });
    const lib = library({
      list: async () => [original],
      doc: async () => ({ info: original, sections: [{ anchor: 'st-1', heading: 'Статья 1. Заголовок', ord: 0 }] }),
    });
    render(<LibraryView library={lib} openExternal={async () => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /Порядок дошкольного образования/ }));
    expect(await screen.findByText(/Позднейшие изменения в текст не внесены/)).toBeInTheDocument();
    expect(screen.getByText(/от 01\.12\.2022 № 1048/)).toBeInTheDocument();
    expect(screen.getByText(/В редакции на 31\.07\.2020/)).toBeInTheDocument();
    expect(screen.queryByText(/Редакция от/)).not.toBeInTheDocument();
  });

  it('сбой при открытии источника не роняет читалку', async () => {
    const openExternal = vi.fn(async () => Promise.reject(new Error('forbidden')));
    render(<LibraryView library={library()} openExternal={openExternal} />);
    await userEvent.click(await screen.findByRole('button', { name: /Трудовой кодекс/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Открыть источник' }));
    expect(await screen.findByText(/Не удалось открыть источник/)).toBeInTheDocument();
  });

  it('документ без текста объясняет, почему его нет', async () => {
    render(<LibraryView library={library()} openExternal={async () => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /Письмо заместителя/ }));
    expect(await screen.findByText(/Текста этого документа в библиотеке нет/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Открыть источник' })).not.toBeInTheDocument();
  });

  it('openAt открывает документ на нужном разделе', async () => {
    const lib = library({}, 500);
    render(<LibraryView library={lib} openExternal={async () => {}} openAt={{ docId: 'tk-rf', anchor: 'st-100' }} />);
    expect(await screen.findByText('Текст статьи 100.')).toBeInTheDocument();
    expect(lib.sections).toHaveBeenCalledWith('tk-rf', 99, 30);
  });

  it('кнопка «К списку» возвращает из читалки', async () => {
    render(<LibraryView library={library()} openExternal={async () => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /Трудовой кодекс/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'К списку' }));
    expect(screen.queryByRole('heading', { level: 1, name: /Трудовой кодекс/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Библиотека' })).toBeInTheDocument();
  });
});
