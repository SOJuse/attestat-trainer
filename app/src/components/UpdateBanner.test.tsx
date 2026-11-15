import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakePlatform } from '../platform/fake';
import { UpdateBanner } from './UpdateBanner';

const withUpdate = (installAppUpdate: () => Promise<void>) =>
  createFakePlatform({ checkAppUpdate: async () => ({ version: '0.2.0' }), installAppUpdate });

describe('UpdateBanner', () => {
  it('ничего не показывает, если обновлений нет', async () => {
    const checkAppUpdate = vi.fn(async () => null);
    const { container } = render(<UpdateBanner platform={createFakePlatform({ checkAppUpdate })} />);
    await waitFor(() => expect(checkAppUpdate).toHaveBeenCalledOnce());
    expect(container).toBeEmptyDOMElement();
  });

  it('молчит, если проверка упала (нет сети, 404)', async () => {
    const checkAppUpdate = vi.fn(async () => {
      throw new Error('offline');
    });
    const { container } = render(<UpdateBanner platform={createFakePlatform({ checkAppUpdate })} />);
    await waitFor(() => expect(checkAppUpdate).toHaveBeenCalledOnce());
    expect(container).toBeEmptyDOMElement();
  });

  it('предлагает обновление и запускает установку', async () => {
    const installAppUpdate = vi.fn(async () => {});
    render(<UpdateBanner platform={withUpdate(installAppUpdate)} />);
    expect(await screen.findByRole('status')).toHaveTextContent('Доступна версия 0.2.0');
    await userEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(installAppUpdate).toHaveBeenCalledOnce();
  });

  it('показывает ход загрузки в процентах', async () => {
    let finish = () => {};
    const installAppUpdate = (onProgress?: (f: number) => void) => {
      onProgress?.(0.42);
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    };
    render(<UpdateBanner platform={withUpdate(installAppUpdate)} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Обновить' }));
    expect(await screen.findByText('Загрузка: 42%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Обновить' })).not.toBeInTheDocument();
    finish();
  });

  it('при сбое установки показывает ошибку и кнопку «Повторить»', async () => {
    const installAppUpdate = vi
      .fn()
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce(undefined);
    render(<UpdateBanner platform={withUpdate(installAppUpdate)} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Обновить' }));
    expect(await screen.findByText(/Не удалось обновить/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(installAppUpdate).toHaveBeenCalledTimes(2);
  });
});
