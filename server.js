
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7'
};

// 1. Scrape Live Price from Amazon India
async function scrapeAmazonLive(query) {
    try {
        const searchUrl = `https://www.amazon.in/s?k=${encodeURIComponent(query)}`;
        const { data } = await axios.get(searchUrl, { headers: BROWSER_HEADERS, timeout: 8000 });
        const $ = cheerio.load(data);

        let matchedItem = null;

        $('div[data-component-type="s-search-result"]').each((_, el) => {
            const title = $(el).find('h2 span').first().text().trim();
            const priceText = $(el).find('.a-price-whole').first().text().replace(/[^0-9]/g, '');
            const rating = $(el).find('span.a-icon-alt').first().text().split(' ')[0] || '4.5';
            const reviews = $(el).find('span.s-underline-text').first().text().replace(/[^0-9,]/g, '') || 'Verified';
            const relLink = $(el).find('a.a-link-normal.s-no-outline').attr('href');

            if (title && priceText) {
                matchedItem = {
                    title,
                    price: parseInt(priceText, 10),
                    rating,
                    reviews,
                    url: relLink ? `https://www.amazon.in${relLink}` : searchUrl
                };
                return false; // Break loop on first valid match
            }
        });

        return matchedItem;
    } catch (error) {
        console.error("Amazon Live Scrape Warning:", error.message);
        return null;
    }
}

// 2. Scrape Live Price from Flipkart
async function scrapeFlipkartLive(query) {
    try {
        const searchUrl = `https://www.flipkart.com/search?q=${encodeURIComponent(query)}`;
        const { data } = await axios.get(searchUrl, { headers: BROWSER_HEADERS, timeout: 8000 });
        const $ = cheerio.load(data);

        let price = null;
        let title = null;

        $('div').each((_, el) => {
            const text = $(el).text().trim();
            if (/^₹[0-9,]+$/.test(text) && !price) {
                const parsed = parseInt(text.replace(/[^0-9]/g, ''), 10);
                if (parsed > 100) price = parsed;
            }
        });

        title = $('a[title]').first().attr('title') \vert{}\vert{}$('div.KzDlHZ').first().text().trim() || null;

        return price ? { title, price, url: searchUrl } : null;
    } catch (error) {
        console.error("Flipkart Live Scrape Warning:", error.message);
        return null;
    }
}

// 3. Fetch Live Price from Reliance Digital Public Search API
async function fetchRelianceLive(query) {
    try {
        const apiUrl = `https://www.reliancedigital.in/rildigitalws/v2/rrldigital/products/search?query=${encodeURIComponent(query)}&pageSize=1&fields=FULL`;
        const { data } = await axios.get(apiUrl, { headers: BROWSER_HEADERS, timeout: 8000 });
        const product = data?.products?.[0];

        if (product && product.price?.value) {
            return {
                title: product.name,
                price: Math.round(product.price.value),
                url: `https://www.reliancedigital.in${product.url}`
            };
        }
        return null;
    } catch (error) {
        return null;
    }
}

app.get('/api/compare', async (req, res) => {
    const query = (req.query.q || '').trim();
    if (!query) return res.status(400).json({ error: "Search query is required" });

    const encodedQuery = encodeURIComponent(query);
    const partnerTag = process.env.AMAZON_PARTNER_TAG || 'yourstore-21';
    const fkAffId = process.env.FLIPKART_AFFILIATE_ID || 'your_fk_id';

    const [amazonLive, flipkartLive, relianceLive] = await Promise.all([
        scrapeAmazonLive(query),
        scrapeFlipkartLive(query),
        fetchRelianceLive(query)
    ]);

    const amazonPrice = amazonLive?.price || null;
    const flipkartPrice = flipkartLive?.price || null;
    const reliancePrice = relianceLive?.price || null;

    const stores = [
        {
            name: "Amazon",
            logoColor: "bg-amber-500",
            price: amazonPrice,
            delivery: amazonPrice ? "Live Price Verified • Prime Eligible" : "Click to view live Amazon deal",
            inStock: true,
            url: amazonLive?.url || `https://www.amazon.in/s?k=${encodedQuery}&tag=${partnerTag}`
        },
        {
            name: "Flipkart",
            logoColor: "bg-blue-600",
            price: flipkartPrice,
            delivery: flipkartPrice ? "Live Price Verified • Free Delivery" : "Click to view live Flipkart deal",
            inStock: true,
            url: `https://www.flipkart.com/search?q=${encodedQuery}&affid=${fkAffId}`
        },
        {
            name: "Croma",
            logoColor: "bg-teal-600",
            price: null,
            delivery: "Click to check live Croma price",
            inStock: true,
            url: `https://www.croma.com/searchB?q=${encodedQuery}%3Arelevance`
        },
        {
            name: "Reliance Digital",
            logoColor: "bg-red-600",
            price: reliancePrice,
            delivery: reliancePrice ? "Live Price Verified" : "Click to check live Reliance price",
            inStock: true,
            url: relianceLive?.url || `https://www.reliancedigital.in/search?q=${encodedQuery}`
        }
    ];

    res.json({
        title: amazonLive?.title || flipkartLive?.title || relianceLive?.title || query.toUpperCase(),
        category: "Live Store Comparison",
        rating: amazonLive?.rating || "4.5",
        reviews: amazonLive?.reviews || "Live Listings",
        specs: "Real-time prices fetched directly from Indian e-commerce stores",
        icon: "fa-bag-shopping",
        stores
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`  PricePulse Live Server running at: http://localhost:${PORT}`);
    console.log(`======================================================\n`);
});
