/**
 * Chapter 5: Multimedia, Animations, and Motion
 * Based on: module-multimedia-checklist.pdf
 */
import { pageCollect } from './describe-els.js';
import { say } from './scan-text.js';

export const chapterId = 'multimedia';

export async function runMultimediaChecks(page) {
  const results = [];

  const videoChecks = await pageCollect(page, function collector(describeEls, limit) {
    const allVideos = Array.from(document.querySelectorAll('video'));
    // A muted video the user cannot unmute has no audio to caption (background loops).
    const videos = allVideos.filter((video) => !(video.muted && !video.controls));
    const noCaptions = [];
    const autoplay = [];
    videos.forEach((video) => {
      const tracks = video.querySelectorAll('track');
      const hasCaptions = Array.from(tracks).some((t) =>
        /captions|subtitles/i.test(t.getAttribute('kind') || '')
      );
      if (!hasCaptions) noCaptions.push(video);
    });
    allVideos.forEach((video) => {
      if (video.autoplay) autoplay.push(video);
    });
    return {
      total: allVideos.length,
      captionable: videos.length,
      noCaptions: noCaptions.length,
      autoplay: autoplay.length,
      captionOccurrences: describeEls(noCaptions, limit),
      autoplayOccurrences: describeEls(autoplay, limit),
    };
  });

  if (videoChecks.total > 0) {
    if (videoChecks.captionable > 0) {
      // A warning, not a failure: captions can be burned in or supplied by the
      // player, and a video may have no speech. Only a person can confirm.
      results.push({
        id: 'video-captions',
        rule: say('chk.video-captions.rule'),
        status: videoChecks.noCaptions === 0 ? 'pass' : 'warn',
        message:
          videoChecks.noCaptions > 0
            ? say('chk.video-captions.missing', { n: videoChecks.noCaptions })
            : say('chk.video-captions.ok'),
        chapter: chapterId,
        occurrences: videoChecks.noCaptions > 0 ? videoChecks.captionOccurrences : [],
      });
    }
    if (videoChecks.autoplay > 0) {
      results.push({
        id: 'video-autoplay',
        rule: say('chk.video-autoplay.rule'),
        status: 'warn',
        message: say('chk.video-autoplay.found', { n: videoChecks.autoplay }),
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
      rule: say('chk.audio-autoplay.rule'),
      status: 'warn',
      message: say('chk.audio-autoplay.found', { n: audioChecks.autoplay }),
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
      rule: say('chk.flash-alternative.rule'),
      status: 'warn',
      message: say('chk.flash-alternative.found', { n: flashChecks.flashCount }),
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
      rule: say('chk.embedded-media-captions.rule'),
      status: 'info',
      message: say('chk.embedded-media-captions.found', { n: embedPlayers.count }),
      chapter: chapterId,
      occurrences: embedPlayers.occurrences,
    });
  }

  return results;
}
