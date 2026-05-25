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

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  
  // ✅ PENTING: Baca request body SEKALI saja di awal
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
    // Call Microlink API - tanpa AbortSignal untuk testing dulu
    const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(url)}&meta=true`;
    
    const response = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Vault-App/1.0' }
      // ✅ Hapus timeout dulu untuk testing: signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      throw new Error(`Microlink API error: ${response.status}`);
    }

    const microlinkData = await response.json();
    const fetchTime = Date.now() - startTime;
    console.log(`[Vault] Microlink OK in ${fetchTime}ms`);

    if (microlinkData.status !== 'success' || !microlinkData.data) {
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
      url // ✅ Gunakan variabel yang sudah disimpan, jangan req.json() lagi!
    });

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