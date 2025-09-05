const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Rate limiting for production
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per windowMs
    message: 'Too many requests from this IP'
});
app.use(limiter);

// Addon manifest
const manifest = {
    id: 'org.cineby.addon',
    version: '1.0.1',
    name: 'Cineby Addon',
    description: 'Access Cineby movies and TV shows through Stremio',
    logo: 'https://www.cineby.app/icon-192x192.png',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    catalogs: [
        {
            type: 'movie',
            id: 'cineby-trending-movies',
            name: 'Cineby Trending Movies',
            extra: [
                { name: 'search', isRequired: false },
                { name: 'skip', isRequired: false }
            ]
        },
        {
            type: 'series',
            id: 'cineby-trending-series',
            name: 'Cineby Trending TV Shows', 
            extra: [
                { name: 'search', isRequired: false },
                { name: 'skip', isRequired: false }
            ]
        },
        {
            type: 'movie',
            id: 'cineby-movies',
            name: 'Cineby Movies',
            extra: [
                { name: 'search', isRequired: false },
                { name: 'skip', isRequired: false },
                { name: 'genre', isRequired: false }
            ]
        },
        {
            type: 'series', 
            id: 'cineby-series',
            name: 'Cineby Series',
            extra: [
                { name: 'search', isRequired: false },
                { name: 'skip', isRequired: false },
                { name: 'genre', isRequired: false }
            ]
        }
    ],
    idPrefixes: ['cineby:'],
    behaviorHints: {
        configurable: false,
        configurationRequired: false
    }
};

// Cineby API client with improved error handling and caching
class CinebyClient {
    constructor() {
        this.baseURL = 'https://www.cineby.app';
        this.buildId = '7xu4PEyycasyUF-xW91f5'; // Fallback build ID
        this.buildIdCache = null;
        this.buildIdCacheTime = null;
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.cineby.app/',
            'Cache-Control': 'no-cache'
        };
        
        // Initialize axios with timeout and retry logic
        this.axiosConfig = {
            timeout: 10000,
            headers: this.headers,
            validateStatus: (status) => status < 500 // Don't throw on 4xx errors
        };
    }

    async getBuildId() {
        try {
            // Cache build ID for 1 hour
            const now = Date.now();
            if (this.buildIdCache && this.buildIdCacheTime && (now - this.buildIdCacheTime < 3600000)) {
                this.buildId = this.buildIdCache;
                return;
            }

            const response = await axios.get(`${this.baseURL}/`, this.axiosConfig);
            if (response.status === 200) {
                const buildIdMatch = response.data.match(/"buildId":"([^"]+)"/);
                if (buildIdMatch) {
                    this.buildId = buildIdMatch[1];
                    this.buildIdCache = this.buildId;
                    this.buildIdCacheTime = now;
                    console.log('Updated build ID:', this.buildId);
                }
            }
        } catch (error) {
            console.warn('Could not fetch build ID, using cached/default:', error.message);
        }
    }

    async makeRequest(url, params = {}) {
        try {
            const response = await axios.get(url, {
                ...this.axiosConfig,
                params
            });
            
            if (response.status === 200) {
                return response.data;
            } else {
                console.warn(`Request failed with status ${response.status}:`, url);
                return null;
            }
        } catch (error) {
            if (error.code === 'ECONNABORTED') {
                console.error('Request timeout:', url);
            } else {
                console.error('Request failed:', error.message);
            }
            return null;
        }
    }

    async getTrending() {
        await this.getBuildId();
        const url = `${this.baseURL}/_next/data/${this.buildId}/en.json`;
        const data = await this.makeRequest(url);
        
        if (data?.pageProps?.trending) {
            return data.pageProps.trending;
        }
        return [];
    }

    async search(query, page = 1) {
        if (!query || query.trim().length === 0) return [];
        
        await this.getBuildId();
        const url = `${this.baseURL}/_next/data/${this.buildId}/en/search.json`;
        const data = await this.makeRequest(url, { q: query.trim(), page });
        
        if (data?.pageProps?.results) {
            return data.pageProps.results;
        }
        return [];
    }

    async getMovies(page = 1, genre = null) {
        await this.getBuildId();
        const url = `${this.baseURL}/_next/data/${this.buildId}/en/movie.json`;
        const params = { page };
        if (genre) params.genre = genre;
        
        const data = await this.makeRequest(url, params);
        
        if (data?.pageProps?.movies) {
            return data.pageProps.movies;
        }
        return [];
    }

    async getTVShows(page = 1, genre = null) {
        await this.getBuildId();
        const url = `${this.baseURL}/_next/data/${this.buildId}/en/tv.json`;
        const params = { page };
        if (genre) params.genre = genre;
        
        const data = await this.makeRequest(url, params);
        
        if (data?.pageProps?.shows) {
            return data.pageProps.shows;
        }
        return [];
    }

    async getContentDetails(id, mediaType) {
        await this.getBuildId();
        let endpoint;
        if (mediaType === 'movie') {
            endpoint = `${this.baseURL}/_next/data/${this.buildId}/en/movie/${id}.json`;
        } else {
            endpoint = `${this.baseURL}/_next/data/${this.buildId}/en/tv/${id}.json`;
        }
        
        const data = await this.makeRequest(endpoint);
        return data?.pageProps || null;
    }

    async getStreamSources(id, mediaType, season = null, episode = null) {
        let endpoint;
        if (mediaType === 'movie') {
            endpoint = `${this.baseURL}/api/v2/movie/${id}`;
        } else {
            endpoint = `${this.baseURL}/api/v2/tv/${id}`;
            if (season && episode) {
                endpoint += `/${season}/${episode}`;
            }
        }
        
        return await this.makeRequest(endpoint);
    }

    transformToStremioMeta(item) {
        if (!item || !item.id) return null;
        
        const isMovie = item.mediaType === 'movie';
        
        return {
            id: `cineby:${item.id}`,
            type: isMovie ? 'movie' : 'series',
            name: item.title || item.name || 'Unknown Title',
            poster: item.poster || item.poster_path,
            background: item.image || item.backdrop_path,
            description: item.description || item.overview || '',
            releaseInfo: item.release_date || item.first_air_date || '',
            imdbRating: item.rating ? item.rating.toString() : null,
            genres: this.mapGenreIds(item.genre_ids || []),
            language: item.original_language || 'en'
        };
    }

    mapGenreIds(genreIds) {
        const genreMap = {
            28: 'Action', 35: 'Comedy', 18: 'Drama', 27: 'Horror',
            878: 'Science Fiction', 53: 'Thriller', 12: 'Adventure',
            16: 'Animation', 80: 'Crime', 99: 'Documentary',
            10751: 'Family', 14: 'Fantasy', 36: 'History',
            10402: 'Music', 9648: 'Mystery', 10749: 'Romance',
            10770: 'TV Movie', 37: 'Western', 10752: 'War',
            10759: 'Action & Adventure', 10762: 'Kids',
            10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy',
            10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics'
        };
        
        return genreIds.map(id => genreMap[id]).filter(Boolean);
    }
}

const client = new CinebyClient();

// Initialize build ID on startup
client.getBuildId().catch(console.error);

// Routes
app.get('/', (req, res) => {
    res.json({
        name: 'Cineby Stremio Addon',
        version: manifest.version,
        description: manifest.description,
        manifest: '/manifest.json'
    });
});

app.get('/manifest.json', (req, res) => {
    res.json(manifest);
});

app.get('/catalog/:type/:id/:extra?', async (req, res) => {
    try {
        const { type, id, extra } = req.params;
        
        // Validate type
        if (!['movie', 'series'].includes(type)) {
            return res.status(400).json({ error: 'Invalid type' });
        }
        
        let results = [];
        
        // Parse extra parameters
        let search, skip = 0, genre;
        if (extra) {
            try {
                const params = new URLSearchParams(extra);
                search = params.get('search');
                skip = Math.max(0, parseInt(params.get('skip')) || 0);
                genre = params.get('genre');
            } catch (e) {
                console.warn('Failed to parse extra params:', e.message);
            }
        }
        
        const page = Math.floor(skip / 20) + 1;
        
        if (search) {
            // Search functionality
            const searchResults = await client.search(search, page);
            results = searchResults
                .filter(item => item && item.mediaType === (type === 'series' ? 'tv' : 'movie'))
                .map(item => client.transformToStremioMeta(item))
                .filter(Boolean);
        } else {
            // Different catalog types
            switch (id) {
                case 'cineby-trending-movies':
                case 'cineby-trending-series':
                    const trending = await client.getTrending();
                    results = trending
                        .filter(item => item && item.mediaType === (type === 'series' ? 'tv' : 'movie'))
                        .slice(skip, skip + 20)
                        .map(item => client.transformToStremioMeta(item))
                        .filter(Boolean);
                    break;
                    
                case 'cineby-movies':
                    if (type === 'movie') {
                        const movies = await client.getMovies(page, genre);
                        results = movies
                            .map(item => client.transformToStremioMeta({...item, mediaType: 'movie'}))
                            .filter(Boolean);
                    }
                    break;
                    
                case 'cineby-series':
                    if (type === 'series') {
                        const tvShows = await client.getTVShows(page, genre);
                        results = tvShows
                            .map(item => client.transformToStremioMeta({...item, mediaType: 'tv'}))
                            .filter(Boolean);
                    }
                    break;
                    
                default:
                    return res.status(404).json({ error: 'Catalog not found' });
            }
        }
        
        res.json({ metas: results });
    } catch (error) {
        console.error('Catalog error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/meta/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;
        
        // Validate type
        if (!['movie', 'series'].includes(type)) {
            return res.status(400).json({ error: 'Invalid type' });
        }
        
        // Validate ID format
        if (!id.startsWith('cineby:')) {
            return res.status(400).json({ error: 'Invalid ID format' });
        }
        
        const cinebyId = id.replace('cineby:', '');
        const mediaType = type === 'series' ? 'tv' : 'movie';
        
        const details = await client.getContentDetails(cinebyId, mediaType);
        
        if (!details) {
            return res.status(404).json({ error: 'Content not found' });
        }
        
        const meta = {
            id: id,
            type: type,
            name: details.title || details.name || 'Unknown Title',
            poster: details.poster || details.poster_path,
            background: details.image || details.backdrop_path,
            description: details.description || details.overview || '',
            releaseInfo: details.release_date || details.first_air_date || '',
            imdbRating: details.rating ? details.rating.toString() : null,
            genres: client.mapGenreIds(details.genre_ids || []),
            runtime: details.runtime,
            language: details.original_language || 'en'
        };
        
        // For series, add episodes information
        if (type === 'series' && details.seasons) {
            meta.videos = [];
            
            for (const season of details.seasons) {
                if (season.episodes && Array.isArray(season.episodes)) {
                    for (const episode of season.episodes) {
                        if (episode.episode_number && episode.name) {
                            meta.videos.push({
                                id: `${id}:${season.season_number}:${episode.episode_number}`,
                                title: `S${season.season_number.toString().padStart(2, '0')}E${episode.episode_number.toString().padStart(2, '0')} - ${episode.name}`,
                                season: season.season_number,
                                episode: episode.episode_number,
                                overview: episode.overview || '',
                                thumbnail: episode.still_path,
                                released: episode.air_date ? new Date(episode.air_date) : undefined
                            });
                        }
                    }
                }
            }
        }
        
        res.json({ meta });
    } catch (error) {
        console.error('Meta error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/stream/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;
        
        // Validate type
        if (!['movie', 'series'].includes(type)) {
            return res.status(400).json({ error: 'Invalid type' });
        }
        
        const idParts = id.split(':');
        if (idParts.length < 2) {
            return res.status(400).json({ error: 'Invalid ID format' });
        }
        
        const [, cinebyId, season, episode] = idParts;
        const mediaType = type === 'series' ? 'tv' : 'movie';
        
        // For series, validate season and episode
        if (type === 'series' && (!season || !episode)) {
            return res.status(400).json({ error: 'Season and episode required for series' });
        }
        
        const streamData = await client.getStreamSources(
            cinebyId, 
            mediaType, 
            season, 
            episode
        );
        
        if (!streamData || !streamData.sources || !Array.isArray(streamData.sources)) {
            return res.json({ streams: [] });
        }
        
        const streams = streamData.sources
            .filter(source => source && source.url)
            .map((source, index) => ({
                url: source.url,
                title: `${source.quality || 'Auto'} - Server ${index + 1}`,
                behaviorHints: {
                    notWebReady: source.type !== 'mp4'
                }
            }));
        
        // Sort by quality preference
        streams.sort((a, b) => {
            const qualityOrder = { '1080p': 4, '720p': 3, '480p': 2, 'Auto': 1 };
            const aQuality = a.title.split(' - ')[0];
            const bQuality = b.title.split(' - ')[0];
            return (qualityOrder[bQuality] || 0) - (qualityOrder[aQuality] || 0);
        });
        
        res.json({ streams });
    } catch (error) {
        console.error('Stream error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: manifest.version
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    process.exit(0);
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Cineby Stremio Addon running on port ${PORT}`);
    console.log(`📋 Manifest available at: http://localhost:${PORT}/manifest.json`);
    console.log(`🏥 Health check: http://localhost:${PORT}/health`);
});

// Handle server errors
server.on('error', (error) => {
    console.error('Server error:', error);
    process.exit(1);
});

module.exports = app;
