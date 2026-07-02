export function findMainVideo(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
  if (videos.length === 0) return null;
  return videos.reduce((best, video) => {
    const bestArea = best.clientWidth * best.clientHeight;
    const area = video.clientWidth * video.clientHeight;
    return area > bestArea ? video : best;
  });
}
