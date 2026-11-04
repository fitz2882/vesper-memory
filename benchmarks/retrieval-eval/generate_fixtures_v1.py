import json, datetime
NOW = datetime.datetime(2026,11,1,tzinfo=datetime.timezone.utc)
def ms(days_ago): return int((NOW - datetime.timedelta(days=days_ago)).timestamp()*1000)

M=[]
def mem(id, content, days, ns="default", t="semantic", agent=None, **kw):
    d={"id":id,"namespace":ns,"memory_type":t,"content":content,"created_days_ago":days}
    if agent: d["agent_id"]=agent
    d.update(kw); M.append(d)

# ---------------- default namespace: targets ----------------
mem("d-name","The user's name is Priya Raman and she works from Lisbon, Portugal.",120)
mem("d-employer","Priya works as a staff engineer at a logistics startup called Cargoline.",118)
mem("d-lang-pref","Priya prefers TypeScript over Python for backend services because she wants compile-time type checking.",110)
mem("d-tabs","Code style preference: two-space indentation, no semicolons, single quotes, enforced with Prettier.",100)
mem("d-dark","Priya uses a light editor theme during the day and switches to Solarized Dark after sunset.",95)
mem("d-tests","Priya expects every pull request to include unit tests and refuses to merge with coverage below 85 percent.",90)
mem("d-commit","Commit messages should follow Conventional Commits, e.g. 'fix(api): handle empty cursor'.",88)
mem("d-tz","Schedule meetings in Europe/Lisbon time; Priya does not take calls before 10:00 local.",87)
mem("d-err-econn","ECONNREFUSED 127.0.0.1:6380 on startup was caused by the dev Redis container not running; fix is docker compose up -d redis.",40,t="episodic")
mem("d-err-sqlite-busy","SQLITE_BUSY: database is locked appeared during consolidation; resolved by enabling WAL mode with PRAGMA journal_mode=WAL.",35,t="episodic")
mem("d-err-oom","The embedding container was OOM-killed (exit code 137) when batch size was 256; lowering it to 32 fixed it.",33,t="episodic")
mem("d-file-router","Query classification logic lives in src/router/smart-router.ts in the classifyQuery function.",60)
mem("d-file-outbox","The transactional outbox for Qdrant and Redis updates is implemented in src/retrieval/index-outbox.ts.",20)
mem("d-port-qdrant","The development Qdrant instance listens on port 6334, not the default 6333.",70)
mem("d-port-embed","The dev embedding service runs on port 8001; the personal instance uses 8000.",70)
mem("d-ticket","Ticket CARGO-4412 tracks the flaky geofence test that fails when the CI runner clock drifts.",25,t="episodic")
mem("d-feature-flag","The feature flag route_v2_enabled gates the new routing engine and defaults to false in production.",22)
mem("d-api-limit","The Mapbox Directions API key is limited to 300 requests per minute on the current plan.",45)
mem("d-deploy-friday","Team rule: no production deploys on Friday afternoons after 14:00.",80,t="decision")
mem("d-oncall","Priya is on call the first week of every month; pager escalations go to Tomasz after 15 minutes.",50)
mem("d-hiring","Priya is interviewing two candidates for a backend role; she cares most about debugging skill over algorithm puzzles.",15,t="episodic")
mem("d-coffee","Priya drinks oat flat whites and avoids caffeine after 3pm.",130)
mem("d-learning","Priya is learning Rust on weekends using the Rustlings exercises.",55)
mem("d-postmortem","The 12 October outage was caused by an expired TLS certificate on the internal tracking API.",20,t="episodic")
mem("d-cache-ttl","Shipment ETA responses are cached for 90 seconds to stay within the routing provider's quota.",42)
mem("d-db-choice-v1","Decision: store shipment events in MongoDB for flexible schemas.",200,t="decision")
mem("d-db-choice-v2","Decision: migrate shipment events from MongoDB to PostgreSQL because we need transactional updates across tables.",60,t="decision")
mem("d-queue-v1","Decision: use RabbitMQ for the dispatch job queue.",150,t="decision")
mem("d-queue-v2","Decision: replace RabbitMQ with AWS SQS for dispatch jobs to reduce ops burden.",30,t="decision")
mem("d-review-sla-v1","Code reviews must be answered within 48 hours.",180,t="decision")
mem("d-review-sla-v2","Code reviews must be answered within one business day.",45,t="decision")
mem("d-archived-laptop","Priya's old laptop is a 2019 Intel MacBook Pro.",300,archived_days_ago=100)
mem("d-laptop","Priya's current laptop is a 14-inch M3 MacBook Pro with 36 GB of RAM.",100)
mem("d-expired-promo","The staging environment is temporarily frozen until the Q3 audit finishes.",120,expired_days_ago=60)
mem("d-skill-release","Release procedure: bump the version, run npm run build, tag vX.Y.Z, push the tag, then publish to npm with 2FA.",65,t="procedural")
mem("d-skill-db-migrate","To add a database column, write a migration in migrations/, run it against a staging snapshot, then deploy behind a flag.",58,t="procedural")
mem("d-skill-debug-flaky","When a test is flaky, first rerun it with a fixed random seed and frozen clock before changing any code.",48,t="procedural")
mem("d-pet","Priya has a greyhound named Biscuit who needs a walk at lunchtime.",140)
mem("d-allergy","Priya is allergic to peanuts; avoid suggesting Thai satay places for team lunches.",135)
mem("d-standup","Daily standup is at 10:15 Lisbon time in the #routing-team channel.",75)
mem("d-linter","ESLint flat config is used; the rule no-floating-promises is set to error.",52)
mem("d-observability","Traces are sent to Honeycomb; logs go to Loki with a 14-day retention.",44)
mem("d-k8s","Production runs on EKS with three node groups; the routing workers have their own spot node group.",66)
mem("d-budget","The monthly cloud budget is 18,000 USD and the routing workers are the largest line item.",38)
mem("d-manager","Priya's manager is Inês Carvalho, the VP of Engineering.",112)
mem("d-goal","Priya's goal this quarter is to cut median ETA error from 9 minutes to under 5 minutes.",28)
mem("d-ml-model","ETA prediction uses a LightGBM model retrained nightly on the last 30 days of deliveries.",34)
mem("d-retrain-fail","Nightly retraining failed on 28 October because a feature column arrived as strings instead of floats.",4,t="episodic")
mem("d-docs-pref","Priya prefers short design docs with a decision log at the top rather than long narratives.",92)
mem("d-meeting-free","Wednesdays are meeting-free focus days for the routing team.",77)

# ---------------- default namespace: fillers (topical distractors) ----------------
fill=[
"The geofence service computes polygon containment with the turf.js library.",
"Driver app releases go through TestFlight for internal QA before the App Store.",
"The warehouse scanner integration uses a SOAP endpoint that times out after 30 seconds.",
"Customer support uses Zendesk macros for delayed-shipment apologies.",
"The billing service is owned by the payments team in Warsaw.",
"Address normalization relies on libpostal running in a sidecar container.",
"Route optimization uses OR-Tools with a 20 second solver time limit.",
"The analytics warehouse is Snowflake and dbt models run hourly.",
"Grafana dashboards for dispatch latency live in the routing folder.",
"Redis is used for rate limiting the public tracking API.",
"The mobile team prefers Kotlin Multiplatform for shared business logic.",
"Infrastructure is defined with Terraform modules in the infra-live repository.",
"Secrets are stored in AWS Secrets Manager and rotated every 90 days.",
"The public tracking page is a Next.js app deployed on Vercel.",
"Webhook deliveries to customers are retried with exponential backoff up to 24 hours.",
"Load tests use k6 scripts stored under tools/load.",
"The data retention policy deletes raw GPS pings after 180 days.",
"A Postgres read replica serves the reporting dashboards.",
"The design system is built with Radix primitives and Tailwind.",
"Feature work is planned in two-week sprints starting on Mondays.",
"The routing team has five engineers and one product manager.",
"Incident reviews are blameless and published in Confluence within a week.",
"The internal CLI is called cargoctl and is written in Go.",
"Vehicle telematics arrive over MQTT through AWS IoT Core.",
"The legacy PHP admin panel is scheduled to be retired next year.",
"Dependency updates are automated with Renovate on a weekly schedule.",
"Docker images are scanned with Trivy in CI before pushing to ECR.",
"The company holiday party is in December at a venue in Alfama.",
"Priya once gave a talk about vehicle routing heuristics at a Lisbon JS meetup.",
"Error budgets are defined per service with a 99.9 percent monthly SLO.",
"The tracking API is versioned in the URL path, currently /v3.",
"Translations are managed in Crowdin and synced nightly.",
"The ops team uses PagerDuty schedules exported to Google Calendar.",
"Map tiles are cached in CloudFront for 24 hours.",
"Synthetic monitoring checks the tracking page every minute from three regions.",
"Pricing experiments are run with a homegrown A/B framework named Toggle.",
"Driver shift data is imported from a CSV export every morning at 06:00.",
"The GraphQL gateway federates the shipments and fleet subgraphs.",
"Unit tests run with Vitest and integration tests with Testcontainers.",
"The team retro uses a start/stop/continue format.",
"Customer contracts specify a 99.5 percent uptime for the tracking API.",
"The fleet subgraph is written in Kotlin with Spring Boot.",
"Cold-chain shipments require temperature readings every five minutes.",
"Priya mentors two junior engineers through a biweekly 1:1.",
"The ETA model features include traffic speed, stop count and historical dwell time.",
"Staging data is refreshed from an anonymized production snapshot every Sunday.",
"Rate cards for carriers are stored as versioned JSON in S3.",
"The office in Lisbon is near Cais do Sodré.",
"Onboarding docs for new engineers live in the handbook repository.",
"The routing workers are written in TypeScript running on Node 22.",
]
for i,c in enumerate(fill):
    mem(f"d-fill-{i:02d}",c,10+i*3)

# ---------------- other namespaces: hard distractors ----------------
mem("r-name","Research subject profile: the participant's name is Priya Natarajan, based in Chennai.",30,ns="researcher",agent="research-bot")
mem("r-lang","Survey result: most respondents prefer Python over TypeScript for data pipelines.",25,ns="researcher",agent="research-bot")
mem("r-err-econn","ECONNREFUSED 127.0.0.1:6380 in the research sandbox was a firewall rule, not Redis.",12,ns="researcher",t="episodic",agent="research-bot")
mem("r-db","Literature review: PostgreSQL outperforms MongoDB for multi-document transactions in 2025 benchmarks.",18,ns="researcher",agent="research-bot")
mem("r-queue","Comparison notes: SQS has lower operational overhead than RabbitMQ but weaker ordering guarantees.",16,ns="researcher",agent="research-bot")
mem("r-eta","Paper summary: graph neural networks reduce ETA error by 12 percent over gradient boosting in urban delivery.",14,ns="researcher",agent="research-bot")
mem("r-coverage","Study: teams enforcing 85 percent coverage saw fewer regressions but slower merges.",20,ns="researcher",agent="research-bot")
mem("r-flaky","Research note: flaky tests are most often caused by time and ordering dependencies.",11,ns="researcher",agent="research-bot")
mem("r-oncall","Survey: engineers on call one week per month report lower burnout than those on rolling rotations.",9,ns="researcher",agent="research-bot")
mem("r-release","Industry practice: most npm packages publish from CI with provenance rather than from laptops.",8,ns="researcher",t="procedural",agent="research-bot")
mem("v-tests","Reviewer guideline: block pull requests that lower coverage below 80 percent.",21,ns="reviewer",agent="review-bot")
mem("v-commit","Reviewer guideline: commit messages must reference a Jira ticket like CARGO-1234.",19,ns="reviewer",agent="review-bot")
mem("v-style","Reviewer guideline: four-space indentation and semicolons are required in the legacy PHP admin.",17,ns="reviewer",agent="review-bot")
mem("v-deploy","Reviewer note: deploys on Friday are allowed if the change is behind a feature flag.",13,ns="reviewer",t="decision",agent="review-bot")
mem("v-router","Reviewer note: src/router/smart-router.ts classifyQuery has too many regexes; suggest a table.",6,ns="reviewer",agent="review-bot")

# ---------------- supersession wiring ----------------
by={m["id"]:m for m in M}
def supersede(old,new):
    by[old]["superseded_by"]=new
    by[old]["valid_until_days_ago"]=by[new]["created_days_ago"]
for o,n in [("d-db-choice-v1","d-db-choice-v2"),("d-queue-v1","d-queue-v2"),("d-review-sla-v1","d-review-sla-v2")]:
    supersede(o,n)

Q=[]
def q(id,family,query,relevant,ns="default",stale=(),partial=(),**kw):
    d={"id":id,"family":family,"query":query,"namespace":ns,"relevant":list(relevant)}
    if partial: d["partially_relevant"]=list(partial)
    if stale: d["stale"]=list(stale)
    d.update(kw); Q.append(d)

# lexical needles: exact identifiers, error strings, filenames
q("lx-01","lexical","ECONNREFUSED 127.0.0.1:6380",["d-err-econn"])
q("lx-02","lexical","SQLITE_BUSY database is locked",["d-err-sqlite-busy"])
q("lx-03","lexical","exit code 137",["d-err-oom"])
q("lx-04","lexical","smart-router.ts classifyQuery",["d-file-router"])
q("lx-05","lexical","index-outbox.ts",["d-file-outbox"])
q("lx-06","lexical","CARGO-4412",["d-ticket"])
q("lx-07","lexical","route_v2_enabled",["d-feature-flag"])
q("lx-08","lexical","port 6334",["d-port-qdrant"])
q("lx-09","lexical","Mapbox Directions API",["d-api-limit"])
q("lx-10","lexical","LightGBM",["d-ml-model"],partial=["d-fill-44"])
q("lx-11","lexical","Honeycomb Loki",["d-observability"])
q("lx-12","lexical","Rustlings",["d-learning"])

# conversational phrasing with shared tokens (stopword-heavy)
q("cv-01","conversational","What is my name?",["d-name"])
q("cv-02","conversational","Where do I work?",["d-employer"],partial=["d-name"])
q("cv-03","conversational","Who is my manager?",["d-manager"])
q("cv-04","conversational","What is my dog called?",["d-pet"])
q("cv-05","conversational","What am I allergic to?",["d-allergy"])
q("cv-06","conversational","What laptop do I use?",["d-laptop"])
q("cv-07","conversational","When is standup?",["d-standup"])
q("cv-08","conversational","What is my goal this quarter?",["d-goal"])

# paraphrases: little token overlap
q("pp-01","paraphrase","Which language does she favour for server code?",["d-lang-pref"])
q("pp-02","paraphrase","How should I format source files?",["d-tabs"],partial=["d-linter"])
q("pp-03","paraphrase","What colour scheme for the editor at night?",["d-dark"])
q("pp-04","paraphrase","Minimum test coverage needed before merging",["d-tests"])
q("pp-05","paraphrase","What hot drink should I bring her?",["d-coffee"])
q("pp-06","paraphrase","Earliest time I can book a call with her",["d-tz"])
q("pp-07","paraphrase","Why did the vector database connection get refused locally?",["d-err-econn"],partial=["d-port-qdrant"])
q("pp-08","paraphrase","The model container keeps getting killed for using too much memory",["d-err-oom"])
q("pp-09","paraphrase","What broke the tracking service in mid October?",["d-postmortem"])
q("pp-10","paraphrase","How long are arrival time predictions kept before recomputing?",["d-cache-ttl"])
q("pp-11","paraphrase","How do I ship a new version of the package?",["d-skill-release"])
q("pp-12","paraphrase","Steps for adding a field to a table",["d-skill-db-migrate"])
q("pp-13","paraphrase","A test passes sometimes and fails other times, what do I do first?",["d-skill-debug-flaky"],partial=["d-ticket"])
q("pp-14","paraphrase","How much can we spend on cloud each month?",["d-budget"])
q("pp-15","paraphrase","Which day has no meetings?",["d-meeting-free"])
q("pp-16","paraphrase","What went wrong with last night's model training?",["d-retrain-fail"],partial=["d-ml-model"])
q("pp-17","paraphrase","What does she look for when hiring?",["d-hiring"])
q("pp-18","paraphrase","Who handles pages if I don't respond?",["d-oncall"])

# hard distractors: near-duplicate content in other namespaces
q("hd-01","distractor","What is the user's name?",["d-name"],forbidden=["r-name"])
q("hd-02","distractor","Does she prefer Python or TypeScript?",["d-lang-pref"],forbidden=["r-lang"])
q("hd-03","distractor","Required coverage percentage for pull requests",["d-tests"],forbidden=["v-tests","r-coverage"])
q("hd-04","distractor","Are Friday deploys allowed?",["d-deploy-friday"],forbidden=["v-deploy"])
q("hd-05","distractor","What should commit messages look like?",["d-commit"],forbidden=["v-commit"])
q("hd-06","distractor","Indentation and semicolon rules",["d-tabs"],forbidden=["v-style"])
q("hd-07","distractor","Survey on flaky tests causes",["r-flaky"],ns="researcher",forbidden=["d-skill-debug-flaky","d-ticket"])
q("hd-08","distractor","Reviewer guideline on coverage",["v-tests"],ns="reviewer",forbidden=["d-tests","r-coverage"])

# longitudinal: current vs historical (as_of)
q("lg-01","longitudinal","Which database stores shipment events?",["d-db-choice-v2"],stale=["d-db-choice-v1"])
q("lg-02","longitudinal","What queue do dispatch jobs use?",["d-queue-v2"],stale=["d-queue-v1"])
q("lg-03","longitudinal","How fast must code reviews be answered?",["d-review-sla-v2"],stale=["d-review-sla-v1"])
q("lg-04","longitudinal","Which database stores shipment events?",["d-db-choice-v1"],stale=["d-db-choice-v2"],as_of_days_ago=100)
q("lg-05","longitudinal","What queue do dispatch jobs use?",["d-queue-v1"],stale=["d-queue-v2"],as_of_days_ago=60)
q("lg-06","longitudinal","How fast must code reviews be answered?",["d-review-sla-v1"],stale=["d-review-sla-v2"],as_of_days_ago=90)
q("lg-07","longitudinal","What laptop does Priya have?",["d-laptop"],stale=["d-archived-laptop"])
q("lg-08","longitudinal","Is the staging environment frozen?",[],stale=["d-expired-promo"])

# abstention: nothing relevant in the namespace
q("ab-01","abstention","What is Priya's favourite football team?",[])
q("ab-02","abstention","Which cloud region hosts the Tokyo cluster?",[])
q("ab-03","abstention","What is the Wi-Fi password at the office?",[])
q("ab-04","abstention","Who won the hackathon last spring?",[])
q("ab-05","abstention","What is the user's name?",[],ns="empty-namespace")
q("ab-06","abstention","Rust borrow checker lifetime error E0597",[])

json.dump({"version":1,"reference_time":NOW.isoformat().replace("+00:00","Z"),
  "notes":"Frozen fixture. Do not edit labels after looking at results; add a new version instead.",
  "memories":M,"queries":Q}, open(__import__("os").path.join(__import__("os").path.dirname(__file__),"fixtures.v1.json"),"w"), indent=1)
print(len(M),"memories",len(Q),"queries")
