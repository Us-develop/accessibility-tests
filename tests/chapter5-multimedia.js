/**
 * Chapter 5: Multimedia, Animations, and Motion
 * Based on: module-multimedia-checklist.pdf
 */
import { pageCollect } from './describe-els.js';

export const chapterId = 'multimedia';

export async function runMultimediaChecks(page) {
  const results = [];

  const videoChecks = await pageCollect(page, function collector(describeEls, limit) {
    const videos = Array.from(document.querySelectorAll('video'));
    const noCaptions = [];
    const autoplay = [];
    videos.forEach((video) => {
      const tracks = video.querySelectorAll('track');
      const hasCaptions = Array.from(tracks).some((t) =>
        /captions|subtitles/i.test(t.getAttribute('kind') || '')
      );
      if (!hasCaptions) noCaptions.push(video);
      if (video.autoplay) autoplay.push(video);
    });
    return {
      total: videos.length,
      noCaptions: noCaptions.length,
      autoplay: autoplay.length,
      captionOccurrences: describeEls(noCaptions, limit),
      autoplayOccurrences: describeEls(autoplay, limit),
    };
  });

  if (videoChecks.total > 0) {
    results.push({
      id: 'video-captions',
      rule: 'Prerecorded video MUST include synchronized captions',
      status: videoChecks.noCaptions === 0 ? 'pass' : 'fail',
      message:
        videoChecks.noCaptions > 0
          ? `${videoChecks.noCaptions} video(s) without caption track`
          : 'All videos have caption tracks',
      chapter: chapterId,
      occurrences: videoChecks.noCaptions > 0 ? videoChecks.captionOccurrences : [],
    });
    if (videoChecks.autoplay > 0) {
      results.push({
        id: 'video-autoplay',
        rule: 'Auto-play video (>5s) MUST have pause/stop mechanism',
        status: 'warn',
        message: `${videoChecks.autoplay} video(s) with autoplay - verify pause control exists`,
        chapter: chapterId,
        occurrences: videoChecks.autoplayOccurrences,
      });
    }
  }

  const audioChecks = await pageCollect(page, function collector(describeEls, limit) {
    const autoplay = Array.from(document.querySelectorAll('audio')).filter((audio) => audio.autoplay);
    return { autoplay: autoplay.length, occurrences: describeEls(autoplay, limit) };
  });

  if (audioChecks.autoplay > 0) {
    results.push({
      id: 'audio-autoplay',
      rule: 'Audio auto-playing >3s MUST have stop/pause/mute control',
      status: 'warn',
      message: `${audioChecks.autoplay} audio element(s) with autoplay`,
      chapter: chapterId,
      occurrences: audioChecks.occurrences,
    });
  }

  const flashChecks = await pageCollect(page, function collector(describeEls, limit) {
    const objects = Array.from(document.querySelectorAll('object, embed')).filter(
      (o) =>
        (o.getAttribute('type') || '').includes('flash') ||
        (o.getAttribute('data') || o.getAttribute('src') || '').includes('.swf')
    );
    return { flashCount: objects.length, occurrences: describeEls(objects, limit) };
  });

  if (flashChecks.flashCount > 0) {
    results.push({
      id: 'flash-alternative',
      rule: 'Flash/Silverlight SHOULD have HTML alternative',
      status: 'warn',
      message: `${flashChecks.flashCount} Flash/plugin object(s) found - ensure accessible alternative`,
      chapter: chapterId,
      occurrences: flashChecks.occurrences,
    });
  }

  const embedPlayers = await pageCollect(page, function collector(describeEls, limit) {
    const iframes = Array.from(document.querySelectorAll('iframe[src]')).filter((el) => {
      const src = (el.getAttribute('src') || '').toLowerCase();
      return /youtube|youtu\.be|vimeo|dailymotion|wistia|loom\.com/.test(src);
    });
    return { count: iframes.length, occurrences: describeEls(iframes, limit) };
  });
  if (embedPlayers.count > 0) {
    results.push({
      id: 'embedded-media-captions',
      rule: 'Embedded video players must be checked manually for captions (WCAG 1.2.2)',
      status: 'info',
      message: `Found ${embedPlayers.count} YouTube/Vimeo/other embed(s). Native <track> checks do not apply; a human must verify captions.`,
      chapter: chapterId,
      occurrences: embedPlayers.occurrences,
    });
  }

  return results;
}
