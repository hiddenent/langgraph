// 사용자 동작으로만 실행되는 로컬 다운로드. 네트워크 전송은 없다.

import { zipSync } from 'fflate';

export function downloadBlob(blob: Blob, fileName: string): void {
  let url: string;
  try {
    url = URL.createObjectURL(blob);
  } catch {
    throw new Error('파일을 준비하지 못했습니다(메모리 부족 가능성). 다른 탭을 닫고 다시 시도하세요.');
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
    // 다운로드가 시작될 시간을 준 뒤 URL 을 해제한다.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** 여러 파일을 무압축 ZIP 하나로 묶는다(미디어는 이미 압축되어 있음). */
export async function zipBlobs(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  const used = new Set<string>();
  for (const f of files) {
    let name = f.name;
    let n = 1;
    while (used.has(name)) {
      const dot = f.name.lastIndexOf('.');
      name = dot > 0 ? `${f.name.slice(0, dot)} (${n})${f.name.slice(dot)}` : `${f.name} (${n})`;
      n++;
    }
    used.add(name);
    entries[name] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }];
  }
  const data = zipSync(entries);
  return new Blob([data], { type: 'application/zip' });
}
