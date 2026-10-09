import { createContext, useContext } from 'react';
import type { Settings, StudioMode } from './core/settings';
import type { AudioMeterHandle } from './hooks/useAudioMeter';
import type { LibraryHandle } from './hooks/useLibrary';
import type { MediaSession } from './hooks/useMediaSession';
import type { PhotoCaptureHandle } from './hooks/usePhotoCapture';
import type { ToastKind } from './hooks/useToasts';
import type { VideoRecorderHandle } from './hooks/useVideoRecorder';

export type Section = StudioMode | 'library' | 'settings' | 'help';

export interface Studio {
  settings: Settings;
  update(fn: (s: Settings) => Settings): void;
  patch<K extends 'video' | 'audio' | 'photo' | 'guides' | 'library' | 'ui'>(key: K, value: Partial<Settings[K]>): void;
  section: Section;
  setSection(s: Section): void;
  mode: StudioMode;
  session: MediaSession;
  meter: AudioMeterHandle;
  recorder: VideoRecorderHandle;
  photo: PhotoCaptureHandle;
  library: LibraryHandle;
  notify(kind: ToastKind, msg: string): void;
  /** 녹화·카운트다운·연속 촬영 중이면 장치/설정 변경을 막는다 */
  locked: boolean;
  switchCamera(): void;
  hardwareZoom: { min: number; max: number; step: number } | null;
  setZoom(z: number): void;
  videoRef: React.RefObject<HTMLVideoElement>;
}

export const StudioContext = createContext<Studio | null>(null);

export function useStudio(): Studio {
  const s = useContext(StudioContext);
  if (!s) throw new Error('StudioContext 가 없습니다.');
  return s;
}
