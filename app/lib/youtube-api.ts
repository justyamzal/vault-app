// lib/youtube-api.ts
export async function getYouTubeVideoDetails(videoId: string) {
  // Ambil dari environment variable
  const apiKey = process.env.YOUTUBE_API_KEY;
  
  // 🔍 Guard clause: validasi sebelum request
  if (!apiKey || apiKey.startsWith('your_api_key_here') || apiKey === 'undefined') {
    console.warn('[YouTube API] API key tidak dikonfigurasi. Menggunakan fallback manual.');
    return null; // Return null agar route.ts bisa trigger fallback thumbnail
  }

  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`;
  
  try {
    const res = await fetch(url, { next: { revalidate: 86400 } }); // Cache 24 jam
    if (!res.ok) throw new Error(`YouTube API ${res.status}`);
    
    const data = await res.json();
    const snippet = data.items?.[0]?.snippet;
    
    if (!snippet) return null;
    
    return {
      title: snippet.title,
      description: snippet.description?.slice(0, 500),
      thumbnail: snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url,
      channel: snippet.channelTitle,
      publishedAt: snippet.publishedAt,
      success: true
    };
  } catch (error) {
    console.error('[YouTube API Error]', error);
    return null;
  }
}