// 표시용 포맷 함수와 파일명 템플릿 처리. 모두 순수 함수로 유지해 단위 테스트한다.

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[i]}`;
}

/** 밀리초를 HH:MM:SS 또는 MM:SS 로 표시한다. */
export function formatDuration(ms: number, withTenths = false): string {
  if (!Number.isFinite(ms) || ms < 0) return '--:--';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const base = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  if (!withTenths) return base;
  return `${base}.${Math.floor((ms % 1000) / 100)}`;
}

export function formatDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function formatBitrate(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return '-';
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(bps / 1000)} kbps`;
}

const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/g;

/** 운영체제에서 허용하지 않는 문자를 제거한다. */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(FORBIDDEN, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return cleaned.slice(0, 120) || 'hiddenent';
}

/**
 * 파일명 템플릿을 확장한다.
 * 지원 토큰: {date} YYYYMMDD, {time} HHmmss, {type} video|photo, {seq} 3자리 순번
 */
export function buildFileName(
  template: string,
  opts: { kind: 'video' | 'photo'; date: Date; seq: number; extension: string },
): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const d = opts.date;
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const base = (template || 'Hiddenent_{type}_{date}_{time}')
    .replace(/\{date\}/g, date)
    .replace(/\{time\}/g, time)
    .replace(/\{type\}/g, opts.kind)
    .replace(/\{seq\}/g, pad(opts.seq, 3));
  return `${sanitizeFileName(base)}.${opts.extension}`;
}

/** 확장자를 유지한 채 이름만 바꾼다. */
export function renameKeepingExtension(oldName: string, newBase: string): string {
  const dot = oldName.lastIndexOf('.');
  const ext = dot > 0 ? oldName.slice(dot) : '';
  const stripped = newBase.endsWith(ext) && ext ? newBase.slice(0, -ext.length) : newBase;
  return `${sanitizeFileName(stripped)}${ext}`;
}
