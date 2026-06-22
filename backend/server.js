import express from "express";
import cors from "cors";
import cron from "node-cron";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const supabase = hasSupabaseConfig
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin.replace(/\/$/, ""))) {
        return callback(null, true);
      }
      return callback(new Error("Origin is not allowed by CORS"));
    },
  }),
);
app.use(express.json({ limit: "1mb" }));

function dbUnavailable(res) {
  return res.status(503).json({
    success: false,
    error: "Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to the backend environment.",
  });
}

function dbReady(res) {
  if (!supabase) {
    dbUnavailable(res);
    return false;
  }
  return true;
}

function normalizeTikTokProfileUrl(value = "") {
  let parsed;
  try {
    parsed = new URL(String(value).trim());
  } catch {
    throw new Error("Invalid TikTok profile URL. Use a link like https://www.tiktok.com/@username");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (parsed.protocol !== "https:" || (hostname !== "tiktok.com" && !hostname.endsWith(".tiktok.com"))) {
    throw new Error("Only HTTPS TikTok profile links are allowed");
  }

  const match = decodeURIComponent(parsed.pathname).match(/^\/@([A-Za-z0-9._-]+)\/?$/);
  if (!match) {
    throw new Error("Invalid TikTok profile URL. Use a link like https://www.tiktok.com/@username");
  }

  return `https://www.tiktok.com/@${match[1]}`;
}

const usernameFromUrl = (url = "") => {
  const match = String(url).match(/@([A-Za-z0-9._-]+)/);
  return match ? `@${match[1]}` : "";
};

const fallback = (url, message = "Manual verification needed") => {
  const username = usernameFromUrl(url);
  const name = username.replace("@", "").replace(/[._-]/g, " ") || "Unknown Creator";
  return {
    username,
    name,
    profile_image: `https://api.dicebear.com/8.x/initials/svg?seed=${encodeURIComponent(name)}`,
    followers: 0,
    total_likes: 0,
    video_count: 0,
    avg_likes: 0,
    engagement: 0,
    confidence: 45,
    message,
  };
};

async function scrapeTikTok(url) {
  const username = usernameFromUrl(url);
  if (!username) throw new Error("Invalid TikTok profile URL. Use a link like https://www.tiktok.com/@username");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    const html = await response.text();
    const clean = (value) => (value ? value.replaceAll("\\u002F", "/").replaceAll("\\/", "/") : "");
    const followers = Number(html.match(/"followerCount":(\d+)/)?.[1] || 0);
    const total_likes = Number(html.match(/"heartCount":(\d+)/)?.[1] || html.match(/"likesCount":(\d+)/)?.[1] || 0);
    const video_count = Number(html.match(/"videoCount":(\d+)/)?.[1] || 0);
    const name = html.match(/"nickname":"(.*?)"/)?.[1] || username.replace("@", "");
    const profile_image = clean(html.match(/"avatarLarger":"(.*?)"/)?.[1] || html.match(/"avatarMedium":"(.*?)"/)?.[1] || "");

    if (!followers && !total_likes && !video_count && !profile_image) {
      return fallback(url, "TikTok page loaded but public metrics were not found");
    }

    const avg_likes = video_count ? Math.round(total_likes / video_count) : 0;
    const engagement = followers ? Number(((avg_likes / followers) * 100).toFixed(2)) : 0;

    return {
      username,
      name,
      profile_image,
      followers,
      total_likes,
      video_count,
      avg_likes,
      engagement,
      confidence: 70,
      message: "Public TikTok data extracted",
    };
  } catch (error) {
    return fallback(url, error.name === "AbortError" ? "TikTok request timed out" : error.message);
  } finally {
    clearTimeout(timer);
  }
}

function scores(data) {
  const trust = Math.min(100, Math.round(Number(data.engagement || 0) * 4 + Number(data.confidence || 0) * 0.6 + 20));
  return { trust, audience: trust, fit: trust, brandSafety: 75 };
}

function metaFromDb(row = {}) {
  return {
    country: row.country,
    city: row.city,
    region: row.region,
    category: row.category,
    language: row.language,
    verifiedStatus: row.verified_status,
    influencerCurrentState: row.influencer_current_state,
    influencingLevel: row.influencing_level,
    adminIntelligenceNote: row.admin_intelligence_note,
    campaignHistory: row.campaign_history,
    trendParticipation: row.trend_participation,
    contactStatus: row.contact_status,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    syncMode: row.sync_mode,
  };
}

function creatorPayload(url, data, meta = {}) {
  const s = scores(data);
  return {
    profile_url: url,
    username: data.username,
    name: data.name,
    profile_image: data.profile_image,
    country: meta.country || "Ethiopia",
    city: meta.city || "",
    region: meta.region || meta.city || meta.country || "Ethiopia",
    category: meta.category || "Food",
    language: meta.language || "Amharic",
    followers: data.followers || 0,
    total_likes: data.total_likes || 0,
    video_count: data.video_count || 0,
    avg_likes: data.avg_likes || 0,
    engagement: data.engagement || 0,
    confidence: data.confidence || 0,
    trust_score: s.trust,
    brand_safety_score: s.brandSafety,
    audience_quality_score: s.audience,
    campaign_fit_score: s.fit,
    verified_status: meta.verifiedStatus || "Unverified",
    influencer_current_state: meta.influencerCurrentState || "Active",
    influencing_level: meta.influencingLevel || "Medium",
    admin_intelligence_note: meta.adminIntelligenceNote || "",
    campaign_history: meta.campaignHistory || "",
    trend_participation: meta.trendParticipation || "",
    contact_status: meta.contactStatus || "locked",
    contact_email: meta.contactEmail || "",
    contact_phone: meta.contactPhone || "",
    data_source: data.followers ? "scraper_sync" : "fallback_public_record",
    sync_mode: meta.syncMode || "auto_10_min",
    sync_status: data.followers ? "synced" : "partial",
    message: data.message,
    last_synced_at: new Date().toISOString(),
    next_sync_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function mapCreator(row = {}) {
  return {
    id: row.id,
    profileUrl: row.profile_url,
    username: row.username,
    name: row.name,
    profileImage: row.profile_image,
    country: row.country,
    city: row.city,
    region: row.region,
    category: row.category,
    language: row.language,
    followers: Number(row.followers || 0),
    totalLikes: Number(row.total_likes || 0),
    videoCount: Number(row.video_count || 0),
    avgLikes: Number(row.avg_likes || 0),
    engagement: Number(row.engagement || 0),
    growth: Number(row.growth || 0),
    confidence: Number(row.confidence || 0),
    trustScore: Number(row.trust_score || 0),
    brandSafetyScore: Number(row.brand_safety_score || 0),
    audienceQualityScore: Number(row.audience_quality_score || 0),
    campaignFitScore: Number(row.campaign_fit_score || 0),
    verifiedStatus: row.verified_status,
    influencerCurrentState: row.influencer_current_state,
    influencingLevel: row.influencing_level,
    adminIntelligenceNote: row.admin_intelligence_note,
    campaignHistory: row.campaign_history,
    trendParticipation: row.trend_participation,
    contactStatus: row.contact_status,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    dataSource: row.data_source,
    syncStatus: row.sync_status,
    lastSyncedAt: row.last_synced_at,
    nextSyncAt: row.next_sync_at,
    message: row.message,
  };
}

async function saveHistory(id, data) {
  if (!supabase || !id) return;
  const { error } = await supabase.from("creator_metric_history").insert({
    creator_id: id,
    followers: data.followers || 0,
    total_likes: data.total_likes || 0,
    video_count: data.video_count || 0,
    engagement: data.engagement || 0,
    trust_score: scores(data).trust,
  });
  if (error) console.warn("History save failed:", error.message);
}

async function addSyncLog(id, username, type, status, message) {
  if (!supabase) return;
  const { error } = await supabase.from("sync_logs").insert({ creator_id: id, username, type, status, message });
  if (error) console.warn("Sync log save failed:", error.message);
}

app.get("/", (req, res) => {
  res.json({
    service: "AfriCreator IQ V13 Fixed Backend",
    status: "running",
    database: hasSupabaseConfig ? "configured" : "missing_env",
  });
});

app.get("/api/health", async (req, res) => {
  if (!supabase) {
    return res.json({
      success: true,
      service: "AfriCreator IQ V13 Backend",
      status: "degraded",
      databaseConfigured: false,
      databaseConnected: false,
    });
  }

  const { error } = await supabase.from("creators").select("id", { head: true, count: "exact" });
  return res.status(error ? 503 : 200).json({
    success: !error,
    service: "AfriCreator IQ V13 Backend",
    status: error ? "degraded" : "healthy",
    databaseConfigured: true,
    databaseConnected: !error,
    ...(error ? { error: error.message } : {}),
  });
});

app.post("/api/import-tiktok", async (req, res) => {
  try {
    if (!dbReady(res)) return;

    const { profileUrl, ...meta } = req.body || {};
    if (!profileUrl) return res.status(400).json({ success: false, message: "profileUrl is required" });

    let normalizedProfileUrl;
    try {
      normalizedProfileUrl = normalizeTikTokProfileUrl(profileUrl);
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }

    const scraped = await scrapeTikTok(normalizedProfileUrl);
    const payload = creatorPayload(normalizedProfileUrl, scraped, meta);
    const { data, error } = await supabase.from("creators").upsert(payload, { onConflict: "profile_url" }).select().single();

    if (error) return res.status(500).json({ success: false, error: error.message });

    await saveHistory(data.id, scraped);
    await addSyncLog(data.id, data.username, "import_tiktok", data.sync_status, scraped.message);

    res.json({ success: true, creator: mapCreator(data) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/creators", async (req, res) => {
  if (!supabase) return res.json({ success: true, creators: [], warning: "Supabase is not configured" });

  const { data, error } = await supabase.from("creators").select("*").order("updated_at", { ascending: false });
  if (error) return res.status(500).json({ success: false, error: error.message });

  res.json({ success: true, creators: (data || []).map(mapCreator) });
});

app.patch("/api/creators/:id", async (req, res) => {
  if (!dbReady(res)) return;

  const body = req.body || {};
  const dbPatch = {
    name: body.name,
    country: body.country,
    city: body.city,
    region: body.region,
    category: body.category,
    language: body.language,
    followers: body.followers,
    total_likes: body.totalLikes,
    video_count: body.videoCount,
    avg_likes: body.avgLikes,
    engagement: body.engagement,
    verified_status: body.verifiedStatus,
    influencer_current_state: body.influencerCurrentState,
    influencing_level: body.influencingLevel,
    admin_intelligence_note: body.adminIntelligenceNote,
    campaign_history: body.campaignHistory,
    trend_participation: body.trendParticipation,
    contact_email: body.contactEmail,
    contact_phone: body.contactPhone,
    contact_status: body.contactStatus,
    updated_at: new Date().toISOString(),
  };

  Object.keys(dbPatch).forEach((key) => dbPatch[key] === undefined && delete dbPatch[key]);

  const { data, error } = await supabase.from("creators").update(dbPatch).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ success: false, error: error.message });

  res.json({ success: true, creator: mapCreator(data) });
});

app.post("/api/sync-all", async (req, res) => {
  try {
    if (!dbReady(res)) return;

    const { data: creators, error } = await supabase.from("creators").select("*").eq("sync_mode", "auto_10_min");
    if (error) return res.status(500).json({ success: false, error: error.message });

    const results = [];
    for (const creator of creators || []) {
      const scraped = await scrapeTikTok(creator.profile_url);
      const payload = creatorPayload(creator.profile_url, scraped, metaFromDb(creator));
      const { data, error: updateError } = await supabase.from("creators").update(payload).eq("id", creator.id).select().single();

      if (updateError) {
        await addSyncLog(creator.id, creator.username, "scheduled_or_manual_sync", "failed", updateError.message);
        continue;
      }

      if (data) {
        await saveHistory(creator.id, scraped);
        await addSyncLog(creator.id, data.username, "scheduled_or_manual_sync", data.sync_status, scraped.message);
        results.push(mapCreator(data));
      }
    }

    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/history/:id", async (req, res) => {
  if (!dbReady(res)) return;

  const { data, error } = await supabase
    .from("creator_metric_history")
    .select("*")
    .eq("creator_id", req.params.id)
    .order("captured_at", { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, history: data || [] });
});

app.get("/api/logs", async (req, res) => {
  if (!supabase) return res.json({ success: true, logs: [], warning: "Supabase is not configured" });

  const { data, error } = await supabase.from("sync_logs").select("*").order("created_at", { ascending: false }).limit(100);
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, logs: data || [] });
});

app.post("/api/watchlist", async (req, res) => {
  if (!dbReady(res)) return;

  const { userEmail, creatorId, listName = "Default Watchlist", note = "" } = req.body || {};
  if (!userEmail || !creatorId) return res.status(400).json({ success: false, message: "userEmail and creatorId are required" });

  const { data, error } = await supabase
    .from("user_watchlists")
    .upsert(
      { user_email: String(userEmail).trim().toLowerCase(), creator_id: creatorId, list_name: listName, note },
      { onConflict: "user_email,creator_id" },
    )
    .select()
    .single();

  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, item: data });
});

app.get("/api/watchlist/:email", async (req, res) => {
  if (!supabase) return res.json({ success: true, watchlist: [], warning: "Supabase is not configured" });

  const { data, error } = await supabase
    .from("user_watchlists")
    .select("*, creators(*)")
    .eq("user_email", String(req.params.email).trim().toLowerCase())
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, watchlist: data || [] });
});

app.delete("/api/watchlist/:id", async (req, res) => {
  if (!dbReady(res)) return;

  const { error } = await supabase.from("user_watchlists").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true });
});

app.post("/api/search-usage", async (req, res) => res.json({ success: true }));

app.post("/api/campaigns", async (req, res) => {
  if (!dbReady(res)) return;

  const body = req.body || {};
  if (!String(body.title || "").trim()) {
    return res.status(400).json({ success: false, message: "Campaign title is required" });
  }

  const payload = {
    title: String(body.title).trim(),
    brand_name: String(body.brand_name || "").trim(),
    country: String(body.country || "Ethiopia").trim(),
    category: String(body.category || "").trim(),
    objective: String(body.objective || "").trim(),
    budget_level: String(body.budget_level || "Medium").trim(),
    status: String(body.status || "Planning").trim(),
    pipeline_stage: String(body.pipeline_stage || "Discovery").trim(),
    notes: String(body.notes || "").trim(),
  };

  const { data, error } = await supabase.from("campaigns").insert(payload).select().single();
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.status(201).json({ success: true, campaign: data });
});

app.get("/api/campaigns", async (req, res) => {
  if (!supabase) return res.json({ success: true, campaigns: [], warning: "Supabase is not configured" });

  const { data, error } = await supabase.from("campaigns").select("*").order("created_at", { ascending: false });
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, campaigns: data || [] });
});

app.post("/api/campaign-brief", async (req, res) => {
  if (!dbReady(res)) return;

  const {
    userEmail = "",
    brandName = "",
    campaignGoal = "",
    country = "Ethiopia",
    category = "Food",
    budgetLevel = "Medium",
  } = req.body || {};

  if (!String(campaignGoal).trim()) {
    return res.status(400).json({ success: false, message: "Campaign goal is required" });
  }

  const generated_brief = `Campaign Brief for ${brandName || "Brand"}\nGoal: ${campaignGoal}\nCountry: ${country}\nCategory: ${category}\nBudget: ${budgetLevel}\n\nRecommended creator types:\n- High trust ${category} creators\n- Local creators in ${country}\n- Micro/mid creators with strong engagement\n\nExecution plan:\n1. Build a shortlist.\n2. Contact creators.\n3. Test 2 creative angles.\n4. Track weekly performance.`;

  const { data, error } = await supabase
    .from("campaign_briefs")
    .insert({
      user_email: userEmail,
      brand_name: brandName,
      campaign_goal: campaignGoal,
      country,
      category,
      budget_level: budgetLevel,
      generated_brief,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, brief: data });
});

app.post("/api/trends", async (req, res) => {
  if (!dbReady(res)) return;

  const body = req.body || {};
  if (!String(body.name || "").trim()) {
    return res.status(400).json({ success: false, message: "Trend name is required" });
  }

  const payload = {
    name: String(body.name).trim(),
    platform: String(body.platform || "TikTok").trim(),
    trend_scope: String(body.trend_scope || "Ethiopian").trim(),
    trend_type: String(body.trend_type || body.type || "Hashtag").trim(),
    type: String(body.type || body.trend_type || "Hashtag").trim(),
    country: String(body.country || "Ethiopia").trim(),
    region: String(body.region || "").trim(),
    category: String(body.category || "").trim(),
    trend_url: String(body.trend_url || "").trim(),
    description: String(body.description || "").trim(),
    recommendation_note: String(body.recommendation_note || "").trim(),
    trend_status: String(body.trend_status || "Rising").trim(),
    score: Number.isFinite(Number(body.score)) ? Number(body.score) : 80,
    growth: Number.isFinite(Number(body.growth)) ? Number(body.growth) : 10,
    status: String(body.status || "Published").trim(),
  };

  const { data, error } = await supabase.from("trends").insert(payload).select().single();
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.status(201).json({ success: true, trend: data });
});

app.get("/api/trends", async (req, res) => {
  if (!supabase) return res.json({ success: true, trends: [], warning: "Supabase is not configured" });

  const { data, error } = await supabase.from("trends").select("*").order("created_at", { ascending: false });
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, trends: data || [] });
});

if (hasSupabaseConfig) {
  cron.schedule("*/10 * * * *", async () => {
    try {
      await fetch(`http://localhost:${PORT}/api/sync-all`, { method: "POST" });
    } catch (error) {
      console.log("Scheduled sync failed:", error.message);
    }
  });
}

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

app.use((error, req, res, next) => {
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, message: "Invalid JSON request body" });
  }
  if (error?.message === "Origin is not allowed by CORS") {
    return res.status(403).json({ success: false, message: error.message });
  }
  console.error(error);
  return res.status(500).json({ success: false, message: "Internal server error" });
});

app.listen(PORT, () => console.log(`AfriCreator V13 Fixed backend running on port ${PORT}`));
