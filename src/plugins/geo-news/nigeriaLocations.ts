/**
 * Nigeria Location Geocoder
 *
 * Maps city/town/LGA names to lat/lon coordinates.
 * Used by the GeoNews API route to geotag news articles.
 *
 * Priority order during geocoding:
 *   1. Exact match on name (case-insensitive)
 *   2. Match on aliases array
 *   3. Partial substring match on name
 *   4. State capital fallback if only state is found
 */

import type { NigeriaLocation } from "./geoNewsTypes";

export const NIGERIA_LOCATIONS: NigeriaLocation[] = [
    // ── FCT ──────────────────────────────────────────────────
    { name: "Abuja",          state: "FCT",         lat:  9.0579,  lon:  7.4951 },
    { name: "Gwagwalada",     state: "FCT",         lat:  8.9432,  lon:  7.0793 },
    { name: "Kuje",           state: "FCT",         lat:  8.8805,  lon:  7.2213 },
    { name: "Bwari",          state: "FCT",         lat:  9.2192,  lon:  7.3868 },
    { name: "Kubwa",          state: "FCT",         lat:  9.1603,  lon:  7.3197 },

    // ── Lagos ─────────────────────────────────────────────────
    { name: "Lagos",          state: "Lagos",       lat:  6.5244,  lon:  3.3792 },
    { name: "Ikeja",          state: "Lagos",       lat:  6.6018,  lon:  3.3515 },
    { name: "Apapa",          state: "Lagos",       lat:  6.4497,  lon:  3.3617 },
    { name: "Badagry",        state: "Lagos",       lat:  6.4147,  lon:  2.8898 },
    { name: "Ikorodu",        state: "Lagos",       lat:  6.6194,  lon:  3.5106 },
    { name: "Epe",            state: "Lagos",       lat:  6.5871,  lon:  3.9844 },
    { name: "Mushin",         state: "Lagos",       lat:  6.5244,  lon:  3.3561 },
    { name: "Ojo",            state: "Lagos",       lat:  6.4698,  lon:  3.2243 },

    // ── Kano ──────────────────────────────────────────────────
    { name: "Kano",           state: "Kano",        lat: 12.0022,  lon:  8.5920 },
    { name: "Wudil",          state: "Kano",        lat: 11.8084,  lon:  8.8399 },
    { name: "Gwarzo",         state: "Kano",        lat: 11.9098,  lon:  8.0049 },
    { name: "Bebeji",         state: "Kano",        lat: 11.5756,  lon:  8.7447 },

    // ── Kaduna ────────────────────────────────────────────────
    { name: "Kaduna",         state: "Kaduna",      lat: 10.5264,  lon:  7.4388 },
    { name: "Zaria",          state: "Kaduna",      lat: 11.0862,  lon:  7.7198 },
    { name: "Kafanchan",      state: "Kaduna",      lat:  9.5790,  lon:  8.2899 },
    { name: "Saminaka",       state: "Kaduna",      lat: 10.4071,  lon:  8.1112 },
    { name: "Birnin Gwari",   state: "Kaduna",      lat: 10.9998,  lon:  6.7547, aliases: ["Birnin-Gwari"] },
    { name: "Igabi",          state: "Kaduna",      lat: 10.6201,  lon:  7.3312 },
    { name: "Giwa",           state: "Kaduna",      lat: 10.9431,  lon:  7.2198 },
    { name: "Chikun",         state: "Kaduna",      lat: 10.2801,  lon:  7.3021 },

    // ── Katsina ───────────────────────────────────────────────
    { name: "Katsina",        state: "Katsina",     lat: 12.9908,  lon:  7.6017 },
    { name: "Jibia",          state: "Katsina",     lat: 13.0881,  lon:  7.2002 },
    { name: "Dutsin-ma",      state: "Katsina",     lat: 12.4698,  lon:  7.5012 },
    { name: "Funtua",         state: "Katsina",     lat: 11.5207,  lon:  7.3087 },
    { name: "Daura",          state: "Katsina",     lat: 13.0367,  lon:  8.3107 },
    { name: "Mashi",          state: "Katsina",     lat: 13.0017,  lon:  7.8879 },

    // ── Zamfara ───────────────────────────────────────────────
    { name: "Gusau",          state: "Zamfara",     lat: 12.1704,  lon:  6.6599 },
    { name: "Kaura Namoda",   state: "Zamfara",     lat: 12.6003,  lon:  6.5897 },
    { name: "Anka",           state: "Zamfara",     lat: 12.1264,  lon:  5.9451 },
    { name: "Shinkafi",       state: "Zamfara",     lat: 13.0798,  lon:  6.5101 },
    { name: "Tsafe",          state: "Zamfara",     lat: 12.5512,  lon:  7.1908 },
    { name: "Talata Mafara",  state: "Zamfara",     lat: 12.5497,  lon:  6.0660 },
    { name: "Zurmi",          state: "Zamfara",     lat: 12.7499,  lon:  6.0101 },
    { name: "Maru",           state: "Zamfara",     lat: 12.3498,  lon:  6.5399 },

    // ── Sokoto ────────────────────────────────────────────────
    { name: "Sokoto",         state: "Sokoto",      lat: 13.0622,  lon:  5.2396 },
    { name: "Illela",         state: "Sokoto",      lat: 13.7360,  lon:  5.2963 },
    { name: "Wurno",          state: "Sokoto",      lat: 13.2999,  lon:  5.4201 },
    { name: "Rabah",          state: "Sokoto",      lat: 13.0699,  lon:  5.4801 },

    // ── Kebbi ─────────────────────────────────────────────────
    { name: "Birnin Kebbi",   state: "Kebbi",       lat: 12.4538,  lon:  4.1975, aliases: ["Birnin-Kebbi"] },
    { name: "Argungu",        state: "Kebbi",       lat: 12.7451,  lon:  4.5234 },
    { name: "Zuru",           state: "Kebbi",       lat: 11.4390,  lon:  5.2319 },

    // ── Niger ─────────────────────────────────────────────────
    { name: "Minna",          state: "Niger",       lat:  9.6139,  lon:  6.5569 },
    { name: "Suleja",         state: "Niger",       lat:  9.1833,  lon:  7.1811 },
    { name: "Bida",           state: "Niger",       lat:  9.1089,  lon:  6.0117 },
    { name: "Kontagora",      state: "Niger",       lat: 10.4028,  lon:  5.4721 },
    { name: "Lapai",          state: "Niger",       lat:  9.0298,  lon:  6.5801 },
    { name: "Shiroro",        state: "Niger",       lat:  9.9712,  lon:  6.8441 },
    { name: "Rafi",           state: "Niger",       lat: 10.2001,  lon:  6.3001 },

    // ── Kwara ─────────────────────────────────────────────────
    { name: "Ilorin",         state: "Kwara",       lat:  8.4966,  lon:  4.5426 },
    { name: "Offa",           state: "Kwara",       lat:  8.1499,  lon:  4.7200 },
    { name: "Lafiagi",        state: "Kwara",       lat:  9.2180,  lon:  5.4231 },

    // ── Kogi ──────────────────────────────────────────────────
    { name: "Lokoja",         state: "Kogi",        lat:  7.8012,  lon:  6.7410 },
    { name: "Okene",          state: "Kogi",        lat:  7.5473,  lon:  6.2351 },
    { name: "Idah",           state: "Kogi",        lat:  7.1099,  lon:  6.7299 },
    { name: "Ofu",            state: "Kogi",        lat:  7.1910,  lon:  7.1881 },

    // ── Benue ─────────────────────────────────────────────────
    { name: "Makurdi",        state: "Benue",       lat:  7.7298,  lon:  8.5376 },
    { name: "Gboko",          state: "Benue",       lat:  7.3281,  lon:  9.0033 },
    { name: "Otukpo",         state: "Benue",       lat:  7.1887,  lon:  8.1299 },
    { name: "Katsina-Ala",    state: "Benue",       lat:  7.1773,  lon:  9.2882, aliases: ["Katsina Ala"] },
    { name: "Oju",            state: "Benue",       lat:  7.4381,  lon:  8.3901 },
    { name: "Logo",           state: "Benue",       lat:  7.1501,  lon:  8.8801 },

    // ── Plateau ───────────────────────────────────────────────
    { name: "Jos",            state: "Plateau",     lat:  9.9285,  lon:  8.8921 },
    { name: "Shendam",        state: "Plateau",     lat:  8.8831,  lon:  9.5291 },
    { name: "Mangu",          state: "Plateau",     lat: 10.0198,  lon:  9.1701 },
    { name: "Barkin Ladi",    state: "Plateau",     lat:  9.5201,  lon:  8.9001, aliases: ["Barkin-Ladi"] },
    { name: "Riyom",          state: "Plateau",     lat:  9.7001,  lon:  8.7990 },
    { name: "Bokkos",         state: "Plateau",     lat:  9.2781,  lon:  9.0200 },
    { name: "Wase",           state: "Plateau",     lat:  9.0983,  lon:  9.9701 },
    { name: "Langtang",       state: "Plateau",     lat:  8.7281,  lon:  9.7901 },

    // ── Nasarawa ──────────────────────────────────────────────
    { name: "Lafia",          state: "Nasarawa",    lat:  8.4897,  lon:  8.5227 },
    { name: "Keffi",          state: "Nasarawa",    lat:  8.8481,  lon:  7.8741 },
    { name: "Akwanga",        state: "Nasarawa",    lat:  8.9198,  lon:  8.3998 },
    { name: "Obi",            state: "Nasarawa",    lat:  8.3498,  lon:  8.8801 },

    // ── Borno ─────────────────────────────────────────────────
    { name: "Maiduguri",      state: "Borno",       lat: 11.8311,  lon: 13.1510 },
    { name: "Biu",            state: "Borno",       lat: 10.6101,  lon: 12.1931 },
    { name: "Gwoza",          state: "Borno",       lat: 11.0480,  lon: 13.7020 },
    { name: "Chibok",         state: "Borno",       lat: 10.8601,  lon: 12.8401 },
    { name: "Damboa",         state: "Borno",       lat: 11.1601,  lon: 13.0120 },
    { name: "Konduga",        state: "Borno",       lat: 11.6499,  lon: 13.4301 },
    { name: "Bama",           state: "Borno",       lat: 11.5191,  lon: 13.6882 },
    { name: "Dikwa",          state: "Borno",       lat: 12.0231,  lon: 13.9151 },
    { name: "Ngala",          state: "Borno",       lat: 12.3411,  lon: 14.1760 },
    { name: "Mobbar",         state: "Borno",       lat: 13.2001,  lon: 13.4801 },
    { name: "Kukawa",         state: "Borno",       lat: 12.9201,  lon: 13.5601 },

    // ── Yobe ──────────────────────────────────────────────────
    { name: "Damaturu",       state: "Yobe",        lat: 11.7480,  lon: 11.9607 },
    { name: "Potiskum",       state: "Yobe",        lat: 11.7091,  lon: 11.0801 },
    { name: "Nguru",          state: "Yobe",        lat: 12.8791,  lon: 10.4551 },
    { name: "Gashua",         state: "Yobe",        lat: 12.8718,  lon: 11.0451 },
    { name: "Geidam",         state: "Yobe",        lat: 12.8992,  lon: 11.9290 },
    { name: "Bade",           state: "Yobe",        lat: 12.5598,  lon: 10.5701 },

    // ── Adamawa ───────────────────────────────────────────────
    { name: "Yola",           state: "Adamawa",     lat:  9.2035,  lon: 12.4954 },
    { name: "Mubi",           state: "Adamawa",     lat: 10.2681,  lon: 13.2671 },
    { name: "Numan",          state: "Adamawa",     lat:  9.4682,  lon: 12.0381 },
    { name: "Michika",        state: "Adamawa",     lat: 10.6131,  lon: 13.3801 },
    { name: "Madagali",       state: "Adamawa",     lat: 10.8901,  lon: 13.6301 },

    // ── Taraba ────────────────────────────────────────────────
    { name: "Jalingo",        state: "Taraba",      lat:  8.8894,  lon: 11.3730 },
    { name: "Wukari",         state: "Taraba",      lat:  7.8699,  lon: 9.7808 },
    { name: "Gembu",          state: "Taraba",      lat:  6.7030,  lon: 11.2601 },

    // ── Gombe ─────────────────────────────────────────────────
    { name: "Gombe",          state: "Gombe",       lat: 10.2897,  lon: 11.1673 },
    { name: "Billiri",        state: "Gombe",       lat:  9.8688,  lon: 11.2201 },
    { name: "Kaltungo",       state: "Gombe",       lat:  9.8201,  lon: 11.3101 },

    // ── Bauchi ────────────────────────────────────────────────
    { name: "Bauchi",         state: "Bauchi",      lat: 10.3066,  lon:  9.8447 },
    { name: "Azare",          state: "Bauchi",      lat: 11.6741,  lon: 10.1911 },
    { name: "Misau",          state: "Bauchi",      lat: 11.3281,  lon: 10.0801 },
    { name: "Tafawa Balewa",  state: "Bauchi",      lat: 10.0398,  lon:  9.5001 },

    // ── Jigawa ────────────────────────────────────────────────
    { name: "Dutse",          state: "Jigawa",      lat: 11.7437,  lon:  9.3413 },
    { name: "Hadejia",        state: "Jigawa",      lat: 12.4582,  lon: 10.0409 },
    { name: "Ringim",         state: "Jigawa",      lat: 12.1501,  lon:  9.1619 },
    { name: "Maigatari",      state: "Jigawa",      lat: 12.9771,  lon:  9.4029 },

    // ── Oyo ───────────────────────────────────────────────────
    { name: "Ibadan",         state: "Oyo",         lat:  7.3776,  lon:  3.9470 },
    { name: "Ogbomosho",      state: "Oyo",         lat:  8.1352,  lon:  4.2421 },
    { name: "Oyo",            state: "Oyo",         lat:  7.8521,  lon:  3.9321 },

    // ── Ogun ──────────────────────────────────────────────────
    { name: "Abeokuta",       state: "Ogun",        lat:  7.1474,  lon:  3.3481 },
    { name: "Ijebu Ode",      state: "Ogun",        lat:  6.8201,  lon:  3.9221, aliases: ["Ijebu-Ode"] },
    { name: "Sagamu",         state: "Ogun",        lat:  6.8349,  lon:  3.6479 },

    // ── Ondo ──────────────────────────────────────────────────
    { name: "Akure",          state: "Ondo",        lat:  7.2526,  lon:  5.1926 },
    { name: "Ondo",           state: "Ondo",        lat:  7.0949,  lon:  4.8354 },
    { name: "Owo",            state: "Ondo",        lat:  7.1979,  lon:  5.5851, notes: "" } as any,

    // ── Ekiti ─────────────────────────────────────────────────
    { name: "Ado Ekiti",      state: "Ekiti",       lat:  7.6218,  lon:  5.2210, aliases: ["Ado-Ekiti"] },
    { name: "Ikere Ekiti",    state: "Ekiti",       lat:  7.5001,  lon:  5.2401, aliases: ["Ikere-Ekiti"] },

    // ── Osun ──────────────────────────────────────────────────
    { name: "Osogbo",         state: "Osun",        lat:  7.7632,  lon:  4.5603 },
    { name: "Ile Ife",        state: "Osun",        lat:  7.4667,  lon:  4.5594, aliases: ["Ile-Ife", "Ife"] },

    // ── Edo ───────────────────────────────────────────────────
    { name: "Benin City",     state: "Edo",         lat:  6.3384,  lon:  5.6271, aliases: ["Benin"] },
    { name: "Auchi",          state: "Edo",         lat:  7.0698,  lon:  6.2652 },

    // ── Delta ─────────────────────────────────────────────────
    { name: "Asaba",          state: "Delta",       lat:  6.1979,  lon:  6.7371 },
    { name: "Warri",          state: "Delta",       lat:  5.5167,  lon:  5.7542 },
    { name: "Sapele",         state: "Delta",       lat:  5.9031,  lon:  5.6882 },
    { name: "Agbor",          state: "Delta",       lat:  6.2498,  lon:  6.2001 },

    // ── Anambra ───────────────────────────────────────────────
    { name: "Awka",           state: "Anambra",     lat:  6.2104,  lon:  7.0672 },
    { name: "Onitsha",        state: "Anambra",     lat:  6.1461,  lon:  6.7868 },
    { name: "Nnewi",          state: "Anambra",     lat:  6.0163,  lon:  6.9103 },

    // ── Enugu ─────────────────────────────────────────────────
    { name: "Enugu",          state: "Enugu",       lat:  6.4521,  lon:  7.5102 },
    { name: "Nsukka",         state: "Enugu",       lat:  6.8564,  lon:  7.3955 },

    // ── Ebonyi ────────────────────────────────────────────────
    { name: "Abakaliki",      state: "Ebonyi",      lat:  6.3249,  lon:  8.1137 },

    // ── Imo ───────────────────────────────────────────────────
    { name: "Owerri",         state: "Imo",         lat:  5.4836,  lon:  7.0354 },
    { name: "Orlu",           state: "Imo",         lat:  5.7934,  lon:  7.0449 },

    // ── Abia ──────────────────────────────────────────────────
    { name: "Umuahia",        state: "Abia",        lat:  5.5320,  lon:  7.4864 },
    { name: "Aba",            state: "Abia",        lat:  5.1167,  lon:  7.3667 },

    // ── Rivers ────────────────────────────────────────────────
    { name: "Port Harcourt",  state: "Rivers",      lat:  4.8156,  lon:  7.0498, aliases: ["PH", "Port-Harcourt"] },
    { name: "Bonny",          state: "Rivers",      lat:  4.4482,  lon:  7.1571 },
    { name: "Degema",         state: "Rivers",      lat:  4.7451,  lon:  6.7698 },

    // ── Bayelsa ───────────────────────────────────────────────
    { name: "Yenagoa",        state: "Bayelsa",     lat:  4.9247,  lon:  6.2676 },

    // ── Cross River ───────────────────────────────────────────
    { name: "Calabar",        state: "Cross River", lat:  4.9517,  lon:  8.3220 },
    { name: "Ikom",           state: "Cross River", lat:  5.9671,  lon:  8.7121 },
    { name: "Ogoja",          state: "Cross River", lat:  6.6601,  lon:  8.7981 },

    // ── Akwa Ibom ─────────────────────────────────────────────
    { name: "Uyo",            state: "Akwa Ibom",   lat:  5.0444,  lon:  7.9220 },
    { name: "Eket",           state: "Akwa Ibom",   lat:  4.6478,  lon:  7.9201 },
    { name: "Ikot Ekpene",    state: "Akwa Ibom",   lat:  5.1841,  lon:  7.7201, aliases: ["Ikot-Ekpene"] },
];

// Build a lookup map for O(1) exact matching
const NAME_MAP = new Map<string, NigeriaLocation>();
const ALIAS_MAP = new Map<string, NigeriaLocation>();

for (const loc of NIGERIA_LOCATIONS) {
    NAME_MAP.set(loc.name.toLowerCase(), loc);
    if (loc.aliases) {
        for (const alias of loc.aliases) {
            ALIAS_MAP.set(alias.toLowerCase(), loc);
        }
    }
}

/**
 * Given a block of text (article title + summary), find the best
 * Nigeria location match and return lat/lon + metadata.
 * Returns null if no Nigerian location is found in the text.
 */
export function geocodeText(text: string): NigeriaLocation | null {
    const lower = text.toLowerCase();

    // 1. Exact name match (longer names first to avoid "Owo" matching "Owo Creek")
    const sorted = [...NIGERIA_LOCATIONS].sort((a, b) => b.name.length - a.name.length);
    for (const loc of sorted) {
        if (lower.includes(loc.name.toLowerCase())) return loc;
        if (loc.aliases) {
            for (const alias of loc.aliases) {
                if (lower.includes(alias.toLowerCase())) return loc;
            }
        }
    }

    // 2. State name match — return state capital
    for (const loc of NIGERIA_LOCATIONS) {
        if (lower.includes(loc.state.toLowerCase())) {
            // Find the capital (usually the first entry for that state)
            const capital = NIGERIA_LOCATIONS.find(l => l.state === loc.state);
            if (capital) return capital;
        }
    }

    return null;
}

/** Map of Nigerian state names to their capital location */
export const STATE_CAPITALS: Record<string, NigeriaLocation> = {};
for (const loc of NIGERIA_LOCATIONS) {
    if (!STATE_CAPITALS[loc.state]) {
        STATE_CAPITALS[loc.state] = loc; // first entry per state = capital
    }
}