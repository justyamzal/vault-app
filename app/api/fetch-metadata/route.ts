// app/api/fetch-metadata/route.ts
import { NextRequest, NextResponse } from 'next/server';
// ✅ Gunakan relative import jika @/ belum dikonfigurasi di tsconfig.json
import { getYouTubeVideoDetails } from '../../lib/youtube-api';

const PLATFORM_MAP: Record<string, string> = {
  'youtube.com': 'youtube', 'youtu.be': 'youtube',
  'twitter.com': 'x', 'x.com': 'x',
  'instagram.com': 'instagram',
  'tiktok.com': 'tiktok',
  'threads.net': 'threads',
  'github.com': 'github',
  'medium.com': 'medium',
  'dev.to': 'dev',
};

function extractYoutubeId(url: string): string | null {
  const patterns = [/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([^&\n?#]+)/];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function getYoutubeFallback(url: string) {
  const videoId = extractYoutubeId(url);
  if (!videoId) return null;
  return {
    success: true, url, platform: 'youtube',
    title: null, description: null,
    thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    hasImage: true, hasDescription: false, hasTitle: false,
    status: 'partial', hint: 'YouTube metadata limited. Title & description can be filled manually.',
    debug: { videoId, fallbackUsed: true }
  };
}

function isYouTubeUrl(url: string): boolean {
  return url.includes('youtube.com') || url.includes('youtu.be');
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  
  let requestBody: { url?: string };
  try {
    requestBody = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const url = requestBody.url;
  if (!url || !URL.canParse(url)) {
    return NextResponse.json({ success: false, error: 'Valid URL is required' }, { status: 400 });
  }

  console.log(`[Vault] Fetching: ${url}`);

  try {
    // 1️⃣ Try Microlink
    const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(url)}&meta=true`;
    const response = await fetch(apiUrl, { headers: { 'User-Agent': 'Vault-App/1.0' } });

    if (!response.ok) {
      console.warn(`[Vault] Microlink failed: ${response.status}`);
      if (isYouTubeUrl(url)) {
        const videoId = extractYoutubeId(url);
        if (videoId) {
          const ytData = await getYouTubeVideoDetails(videoId);
          if (ytData?.title) {
            return NextResponse.json({ ...ytData, platform: 'youtube', status: 'full', source: 'youtube-api', debug: { fetchTime: `${Date.now()-startTime}ms` } });
          }
          const fallback = getYoutubeFallback(url);
          if (fallback) return NextResponse.json({ ...fallback, debug: { ...fallback.debug, fetchTime: `${Date.now()-startTime}ms` } });
        }
      }
      throw new Error(`Microlink API error: ${response.status}`);
    }

    const microlinkData = await response.json();
    const fetchTime = Date.now() - startTime;

    if (microlinkData.status !== 'success' || !microlinkData.data) {
      if (isYouTubeUrl(url)) {
        const videoId = extractYoutubeId(url);
        if (videoId) {
          const ytData = await getYouTubeVideoDetails(videoId);
          if (ytData?.title) {
            return NextResponse.json({ ...ytData, platform: 'youtube', status: 'full', source: 'youtube-api', debug: { fetchTime: `${fetchTime}ms` } });
          }
          const fallback = getYoutubeFallback(url);
          if (fallback) return NextResponse.json({ ...fallback, debug: { ...fallback.debug, fetchTime: `${fetchTime}ms` } });
        }
      }
      return NextResponse.json({ success: false, error: 'Microlink failed', url, hint: 'Try manual input' }, { status: 200 });
    }

    const data = microlinkData.data;
    const hostname = new URL(url).hostname.replace('www.', '');
    const platform = PLATFORM_MAP[hostname] || hostname.split('.')[0];

    return NextResponse.json({
      success: true, url: data.url || url,
      title: data.title || null, description: data.description || null,
      thumbnail: data.image?.url || null, logo: data.logo?.url || null,
      author: data.author || null, publisher: data.publisher || null,
      date: data.date || null, lang: data.lang || 'en', platform,
      hasImage: !!data.image?.url, hasDescription: !!data.description, hasTitle: !!data.title,
      status: 'success', timestamp: new Date().toISOString(),
      debug: { fetchTime: `${fetchTime}ms` }
    });

  } catch (error: any) {
    const fetchTime = Date.now() - startTime;
    console.error('[Vault Fetch Error]', { message: error.message, name: error.name, fetchTime: `${fetchTime}ms`, url });

    if (isYouTubeUrl(url)) {
      const fallback = getYoutubeFallback(url);
      if (fallback) return NextResponse.json({ ...fallback, debug: { ...fallback.debug, fetchTime: `${fetchTime}ms`, error: error.message } });
    }

    const hostname = url ? new URL(url).hostname.replace('www.', '') : '';
    const platform = PLATFORM_MAP[hostname] || hostname.split('.')[0] || 'unknown';

    return NextResponse.json({
      success: false, url, platform,
      error: error.message || 'Unknown error',
      hint: 'Request failed. Please fill details manually.',
      timestamp: new Date().toISOString()
    }, { status: 200 });
  }
}