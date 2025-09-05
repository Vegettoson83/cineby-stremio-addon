const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.options("*", cors()); // preflight for Stremio Web
app.use(express.json());

// ------------------- Cineby API Client -------------------
class CinebyClient {
  constructor() {
    this.baseURL = "https://www.cineby.app";
    this.buildId = null;
    this.buildIdFetchedAt = 0;
  }

  async getBuildId(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.buildId && now - this.buildIdFetchedAt < 3600 * 1000) {
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
    const url = `${this.baseURL}/_next/data/${this.buildId}/en/movie.json?page=${page}`;
    const response = await axios.get(url);
    return response.data.pageProps?.movies || [];
  }

  async getTVShows(page = 1) {
    await this.getBuildId();
    const url = `${this.baseURL}/_next/data/${this.buildId}/en/tv.json?page=${page}`;
    const response = await axios.get(url);
    return response.data.pageProps?.shows || [];
  }

  async search(query, type = "movie", page = 1) {
    await this.getBuildId();
    const url = `${this.baseURL}/_next/data/${this.buildId}/en/search.json?q=${encodeURIComponent(query)}&page=${page}`;
    const response = await axios.get(url);
    const results = response.data.pageProps?.results || [];
    return results.filter(item => (type === "series" ? item.mediaType === "tv" : item.mediaType === "movie"));
  }

  async getDetails(type, id) {
    await this.getBuildId();
    const url = `${this.baseURL}/_next/data/${this.buildId}/en/${type}/${id}.json`;
    const response = await axios.get(url);
    return response.data.pageProps || {};
  }

  async getStreams(type, id) {
    const url = type === "movie"
      ? `${this.baseURL}/api/v2/movie/${id}`
      : `${this.baseURL}/api/v2/tv/${id}`;
    const response = await axios.get(url);
    return response.data?.sources || [];
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
  resources: ["catalog", "meta", "stream"],
  catalogs: [
    {
      type: "movie",
      id: "cineby-movies",
      name: "Cineby Movies",
      extra: [
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false },
        { name: "genre", isRequired: false }
      ]
    },
    {
      type: "series",
      id: "cineby-series",
      name: "Cineby TV Shows",
      extra: [
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false },
        { name: "genre", isRequired: false }
      ]
    }
  ]
};

// ------------------- Routes -------------------

// Root & health
app.get("/", (req, res) => res.send("Cineby Stremio Addon running."));
app.get("/health", (req, res) => res.json({ status: "ok", timestamp: new Date() }));

// Manifest
app.get("/manifest.json", (req, res) => res.json(manifest));

// Catalog
app.get("/catalog/:type/:id", async (req, res) => {
  try {
    const { type, id } = req.params;
    const { search, skip = 0 } = req.query;
    const page = Math.floor(skip / 20) + 1;
    let items = [];

    if (search) {
      items = await client.search(search, type, page);
    } else if (id === "cineby-movies") {
      items = await client.getMovies(page);
    } else if (id === "cineby-series") {
      items = await client.getTVShows(page);
    }

    const metas = items.map(item => ({
      id: `${type}:${item.id}`,
      type,
      name: item.title || item.name,
      poster: item.poster || item.image || "",
      background: item.backdrop || item.image || "",
      description: item.description || item.overview || "",
      releaseInfo: item.release_date || item.first_air_date || ""
    }));

    res.json({ metas });
  } catch (err) {
    console.error("Catalog error:", err.message);
    res.json({ metas: [] });
  }
});

// Meta
app.get("/meta/:type/:id", async (req, res) => {
  try {
    const { type, id } = req.params;
    const realId = id.split(":")[1];
    const details = await client.getDetails(type === "series" ? "tv" : "movie", realId);

    const meta = {
      id,
      type,
      name: details.title || details.name || "Unknown",
      poster: details.poster || details.image || "",
      background: details.backdrop || details.image || "",
      description: details.description || details.overview || "",
      releaseInfo: details.release_date || details.first_air_date || "",
      runtime: details.runtime || null,
      genres: details.genre_ids || details.genres?.map(g => g.name) || []
    };

    res.json({ meta });
  } catch (err) {
    console.error("Meta error:", err.message);
    res.json({ meta: {} });
  }
});

// Stream
app.get("/stream/:type/:id", async (req, res) => {
  try {
    const { type, id } = req.params;
    const realId = id.split(":")[1];
    const streams = await client.getStreams(type === "series" ? "tv" : "movie", realId);

    const responseStreams = streams.map((s, index) => ({
      title: s.quality || `Source ${index + 1}`,
      url: s.url,
      behaviorHints: { notWebReady: false }
    }));

    res.json({ streams: responseStreams });
  } catch (err) {
    console.error("Stream error:", err.message);
    res.json({ streams: [] });
  }
});

// ------------------- Start Server -------------------
const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`Cineby Stremio Addon running on port ${PORT}`));
