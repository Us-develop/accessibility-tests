/**
 * Chapter 5: Multimedia, Animations, and Motion
 * Based on: module-multimedia-checklist.pdf
 */
export const chapterId = 'multimedia';

export async function runMultimediaChecks(page) {
  const results = [];

  // Video elements
  const videoChecks = await page.evaluate(() => {
    const videos = document.querySelectorAll('video');
    const noCaptions = [];
    const autoplay = [];
    videos.forEach((video, i) => {
      const tracks = video.querySelectorAll('track');
      const hasCaptions = Array.from(tracks).some((t) =>
        /captions|subtitles/i.test(t.getAttribute('kind') || '')
      );
      if (!hasCaptions) noCaptions.push(i + 1);
      if (video.autoplay) autoplay.push(i + 1);
    });
    return { total: videos.length, noCaptions, autoplay };
  });

  if (videoChecks.total > 0) {
    results.push({
      id: 'video-captions',
      rule: 'Prerecorded video MUST include synchronized captions',
      status: videoChecks.noCaptions.length === 0 ? 'pass' : 'fail',
      message:
        videoChecks.noCaptions.length > 0
          ? `${videoChecks.noCaptions.length} video(s) without caption track`
          : 'All videos have caption tracks',
      chapter: chapterId,
    });
    if (videoChecks.autoplay.length > 0) {
      results.push({
        id: 'video-autoplay',
        rule: 'Auto-play video (>5s) MUST have pause/stop mechanism',
        status: 'warn',
        message: `${videoChecks.autoplay.length} video(s) with autoplay - verify pause control exists`,
        chapter: chapterId,
      });
    }
  }

  // Audio elements
  const audioChecks = await page.evaluate(() => {
    const audios = document.querySelectorAll('audio');
    const autoplay = [];
    audios.forEach((audio, i) => {
      if (audio.autoplay) autoplay.push(i + 1);
    });
    return { total: audios.length, autoplay };
  });

  if (audioChecks.autoplay.length > 0) {
    results.push({
      id: 'audio-autoplay',
      rule: 'Audio auto-playing >3s MUST have stop/pause/mute control',
      status: 'warn',
      message: `${audioChecks.autoplay.length} audio element(s) with autoplay`,
      chapter: chapterId,
    });
  }

  // Flash content (deprecated but still checked)
  const flashChecks = await page.evaluate(() => {
    const objects = document.querySelectorAll('object, embed');
    const flashCount = Array.from(objects).filter(
      (o) =>
        (o.getAttribute('type') || '').includes('flash') ||
        (o.getAttribute('data') || o.getAttribute('src') || '').includes('.swf')
    ).length;
    return flashCount;
  });

  if (flashChecks > 0) {
    results.push({
      id: 'flash-alternative',
      rule: 'Flash/Silverlight SHOULD have HTML alternative',
      status: 'warn',
      message: `${flashChecks} Flash/plugin object(s) found - ensure accessible alternative`,
      chapter: chapterId,
    });
  }

  const embedPlayers = await page.evaluate(() => {
    const iframes = Array.from(document.querySelectorAll('iframe[src]'));
    return iframes.filter((el) => {
      const src = (el.getAttribute('src') || '').toLowerCase();
      return /youtube|youtu\.be|vimeo|dailymotion|wistia|loom\.com/.test(src);
    }).length;
  });
  if (embedPlayers > 0) {
    results.push({
      id: 'embedded-media-captions',
      rule: 'Embedded video players must be checked manually for captions (WCAG 1.2.2)',
      status: 'info',
      message: `Found ${embedPlayers} YouTube/Vimeo/other embed(s). Native <track> checks do not apply; a human must verify captions.`,
      chapter: chapterId,
    });
  }

  return results;
}
