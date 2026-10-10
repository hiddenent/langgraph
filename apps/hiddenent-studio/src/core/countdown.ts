/** 1초 단위 카운트다운. 취소되면 false 를 돌려준다. */
export function runCountdown(seconds: number, onTick: (left: number) => void, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (seconds <= 0) {
      resolve(!signal.aborted);
      return;
    }
    let left = seconds;
    onTick(left);
    const id = window.setInterval(() => {
      left -= 1;
      if (left <= 0) {
        window.clearInterval(id);
        onTick(0);
        resolve(!signal.aborted);
      } else {
        onTick(left);
      }
    }, 1000);
    signal.addEventListener('abort', () => {
      window.clearInterval(id);
      onTick(0);
      resolve(false);
    });
  });
}

export function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const id = window.setTimeout(() => resolve(true), ms);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(id);
      resolve(false);
    });
  });
}
