const express = require('express');
const cors = require('cors');
const axios = require('axios');
const app = express();

app.use(cors());
app.use(express.json());

// Addon manifest
const manifest = {
    id: 'org.cineby.addon',
    version: '1.0.0',
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
    idPrefixes: ['cineby:']
};

// Cineby API client
class CinebyClient {
    constructor() {
        this.baseURL = 'https://www.cineby.app';
        this.buildId = '7xu4PEyycasyUF-xW91f5'; // Will need to be dynamically fetched
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.cineby.app/'
        };
    }

    async getBuildId() {
        try {
            // Get the build ID from the main page
            const response = await axios.get(`${this.baseURL}/`, { headers: this.headers });
            const buildIdMatch = response.data.match(/"buildId":"([^"]+)"/);
            if (buildIdMatch) {
                this.buildId = buildIdMatch[1];
            }
        } catch (error) {
            console.warn('Could not fetch build ID, using default');
        }
    }

    async getTrending() {
        try {
            const url = `${this.baseURL}/_next/data/${this.buildId}/en.json`;
            const response = await axios.get(url, { headers: this.headers });
            
            if (response.data?.pageProps?.trending) {
                return response.data.pageProps.trending;
            }
            return [];
        } catch (error) {
            console.error('Failed to get trending:', error.message);
            return [];
        }
    }

    async search(query, page = 1) {
        try {
            const url = `${this.baseURL}/_next/data/${this.buildId}/en/search.json`;
            const response = await axios.get(url, { 
                headers: this.headers,
                params: { q: query, page: page }
            });
            
            if (response.data?.pageProps?.results) {
                return response.data.pageProps.results;
            }
            return [];
        } catch (error) {
            console.error('Search failed:', error.message);
            return [];
        }
    }

    async getMovies(page = 1, genre = null) {
        try {
            let url = `${this.baseURL}/_next/data/${this.buildId}/en/movie.json`;
            const params = { page };
            if (genre) params.genre = genre;
            
            const response = await axios.get(url, { 
                headers: this.headers,
                params: params
            });
            
            if (response.data?.pageProps?.movies) {
                return response.data.pageProps.movies;
            }
            return [];
        } catch (error) {
            console.error('Failed to get movies:', error.message);
            return [];
        }
    }

    async getTVShows(page = 1, genre = null) {
        try {
            let url = `${this.baseURL}/_next/data/${this.buildId}/en/tv.json`;
            const params = { page };
            if (genre) params.genre = genre;
            
            const response = await axios.get(url, { 
                headers: this.headers,
                params: params
            });
            
            if (response.data?.pageProps?.shows) {
                return response.data.pageProps.shows;
            }
            return [];
        } catch (error) {
            console.error('Failed to get TV shows:', error.message);
            return [];
        }
    }

    async getContentDetails(id, mediaType) {
        try {
            let endpoint;
            if (mediaType === 'movie') {
                endpoint = `${this.baseURL}/_next/data/${this.buildId}/en/movie/${id}.json`;
            } else {
                endpoint = `${this.baseURL}/_next/data/${this.buildId}/en/tv/${id}.json`;
            }
            
            const response = await axios.get(endpoint, { headers: this.headers });
            
            if (response.data?.pageProps) {
                return response.data.pageProps;
            }
            return null;
        } catch (error) {
            console.error('Failed to get content details:', error.message);
            return null;
        }
    }

    async getStreamSources(id, mediaType, season = null, episode = null) {
        try {
            let endpoint;
            if (mediaType === 'movie') {
                endpoint = `${this.baseURL}/api/v2/movie/${id}`;
            } else {
                endpoint = `${this.baseURL}/api/v2/tv/${id}`;
                if (season && episode) {
                    endpoint += `/${season}/${episode}`;
                }
            }
            
            const response = await axios.get(endpoint, { headers: this.headers });
            return response.data;
        } catch (error) {
            console.error('Failed to get stream sources:', error.message);
            return null;
        }
    }

    transformToStremioMeta(item) {
        const isMovie = item.mediaType === 'movie';
        
        return {
            id: `cineby:${item.id}`,
            type: isMovie ? 'movie' : 'series',
            name: item.title,
            poster: item.poster,
            background: item.image,
            description: item.description,
            releaseInfo: item.release_date,
            imdbRating: item.rating ? item.rating.toString() : null,
            genres: this.mapGenreIds(item.genre_ids || []),
            language: item.original_language
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
client.getBuildId();

// Routes
app.get('/manifest.json', (req, res) => {
    res.json(manifest);
});

app.get('/catalog/:type/:id/:extra?', async (req, res) => {
    try {
        const { type, id, extra } = req.params;
        let results = [];
        
        // Parse extra parameters
        let search, skip = 0, genre;
        if (extra) {
            const params = new URLSearchParams(extra);
            search = params.get('search');
            skip = parseInt(params.get('skip')) || 0;
            genre = params.get('genre');
        }
        
        const page = Math.floor(skip / 20) + 1;
        
        if (search) {
            // Search functionality
            const searchResults = await client.search(search, page);
            results = searchResults
                .filter(item => item.mediaType === (type === 'series' ? 'tv' : 'movie'))
                .map(item => client.transformToStremioMeta(item));
        } else {
            // Different catalog types
            switch (id) {
                case 'cineby-trending-movies':
                case 'cineby-trending-series':
                    const trending = await client.getTrending();
                    results = trending
                        .filter(item => item.mediaType === (type === 'series' ? 'tv' : 'movie'))
                        .slice(skip, skip + 20)
                        .map(item => client.transformToStremioMeta(item));
                    break;
                    
                case 'cineby-movies':
                    const movies = await client.getMovies(page, genre);
                    results = movies.map(item => client.transformToStremioMeta({...item, mediaType: 'movie'}));
                    break;
                    
                case 'cineby-series':
                    const tvShows = await client.getTVShows(page, genre);
                    results = tvShows.map(item => client.transformToStremioMeta({...item, mediaType: 'tv'}));
                    break;
                    
                case 'cineby-anime':
                    const anime = await client.getAnime(page);
                    results = anime.map(item => client.transformToStremioMeta({...item, mediaType: 'tv'}));
                    break;
            }
        }
        
        res.json({ metas: results });
    } catch (error) {
        console.error('Catalog error:', error.message);
        res.status(500).json({ error: 'Failed to fetch catalog' });
    }
});

app.get('/meta/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;
        const cinebyId = id.replace('cineby:', '');
        const mediaType = type === 'series' ? 'tv' : 'movie';
        
        const details = await client.getContentDetails(cinebyId, mediaType);
        
        if (!details) {
            return res.status(404).json({ error: 'Content not found' });
        }
        
        const meta = {
            id: id,
            type: type,
            name: details.title || details.name,
            poster: details.poster,
            background: details.image,
            description: details.description,
            releaseInfo: details.release_date || details.first_air_date,
            imdbRating: details.rating ? details.rating.toString() : null,
            genres: client.mapGenreIds(details.genre_ids || []),
            runtime: details.runtime,
            language: details.original_language
        };
        
        // For series, add episodes information
        if (type === 'series' && details.seasons) {
            meta.videos = [];
            
            for (const season of details.seasons) {
                if (season.episodes) {
                    for (const episode of season.episodes) {
                        meta.videos.push({
                            id: `${id}:${season.season_number}:${episode.episode_number}`,
                            title: `S${season.season_number.toString().padStart(2, '0')}E${episode.episode_number.toString().padStart(2, '0')} - ${episode.name}`,
                            season: season.season_number,
                            episode: episode.episode_number,
                            overview: episode.overview,
                            thumbnail: episode.still_path,
                            released: new Date(episode.air_date)
                        });
                    }
                }
            }
        }
        
        res.json({ meta });
    } catch (error) {
        console.error('Meta error:', error.message);
        res.status(500).json({ error: 'Failed to fetch metadata' });
    }
});

app.get('/stream/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;
        const [, cinebyId, season, episode] = id.split(':');
        const mediaType = type === 'series' ? 'tv' : 'movie';
        
        const streamData = await client.getStreamSources(
            cinebyId, 
            mediaType, 
            season, 
            episode
        );
        
        if (!streamData || !streamData.sources) {
            return res.json({ streams: [] });
        }
        
        const streams = streamData.sources.map((source, index) => ({
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
        console.error('Stream error:', error.message);
        res.status(500).json({ error: 'Failed to fetch streams' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Cineby Stremio Addon running on port ${PORT}`);
    console.log(`Manifest available at: http://localhost:${PORT}/manifest.json`);
});

module.exports = app;
