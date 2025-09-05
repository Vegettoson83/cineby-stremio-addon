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
        this.buildId = null;
        this.buildIdFetchedAt = 0;
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.cineby.app/'
        };
    }

    async getBuildId(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && this.buildId && now - this.buildIdFetchedAt < 3600 * 1000) {
            return this.buildId;
        }
        try {
            const response = await axios.get(`${this.baseURL}/`, { headers: this.headers });
            const buildIdMatch = response.data.match(/"buildId":"([^"]+)"/);
            if (buildIdMatch) {
                this.buildId = buildIdMatch[1];
                this.buildIdFetchedAt = now;
                console.log('Fetched buildId:', this.buildId);
            }
        } catch (error) {
            console.warn('Could not fetch build ID, using previous (may fail):', error.message);
        }
        return this.buildId;
    }

    async _withBuildIdRetry(fn) {
        await this.getBuildId(false);
        try {
            return await fn();
        } catch (err) {
            // If 404/500, try refreshing buildId and retrying once
            if (err.response && (err.response.status === 404 || err.response.status === 500)) {
                await this.getBuildId(true);
                try {
                    return await fn();
                } catch (err2) {
                    console.error('Retry after buildId refresh failed:', err2.message);
                }
            } else {
                console.error('API error:', err.message);
            }
            return null;
        }
    }

    async getTrending() {
        return this._withBuildIdRetry(async () => {
            const url = `${this.baseURL}/_next/data/${this.buildId}/en.json`;
            const response = await axios.get(url, { headers: this.headers });
            return response.data?.pageProps?.trending || [];
        }) || [];
    }

    async search(query, page = 1) {
        return this._withBuildIdRetry(async () => {
            const url = `${this.baseURL}/_next/data/${this.buildId}/en/search.json`;
            const response = await axios.get(url, {
                headers: this.headers,
                params: { q: query, page: page }
            });
            return response.data?.pageProps?.results || [];
        }) || [];
    }

    async getMovies(page = 1, genre = null) {
        return this._withBuildIdRetry(async () => {
            let url = `${this.baseURL}/_next/data/${this.buildId}/en/movie.json`;
            const params = { page };
            if (genre) params.genre = genre;
            const response = await axios.get(url, {
                headers: this.headers,
                params: params
            });
            return response.data?.pageProps?.movies || [];
        }) || [];
    }

    async getTVShows(page = 1, genre = null) {
        return this._withBuildIdRetry(async () => {
            let url = `${this.baseURL}/_next/data/${this.buildId}/en/tv.json`;
            const params = { page };
            if (genre) params.genre = genre;
            const response = await axios.get(url, {
                headers: this.headers,
                params: params
            });
            return response.data?.pageProps?.shows || [];
        }) || [];
    }

    async getContentDetails(id, mediaType) {
        return this._withBuildIdRetry(async () => {
            let endpoint;
            if (mediaType === 'movie') {
                endpoint = `${this.baseURL}/_next/data/${this.buildId}/en/movie/${id}.json`;
            } else {
                endpoint = `${this.baseURL}/_next/data/${this.buildId}/en/tv/${id}.json`;
            }
            const response = await axios.get(endpoint, { headers: this.headers });
            return response.data?.pageProps || null;
        });
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

// Prime buildId on startup (non-blocking)
client.getBuildId();

// Manifest
app.get('/manifest.json', (req, res) => {
    res.json(manifest);
});

// Catalog route (Stremio style: /catalog/:type/:id and query params)
app.get('/catalog/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;
        const { search, skip = 0, genre } = req.query;
        const page = Math.floor((parseInt(skip) || 0) / 20) + 1;
        let results = [];

        if (search) {
            const searchResults = await client.search(search, page);
            results = searchResults
                .filter(item => item.mediaType === (type === 'series' ? 'tv' : 'movie'))
                .map(item => client.transformToStremioMeta(item));
        } else {
            switch (id) {
                case 'cineby-trending-movies':
                case 'cineby-trending-series': {
                    const trending = await client.getTrending();
                    results = trending
                        .filter(item => item.mediaType === (type === 'series' ? 'tv' : 'movie'))
                        .slice(skip, skip + 20)
                        .map(item => client.transformToStremioMeta(item));
                    break;
                }
                case 'cineby-movies': {
                    const movies = await client.getMovies(page, genre);
                    results = movies.map(item => client.transformToStremioMeta({ ...item, mediaType: 'movie' }));
                    break;
                }
                case 'cineby-series': {
                    const tvShows = await client.getTVShows(page, genre);
                    results = tvShows.map(item => client.transformToStremioMeta({ ...item, mediaType: 'tv' }));
                    break;
                }
                default:
                    results = [];
            }
        }

        res.json({ metas: results });
    } catch (error) {
        console.error('Catalog error:', error.message);
        res.json({ metas: [] });
    }
});

// Meta
app.get('/meta/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;
        const cinebyId = id.replace('cineby:', '');
        const mediaType = type === 'series' ? 'tv' : 'movie';

        const details = await client.getContentDetails(cinebyId, mediaType);

        if (!details) return res.json({ meta: {} });

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
                            released: episode.air_date
                        });
                    }
                }
            }
        }

        res.json({ meta });
    } catch (error) {
        console.error('Meta error:', error.message);
        res.json({ meta: {} });
    }
});

// Stream
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
        res.json({ streams: [] });
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
