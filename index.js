const express = require("express");
const axios = require("axios");
const cors = require("cors");
const app = express();

app.use(cors());

// ------------------- Cineby API Client -------------------
class CinebyClient {
    constructor() {
        this.baseURL = "https://www.cineby.app";
        this.buildId = null;
        this.buildIdFetchedAt = 0;
    }

    // Fetch buildId dynamically, cache for 1hr
    async getBuildId(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && this.buildId && (now - this.buildIdFetchedAt < 3600 * 1000)) {
            return this.buildId;
        }
        try {
            const response = await axios.get(this.baseURL);
            const match = response.data.match(/"buildId":"(.*?)"/);
            if (match) {
                this.buildId = match[1];
                this.buildIdFetchedAt = now;
                return this.buildId;
            }
        } catch (err) {
            console.error("Error fetching buildId:", err.message);
        }
        return this.buildId;
    }

    async getMovies(page = 1) {
        await this.getBuildId();
        const url = `${this.baseURL}/_next/data/${this.buildId}/en/movies.json?page=${page}`;
        const response = await axios.get(url);
        return response.data.pageProps?.movies?.results || [];
    }

    async getTVShows(page = 1) {
        await this.getBuildId();
        const url = `${this.baseURL}/_next/data/${this.buildId}/en/tv.json?page=${page}`;
        const response = await axios.get(url);
        return response.data.pageProps?.tv?.results || [];
    }

    async search(query) {
        await this.getBuildId();
        const url = `${this.baseURL}/_next/data/${this.buildId}/en/search/${encodeURIComponent(query)}.json`;
        const response = await axios.get(url);
        return response.data.pageProps?.results || [];
    }

    async getDetails(type, id) {
        await this.getBuildId();
        const url = `${this.baseURL}/_next/data/${this.buildId}/en/${type}/${id}.json`;
        const response = await axios.get(url);
        return response.data.pageProps?.details || {};
    }

    async getStreams(type, id) {
        await this.getBuildId();
        const url = `${this.baseURL}/api/${type}/${id}/streams`;
        const response = await axios.get(url);
        const data = response.data || {};
        return data.sources || data.streams || [];
    }
}

const client = new CinebyClient();

// ------------------- Stremio Manifest -------------------
const manifest = {
    id: "org.cineby",
    version: "1.0.0",
    name: "Cineby",
    description: "Cineby Stremio Addon",
    types: ["movie", "series"],
    catalogs: [
        { type: "movie", id: "cineby-movies", name: "Cineby Movies", extra: [{ name: "search" }, { name: "skip" }, { name: "genre" }] },
        { type: "series", id: "cineby-series", name: "Cineby TV Shows", extra: [{ name: "search" }, { name: "skip" }, { name: "genre" }] }
    ],
    resources: ["catalog", "meta", "stream"],
};

// ------------------- Routes -------------------
app.get("/manifest.json", (req, res) => res.json(manifest));

app.get("/catalog/:type/:id/:extra?.json", async (req, res) => {
    try {
        const { type, id } = req.params;
        const extra = req.query;
        let results = [];

        if (extra.search) {
            results = await client.search(extra.search);
        } else {
            if (id === "cineby-movies") {
                results = await client.getMovies(extra.skip || 1);
            } else if (id === "cineby-series") {
                results = await client.getTVShows(extra.skip || 1);
            }
        }

        const metas = results.map(item => ({
            id: `${type}:${item.id}`,
            type,
            name: item.title || item.name,
            poster: item.poster || item.backdrop_path || "",
            background: item.backdrop || item.backdrop_path || "",
            description: item.overview || "",
            releaseInfo: item.release_date || item.first_air_date || "",
        }));

        res.json({ metas });
    } catch (err) {
        console.error("Catalog error:", err.message);
        res.json({ metas: [] });
    }
});

app.get("/meta/:type/:id.json", async (req, res) => {
    try {
        const { type, id } = req.params;
        const realId = id.split(":")[1];
        const details = await client.getDetails(type, realId);

        const meta = {
            id: `${type}:${realId}`,
            type,
            name: details.title || details.name || "Unknown",
            poster: details.poster || details.poster_path || "",
            background: details.backdrop || details.backdrop_path || "",
            description: details.overview || "",
            releaseInfo: details.release_date || details.first_air_date || "",
            runtime: details.runtime || null,
            genres: details.genres?.map(g => g.name) || [],
        };

        res.json({ meta });
    } catch (err) {
        console.error("Meta error:", err.message);
        res.json({ meta: {} });
    }
});

app.get("/stream/:type/:id.json", async (req, res) => {
    try {
        const { type, id } = req.params;
        const realId = id.split(":")[1];
        const streams = await client.getStreams(type, realId);

        const responseStreams = streams.map(s => ({
            title: s.quality || "Source",
            url: s.url,
            behaviorHints: { notWebReady: true },
        }));

        res.json({ streams: responseStreams });
    } catch (err) {
        console.error("Stream error:", err.message);
        res.json({ streams: [] });
    }
});

// ------------------- Start Server -------------------
const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`Cineby Addon running on port ${PORT}`));
