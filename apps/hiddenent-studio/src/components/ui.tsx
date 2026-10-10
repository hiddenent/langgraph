// 공통 UI 요소: 접이식 패널, 폼 필드, 토글, 모달, 확인 대화상자.

import { ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon';

export function Panel({
  title,
  icon,
  children,
  defaultOpen = true,
  badge,
}: {
  title: string;
  icon?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className={`panel ${open ? 'panel--open' : ''}`}>
      <h3 className="panel__h">
        <button type="button" className="panel__toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          {icon && <Icon name={icon} size={16} />}
          <span>{title}</span>
          {badge}
          <Icon name="chevronDown" size={14} className="panel__chev" />
        </button>
      </h3>
      <div id={id} className="panel__body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <div className="field__hint">{hint}</div>}
    </div>
  );
}

export interface Option<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

export function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
  hint,
  testId,
}: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange(v: T): void;
  disabled?: boolean;
  hint?: ReactNode;
  testId?: string;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <select
        id={id}
        className="select"
        value={String(value)}
        disabled={disabled}
        data-testid={testId}
        onChange={(e) => {
          const raw = e.target.value;
          const opt = options.find((o) => String(o.value) === raw);
          if (opt) onChange(opt.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  disabled,
  hint,
  testId,
}: {
  label: ReactNode;
  checked: boolean;
  onChange(v: boolean): void;
  disabled?: boolean;
  hint?: ReactNode;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className={`toggle ${disabled ? 'toggle--disabled' : ''}`}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
      />
      <label htmlFor={id}>
        <span className="toggle__track" aria-hidden="true">
          <span className="toggle__thumb" />
        </span>
        <span className="toggle__text">
          {label}
          {hint && <small className="toggle__hint">{hint}</small>}
        </span>
      </label>
    </div>
  );
}

export function Range({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  disabled,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange(v: number): void;
  format?: (v: number) => string;
  disabled?: boolean;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className="range">
      <div className="range__top">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{format ? format(value) : value}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        data-testid={testId}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange(v: T): void;
  disabled?: boolean;
}) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            className={`seg__btn ${o.value === value ? 'seg__btn--on' : ''}`}
            disabled={disabled || o.disabled}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// 열린 모달 스택: Esc 는 가장 위의 모달만 닫는다.
const modalStack: number[] = [];
let modalSeq = 1;

export function isModalOpen(): boolean {
  return modalStack.length > 0;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  testId,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<Element | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const token = modalSeq++;
    modalStack.push(token);
    prevFocus.current = document.activeElement;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === token) {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !el) return;
      if (modalStack[modalStack.length - 1] !== token) return;
      const focusables = Array.from(
        el.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'),
      );
      if (focusables.length === 0) return;
      const f = focusables[0];
      const l = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === f) {
        e.preventDefault();
        l.focus();
      } else if (!e.shiftKey && document.activeElement === l) {
        e.preventDefault();
        f.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const idx = modalStack.indexOf(token);
      if (idx >= 0) modalStack.splice(idx, 1);
      (prevFocus.current as HTMLElement | null)?.focus?.();
    };
  }, []);
  const titleId = useId();
  return (
    <div className="modal" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`modal__box ${wide ? 'modal__box--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
      >
        <header className="modal__head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="닫기 (Esc)" title="닫기 (Esc)">
            <Icon name="x" />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      testId="confirm-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            돌아가기
          </button>
          <button type="button" className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} onClick={onConfirm} data-testid="confirm-ok">
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm__msg">{message}</div>
    </Modal>
  );
}

export function StatusPill({ ok, label, testId }: { ok: boolean | null; label: string; testId?: string }) {
  return (
    <span className={`pill ${ok === null ? 'pill--na' : ok ? 'pill--ok' : 'pill--no'}`} data-testid={testId}>
      <Icon name={ok === null ? 'info' : ok ? 'check' : 'x'} size={12} />
      {label}
    </span>
  );
}
