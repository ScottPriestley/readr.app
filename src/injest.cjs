const RSSParser = require('./node_modules/rss-parser/index.js');
const { createClient } = require('./node_modules/@supabase/supabase-js/dist/main/index.js');

const supabaseUrl = 'https://hbkdrpbefratpvtzvmjt.supabase.co';
const supabaseKey = 'sb_publishable_Kz4mjannQ_t4XwKeGiWvog_HAmvgjUu';
const supabase = createClient(supabaseUrl, supabaseKey);

const parser = new RSSParser();

const feeds = [
  { url: 'https://feeds.arstechnica.com/arstechnica/index', source: 'Ars Technica', topics: ['technology'] },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', source: 'NY Times', topics: ['news'] },
  { url: 'https://feeds.feedburner.com/TechCrunch', source: 'TechCrunch', topics: ['technology', 'startups'] },
  { url: 'https://www.theverge.com/rss/index.xml', source: 'The Verge', topics: ['technology'] },
  { url: 'https://rss.cnn.com/rss/edition.rss', source: 'CNN', topics: ['news'] },
];

async function ingestFeeds() {
  console.log('Starting RSS ingestion...');
  let totalInserted = 0;

  for (const feed of feeds) {
    try {
      console.log(`Fetching ${feed.source}...`);
      const parsed = await parser.parseURL(feed.url);

      for (const item of parsed.items.slice(0, 20)) {
        const article = {
          url: item.link,
          title: item.title,
          summary: item.contentSnippet || item.summary || null,
          image_url: item.enclosure?.url || null,
          source: feed.source,
          topics: feed.topics,
          publish_date: item.pubDate ? new Date(item.pubDate).toISOString() : null,
        };

        const { error } = await supabase
          .from('articles')
          .upsert(article, { onConflict: 'url', ignoreDuplicates: true });

        if (!error) totalInserted++;
      }
    } catch (err) {
      console.error(`Failed to fetch ${feed.source}:`, err.message);
    }
  }

  console.log(`Done! ${totalInserted} articles processed.`);
}

ingestFeeds();