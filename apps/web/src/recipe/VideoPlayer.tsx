import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Video } from '../api/types';
import { Button } from '../design/Button';
import { getRuntime } from '../telegram/sdk';
import { splitDuration } from './amounts';

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export const youtubeWatchUrl = (id: string, startSec: number) =>
  `https://www.youtube.com/watch?v=${id}${startSec > 0 ? `&t=${startSec}s` : ''}`;

export function youtubeEmbedUrl(id: string, startSec: number): string {
  const q = new URLSearchParams({ autoplay: '1', playsinline: '1', rel: '0' });
  if (startSec > 0) q.set('start', String(startSec));
  return `https://www.youtube-nocookie.com/embed/${id}?${q.toString()}`;
}

const clock = (sec: number) => {
  const { h, m, s } = splitDuration(sec);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
};

/**
 * YouTube only (PRD 1.5 #6). Nothing is loaded from YouTube until the user taps play (faster card,
 * no third-party request on open); then the privacy-enhanced player starts at the step's second.
 * "Open in YouTube" is the fallback for clients where the embedded player does not work (A-22).
 */
export function VideoPlayer({ video, startSec }: { video: Video; startSec: number | null }) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  if (!YOUTUBE_ID.test(video.youtube_id)) return null;
  const start = startSec ?? 0;
  const title = video.title ?? t('recipe.video');
  return (
    <div className="stack stack--tight">
      {playing ? (
        <iframe
          className="video"
          src={youtubeEmbedUrl(video.youtube_id, start)}
          title={title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          // YouTube refuses embeds that send no referrer.
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <button type="button" className="video video__facade" onClick={() => setPlaying(true)}>
          <span className="video__play" aria-hidden="true">
            {'▶'}
          </span>
          <span>{title}</span>
          {start > 0 && (
            <span className="hint">{t('recipe.video_from', { time: clock(start) })}</span>
          )}
        </button>
      )}
      <Button
        variant="ghost"
        onClick={() => getRuntime().webApp.openLink(youtubeWatchUrl(video.youtube_id, start))}
      >
        {t('recipe.video_open')}
      </Button>
    </div>
  );
}
