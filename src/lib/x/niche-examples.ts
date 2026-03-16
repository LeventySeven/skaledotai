/**
 * Niche interpretation examples dataset.
 * Exported as a string constant so it gets bundled by bun build / Next.js
 * and injected into planner + pre-screen prompts at runtime.
 *
 * To add new niches: add a new section following the same format.
 * To edit: modify the examples and redeploy.
 */

/**
 * Select the most relevant example sections for a given niche query.
 * Returns at most `limit` sections (default 3) plus the structural patterns section.
 * This keeps the prompt compact (~800-1200 tokens) instead of injecting all examples (~2200 tokens).
 *
 * Aligned with LangGraph handoff docs: "Balance context completeness against token costs."
 */
export function selectRelevantExamples(niche: string, limit = 3): string {
  const nicheWords = niche.toLowerCase().split(/\s+/);
  const sections = NICHE_EXAMPLES.split(/(?=^## )/m).filter((s) => s.trim());

  // Separate the structural patterns section (always included) from niche examples
  const patternsSection = sections.find((s) => s.startsWith("## Structural Patterns"));
  const nicheSections = sections.filter((s) => !s.startsWith("## Structural Patterns") && !s.startsWith("---"));

  // Score each section by keyword overlap with the query
  const scored = nicheSections.map((section) => {
    const sectionLower = section.toLowerCase();
    const hits = nicheWords.filter((word) => word.length >= 3 && sectionLower.includes(word)).length;
    // Bonus for exact phrase match
    const phraseBonus = sectionLower.includes(niche.toLowerCase()) ? 10 : 0;
    return { section, score: hits + phraseBonus };
  });

  // Sort by relevance, take top N
  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, limit).map((s) => s.section);

  // If no good matches, take the first 2 as generic examples
  if (selected.length === 0) {
    selected.push(...nicheSections.slice(0, 2));
  }

  const parts = [...selected];
  if (patternsSection) parts.push(patternsSection);
  return parts.join("\n");
}

export const NICHE_EXAMPLES = `
## Product Designers

Query: "product designers"

roleTerms:
- product designer
- product designers
- product design
- UX designer
- UI/UX designer
- digital product designer
- senior product designer
- lead product designer
- staff designer
- interaction designer
- UX/UI designer

bioTerms:
- I design products
- designing digital products
- product design at
- design lead at
- designing experiences
- design @company
- currently designing at
- product design • UX
- crafting user experiences

antiGoals:
- product manager
- head of product
- VP of product
- chief product officer
- product marketing
- product owner
- CEO
- CTO
- UX researcher (unless also does design)
- design recruiter
- design agency (company)
- design community (org)

## Startup Founders

Query: "startup founders"

roleTerms:
- startup founder
- startup founders
- startup founding
- co-founder
- cofounder
- founder & CEO
- technical founder
- solo founder
- first-time founder
- serial founder
- founding CEO

bioTerms:
- founded @company
- building @company
- founder of
- co-founder of
- building a startup
- I started
- bootstrapping
- YC founder
- prev founded
- ex-founder

antiGoals:
- venture capitalist
- investor
- angel investor
- advisor
- board member
- startup employee (not founder)
- accelerator (org)
- incubator (org)
- startup community (org)

## Founding Engineers

Query: "founding engineers"

roleTerms:
- founding engineer
- founding engineers
- founding engineering
- founding software engineer
- first engineer
- engineer #1
- founding eng
- founding member (engineering)
- early engineer

bioTerms:
- founding engineer at
- first engineer at
- building from 0 to 1
- joined as engineer #1
- early-stage engineering
- founding eng at
- building the engineering team from scratch

antiGoals:
- senior engineer (at established company)
- engineering manager
- CTO (unless also founding eng)
- VP engineering
- staff engineer (at large company)
- tech lead (at large company)
- founder (non-technical)

## Software Engineers

Query: "software engineers"

roleTerms:
- software engineer
- software engineers
- software engineering
- software developer
- SWE
- backend engineer
- frontend engineer
- full-stack engineer
- full-stack developer
- web developer
- senior software engineer
- staff engineer
- principal engineer

bioTerms:
- I build software
- software engineer at
- building with React/Python/Go/Rust
- writing code at
- SWE at
- dev at
- engineer @company
- coding and shipping
- full-stack at

antiGoals:
- engineering manager
- VP engineering
- CTO (unless they still code)
- DevOps (unless also SWE)
- QA engineer
- data scientist
- product manager
- tech recruiter
- coding bootcamp (org)

## AI / ML Engineers

Query: "AI engineers"

roleTerms:
- AI engineer
- AI engineers
- AI engineering
- ML engineer
- machine learning engineer
- deep learning engineer
- LLM engineer
- applied AI engineer
- NLP engineer
- computer vision engineer
- MLOps engineer

bioTerms:
- building AI at
- working on LLMs
- ML engineer at
- training models
- AI/ML at
- building with transformers
- applied ML at
- shipping AI products
- fine-tuning LLMs

antiGoals:
- AI researcher (unless also builds)
- data analyst
- data scientist (unless also builds ML systems)
- AI ethicist
- AI policy
- AI newsletter (org)
- AI community (org)
- AI startup founder (different role)

## AI / ML Researchers

Query: "AI researchers"

roleTerms:
- AI researcher
- AI researchers
- AI research
- ML researcher
- machine learning researcher
- research scientist
- deep learning researcher
- NLP researcher
- computer vision researcher
- research engineer

bioTerms:
- research at
- researching AI
- PhD in machine learning
- publishing on
- working on alignment
- research scientist at
- studying neural networks
- NeurIPS/ICML/ICLR author
- postdoc in AI

antiGoals:
- AI engineer (unless also researches)
- data analyst
- AI product manager
- AI journalist
- AI influencer
- AI newsletter (org)
- university department (org)
- research lab (org account, not person)

## Growth Marketers

Query: "growth marketers"

roleTerms:
- growth marketer
- growth marketers
- growth marketing
- growth hacker
- head of growth
- growth lead
- performance marketer
- demand gen
- acquisition marketer
- lifecycle marketer
- growth PM

bioTerms:
- growing @company
- scaling growth at
- growth at
- driving acquisition
- 0 to 1M users
- growth experiments
- PLG growth
- building growth loops
- paid + organic growth

antiGoals:
- content marketer (different specialty)
- brand marketer
- social media manager
- CMO (executive, not hands-on)
- marketing agency (org)
- marketing community (org)
- growth VC/investor

## DevRel / Developer Advocates

Query: "developer advocates"

roleTerms:
- developer advocate
- developer advocates
- developer advocacy
- DevRel
- developer relations
- developer evangelist
- dev advocate
- community engineer
- developer experience engineer

bioTerms:
- DevRel at
- developer advocate at
- building developer community
- helping developers
- dev advocacy
- speaking at conferences about
- developer experience at
- writing docs and tutorials

antiGoals:
- software engineer (unless also DevRel)
- technical writer (different role)
- community manager (non-technical)
- recruiter
- developer tools company (org)
- conference account (org)

## Data Scientists

Query: "data scientists"

roleTerms:
- data scientist
- data scientists
- data science
- senior data scientist
- lead data scientist
- applied scientist
- quantitative analyst
- ML scientist

bioTerms:
- data science at
- analyzing data at
- building models at
- data scientist at
- turning data into insights
- statistics and ML
- applied science at
- working with data

antiGoals:
- data engineer (different role)
- data analyst (more junior/different)
- business analyst
- ML engineer (builds infra, not models)
- analytics manager
- data bootcamp (org)
- data community (org)

## Tech Content Creators

Query: "tech content creators"

roleTerms:
- tech content creator
- tech content creators
- tech YouTuber
- tech blogger
- dev content creator
- coding YouTuber
- tech educator
- programming tutorial creator

bioTerms:
- creating content about tech
- tech YouTube
- making coding tutorials
- writing about development
- teaching code on
- tech content at
- videos about programming

antiGoals:
- tech journalist (different role)
- tech podcast (org account)
- tech publication (org)
- tech newsletter (unless person behind it)
- software engineer who occasionally posts (not primarily creator)

---

## Structural Patterns to Extract (apply to ANY niche)

These examples all follow the same structure. When you encounter a NEW query not listed above, apply these patterns:

### Pattern 1: Role Form Coverage
Every example generates singular + plural + discipline. Apply this to any role:
- "blockchain developers" → "blockchain developer" / "blockchain developers" / "blockchain development"
- "motion designers" → "motion designer" / "motion designers" / "motion design"
- "technical writers" → "technical writer" / "technical writers" / "technical writing"

### Pattern 2: Bio Language ≠ Job Titles
People on X write casually. Study how each example's bioTerms differ from roleTerms:
- roleTerms are formal: "product designer"
- bioTerms are casual: "designing products at", "crafting user experiences"
For YOUR query, think: how would someone in this role describe their daily work in a tweet-length bio?

### Pattern 3: Synonym Test
For each synonym candidate, ask: "Would this person be hired for the queried role?"
- "UX designer" → hired as product designer? Yes → synonym
- "product manager" → hired as product designer? No → antiGoal

### Pattern 4: antiGoals Are Role-Specific
Every example names the SPECIFIC adjacent roles that get confused with that niche. Don't reuse antiGoals from other examples. Think about what roles share keywords with YOUR query but are fundamentally different jobs.

### Pattern 5: No Lone Words
Never output a single generic word. "design", "product", "data", "engineer" alone match millions of unrelated profiles. Every term must be specific enough that matching it in a bio strongly implies the person holds this role.

### Pattern 6: Org Exclusion
Always include organizational account types in antiGoals: companies, communities, newsletters, job boards, bootcamps, conferences that operate in this niche.
`.trim();
