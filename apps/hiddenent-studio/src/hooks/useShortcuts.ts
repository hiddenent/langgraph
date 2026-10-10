import { useEffect, useRef } from 'react';

export interface ShortcutHandlers {
  space(): void;
  v(): void;
  p(): void;
  m(): void;
  g(): void;
  escape(): void;
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time']);

/**
 * 텍스트 편집 중에는 단축키를 실행하지 않는다.
 * 키보드로 포커스된 버튼/체크박스/선택 상자에서는 Space 가 원래 동작(클릭)하도록 둔다(접근성).
 */
export function shouldIgnoreShortcut(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    if (TEXT_INPUT_TYPES.has(type)) return true;
  }
  if (key === ' ' || key === 'Enter') {
    const interactive = tag === 'BUTTON' || tag === 'SELECT' || tag === 'INPUT' || tag === 'A' || target.getAttribute('role') === 'button';
    if (interactive) {
      try {
        if (target.matches(':focus-visible')) return true;
      } catch {
        return true;
      }
    }
  }
  return false;
}

export function useShortcuts(handlers: ShortcutHandlers, enabled: boolean): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        ref.current.escape();
        return;
      }
      if (shouldIgnoreShortcut(e.target, e.key)) return;
      // 키를 누르고 있을 때의 반복 입력은 무시(녹화 시작/종료 연타 방지)
      if (e.repeat) {
        if (e.key === ' ') e.preventDefault();
        return;
      }
      switch (e.key.toLowerCase()) {
        case ' ':
          e.preventDefault();
          ref.current.space();
          break;
        case 'v':
          ref.current.v();
          break;
        case 'p':
          ref.current.p();
          break;
        case 'm':
          ref.current.m();
          break;
        case 'g':
          ref.current.g();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
