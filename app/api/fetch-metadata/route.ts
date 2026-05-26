// app/api/fetch-metadata/route.ts
import { NextRequest, NextResponse } from 'next/server';

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

// Helper: Extract YouTube Video ID dari berbagai format URL
function extractYoutubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([^&\n?#]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

// Helper: Generate fallback metadata untuk YouTube
function getYoutubeFallback(url: string) {
  const videoId = extractYoutubeId(url);
  if (!videoId) return null;
  
  // YouTube menyediakan thumbnail dengan kualitas berbeda
  const thumbnails = [
    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`, // HD (jika ada)
    `https://img.youtube.com/vi/${videoId}/sddefault.jpg`,     // SD
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,     // HQ (paling reliable)
  ];
  
  return {
    success: true,
    url,
    platform: 'youtube',
    title: null, // User isi manual
    description: null,
    thumbnail: thumbnails[2], // Fallback ke hqdefault (paling stabil)
    hasImage: true,
    hasDescription: false,
    hasTitle: false,
    status: 'partial',
    hint: 'YouTube metadata limited. Title & description can be filled manually.',
    debug: { videoId, fallbackUsed: true }
  };
}

// Helper: Cek apakah URL adalah YouTube
function isYouTubeUrl(url: string): boolean {
  return url.includes('youtube.com') || url.includes('youtu.be');
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  
  // ✅ Baca request body SEKALI saja di awal
  let requestBody: { url?: string };
  try {
    requestBody = await req.json();
  } catch {
    return NextResponse.json({
      success: false,
      error: 'Invalid JSON body'
    }, { status: 400 });
  }
  
  const url = requestBody.url;
  
  if (!url || !URL.canParse(url)) {
    return NextResponse.json({
      success: false,
      error: 'Valid URL is required'
    }, { status: 400 });
  }

  console.log(`[Vault] Fetching: ${url}`);

  try {
    // Call Microlink API
    const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(url)}&meta=true`;
    
    const response = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Vault-App/1.0' }
    });

    // 🎯 Handle YouTube-specific 400 errors
    if (!response.ok && isYouTubeUrl(url)) {
      console.warn(`[Vault] Microlink failed for YouTube: ${response.status}`);
      
      // Coba fallback ke YouTube thumbnail generator
      const fallback = getYoutubeFallback(url);
      if (fallback) {
        const fetchTime = Date.now() - startTime;
        console.log(`[Vault] YouTube fallback applied in ${fetchTime}ms`);
        return NextResponse.json({ ...fallback, debug: { ...fallback.debug, fetchTime: `${fetchTime}ms` } });
      }
    }

    if (!response.ok) {
      // Log error detail untuk debugging
      const errorText = await response.text().catch(() => '');
      console.error('[Microlink Error]', {
        status: response.status,
        statusText: response.statusText,
        body: errorText.slice(0, 200)
      });
      throw new Error(`Microlink API error: ${response.status}`);
    }

    const microlinkData = await response.json();
    const fetchTime = Date.now() - startTime;
    console.log(`[Vault] Microlink OK in ${fetchTime}ms`);

    if (microlinkData.status !== 'success' || !microlinkData.data) {
      // 🎯 YouTube fallback jika Microlink return success: false
      if (isYouTubeUrl(url)) {
        const videoId = extractYoutubeId(url);
        if (videoId) {
          // Coba YouTube Data API dulu
          const ytData = await getYouTubeVideoDetails(videoId);
          
          if (ytData?.title) {
            return NextResponse.json({
              success: true,
              ...ytData,
              platform: 'youtube',
              status: 'full',
              source: 'youtube-api',
              debug: { fetchTime: `${Date.now() - startTime}ms` }
            });
          }
          
          // Jika API key tidak ada / gagal → fallback ke thumbnail pattern
          return NextResponse.json(getYoutubeFallback(url));
        }
      }
      
      return NextResponse.json({
        success: false,
        error: 'Microlink failed to extract metadata',
        url,
        hint: 'Try manual input or check if URL is publicly accessible'
      }, { status: 200 });
    }

    const data = microlinkData.data;
    const hostname = new URL(url).hostname.replace('www.', '');
    const platform = PLATFORM_MAP[hostname] || hostname.split('.')[0];

    const result = {
      success: true,
      url: data.url || url,
      title: data.title || null,
      description: data.description || null,
      thumbnail: data.image?.url || null,
      logo: data.logo?.url || null,
      author: data.author || null,
      publisher: data.publisher || null,
      date: data.date || null,
      lang: data.lang || 'en',
      platform,
      hasImage: !!data.image?.url,
      hasDescription: !!data.description,
      hasTitle: !!data.title,
      status: 'success',
      timestamp: new Date().toISOString(),
      debug: { fetchTime: `${fetchTime}ms` }
    };

    return NextResponse.json(result);

  } catch (error: any) {
    const fetchTime = Date.now() - startTime;
    console.error('[Vault Fetch Error]', {
      message: error.message,
      name: error.name,
      fetchTime: `${fetchTime}ms`,
      url
    });

    // 🎯 YouTube fallback di catch block juga
    if (isYouTubeUrl(url)) {
      const fallback = getYoutubeFallback(url);
      if (fallback) {
        return NextResponse.json({ 
          ...fallback, 
          debug: { ...fallback.debug, fetchTime: `${fetchTime}ms`, error: error.message } 
        });
      }
    }

    const hostname = url ? new URL(url).hostname.replace('www.', '') : '';
    const platform = PLATFORM_MAP[hostname] || hostname.split('.')[0] || 'unknown';

    return NextResponse.json({
      success: false,
      url,
      platform,
      error: error.message || 'Unknown error',
      hint: error.name === 'TimeoutError' 
        ? 'Request timed out. Try again or use manual input.' 
        : 'Platform may block server-side fetch. Please fill details manually.',
      timestamp: new Date().toISOString()
    }, { status: 200 });
  }
}