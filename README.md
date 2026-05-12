  1	# ContentFlow — Automated Social Integration
     2	
     3	## 🚀 Project Overview
     4	**ContentFlow** is a long-term content automation dashboard that connects a **Website → Claude AI → Arvo → Blotato → Facebook & Instagram** pipeline. It enables fully automated content scraping, AI rewriting, video script generation, social formatting, and scheduled publishing — all from one interface.
     5	
     6	---
     7	
     8	## ✅ Completed Features
     9	
    10	### 🎛️ Dashboard
    11	- Live pipeline stats (Total Runs, Posted, Pending, Failed)
    12	- Visual flow diagram showing all 5 automation stages
    13	- Quick Action buttons (Run Pipeline, Schedule Post, Configure APIs)
    14	- Recent pipeline runs table with status indicators
    15	
    16	### ⚙️ Content Pipeline (5-Stage Automation)
    17	| Step | Service | Function |
    18	|------|---------|----------|
    19	| 1 | **Website** | Scrape or manually paste source content |
    20	| 2 | **Claude AI** | Rewrite content for Facebook & Instagram |
    21	| 3 | **Arvo** | Generate short video script (with style/duration/ratio) |
    22	| 4 | **Blotato** | Format caption, hashtags, schedule payload |
    23	| 5 | **Social** | Auto-publish to Facebook Graph API & Instagram Graph API |
    24	
    25	- Full pipeline mode (run all 5 steps at once)
    26	- Step-by-step mode (pause between each stage)
    27	- Real-time progress bar with animated step indicators
    28	- Live previews for Claude output, Arvo script, and Blotato payload
    29	- Demo/fallback mode when API keys are not yet configured
    30	
    31	### 📅 Post Scheduler
    32	- Create scheduled posts with caption, hashtags, media URL
    33	- Set date/time and repeat intervals (daily, weekly, bi-weekly, monthly)
    34	- Target Facebook and/or Instagram per post
    35	- Scheduled post list with delete controls
    36	- Background daemon checks and auto-publishes due posts every 60s
    37	
    38	### 📋 History
    39	- Full paginated run history
    40	- Search by URL or status
    41	- Filter by status (posted / pending / failed)
    42	- View full run details modal (Claude output, Arvo script, post IDs, error logs)
    43	- Delete individual records
    44	
    45	### ⚙️ Settings & API Configuration
    46	| Integration | Configurable Fields |
    47	|-------------|-------------------|
    48	| **Claude (Anthropic)** | API Key, Model (opus/sonnet/haiku), Max Tokens |
    49	| **Arvo** | API Key, Workspace ID, Template ID, Webhook URL |
    50	| **Blotato** | API Key, Account ID |
    51	| **Facebook** | Page Access Token, Page ID |
    52	| **Instagram** | Access Token, Business Account ID |
    53	| **Automation** | Scrape interval, Default post time, Queue size, Retry count |
    54	
    55	- Show/hide password fields (eye toggle)
    56	- Connection status indicators (sidebar + settings badges)
    57	- Test individual connections or "Test All" at once
    58	- Toggle: Auto-post after pipeline, Browser notifications, Auto-hashtag generation
    59	
    60	---
    61	
    62	## 🗂️ File Structure
    63	
    64	```
    65	index.html          — Main SPA with all 5 pages
    66	css/
    67	  style.css         — Full dark-theme design system
    68	js/
    69	  app.js            — Complete pipeline logic + API integrations
    70	```
    71	
    72	---
    73	
    74	## 🔗 Functional Entry Points (URIs / Routes)
    75	
    76	All navigation is client-side SPA. Pages are activated via `data-page` attribute:
    77	
    78	| Page | Hash/Trigger | Description |
    79	|------|-------------|-------------|
    80	| Dashboard | `navigateTo('dashboard')` | Stats, flow diagram, recent runs |
    81	| Pipeline  | `navigateTo('pipeline')`  | Run 5-stage automation |
    82	| Scheduler | `navigateTo('scheduler')` | Create & manage scheduled posts |
    83	| History   | `navigateTo('history')`   | All pipeline run records |
    84	| Settings  | `navigateTo('settings')`  | API keys & automation config |
    85	
    86	### RESTful Table API Used
    87	| Table | Endpoint | Purpose |
    88	|-------|----------|---------|
    89	| `pipeline_runs` | `tables/pipeline_runs` | Stores all pipeline execution records |
    90	| `settings` | `tables/settings` | Persists API keys and config values |
    91	
    92	---
    93	
    94	## 🔌 External API Integrations
    95	
    96	| API | Endpoint | Auth Method |
    97	|-----|----------|-------------|
    98	| Anthropic Claude | `https://api.anthropic.com/v1/messages` | `x-api-key` header |
    99	| Arvo Video | `https://api.arvo.video/v1/scripts` | Bearer token |
   100	| Blotato | `https://api.blotato.com/v1/schedule` | Bearer token |
   101	| Facebook Graph | `https://graph.facebook.com/v19.0/{pageId}/feed` | `access_token` param |
   102	| Instagram Graph | `https://graph.facebook.com/v19.0/{accountId}/media` | `access_token` param |
   103	
   104	> **Note:** All APIs include graceful fallback to demo/simulation mode if keys are not configured, so the UI is fully explorable before connecting live credentials.
   105	
   106	---
   107	
   108	## 📊 Data Models
   109	
   110	### `pipeline_runs` Table
   111	| Field | Type | Description |
   112	|-------|------|-------------|
   113	| `id` | text | Unique run ID (auto UUID) |
   114	| `source_url` | text | Website URL scraped |
   115	| `raw_content` | rich_text | Raw scraped content |
   116	| `claude_output` | rich_text | Claude AI rewritten content |
   117	| `arvo_script` | rich_text | Arvo video script |
   118	| `blotato_payload` | rich_text | Blotato formatted JSON payload |
   119	| `status` | text | pending / scraping / claude_processing / arvo_processing / blotato_ready / scheduled / posted / failed |
   120	| `platform` | array | Target platforms: facebook, instagram |
   121	| `scheduled_at` | datetime | When to publish (ms timestamp) |
   122	| `posted_at` | datetime | Actual publish time |
   123	| `fb_post_id` | text | Facebook post ID after publishing |
   124	| `ig_post_id` | text | Instagram post ID after publishing |
   125	| `error_log` | rich_text | Error messages if pipeline failed |
   126	
   127	### `settings` Table
   128	| Field | Type | Description |
   129	|-------|------|-------------|
   130	| `id` | text | Setting key (e.g. `claude_api_key`) |
   131	| `value` | text | Setting value |
   132	| `label` | text | Human-readable label |
   133	| `category` | text | api_keys / social / pipeline / schedule |
   134	
   135	---
   136	
   137	## 🔧 Setup Instructions
   138	
   139	1. **Open the app** → go to the **Settings** page
   140	2. **Add your Claude API key** (get from console.anthropic.com)
   141	3. **Add your Arvo credentials** (workspace ID + API key from arvo.video)
   142	4. **Add your Blotato credentials** (from app.blotato.com)
   143	5. **Add Facebook Page Access Token + Page ID** (from developers.facebook.com)
   144	6. **Add Instagram Business Account credentials** (via Meta Graph API)
   145	7. Click **"Test All"** to verify connections
   146	8. Go to **Pipeline** → enter a URL → click **Run Full Pipeline**
   147	
   148	---
   149	
   150	## ⏳ Features Not Yet Implemented
   151	
   152	- [ ] Real website proxy scraping (requires a CORS proxy or backend)
   153	- [ ] OAuth2 login flow for Facebook/Instagram (currently uses manual tokens)
   154	- [ ] Arvo video render status polling (webhook receiver)
   155	- [ ] Image/media upload support for posts
   156	- [ ] Analytics charts (engagement, reach per post)
   157	- [ ] Email/webhook notifications on pipeline completion
   158	- [ ] Content calendar view in Scheduler
   159	- [ ] Multi-account management (multiple FB pages / IG accounts)
   160	- [ ] A/B caption testing
   161	
   162	---
   163	
   164	## 🧭 Recommended Next Steps
   165	
   166	1. **Add a CORS proxy** (e.g. `allorigins.win` or a Cloudflare Worker) for real website scraping
   167	2. **Connect live Facebook/Instagram tokens** via Meta for Developers portal
   168	3. **Set up Arvo webhook** to receive render-complete notifications
   169	4. **Enable browser notifications** in Settings for pipeline completion alerts
   170	5. **Schedule recurring posts** using the daily/weekly repeat feature
   171	
   172	---
   173	
   174	*Built with: HTML5 · CSS3 · Vanilla JavaScript · Anthropic Claude API · Arvo Video API · Blotato API · Meta Graph API · RESTful Table API*
   175	
