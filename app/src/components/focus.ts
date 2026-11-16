/** Переводит фокус на только что открытое окно подтверждения: его читает экранный диктор, Tab ведёт к кнопкам. */
export function focusOnOpen(el: HTMLElement | null): void {
  el?.focus();
}
