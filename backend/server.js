// server.js
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const validUrl = require('valid-url');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const fs = require('fs').promises;
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// File paths for persistence
const DATA_DIR = path.join(__dirname, 'data');
const URL_DATA_FILE = path.join(DATA_DIR, 'urls.json');

// In-memory storage (will be loaded from files)
let urlDatabase = new Map();

// URL Entry class with enhanced stats
class UrlEntry {
    constructor(longUrl, shortId, createdAt, ttl = null, customSlug = null) {
        this.longUrl = longUrl;
        this.shortId = customSlug || shortId;
        this.createdAt = createdAt;
        this.ttl = ttl;
        this.accessCount = 0;
        this.lastAccessed = null;
        this.referrers = new Map(); // Track traffic sources
        this.browserStats = new Map(); // Track browser usage
        this.qrCode = null; // Store QR code data URL
    }

    isExpired() {
        if (!this.ttl) return false;
        return Date.now() > this.createdAt + this.ttl;
    }

    updateStats(referrer, userAgent) {
        this.accessCount += 1;
        this.lastAccessed = Date.now();
        
        // Update referrer stats
        const referrerCount = this.referrers.get(referrer) || 0;
        this.referrers.set(referrer, referrerCount + 1);

        // Update browser stats
        const browser = this.getBrowserFromUserAgent(userAgent);
        const browserCount = this.browserStats.get(browser) || 0;
        this.browserStats.set(browser, browserCount + 1);
    }

    getBrowserFromUserAgent(userAgent) {
        if (userAgent.includes('Firefox')) return 'Firefox';
        if (userAgent.includes('Chrome')) return 'Chrome';
        if (userAgent.includes('Safari')) return 'Safari';
        if (userAgent.includes('Edge')) return 'Edge';
        return 'Other';
    }

    getStats() {
        return {
            accessCount: this.accessCount,
            lastAccessed: this.lastAccessed,
            createdAt: this.createdAt,
            ttl: this.ttl,
            isExpired: this.isExpired(),
            referrers: Object.fromEntries(this.referrers),
            browserStats: Object.fromEntries(this.browserStats),
            qrCode: this.qrCode
        };
    }

    // Convert Map to Object for serialization
    toJSON() {
        return {
            ...this,
            referrers: Object.fromEntries(this.referrers),
            browserStats: Object.fromEntries(this.browserStats)
        };
    }

    // Restore Maps from serialized object
    static fromJSON(json) {
        const entry = new UrlEntry(
            json.longUrl,
            json.shortId,
            json.createdAt,
            json.ttl,
            json.customSlug
        );
        entry.accessCount = json.accessCount;
        entry.lastAccessed = json.lastAccessed;
        entry.referrers = new Map(Object.entries(json.referrers));
        entry.browserStats = new Map(Object.entries(json.browserStats));
        entry.qrCode = json.qrCode;
        return entry;
    }
}

// Storage Functions
const initializeStorage = async () => {
    try {
        // Create data directory if it doesn't exist
        await fs.mkdir(DATA_DIR, { recursive: true });

        // Load URL data
        try {
            const urlData = await fs.readFile(URL_DATA_FILE, 'utf8');
            const urlEntries = JSON.parse(urlData);
            urlDatabase = new Map(
                Object.entries(urlEntries).map(([key, value]) => [
                    key,
                    UrlEntry.fromJSON(value)
                ])
            );
            console.log('Data loaded successfully');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            await fs.writeFile(URL_DATA_FILE, '{}');
            console.log('Created new data file');
        }
    } catch (error) {
        console.error('Error initializing storage:', error);
        process.exit(1);
    }
};

const saveData = async () => {
    try {
        const urlData = Object.fromEntries(
            Array.from(urlDatabase.entries()).map(([key, value]) => [
                key,
                value.toJSON()
            ])
        );
        await fs.writeFile(URL_DATA_FILE, JSON.stringify(urlData, null, 2));
        console.log('Data saved successfully');
    } catch (error) {
        console.error('Error saving data:', error);
    }
};

// Helper Functions
const generateShortId = () => {
    return crypto.randomBytes(4).toString('hex');
};

const isValidUrl = (url) => {
    return validUrl.isWebUri(url);
};

const isValidCustomSlug = (slug) => {
    return /^[a-zA-Z0-9-_]+$/.test(slug);
};

const generateQRCode = async (url) => {
    try {
        return await QRCode.toDataURL(url);
    } catch (error) {
        console.error('Error generating QR code:', error);
        return null;
    }
};

// Cleanup expired URLs
const cleanupExpiredUrls = async () => {
    let hasChanges = false;
    console.log('Running cleanup job...');
    for (const [shortId, urlEntry] of urlDatabase.entries()) {
        if (urlEntry.isExpired()) {
            urlDatabase.delete(shortId);
            hasChanges = true;
            console.log(`Cleaned up expired URL: ${shortId}`);
        }
    }
    if (hasChanges) {
        await saveData();
    }
};

// API Routes
app.post('/api/shorten', async (req, res) => {
    try {
        const { longUrl, ttl, customSlug } = req.body;

        if (!isValidUrl(longUrl)) {
            return res.status(400).json({ error: 'Invalid URL format' });
        }

        if (customSlug) {
            if (!isValidCustomSlug(customSlug)) {
                return res.status(400).json({ error: 'Invalid custom slug format' });
            }
            if (urlDatabase.has(customSlug)) {
                return res.status(409).json({ error: 'Custom slug already in use' });
            }
        }

        // Check for existing URL
        for (const [existingShortId, urlEntry] of urlDatabase.entries()) {
            if (urlEntry.longUrl === longUrl && !urlEntry.isExpired()) {
                return res.json({
                    shortId: existingShortId,
                    longUrl,
                    ...urlEntry.getStats()
                });
            }
        }

        const shortId = customSlug || generateShortId();
        const urlEntry = new UrlEntry(
            longUrl,
            shortId,
            Date.now(),
            ttl ? parseInt(ttl) : null,
            customSlug
        );

        const fullUrl = `${req.protocol}://${req.get('host')}/${shortId}`;
        urlEntry.qrCode = await generateQRCode(fullUrl);

        urlDatabase.set(shortId, urlEntry);
        await saveData();

        res.json({
            shortId,
            longUrl,
            ...urlEntry.getStats()
        });
    } catch (error) {
        console.error('Error shortening URL:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/:shortId', async (req, res) => {
    try {
        const { shortId } = req.params;
        const urlEntry = urlDatabase.get(shortId);

        if (!urlEntry) {
            return res.status(404).send('URL not found');
        }

        if (urlEntry.isExpired()) {
            urlDatabase.delete(shortId);
            await saveData();
            return res.status(404).send('URL has expired');
        }

        urlEntry.updateStats(
            req.get('Referrer') || 'Direct',
            req.get('User-Agent') || 'Unknown'
        );
        await saveData();

        res.redirect(urlEntry.longUrl);
    } catch (error) {
        console.error('Error redirecting:', error);
        res.status(500).send('Internal server error');
    }
});

app.get('/api/stats/:shortId', async (req, res) => {
    try {
        const { shortId } = req.params;
        const urlEntry = urlDatabase.get(shortId);

        if (!urlEntry) {
            return res.status(404).json({ error: 'URL not found' });
        }

        res.json({
            longUrl: urlEntry.longUrl,
            shortId: urlEntry.shortId,
            ...urlEntry.getStats()
        });
    } catch (error) {
        console.error('Error fetching statistics:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/health', (req, res) => {
    const stats = {
        status: 'healthy',
        totalUrls: urlDatabase.size,
        activeUrls: Array.from(urlDatabase.values()).filter(url => !url.isExpired()).length,
        expiredUrls: Array.from(urlDatabase.values()).filter(url => url.isExpired()).length
    };
    res.json(stats);
});

// Initialize storage and start server
const PORT = process.env.PORT || 3001;

initializeStorage().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        // Run cleanup every hour
        setInterval(async () => {
            await cleanupExpiredUrls();
        }, 3600000);
    });
});