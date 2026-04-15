/**
 * Nigeria GeoNews — Source Registry
 *
 * Every source has an RSS feed URL. The fetcher reads this file
 * and tries each feed in parallel, with per-source timeouts.
 *
 * Sources are grouped:
 *   NIGERIAN_SOURCES  — local outlets (Punch, Vanguard, etc.)
 *   INTERNATIONAL_SOURCES — global outlets covering Nigeria
 *   GDELT is handled separately (not RSS, uses its own API)
 *
 * To add a new source: append an entry to the correct array.
 * No other file needs changing.
 */

export interface NewsSource {
    id: string;   // unique slug
    name: string;   // display name
    country: "NG" | "INT";
    rssUrl: string;
    priority: number;   // 1 = highest (Nigerian outlets first)
    baseUrl: string;   // for resolving relative article URLs
}

// ─── Nigerian Sources ─────────────────────────────────────────

export const NIGERIAN_SOURCES: NewsSource[] = [
    {
        id: "punch",
        name: "Punch Nigeria",
        country: "NG",
        rssUrl: "https://rss.punchng.com/v1/category/latest_news",
        priority: 1,
        baseUrl: "https://punchng.com",
    },
    {
        id: "thenation",
        name: "The Nation Nigeria",
        country: "NG",
        rssUrl: "https://thenationonlineng.net/feed/",
        priority: 1,
        baseUrl: "https://thenationonlineng.net",
    },
    {
        id: "premiumtimes",
        name: "Premium Times",
        country: "NG",
        rssUrl: "https://www.premiumtimesng.com/feed",
        priority: 1,
        baseUrl: "https://www.premiumtimesng.com",
    },
    {
        id: "vanguard",
        name: "Vanguard Nigeria",
        country: "NG",
        rssUrl: "https://www.vanguardngr.com/feed/",
        priority: 1,
        baseUrl: "https://www.vanguardngr.com",
    },
    {
        id: "thisday",
        name: "ThisDay Live",
        country: "NG",
        rssUrl: "https://www.thisdaylive.com/index.php/feed/",
        priority: 1,
        baseUrl: "https://www.thisdaylive.com",
    },
    {
        id: "guardian_ng",
        name: "The Guardian Nigeria",
        country: "NG",
        rssUrl: "https://guardian.ng/feed/",
        priority: 1,
        baseUrl: "https://guardian.ng",
    },
    {
        id: "channels",
        name: "Channels Television",
        country: "NG",
        rssUrl: "https://www.channelstv.com/feed/",
        priority: 1,
        baseUrl: "https://www.channelstv.com",
    },
    {
        id: "tvc",
        name: "TVC News Nigeria",
        country: "NG",
        rssUrl: "https://tvcnews.tv/feed/",
        priority: 1,
        baseUrl: "https://tvcnews.tv",
    },
    {
        id: "arise",
        name: "Arise News",
        country: "NG",
        rssUrl: "https://www.arise.tv/feed/",
        priority: 1,
        baseUrl: "https://www.arise.tv",
    },
    {
        id: "nta",
        name: "NTA News",
        country: "NG",
        rssUrl: "https://www.nta.ng/feed",
        priority: 1,
        baseUrl: "https://www.nta.ng",
    },
    {
        id: "dailypost",
        name: "Daily Post Nigeria",
        country: "NG",
        rssUrl: "https://dailypost.ng/feed/",
        priority: 1,
        baseUrl: "https://dailypost.ng",
    },
    {
        id: "dailynigeria",
        name: "Daily Nigeria",
        country: "NG",
        rssUrl: "https://dailynigerian.com/feed/",
        priority: 1,
        baseUrl: "https://dailynigeria.com",
    },
    {
        id: "saharareporters",
        name: "Sahara Reporters",
        country: "NG",
        rssUrl: "https://saharareporters.com/rss.xml",
        priority: 1,
        baseUrl: "https://saharareporters.com",
    },
    {
        id: "naij",
        name: "Legit.ng (Naij)",
        country: "NG",
        rssUrl: "https://www.legit.ng/rss/all.rss",
        priority: 2,
        baseUrl: "https://www.legit.ng",
    },
    {
        id: "leadership",
        name: "Leadership Newspaper",
        country: "NG",
        rssUrl: "https://leadership.ng/feed/",
        priority: 2,
        baseUrl: "https://leadership.ng",
    },
    {
        id: "tribune",
        name: "Tribune Online Nigeria",
        country: "NG",
        rssUrl: "https://tribuneonlineng.com/feed/",
        priority: 2,
        baseUrl: "https://tribuneonlineng.com",
    },
    {
        id: "sunng",
        name: "The Sun Nigeria",
        country: "NG",
        rssUrl: "https://www.sunnewsonline.com/feed/",
        priority: 2,
        baseUrl: "https://www.sunnewsonline.com",
    },
    {
        id: "blueprint",
        name: "Blueprint Newspapers",
        country: "NG",
        rssUrl: "https://www.blueprint.ng/feed/",
        priority: 2,
        baseUrl: "https://www.blueprint.ng",
    },
    {
        id: "businessday",
        name: "BusinessDay NG",
        country: "NG",
        rssUrl: "https://businessday.ng/feed/",
        priority: 2,
        baseUrl: "https://businessday.ng",
    },
    {
        id: "informationng",
        name: "Information Nigeria",
        country: "NG",
        rssUrl: "https://www.informationng.com/feed",
        priority: 2,
        baseUrl: "https://www.informationng.com",
    },
    {
        id: "naijanews",
        name: "Naija News",
        country: "NG",
        rssUrl: "https://naijanews.com/feed/",
        priority: 2,
        baseUrl: "https://naijanews.com",
    },
    {
        id: "nigerianbulletin",
        name: "Nigerian Bulletin",
        country: "NG",
        rssUrl: "https://nigerianbulletin.com/forum/external.php?type=RSS2",
        priority: 2,
        baseUrl: "https://nigerianbulletin.com",
    },
    {
        id: "nairametrics",
        name: "Nairametrics",
        country: "NG",
        rssUrl: "https://nairametrics.com/feed/",
        priority: 3,
        baseUrl: "https://nairametrics.com",
    },
    {
        id: "thestreet",
        name: "The Street Journal NG",
        country: "NG",
        rssUrl: "https://thestreetjournal.org/feed/",
        priority: 3,
        baseUrl: "https://thestreetjournal.org",
    },
    {
        id: "humangle",
        name: "HumAngle Media",
        country: "NG",
        rssUrl: "https://humanglemedia.com/feed/",
        priority: 1,
        baseUrl: "https://humanglemedia.com",
        // Specialises in Northeast Nigeria / Boko Haram / IDP coverage
    },
    {
        id: "stears",
        name: "Stears Business",
        country: "NG",
        rssUrl: "https://www.stears.co/feed/",
        priority: 3,
        baseUrl: "https://www.stears.co",
    },
];

// ─── International Sources ────────────────────────────────────

export const INTERNATIONAL_SOURCES: NewsSource[] = [
    {
        id: "aljazeera",
        name: "Al Jazeera",
        country: "INT",
        rssUrl: "https://www.aljazeera.com/xml/rss/all.xml",
        priority: 2,
        baseUrl: "https://www.aljazeera.com",
    },
    {
        id: "bbc_africa",
        name: "BBC Africa",
        country: "INT",
        rssUrl: "https://feeds.bbci.co.uk/news/world/africa/rss.xml",
        priority: 2,
        baseUrl: "https://www.bbc.com",
    },
    {
        id: "reuters_africa",
        name: "Reuters Africa",
        country: "INT",
        rssUrl: "https://feeds.reuters.com/reuters/AFRICANews",
        priority: 2,
        baseUrl: "https://www.reuters.com",
    },
    {
        id: "cnn",
        name: "CNN World",
        country: "INT",
        rssUrl: "http://rss.cnn.com/rss/edition_world.rss",
        priority: 3,
        baseUrl: "https://www.cnn.com",
    },
    {
        id: "ap_africa",
        name: "Associated Press Africa",
        country: "INT",
        rssUrl: "https://apnews.com/hub/africa/feed",
        priority: 2,
        baseUrl: "https://apnews.com",
    },
    {
        id: "voa_africa",
        name: "Voice of America Africa",
        country: "INT",
        rssUrl: "https://www.voanews.com/api/zkreagmtqp",
        priority: 2,
        baseUrl: "https://www.voanews.com",
    },
    {
        id: "dw_africa",
        name: "DW Africa",
        country: "INT",
        rssUrl: "https://rss.dw.com/rdf/rss-en-africa",
        priority: 2,
        baseUrl: "https://www.dw.com",
    },
    {
        id: "france24",
        name: "France 24 Africa",
        country: "INT",
        rssUrl: "https://www.france24.com/en/africa/rss",
        priority: 2,
        baseUrl: "https://www.france24.com",
    },
    {
        id: "africanews",
        name: "Africanews",
        country: "INT",
        rssUrl: "https://www.africanews.com/rss/",
        priority: 2,
        baseUrl: "https://www.africanews.com",
    },
    {
        id: "guardian_int",
        name: "The Guardian World",
        country: "INT",
        rssUrl: "https://guardian.ng/feed/",
        priority: 3,
        baseUrl: "https://www.guardian.ng",
    },
    {
        id: "nyt",
        name: "New York Times World",
        country: "INT",
        rssUrl: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
        priority: 3,
        baseUrl: "https://www.nytimes.com",
    },
    {
        id: "acled",
        name: "ACLED Nigeria",
        country: "INT",
        // ACLED exports are CSV; we hit their public API filtered to Nigeria
        rssUrl: "https://api.acleddata.com/acled/read?key=ACLED_KEY&email=ACLED_EMAIL&country=Nigeria&limit=25&fields=event_date|event_type|actor1|location|latitude|longitude|notes&format=json",
        priority: 1,
        baseUrl: "https://acleddata.com",
        // ACLED is handled separately — not RSS but highest quality security data
    },
];

// ─── All sources combined ─────────────────────────────────────

export const ALL_SOURCES = [...NIGERIAN_SOURCES, ...INTERNATIONAL_SOURCES];