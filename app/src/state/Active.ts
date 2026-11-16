import { createContext, useContext } from 'react';

/**
 * Виден ли раздел. Разделы остаются смонтированными, когда человек уходит в другой
 * (чтобы начатая тренировка не терялась), но на клавиши реагировать должен только видимый.
 */
export const ActiveSection = createContext(true);
export const useActiveSection = () => useContext(ActiveSection);
