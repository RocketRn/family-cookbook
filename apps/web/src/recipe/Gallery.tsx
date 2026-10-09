import { useTranslation } from 'react-i18next';
import type { Photo } from '../api/types';
import { photoSrcSet } from './amounts';

/** Cover and step photos in one swipeable strip; the browser picks the 512 or 2048 px version. */
export function Gallery({
  photos,
  title,
  emoji,
}: {
  photos: Photo[];
  title: string;
  emoji: string;
}) {
  const { t } = useTranslation();
  if (photos.length === 0) {
    return (
      <div className="gallery__placeholder" aria-hidden="true">
        {emoji}
      </div>
    );
  }
  return (
    <ul className="gallery" aria-label={t('recipe.photos')}>
      {photos.map((p, i) => (
        <li key={p.id} className="gallery__item">
          <img
            className="gallery__img"
            src={p.url}
            srcSet={photoSrcSet(p)}
            sizes="100vw"
            width={p.width}
            height={p.height}
            alt={i === 0 ? title : t('recipe.photo_n', { n: i + 1 })}
            loading={i === 0 ? 'eager' : 'lazy'}
            decoding="async"
          />
        </li>
      ))}
    </ul>
  );
}
